import { describe, it, expect, vi } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import { parseMcpConfig } from '../src/hooks/mcp-wiring.js';
import type { PluginInput } from '@opencode-ai/plugin';

vi.mock('../src/mcp/mcp-tool-provider.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/mcp/mcp-tool-provider.js')>();
  return {
    ...mod,
    McpToolProvider: class MockMcpToolProvider {
      private tools = [
        { id: 'notion_search', description: 'Search Notion workspace', parameters: {}, deferred: true },
        { id: 'quick_calc', description: 'Quick calculator', parameters: {}, deferred: false },
      ];
      async warmUp() {
        return this.tools;
      }
      getTools() {
        return this.tools;
      }
      onUpdate(cb: any) {
        cb(this.tools);
      }
    },
  };
});

describe('Plugin MCP Wiring & Background Warm-up', () => {
  it('instantiates McpToolProvider when mcp option is provided', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {
      mcp: {
        notion: { type: 'remote', url: 'http://localhost:8080' },
      },
    });

    expect(hooks.tool).toHaveProperty('tool_search');
    expect(hooks.tool).toHaveProperty('tool_search_regex');
  });
});

describe('parseMcpConfig rejects invalid mcp shapes', () => {
  it('returns undefined for an array (V1 shape is refused)', () => {
    expect(
      parseMcpConfig([{ name: 'srv', type: 'remote', url: 'http://localhost:8080' }]),
    ).toBeUndefined();
  });

  it('returns undefined for an array wrapped in { servers: [...] }', () => {
    expect(
      parseMcpConfig({ servers: [{ name: 'srv', type: 'remote', url: 'http://localhost:8080' }] }),
    ).toBeUndefined();
  });

  it('accepts a bare server map', () => {
    const map = { srv: { type: 'remote', url: 'http://localhost:8080' } };
    expect(parseMcpConfig(map)).toBe(map);
  });

  it('accepts the V2 { servers: {...} } wrapper', () => {
    const inner = { srv: { type: 'remote', url: 'http://localhost:8080' } };
    expect(parseMcpConfig({ servers: inner })).toBe(inner);
  });
});
