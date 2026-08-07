export interface ToolMeta {
  id: string;
  description: string;
  parameters: unknown;
}

export interface ScoreParams {
  k1: number;
  b: number;
  cascadeThreshold?: number;
}

export interface Hit<T> {
  item: T;
  score: number;
}

export interface ToolSearchConfig {
  alwaysLoad?: string[];
  resetTools?: string[];
  bm25?: Partial<ScoreParams>;
  embedding?: {
    enabled: boolean;
    model?: string;
    threshold?: number;
    quantized?: boolean;
    dtype?: string;
    cacheDir?: string;
    cache?: boolean;
    useWorker?: boolean;
  };
  searchLimit?: number;
  deferDescription?: string;
  /**
   * Maximum time (ms) to wait for the semantic (transformer) index before
   * falling back to BM25 in tool_search. Default 2000 (2s).
   *
   * First call after plugin load triggers @xenova/transformers model
   * download + ONNX init (~5-10s on cold cache). Without a timeout, the
   * user sees a silent freeze while the model loads.
   *
   * If the timeout elapses, BM25 results are returned immediately and the
   * semantic index continues to build in the background. Subsequent
   * tool_search calls within the same process will already have a warm
   * index and pay no penalty.
   *
   * Set to 0 to disable the timeout (wait indefinitely — original behavior).
   */
  searchTimeoutMs?: number;
}

export interface EmbedConfig {
  enabled: boolean;
  model?: string;
  threshold?: number;
  quantized?: boolean;
  dtype?: string;
  cacheDir?: string;
  cache?: boolean;
  useWorker?: boolean;
}

/** Build the `{ quantized?, dtype? }` shape for the ONNX pipeline. */
export function pipelineOptions(cfg: Pick<EmbedConfig, 'quantized' | 'dtype'>): { quantized?: boolean; dtype?: string } {
  const opts: { quantized?: boolean; dtype?: string } = {};
  opts.quantized = cfg.quantized ?? false;
  if (cfg.dtype !== undefined) opts.dtype = cfg.dtype;
  return opts;
}
