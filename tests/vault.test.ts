import { describe, expect, it, vi, afterEach } from 'vitest';
import { ToolVault } from '../src/vault.js';
import { SemanticMatcher } from '../src/matcher.js';

describe('ToolVault', () => {
  const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

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

  it('awaits one deferred semantic build before concurrent locate calls', async () => {
    const build = deferred();
    const locate = vi.spyOn(SemanticMatcher.prototype, 'locate')
      .mockResolvedValue(new Map([['test', 0.95]]));
    const index = vi.spyOn(SemanticMatcher.prototype, 'index')
      .mockReturnValue(build.promise);
    const v = new ToolVault({ embedding: { enabled: true } });
    v.add('test', 'A test tool', {});

    const first = v.query('test', 5);
    const second = v.query('test', 5);
    await Promise.resolve();
    expect(index).toHaveBeenCalledTimes(1);
    expect(locate).not.toHaveBeenCalled();
    expect(await Promise.race([first.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending');
    expect(await Promise.race([second.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending');

    build.resolve();
    await Promise.all([first, second]);
    expect(locate).toHaveBeenCalledTimes(2);
  });

  it('keeps semantic state stale when a tool is added during a build', async () => {
    const firstBuild = deferred();
    const index = vi.spyOn(SemanticMatcher.prototype, 'index')
      .mockReturnValueOnce(firstBuild.promise)
      .mockResolvedValue(undefined);
    vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());
    const v = new ToolVault({ embedding: { enabled: true } });
    v.add('first', 'First tool', {});

    const query = v.query('first', 5);
    await Promise.resolve();
    v.add('second', 'Second tool', {});
    firstBuild.resolve();
    await query;
    await v.query('second', 5);
    expect(index).toHaveBeenCalledTimes(2);
    expect(index.mock.calls[1][0].map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  it('falls back to BM25 on index failure and retries later', async () => {
    const failure = deferred();
    const index = vi.spyOn(SemanticMatcher.prototype, 'index')
      .mockReturnValueOnce(failure.promise)
      .mockResolvedValue(undefined);
    vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());
    const v = new ToolVault({ embedding: { enabled: true } });
    v.add('read', 'Read a file', {});

    const first = v.query('file', 5);
    failure.reject(new Error('controlled failure'));
    await expect(first).resolves.toEqual([expect.objectContaining({ id: 'read' })]);
    await v.query('file', 5);
    expect(index).toHaveBeenCalledTimes(2);
  });
});
