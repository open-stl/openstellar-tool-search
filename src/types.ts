import type { McpServerConfig } from './mcp/types.js';

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
  /** Tools that are exempt from deferral (alias for `alwaysLoad`). */
  pinned?: string[];
  alwaysLoad?: string[];

  /** Maximum search results returned per query (alias for `searchLimit`). Default: 10. */
  maxResults?: number;
  searchLimit?: number;

  /** Operational search mode: 'hybrid' (BM25 + vectors) or 'keyword' (BM25 only). Default: 'hybrid'. */
  mode?: 'hybrid' | 'keyword';

  resetTools?: string[];
  bm25?: Partial<ScoreParams>;
  embedding?: {
    enabled?: boolean;
    model?: string;
    threshold?: number;
    quantized?: boolean;
    dtype?: string;
    cacheDir?: string;
    cache?: boolean;
    useWorker?: boolean;
  };
  deferDescription?: string;
  searchTimeoutMs?: number;
  mcpServers?: Record<string, McpServerConfig> | McpServerConfig[];
  mcp?: {
    servers?: Record<string, McpServerConfig> | McpServerConfig[];
    [key: string]: unknown;
  };
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
