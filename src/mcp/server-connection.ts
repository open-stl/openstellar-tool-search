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

  return { client, transport };
}

/**
 * Attaches a singleton transport interceptor that normalizes local $ref ($defs)
 * on tools/list responses without creating nested closure chains on repeat requests.
 */
export function attachMcpTransportInterceptor(transport: Transport): Transport {
  if (!transport || typeof transport !== 'object') return transport;

  const rawTransport = transport as unknown as { onmessage?: (msg: unknown) => void };
  let underlyingHandler = rawTransport.onmessage;

  Object.defineProperty(transport, 'onmessage', {
    get() {
      return underlyingHandler;
    },
    set(newHandler: ((msg: unknown) => void) | undefined) {
      if (!newHandler) {
        underlyingHandler = undefined;
        return;
      }
      underlyingHandler = function (response: unknown) {
        if (response && typeof response === 'object') {
          const resObj = response as { result?: { tools?: Array<{ inputSchema?: unknown; outputSchema?: unknown }> } };
          if (resObj.result && Array.isArray(resObj.result.tools)) {
            for (const t of resObj.result.tools) {
              try {
                if (t.inputSchema) t.inputSchema = inlineLocalReferences(t.inputSchema);
                if (t.outputSchema) t.outputSchema = inlineLocalReferences(t.outputSchema);
              } catch {
                // If schema inlining fails for deeply complex/circular schemas, proceed with raw schema
              }
            }
          }
        }
        return newHandler(response);
      };
    },
    configurable: true,
    enumerable: true,
  });

  return transport;
}
