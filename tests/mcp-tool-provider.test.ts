import { describe, it, expect, vi } from 'vitest';
import { McpToolProvider, sanitizeToolId } from '../src/mcp/mcp-tool-provider.js';
import type { TransportFactory, Transport } from '../src/mcp/transport-factory.js';
import type { AdapterCache } from '../src/mcp/adapter-cache.js';

describe('McpToolProvider', () => {
  it('sanitizes and deduplicates tool names', () => {
    expect(sanitizeToolId('notion', 'search')).toBe('notion_search');
    expect(sanitizeToolId('notion', 'notion_search')).toBe('notion_search');
    expect(sanitizeToolId('notion', 'notion-search')).toBe('notion-search');
    expect(sanitizeToolId('github', 'create_issue')).toBe('github_create_issue');
  });

  it('fetches tools from configured MCP servers and assigns deferred status', async () => {
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'query_docs', description: 'Query docs', inputSchema: { type: 'object' } },
        ],
      }),
    };

    const mockFactory: Partial<TransportFactory> = {
      register: vi.fn(),
      connect: vi.fn().mockResolvedValue({ close: () => {} } as Transport),
    };

    const mockCache: Partial<AdapterCache> = {
      getServerKey: vi.fn().mockReturnValue('key1'),
      getOrCreate: vi.fn().mockImplementation(async (_key, creator) => {
        await creator();
        return { client: mockClient as any, transport: { close: () => {} } as Transport, tools: {} };
      }),
    };

    const provider = new McpToolProvider(
      {
        context7: { type: 'remote', url: 'http://localhost:8080/sse', defer_loading: true },
        local_db: { type: 'local', command: ['node', 'server.js'], defer_loading: false },
      },
      mockCache as AdapterCache,
      mockFactory as TransportFactory,
    );

    const tools = await provider.warmUp();

    expect(tools.length).toBe(2);
    const context7Tool = tools.find((t) => t.id === 'context7_query_docs');
    const localDbTool = tools.find((t) => t.id === 'local_db_query_docs');

    expect(context7Tool?.deferred).toBe(true);
    expect(localDbTool?.deferred).toBe(false);
  });

  it('notifies onUpdate listeners when tools are warmed up', async () => {
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'ping', description: 'Ping server' }],
      }),
    };

    const mockFactory: Partial<TransportFactory> = {
      register: vi.fn(),
      connect: vi.fn().mockResolvedValue({ close: () => {} } as Transport),
    };

    const mockCache: Partial<AdapterCache> = {
      getServerKey: vi.fn().mockReturnValue('key1'),
      getOrCreate: vi.fn().mockResolvedValue({
        client: mockClient as any,
        transport: { close: () => {} } as Transport,
        tools: {},
      }),
    };

    const provider = new McpToolProvider(
      [{ name: 'srv', type: 'remote', url: 'http://localhost:8080' }],
      mockCache as AdapterCache,
      mockFactory as TransportFactory,
    );

    const onUpdateFn = vi.fn();
    provider.onUpdate(onUpdateFn);

    await provider.warmUp();

    expect(onUpdateFn).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'srv_ping', deferred: true }),
      ]),
    );
  });

  it('warms up multiple servers concurrently in max single-server time', async () => {
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'test_tool', description: 'Test' }],
      }),
    };

    const mockFactory: Partial<TransportFactory> = {
      register: vi.fn(),
      connect: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 40));
        return { close: () => {} } as Transport;
      }),
    };

    const mockCache: Partial<AdapterCache> = {
      getServerKey: vi.fn((s) => s.name),
      getOrCreate: vi.fn().mockImplementation(async (_key, creator) => {
        const entry = await creator();
        return { ...entry, client: mockClient as any };
      }),
    };

    const provider = new McpToolProvider(
      {
        srv1: { type: 'remote', url: 'http://localhost:8081' },
        srv2: { type: 'remote', url: 'http://localhost:8082' },
        srv3: { type: 'remote', url: 'http://localhost:8083' },
      },
      mockCache as AdapterCache,
      mockFactory as TransportFactory,
    );

    const start = Date.now();
    const tools = await provider.warmUp();
    const duration = Date.now() - start;

    expect(tools.length).toBe(3);
    // Concurrently 3 x 40ms should finish in < 100ms (not sequential 120ms+)
    expect(duration).toBeLessThan(110);
  });

  it('isolates failures when a server fails to connect and returns healthy tools', async () => {
    const mockFactory: Partial<TransportFactory> = {
      register: vi.fn(),
      connect: vi.fn().mockImplementation(async (cfg) => {
        if (cfg.name === 'bad_srv') {
          throw new Error('ECONNREFUSED');
        }
        return { close: () => {} } as Transport;
      }),
    };

    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'healthy_tool', description: 'Healthy' }],
      }),
    };

    const mockCache: Partial<AdapterCache> = {
      getServerKey: vi.fn((s) => s.name),
      getOrCreate: vi.fn().mockImplementation(async (_key, creator) => {
        const entry = await creator();
        return { ...entry, client: mockClient as any };
      }),
    };

    const provider = new McpToolProvider(
      {
        good_srv: { type: 'remote', url: 'http://localhost:8081' },
        bad_srv: { type: 'remote', url: 'http://localhost:8082' },
      },
      mockCache as AdapterCache,
      mockFactory as TransportFactory,
    );

    const tools = await provider.warmUp();
    expect(tools.length).toBe(1);
    expect(tools[0].id).toBe('good_srv_healthy_tool');
  });
});
