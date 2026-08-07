import { describe, it, expect } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

describe('Apple-Grade Simplified Configuration Interface', () => {
  it('supports high-level intent options: pinned, maxResults, and mode', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {
      pinned: ['critical_tool'],
      maxResults: 5,
      mode: 'keyword',
    });

    expect(hooks.tool).toHaveProperty('tool_search');
    expect(hooks.tool).toHaveProperty('tool_search_regex');
  });

  it('preserves backward-compatibility with alwaysLoad and searchLimit', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {
      alwaysLoad: ['legacy_tool'],
      searchLimit: 15,
    });

    expect(hooks.tool).toHaveProperty('tool_search');
  });
});
