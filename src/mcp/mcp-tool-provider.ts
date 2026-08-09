import type { tool } from '@opencode-ai/plugin';
import type { ToolProvider, ToolDefinition } from '../tool-provider.js';
import type { McpServerConfig } from './types.js';
import type { ServerCacheEntry } from './adapter-cache.js';
import { AdapterCache, globalAdapterCache } from './adapter-cache.js';
import { TransportFactory } from './transport-factory.js';
import { LocalTransportConnector } from './transports/local-transport.js';
import { RemoteTransportConnector } from './transports/remote-transport.js';
import { createMcpConnection } from './server-connection.js';
import { adaptMcpTool, sanitizeToolId } from './mcp-tool-adapter.js';

export { sanitizeToolId } from './mcp-tool-adapter.js';

const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const UNNAMED_SERVER = 'unnamed';

export class McpToolProvider implements ToolProvider {
  private servers: McpServerConfig[];
  private cache: AdapterCache;
  private factory: TransportFactory;
  private tools: ToolDefinition[] = [];
  private executableTools = new Map<string, ReturnType<typeof tool>>();
  private listeners: ((tools: ToolDefinition[]) => void)[] = [];
  private warmUpPromise: Promise<ToolDefinition[]> | null = null;

  constructor(
    servers: Record<string, McpServerConfig> | McpServerConfig[],
    cache = globalAdapterCache,
    factory = new TransportFactory(),
  ) {
    const rawList = Array.isArray(servers)
      ? servers
      : Object.entries(servers).map(([name, cfg]) => ({ ...cfg, name: cfg.name ?? name }));

    // Filter out servers marked disabled: true (V2) or enabled: false (V1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.servers = rawList.filter((s: any) => s.disabled !== true && s.enabled !== false);
    this.cache = cache;
    this.factory = factory;
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
        const serverTools: ToolDefinition[] = [];
        try {
          const cacheEntry = await this.getConnection(serverConfig, serverName);
          const mcpToolsResult = await cacheEntry.client.listTools();

          for (const toolDef of mcpToolsResult.tools) {
            const isDeferred = serverConfig.defer_loading ?? serverConfig.deferred ?? true;

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
        } catch (err) {
          // Log warning and continue with remaining servers
          console.warn(`[McpToolProvider] Failed to initialize server ${serverName}:`, err);
        }
        return serverTools;
      });

      const results = await Promise.allSettled(serverTasks);
      const allTools: ToolDefinition[] = [];
      for (const res of results) {
        if (res.status === 'fulfilled') {
          allTools.push(...res.value);
        }
      }

      this.tools = allTools;
      this.notifyListeners();
      return this.tools;
    })();
    return this.warmUpPromise;
  }

  async awaitReady(timeoutMs = 1500): Promise<void> {
    if (!this.warmUpPromise) {
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const timeoutTimer = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });

    try {
      await Promise.race([
        this.warmUpPromise.then(() => {}, () => {}),
        timeoutTimer,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
    await this.cache.clear();
  }
}
