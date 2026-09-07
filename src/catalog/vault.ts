import type { ToolMeta, ScoreParams, EmbedConfig } from '../types.js';
import type { ToolProvider } from './tool-provider.js';
import { ToolStore } from './tool-store.js';
import { DualSearchEngine } from './search-engine.js';

/**
 * Single caller-facing seam for the Tool Vault and search.
 *
 * ToolVault owns two deep modules behind it — `ToolStore` (vault storage,
 * parameter text extraction, alias resolution) and `DualSearchEngine`
 * (BM25, semantic matcher, RRF fusion, cascade gates) — and exposes only the
 * operations the plugin needs: ingest, await readiness, discover (dual search
 * query or regex grep), resolve aliases, and semantic prebuild. Vault
 * invalidation is centralized in the constructor wiring: every changed add
 * fires exactly one `engine.notifyChanged()`, so `add`/`registerProvider`
 * must not notify the engine again.
 */
export class ToolVault {
  private store: ToolStore;
  private engine: DualSearchEngine;

  constructor(cfg: Partial<ScoreParams & { embedding?: EmbedConfig }> = {}) {
    this.store = new ToolStore();
    this.engine = new DualSearchEngine(this.store, cfg);
    this.store.onChanged(() => this.engine.notifyChanged());
  }

  add(id: string, description: string, parameters: unknown): void {
    this.store.add(id, description, parameters);
  }

  remove(id: string): boolean {
    return this.store.remove(id);
  }

  async registerProvider(provider: ToolProvider): Promise<void> {
    await this.store.registerProvider(provider);
  }

  awaitReady(timeoutMs?: number): Promise<boolean> {
    return this.store.awaitReady(timeoutMs);
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
