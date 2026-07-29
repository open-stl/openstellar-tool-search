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
import { ToolVault } from '../src/vault.js';
import { SemanticMatcher } from '../src/matcher.js';

// Stub model work so this test exercises fallback control flow deterministically.
vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);

const FIX = [
  { id: 'github_create_issue', description: 'Creates a new GitHub issue in the specified repository', parameters: { type: 'object', properties: {} } },
  { id: 'read_file', description: 'Reads a file from disk', parameters: { type: 'object', properties: {} } },
];

describe('B5: scores.size === 0 → BM25 fallback', () => {
  it('forces matcher to return EMPTY Map → BM25 still produces github_create_issue', async () => {
    // Spy on SemanticMatcher.prototype.locate and force it to return empty Map
    const spy = vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());

    const vault = new ToolVault({ embedding: { enabled: true } });
    for (const t of FIX) vault.add(t.id, t.description, t.parameters);
    const results = await vault.query('github', 3);

    expect(spy).toHaveBeenCalled();
    expect(results.map((item) => item.id)).toContain('github_create_issue');
    spy.mockRestore();
  });

  it('[deferred] regex blindspot: deferred tools have description "[deferred]" which matches many regexes', async () => {
    // When tools are deferred via the plugin, vault stores e.description = '[deferred]'
    // vault.grep() does: re.test(e.id) || re.test(e.description)
    // A pattern like `d` will match every deferred tool's description, even unrelated ones
    const v = new ToolVault();
    v.add('github_create_issue', '[deferred]', { type: 'object', properties: {} });
    v.add('figma_create_shape', '[deferred]', { type: 'object', properties: {} });
    v.add('read_file', '[deferred]', { type: 'object', properties: {} });

    // Pattern `d` (single char) — matches every "[deferred]" description (substring match)
    const r1 = v.grep('d', 10);
    expect(r1.length).toBe(3);  // CONFIRMS the blindspot: unrelated deferred tools all match

    // Pattern `^x$` — should match none (no tool has "x" anywhere)
    const r2 = v.grep('^x$', 10);
    expect(r2.length).toBe(0);

    // Pattern `\[deferred\]` — exactly matches the literal "[deferred]" (10 chars including brackets)
    const r3 = v.grep('\\[deferred\\]', 10);
    expect(r3.length).toBe(3);  // all deferred tools have exactly "[deferred]" in their description
  });
});
