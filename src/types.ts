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

  /** Maximum search results returned per query. Default: 5 */
  maxResults?: number;

  /** Search mode: 'hybrid' (BM25 + vectors) or 'keyword' (BM25 only). Default: 'hybrid' */
  mode?: 'hybrid' | 'keyword';

  /** Tools exempt from authorization resets (e.g. ['compress']). Default: ['compress'] */
  resetTools?: string[];

  /**
   * MCP server configurations in the OpenCode v2 `mcp.servers` wrapper:
   * `mcp: { servers: { "<name>": {...} } }`. The legacy bare server-map shape
   * (`mcp: { "<name>": {...} }`) is REJECTED with a warning — this plugin
   * follows OpenCode v2's `mcp.servers` convention.
   */
  mcp?: { servers: Record<string, McpServerConfig> };

  /**
   * MCP pre-warm/per-server timeout (ms): each MCP server must settle within
   * it or is cut (fail-open, tools unavailable; a console.warn names it). The
   * factory waits for ALL enabled servers to settle/cut before returning, so
   * MCP tools are registered BEFORE opencode snapshots the session tool-set
   * (~0-2s). Default: 60s (DEFAULT_WARMUP_TIMEOUT_MS).
   */
  timeout?: number;
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
