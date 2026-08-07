import { describe, it, expect } from 'vitest';
import { sanitizeToolId } from '../src/mcp/mcp-tool-provider.js';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

describe('Code Review Standards & Spec Remediations', () => {
  it('prevents tool ID collision when tool name starts with a different server name', () => {
    // Server 'notion' with tool 'notion_search' -> 'notion_search'
    expect(sanitizeToolId('notion', 'notion_search')).toBe('notion_search');

    // Server 'db' with tool 'notion_search' -> 'db_notion_search' (must NOT skip prefix!)
    expect(sanitizeToolId('db', 'notion_search')).toBe('db_notion_search');
  });

  it('enforces 500 character limit on tool_search text queries', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {});
    const searchTool = (hooks.tool as any).tool_search;

    const longQuery = 'q'.repeat(501);
    const result = await searchTool.execute({ query: longQuery }, { sessionID: 'sess-query-limit' });
    expect(result).toContain('exceeds maximum length of 500 characters');
  });
});
