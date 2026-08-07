import { describe, expect, it, vi, afterEach } from 'vitest';
import { ToolVault } from '../src/vault.js';
import { SemanticMatcher } from '../src/matcher.js';
import { RankEngine } from '../src/rank.js';

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

  it('queryBM25 surfaces a tool whose ID matches a query token even when IDF is diluted by many tools mentioning that word', () => {
    // Reproduces the "read grep bash" scenario with a 229-tool realistic corpus:
    // every tool's description mentions "bash" -> IDF("bash") collapses -> the `bash`
    // tool itself drops out of the top-10. The fix must guarantee that any tool whose
    // *ID* is an exact match to a query token always appears in the result set.
    const v = new ToolVault();
    v.add('bash', 'Executes a given bash command in a persistent shell session with optional timeout.', {});
    v.add('grep', 'Fast content search. If you need rg use the Bash tool with rg directly. Do NOT use grep.', {});
    v.add('read', 'Read a file. Avoid using Bash with cat/head/tail/sed/awk for file reading.', {});
    v.add('glob', 'File pattern matching. Use Bash for shell-native filesystem ops.', {});
    v.add('edit', 'Edit files. Do not use bash echo or sed.', {});
    v.add('write', 'Write files. Avoid using bash for writes.', {});
    // 223 more tools, each with "bash" prominently in description -> simulates real corpus
    for (let i = 0; i < 223; i++) {
      v.add(`tool_${i}`, `Specialized tool ${i}. Use bash or shell for system operations. Prefer bash for terminal tasks.`, {});
    }
    // With 229 tools all mentioning "bash", IDF collapses. Without a fix, bash drops outside top-10.
    const results = v.queryBM25('read grep bash', 10);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('bash');
  });

  it('shares nested schema vocabulary between lexical and semantic indexing', async () => {
    const feed = vi.spyOn(RankEngine.prototype, 'feed');
    const index = vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
    vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());
    const v = new ToolVault({ embedding: { enabled: true } });
    v.add('configure', 'Configure a service', {
      type: 'object',
      properties: {
        settings: {
          type: 'object',
          description: 'Service settings',
          properties: {
            retryPolicy: { type: 'string', description: 'Retry strategy' },
          },
        },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              endpoint: { type: 'string', description: 'Destination URL' },
            },
          },
        },
      },
    });

    expect(v.queryBM25('retryPolicy', 5)[0].id).toBe('configure');
    const lexicalText = (feed.mock.calls[0][1])(v.list()[0]).join(' ');
    await v.prebuildSemantic();
    const semanticText = index.mock.calls[0][0][0].text;

    expect(semanticText).toBe(lexicalText);
    expect(semanticText).toContain('settings.retryPolicy');
    expect(semanticText).toContain('targets.endpoint');
    expect(semanticText).toContain('Retry strategy');
    expect(semanticText).toContain('Destination URL');
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

  it('preserves real canonical IDs ending in _ide', () => {
    const v = new ToolVault();
    v.add('read', 'Read a file', {});
    v.add('grep', 'Search files', {});

    expect(v.grep('^read$', 5).map((tool) => tool.id)).toEqual(['read']);
    expect(v.grep('^read_ide$', 5).map((tool) => tool.id)).toEqual(['read']);

    v.add('foo', 'Canonical foo', {});
    v.add('foo_ide', 'Real runtime tool', {});
    expect(v.grep('^foo_ide$', 5).map((tool) => tool.id)).toEqual(['foo_ide']);
    expect(v.get('foo')).toMatchObject({ id: 'foo' });
    expect(v.get('foo_ide')).toMatchObject({ id: 'foo_ide' });
    expect(v.grep('^foo_ide_ide$', 5).map((tool) => tool.id)).toEqual(['foo_ide']);
  });

  it('does not index synthesized aliases', () => {
    const v = new ToolVault();
    v.add('read', 'Read a file', {});
    expect(v.queryBM25('read_ide', 5).map((tool) => tool.id)).toEqual(['read']);
    expect(v.list().map((tool) => tool.id)).toEqual(['read']);
  });

  it('resolveAlias returns exact match for real _ide tools (no stripping needed)', () => {
    const v = new ToolVault();
    v.add('foo', 'Canonical foo', {});
    v.add('foo_ide', 'Real foo_ide tool', {});
    expect(v.resolveAlias('foo_ide')).toMatchObject({ id: 'foo_ide' });
    expect(v.resolveAlias('foo')).toMatchObject({ id: 'foo' });
  });

  it('resolveAlias strips _ide suffix to find cloaked tool canonical', () => {
    const v = new ToolVault();
    v.add('bash', 'Execute bash command', {});
    v.add('read', 'Read a file', {});
    expect(v.resolveAlias('bash_ide')).toMatchObject({ id: 'bash' });
    expect(v.resolveAlias('read_ide')).toMatchObject({ id: 'read' });
    expect(v.resolveAlias('bash_ide_ide')).toBeUndefined(); // no double strip
  });

  it('grep returns no matches for invalid regex', () => {
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
    const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 100 });
    v.add('test', 'A test tool', {});

    const buildPromise = v.prebuildSemantic()!;
    const first = v.query('unmatched', 5);
    const second = v.query('unmatched', 5);
    await Promise.resolve();
    expect(index).toHaveBeenCalledTimes(1);
    expect(locate).not.toHaveBeenCalled();
    expect(await Promise.race([first.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending');
    expect(await Promise.race([second.then(() => 'settled'), Promise.resolve('pending')])).toBe('pending');

    build.resolve();
    await buildPromise;
    await Promise.all([first, second]);
    expect(locate).toHaveBeenCalledTimes(2);
  });

  it('keeps semantic state stale when a tool is added during a build', async () => {
    const firstBuild = deferred();
    const index = vi.spyOn(SemanticMatcher.prototype, 'index')
      .mockReturnValueOnce(firstBuild.promise)
      .mockResolvedValue(undefined);
    vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());
    const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 100 });
    v.add('first', 'First tool', {});

    const buildPromise = v.prebuildSemantic()!;
    const query = v.query('unmatched', 5);
    await Promise.resolve();
    v.add('second', 'Second tool', {});
    firstBuild.resolve();
    await buildPromise;
    await query;
    await v.prebuildSemantic();
    await v.query('unmatched', 5);
    expect(index).toHaveBeenCalledTimes(2);
    expect(index.mock.calls[1][0].map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  it('falls back to BM25 on index failure and retries later', async () => {
    const failure = deferred();
    const index = vi.spyOn(SemanticMatcher.prototype, 'index')
      .mockReturnValueOnce(failure.promise)
      .mockResolvedValue(undefined);
    vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());
    const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 100 });
    v.add('read', 'Read a file', {});

    const buildPromise = v.prebuildSemantic()!;
    const first = v.query('unmatched', 5);
    failure.reject(new Error('controlled failure'));
    await buildPromise.catch(() => {});
    await expect(first).resolves.toEqual([]);
    await v.prebuildSemantic();
    await v.query('unmatched', 5);
    expect(index).toHaveBeenCalledTimes(2);
  });

  it('does not log console.warn or console.error when embedding search fails or times out', async () => {
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(SemanticMatcher.prototype, 'index').mockRejectedValue(new Error('controlled failure'));

    const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 10.0 });
    v.add('read', 'Read a file', {});

    const res = await v.query('file', 5, 50);
    expect(res).toEqual([expect.objectContaining({ id: 'read' })]);
    expect(spyWarn).not.toHaveBeenCalled();
    expect(spyError).not.toHaveBeenCalled();

    spyWarn.mockRestore();
    spyError.mockRestore();
  });

  it('skips semantic search when BM25 returns high confidence match (fast-path cascade)', async () => {
    const locate = vi.spyOn(SemanticMatcher.prototype, 'locate');
    const index = vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
    const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 1.0 });
    v.add('git_commit', 'Creates a commit in git', {});
    v.add('git_push', 'Pushes commits to git remote', {});

    const res = await v.query('git commit', 5);
    expect(res[0].id).toBe('git_commit');
    expect(locate).not.toHaveBeenCalled();
    expect(index).not.toHaveBeenCalled();
  });

  it('fuses BM25 and semantic scores using RRF when BM25 score is below threshold', async () => {
    vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
    vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(
      new Map([
        ['read_file', 0.95],
        ['git_commit', 0.10],
      ])
    );
    const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 10.0 });
    v.add('git_commit', 'Creates a commit in git', {});
    v.add('read_file', 'Reads file contents from disk', {});

    const res = await v.query('file', 5);
    expect(res[0].id).toBe('read_file');
  });

  describe('prebuildSemantic', () => {
    it('returns undefined when semantic matcher is disabled', () => {
      const v = new ToolVault({ embedding: { enabled: false } });
      v.add('read', 'Read a file', {});
      expect(v.prebuildSemantic()).toBeUndefined();
    });

    it('returns undefined when index is already current', () => {
      const v = new ToolVault({ embedding: { enabled: true } });
      v.add('read', 'Read a file', {});
      // Manually mark not-stale by simulating existing index state.
      (v as unknown as { engine: { semanticStale: boolean } }).engine.semanticStale = false;
      expect(v.prebuildSemantic()).toBeUndefined();
    });

    it('returns a promise when there is work to build', () => {
      const v = new ToolVault({ embedding: { enabled: true } });
      v.add('read', 'Read a file', {});
      const p = v.prebuildSemantic();
      expect(p).toBeInstanceOf(Promise);
    });

    it('isSemanticReady reflects build state', () => {
      const v = new ToolVault({ embedding: { enabled: true } });
      v.add('read', 'Read a file', {});
      expect(v.isSemanticReady).toBe(false);
      (v as unknown as { engine: { semanticStale: boolean } }).engine.semanticStale = false;
      expect(v.isSemanticReady).toBe(true);
    });
  });

  describe('query timeout', () => {
    it('returns BM25 results within timeoutMs even when semantic is slow', async () => {
      // Make the indexer hang forever.
      const index = vi
        .spyOn(SemanticMatcher.prototype, 'index')
        .mockImplementation(
          () => new Promise<void>(() => {}),
        );
      const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 100 });
      v.add('read_file', 'Reads contents from disk', {});

      v.prebuildSemantic();
      const start = Date.now();
      const res = await v.query('read', 5, 50); // 50ms timeout
      const elapsed = Date.now() - start;

      expect(res[0].id).toBe('read_file');
      expect(elapsed).toBeLessThan(1000); // should NOT wait the full build (worker startup overhead) time
      expect(index).toHaveBeenCalled();
    });

    it('still uses semantic fusion when build finishes before timeout', async () => {
      vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
      vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(
        new Map([['read_file', 0.95]]),
      );
      const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 100 });
      v.add('git_commit', 'Creates a commit', {});
      v.add('read_file', 'Reads file contents', {});
      await v.prebuildSemantic();

      const res = await v.query('file', 5, 1000);
      expect(res.map((r) => r.id)).toContain('read_file');
    });

    it('timeoutMs=0 falls back to legacy behavior (no timeout)', async () => {
      vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
      const locate = vi
        .spyOn(SemanticMatcher.prototype, 'locate')
        .mockResolvedValue(new Map());
      const v = new ToolVault({ embedding: { enabled: true }, cascadeThreshold: 100 });
      v.add('read_file', 'Reads file contents', {});
      await v.prebuildSemantic();

      await v.query('file', 5, 0); // explicit 0 = no timeout
      expect(locate).toHaveBeenCalled();
    });
  });

  describe('grep with _ide alias fallback', () => {
    it('falls back to stripped pattern when _ide suffix query has no direct matches', () => {
      const v = new ToolVault();
      v.add('github_create_issue', 'Creates a new GitHub issue', {});
      v.add('github_create_pr', 'Creates a pull request', {});

      const hits = v.grep('github_create_issue_ide$', 10);
      expect(hits.map((h) => h.id)).toContain('github_create_issue');
    });
  });
});
