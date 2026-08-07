import type { ToolMeta, ScoreParams, EmbedConfig } from './types.js';
import { ToolStore } from './tool-store.js';
import { HybridSearchEngine } from './search-engine.js';

/**
 * High-level facade for tool catalog storage and hybrid search execution.
 * Delegating to deep modules `ToolStore` (catalog storage, parameter text extraction,
 * alias resolution) and `HybridSearchEngine` (BM25, Semantic matcher, RRF fusion, cascade gates).
 */
export class ToolVault {
  private store: ToolStore;
  private engine: HybridSearchEngine;

  constructor(cfg: Partial<ScoreParams & { embedding?: EmbedConfig }> = {}) {
    this.store = new ToolStore();
    this.engine = new HybridSearchEngine(this.store, cfg);
  }

  add(id: string, description: string, parameters: unknown): void {
    if (this.store.add(id, description, parameters)) {
      this.engine.notifyChanged();
    }
  }

  prebuildSemantic(): Promise<void> | undefined {
    return this.engine.prebuildSemantic();
  }

  get isSemanticReady(): boolean {
    return this.engine.isSemanticReady;
  }

  get isSemanticBuilding(): boolean {
    return this.engine.isSemanticBuilding;
  }

  query(text: string, limit: number, timeoutMs = 0): Promise<ToolMeta[]> {
    return this.engine.query(text, limit, timeoutMs);
  }

  queryBM25(text: string, limit: number): ToolMeta[] {
    return this.engine.queryBM25(text, limit);
  }

  grep(pattern: string, limit: number): ToolMeta[] {
    return this.store.grep(pattern, limit);
  }

  resolveAlias(id: string): ToolMeta | undefined {
    return this.store.resolveAlias(id);
  }

  get(id: string): ToolMeta | undefined { return this.store.get(id); }
  list(): ToolMeta[] { return this.store.list(); }
  get count(): number { return this.store.count; }
}
