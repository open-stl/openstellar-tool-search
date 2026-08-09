import { describe, it, expect, vi } from 'vitest';
import {
  createMcpConnection,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
} from '../src/mcp/server-connection.js';
import type { Transport } from '../src/mcp/transport-factory.js';

describe('createMcpConnection', () => {
  it('constructs the MCP client and connects through the factory', async () => {
    const clientIds: { name: string; version: string }[] = [];
    const mockTransport = { close: vi.fn() };

    const connect = vi.fn().mockImplementation(async (_server: unknown, client: any) => {
      // Capture the identity the client carries so we can assert it
      // without reaching into SDK internals.
      clientIds.push({ name: client._clientInfo?.name, version: client._clientInfo?.version });
      return mockTransport;
    });

    const server = { type: 'remote', url: 'http://localhost:8080' } as const;
    const connection = await createMcpConnection(server, connect as any);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(server, connection.client);
    expect(connection.client).toBeDefined();
    expect(connection.client.listTools).toBeTypeOf('function');
    expect(connection.transport).toBe(mockTransport);

    // Client carries the expected identity used during protocol init.
    expect(clientIds).toEqual([
      { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    ]);
  });

  it('propagates connect failures and never returns a partial connection', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      createMcpConnection(
        { type: 'local', command: ['node', 'server.js'] } as const,
        connect as any,
      ),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
