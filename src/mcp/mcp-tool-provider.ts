import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolProvider, ToolDefinition } from '../tool-provider.js';
import type { McpServerConfig } from './types.js';
import { AdapterCache } from './adapter-cache.js';
import { TransportFactory } from './transport-factory.js';
import { LocalTransportConnector } from './transports/local-transport.js';
import { RemoteTransportConnector } from './transports/remote-transport.js';

export function sanitizeToolId(serverName: string, toolName: string): string {
  const cleanServer = serverName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTool = toolName.toLowerCase();
  if (cleanTool.startsWith(cleanServer + '_') || cleanTool.startsWith(cleanServer + '-')) {
    return toolName;
  }
  return `${serverName}_${toolName}`;
}

export class McpToolProvider implements ToolProvider {
  private servers: McpServerConfig[];
  private cache: AdapterCache;
  private factory: TransportFactory;
  private tools: ToolDefinition[] = [];
  private listeners: ((tools: ToolDefinition[]) => void)[] = [];

  constructor(
    servers: Record<string, McpServerConfig> | McpServerConfig[],
    cache = new AdapterCache(),
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

  async warmUp(): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = [];

    for (const serverConfig of this.servers) {
      const serverName = serverConfig.name ?? 'unnamed';
      try {
        const client = new Client(
          { name: 'openstellar-tool-search', version: '1.0.0' },
          { capabilities: {} },
        );
        const serverKey = this.cache.getServerKey({ ...serverConfig, name: serverName });

        const cacheEntry = await this.cache.getOrCreate(serverKey, async () => {
          const transport = await this.factory.connect({ ...serverConfig, name: serverName }, client);
          return { tools: {}, transport, client };
        });

        const mcpToolsResult = await cacheEntry.client.listTools();

        for (const toolDef of mcpToolsResult.tools) {
          const isDeferred = serverConfig.defer_loading ?? serverConfig.deferred ?? true;
          const toolId = sanitizeToolId(serverName, toolDef.name);

          allTools.push({
            id: toolId,
            description: toolDef.description ?? '',
            parameters: toolDef.inputSchema ?? {},
            deferred: isDeferred,
          });
        }
      } catch (err) {
        // Log warning and continue with remaining servers
        console.warn(`[McpToolProvider] Failed to initialize server ${serverName}:`, err);
      }
    }

    this.tools = allTools;
    this.notifyListeners();
    return this.tools;
  }

  getTools(): ToolDefinition[] {
    return this.tools;
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
