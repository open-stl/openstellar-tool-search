import { describe, it, expect, vi } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

vi.mock('../src/mcp/mcp-tool-provider.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/mcp/mcp-tool-provider.js')>();
  return {
    ...mod,
    McpToolProvider: class MockMcpToolProvider {
      private tools = [
        { id: 'toplevel_search', description: 'Top level search tool', parameters: {}, deferred: true },
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

describe('Top-level Standard MCP Config Hook Integration', () => {
  it('reads top-level cfg.mcp from config hook if opts.mcp is not provided', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {});

    expect(hooks.config).toBeDefined();

    // Trigger config hook with standard top-level mcp block
    if (hooks.config) {
      await hooks.config({
        mcp: {
          codebase_memory: { type: 'local', command: ['/bin/test'] },
        },
      } as any);
    }

    const searchTool = (hooks.tool as any).tool_search;
    expect(searchTool).toBeDefined();
  });
});
