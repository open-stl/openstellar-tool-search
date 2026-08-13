import { tool } from '@opencode-ai/plugin';
import type { ToolVault } from '../vault.js';
import type { SessionToolRegistry } from '../session-tool-registry.js';
import { McpToolProvider, isServerEnabled } from '../mcp/mcp-tool-provider.js';
import type { McpServerConfig } from '../mcp/types.js';

/**
 * Description for a warming-up server's placeholder tool. Echoes the
 * WARMING_MESSAGE vocabulary so the model knows the server's tools are not
 * available yet but WILL be — and to find them via tool_search when ready.
 */
function PLACEHOLDER_DESC(name: string): string {
  return `MCP server "${name}" is still starting up — its tools are not available yet. Retry in a few seconds; when ready, use tool_search to find them.`;
}

/** Response a placeholder tool returns when invoked (retry guidance; never throws). */
const SERVER_STARTING_RESPONSE =
  'This MCP server is still starting up. Its tools are not available yet — retry this call in a few seconds, or use tool_search to discover them once ready.';

/** Response when the placeholder's server settled with tools. */
const SERVER_READY_RESPONSE = (name: string) =>
  `MCP server "${name}" is ready — use tool_search to find its tools.`;

/** Response when the placeholder's server failed to start (deadline elapsed). */
const SERVER_FAILED_RESPONSE = (name: string) =>
  `MCP server "${name}" failed to start (no response within the timeout). Its tools are unavailable in this session.`;

/** Description for a placeholder whose server settled empty (cut/failed/no tools). */
const SERVER_FAILED_DESC = (name: string) =>
  `MCP server "${name}" failed to start (no response within the timeout). Its tools are unavailable in this session.`;

/**
 * MCP wiring for the plugin.
 *
 * Owns the single McpToolProvider instance, the process-exit cleanup
 * listeners, provider registration into the vault, and the executable-tool
 * bridge (which surfaces provider tools as OpenCode tools with their FULL
 * descriptions — deferral/truncation is the tool.definition hook's job, so
 * the catalog keeps the original description and tool_search returns it
 * intact). Repeated initialization attempts are idempotent — one provider
 * per plugin instance.
 *
 * WAIT-ALL PRE-WARM: opencode freezes the session tool-set at start (~0-2s),
 * so MCP tools must be in the bridge BEFORE the factory returns. `preWarm()`
 * awaits provider warm-up — every enabled server settles or is CUT at its
 * per-server timeout — then finalizes placeholders. Placeholders
 * are STATUS-ONLY (no forwarding): a placeholder's execute() reports ready /
 * still-starting / failed, never proxies to the MCP server.
 */
export class McpWiring {
  private provider: McpToolProvider | null = null;
  /** Placeholder tool ids (raw server names) registered while a server warms. */
  private placeholders = new Set<string>();
  private preWarmPromise: Promise<void> | null = null;

  public constructor(
    private readonly vault: ToolVault,
    private readonly sessionRegistry: SessionToolRegistry,
    private readonly tools: Record<string, ReturnType<typeof tool>>,
    private readonly timeout: number,
  ) {}

  public get isInitialized(): boolean {
    return this.provider !== null;
  }

  public init(mcpConfig: Record<string, McpServerConfig> | McpServerConfig[]): void {
    if (this.provider) return;
    // timeout is the PER-SERVER CEILING: each server must settle within it
    // or is cut (fail-open + console.warn). Wait-all means the factory returns
    // only after every server settled or was cut.
    const mcpProvider = new McpToolProvider(mcpConfig, undefined, undefined, this.timeout);
    // Registration is synchronous (the provider has no tools until warm-up
    // completes), so startup never awaits the MCP handshake.
    void this.vault.registerProvider(mcpProvider);
    this.provider = mcpProvider;

    // Register a placeholder tool for every ENABLED server BEFORE warm-up
    // kicks off. This is the slow-server visibility fix: the model's FIRST
    // system prompt (built ~0-2s) must see the server's name so it knows to
    // tool_search once warm-up lands. Placeholder id = raw server name —
    // collision-safe because sanitizeToolId always produces `<server>_<tool>`,
    // so a bare server name can never collide with a real tool id.
    this.registerPlaceholders(mcpConfig);

    // Subscribe to per-server propagation BEFORE warm-up kicks off. Each
    // notifyListeners (fired as each server settles) flows the server's tools
    // into the session registry and the executable-tool bridge immediately —
    // a hung server can no longer starve healthy servers' tools out of the
    // bridge (the previous post-await write could never run while any server
    // hung). Idempotent: store.add / registerTool dedupe, so repeated updates
    // are safe.
    mcpProvider.onUpdate((updatedTools) => this.handleProviderUpdate(updatedTools));

    const onExit = () => {
      mcpProvider.close().catch(() => {});
    };
    process.once('beforeExit', onExit);
    process.once('exit', onExit);
  }

