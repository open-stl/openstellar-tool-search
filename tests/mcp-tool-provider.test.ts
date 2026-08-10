import { describe, it, expect, vi } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { McpToolProvider, DEFAULT_WARMUP_TIMEOUT_MS, sanitizeToolId } from '../src/mcp/mcp-tool-provider.js';
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
    expect(duration).toBeLessThan(150);
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

  it('settles a hung server at the warm-up deadline and reports ready afterwards', async () => {
    // A hung server's listTools never resolves. With the injected SHORT
    // deadline (500ms), warmUpPromise must STILL settle (deadline = fail-open)
    // and awaitReady must flip false → true: the warming message is a bounded
    // transient, and once the deadline elapses the honest negative returns.
    const SHORT_DEADLINE_MS = 500;

    const mockClient = {
      listTools: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
    };

    const mockCache: Partial<AdapterCache> = {
      getServerKey: vi.fn().mockReturnValue('srv_key'),
      getOrCreate: vi.fn().mockResolvedValue({
        client: mockClient as any,
        transport: { close: () => {} } as Transport,
        tools: {},
      }),
    };

    const mockFactory: Partial<TransportFactory> = {
      register: vi.fn(),
      connect: vi.fn().mockResolvedValue({ close: () => {} } as Transport),
    };

    const provider = new McpToolProvider(
      [{ name: 'hung_srv', type: 'remote', url: 'http://localhost:8080' }],
      mockCache as AdapterCache,
      mockFactory as TransportFactory,
      SHORT_DEADLINE_MS,
    );

    // Before the deadline: still warming (awaitReady reports false).
    const warmUpPromise = provider.warmUp();
    const beforeReady = await provider.awaitReady(50);
    expect(beforeReady).toBe(false);

    // After the deadline elapses: warmUpPromise settles, awaitReady → true.
    await warmUpPromise;
    await sleep(SHORT_DEADLINE_MS + 100);
    const afterReady = await provider.awaitReady(0);
    expect(afterReady).toBe(true);
    // The hung server contributed no tools, but the provider is now settled.
    expect(provider.getTools()).toHaveLength(0);

    // Default deadline stays above the search executors' combined budget
    // (2s+3s) so a genuinely warming server is still reported as warming.
    expect(DEFAULT_WARMUP_TIMEOUT_MS).toBeGreaterThan(5000);
    // New default is 60s (per-server ceiling; wait-all factory).
    expect(DEFAULT_WARMUP_TIMEOUT_MS).toBe(60_000);
  });

  it('cuts a server at its ceiling with a console.warn naming it; fast server still propagates', async () => {
    // Two servers: one fast (answers ~20ms), one cut (answers after the 500ms
    // injected ceiling). The cut server must settle with NO tools, emit a
    // console.warn naming it, and the fast server's tools must still land.
    const SHORT_CEILING_MS = 500;

    const fastClient = {
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'fast_tool', description: 'Fast' }] }),
    };
    const slowClient = {
      listTools: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves → cut at ceiling
    };

    const mockFactory: Partial<TransportFactory> = {
      register: vi.fn(),
      connect: vi.fn().mockResolvedValue({ close: () => {} } as Transport),
    };

    const mockCache: Partial<AdapterCache> = {
      getServerKey: vi.fn((s: any) => s.name),
      getOrCreate: vi.fn().mockImplementation(async (key: string, creator: () => Promise<any>) => {
        const entry = await creator();
        if (key === 'fast_srv') return { ...entry, client: fastClient as any };
        return { ...entry, client: slowClient as any };
      }),
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const provider = new McpToolProvider(
      {
        fast_srv: { type: 'remote', url: 'http://localhost:8081' },
        cut_srv: { type: 'remote', url: 'http://localhost:8082' },
      },
      mockCache as AdapterCache,
      mockFactory as TransportFactory,
      SHORT_CEILING_MS,
    );

    const start = Date.now();
    const tools = await provider.warmUp();
    const elapsed = Date.now() - start;

    // Settles ≈ the ceiling (the cut server's deadline bounds the aggregate).
    expect(elapsed).toBeGreaterThanOrEqual(SHORT_CEILING_MS * 0.75);
    expect(elapsed).toBeLessThan(2000);
    // Fast server's tools propagate; cut server contributes none.
    expect(tools.map((t) => t.id)).toContain('fast_srv_fast_tool');
    expect(tools.some((t) => t.id.startsWith('cut_srv_'))).toBe(false);
    // console.warn called once, naming the cut server.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('cut_srv');
    expect(warnSpy.mock.calls[0][0]).toContain('did not settle');
    warnSpy.mockRestore();
  });
});
