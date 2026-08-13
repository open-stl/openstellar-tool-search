import { describe, it, expect, vi } from 'vitest';
import { ToolStore } from '../src/catalog/tool-store.js';
import type { ToolProvider, ToolDefinition } from '../src/catalog/tool-provider.js';

describe('ToolProvider Abstraction Seam', () => {
  it('registers tools from a ToolProvider into ToolStore', async () => {
    const store = new ToolStore();
    const providerTools: ToolDefinition[] = [
      { id: 'mcp_search', description: 'Search external docs', parameters: { properties: { q: { type: 'string' } } } },
      { id: 'mcp_fetch', description: 'Fetch URL content', parameters: {} },
    ];

    const mockProvider: ToolProvider = {
      getTools: () => providerTools,
    };

    await store.registerProvider(mockProvider);

    expect(store.count).toBe(2);
    expect(store.get('mcp_search')?.description).toBe('Search external docs');
    expect(store.get('mcp_fetch')?.description).toBe('Fetch URL content');
  });

  it('handles dynamic tool updates from ToolProvider.onUpdate', async () => {
    const store = new ToolStore();
    let updateListener: ((tools: ToolDefinition[]) => void) | undefined;

    const mockProvider: ToolProvider = {
      getTools: () => [{ id: 'mcp_initial', description: 'Initial tool', parameters: {} }],
      onUpdate: (cb) => { updateListener = cb; },
    };

    await store.registerProvider(mockProvider);
    expect(store.count).toBe(1);

    // Fire dynamic update
    updateListener?.([
      { id: 'mcp_dynamic', description: 'Dynamic tool added later', parameters: {} },
    ]);

    expect(store.count).toBe(2);
    expect(store.get('mcp_dynamic')?.description).toBe('Dynamic tool added later');
  });
});
