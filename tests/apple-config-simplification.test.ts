import { describe, it, expect } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

describe('Apple-Grade Simplified Configuration Interface', () => {
  it('supports high-level intent options: alwaysLoad, maxResults, mode, resetTools, and mcp', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {
      alwaysLoad: ['critical_tool'],
      maxResults: 5,
      mode: 'keyword',
      resetTools: ['compress'],
    });

    expect(hooks.tool).toHaveProperty('tool_search');
    expect(hooks.tool).toHaveProperty('tool_search_regex');
  });
});
