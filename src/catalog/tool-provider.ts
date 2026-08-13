import type { ToolMeta } from '../types.js';

export interface ToolDefinition extends ToolMeta {
  deferred?: boolean;
}

/**
 * Seam for tool sources (static local tools or dynamic external MCP servers).
 */
export interface ToolProvider {
  /** Uniquely identifies the provider instance (e.g. 'mcp:filesystem'). */
  id?: string;

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
   * Resolves `true` when the provider has settled (ready / warm-up complete,
   * or nothing to warm up); resolves `false` when `timeoutMs` elapsed first —
   * the provider is still warming up.
   */
  awaitReady?(timeoutMs?: number): Promise<boolean>;
}
