import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RemoteMcpServerConfig } from '../types.js';
import type { Transport, TransportConnector } from '../transport-factory.js';

export class RemoteTransportConnector implements TransportConnector<RemoteMcpServerConfig> {
  async connect(server: RemoteMcpServerConfig, client: Client): Promise<Transport> {
    const transportOpts = server.headers
      ? { requestInit: { headers: server.headers } as RequestInit }
      : undefined;

    const transport = new StreamableHTTPClientTransport(new URL(server.url), transportOpts);
    const handshakeTimeout = server.timeout;

    try {
      await client.connect(transport, handshakeTimeout ? { timeout: handshakeTimeout } : undefined);
      return transport;
    } catch (err) {
      await this.closeTransport(transport);
      throw err;
    }
  }

  private async closeTransport(transport: Transport): Promise<void> {
    try {
      await Promise.resolve(transport.close());
    } catch {
      // best-effort cleanup
    }
  }
}
