import { describe, it, expect, vi } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

vi.mock('../src/mcp/mcp-tool-provider.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/mcp/mcp-tool-provider.js')>();
  return {
    ...mod,
    McpToolProvider: class MockMcpToolProvider {
      private tools = [
        { id: 'notion_search', description: 'Search Notion pages', parameters: { properties: { q: { type: 'string' } } }, deferred: true },
        { id: 'github_create_issue', description: 'Create GitHub issue', parameters: { properties: { title: { type: 'string' } } }, deferred: true },
        { id: 'quick_calc', description: 'Immediate calculator tool', parameters: {}, deferred: false },
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

describe('MCP Provider End-to-End Integration Suite', () => {
  it('registers deferred and non-deferred tools from MCP provider', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {
      mcp: {
        notion: { type: 'remote', url: 'http://localhost:8080/sse', defer_loading: true },
        github: { type: 'remote', url: 'http://localhost:8081/sse', defer_loading: true },
        calc: { type: 'local', command: ['node', 'calc.js'], defer_loading: false },
      },
    });

    const searchTool = (hooks.tool as any).tool_search;
    expect(searchTool).toBeDefined();

    // Call tool_search for notion
    const searchResult = await searchTool.execute({ query: 'Notion pages' }, { sessionID: 'sess-mcp-1' });
    expect(searchResult).toContain('notion_search');
    expect(searchResult).toContain('Search Notion pages');
  });

  it('enforces SessionToolRegistry execution protection on searched MCP tools', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {
      mcp: {
        notion: { type: 'remote', url: 'http://localhost:8080/sse' },
      },
    });

    // Simulate tool definition hook
    if (hooks['tool.definition']) {
      await hooks['tool.definition']({ toolID: 'notion_search' }, { description: 'Search Notion pages', parameters: {} });
    }

    // Trying to execute before search throws authorization reminder
    if (hooks['tool.execute.before']) {
      await expect(
        hooks['tool.execute.before']({ tool: 'notion_search', sessionID: 'sess-mcp-2', callID: 'call-1' }, {} as any),
      ).rejects.toThrow(/\[Tool Search Required\] Tool "notion_search" has not been searched/);
    }
  });
});
