import type { ToolMeta, ScoreParams, EmbedConfig } from './types.js';
import { RankEngine } from './rank.js';
import { SemanticMatcher } from './matcher.js';

function extractParamTexts(schema: unknown, prefix = ''): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const obj = schema as Record<string, unknown>;
  if (!obj.properties || typeof obj.properties !== 'object') return [];
  const texts: string[] = [];
  for (const [name, def] of Object.entries(obj.properties as Record<string, unknown>)) {
    if (!def || typeof def !== 'object') continue;
    const d = def as Record<string, unknown>;
    const full = prefix ? `${prefix}.${name}` : name;
    texts.push(full);
    if (typeof d.description === 'string' && d.description.trim().length > 0) texts.push(d.description.trim());
    if (d.type === 'object' || d.properties) texts.push(...extractParamTexts(def, full));
    else if (d.type === 'array' && d.items && typeof d.items === 'object') texts.push(...extractParamTexts(d.items as Record<string, unknown>, full));
  }
  return texts;
}

export class ToolVault {
  private store = new Map<string, ToolMeta>();
  private scorer: RankEngine<ToolMeta>;
  private scorerStale = true;
  private semantic: SemanticMatcher | undefined;
  private semanticStale = true;
  private semanticGeneration = 0;
  private semanticBuildPromise: Promise<void> | undefined;
  private scorerCfg: { k1: number; b: number };
  private cascadeThreshold: number;

  constructor(cfg: Partial<ScoreParams & { embedding?: EmbedConfig }> = {}) {
    this.scorerCfg = { k1: cfg.k1 ?? 0.9, b: cfg.b ?? 0.4 };
    this.cascadeThreshold = cfg.cascadeThreshold ?? 4.5;
    this.scorer = new RankEngine<ToolMeta>(this.scorerCfg.k1, this.scorerCfg.b);
    if (cfg.embedding?.enabled) this.semantic = new SemanticMatcher(cfg.embedding);
  }

  add(id: string, description: string, parameters: unknown): void {
    const old = this.store.get(id);
    if (old && (description === null || description === undefined)) return;
    const safe = description ?? '';
    if (!old || old.description !== safe) {
      this.store.set(id, { id, description: safe, parameters });
      this.scorerStale = true;
      this.semanticStale = true;
      this.semanticGeneration += 1;
    }
  }

  private prepareIndexedText(entry: ToolMeta): string {
    const fields = [entry.id, entry.description];
    if (entry.parameters) fields.push(...extractParamTexts(entry.parameters));
    return fields.join(' ');
  }

  private buildScorer(): void {
    if (!this.scorerStale) return;
    const items = Array.from(this.store.values());
    this.scorer = new RankEngine<ToolMeta>(this.scorerCfg.k1, this.scorerCfg.b);
    this.scorer.feed(items, (e) => [this.prepareIndexedText(e)]);
    this.scorerStale = false;
  }

  private buildSemantic(): Promise<void> {
    if (!this.semantic || !this.semanticStale) return Promise.resolve();
    if (this.semanticBuildPromise) return this.semanticBuildPromise;
    const generation = this.semanticGeneration;
    const indexed = Array.from(this.store.values()).map((e) => ({
      id: e.id,
      text: this.prepareIndexedText(e),
    }));
    let build: Promise<void>;
    build = this.semantic.index(indexed).then(() => {
      if (this.semanticGeneration === generation) this.semanticStale = false;
    }).finally(() => {
      if (this.semanticBuildPromise === build) this.semanticBuildPromise = undefined;
    });
    this.semanticBuildPromise = build;
    return build;
  }

  async query(text: string, limit: number): Promise<ToolMeta[]> {
    // 1. BM25 fast-path — always run first (sub-ms).
    const bm25Hits = this.queryBM25(text, limit);

    // 2. If no semantic matcher, return BM25 directly.
    if (!this.semantic) return bm25Hits;

    // 3. Cascade gate: if BM25 top score exceeds the threshold, skip semantic inference.
    const topScore = bm25Hits.length > 0
      ? (this.scorer.query(text, 1)[0]?.score ?? 0)
      : 0;
    if (topScore >= this.cascadeThreshold) return bm25Hits;

    // 4. Semantic fallback with RRF fusion.
    try {
      await this.buildSemantic();
      if (this.semanticStale) await this.buildSemantic();
      const semanticScores = await this.semantic.locate(text);
      if (semanticScores.size > 0) return this.fuseRRF(bm25Hits, semanticScores, limit);
    } catch (err) {
      console.warn('[tool-search] Embedding search failed, falling back to BM25:', err);
    }
    return bm25Hits;
  }

  private fuseRRF(
    bm25Hits: ToolMeta[],
    semanticScores: Map<string, number>,
    limit: number,
    k = 60,
  ): ToolMeta[] {
    const scoreMap = new Map<string, number>();
    bm25Hits.forEach((hit, rank) => {
      scoreMap.set(hit.id, (scoreMap.get(hit.id) ?? 0) + 1 / (k + rank + 1));
    });
    const sortedSemantic = Array.from(semanticScores.entries()).sort((a, b) => b[1] - a[1]);
    sortedSemantic.forEach(([id], rank) => {
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (k + rank + 1));
    });
    return Array.from(scoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => this.store.get(id))
      .filter((item): item is ToolMeta => Boolean(item));
  }

  queryBM25(text: string, limit: number): ToolMeta[] {
    this.buildScorer();
    const bm25 = this.scorer.query(text, limit).map((r) => r.item);
    // ID-exact-match boost: for each whitespace-separated token in the query,
    // if its lowercase form exactly matches a tool ID, ensure that tool appears
    // in the result set regardless of its BM25 score (IDF collapse on common words).
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    const seen = new Set(bm25.map((t) => t.id));
    const injected: ToolMeta[] = [];
    for (const token of tokens) {
      const match = this.store.get(token);
      if (match && !seen.has(match.id)) { injected.push(match); seen.add(match.id); }
    }
    if (injected.length === 0) return bm25;
    return [...injected, ...bm25].slice(0, limit);
  }

  grep(pattern: string, limit: number): ToolMeta[] {
    let re: RegExp;
    try { re = new RegExp(pattern, 'i'); } catch { return []; }
    const hits: ToolMeta[] = [];
    for (const item of this.store.values()) {
      re.lastIndex = 0;
      const matchesId = re.test(item.id);
      re.lastIndex = 0;
      const matchesDesc = re.test(item.description);
      if (matchesId || matchesDesc) {
        hits.push(item);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  get(id: string): ToolMeta | undefined { return this.store.get(id); }
  list(): ToolMeta[] { return Array.from(this.store.values()); }
  get count(): number { return this.store.size; }
}
