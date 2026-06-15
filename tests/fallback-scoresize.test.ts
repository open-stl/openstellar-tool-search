/**
 * B5: Prove the OTHER fallback path — semantic returns 0 scores (not throws)
 *
 * The vault.query() has TWO fallthrough paths:
 *   1. `catch` (B3 covers: broken embedding model)
 *   2. `if (scores.size > 0) return; else fallthrough` (THIS test)
 *
 * We force path #2 by monkey-patching the SemanticMatcher.locate() to return
 * an empty Map. BM25 must then take over and return real results.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';
import { ToolVault } from '../src/vault.js';
import { SemanticMatcher } from '../src/matcher.js';

const FIX = [
  { id: 'github_create_issue', description: 'Creates a new GitHub issue in the specified repository', parameters: { type: 'object', properties: {} } },
  { id: 'read_file', description: 'Reads a file from disk', parameters: { type: 'object', properties: {} } },
];

describe('B5: scores.size === 0 → BM25 fallback', () => {
  it('forces matcher to return EMPTY Map → BM25 still produces github_create_issue', async () => {
    // Spy on SemanticMatcher.prototype.locate and force it to return empty Map
    const spy = vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());

    const ctx: any = { client: { tui: { showToast: vi.fn().mockResolvedValue(undefined) } }, project: {}, directory: '/tmp', worktree: '/tmp', experimental_workspace: { register: vi.fn() }, serverUrl: new URL('http://localhost'), $: {} };
    const toolCtx = { sessionID: 's', messageID: 'm', agent: 'a', directory: '/tmp', worktree: '/tmp', abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn().mockResolvedValue(undefined) };

    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: true, model: 'Xenova/all-MiniLM-L6-v2' } } as any);
    const def = hooks['tool.definition']!;
    for (const t of FIX) await def({ toolID: t.id }, { description: t.description, parameters: JSON.parse(JSON.stringify(t.parameters)) });
    const tSearch = (hooks.tool as any).tool_search;

    // Spy was called on the prototype, so ALL SemanticMatcher instances will return empty
    // That triggers the fallthrough at vault.ts:80 → queryBM25
    const out = await tSearch.execute({ query: 'github' }, toolCtx);
    const s = typeof out === 'string' ? out : (out as any).output;

    expect(spy).toHaveBeenCalled();
    expect(s).toMatch(/^Found \d+ tool\(s\):/);
    expect(s).toContain('github_create_issue');
    spy.mockRestore();
  });

  it('[d] regex blindspot: deferred tools have description "[d]" which matches many regexes', async () => {
    // When tools are deferred via the plugin, vault stores e.description = '[d]'
    // vault.grep() does: re.test(e.id) || re.test(e.description)
    // A pattern like `d` will match every deferred tool's description, even unrelated ones
    const v = new ToolVault();
    v.add('github_create_issue', '[d]', { type: 'object', properties: {} });
    v.add('figma_create_shape', '[d]', { type: 'object', properties: {} });
    v.add('read_file', '[d]', { type: 'object', properties: {} });

    // Pattern `d` (single char) — matches every "[d]" description (substring match)
    const r1 = v.grep('d', 10);
    expect(r1.length).toBe(3);  // CONFIRMS the blindspot: unrelated deferred tools all match

    // Pattern `^x$` — should match none (no tool has "x" anywhere)
    const r2 = v.grep('^x$', 10);
    expect(r2.length).toBe(0);

    // Pattern `\[d\]` — exactly matches the literal "[d]" (3 chars including brackets)
    const r3 = v.grep('\\[d\\]', 10);
    expect(r3.length).toBe(3);  // all deferred tools have exactly "[d]" in their description
  });
});
