import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  McpToolProvider,
  isServerEnabled,
} from '../src/mcp/mcp-tool-provider.js';
import {
  TransportFactory,
  type Transport,
  type TransportConnector,
} from '../src/mcp/transport-factory.js';
import { LocalTransportConnector } from '../src/mcp/transports/local-transport.js';
import {
  createMcpConnection,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
} from '../src/mcp/server-connection.js';
import {
  convertMcpTool,
  sanitizeToolId,
  AdapterCache,
  type ServerCacheEntry,
} from '../src/mcp/mcp-tool-adapter.js';
import { parseMcpConfig, _resetMcpExitHandlerForTesting } from '../src/hooks/mcp-wiring.js';
import type { LocalMcpServerConfig, RemoteMcpServerConfig } from '../src/mcp/types.js';

// ============================================================================
// MCP Config Parsing & Utilities
// ============================================================================

describe('MCP Config Parsing & Utilities', () => {
  it('parses valid v2 MCP config wrapped in servers', () => {
    const validConfig = {
      servers: {
        server1: {
          name: 'server1',
          type: 'remote' as const,
          url: 'https://example.com/mcp',
        },
      },
    };
    const parsed = parseMcpConfig(validConfig);
    expect(parsed).toEqual(validConfig.servers);

    // Bare map and arrays are rejected per v2 policy
    expect(parseMcpConfig({ server1: { type: 'remote' } })).toBeUndefined();
    expect(parseMcpConfig([{ name: 'server1' }])).toBeUndefined();
    expect(parseMcpConfig(null)).toBeUndefined();
    expect(parseMcpConfig(undefined)).toBeUndefined();
    expect(parseMcpConfig({})).toBeUndefined();
  });

  it('evaluates server enabled status correctly', () => {
    expect(isServerEnabled({ name: 'srv', type: 'local', command: ['node'] })).toBe(true);
    expect(isServerEnabled({ name: 'srv', type: 'local', command: ['node'], enabled: true })).toBe(true);
    expect(isServerEnabled({ name: 'srv', type: 'local', command: ['node'], enabled: false })).toBe(false);
    expect(isServerEnabled({ name: 'srv', type: 'local', command: ['node'], disabled: true })).toBe(false);
    expect(isServerEnabled({ name: 'srv', type: 'local', command: ['node'], disabled: false })).toBe(true);
  });

  it('sanitizes tool IDs without redundant prefixes', () => {
    expect(sanitizeToolId('github', 'create_issue')).toBe('github_create_issue');
    expect(sanitizeToolId('github', 'github_create_issue')).toBe('github_create_issue');
    expect(sanitizeToolId('github', 'github-search')).toBe('github-search');
  });
});

// ============================================================================
// Transports & Transport Factory
// ============================================================================

describe('Transports & TransportFactory', () => {
  it('registers and connects transports by server type', async () => {
    const factory = new TransportFactory();
    const mockTransport: Transport = { close: vi.fn() };
    const mockConnector: TransportConnector<RemoteMcpServerConfig> = {
      connect: vi.fn().mockResolvedValue(mockTransport),
    };

    factory.register('remote', mockConnector);
    expect(factory.getSupportedTypes()).toContain('remote');

    const client = {} as any;
    const server: RemoteMcpServerConfig = { name: 'test', type: 'remote', url: 'https://example.com' };
    const connected = await factory.connect(server, client);

    expect(connected).toBe(mockTransport);
    expect(mockConnector.connect).toHaveBeenCalledWith(server, client);
  });

  it('throws error when connecting with unsupported transport type', async () => {
    const factory = new TransportFactory();
    const server = { name: 'unknown', type: 'custom_unsupported' } as any;
    await expect(factory.connect(server, {} as any)).rejects.toThrow(
      'No transport connector registered for type: custom_unsupported',
    );
  });

  it('LocalTransportConnector rejects empty command array', async () => {
    const connector = new LocalTransportConnector();
    const server: LocalMcpServerConfig = { name: 'empty', type: 'local', command: [] };
    await expect(connector.connect(server, {} as any)).rejects.toThrow(
      'Invalid local server config: empty - command array is empty',
    );
  });

  it('LocalTransportConnector captures stderr stream up to buffer limit', () => {
    const connector = new LocalTransportConnector();
    const emitter = new EventEmitter() as any;
    const getTrace = connector.captureStderr(emitter);

    emitter.emit('data', Buffer.from('Error line 1\n'));
    emitter.emit('data', 'Error line 2\n');

    const trace = getTrace();
    expect(trace).toContain('Error line 1');
    expect(trace).toContain('Error line 2');
  });
});

// ============================================================================
// MCP Connection & Provider Lifecycle
// ============================================================================

