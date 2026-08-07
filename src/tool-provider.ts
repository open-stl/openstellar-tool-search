import type { ToolMeta } from './types.js';

export interface ToolDefinition extends ToolMeta {
  deferred?: boolean;
}

/**
 * Seam for tool sources (static local tools or dynamic external MCP servers).
 */
export interface ToolProvider {
  /**
   * Return current tool definitions provided by this source.
   */
  getTools(): Promise<ToolDefinition[]> | ToolDefinition[];

  /**
   * Register callback for when tool definitions update dynamically.
   */
  onUpdate?(callback: (tools: ToolDefinition[]) => void): void;

  /**
   * Await until provider is ready or warm-up finishes.
   */
  awaitReady?(timeoutMs?: number): Promise<void>;
}
