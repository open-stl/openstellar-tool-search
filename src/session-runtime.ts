import type { PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { ToolVault } from './vault.js';
import type { ToolMeta, EmbedConfig } from './types.js';
import { SessionToolRegistry } from './session-tool-registry.js';
import { toast } from './hooks/toast.js';
import { truncateDescription } from './hooks/deferral.js';

export const SEARCH_IDS = new Set(['tool_search', 'tool_search_regex']);
export const DEFAULT_DEFER = '[deferred]';
export const MAX_REGEX_PATTERN_LENGTH = 200;
export const SEARCH_TIMEOUT_MS = 2000;
export const MAX_QUERY_LENGTH = 500;
/**
 * Second-phase budget granted when the first phase found no hits while the
 * catalog was still warming up: gives a slow-but-alive MCP server time to
 * finish its handshake before the search reports the tool as missing.
 */
export const EXTENDED_WAIT_MS = 3000;

/**
 * Returned instead of "No matches ..." when a search found no hits and the
 * catalog is still warming up: a negative result at this point would be read
 * by the model as "the tool does not exist", when in truth the MCP servers
 * simply have not finished their handshake yet.
 */
export const WARMING_MESSAGE =
  'Tool catalog still warming up (MCP servers not ready after ~5s). The tool may exist — retry this search in a few seconds.';

/**
 * Strips line breaks from the defer label before it is interpolated into
 * the system prompt (policy block and search-tool descriptions). Prevents
 * a crafted label from injecting prompt lines.
 */
export function sanitizeDeferLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ');
}

export interface SessionRuntimeOptions {
  alwaysOn: Iterable<string>;
  resetTools: Iterable<string>;
  maxResults: number;
  deferLabel: string;
  embedding: EmbedConfig;
}

export interface SystemPromptState {
  total: number;
  deferrals: number;
  policyText: string;
  alert: { title: string; message: string; variant: 'info'; duration: number } | null;
}

/**
 * Core runtime for the tool-search plugin.
 *
 * Owns the tool catalog (ToolVault), the per-session authorization and
 * delivery state (SessionToolRegistry), and the deferred-tool bookkeeping
 * surfaced to the model prompt. Exposes the search tools the plugin wires
 * into OpenCode, plus the operations the plugin hooks delegate to.
 */
export class SessionRuntime {
  public readonly vault: ToolVault;
  public readonly sessionRegistry: SessionToolRegistry;
  public readonly searchTools: Record<string, ReturnType<typeof tool>>;

  private readonly maxResults: number;
  private readonly deferLabel: string;
  private readonly useWorker: boolean;
  private alerted = false;

  public constructor(
    private readonly ctx: PluginInput,
    options: SessionRuntimeOptions,
  ) {
    this.maxResults = options.maxResults;
    this.deferLabel = sanitizeDeferLabel(options.deferLabel);
    this.useWorker = options.embedding.useWorker ?? false;
    this.vault = new ToolVault({ embedding: options.embedding });
    this.sessionRegistry = new SessionToolRegistry({
      alwaysOn: options.alwaysOn,
      resetTools: options.resetTools,
    });
    this.searchTools = this.buildSearchTools();
  }

  public get totalTools(): number {
    return this.vault.count;
  }

  public get deferredCount(): number {
    return this.sessionRegistry.deferredCount;
  }

  /**
   * Register a tool definition into the catalog. Returns the description to
   * show in the tool.definition output: the deferred form (first sentence +
   * label) for newly deferred tools, or the original description untouched.
   * The catalog stores the parameter object by reference (never cloned).
   */
  public deferTool(toolID: string, description: string, parameters: unknown): string {
    this.vault.add(toolID, description, parameters);
    if (this.sessionRegistry.registerTool(toolID)) {
      return truncateDescription(description, this.deferLabel);
    }
    return description;
  }

