import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isMainThread, Worker } from 'node:worker_threads';
import type { EmbedConfig } from './types.js';

type InferenceOpts = { pooling: string; normalize: boolean };

const DEFAULT_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

type ModelPipeline = (text: string | string[], opts: InferenceOpts) => Promise<{ data: Float32Array; dims?: number[] }>;

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
  private worker: Worker | null = null;
  private workerRequests = new Map<number, { resolve: (value: { data: Float32Array; dims?: number[] }) => void; reject: (error: Error) => void }>();
  private workerSequence = 0;

  constructor(private cfg: EmbedConfig) {}

  get isWorkerEnabled(): boolean {
    return Boolean(this.cfg.useWorker);
  }

  get isCacheEnabled(): boolean {
    return Boolean(this.cfg.cache || this.cfg.cacheDir !== undefined);
  }

  get workerAvailable(): boolean {
    return fs.existsSync(new URL('./matcher.worker.js', import.meta.url));
  }

  private computeHash(entries: IndexedEntry[]): string {
    const name = this.cfg.model ?? DEFAULT_MODEL;
    const hasher = crypto.createHash('sha256');
    hasher.update(name);
    if (this.cfg.quantized !== undefined) hasher.update(`:q=${this.cfg.quantized}`);
    if (this.cfg.dtype !== undefined) hasher.update(`:dtype=${this.cfg.dtype}`);
    for (const e of entries) {
      hasher.update(`:${e.id}:${e.text}`);
    }
    return hasher.digest('hex');
  }

  private getCacheFilePath(hash: string): string {
    if (this.cfg.cacheDir) {
      return this.cfg.cacheDir.endsWith('.json')
        ? this.cfg.cacheDir
        : path.join(this.cfg.cacheDir, `vectors-${hash}.json`);
    }
    return path.join('.cache', `vectors-${hash}.json`);
  }

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
      const name = this.cfg.model ?? DEFAULT_MODEL;
      const pipelineOpts: Record<string, unknown> = {};
      if (this.cfg.quantized !== undefined) pipelineOpts.quantized = this.cfg.quantized;
      if (this.cfg.dtype !== undefined) pipelineOpts.dtype = this.cfg.dtype;

      const opts = Object.keys(pipelineOpts).length > 0 ? pipelineOpts : undefined;
      this.model = (await mod.pipeline('feature-extraction', name, opts)) as unknown as ModelPipeline;
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

  private async runInference(
    texts: string | string[],
    opts: InferenceOpts,
  ): Promise<{ data: Float32Array; dims?: number[] }> {
    if (!this.model) throw new Error('Model pipeline not initialized');
    if (!this.isWorkerEnabled || !isMainThread) return this.model(texts, opts);

    const workerUrl = new URL('./matcher.worker.js', import.meta.url);
    if (!this.workerAvailable) throw new Error('Embedding worker module is unavailable');

    if (!this.worker) {
      this.worker = new Worker(workerUrl);
      this.worker.on('message', (message: { id: number; data?: Float32Array; dims?: number[]; error?: string }) => {
        const request = this.workerRequests.get(message.id);
        if (!request) return;
        this.workerRequests.delete(message.id);
        if (message.error || !message.data) request.reject(new Error(message.error ?? 'Worker inference failed'));
        else request.resolve({ data: message.data, dims: message.dims });
      });
      const rejectWorkerRequests = (error: Error): void => {
        for (const request of this.workerRequests.values()) request.reject(error);
        this.workerRequests.clear();
        this.worker = null;
      };
      this.worker.on('error', (error) => {
        rejectWorkerRequests(error instanceof Error ? error : new Error(String(error)));
      });
      this.worker.on('exit', (code) => {
        if (this.worker) rejectWorkerRequests(new Error(`Embedding worker exited with code ${code}`));
      });
    }

    const id = ++this.workerSequence;
    return new Promise<{ data: Float32Array; dims?: number[] }>((resolve, reject) => {
      this.workerRequests.set(id, { resolve, reject });
      this.worker!.postMessage({
        id,
        model: this.cfg.model ?? DEFAULT_MODEL,
        pipelineOptions: {
          ...(this.cfg.quantized === undefined ? {} : { quantized: this.cfg.quantized }),
          ...(this.cfg.dtype === undefined ? {} : { dtype: this.cfg.dtype }),
        },
        texts,
        options: opts,
      });
    }).catch((error: unknown) => {
      this.worker?.terminate();
      this.worker = null;
      if (this.model) return this.model(texts, opts);
      throw error;
    });
  }

  async index(entries: IndexedEntry[]): Promise<void> {
    let cacheFilePath = '';

    if (this.isCacheEnabled && entries.length > 0) {
      const hash = this.computeHash(entries);
      cacheFilePath = this.getCacheFilePath(hash);
      if (fs.existsSync(cacheFilePath)) {
        try {
          const content = fs.readFileSync(cacheFilePath, 'utf-8');
          const parsed = JSON.parse(content) as Record<string, number[]>;
          this.vectors.clear();
          for (const [id, vecArray] of Object.entries(parsed)) {
            this.vectors.set(id, this.normalize(new Float32Array(vecArray)));
          }
          return; // Skip ONNX this.model() inference entirely on cache hit!
        } catch {
          // Fall through on cache parse error
        }
      }
    }

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

    if (validEntries.length > 0) {
      const BATCH_SIZE = 32;
      for (let i = 0; i < validEntries.length; i += BATCH_SIZE) {
        const chunk = validEntries.slice(i, i + BATCH_SIZE);
        const texts = chunk.map((c) => c.text);

        try {
          const out = await this.runInference(texts, { pooling: 'mean', normalize: true });
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
              const out = await this.runInference(item.text, { pooling: 'mean', normalize: true });
              this.vectors.set(item.id, this.normalize(out.data));
            } catch {
              this.vectors.set(item.id, new Float32Array(this.dims));
            }
          }
        }
      }
    }

    if (this.isCacheEnabled && cacheFilePath) {
      const obj: Record<string, number[]> = {};
      for (const [id, vec] of this.vectors.entries()) {
        obj[id] = Array.from(vec);
      }
      const dir = path.dirname(cacheFilePath);
      fs.promises.mkdir(dir, { recursive: true })
        .then(() => fs.promises.writeFile(cacheFilePath, JSON.stringify(obj), 'utf-8'))
        .catch((err) => {
          console.warn('[tool-search] Vector disk cache save failed:', err);
        });
    }
  }

  async locate(text: string): Promise<Map<string, number>> {
    await this.open();
    if (!text.trim() || this.vectors.size === 0) return new Map();
    if (!this.model) return new Map();

    const q = text.toLowerCase().trim();
    const qv = this.normalize((await this.runInference(q, { pooling: 'mean', normalize: true })).data);
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
