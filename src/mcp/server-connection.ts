import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BaseServerConfig } from './types.js';
import type { Transport } from './transport-factory.js';

/**
 * Identity reported by the MCP client during protocol initialization.
 */
export const MCP_CLIENT_NAME = 'openstellar-tool-search';
export const MCP_CLIENT_VERSION = '1.0.0';

const AnyPassthroughSchema = z.object({}).passthrough();

interface McpConnection {
  client: Client;
  transport: Transport;
}

/**
 * Establishes an MCP client connection for a server config.
 *
 * Owns MCP client construction and the connect handshake so both callers
 * (provider warm-up and the executable-tool client getter) share one path.
 * The client is intentionally constructed fresh for every call; connection
 * reuse and deduplication is the cache's responsibility, not this module's.
 *
 * @param server Server config handed to the connector unchanged.
 * @param connect Connects a transport for the server using the given client.
 */
export async function createMcpConnection<T extends BaseServerConfig>(
  server: T,
  connect: (server: T, client: Client) => Promise<Transport>,
): Promise<McpConnection> {
  const client = new Client(
    { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    { capabilities: {} },
  );

  // Bypass rigid AJV validation on tools/list responses when servers use external $ref ($defs)
  const origRequest = client.request.bind(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.request = function (request: any, schema: any, options: any) {
    if (schema === ListToolsResultSchema) {
      return origRequest(request, AnyPassthroughSchema, options);
    }
    return origRequest(request, schema, options);
  };

  const transport = await connect(server, client);
  return { client, transport };
}
