import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { inlineLocalReferences } from '../../catalog/schema-normalize.js';
import type { RemoteMcpServerConfig } from '../types.js';
import type { Transport, TransportConnector } from '../transport-factory.js';
import { closeTransport } from './close-transport.js';

export class RemoteTransportConnector implements TransportConnector<RemoteMcpServerConfig> {
  async connect(server: RemoteMcpServerConfig, client: Client): Promise<Transport> {
    const transportOpts = server.headers
      ? { requestInit: { headers: server.headers } as RequestInit }
      : undefined;

    const transport = new StreamableHTTPClientTransport(new URL(server.url), transportOpts);
    const handshakeTimeout = server.timeout;

    // In-flight Transport Interceptor: sanitize & inline local $ref ($defs) in tools/list JSON RPC responses
    // BEFORE the MCP SDK's client._onresponse validator parses them. This solves external/nested $ref
    // resolution failures on servers like Google Stitch.
    const origSend = transport.send.bind(transport);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport.send = async function (message: any, options: any) {
      if (message && typeof message === 'object' && message.method === 'tools/list') {
        const origOnMessage = transport.onmessage;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transport.onmessage = function (response: any) {
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

    try {
      await client.connect(transport, handshakeTimeout ? { timeout: handshakeTimeout } : undefined);
      return transport;
    } catch (err) {
      await closeTransport(transport);
      throw err;
    }
  }
}
