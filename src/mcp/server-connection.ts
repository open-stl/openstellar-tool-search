import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { inlineLocalReferences } from '../catalog/schema-normalize.js';
import type { BaseServerConfig } from './types.js';
import type { Transport } from './transport-factory.js';

/**
 * Identity reported by the MCP client during protocol initialization.
 */
export const MCP_CLIENT_NAME = 'openstellar-tool-search';
export const MCP_CLIENT_VERSION = '1.0.0';

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

  const transport = await connect(server, client);

  // Safely guard against transport wrapper mocks in test environments that lack transport.send
  if (transport && typeof (transport as unknown as Record<string, unknown>).send === 'function') {
    const rawTransport = transport as unknown as { send: (...args: unknown[]) => Promise<unknown>; onmessage?: (msg: unknown) => void };
    const origSend = rawTransport.send.bind(rawTransport);
    rawTransport.send = async function (message: unknown, options: unknown) {
      if (message && typeof message === 'object' && (message as { method?: string }).method === 'tools/list') {
        const origOnMessage = rawTransport.onmessage;
        rawTransport.onmessage = function (response: unknown) {
          if (response && typeof response === 'object') {
            const resObj = response as { result?: { tools?: Array<{ inputSchema?: unknown; outputSchema?: unknown }> } };
            if (resObj.result && Array.isArray(resObj.result.tools)) {
              for (const t of resObj.result.tools) {
                if (t.inputSchema) t.inputSchema = inlineLocalReferences(t.inputSchema);
                if (t.outputSchema) t.outputSchema = inlineLocalReferences(t.outputSchema);
              }
            }
          }
          if (origOnMessage) origOnMessage(response);
        };
      }
      return origSend(message, options);
    };
  }

  return { client, transport };
}
