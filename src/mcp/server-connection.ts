import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { BaseServerConfig } from './types.js';
import type { Transport } from './transport-factory.js';

/**
 * Identity reported by the MCP client during protocol initialization.
 */
export const MCP_CLIENT_NAME = 'openstellar-tool-search';
export const MCP_CLIENT_VERSION = '1.0.0';

export interface McpConnection {
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
  const transport = await connect(server, client);
  return { client, transport };
}