  /**
   * Resolve the canonical tool ID for an executed (possibly cloaked `_ide`)
   * tool name, then ask the session registry whether the model must be
   * reminded to search first. Throws when the tool is not authorized.
   */
  public assertAuthorized(executedTool: string, sessionID: string | undefined, canonicalTool: string): void {
    const sessionKey = sessionID ?? 'default';
    if (this.sessionRegistry.requiresReminder(sessionID, executedTool, canonicalTool)) {
      throw new Error(
        `[Tool Search Required] Tool "${executedTool}" has not been searched in session "${sessionKey}". Call tool_search_regex({ pattern: "^${canonicalTool}$" }) or tool_search to inspect full description and parameter schema before calling this tool.`,
      );
    }
  }

  /** Reset authorizations for a session when a configured reset tool executes. */
  public handleToolExecuted(toolID: string, sessionID: string | undefined): string | null {
    if (!this.sessionRegistry.resetIfConfigured(toolID, sessionID)) return null;
    return `\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.`;
  }

  /**
   * Refresh deferral counts and kick off the semantic prebuild. Returns the
   * static policy text (when any tools are deferred) plus a one-time deferral
   * toast; the caller appends the text to the system prompt.
   */
  public prepareForSystemTransform(): SystemPromptState {
    const total = this.vault.count;
    const deferrals = this.sessionRegistry.deferredCount;

    const buildPromise = this.useWorker ? this.vault.prebuildSemantic() : undefined;
    if (buildPromise) {
      buildPromise.catch((err: unknown) => {
        toast(
          this.ctx,
          'Tool Search',
          `Semantic search unavailable (${err instanceof Error ? err.message : 'unknown error'}). Falling back to keyword search.`,
          'warning',
          6000,
        );
      });
    }

    let alert: SystemPromptState['alert'] = null;
    if (!this.alerted && deferrals > 0) {
      this.alerted = true;
      alert = {
        title: 'Tool Search',
        message: `${deferrals}/${total} tools deferred.`,
        variant: 'info',
        duration: 4000,
      };
    }

    const policyText = deferrals > 0
      ? [
          `[Tool Search Policy] Tools marked "${this.deferLabel}" are deferred: their full description is not in your context.`,
          '1. Retrieve a deferred tool\'s description ONCE per active context via tool_search({ query: "<task or name>" }) or tool_search_regex({ pattern: "^<id>$" }).',
          '2. After retrieval, call the tool by its canonical ID. Re-searching an already-known tool returns no new metadata and wastes tokens.',
          '3. Re-retrieve only after compaction or reset (e.g. after compress), which clears search state.',
          '4. Do NOT guess parameter schemas or descriptions — a search is required before use.',
          'Search results are the authoritative source of the canonical ID and parameter schema.',
        ].join('\n')
      : '';

    return { total, deferrals, policyText, alert };
  }

  public compactSession(sessionID: string | undefined): string {
    this.sessionRegistry.compactSession(sessionID);
    return '[Tool Search] Session compacted. Deferred tool authorizations have been reset — search for any tools you need to use.';
  }

  public deleteSession(sessionID: string | undefined): void {
    this.sessionRegistry.deleteSession(sessionID);
  }

