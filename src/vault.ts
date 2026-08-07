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
    this.cascadeThreshold = cfg.cascadeThreshold ?? 1.0;
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
    }).catch(() => {
      // Background index build failure — fail open, leave semanticStale true for retry
    }).finally(() => {
      if (this.semanticBuildPromise === build) this.semanticBuildPromise = undefined;
    });
    this.semanticBuildPromise = build;
    return build;
  }

  /**
   * Fire-and-forget trigger to (re)build the semantic index. Safe to call
   * repeatedly — dedups via `semanticStale` + `semanticBuildPromise` guards.
   * Returns the in-flight build promise (which resolves when indexing
   * finishes), or undefined if no semantic matcher is configured or the
   * index is already up to date.
   *
   * Use this in hot paths (e.g. experimental.chat.system.transform) to
   * start model load BEFORE the first tool_search call so the user does
   * not perceive a freeze.
   */
  prebuildSemantic(): Promise<void> | undefined {
    if (!this.semantic) return undefined;
    if (!this.semanticStale) return undefined;
    return this.buildSemantic();
  }

  /** Inspection: is the semantic index currently up to date? */
  get isSemanticReady(): boolean {
    return !this.semantic || !this.semanticStale;
  }

  /** Inspection: is a semantic build currently in flight? */
  get isSemanticBuilding(): boolean {
    return Boolean(this.semanticBuildPromise);
  }

  async query(text: string, limit: number, timeoutMs = 0): Promise<ToolMeta[]> {
    // 1. BM25 fast-path — always run first (sub-ms).
    const bm25Hits = this.queryBM25(text, limit);

    // 2. If no semantic matcher, return BM25 directly.
    if (!this.semantic) return bm25Hits;

    // 3. Cascade gate: if BM25 top score exceeds the threshold, skip semantic inference.
    const topScore = bm25Hits.length > 0
      ? (this.scorer.query(text, 1)[0]?.score ?? 0)
      : 0;
    if (topScore >= this.cascadeThreshold) return bm25Hits;

    // If semantic index is cold/loading and BM25 already has results, return BM25 immediately
    // without waiting for timeoutMs, allowing prewarming to finish in background.
    if (!this.isSemanticReady && bm25Hits.length > 0) {
      this.prebuildSemantic();
      return bm25Hits;
    }

    // 4. Semantic fallback with RRF fusion. If `timeoutMs > 0`, race the
    //    build+inference against a timer — on timeout, return BM25
    //    immediately and let the background build continue.
    try {
      if (timeoutMs > 0) {
        const result = await this.runSemanticWithTimeout(text, bm25Hits, limit, timeoutMs);
        if (result) return result;
        // Timed out — BM25 already shown to user; build continues in background.
      } else {
        await this.buildSemantic();
        if (this.semanticStale) await this.buildSemantic();
        const semanticScores = await this.semantic.locate(text);
        if (semanticScores.size > 0) return this.fuseRRF(bm25Hits, semanticScores, limit);
      }
    } catch {
      // Internal recoverable error — fail open to BM25 without logging
    }
    return bm25Hits;
  }

  /**
   * Race semantic build+inference against a wall-clock timeout. Returns
   * the fused result list on success, or `null` on timeout. On timeout,
   * the in-flight build promise is intentionally left running so the
   * next query benefits from a warm cache.
   */
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
        await this.buildSemantic();
        if (this.semanticStale) await this.buildSemantic();
        const semanticScores = await this.semantic!.locate(text);
        if (semanticScores.size > 0) return this.fuseRRF(bm25Hits, semanticScores, limit);
        return bm25Hits;
      } catch {
        return bm25Hits;
      }
    })();
    try {
      const winner = await Promise.race([work, timeout]);
      if (timer) clearTimeout(timer);
      return winner === 'timeout' ? null : (winner ?? bm25Hits);
    } finally {
      // If work is still pending, do NOT cancel it — we want the build to
      // continue so subsequent calls pay no model-load cost.
    }
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
      const match = this.resolveAlias(token);
      if (match && !seen.has(match.id)) {
        injected.push(match);
        seen.add(match.id);
      }
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
    if (hits.length === 0 && pattern.includes('_ide')) {
      const ideStrippedPattern = pattern.replace(/(_ide)(\$?)$/, '$2');
      if (ideStrippedPattern !== pattern && /[a-zA-Z0-9]/.test(ideStrippedPattern)) {
        const aliasHits = this.grep(ideStrippedPattern, limit);
        for (const hit of aliasHits) {
          if (!hits.some((h) => h.id === hit.id)) hits.push(hit);
        }
      }
    }
    return hits;
  }

  resolveAlias(id: string): ToolMeta | undefined {
    const exact = this.store.get(id);
    if (exact) return exact;
    if (id.endsWith('_ide')) {
      return this.store.get(id.slice(0, -4));
    }
    return undefined;
  }

  get(id: string): ToolMeta | undefined { return this.store.get(id); }
  list(): ToolMeta[] { return Array.from(this.store.values()); }
  get count(): number { return this.store.size; }
}