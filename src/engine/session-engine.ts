import type { PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { ToolVault } from '../catalog/vault.js';
import type { EmbedConfig } from '../types.js';
import { SessionToolRegistry } from './session-tool-registry.js';
import { toast } from '../hooks/toast.js';
import { truncateDescription } from '../hooks/deferral.js';
import { normalizeParameters } from '../catalog/schema-normalize.js';

export const SEARCH_IDS = new Set(['tool_search', 'tool_search_regex']);
export const DEFAULT_DEFER = '[deferred]';
const MAX_REGEX_PATTERN_LENGTH = 200;
export const SEARCH_TIMEOUT_MS = 2000;
const MAX_QUERY_LENGTH = 500;
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
function sanitizeDeferLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ');
}

interface SessionEngineOptions {
  alwaysOn: Iterable<string>;
  resetTools: Iterable<string>;
  maxResults: number;
  deferLabel: string;
  embedding: EmbedConfig;
}

interface SystemPromptState {
  total: number;
  deferrals: number;
  policyText: string;
  alert: { title: string; message: string; variant: 'info'; duration: number } | null;
}

/**
 * Core session engine for the tool-search plugin.
 *
 * Owns the tool catalog (ToolVault), the per-session authorization and
 * delivery state (SessionToolRegistry), and the deferred-tool bookkeeping
 * surfaced to the model prompt. Exposes the search tools the plugin wires
 * into OpenCode, plus the operations the plugin hooks delegate to.
 */
export class SessionEngine {
  public readonly vault: ToolVault;
  public readonly sessionRegistry: SessionToolRegistry;
  public readonly searchTools: Record<string, ReturnType<typeof tool>>;

  private readonly maxResults: number;
  private readonly deferLabel: string;
  private readonly useWorker: boolean;
  private alerted = false;

