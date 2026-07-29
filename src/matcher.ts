import type { EmbedConfig } from './types.js';

type ModelPipeline = (text: string | string[], opts: {
  pooling: string;
  normalize: boolean;
}) => Promise<{ data: Float32Array; dims?: number[] }>;

export interface IndexedEntry {
  id: string;
  text: string;
}

export class SemanticMatcher {
  private model: ModelPipeline | null = null;
  private vectors = new Map<string, Float32Array>();
  private dims = 384;
  private loadError: Error | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private cfg: EmbedConfig) {}

  private normalize(vec: Float32Array): Float32Array {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    const norm = Math.sqrt(sum);
    if (norm === 0) return vec;
    const out = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
    return out;
  }

  private cosine(a: Float32Array, b: Float32Array): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d === 0 ? 0 : dot / d;
  }

  async open(): Promise<void> {
    if (this.model) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    try {
      const mod = await import('@xenova/transformers');
      const name = this.cfg.model ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
      this.model = (await mod.pipeline('feature-extraction', name)) as unknown as ModelPipeline;
    } catch (e) {
      this.loadError = e as Error;
      this.loadPromise = null;
    }
  }

  get active(): boolean {
    return this.model !== null;
  }

  get fault(): Error | null {
    return this.loadError;
  }

  get entryCount(): number {
    return this.vectors.size;
  }

  async index(entries: IndexedEntry[]): Promise<void> {
    await this.open();
    if (!this.model) return; // model failed to load — skip semantic, caller falls back to BM25
    this.vectors.clear();

    if (entries.length === 0) return;

    const validEntries: { id: string; text: string }[] = [];
    for (const e of entries) {
      const txt = e.text.toLowerCase().trim();
      if (!txt) {
        this.vectors.set(e.id, new Float32Array(this.dims));
      } else {
        validEntries.push({ id: e.id, text: txt });
      }
    }

    if (validEntries.length === 0) return;

    const BATCH_SIZE = 32;
    for (let i = 0; i < validEntries.length; i += BATCH_SIZE) {
      const chunk = validEntries.slice(i, i + BATCH_SIZE);
      const texts = chunk.map((c) => c.text);

      try {
        const out = await this.model(texts, { pooling: 'mean', normalize: true });
        const data = out.data;
        const count = chunk.length;
        const d = (out.dims && out.dims.length >= 2)
          ? out.dims[out.dims.length - 1]
          : Math.floor(data.length / count);

        for (let k = 0; k < count; k++) {
          const rawVec = data.subarray(k * d, (k + 1) * d);
          this.vectors.set(chunk[k].id, this.normalize(rawVec));
        }
      } catch (err) {
        for (const item of chunk) {
          try {
            const out = await this.model(item.text, { pooling: 'mean', normalize: true });
            this.vectors.set(item.id, this.normalize(out.data));
          } catch {
            this.vectors.set(item.id, new Float32Array(this.dims));
          }
        }
      }
    }
  }

  async locate(text: string): Promise<Map<string, number>> {
    await this.open();
    if (!text.trim() || this.vectors.size === 0) return new Map();
    if (!this.model) return new Map();

    const q = text.toLowerCase().trim();
    const qv = this.normalize((await this.model!(q, { pooling: 'mean', normalize: true })).data);
    const baseThreshold = this.cfg.threshold ?? 0.3;

    const sweep = (minScore: number): Map<string, number> => {
      const out = new Map<string, number>();
      for (const [id, vec] of this.vectors) {
        const score = this.cosine(qv, vec);
        if (score >= minScore) out.set(id, score);
      }
      return out;
    };

    const results = sweep(baseThreshold);
    if (results.size < 2) {
      const relaxed = sweep(baseThreshold * 0.7);
      return relaxed.size > 0 ? relaxed : results;
    }
    return results;
  }
}