  /**
   * Add a placeholder tool for each enabled server (same filter as the
   * provider — isServerEnabled, mcp-tool-provider.ts). Always-on (never
   * inflates deferredCount, never truncated) so it is visible immediately and
   * does not disturb deferral bookkeeping. The placeholder's execute() is a
   * STATUS READER (no forwarding): it reports ready / still-starting / failed
   * based on the provider's live tool set + readiness.
   */
  private registerPlaceholders(mcpConfig: Record<string, McpServerConfig> | McpServerConfig[]): void {
    const rawList = Array.isArray(mcpConfig)
      ? mcpConfig
      : Object.entries(mcpConfig).map(([name, cfg]) => ({ ...cfg, name: cfg.name ?? name }));
    const enabled = rawList.filter(isServerEnabled);
    for (const server of enabled) {
      const name = server.name ?? 'unnamed';
      if (this.placeholders.has(name)) continue;
      this.placeholders.add(name);
      const provider = this.provider;
      const placeholder = tool({
        description: PLACEHOLDER_DESC(name),
        args: {},
        async execute() {
          if (!provider) return SERVER_STARTING_RESPONSE;
          const hasTools = provider.getTools().some((t) => t.id.startsWith(`${name}_`));
          if (hasTools) return SERVER_READY_RESPONSE(name);
          const settled = await provider.awaitReady(0);
          if (settled) return SERVER_FAILED_RESPONSE(name);
          return SERVER_STARTING_RESPONSE;
        },
      });
      this.vault.add(name, PLACEHOLDER_DESC(name), {});
      this.sessionRegistry.addAlwaysOn(name);
      this.tools[name] = placeholder;
    }
  }

  /**
   * Finalize placeholders after pre-warm settle. For each tracked placeholder
   * (raw server name):
   *   - hasTools (provider has a tool id prefixed `${name}_`) → REMOVE the
   *     placeholder (real tools are already in the bridge via
   *     handleProviderUpdate — they settled pre-snapshot).
   *   - else (server settled empty — cut at ceiling, errored, or returned no
   *     tools) → KEEP the placeholder as a STATUS READER and RE-DESCRIBE it
   *     with the honest status text (failed-to-start / no tools), so the
   *     model's snapshot description is truthful, not "still starting up".
   *     It is the only stable entry point in the frozen session snapshot.
   */
  private async finalizePlaceholders(): Promise<void> {
    if (!this.provider) return;
    for (const id of Array.from(this.placeholders)) {
      const hasTools = this.provider.getTools().some((t) => t.id.startsWith(`${id}_`));
      if (hasTools) {
        delete this.tools[id];
        this.vault.remove(id);
        this.placeholders.delete(id);
        continue;
      }
      // Settled empty (or config-hook edge still warming): re-describe the
      // placeholder with the honest status. If still warming (awaitReady(0)
      // false — only possible via the config-hook path, since wait-all blocks
      // the factory), keep "still starting up"; otherwise the server is
      // settled-without-tools → failed/no-tools text. (If the provider lacks
      // awaitReady — e.g. a test mock — treat it as settled.)
      const settled = typeof this.provider.awaitReady === 'function'
        ? await this.provider.awaitReady(0)
        : true;
      const statusDesc = settled ? SERVER_FAILED_DESC(id) : PLACEHOLDER_DESC(id);
      if (this.tools[id]) {
        this.tools[id].description = statusDesc;
      }
    }
  }

