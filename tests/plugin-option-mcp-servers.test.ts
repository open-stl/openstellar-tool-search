import { describe, it, expect, vi } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

vi.mock('../src/mcp/mcp-tool-provider.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/mcp/mcp-tool-provider.js')>();
  return {
    ...mod,
    McpToolProvider: class MockMcpToolProvider {
      private tools = [
        { id: 'nested_mcp_tool', description: 'Nested MCP tool', parameters: {}, deferred: true },
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

describe('Plugin Options mcp.servers Nested Format', () => {
  it('parses mcp.servers nested directly inside plugin options', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {
      mcp: {
        servers: {
          notion: { type: 'remote', url: 'http://localhost:8080/sse', defer_loading: true },
        },
      },
    });

    const searchTool = (hooks.tool as any).tool_search;
    expect(searchTool).toBeDefined();
  });
});
