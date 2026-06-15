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
});
