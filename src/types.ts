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
