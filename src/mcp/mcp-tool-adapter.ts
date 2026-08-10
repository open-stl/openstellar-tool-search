import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { tool } from '@opencode-ai/plugin';
import type { ToolDefinition } from '../tool-provider.js';
import { convertMcpTool } from './convert-mcp-tool.js';

/**
 * Builds a stable, namespaced tool ID for a server/tool pair.
 *
 * Existing tool names that already carry the server prefix keep their shape;
 * everything else is prefixed with the server name.
 */
export function sanitizeToolId(serverName: string, toolName: string): string {
  const cleanServer = serverName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTool = toolName.toLowerCase();
  if (cleanTool.startsWith(cleanServer + '_') || cleanTool.startsWith(cleanServer + '-')) {
    return toolName;
  }
  return `${serverName}_${toolName}`;
}

interface AdaptedMcpTool {
  definition: ToolDefinition;
  executable: ReturnType<typeof tool>;
}

interface McpToolSource {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Translates a single MCP tool into its openstellar ToolDefinition plus the
 * executable opencode tool backed by an MCP client.
 *
 * The client may be a live client or a getter (function) so the executable
 * can re-resolve the connection through the cache at call time.
 */
export function adaptMcpTool(
  mcpTool: McpToolSource,
  serverName: string,
  deferral: boolean,
  getClient: Client | (() => Promise<Client> | Client),
  timeoutMs: number,
): AdaptedMcpTool {
  const toolId = sanitizeToolId(serverName, mcpTool.name);

  return {
    definition: {
      id: toolId,
      description: mcpTool.description ?? '',
      parameters: mcpTool.inputSchema ?? {},
      deferred: deferral,
    },
    executable: convertMcpTool(
      {
        name: mcpTool.name,
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
      },
      getClient,
      timeoutMs,
    ),
  };
}
