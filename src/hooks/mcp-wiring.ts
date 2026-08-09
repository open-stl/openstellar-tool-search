import type { tool } from '@opencode-ai/plugin';
import type { ToolVault } from '../vault.js';
import type { SessionToolRegistry } from '../session-tool-registry.js';
import { McpToolProvider } from '../mcp/mcp-tool-provider.js';
import type { McpServerConfig } from '../mcp/types.js';
import { truncateDescription } from './deferral.js';

/**
 * MCP wiring for the plugin.
 *
 * Owns the single McpToolProvider instance, the process-exit cleanup
 * listeners, provider registration into the vault, and the executable-tool
 * bridge (which surfaces provider tools as OpenCode tools, deferring their
 * descriptions like static tools). Repeated initialization attempts are
 * idempotent — one provider per plugin instance.
 */
export class McpWiring {
  private provider: McpToolProvider | null = null;

  public constructor(
    private readonly vault: ToolVault,
    private readonly sessionRegistry: SessionToolRegistry,
    private readonly tools: Record<string, ReturnType<typeof tool>>,
    private readonly deferLabel: string,
  ) {}

  public get isInitialized(): boolean {
    return this.provider !== null;
  }

  public async init(mcpConfig: Record<string, McpServerConfig> | McpServerConfig[]): Promise<void> {
    if (this.provider) return;
    const mcpProvider = new McpToolProvider(mcpConfig);
    await this.vault.registerProvider(mcpProvider);
    this.provider = mcpProvider;

    const onExit = () => {
      mcpProvider.close().catch(() => {});
    };
    process.once('beforeExit', onExit);
    process.once('exit', onExit);

    try {
      await mcpProvider.warmUp();
      const providerTools = mcpProvider.getTools();
      this.sessionRegistry.registerProviderTools(providerTools);
      if (typeof mcpProvider.getExecutableTools === 'function') {
        const execs = mcpProvider.getExecutableTools();
        for (const pt of providerTools) {
          const execTool = execs[pt.id];
          if (execTool) {
            if (pt.deferred !== false) {
              this.sessionRegistry.registerTool(pt.id);
              execTool.description = truncateDescription(pt.description, this.deferLabel);
            }
            this.tools[pt.id] = execTool;
          }
        }
      }
    } catch (err: unknown) {
      console.warn('[ToolSearchPlugin] Background MCP warm-up error:', err);
    }
  }
}

/**
 * Normalize a raw `mcp` option (or config-hook value) into a server config:
 * accepts the V2 `{ servers: {...} }` wrapper or a bare server map, and
 * rejects non-object values — including arrays, which are explicitly refused
 * (the V1 array shape is not supported).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMcpConfig(raw: any): Record<string, McpServerConfig> | McpServerConfig[] | undefined {
  const servers = raw?.servers ?? raw;
  if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
    return servers as Record<string, McpServerConfig>;
  }
  return undefined;
}
