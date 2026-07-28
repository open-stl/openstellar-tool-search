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
    if (typeof d.description === 'string' && d.description.trim().length > 0) {
      texts.push(d.description.trim());
    }
    if (d.type === 'object' || d.properties) {
      texts.push(...extractParamTexts(def, full));
    } else if (d.type === 'array' && d.items && typeof d.items === 'object') {
      texts.push(...extractParamTexts(d.items as Record<string, unknown>, full));
    }
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

  constructor(cfg: Partial<ScoreParams & { embedding?: EmbedConfig }> = {}) {
    this.scorerCfg = { k1: cfg.k1 ?? 0.9, b: cfg.b ?? 0.4 };
    this.scorer = new RankEngine<ToolMeta>(this.scorerCfg.k1, this.scorerCfg.b);
    if (cfg.embedding?.enabled) {
      this.semantic = new SemanticMatcher(cfg.embedding);
    }
  }

  private getValidAliases(id: string): string[] {
    if (id.endsWith('_ide')) return [];
    const candidate = `${id}_ide`;
    if (!this.store.has(candidate)) {
      return [candidate];
    }
    return [];
  }

  private withAliases(meta: ToolMeta): ToolMeta {
    const validAliases = this.getValidAliases(meta.id);
    return {
      ...meta,
      aliases: validAliases,
    };
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

  private buildScorer(): void {
    if (!this.scorerStale) return;
    const items = Array.from(this.store.values());
    this.scorer = new RankEngine<ToolMeta>(this.scorerCfg.k1, this.scorerCfg.b);
    this.scorer.feed(items, (e) => {
      const validAliases = this.getValidAliases(e.id);
      const fields = [e.id, ...validAliases, e.description];
      if (e.parameters) fields.push(...extractParamTexts(e.parameters));
      return fields;
    });
    this.scorerStale = false;
  }

  private buildSemantic(): Promise<void> {
    if (!this.semantic || !this.semanticStale) return Promise.resolve();
    if (this.semanticBuildPromise) return this.semanticBuildPromise;

    const generation = this.semanticGeneration;
    const items = Array.from(this.store.values());
    const indexed = items.map((e) => {
      const validAliases = this.getValidAliases(e.id);
      return {
        id: e.id,
        text: [e.id, ...validAliases, e.description, ...extractParamTexts(e.parameters)].join(' '),
      };
    });
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
    if (this.semantic) {
      try {
        await this.buildSemantic();
        if (this.semanticStale) await this.buildSemantic();
        const scores = await this.semantic.locate(text);
        if (scores.size > 0) {
          return Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([id]) => {
              const item = this.store.get(id);
              return item ? this.withAliases(item) : undefined;
            })
            .filter((item): item is ToolMeta => Boolean(item));
        }
      } catch (err) {
        console.warn('[tool-search] Embedding search failed, falling back to BM25:', err);
      }
    }
    return this.queryBM25(text, limit);
  }

  queryBM25(text: string, limit: number): ToolMeta[] {
    this.buildScorer();
    return this.scorer.query(text, limit).map((r) => this.withAliases(r.item));
  }

  grep(pattern: string, limit: number): ToolMeta[] {
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      return [];
    }
    const hits: ToolMeta[] = [];
    const testMatch = (target: string): boolean => {
      if (!target) return false;
      re.lastIndex = 0;
      return re.test(target);
    };
    for (const e of this.store.values()) {
      const item = this.withAliases(e);
      const matchesId = testMatch(item.id);
      const matchesAlias = item.aliases ? item.aliases.some((alias) => testMatch(alias)) : false;
      const matchesDesc = testMatch(item.description);

      if (matchesId || matchesAlias || matchesDesc) {
        hits.push(item);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  get(id: string): ToolMeta | undefined {
    const direct = this.store.get(id);
    if (direct) {
      return this.withAliases(direct);
    }
    if (id.endsWith('_ide')) {
      const canonicalId = id.slice(0, -4);
      const canonical = this.store.get(canonicalId);
      if (canonical) {
        const validAliases = this.getValidAliases(canonical.id);
        if (validAliases.includes(id)) {
          return this.withAliases(canonical);
        }
      }
    }
    return undefined;
  }

  list(): ToolMeta[] {
    return Array.from(this.store.values()).map((e) => this.withAliases(e));
  }

  get count(): number {
    return this.store.size;
  }
}
