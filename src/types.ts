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
  /** Tool IDs exempt from deferral (full descriptions always loaded). Default: [] */
  alwaysLoad?: string[];

  /** Maximum search results returned per query. Default: 10 */
  maxResults?: number;

  /** Search mode: 'hybrid' (BM25 + vectors) or 'keyword' (BM25 only). Default: 'hybrid' */
  mode?: 'hybrid' | 'keyword';

  /** Tools exempt from authorization resets (e.g. ['compress']). Default: ['compress'] */
  resetTools?: string[];

  /** MCP server configurations matching OpenCode's native format. */
  mcp?: Record<string, McpServerConfig>;
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
