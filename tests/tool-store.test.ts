import { describe, it, expect } from 'vitest';
import { ToolStore } from '../src/catalog/tool-store.js';
import type { ToolMeta } from '../src/types.js';

describe('ToolStore', () => {
  const toolA: ToolMeta = { id: 'git_commit', description: 'Record changes to the repository', parameters: { type: 'object' } };
  const toolB: ToolMeta = { id: 'git_commit_ide', description: 'IDE alias for git_commit', parameters: { type: 'object' } };

  it('stores tools and counts items', () => {
    const store = new ToolStore();
    expect(store.count).toBe(0);

    store.add(toolA.id, toolA.description, toolA.parameters);
    expect(store.count).toBe(1);
    expect(store.get('git_commit')).toEqual(toolA);
  });

  it('resolves aliases ending with _ide', () => {
    const store = new ToolStore();
    store.add(toolA.id, toolA.description, toolA.parameters);

    expect(store.resolveAlias('git_commit')).toEqual(toolA);
    expect(store.resolveAlias('git_commit_ide')).toEqual(toolA);
    expect(store.resolveAlias('unknown_ide')).toBeUndefined();
  });

  it('greps by pattern with _ide fallback', () => {
    const store = new ToolStore();
    store.add(toolA.id, toolA.description, toolA.parameters);

    const hits = store.grep('git_commit_ide', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('git_commit');
  });

  it('extracts indexable text from parameters schema', () => {
    const store = new ToolStore();
    const text = store.prepareIndexedText({
      id: 'test_tool',
      description: 'Test description',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
        },
      },
    });

    expect(text).toContain('test_tool');
    expect(text).toContain('Test description');
    expect(text).toContain('query');
    expect(text).toContain('Search term');
  });
});
