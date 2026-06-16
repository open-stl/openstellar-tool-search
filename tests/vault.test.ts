import { describe, expect, it, vi, afterEach } from 'vitest';
import { ToolVault } from '../src/vault.js';
import { SemanticMatcher } from '../src/matcher.js';

describe('ToolVault', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and retrieves tools', () => {
    const v = new ToolVault();
    v.add('read', 'Read a file', { type: 'object', properties: { path: { type: 'string' } } });
    expect(v.count).toBe(1);
    expect(v.list()[0].description).toBe('Read a file');
  });

  it('does not overwrite valid desc with null', () => {
    const v = new ToolVault();
    v.add('read', 'Read a file', {});
    v.add('read', null as unknown as string, {});
    expect(v.list()[0].description).toBe('Read a file');
  });

  it('queryBM25 returns ranked results', () => {
    const v = new ToolVault();
    v.add('git_commit', 'Creates a commit in git', {});
    v.add('read_file', 'Reads file contents', {});
    const r1 = v.queryBM25('git commit', 5);
    expect(r1[0].id).toBe('git_commit');
    const r2 = v.queryBM25('read file', 5);
    expect(r2[0].id).toBe('read_file');
  });

  it('grep returns regex matches', () => {
    const v = new ToolVault();
    v.add('github_create_issue', 'Creates github issue', {});
    v.add('figma_create_shape', 'Creates figma shape', {});
    v.add('read_file', 'Reads file', {});
    expect(v.grep('github', 5).length).toBe(1);
    expect(v.grep('github.*issue', 5).length).toBe(1);
    expect(v.grep('create', 5).length).toBe(2);
    expect(v.grep('nonexistent', 5).length).toBe(0);
  });

  it('grep returns empty for invalid but non-crashing regex', () => {
    const v = new ToolVault();
    v.add('test', 'test tool', {});
    expect(v.grep('test.*[abc', 5)).toEqual([]);
  });

  it('list returns all entries', () => {
    const v = new ToolVault();
    v.add('a', 'desc a', {});
    v.add('b', 'desc b', {});
    expect(v.list().length).toBe(2);
  });

  it('query falls back to BM25 when no embedding config', async () => {
    const v = new ToolVault();
    v.add('read', 'Read a file', {});
    v.add('bash', 'Execute a shell command', {});
    const r = await v.query('file', 5);
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('read');
  });

  it('does not duplicate semantic indexing on concurrent queries (Bug 3)', async () => {
    const indexSpy = vi.spyOn(SemanticMatcher.prototype, 'index')
      .mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
    vi.spyOn(SemanticMatcher.prototype, 'locate')
      .mockResolvedValue(new Map([['test', 0.95]]));

    const v = new ToolVault({ embedding: { enabled: true } });
    v.add('test', 'A test tool', { type: 'object', properties: { foo: { type: 'string' } } });

    await Promise.all([
      v.query('test', 5),
      v.query('test', 5),
    ]);

    expect(indexSpy).toHaveBeenCalledTimes(1);
  });
});
