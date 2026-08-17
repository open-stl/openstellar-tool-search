import type { ToolMeta } from '../types.js';
import type { ToolProvider } from './tool-provider.js';

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

/**
 * Deep module that owns Tool Vault storage, alias resolution (`_ide` suffix),
 * parameter text extraction, and regex searching (`grep`).
 */
export class ToolStore {
  private store = new Map<string, ToolMeta>();
  private providers: ToolProvider[] = [];
  private changeListeners: (() => void)[] = [];

  onChanged(callback: () => void): void {
    this.changeListeners.push(callback);
  }

  private notifyChanged(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  /**
   * Add or update a tool definition. Returns `true` if a new tool was added
   * or an existing tool's description was updated.
   */
  add(id: string, description: string, parameters: unknown): boolean {
    const old = this.store.get(id);
    if (old && (description === null || description === undefined)) return false;
    const safe = description ?? '';

    // Guard against overwriting stored full descriptions with truncated `[deferred]` descriptions
    // when tool.definition runs multiple times across turns
    if (old && !old.description.includes('[deferred]') && safe.includes('[deferred]')) {
      return false;
    }

    if (!old || old.description !== safe) {
      this.store.set(id, { id, description: safe, parameters });
      this.notifyChanged();
      return true;
    }
    return false;
  }

  /**
   * Remove a tool definition (e.g. a placeholder that must disappear once
   * warm-up settles). Returns `true` if a tool was actually removed; notifies
   * change listeners so the search index drops the stale entry.
   */
  remove(id: string): boolean {
    const existed = this.store.delete(id);
    if (existed) this.notifyChanged();
    return existed;
  }

  prepareIndexedText(entry: ToolMeta): string {
    const fields = [entry.id, entry.description];
    if (entry.parameters) fields.push(...extractParamTexts(entry.parameters));
    return fields.join(' ');
  }

  grep(pattern: string, limit: number): ToolMeta[] {
    let re: RegExp;
    try { re = new RegExp(pattern, 'i'); } catch { return []; }
    const hits: ToolMeta[] = [];
    for (const item of this.store.values()) {
      re.lastIndex = 0;
      const matchesId =
        re.test(item.id) ||
        re.test(item.id.replace(/[-_]/g, '_')) ||
        re.test(item.id.replace(/[-_]/g, '-'));
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
      const match = this.store.get(id.slice(0, -4));
      if (match) return match;
    }
    const normalized = id.replace(/[-_]/g, '_');
    for (const [key, val] of this.store.entries()) {
      if (key.replace(/[-_]/g, '_') === normalized) {
        return val;
      }
    }
    for (const [key, val] of this.store.entries()) {
      if (key.endsWith(`_${id}`) || key.endsWith(`-${id}`)) {
        return val;
      }
    }
    return undefined;
  }

  get(id: string): ToolMeta | undefined { return this.store.get(id); }
  list(): ToolMeta[] { return Array.from(this.store.values()); }
  get count(): number { return this.store.size; }

  /**
   * Register a ToolProvider and index its tools. Subscribes to updates if supported.
   */
  async registerProvider(provider: ToolProvider): Promise<void> {
    this.providers.push(provider);
    const tools = await provider.getTools();
    for (const tool of tools) {
      this.add(tool.id, tool.description, tool.parameters);
    }
    if (provider.onUpdate) {
      provider.onUpdate((updatedTools) => {
        for (const tool of updatedTools) {
          this.add(tool.id, tool.description, tool.parameters);
        }
      });
    }
  }

  /**
   * Await readiness on all registered providers.
   * Resolves `true` when every provider is ready (vacuously true when no
   * providers are registered); `false` when any provider is still warming up
   * after `timeoutMs` (its awaitReady returned false).
   */
  async awaitReady(timeoutMs?: number): Promise<boolean> {
    const results = await Promise.all(
      this.providers.map((p) => (p.awaitReady ? p.awaitReady(timeoutMs) : Promise.resolve(true))),
    );
    return results.every((ready) => ready === true);
  }
}
