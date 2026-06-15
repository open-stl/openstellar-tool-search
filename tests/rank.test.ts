import { describe, expect, it } from 'vitest';
import { RankEngine } from '../src/rank.js';

describe('RankEngine', () => {
  const items = [
    { id: 'git_commit', desc: 'creates a git commit' },
    { id: 'read_file', desc: 'reads file contents' },
    { id: 'figma_create', desc: 'creates a figma shape' },
  ];

  it('returns empty for untrained engine', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    expect(r.query('git', 5)).toEqual([]);
  });

  it('ranks by BM25 relevance', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    r.feed(items, (x) => [x.id, x.desc]);
    const results = r.query('creates', 5);
    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('respects the limit', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    r.feed(items, (x) => [x.id, x.desc]);
    expect(r.query('creates', 2).length).toBe(2);
    expect(r.query('creates', 1).length).toBe(1);
  });

  it('handles empty query', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    r.feed(items, (x) => [x.id, x.desc]);
    expect(r.query('', 5)).toEqual([]);
  });

  it('handles query with no matches', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    r.feed(items, (x) => [x.id, x.desc]);
    expect(r.query('zzzzzxyz', 5)).toEqual([]);
  });

  it('reports trained state', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    expect(r.trained).toBe(false);
    r.feed(items, (x) => [x.id, x.desc]);
    expect(r.trained).toBe(true);
  });
});