  private buildSearchTools(): Record<string, ReturnType<typeof tool>> {
    const deferLabel = this.deferLabel;
    const { vault, sessionRegistry, maxResults } = this;
    return {
      tool_search: tool({
        description: `Find deferred tools marked "${deferLabel}" by task, name, or prefix. Returns full tool IDs and parameter schemas.\nCall tool_search({ query: "<task or name>" }). For regex, use tool_search_regex({ pattern: "<regex>" }).\nWHEN TO USE: a tool is marked "${deferLabel}", or you need its full description/parameter schema.\nWHEN NOT TO USE: you already searched this tool in the current active context and know its canonical ID — call it directly instead.`,
        args: { query: tool.schema.string().describe('Task, tool name, or prefix.') },
        async execute(args, context) {
          if (args.query.length > MAX_QUERY_LENGTH) {
            return `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters.`;
          }
          const sessionID = context?.sessionID;

          // Phase 1: query FIRST — a hit already in the catalog (e.g. a fast
          // MCP server's tool landing before a hung server settles) is
          // delivered immediately without paying the readiness wait. Only a
          // 0-hit result needs to check readiness (awaitReady is a no-op once
          // the catalog is settled, so the fast path is unchanged).
          let allHits = await vault.query(args.query, vault.count || maxResults, SEARCH_TIMEOUT_MS);

          // Phase 2: no hits and the catalog is still warming up — the tool
          // may exist behind a slow MCP handshake. Wait the extended budget
          // and re-run the SAME query before declaring a definitive negative.
          if (allHits.length === 0) {
            const ready = await vault.awaitReady(SEARCH_TIMEOUT_MS);
            if (!ready) {
              await vault.awaitReady(EXTENDED_WAIT_MS);
            }
            allHits = await vault.query(args.query, vault.count || maxResults, SEARCH_TIMEOUT_MS);
          }

          if (allHits.length === 0) {
            if (!(await vault.awaitReady(0))) {
              // Still warming after the full budget — never report a negative
              // the model would read as "tool does not exist".
              return WARMING_MESSAGE;
            }
            // Warm-up settled (or never started): an honest definitive negative.
            return `No matches for "${args.query}". Try broader terms or tool_search_regex.`;
          }

          const processing = sessionRegistry.processSearchResult(sessionID, allHits, maxResults);
          return processing.responseText;
        },
      }),
      tool_search_regex: tool({
        description: `Find tools by case-insensitive regex over IDs and descriptions. Returns full tool IDs and parameter schemas.\nCall tool_search_regex({ pattern: "<regex>" }). For task or name search, use tool_search({ query: "<task or name>" }).\nWHEN TO USE: you know (part of) the exact tool ID, or you need a precise match — e.g. tool_search_regex({ pattern: "^<id>$" }).\nWHEN NOT TO USE: you already searched this tool in the current active context and know its canonical ID — call it directly instead.`,
        args: { pattern: tool.schema.string().describe('Case-insensitive regex for tool IDs and descriptions.') },
        async execute(args, context) {
          if (args.pattern.length > MAX_REGEX_PATTERN_LENGTH) {
            return `Pattern exceeds maximum length of ${MAX_REGEX_PATTERN_LENGTH} characters.`;
          }
          try {
            new RegExp(args.pattern, 'i');
          } catch (err) {
            return `Invalid regex pattern "${args.pattern}": ${err instanceof Error ? err.message : String(err)}.`;
          }
          const sessionID = context?.sessionID;

          // Phase 1: grep FIRST — a hit already in the catalog (e.g. a fast
          // MCP server's tool landing before a hung server settles) is
          // delivered immediately without paying the readiness wait.
          let allHits = vault.grep(args.pattern, vault.count || maxResults);

          // Phase 2: no hits and the catalog is still warming up — the tool
          // may exist behind a slow MCP handshake. Wait the extended budget
          // and re-run the SAME grep before declaring a definitive negative.
          if (allHits.length === 0) {
            const ready = await vault.awaitReady(SEARCH_TIMEOUT_MS);
            if (!ready) {
              await vault.awaitReady(EXTENDED_WAIT_MS);
            }
            allHits = vault.grep(args.pattern, vault.count || maxResults);
          }

          if (allHits.length === 0) {
            if (!(await vault.awaitReady(0))) {
              // Still warming after the full budget — never report a negative
              // the model would read as "tool does not exist".
              return WARMING_MESSAGE;
            }
            // Warm-up settled (or never started): an honest definitive negative.
            return `No tools matched pattern "${args.pattern}".`;
          }

          const processing = sessionRegistry.processSearchResult(sessionID, allHits, maxResults);
          return processing.responseText;
        },
      }),
    };
  }
}
