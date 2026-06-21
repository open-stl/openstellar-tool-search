function breakWords(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = [];
  for (const t of cleaned.split(/\s+/)) {
    if (t.length > 0) tokens.push(t);
  }
  return tokens;
}

function countTerms(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

function inverseDocFreq(total: number, docsWithTerm: number): number {
  return Math.log((total - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
}

import type { Hit } from './types.js';

interface DocRecord {
  id: number;
  raw: string[];
  freq: Map<string, number>;
  len: number;
}

export class RankEngine<T> {
  private docs: DocRecord[] = [];
  private items: T[] = [];
  private docFreq = new Map<string, number>();
  private avgLen = 0;
  private ready = false;

  constructor(
    private k1: number,
    private b: number,
  ) {}

  feed(entries: T[], extract: (x: T) => string[]): void {
    const newDocs: DocRecord[] = [];
    for (const item of entries) {
      const fields = extract(item);
      const text = fields.join(' ');
      const tokens = breakWords(text);
      newDocs.push({
        id: this.items.length,
        raw: tokens,
        freq: countTerms(tokens),
        len: tokens.length,
      });
      this.items.push(item);
    }
    let totalLen = 0;
    for (const d of newDocs) {
      totalLen += d.len;
      for (const [term] of d.freq) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
    this.docs.push(...newDocs);
    this.avgLen = this.docs.length > 0
      ? (this.avgLen * (this.docs.length - newDocs.length) + totalLen) / this.docs.length
      : 0;
    this.ready = true;
  }

  query(text: string, limit: number): Hit<T>[] {
    if (!this.ready || this.docs.length === 0) return [];
    const terms = breakWords(text);
    if (terms.length === 0) return [];

    const scores: { idx: number; score: number }[] = [];
    for (let i = 0; i < this.docs.length; i++) {
      const d = this.docs[i];
      let total = 0;
      for (const q of terms) {
        const df = this.docFreq.get(q) ?? 0;
        if (df === 0) continue;
        const tf = d.freq.get(q) ?? 0;
        if (tf === 0) continue;
        const idf = inverseDocFreq(this.docs.length, df);
        const numer = tf * (this.k1 + 1);
        const denom = tf + this.k1 * (1 - this.b + this.b * (d.len / this.avgLen));
        total += idf * (numer / denom);
      }
      if (total > 0) scores.push({ idx: i, score: total });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, limit).map((s) => ({ item: this.items[s.idx], score: s.score }));
  }

  get trained(): boolean {
    return this.ready;
  }
}