  /**
   * Surface provider tools into the session registry and the executable-tool
   * bridge. Shared by the per-server onUpdate handler and the post-warm-up
   * final write (the return value of warmUp() still carries the full list).
   *
   * Description OWNERSHIP: the bridge carries the ORIGINAL FULL description —
   * never a truncated one. OpenCode's `tool.definition` hook (plugin.ts) is
   * the single truncation point: it stores the full description in the
   * catalog (so tool_search returns it intact) and rewrites the OpenCode-
   * facing description to first sentence + deferral label. Pre-truncating
   * here would leak `[deferred]` into the catalog via that hook (the hook
   * re-fires with the already-truncated description and overwrites the stored
   * full one). Non-deferred (`deferred === false`) tools are always-on and
   * keep the full description end-to-end. Writes are idempotent, so repeated
   * invocations for the same tool are safe.
   */
  private handleProviderUpdate(providerTools: import('../tool-provider.js').ToolDefinition[]): void {
    this.sessionRegistry.registerProviderTools(providerTools);
    if (typeof this.provider?.getExecutableTools !== 'function') return;
    const execs = this.provider.getExecutableTools();
    for (const pt of providerTools) {
      const execTool = execs[pt.id];
      if (!execTool) continue;
      this.tools[pt.id] = execTool;
    }
  }

  /**
   * Belt-and-suspenders final write over the FULL provider tool list after
   * warm-up settle (per-server propagation already happened via onUpdate;
   * this covers any listener registered after the per-server updates fired).
   */
  private writeProviderTools(providerTools: import('../tool-provider.js').ToolDefinition[]): void {
    this.sessionRegistry.registerProviderTools(providerTools);
    this.handleProviderUpdate(providerTools);
  }

  /**
   * Wait for ALL enabled servers to settle (per-server timeout,
   * applied inside the provider), then finalize placeholders. No short factory
   * budget — the factory returns only after every server settled or was cut at
   * its timeout. Memoized — multiple callers (factory + config hook) share ONE
   * settle promise. Warm-up errors fail open (swallowed).
   */
  public preWarm(): Promise<void> {
    if (this.preWarmPromise) return this.preWarmPromise;
    const provider = this.provider;
    if (!provider) return Promise.resolve();
    this.preWarmPromise = (async () => {
      try {
        const providerTools = await provider.warmUp();
        if (providerTools) {
          this.writeProviderTools(providerTools);
        }
      } catch {
        // Fail open: a broken MCP server must never block the factory.
      } finally {
        await this.finalizePlaceholders();
      }
    })();
    return this.preWarmPromise;
  }
}

/**
 * Parse a raw `mcp` option (or config-hook value) into a server config map.
 *
 * Accepts ONLY the OpenCode v2 shape — `{ servers: { "<name>": {...} } }` —
 * matching opencode's native `mcp.servers` convention. Anything else is
 * rejected and returns `undefined`:
 *   - a BARE server map (`{ "my-server": {...} }`, the legacy v1/v2-mixed
 *     shape) is REJECTED with an explicit console.warn — this plugin follows
 *     opencode v2's `mcp.servers` wrapper and never silently unwraps legacy
 *     config;
 *   - arrays (the V1 array shape) are refused;
 *   - `null`, primitives, `{ servers: [...] }`, or a missing wrapper return
 *     `undefined` without a warning (ordinary invalid input, not a legacy
 *     migration case).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMcpConfig(raw: any): Record<string, McpServerConfig> | McpServerConfig[] | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  // A bare map has at least one server key but no `servers` wrapper — this is
  // the legacy shape. Reject it explicitly (do NOT unwrap) so users migrate
  // to v2. An empty object `{}` is ordinary invalid input, not a legacy map:
  // no warning.
  if (!('servers' in raw) && Object.keys(raw).length > 0) {
    console.warn(
      '[ToolSearchPlugin] Legacy bare-map MCP config is REJECTED: `mcp: { "<server>": {...} }` is no longer accepted. ' +
        'This plugin follows OpenCode v2\'s `mcp.servers` convention — use `mcp: { servers: { "<server>": {...} } }`.',
    );
    return undefined;
  }

  const servers = raw.servers;
  if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
    return servers as Record<string, McpServerConfig>;
  }
  return undefined;
}
