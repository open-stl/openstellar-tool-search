import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { ToolVault } from './vault.js';
import type { ToolMeta, ToolSearchConfig } from './types.js';
import { checkForUpdate, formatUpdateMessage } from './hooks/auto-update-checker.js';
import { AuthPersistence } from './auth-persistence.js';
import type { PersistedToolAuthorization } from './auth-persistence.js';

const SEARCH_IDS = new Set(['tool_search', 'tool_search_regex']);
const DEFAULT_DEFER = '[d]';

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
    ctx.client.tui.showToast({ body: { title, message: msg, variant, duration } }).catch(() => {});
  }, 100);
}

function canonicalAuthorization(id: string): PersistedToolAuthorization {
  return { kind: 'canonical-tool', version: 1, canonicalId: id };
}

function authorizationId(value: PersistedToolAuthorization): string | undefined {
  if (typeof value === 'string') return value.startsWith('@canonical:') || value.endsWith('_ide') ? undefined : value;
  return value.kind === 'canonical-tool' && value.version === 1 ? value.canonicalId : undefined;
}

export const ToolSearchPlugin: Plugin = async (ctx, options?: PluginOptions): Promise<Hooks> => {
  const opts = (options ?? {}) as ToolSearchConfig;
  const alwaysOn = new Set([...SEARCH_IDS, ...(opts.alwaysLoad ?? [])]);
  const resetToolIDs = new Set(['compress', ...(opts.resetTools ?? [])]);
  const maxResults = opts.searchLimit ?? 10;
  const deferLabel = opts.deferDescription ?? DEFAULT_DEFER;
  const vault = new ToolVault({
    k1: opts.bm25?.k1,
    b: opts.bm25?.b,
    embedding: opts.embedding ?? { enabled: true },
  });
  const persistence = new AuthPersistence();
  const loaded = persistence.load();
  const authorizations = loaded.authorizations;
  const lastSeen = loaded.lastSeen;
  let authorizationsSanitized = false;
  for (const set of authorizations.values()) {
    for (const value of set) {
      const id = authorizationId(value);
      if (id === undefined || id === 'skill') {
        set.delete(value);
        authorizationsSanitized = true;
      }
    }
  }
  if (authorizationsSanitized) persistence.save(authorizations, lastSeen);
  const deferredTools = new Set<string>();
  const skillPermits = new Set<string>();
  let deferrals = 0;
  let total = 0;
  let alerted = false;
  let updateCheckInFlight: Promise<void> | null = null;
  let updateStaged = false;

  const authorize = (sessionID: string | undefined, hits: ToolMeta[]) => {
    if (!sessionID) return;
    const genericHits = hits.filter((hit) => hit.id !== 'skill');
    if (genericHits.length === 0) return;
    let set = authorizations.get(sessionID);
    if (!set) { set = new Set(); authorizations.set(sessionID, set); }
    for (const hit of genericHits) set.add(canonicalAuthorization(hit.id));
    persistence.save(authorizations, lastSeen);
  };

  const clearSessionState = (sessionID: string | undefined) => {
    if (!sessionID) return;
    authorizations.delete(sessionID);
    lastSeen.delete(sessionID);
    skillPermits.delete(sessionID);
    persistence.deleteSession(sessionID);
    persistence.save(authorizations, lastSeen);
  };

  const formatHit = (r: ToolMeta) => {
    const paramsInfo = r.parameters && typeof r.parameters === 'object' && Object.keys(r.parameters).length > 0 ? `\n  parameters: ${JSON.stringify(r.parameters)}` : '';
    return `${r.id}: ${r.description}${paramsInfo}`;
  };

  setTimeout(() => toast(ctx, 'Tool Search', 'Active — tools will be deferred on first prompt.', 'info', 4000), 3000);

  const hooks: Hooks = {
    tool: {
      tool_search: tool({
        description: `Find deferred tools marked "${deferLabel}" by task, name, or prefix. Returns full tool IDs and parameter schemas.\nCall tool_search({ query: "<task or name>" }). For regex, use tool_search_regex({ pattern: "<regex>" }).`,
        args: { query: tool.schema.string().describe('Task, tool name, or prefix.') },
        async execute(args, context) {
          const hits = await vault.query(args.query, maxResults);
          if (hits.length === 0) return `No matches for "${args.query}". Try broader terms or tool_search_regex.`;
          authorize(context?.sessionID, hits);
          return `Found ${hits.length} tool(s):\n\n${hits.map(formatHit).join('\n\n')}`;
        },
      }),
      tool_search_regex: tool({
        description: `Find tools by case-insensitive regex over IDs and descriptions. Returns full tool IDs and parameter schemas.\nCall tool_search_regex({ pattern: "<regex>" }). For task or name search, use tool_search({ query: "<task or name>" }).`,
        args: { pattern: tool.schema.string().describe('Case-insensitive regex for tool IDs and descriptions.') },
        async execute(args, context) {
          const hits = vault.grep(args.pattern, maxResults);
          if (args.pattern === '^skill$' && context?.sessionID && hits.some((hit) => hit.id === 'skill')) {
            skillPermits.add(context.sessionID);
          }
          if (hits.length === 0) return `No tools matched pattern "${args.pattern}".`;
          authorize(context?.sessionID, hits);
          return `Found ${hits.length} tool(s):\n\n${hits.map(formatHit).join('\n\n')}`;
        },
      }),
    },
    'tool.definition': async (input, output) => {
      if (SEARCH_IDS.has(input.toolID)) return;
      vault.add(input.toolID, output.description, output.parameters);
      if (!alwaysOn.has(input.toolID)) {
        deferredTools.add(input.toolID);
        const firstSentence = getFirstSentence(output.description);
        output.description = firstSentence ? `${firstSentence} ${deferLabel}` : deferLabel;
      }
    },
    'tool.execute.before': async (input) => {
      if (input.tool === 'skill') {
        if (input.sessionID && skillPermits.has(input.sessionID)) {
          skillPermits.delete(input.sessionID);
          return;
        }
        throw new Error('Every skill call requires a new literal tool_search_regex({ pattern: "^skill$" }) immediately before the call.');
      }
      if (input.sessionID) skillPermits.delete(input.sessionID);
    },
    'tool.execute.after': async (input, output) => {
      if (resetToolIDs.has(input.tool)) {
        clearSessionState(input.sessionID);
        output.output = `${String(output.output ?? '')}\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.`;
        return;
      }
      if (SEARCH_IDS.has(input.tool)) return;
      const meta = vault.get(input.tool);
      const canonical = meta?.id ?? input.tool;
      if (alwaysOn.has(input.tool) || alwaysOn.has(canonical)) return;
      if (!deferredTools.has(input.tool) && !deferredTools.has(canonical)) return;
      const authorized = input.sessionID ? authorizations.get(input.sessionID) : undefined;
      const allowed = authorized && Array.from(authorized).some((value) => authorizationId(value) === canonical)
        && input.tool === canonical;
      if (!allowed) {
        output.output = `${String(output.output ?? '')}\n\n[Tool Search Reminder] "${input.tool}" executed without prior search. Run tool_search_regex({ pattern: "^${input.tool}$" }) now to inspect its full description and verify the call was correct. Do not blindly repeat the call; take corrective or follow-up action only if the full description shows it is necessary.`;
      }
    },
    'experimental.chat.system.transform': async (input, output) => {
      total = vault.count;
      deferrals = deferredTools.size;

      if (deferrals > 0) {
        output.system.push(`${deferrals}/${total} tools are deferred ("${deferLabel}"). Before calling one, retrieve it with tool_search({ query: "<task or name>" }) or tool_search_regex({ pattern: "<regex>" }). Deferred tools require a successful search before execution. Search results identify the canonical tool ID, which must be used for execution. Exception: each skill call, including nested or repeated calls, requires a new literal tool_search_regex({ pattern: "^skill$" }) immediately before that call; natural-language search and every other pattern do not authorize skill. One exact successful lookup permits one skill invocation.`);
        if (!alerted) { alerted = true; toast(ctx, 'Tool Search', `${deferrals}/${total} tools deferred.`, 'info', 4000); }
      }
    },
    'experimental.session.compacting': async (input, output) => {
      clearSessionState(input.sessionID);
      output.context.push('[Tool Search] Session compacted. Deferred tool authorizations have been reset — search for any tools you need to use.');
    },
    event: async ({ event }) => {
      if (event.type === 'session.deleted') {
        const sessionID = (event.properties as { sessionID?: unknown } | undefined)?.sessionID;
        if (typeof sessionID === 'string' && sessionID.length > 0) clearSessionState(sessionID);
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