describe('MCP Connection & Provider Lifecycle', () => {
  beforeEach(() => {
    _resetMcpExitHandlerForTesting();
  });

  it('createMcpConnection constructs client with metadata and connects', async () => {
    const mockTransport: Transport = { close: vi.fn() };
    let capturedClient: any;
    const connectFn = vi.fn().mockImplementation(async (_server, client) => {
      capturedClient = client;
      return mockTransport;
    });

    const server: RemoteMcpServerConfig = { name: 'srv', type: 'remote', url: 'https://example.com' };
    const conn = await createMcpConnection(server, connectFn);

    expect(conn.transport).toBe(mockTransport);
    expect(conn.client).toBeDefined();
    expect(capturedClient).toBeDefined();
    expect(capturedClient._clientInfo.name).toBe(MCP_CLIENT_NAME);
    expect(capturedClient._clientInfo.version).toBe(MCP_CLIENT_VERSION);
  });

  it('McpToolProvider warms up and notifies listener on update', async () => {
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'tool_1',
            description: 'Tool one description',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          },
        ],
      }),
    };

    const mockCache = new AdapterCache();
    const mockFactory = new TransportFactory();
    mockFactory.register('remote', {
      connect: vi.fn().mockResolvedValue({ close: vi.fn() }),
    });

    const provider = new McpToolProvider(
      [{ name: 'test_srv', type: 'remote', url: 'https://example.com' }],
      mockCache,
      mockFactory,
      1000,
    );

    // Mock getConnection internally through cache
    vi.spyOn(mockCache, 'getOrCreate').mockResolvedValue({
      client: mockClient as any,
      transport: { close: vi.fn() },
      tools: {},
    });

    const updateSpy = vi.fn();
    provider.onUpdate(updateSpy);

    const tools = await provider.warmUp();
    expect(tools.length).toBe(1);
    expect(tools[0].id).toBe('test_srv_tool_1');
    expect(updateSpy).toHaveBeenCalledWith(tools);
    expect(provider.getTools()).toHaveLength(1);
  });

  it('McpToolProvider awaitReady resolves when warmup completes', async () => {
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'fast_tool', description: 'Fast tool' }],
      }),
    };

    const mockCache = new AdapterCache();
    const mockFactory = new TransportFactory();
    mockFactory.register('remote', {
      connect: vi.fn().mockResolvedValue({ close: vi.fn() }),
    });

    const provider = new McpToolProvider(
      [{ name: 'srv', type: 'remote', url: 'https://example.com' }],
      mockCache,
      mockFactory,
      1000,
    );

    vi.spyOn(mockCache, 'getOrCreate').mockResolvedValue({
      client: mockClient as any,
      transport: { close: vi.fn() },
      tools: {},
    });

    const warmPromise = provider.warmUp();
    const ready = await provider.awaitReady(2000);

    expect(ready).toBe(true);
    await warmPromise;
    expect(provider.getTools()).toHaveLength(1);
  });

  it('isolates errors from failing MCP servers without breaking others', async () => {
    const mockClientGood = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'good_tool', description: 'Good tool' }],
      }),
    };
    const mockClientBad = {
      listTools: vi.fn().mockRejectedValue(new Error('Connection failed')),
    };

    const mockCache = new AdapterCache();
    const mockFactory = new TransportFactory();
    mockFactory.register('remote', {
      connect: vi.fn().mockResolvedValue({ close: vi.fn() }),
    });

    const provider = new McpToolProvider(
      [
        { name: 'good_srv', type: 'remote', url: 'https://good.example.com' },
        { name: 'bad_srv', type: 'remote', url: 'https://bad.example.com' },
      ],
      mockCache,
      mockFactory,
      1000,
    );

    vi.spyOn(mockCache, 'getOrCreate').mockImplementation(async (key) => {
      if (key.includes('good_srv')) {
        return { client: mockClientGood as any, transport: { close: vi.fn() }, tools: {} };
      }
      return { client: mockClientBad as any, transport: { close: vi.fn() }, tools: {} };
    });

    const tools = await provider.warmUp();
    expect(tools.length).toBe(1);
    expect(tools[0].id).toBe('good_srv_good_tool');
  });
});

// ============================================================================
// Tool Adapter & Execution
// ============================================================================

describe('Tool Adapter & Execution', () => {
  it('converts MCP tool and executes client callTool returning text output', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Operation succeeded' }],
      }),
    };

    const mcpDef = {
      name: 'echo',
      description: 'Echo message',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    };

    const adapted = convertMcpTool(mcpDef, mockClient as any);
    expect(adapted.description).toBe('Echo message');

    const result = await adapted.execute({ message: 'hello world' }, {} as any);
    expect(result).toBe('Operation succeeded');
    expect(mockClient.callTool).toHaveBeenCalledWith(
      { name: 'echo', arguments: { message: 'hello world' } },
      expect.anything(),
      expect.anything(),
    );
  });

  it('throws descriptive error on MCP tool failure response', async () => {
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'Disk full' }],
      }),
    };

    const adapted = convertMcpTool({ name: 'write_file' }, mockClient as any);
    await expect(adapted.execute({}, {} as any)).rejects.toThrow(
      'MCP tool "write_file" error: Disk full',
    );
  });

  it('AdapterCache reuses alive connection and clears cleanly', async () => {
    const cache = new AdapterCache();
    const closeSpy = vi.fn();
    const mockClient = { listTools: vi.fn().mockResolvedValue({ tools: [] }) };
    const entry: ServerCacheEntry = {
      client: mockClient as any,
      transport: { close: closeSpy },
      tools: {},
    };

    const created = await cache.getOrCreate('server-key', async () => entry);
    expect(created).toBe(entry);

    const reused = await cache.getOrCreate('server-key', async () => {
      throw new Error('Should not be called');
    });
    expect(reused).toBe(entry);

    await cache.clear();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(cache.get('server-key')).toBeUndefined();
  });
});
