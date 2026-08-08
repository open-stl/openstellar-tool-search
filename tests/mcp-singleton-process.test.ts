import { describe, it, expect, vi } from 'vitest';
import { McpToolProvider } from '../src/mcp/mcp-tool-provider.js';
import { globalAdapterCache } from '../src/mcp/adapter-cache.js';

describe('MCP Process Deduplication & Shared Global Cache', () => {
  it('reuses the same running MCP transport across multiple McpToolProvider instances without re-spawning processes', async () => {
    let connectCallCount = 0;
    const mockTransport = { close: vi.fn() };
    const mockClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'ping', description: 'Ping' }],
      }),
    };

    const mockFactory = {
      register: vi.fn(),
      connect: vi.fn().mockImplementation(async (_cfg, client: any) => {
        connectCallCount++;
        client.listTools = mockClient.listTools;
        return mockTransport;
      }),
    };

    // Subagent 1 creates a provider
    const provider1 = new McpToolProvider(
      { test_server: { type: 'local', command: ['echo'] } },
      globalAdapterCache,
      mockFactory as any,
    );

    // Subagent 2 creates another provider with the exact same config
    const provider2 = new McpToolProvider(
      { test_server: { type: 'local', command: ['echo'] } },
      globalAdapterCache,
      mockFactory as any,
    );

    await provider1.warmUp();
    await provider2.warmUp();

    // Transport should be connected ONLY ONCE
    expect(connectCallCount).toBe(1);
    expect(mockClient.listTools).toHaveBeenCalled();

    // Clean up
    await globalAdapterCache.clear();
  });
});
