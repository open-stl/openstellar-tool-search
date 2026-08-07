import { describe, it, expect, vi } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

vi.mock('../src/mcp/mcp-tool-provider.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/mcp/mcp-tool-provider.js')>();
  return {
    ...mod,
    McpToolProvider: class MockMcpToolProvider {
      private tools = [
        { id: 'v2_tool', description: 'V2 MCP tool', parameters: {}, deferred: true },
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

describe('OpenCode V2 mcp.servers Format Integration', () => {
  it('supports V2 mcp.servers configuration shape in config hook', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {});

    if (hooks.config) {
      await hooks.config({
        mcp: {
          servers: {
            notion: { type: 'remote', url: 'http://localhost:8080/sse', defer_loading: true },
            disabled_server: { type: 'local', command: ['echo'], disabled: true },
          },
        },
      } as any);
    }

    const searchTool = (hooks.tool as any).tool_search;
    expect(searchTool).toBeDefined();
  });
});
