export interface ToolMeta {
  id: string;
  description: string;
  parameters: unknown;
}

export interface ScoreParams {
  k1: number;
  b: number;
}

export interface Hit<T> {
  item: T;
  score: number;
}

export interface ToolSearchConfig {
  alwaysLoad?: string[];
  bm25?: Partial<ScoreParams>;
  embedding?: {
    enabled: boolean;
    model?: string;
    threshold?: number;
  };
  searchLimit?: number;
  deferDescription?: string;
}

export interface EmbedConfig {
  enabled: boolean;
  model?: string;
  threshold?: number;
}
