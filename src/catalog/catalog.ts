import type { BM25Config, CatalogEntry, SearchResult } from '../shared/index.js';
import { flattenParameterKeys } from '../shared/index.js';
import { createIndex, search } from '../engine/index.js';
import type { Index } from '../engine/index.js';

/**
 * Lazy-indexed tool catalog.
 * Tools are registered via `register()` and the BM25 index is rebuilt
 * on demand when `search()` is called after a change.
 */
export class Catalog {
  private entries = new Map<string, CatalogEntry>();
  private bm25Config: BM25Config;
  private indexDirty = true;
  private cachedIndex: Index<CatalogEntry> | null = null;

  constructor(config: Partial<BM25Config> = {}) {
    this.bm25Config = {
      k1: config.k1 ?? 0.9,
      b: config.b ?? 0.4,
    };
  }

  /**
   * Registers or updates a tool entry.
   * Never overwrites a valid description with null/undefined.
   */
  register(id: string, description: string, parameters: unknown): void {
    const existing = this.entries.get(id);
    // Never overwrite a valid description with null/undefined
    if (existing && (description === null || description === undefined)) {
      return;
    }
    const safeDescription = description ?? '';
    if (!existing || existing.description !== safeDescription) {
      this.entries.set(id, { id, description: safeDescription, parameters });
      this.indexDirty = true;
    }
  }

  /**
   * BM25 keyword search across tool IDs, descriptions, and parameter names.
   */
  search(query: string, limit: number): CatalogEntry[] {
    const index = this.getIndex();
    return search(index, query, limit).map((r: SearchResult<CatalogEntry>) => r.item);
  }

  /**
   * Case-insensitive regex search across tool IDs and descriptions.
   */
  searchRegex(pattern: string, limit: number): CatalogEntry[] {
    const regex = new RegExp(pattern, 'i');
    const items = Array.from(this.entries.values());
    return items
      .filter((e) => regex.test(e.id) || regex.test(e.description ?? ''))
      .slice(0, limit);
  }

  /**
   * Retrieves a tool entry by ID.
   */
  get(id: string): CatalogEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Number of registered tool entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Gets or lazily rebuilds the BM25 index.
   */
  private getIndex(): Index<CatalogEntry> {
    if (this.indexDirty || !this.cachedIndex) {
      const items = Array.from(this.entries.values());
      this.cachedIndex = createIndex(
        items,
        (entry) => {
          const fields = [entry.id, entry.description ?? ''];
          if (entry.parameters) {
            fields.push(...flattenParameterKeys(entry.parameters));
          }
          return fields;
        },
        this.bm25Config,
      );
      this.indexDirty = false;
    }
    return this.cachedIndex;
  }
}
