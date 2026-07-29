export interface ToolMeta {
  id: string;
  description: string;
  parameters: unknown;
}

export interface Hit<T> {
  item: T;
  score: number;
}

export interface ToolSearchConfig {
  alwaysLoad?: string[];
  resetTools?: string[];
}

/** Internal lexical ranking parameters. Not part of the public plugin config. */
export interface ScoreParams {
  k1: number;
  b: number;
}

/** Internal semantic search parameters. Not part of the public plugin config. */
export interface EmbedConfig {
  enabled: boolean;
  model?: string;
  threshold?: number;
}
