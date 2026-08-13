import type { ToolMeta, ScoreParams, EmbedConfig } from '../types.js';
import { RankEngine } from './rank.js';
import { SemanticMatcher } from './matcher.js';
import type { ToolStore } from './tool-store.js';

interface SearchEngineOptions extends Partial<ScoreParams> {
  embedding?: EmbedConfig;
}

/**
 * Deep module that owns multi-tier search execution: BM25 TF-IDF scoring,
 * semantic worker vector embeddings, cascade score gating, RRF rank fusion,
 * ID-exact-match token boosting, and cold-index fast-pathing.
 */
export class HybridSearchEngine {
  private scorer: RankEngine<ToolMeta>;
  private scorerStale = true;
  private semantic: SemanticMatcher | undefined;
  private semanticStale = true;
  private semanticGeneration = 0;
  private semanticBuildPromise: Promise<void> | undefined;
  private scorerCfg: { k1: number; b: number };
  private cascadeThreshold: number;

  constructor(private store: ToolStore, cfg: SearchEngineOptions = {}) {
    this.scorerCfg = { k1: cfg.k1 ?? 0.9, b: cfg.b ?? 0.4 };
    this.cascadeThreshold = cfg.cascadeThreshold ?? 1.0;
    this.scorer = new RankEngine<ToolMeta>(this.scorerCfg.k1, this.scorerCfg.b);
    if (cfg.embedding?.enabled) this.semantic = new SemanticMatcher(cfg.embedding);
  }

  notifyChanged(): void {
    this.scorerStale = true;
    this.semanticStale = true;
    this.semanticGeneration += 1;
  }

  private buildScorer(): void {
    if (!this.scorerStale) return;
    const items = this.store.list();
    this.scorer = new RankEngine<ToolMeta>(this.scorerCfg.k1, this.scorerCfg.b);
    this.scorer.feed(items, (e) => [this.store.prepareIndexedText(e)]);
    this.scorerStale = false;
  }

  private buildSemantic(): Promise<void> {
    if (!this.semantic || !this.semanticStale) return Promise.resolve();
    if (this.semanticBuildPromise) return this.semanticBuildPromise;
    const generation = this.semanticGeneration;
    const indexed = this.store.list().map((e) => ({
      id: e.id,
      text: this.store.prepareIndexedText(e),
    }));
    let build: Promise<void>;
    build = this.semantic.index(indexed).then(() => {
      if (this.semanticGeneration === generation) this.semanticStale = false;
    }).catch(() => {
      // Background index build failure — fail open
    }).finally(() => {
      if (this.semanticBuildPromise === build) this.semanticBuildPromise = undefined;
    });
    this.semanticBuildPromise = build;
    return build;
  }

  prebuildSemantic(): Promise<void> | undefined {
    if (!this.semantic) return undefined;
    if (!this.semanticStale) return undefined;
    return this.buildSemantic();
  }

  get isSemanticReady(): boolean {
    return !this.semantic || !this.semanticStale;
  }

  get isSemanticBuilding(): boolean {
    return Boolean(this.semanticBuildPromise);
  }

  async query(text: string, limit: number, timeoutMs = 0): Promise<ToolMeta[]> {
    const bm25Hits = this.queryBM25(text, limit);
    if (!this.semantic) return bm25Hits;

    const topScore = bm25Hits.length > 0
      ? (this.scorer.query(text, 1)[0]?.score ?? 0)
      : 0;
    if (topScore >= this.cascadeThreshold) return bm25Hits;

    if (!this.isSemanticReady && bm25Hits.length > 0) {
      this.prebuildSemantic();
      return bm25Hits;
    }

    try {
      if (timeoutMs > 0) {
        const result = await this.runSemanticWithTimeout(text, bm25Hits, limit, timeoutMs);
        if (result) return result;
      } else {
        const result = await this.runSemantic(text, bm25Hits, limit);
        if (result) return result;
      }
    } catch {
      // Internal recoverable error — fail open to BM25
    }
    return bm25Hits;
  }

  /**
   * Build the semantic index (retrying once if it went stale mid-build), locate
   * nearest entries, and fuse with BM25 via RRF. Returns null when there are no
   * semantic scores to fuse, so the caller falls back to BM25.
   */
  private async runSemantic(
    text: string,
    bm25Hits: ToolMeta[],
    limit: number,
  ): Promise<ToolMeta[] | null> {
    await this.buildSemantic();
    if (this.semanticStale) await this.buildSemantic();
    const semanticScores = await this.semantic!.locate(text);
    if (semanticScores.size > 0) return this.fuseRRF(bm25Hits, semanticScores, limit);
    return null;
  }

  private async runSemanticWithTimeout(
    text: string,
    bm25Hits: ToolMeta[],
    limit: number,
    timeoutMs: number,
  ): Promise<ToolMeta[] | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const work = (async (): Promise<ToolMeta[] | null> => {
      try {
        const result = await this.runSemantic(text, bm25Hits, limit);
        return result ?? bm25Hits;
      } catch {
        return bm25Hits;
      }
    })();
    const winner = await Promise.race([work, timeout]);
    if (timer) clearTimeout(timer);
    return winner === 'timeout' ? null : (winner ?? bm25Hits);
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
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    const seen = new Set(bm25.map((t) => t.id));
    const injected: ToolMeta[] = [];
    for (const token of tokens) {
      const match = this.store.resolveAlias(token);
      if (match && !seen.has(match.id)) {
        injected.push(match);
        seen.add(match.id);
      }
    }
    if (injected.length === 0) return bm25;
    return [...injected, ...bm25].slice(0, limit);
  }
}
