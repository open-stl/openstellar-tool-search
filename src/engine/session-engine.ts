import type { PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { ToolVault } from '../catalog/vault.js';
import type { EmbedConfig } from '../types.js';
import { SessionToolRegistry } from './session-tool-registry.js';
import { normalizeParameters, truncateDescription } from '../catalog/schema-normalize.js';

export const SEARCH_IDS = new Set(['tool_search', 'tool_search_regex']);
export const DEFAULT_DEFER = '[deferred]';
const MAX_REGEX_PATTERN_LENGTH = 200;
const SEARCH_TIMEOUT_MS = 2000;
const MAX_QUERY_LENGTH = 500;
/** Cap on tracked session tool manifests: prevents unbounded growth when session lifecycle events are missed. */
const MAX_TRACKED_SESSIONS = 256;

export const TOOL_SEARCH_PARAM_DESC =
  'Semantic capability or task description (e.g. "search code AST", "fetch web page").';
export const TOOL_SEARCH_REGEX_PARAM_DESC =
  'Anchored regex for exact ID: "^id$", multiple IDs: "^(toolA|toolB)$", or prefix: "^prefix_".';

export interface SearchToolSpec {
  name: string;
  description: string;
  argName: string;
  argDescription: string;
  input: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute: (args: any, context?: any) => Promise<any>;
}

/**
 * Builds the canonical description for the semantic tool_search tool.
 */
export function buildToolSearchDescription(deferLabel: string): string {
  return `Find deferred tools marked "${deferLabel}" by task, capability, or semantic intent when you do not know the exact tool name. Returns matching tool IDs and descriptions (parameter schemas are always present in the tools array).
Call tool_search({ query: "<task description>" }).
WHEN TO USE: you need a capability but do not know which tool provides it (e.g. "search git commit history", "inspect AST"), or discovering relevant tools for a broad task.
WHEN NOT TO USE:
- You already know how to invoke the tool and understand its parameters — invoke it directly without searching.
- You already know the exact tool ID(s) (e.g. "skill", "read", "bash") and need documentation — use tool_search_regex({ pattern: "^tool_name$" }) instead.
- DO NOT pass space-separated lists of multiple tool names — use tool_search_regex with alternation instead.
- You already searched this tool in the current active context and know its canonical ID — call it directly instead.`;
}

/**
 * Builds the canonical description for the regex tool_search_regex tool.
 */
export function buildToolSearchRegexDescription(_deferLabel?: string): string {
  return `Retrieve full descriptions for known tool ID(s) or pattern matching using regex. Returns matching tool IDs and descriptions (parameter schemas are always present in the tools array).
Call tool_search_regex({ pattern: "<regex>" }).
WHEN TO USE:
- You know the exact tool ID and need to inspect its full usage documentation, guidelines, or operational rules (e.g. tool_search_regex({ pattern: "^skill$" })).
- You want to inspect MULTIPLE known tools at once via regex alternation (e.g. tool_search_regex({ pattern: "^(read|write|edit|glob|grep|bash|skill)$" })).
- An execution failed and you need to review the tool's detailed parameter requirements and rules.
- Finding tools matching a specific prefix or pattern (e.g. "^ctx_").
WHEN NOT TO USE:
- Standard tools you already know how to invoke (e.g. bash, read, glob, grep) — call them directly; search is NOT required before execution.
- Semantic/fuzzy searches when tool names are unknown — use tool_search({ query: "<task>" }) instead.
- You already searched this tool in the current active context and know its canonical ID — call it directly instead.`;
}
/**
 * Second-phase budget granted when the first phase found no hits while the
 * Tool Vault was still warming up: gives a slow-but-alive MCP server time to
 * finish its handshake before the search reports the tool as missing.
 */
const EXTENDED_WAIT_MS = 3000;

/**
 * Returned instead of "No matches ..." when a search found no hits and the
 * Tool Vault is still warming up: a negative result at this point would be read
 * by the model as "the tool does not exist", when in truth the MCP servers
 * simply have not finished their handshake yet.
 */
export const WARMING_MESSAGE =
  'Tool Vault still warming up (MCP servers not ready after ~5s). The tool may exist — retry this search in a few seconds.';

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
  notify?: (title: string, message: string, variant?: 'info' | 'warning' | 'error', duration?: number) => void;
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
 * Owns the Tool Vault (ToolVault), the per-session authorization and
 * delivery state (SessionToolRegistry), and the deferred-tool bookkeeping
 * surfaced to the model prompt. Exposes the search tools the plugin wires
 * into OpenCode, plus the operations the plugin hooks delegate to.
 */
export class SessionEngine {
  public readonly vault: ToolVault;
  public readonly sessionRegistry: SessionToolRegistry;
  public readonly searchTools: Record<string, ReturnType<typeof tool>>;
  public readonly searchToolSpecs: Record<string, SearchToolSpec>;
  public readonly deferLabel: string;
  private readonly maxResults: number;
  private readonly useWorker: boolean;
  private readonly notify?: (title: string, message: string, variant?: 'info' | 'warning' | 'error', duration?: number) => void;
  private readonly sessionTools = new Map<string, Set<string>>();
  private alerted = false;

  public constructor(
    private readonly ctx: PluginInput,
    options: SessionEngineOptions,
  ) {
    this.maxResults = options.maxResults;
    this.deferLabel = sanitizeDeferLabel(options.deferLabel);
    this.useWorker = options.embedding.useWorker ?? false;
    this.notify = options.notify;
    this.vault = new ToolVault({ embedding: options.embedding });
    this.sessionRegistry = new SessionToolRegistry({
      alwaysOn: options.alwaysOn,
      resetTools: options.resetTools,
    });
    this.searchToolSpecs = this.buildSearchToolSpecs();
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
   * Pre-execution authorization check.
   * Per ADR 0003 (Stateless Advisory Tool Discovery), execution is ungated so this is a no-op.
   * Deferred tools are never blocked prior to search; reactive hints are provided on failure.
   */
  public assertAuthorized(_executedTool: string, _sessionID: string | undefined, _canonicalTool: string): void {
    // No-op per ADR 0003: stateless advisory tool discovery. Execution is ungated.
    return;
  }

  public hasSearchTool(sessionID: string | undefined): boolean {
    if (!sessionID) return true;
    if (this.sessionTools.has(sessionID)) {
      const tools = this.sessionTools.get(sessionID)!;
      return tools.has('tool_search_regex') || tools.has('tool_search');
    }
    return true;
  }

  public isDeferred(canonicalID: string): boolean {
    return this.sessionRegistry.isDeferred(canonicalID, this.vault.has(canonicalID));
  }

  /**
   * Post-execution hook: resets authorizations and clears delivery history when a configured
   * reset tool executes, and appends a reactive advisory hint when a deferred tool execution fails.
   */
  public handleToolExecuted(
    toolID: string,
    sessionID: string | undefined,
    executionResult?: { error?: unknown; isError?: boolean; status?: unknown; output?: unknown },
  ): string | null {
    const isError = Boolean(
      executionResult?.isError ||
      executionResult?.error ||
      executionResult?.status === 'error' ||
      (typeof executionResult?.output === 'object' && (executionResult.output as any)?.status === 'error')
    );

    if (!isError) {
      this.sessionRegistry.resetIfConfigured(toolID, sessionID);
      return null;
    }

    if (SEARCH_IDS.has(toolID)) return null;

    const meta = this.vault.resolveAlias(toolID);
    const canonical = meta?.id ?? toolID;
    if (!this.isDeferred(canonical)) return null;
    if (this.sessionRegistry.isDelivered(sessionID, canonical)) return null;

    if (this.hasSearchTool(sessionID)) {
      return `\n\n[Tool Hint]: Execution failed for "${toolID}". To inspect detailed usage guidelines and documentation, call tool_search_regex({ pattern: "^${canonical}$" }).`;
    }
    return `\n\n[Tool Hint]: Execution failed for "${toolID}". Review parameter types, required fields, and boundary constraints in the tool schema.`;
  }

  public enrichToolExecutionOutput(
    toolID: string,
    sessionID: string | undefined,
    output: any,
  ): void {
    if (!output) return;
    if (typeof output.content === 'string' && output.content.includes('[Tool Hint]')) return;
    if (Array.isArray(output.content) && output.content.some((c: any) => typeof c?.text === 'string' && c.text.includes('[Tool Hint]'))) return;
    if (typeof output.output === 'string' && output.output.includes('[Tool Hint]')) return;

    const notice = this.handleToolExecuted(toolID, sessionID, output);
    if (!notice) return;

    if (typeof output.content === 'string') {
      output.content += notice;
    } else if (Array.isArray(output.content)) {
      output.content.push({ type: 'text', text: notice });
    } else if (output.output !== undefined) {
      output.output = `${String(output.output ?? '')}${notice}`;
    } else {
      output.output = notice;
    }
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
        this.notify?.(
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
        message: `${deferrals}/${total} tools deferred. Use tool_search to discover capabilities.`,
        variant: 'info',
        duration: 5000,
      };
    }

    const policyText = deferrals > 0
      ? [
          `[Tool Search Policy] Tools marked "${this.deferLabel}" are deferred: parameter schemas are complete and directly executable, but full prose descriptions are deferred to save context.`,
          '1. Direct execution: You may invoke any tool immediately if you already understand its parameters.',
          '2. Inspect documentation: Retrieve a deferred tool\'s full description and guidelines via tool_search_regex({ pattern: "^<id>$" }) when the tool ID is known, or when an execution fails.',
          '   - To retrieve MULTIPLE known tools at once, use regex alternation: tool_search_regex({ pattern: "^(toolA|toolB|toolC)$" }).',
          '3. Discover new tools: Find tools by capability or task intent via tool_search({ query: "<task description>" }) when you do not know the tool name.',
          '   - DO NOT concatenate multiple tool names with spaces into tool_search.',
          '4. Duplicate suppression: Searching an already-delivered tool returns a concise reference to save context. Full descriptions can be re-retrieved after context compaction or reset (e.g. after compress).',
          '5. Do NOT search standard tools you already know how to invoke (e.g. bash, read, glob, grep) unless you encounter an error or need specialized operational rules.',
          'Search results provide the canonical ID; parameter schemas are always present in the tools array — only descriptions are deferred.',
        ].join('\n')
      : '';

    return { total, deferrals, policyText, alert };
  }

  public compactSession(sessionID: string | undefined): string {
    this.sessionRegistry.compactSession(sessionID);
    return '\n\n[Tool Search] Context compacted — tool search history cleared. You may continue executing tools directly or search for documentation as needed.';
  }

  /**
   * ID-Aware Sleev Compression Sync:
   * Under ADR 0003 Stateless Advisory Tool Discovery, authorizations are not gated
   * or speculatively revoked across turns. Compaction resets are owned by lifecycle hooks
   * and resetTools handling.
   */
  public syncSleevCompression(
    _sessionID: string | undefined,
    _messages?: Array<unknown>,
    _tools?: Record<string, any>,
  ): string[] {
    return [];
  }

  public applyContextTurn(sessionCtx: {
    sessionID?: string;
    tools?: Record<string, any>;
    system?: any[];
    messages?: any[];
  }): void {
    if (!sessionCtx) return;

    if (sessionCtx.sessionID && sessionCtx.tools && typeof sessionCtx.tools === 'object') {
      this.sessionTools.set(sessionCtx.sessionID, new Set(Object.keys(sessionCtx.tools)));
      while (this.sessionTools.size > MAX_TRACKED_SESSIONS) {
        const oldest = this.sessionTools.keys().next().value;
        if (oldest === undefined) break;
        this.sessionTools.delete(oldest);
      }
    }

    this.syncSleevCompression(sessionCtx.sessionID, sessionCtx.messages, sessionCtx.tools);

    if (sessionCtx.tools && typeof sessionCtx.tools === 'object') {
      for (const [toolName, toolDef] of Object.entries(sessionCtx.tools as Record<string, any>)) {
        if (!toolDef || typeof toolDef !== 'object' || SEARCH_IDS.has(toolName)) continue;
        const normalizedInput = normalizeParameters(toolDef.input, toolDef.jsonSchema);
        this.vault.add(toolName, toolDef.description, normalizedInput);
        if (this.sessionRegistry.registerTool(toolName)) {
          const pristineDesc = this.vault.get(toolName)?.description ?? toolDef.description;
          toolDef.description = truncateDescription(pristineDesc, this.deferLabel);
        }
      }
    }

    const state = this.prepareForSystemTransform();
    if (state.policyText && Array.isArray(sessionCtx.system)) {
      if (
        sessionCtx.system.length > 0 &&
        typeof sessionCtx.system[0] === 'object' &&
        sessionCtx.system[0] !== null &&
        'text' in sessionCtx.system[0]
      ) {
        sessionCtx.system.push({ type: 'text', text: state.policyText });
      } else {
        sessionCtx.system.push(state.policyText);
      }
    }
    if (state.alert) {
      this.notify?.(state.alert.title, state.alert.message, state.alert.variant, state.alert.duration);
    }
  }

  public handleSessionEvent(event: any): void {
    const evt = event?.event ?? event;
    if (!evt || typeof evt !== 'object') return;
    if (evt.type === 'session.deleted') {
      const sessionID = (evt.properties as any)?.sessionID ?? (evt.properties as any)?.id ?? (evt as any)?.sessionID;
      if (typeof sessionID === 'string' && sessionID.length > 0) {
        this.deleteSession(sessionID);
        this.sessionTools.delete(sessionID);
      }
    } else if (evt.type === 'session.compacted' || evt.type === 'session.compaction') {
      const sessionID = (evt.properties as { sessionID?: unknown } | undefined)?.sessionID ?? (evt as { sessionID?: unknown })?.sessionID;
      if (typeof sessionID === 'string' && sessionID.length > 0) {
        this.compactSession(sessionID);
      }
    }
  }

  public deleteSession(sessionID: string | undefined): void {
    this.sessionRegistry.deleteSession(sessionID);
  }

  private buildSearchToolSpecs(): Record<string, SearchToolSpec> {
    const deferLabel = this.deferLabel;
    const { vault, sessionRegistry, maxResults } = this;
    return {
      tool_search: {
        name: 'tool_search',
        description: buildToolSearchDescription(deferLabel),
        argName: 'query',
        argDescription: TOOL_SEARCH_PARAM_DESC,
        input: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: TOOL_SEARCH_PARAM_DESC,
            },
          },
          required: ['query'],
        },
        execute: async (args: { query: string }, context?: { sessionID?: string }) => {
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
      },
      tool_search_regex: {
        name: 'tool_search_regex',
        description: buildToolSearchRegexDescription(deferLabel),
        argName: 'pattern',
        argDescription: TOOL_SEARCH_REGEX_PARAM_DESC,
        input: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: TOOL_SEARCH_REGEX_PARAM_DESC,
            },
          },
          required: ['pattern'],
        },
        execute: async (args: { pattern: string }, context?: { sessionID?: string }) => {
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
      },
    };
  }

  private buildSearchTools(): Record<string, ReturnType<typeof tool>> {
    const tools: Record<string, ReturnType<typeof tool>> = {};
    for (const [name, spec] of Object.entries(this.searchToolSpecs)) {
      tools[name] = tool({
        description: spec.description,
        args: { [spec.argName]: tool.schema.string().describe(spec.argDescription) },
        execute: spec.execute,
      });
    }
    return tools;
  }
}

export { SessionEngine as SessionRuntime };
