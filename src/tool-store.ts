import type { ToolMeta } from './types.js';

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
 * Deep module that owns tool catalog storage, alias resolution (`_ide` suffix),
 * parameter text extraction, and regex searching (`grep`).
 */
export class ToolStore {
  private store = new Map<string, ToolMeta>();

  /**
   * Add or update a tool definition. Returns `true` if a new tool was added
   * or an existing tool's description was updated.
   */
  add(id: string, description: string, parameters: unknown): boolean {
    const old = this.store.get(id);
    if (old && (description === null || description === undefined)) return false;
    const safe = description ?? '';
    if (!old || old.description !== safe) {
      this.store.set(id, { id, description: safe, parameters });
      return true;
    }
    return false;
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
