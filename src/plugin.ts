import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { ToolVault } from './vault.js';
import type { ToolSearchConfig, EmbedConfig } from './types.js';
import { checkForUpdate, formatUpdateMessage } from './hooks/auto-update-checker.js';
import { SessionToolRegistry } from './session-tool-registry.js';

const SEARCH_IDS = new Set(['tool_search', 'tool_search_regex']);
const DEFAULT_DEFER = '[deferred]';

function getFirstSentence(desc: string): string {
  if (!desc) return '';
  const firstNewline = desc.indexOf('\n');
  const firstLine = firstNewline !== -1 ? desc.slice(0, firstNewline).trim() : desc.trim();
  const abbreviations = new Set(['eg', 'ie', 'dr', 'mr', 'ms', 'mrs', 'vs', 'etc']);
  const sentenceBoundaryRegex = /\.(?:\s|$)/g;
  let match;
  while ((match = sentenceBoundaryRegex.exec(firstLine)) !== null) {
    const index = match.index;
    const beforeSegment = firstLine.slice(0, index);
    const wordMatch = beforeSegment.match(/\b[a-zA-Z.]+$/);
    if (wordMatch) {
      const cleanWord = wordMatch[0].toLowerCase().replace(/\./g, '');
      if (abbreviations.has(cleanWord) || cleanWord.length === 1) continue;
    }
    return firstLine.slice(0, index + 1).trim();
  }
  return firstLine;
}

function toast(
  ctx: PluginInput,
  title: string,
  msg: string,
  variant: 'info' | 'success' | 'warning' | 'error' = 'info',
  duration = 3000,
): void {
  setTimeout(() => {
    ctx?.client?.tui?.showToast({ body: { title, message: msg, variant, duration } }).catch(() => {});
  }, 100);
}

