import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isMainThread, Worker } from 'node:worker_threads';
import { pipelineOptions } from '../types.js';
import type { EmbedConfig } from '../types.js';

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
  private workerReady = false;
  private workerInitFailed = false;

  constructor(private cfg: EmbedConfig) {}

  get isWorkerEnabled(): boolean {
    return Boolean(this.cfg.useWorker);
  }

  get isCacheEnabled(): boolean {
    return Boolean(this.cfg.cache || this.cfg.cacheDir !== undefined);
  }

  get workerAvailable(): boolean {
    return fs.existsSync(new URL('./matcher.worker.js', import.meta.url)) || fs.existsSync(new URL('./matcher.worker.js', import.meta.url));
  }

  private computeHash(entries: IndexedEntry[]): string {
    const name = this.cfg.model ?? DEFAULT_MODEL;
    const hasher = crypto.createHash('sha256');
    hasher.update(name);
    const popts = pipelineOptions(this.cfg);
    if (popts.quantized !== undefined) hasher.update(`:q=${popts.quantized}`);
    if (popts.dtype !== undefined) hasher.update(`:dtype=${popts.dtype}`);
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
    if (this.isWorkerEnabled) {
      if (this.workerReady) return;
      if (this.workerInitFailed || this.loadError) return;
      if (this.loadPromise) return this.loadPromise;
      this.loadPromise = this.doLoadWorker();
      return this.loadPromise;
    }

    if (this.model) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoadWorker(): Promise<void> {
    const workerUrl = fs.existsSync(new URL('./matcher.worker.js', import.meta.url))
      ? new URL('./matcher.worker.js', import.meta.url)
      : new URL('./matcher.worker.js', import.meta.url);
    if (!this.workerAvailable) {
      this.loadError = new Error('Embedding worker module is unavailable');
      this.workerInitFailed = true;
      return;
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const rejectWorkerRequests = (error: Error): void => {
        for (const request of this.workerRequests.values()) request.reject(error);
        this.workerRequests.clear();
      };

      try {
        this.worker = new Worker(workerUrl);
        this.worker.unref();
      } catch (err) {
        this.loadError = err instanceof Error ? err : new Error(String(err));
        this.workerInitFailed = true;
        finish();
        return;
      }

      this.worker.on('message', (message: {
        type?: string;
        id?: number;
        data?: Float32Array;
        dims?: number[];
        error?: string;
        message?: string;
      }) => {
        if (message.type === 'ready') {
          this.workerReady = true;
          this.workerInitFailed = false;
          finish();
          return;
        }

        if (message.type === 'error') {
          this.workerInitFailed = true;
          this.loadError = new Error(message.message ?? 'Worker initialization failed');
          this.workerReady = false;
          rejectWorkerRequests(this.loadError);
          this.worker?.terminate();
          this.worker = null;
          finish();
          return;
        }

        if (message.id !== undefined) {
          const request = this.workerRequests.get(message.id);
          if (!request) return;
          this.workerRequests.delete(message.id);
          if (message.error || !message.data) request.reject(new Error(message.error ?? 'Worker inference failed'));
          else request.resolve({ data: message.data, dims: message.dims });
        }
      });

      this.worker.on('error', (error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        this.loadError = err;
        this.workerInitFailed = true;
        this.workerReady = false;
        rejectWorkerRequests(err);
        this.worker?.terminate();
        this.worker = null;
        finish();
      });

      this.worker.on('exit', (code) => {
        if (this.worker) {
          const err = new Error(`Embedding worker exited with code ${code}`);
          this.loadError = err;
          this.workerInitFailed = true;
          this.workerReady = false;
          rejectWorkerRequests(err);
          this.worker = null;
          finish();
        }
      });

      this.worker.postMessage({
        type: 'init',
        model: this.cfg.model ?? DEFAULT_MODEL,
        pipelineOptions: pipelineOptions(this.cfg),
      });
    });
  }

  private async doLoad(): Promise<void> {
    try {
      const { env, pipeline } = await import('@xenova/transformers');
      (env as Record<string, unknown>).logLevel = 'error';
      if (env.backends?.onnx) {
        env.backends.onnx.logLevel = 'error';
      }
      const name = this.cfg.model ?? DEFAULT_MODEL;
      const opts = pipelineOptions(this.cfg);

      this.model = (await pipeline('feature-extraction', name, Object.keys(opts).length > 0 ? opts : undefined)) as unknown as ModelPipeline;
    } catch (e) {
      this.loadError = e as Error;
      this.loadPromise = null;
    }
  }

  get active(): boolean {
    if (this.isWorkerEnabled) {
      return this.workerReady && !this.workerInitFailed;
    }
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
    if (this.isWorkerEnabled && isMainThread) {
      if (!this.workerReady || !this.worker) {
        throw new Error('Worker not ready or initialized');
      }

      const id = ++this.workerSequence;
      return new Promise<{ data: Float32Array; dims?: number[] }>((resolve, reject) => {
        this.workerRequests.set(id, { resolve, reject });
        this.worker!.postMessage({
          type: 'inference',
          id,
          texts,
          options: opts,
        });
      });
    }

    if (!this.model) throw new Error('Model pipeline not initialized');
    return this.model(texts, opts);
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
          return; // Skip ONNX inference entirely on cache hit!
        } catch {
          // Fall through on cache parse error
        }
      }
    }

    await this.open();
    if (!this.active) return; // model/worker failed to load — skip semantic, caller falls back to BM25
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
      const chunks: { id: string; text: string }[][] = [];
      for (let i = 0; i < validEntries.length; i += BATCH_SIZE) {
        chunks.push(validEntries.slice(i, i + BATCH_SIZE));
      }

      const chunkTasks = chunks.map(async (chunk) => {
        const texts = chunk.map((c) => c.text);
        const out = await this.runInference(texts, { pooling: 'mean', normalize: true });
        return { chunk, out };
      });

      const results = await Promise.allSettled(chunkTasks);
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res.status === 'fulfilled') {
          const { chunk, out } = res.value;
          const data = out.data;
          const count = chunk.length;
          const d = (out.dims && out.dims.length >= 2)
            ? out.dims[out.dims.length - 1]
            : Math.floor(data.length / count);

          for (let k = 0; k < count; k++) {
            const rawVec = data.subarray(k * d, (k + 1) * d);
            this.vectors.set(chunk[k].id, this.normalize(rawVec));
          }
        } else {
          this.loadError = res.reason instanceof Error ? res.reason : new Error(String(res.reason));
          for (const item of chunks[i]) {
            this.vectors.set(item.id, new Float32Array(this.dims));
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
        .catch(() => {});
    }
  }

  async locate(text: string): Promise<Map<string, number>> {
    await this.open();
    if (!text.trim() || this.vectors.size === 0) return new Map();
    if (!this.active) return new Map();

    try {
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
    } catch (err) {
      this.loadError = err instanceof Error ? err : new Error(String(err));
      return new Map();
    }
  }
}