  public constructor(
    private readonly ctx: PluginInput,
    options: SessionEngineOptions,
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
   */
  public deferTool(toolID: string, description: string, parameters: unknown, jsonSchema?: unknown): string {
    this.vault.add(toolID, description, normalizeParameters(parameters, jsonSchema));
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

  private extractMessageText(msg: unknown): string {
    if (!msg || typeof msg !== 'object') return '';
    const obj = msg as Record<string, unknown>;
    let text = '';

    if (typeof obj.content === 'string') {
      text += obj.content + ' ';
    } else if (Array.isArray(obj.content)) {
      for (const item of obj.content) {
        if (typeof item === 'string') {
          text += item + ' ';
        } else if (item && typeof item === 'object') {
          const itemObj = item as Record<string, unknown>;
          if (typeof itemObj.text === 'string') text += itemObj.text + ' ';
          if (typeof itemObj.content === 'string') text += itemObj.content + ' ';
        }
      }
    }

    if (Array.isArray(obj.parts)) {
      for (const part of obj.parts) {
        if (typeof part === 'string') {
          text += part + ' ';
        } else if (part && typeof part === 'object') {
          const partObj = part as Record<string, unknown>;
          if (typeof partObj.text === 'string') text += partObj.text + ' ';
          if (typeof partObj.content === 'string') text += partObj.content + ' ';
          if (typeof partObj.output === 'string') text += partObj.output + ' ';
          const state = partObj.state as Record<string, unknown> | undefined;
          if (state && typeof state === 'object') {
            if (typeof state.output === 'string') text += state.output + ' ';
            if (typeof state.text === 'string') text += state.text + ' ';
          }
        }
      }
    }

    if (Array.isArray(obj.blocks)) {
      for (const block of obj.blocks) {
        if (block && typeof block === 'object') {
          const blockObj = block as Record<string, unknown>;
          if (typeof blockObj.text === 'string') text += blockObj.text + ' ';
          if (typeof blockObj.output === 'string') text += blockObj.output + ' ';
          if (Array.isArray(blockObj.content)) {
            for (const c of blockObj.content) {
              if (c && typeof c === 'object') {
                const cObj = c as Record<string, unknown>;
                if (typeof cObj.text === 'string') text += cObj.text + ' ';
                if (typeof cObj.output === 'string') text += cObj.output + ' ';
              }
            }
          }
        }
      }
    }

    // Strip sleev compressed summaries so compressed text doesn't falsely satisfy active presence
    text = text.replace(/<sleev-id-compressed>[\s\S]*?<\/sleev-id-compressed>/gi, '');

    return text;
  }

  public compactSession(sessionID: string | undefined): string {
    this.sessionRegistry.compactSession(sessionID);
    return '[Tool Search] Session compacted. Deferred tool authorizations have been reset — search for any tools you need to use.';
  }

  /**
   * Dynamically verify that authorized tools are actually present in the active conversation context.
   * If a message containing a tool's search result was pruned (by Sleev, compaction, or context trimming),
   * this selectively revokes authorization for that specific tool so the LLM is prompted to re-search.
   */
  public syncActiveAuthorizations(
    sessionID: string | undefined,
    messages?: Array<{ role?: string; content?: unknown }>,
  ): string[] {
    if (!sessionID || !messages || messages.length === 0) return [];

    const authorized = this.sessionRegistry.getAuthorizedTools(sessionID);
    if (authorized.length === 0) return [];

    let combinedText = '';
    for (const msg of messages) {
      combinedText += this.extractMessageText(msg) + '\n';
    }

    const revoked: string[] = [];
    for (const toolID of authorized) {
      const escaped = toolID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const presenceRegex = new RegExp(`(?:^|\\W)${escaped}(?::|\\b)`, 'm');
      if (!presenceRegex.test(combinedText)) {
        revoked.push(toolID);
      }
    }

    if (revoked.length > 0) {
      this.sessionRegistry.revokeTools(sessionID, revoked);
    }

    return revoked;
  }

  /**
   * ID-Aware Sleev Compression Sync:
   * Inspects message history for completed `compress` tool calls, gathers all pruned message IDs,
   * checks which authorized tools were delivered inside those pruned message blocks (<sleev-id-mXXXX>),
   * and selectively revokes authorizations for tools whose schemas were pruned from active context.
   */
  public syncSleevCompression(
    sessionID: string | undefined,
    messages?: Array<unknown>,
  ): string[] {
    if (!sessionID || !messages || messages.length === 0) return [];

    const authorized = this.sessionRegistry.getAuthorizedTools(sessionID);
    if (authorized.length === 0) return [];

    // 1. Collect all pruned message IDs from completed `compress` tool calls
    const prunedIds = new Set<string>();

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const msgObj = msg as Record<string, unknown>;

      // Check parts array (OpenCode format)
      if (Array.isArray(msgObj.parts)) {
        for (const part of msgObj.parts) {
          if (part && typeof part === 'object') {
            const p = part as Record<string, unknown>;
            if (p.type === 'tool' && p.tool === 'compress') {
              const state = p.state as Record<string, unknown> | undefined;
              if (state?.status === 'completed' || p.status === 'completed') {
                const input = (state?.input || p.input) as Record<string, unknown> | undefined;
                if (Array.isArray(input?.ids)) {
                  for (const id of input.ids) {
                    if (typeof id === 'string') prunedIds.add(id);
                  }
                }
              }
            }
          }
        }
      }

      // Check tool_calls array (API format)
      if (Array.isArray(msgObj.tool_calls)) {
        for (const tc of msgObj.tool_calls) {
          if (tc && typeof tc === 'object') {
            const fn = (tc as Record<string, unknown>).function as Record<string, unknown> | undefined;
            if (fn?.name === 'compress' && typeof fn.arguments === 'string') {
              try {
                const parsedArgs = JSON.parse(fn.arguments);
                if (Array.isArray(parsedArgs.ids)) {
                  for (const id of parsedArgs.ids) {
                    if (typeof id === 'string') prunedIds.add(id);
                  }
                }
              } catch {
                // ignore parse error
              }
            }
          }
        }
      }
    }

    if (prunedIds.size === 0) {
      return this.syncActiveAuthorizations(sessionID, messages as any);
    }

    // 2. Identify unpruned message text
    let activeText = '';
    for (const msg of messages) {
      const fullText = this.extractMessageText(msg);
      // Check if this text chunk is wrapped with a sleev message ID
      const tagMatch = fullText.match(/<sleev-id-(m\d+)>/i);
      if (tagMatch) {
        const msgId = tagMatch[1];
        if (prunedIds.has(msgId)) {
          // This message has been pruned by Sleev, skip it
          continue;
        }
      }
      activeText += fullText + '\n';
    }

    // 3. For each authorized tool, check if it exists in the active (unpruned) text
    const revoked: string[] = [];
    for (const toolID of authorized) {
      const escaped = toolID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const presenceRegex = new RegExp(`(?:^|\\W)${escaped}(?::|\\b)`, 'm');
      if (!presenceRegex.test(activeText)) {
        revoked.push(toolID);
      }
    }

    if (revoked.length > 0) {
      this.sessionRegistry.revokeTools(sessionID, revoked);
    }

    return revoked;
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

          let allHits = await vault.query(args.query, vault.count || maxResults, SEARCH_TIMEOUT_MS);

          if (allHits.length === 0) {
            const ready = await vault.awaitReady(SEARCH_TIMEOUT_MS);
            if (!ready) {
              await vault.awaitReady(EXTENDED_WAIT_MS);
            }
            allHits = await vault.query(args.query, vault.count || maxResults, SEARCH_TIMEOUT_MS);
          }

          if (allHits.length === 0) {
            if (!(await vault.awaitReady(0))) {
              return WARMING_MESSAGE;
            }
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

          let allHits = vault.grep(args.pattern, vault.count || maxResults);

          if (allHits.length === 0) {
            const ready = await vault.awaitReady(SEARCH_TIMEOUT_MS);
            if (!ready) {
              await vault.awaitReady(EXTENDED_WAIT_MS);
            }
            allHits = vault.grep(args.pattern, vault.count || maxResults);
          }

          if (allHits.length === 0) {
            if (!(await vault.awaitReady(0))) {
              return WARMING_MESSAGE;
            }
            return `No tools matched pattern "${args.pattern}".`;
          }

          const processing = sessionRegistry.processSearchResult(sessionID, allHits, maxResults);
          return processing.responseText;
        },
      }),
    };
  }
}

export { SessionEngine as SessionRuntime };
