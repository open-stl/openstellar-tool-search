import type { tool } from '@opencode-ai/plugin';
import type { ToolProvider, ToolDefinition } from '../catalog/tool-provider.js';
import type { McpServerConfig } from './types.js';
import type { ServerCacheEntry } from './adapter-cache.js';
import { AdapterCache, globalAdapterCache } from './adapter-cache.js';
import { TransportFactory } from './transport-factory.js';
import { LocalTransportConnector } from './transports/local-transport.js';
import { RemoteTransportConnector } from './transports/remote-transport.js';
import { createMcpConnection } from './server-connection.js';
import { adaptMcpTool } from './mcp-tool-adapter.js';

export { sanitizeToolId } from './mcp-tool-adapter.js';

/**
 * Enabled-server filter (V2 `disabled: true` / V1 `enabled: false`). Shared by
 * the provider (server list) and the wiring (placeholder registration) so the
 * filter lives in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isServerEnabled(s: any): boolean {
  return s.disabled !== true && s.enabled !== false;
}

const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const UNNAMED_SERVER = 'unnamed';
/**
 * Per-server warm-up timeout. A server still unsettled at its timeout is CUT
 * (fail-open, contributes no tools) and a console.warn names it. Must exceed
 * the search executors' combined budget (2s + 3s) AND real slow servers
 * (~10.5s agentmemory) so they settle before the factory returns — 60s does.
 * Injectable per-provider (and per-plugin via the `timeout` config) for tests.
 */
export const DEFAULT_WARMUP_TIMEOUT_MS = 60_000;

