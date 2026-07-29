import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SemanticMatcher } from '../src/matcher.js';
import type { IndexedEntry } from '../src/matcher.js';

describe('SemanticMatcher', () => {
  it('requires enabled in config', () => {
    const m = new SemanticMatcher({ enabled: true });
    expect(m.active).toBe(false);
    expect(m.entryCount).toBe(0);
    expect(m.fault).toBeNull();
  });

  it('accepts custom model and threshold', () => {
    const m = new SemanticMatcher({
      enabled: true,
      model: 'Xenova/all-MiniLM-L6-v2',
      threshold: 0.5,
    });
    expect(m).toBeInstanceOf(SemanticMatcher);
  });

  it('supports quantized and dtype configuration options (Lever 4)', async () => {
    const m = new SemanticMatcher({
      enabled: true,
      model: 'Xenova/all-MiniLM-L6-v2',
      quantized: true,
      dtype: 'q8',
    });
    await m.open();
    expect(m.active).toBe(true);

    const entries: IndexedEntry[] = [
      { id: 'git_commit', text: 'git commit creates a commit' },
    ];
    await m.index(entries);
    expect(m.entryCount).toBe(1);
  }, 60000);

  it('persists and reloads vectors from disk cache (Lever 3: hit/miss)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tool-search-cache-test-'));
    try {
      const cacheDir = join(tmpDir, 'cache');
      const m1 = new SemanticMatcher({
        enabled: true,
        cacheDir,
        cache: true,
        threshold: -1,
      });
      expect(m1.isCacheEnabled).toBe(true);

      const entries: IndexedEntry[] = [
        { id: 'git_commit', text: 'git commit creates a commit with a message' },
        { id: 'read_file', text: 'reads file contents from filesystem' },
      ];

      // Cold start / Cache miss: runs model inference and saves cache
      await m1.index(entries);
      expect(m1.entryCount).toBe(2);

      // Wait briefly for async cache file write
      await new Promise((r) => setTimeout(r, 200));

      const files = readdirSync(cacheDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f: string) => f.startsWith('vectors-') && f.endsWith('.json'))).toBe(true);

      // Warm start / Cache hit: loads directly from disk cache
      const m2 = new SemanticMatcher({
        enabled: true,
        cacheDir,
        cache: true,
        threshold: -1,
      });

      await m2.index(entries);
      expect(m2.entryCount).toBe(2);

      const scores = await m2.locate('git commit');
      expect(scores.size).toBe(2);
      expect(scores.has('git_commit')).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60000);

  it('supports worker threads offloading option (Lever 5)', async () => {
    const m = new SemanticMatcher({
      enabled: true,
      useWorker: true,
      threshold: -1,
    });
    expect(m.isWorkerEnabled).toBe(true);

    await m.open();
    const entries: IndexedEntry[] = [
      { id: 'git_status', text: 'shows working tree status' },
    ];
    await m.index(entries);
    expect(m.entryCount).toBe(1);

    const scores = await m.locate('working tree');
    expect(scores.has('git_status')).toBe(true);
  }, 60000);

  it('indexes entries and locates by semantic similarity', async () => {
    const m = new SemanticMatcher({ enabled: true, threshold: -1 });
    await m.open();

    const entries: IndexedEntry[] = [
      { id: 'git_commit', text: 'git commit creates a commit with a message' },
      { id: 'read_file', text: 'reads file contents from the filesystem' },
      { id: 'figma_create', text: 'creates a rectangle shape in figma' },
    ];
    await m.index(entries);

    const scores = await m.locate('create a git commit');
    expect(scores.size).toBe(3);

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    expect(sorted[0][0]).toBe('git_commit');
    expect(sorted[0][1]).toBeGreaterThan(sorted[1][1]);
  }, 60000);

  it('filters results below threshold', async () => {
    const m = new SemanticMatcher({ enabled: true, threshold: 0.5 });
    await m.open();

    const entries: IndexedEntry[] = [
      { id: 'git_commit', text: 'git commit creates a commit' },
      { id: 'read_file', text: 'reads file contents from filesystem' },
    ];
    await m.index(entries);

    const scores = await m.locate('file read');
    for (const [, score] of scores) {
      expect(score).toBeGreaterThanOrEqual(0.5);
    }
  }, 60000);

  it('relaxes threshold when results < 2', async () => {
    const m = new SemanticMatcher({ enabled: true, threshold: 0.9 });
    await m.open();

    const entries: IndexedEntry[] = [
      { id: 'git_commit', text: 'git commit creates a commit' },
      { id: 'read_file', text: 'reads file contents from filesystem' },
    ];
    await m.index(entries);

    const scores = await m.locate('make a git commit');
    expect(scores.size).toBe(1);
    expect(scores.has('git_commit')).toBe(true);
  }, 60000);

  it('locate returns empty for unmatched query', async () => {
    const m = new SemanticMatcher({ enabled: true, threshold: 0.9 });
    await m.open();

    const entries: IndexedEntry[] = [
      { id: 'git', text: 'git version control' },
    ];
    await m.index(entries);

    const scores = await m.locate('quantum physics string theory');
    expect(scores.size).toBe(0);
  }, 60000);

  it('indexes multiple entries in a single batch correctly', async () => {
    const m = new SemanticMatcher({ enabled: true, threshold: 0.3 });
    await m.open();

    const entries: IndexedEntry[] = [
      { id: 'tool_1', text: 'creates a new file in the directory' },
      { id: 'tool_2', text: 'deletes a file permanently from disk' },
      { id: 'tool_3', text: 'edits text content within a file' },
      { id: 'tool_4', text: 'empty description tool' },
      { id: 'tool_5', text: '' },
    ];
    await m.index(entries);

    expect(m.entryCount).toBe(5);
    const scores = await m.locate('create file');
    expect(scores.has('tool_1')).toBe(true);
  }, 60000);
});