export const ToolSearchPlugin: Plugin = async (ctx, options?: PluginOptions): Promise<Hooks> => {
  const opts = (options ?? {}) as ToolSearchConfig;
  const resetToolIDs = new Set(['compress', ...(opts.resetTools ?? [])]);
  const maxResults = opts.searchLimit ?? 10;
  const deferLabel = opts.deferDescription ?? DEFAULT_DEFER;
  const searchTimeoutMs = opts.searchTimeoutMs ?? 2000;
  const embeddingCfg: Partial<EmbedConfig> = opts.embedding ?? {};
  const embedding = {
    enabled: embeddingCfg.enabled ?? true,
    ...embeddingCfg,
    quantized: embeddingCfg.quantized ?? false,
    useWorker: embeddingCfg.useWorker ?? true,
  };
  const vault = new ToolVault({
    k1: opts.bm25?.k1,
    b: opts.bm25?.b,
    cascadeThreshold: opts.bm25?.cascadeThreshold,
    embedding,
  });
  const sessionRegistry = new SessionToolRegistry({
    alwaysOn: [...SEARCH_IDS, ...(opts.alwaysLoad ?? [])],
    resetTools: resetToolIDs,
  });
  let deferrals = 0;
  let total = 0;
  let alerted = false;
  let updateCheckInFlight: Promise<void> | null = null;
  let updateStaged = false;

  setTimeout(() => toast(ctx, 'Tool Search', 'Active — tools will be deferred on first prompt.', 'info', 4000), 3000);

  const hooks: Hooks = {
    tool: {
      tool_search: tool({
        description: `Find deferred tools marked "${deferLabel}" by task, name, or prefix. Returns full tool IDs and parameter schemas.\nCall tool_search({ query: "<task or name>" }). For regex, use tool_search_regex({ pattern: "<regex>" }).`,
        args: { query: tool.schema.string().describe('Task, tool name, or prefix.') },
        async execute(args, context) {
          const sessionID = context?.sessionID;
          const allHits = await vault.query(args.query, vault.count || maxResults, searchTimeoutMs);
          if (allHits.length === 0) return `No matches for "${args.query}". Try broader terms or tool_search_regex.`;

          const processing = sessionRegistry.processSearchResult(sessionID, allHits, maxResults);
          return processing.responseText;
        },
      }),
      tool_search_regex: tool({
        description: `Find tools by case-insensitive regex over IDs and descriptions. Returns full tool IDs and parameter schemas.\nCall tool_search_regex({ pattern: "<regex>" }). For task or name search, use tool_search({ query: "<task or name>" }).`,
        args: { pattern: tool.schema.string().describe('Case-insensitive regex for tool IDs and descriptions.') },
        async execute(args, context) {
          const sessionID = context?.sessionID;
          const allHits = vault.grep(args.pattern, vault.count || maxResults);
          if (allHits.length === 0) return `No tools matched pattern "${args.pattern}".`;

          const processing = sessionRegistry.processSearchResult(sessionID, allHits, maxResults);
          return processing.responseText;
        },
      }),
    },
    'tool.definition': async (input, output) => {
      if (SEARCH_IDS.has(input.toolID)) return;
      vault.add(input.toolID, output.description, output.parameters);
      if (sessionRegistry.registerTool(input.toolID)) {
        const firstSentence = getFirstSentence(output.description);
        output.description = firstSentence ? `${firstSentence} ${deferLabel}` : deferLabel;
      }
    },
    'tool.execute.before': async (input) => {
      if (SEARCH_IDS.has(input.tool)) return;
      const meta = vault.resolveAlias(input.tool);
      const canonical = meta?.id ?? input.tool;
      const sessionID = input.sessionID ?? 'default';
      if (sessionRegistry.requiresReminder(input.sessionID, input.tool, canonical)) {
        throw new Error(
          `[Tool Search Required] Tool "${input.tool}" has not been searched in session "${sessionID}". Call tool_search_regex({ pattern: "^${canonical}$" }) or tool_search to inspect full description and parameter schema before calling this tool.`,
        );
      }
    },
    'tool.execute.after': async (input, output) => {
      if (sessionRegistry.resetIfConfigured(input.tool, input.sessionID)) {
        output.output = `${String(output.output ?? '')}\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.`;
        return;
      }
    },
    'experimental.chat.system.transform': async (input, output) => {
      total = vault.count;
      deferrals = sessionRegistry.deferredCount;

      const buildPromise = embedding.useWorker ? vault.prebuildSemantic() : undefined;
      if (buildPromise) {
        buildPromise.catch((err: unknown) => {
          toast(
            ctx,
            'Tool Search',
            `Semantic search unavailable (${err instanceof Error ? err.message : 'unknown error'}). Falling back to keyword search.`,
            'warning',
            6000,
          );
        });
      }

      if (deferrals > 0) {
        output.system.push(`${deferrals}/${total} tools are deferred ("${deferLabel}"). Before calling one, retrieve it with tool_search({ query: "<task or name>" }) or tool_search_regex({ pattern: "<regex>" }). Deferred tools require a successful search before execution. Search results identify the canonical tool ID, which must be used for execution. When the tool ID is already known, prefer tool_search_regex({ pattern: "^<id>$" }) for a reliable exact match — multi-term queries to tool_search may not return every matching tool.`);
        if (!alerted) { alerted = true; toast(ctx, 'Tool Search', `${deferrals}/${total} tools deferred.`, 'info', 4000); }
      }
    },
    'experimental.session.compacting': async (input, output) => {
      sessionRegistry.compactSession(input.sessionID);
      output.context.push('[Tool Search] Session compacted. Deferred tool authorizations have been reset — search for any tools you need to use.');
    },
    event: async ({ event }) => {
      if (event.type === 'session.deleted') {
        const sessionID = (event.properties as { sessionID?: unknown } | undefined)?.sessionID;
        if (typeof sessionID === 'string' && sessionID.length > 0) {
          sessionRegistry.deleteSession(sessionID);
        }
        return;
      }
      if (event.type !== 'session.created' || updateStaged) return;
      if (!updateCheckInFlight) updateCheckInFlight = (async () => {
        try {
          const result = await checkForUpdate(); const msg = formatUpdateMessage(result);
          if (result.outcome === 'update-staged') { updateStaged = true; toast(ctx, msg.title, msg.message, msg.variant, 6000); }
          else if (result.outcome !== 'up-to-date') toast(ctx, msg.title, msg.message, msg.variant, 6000);
        } catch (error) { toast(ctx, 'Tool Search Update Check', error instanceof Error ? error.message : 'Update check failed.', 'error', 6000); }
        finally { updateCheckInFlight = null; }
      })();
      await updateCheckInFlight;
    },
  };
  return hooks;
};