/**
 * Race `promise` against a timeout, resolving `false` when the timer wins.
 * The timer is cleared in `finally` on settle so no dangling handle holds the
 * event loop. `null` on settle frees the reference. The timer is also
 * registered in `activeTimers` (cleared by `close()`) so a hung server's
 * deadline timer can never hold the event loop after provider close.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  activeTimers?: Set<NodeJS.Timeout>,
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T | null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    if (activeTimers && timer) activeTimers.add(timer);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
      activeTimers?.delete(timer);
    }
  });
}

export class McpToolProvider implements ToolProvider {
  private servers: McpServerConfig[];
  private cache: AdapterCache;
  private factory: TransportFactory;
  private tools: ToolDefinition[] = [];
  private executableTools = new Map<string, ReturnType<typeof tool>>();
  private listeners: ((tools: ToolDefinition[]) => void)[] = [];
  private warmUpPromise: Promise<ToolDefinition[]> | null = null;
  private warmupTimeoutMs: number;
  private activeTimers = new Set<NodeJS.Timeout>();

  constructor(
    servers: Record<string, McpServerConfig> | McpServerConfig[],
    cache = globalAdapterCache,
    factory = new TransportFactory(),
    warmupTimeoutMs = DEFAULT_WARMUP_TIMEOUT_MS,
  ) {
    const rawList = Array.isArray(servers)
      ? servers
      : Object.entries(servers).map(([name, cfg]) => ({ ...cfg, name: cfg.name ?? name }));

    // Filter out servers marked disabled: true (V2) or enabled: false (V1)
    this.servers = rawList.filter(isServerEnabled);
    this.cache = cache;
    this.factory = factory;
    this.warmupTimeoutMs = warmupTimeoutMs;
    this.factory.register('local', new LocalTransportConnector());
    this.factory.register('remote', new RemoteTransportConnector());
  }

  /**
   * Resolves the cached MCP connection for a server, connecting (and caching)
   * a fresh client + transport when no live entry exists. Shared by warm-up and
   * the executable-tool client getter so reconnect behavior is identical.
   */
  private async getConnection(
    server: McpServerConfig,
    serverName: string,
  ): Promise<ServerCacheEntry> {
    const serverKey = this.cache.getServerKey({ ...server, name: serverName });
    return this.cache.getOrCreate(serverKey, () =>
      createMcpConnection({ ...server, name: serverName }, (cfg, client) =>
        this.factory.connect(cfg, client),
      ).then(({ client, transport }) => ({ tools: {}, transport, client })),
    );
  }

  warmUp(): Promise<ToolDefinition[]> {
    if (this.warmUpPromise) {
      return this.warmUpPromise;
    }
    this.warmUpPromise = (async () => {
      const serverTasks = this.servers.map(async (serverConfig) => {
        const serverName = serverConfig.name ?? UNNAMED_SERVER;
        // Per-server effective deadline: the server's own handshake timeout
        // wins if set; otherwise the provider-level warm-up deadline bounds it.
        const deadline = Math.min(
          serverConfig.timeout ?? Number.MAX_SAFE_INTEGER,
          this.warmupTimeoutMs,
        );

        // LAYER-2 SETTLED-IS-FINAL GUARD (by construction): the work is raced
        // against the deadline via withTimeout. ONLY the winner's continuation
        // may append + notifyListeners — the loser (deadline elapsed, work
        // still in flight) touches nothing, so late propagation can NEVER land
        // after the provider has reported settled.
        const work = (async (): Promise<ToolDefinition[]> => {
          const serverTools: ToolDefinition[] = [];
          try {
            console.log(`\x1b[36m[Tool Search]\x1b[0m Connecting MCP server "${serverName}"...`);
            const cacheEntry = await this.getConnection(serverConfig, serverName);
            const mcpToolsResult = await cacheEntry.client.listTools();

            for (const toolDef of mcpToolsResult.tools) {
              const isDeferred = serverConfig.defer_loading ?? true;

              const { definition, executable } = adaptMcpTool(
                toolDef,
                serverName,
                isDeferred,
                async () => {
                  const entry = await this.getConnection(serverConfig, serverName);
                  return entry.client;
                },
                serverConfig.timeout ?? DEFAULT_TOOL_TIMEOUT_MS,
              );

              serverTools.push(definition);
              this.executableTools.set(definition.id, executable);
            }
            console.log(`\x1b[36m[Tool Search]\x1b[0m Connected MCP server "${serverName}" — loaded ${serverTools.length} tool(s).`);
          } catch (err) {
            console.warn(`\x1b[33m[Tool Search]\x1b[0m Failed connecting MCP server "${serverName}": ${err instanceof Error ? err.message : String(err)}`);
          }
          return serverTools;
        })();

        const winner = await withTimeout(work, deadline, this.activeTimers);
        if (winner !== null) {
          // WORK WON the race: propagate this server's tools NOW. (The
          // deadline-winner path appends nothing.)
          if (winner.length > 0) {
            this.tools.push(...winner);
            this.notifyListeners();
          }
        } else {
          // CEILING CUT: the server did not settle within its deadline. Cut it
          // (contributes no tools) and warn loudly so the operator knows why
          // its tools are unavailable this session.
          console.warn(
            `[McpToolProvider] MCP server "${serverName}" did not settle within ${deadline}ms — cutting it; its tools are unavailable this session.`,
          );
        }
        return winner ?? [];
      });

      // Bound warmUpPromise's settle: every task settles by construction (the
      // per-server work is raced against its deadline), so this aggregate
      // always resolves. Per-server propagation happened in the winner's flow.
      await Promise.allSettled(serverTasks);

      return [...this.tools];
    })();
    return this.warmUpPromise;
  }

  async awaitReady(timeoutMs = 1500): Promise<boolean> {
    if (!this.warmUpPromise) {
      // Nothing to warm up — this provider is ready (vacuously).
      return true;
    }
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const timeoutTimer = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
    });

    try {
      await Promise.race([
        this.warmUpPromise.then(() => {}, () => {}),
        timeoutTimer,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    // true = warm-up won the race (ready); false = the timer won (still warming).
    return !timedOut;
  }

  getTools(): ToolDefinition[] {
    return this.tools;
  }

  getExecutableTools(): Record<string, ReturnType<typeof tool>> {
    const result: Record<string, ReturnType<typeof tool>> = {};
    for (const [id, t] of this.executableTools.entries()) {
      result[id] = t;
    }
    return result;
  }

  getExecutableTool(id: string): ReturnType<typeof tool> | undefined {
    const direct = this.executableTools.get(id);
    if (direct) return direct;
    const normalized = id.replace(/[-_]/g, '_');
    for (const [key, t] of this.executableTools.entries()) {
      if (key.replace(/[-_]/g, '_') === normalized) return t;
    }
    for (const [key, t] of this.executableTools.entries()) {
      if (key.endsWith(`_${id}`) || key.endsWith(`-${id}`)) return t;
    }
    return undefined;
  }

  hasExecutableTool(id: string): boolean {
    return Boolean(this.getExecutableTool(id));
  }

  getExecutableToolIds(): string[] {
    return Array.from(this.executableTools.keys());
  }

  onUpdate(callback: (tools: ToolDefinition[]) => void): void {
    this.listeners.push(callback);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.tools);
    }
  }

  async close(): Promise<void> {
    // Timer hygiene: clear any outstanding warm-up deadline timers so hung
    // servers cannot leave 10s handles holding the event loop after close.
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    await this.cache.clear();
  }
}
