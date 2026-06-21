import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { ToolVault } from './vault.js';
import type { ToolMeta, ToolSearchConfig } from './types.js';
import { checkForUpdate, formatUpdateMessage } from './hooks/auto-update-checker.js';

const SEARCH_IDS = new Set(['tool_search', 'tool_search_regex']);
const DEFAULT_DEFER = '[d]';

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

export const ToolSearchPlugin: Plugin = async (ctx, options?: PluginOptions): Promise<Hooks> => {
  const opts = (options ?? {}) as ToolSearchConfig;
  const alwaysOn = new Set([...SEARCH_IDS, ...(opts.alwaysLoad ?? [])]);
  const maxResults = opts.searchLimit ?? 10;
  const deferLabel = opts.deferDescription ?? DEFAULT_DEFER;

  const vault = new ToolVault({
    k1: opts.bm25?.k1,
    b: opts.bm25?.b,
    embedding: opts.embedding ?? { enabled: true },
  });

  let deferrals = 0;
  let total = 0;
  let alerted = false;
  let hasCheckedForUpdate = false;

  setTimeout(() => {
    toast(ctx, 'Tool Search', 'Active — tools will be deferred on first prompt.', 'info', 4000);
  }, 3000);

  return {
    tool: {
      tool_search: tool({
        description: [
          'Search for tools marked "[d]" (deferred — hidden to save context).',
          '',
          'Maps job descriptions or tool prefixes to full tool names and parameters.',
          '',
          'Examples:',
          '  tool_search({ query: "github" })       → github_* tools',
          '  tool_search({ query: "commit code" })   → git commit tools',
          '  tool_search({ query: "remember" })      → memory/save tools',
          '',
          'Uses local AI embedding + keyword search.',
          'For exact name matching, use tool_search_regex.',
        ].join('\n'),
        args: {
          query: tool.schema
            .string()
            .describe('Job description or tool prefix. e.g. "find files" or "github".'),
        },
        async execute(args) {
          const hits = await vault.query(args.query, maxResults);

          if (hits.length === 0) {
            return `No matches for "${args.query}". Try broader terms or tool_search_regex.`;
          }

          const lines = hits.map((r) => {
            const paramsInfo = r.parameters && typeof r.parameters === 'object' && Object.keys(r.parameters).length > 0
              ? `\n  parameters: ${JSON.stringify(r.parameters)}`
              : '';
            return `${r.id}: ${r.description}${paramsInfo}`;
          }).join('\n\n');
          return `Found ${hits.length} tool(s):\n\n${lines}`;
        },
      }),

      tool_search_regex: tool({
        description: [
          'Search tools by regex pattern (case-insensitive).',
          '',
          'Examples:',
          '  tool_search_regex({ pattern: "github.*issue" }) → GitHub issue tools',
          '  tool_search_regex({ pattern: "^figma" }) → all figma-* tools',
          '  tool_search_regex({ pattern: "file|read" }) → file and read tools',
          '',
          'For natural-language search, use tool_search.',
        ].join('\n'),
        args: {
          pattern: tool.schema
            .string()
            .describe('Case-insensitive regex pattern to match tool IDs and descriptions'),
        },
        async execute(args) {
          const hits = vault.grep(args.pattern, maxResults);
          if (hits.length === 0) {
            return `No tools matched pattern "${args.pattern}".`;
          }
          const lines = hits.map((r) => {
            const paramsInfo = r.parameters && typeof r.parameters === 'object' && Object.keys(r.parameters).length > 0
              ? `\n  parameters: ${JSON.stringify(r.parameters)}`
              : '';
            return `${r.id}: ${r.description}${paramsInfo}`;
          }).join('\n\n');
          return `Found ${hits.length} tool(s):\n\n${lines}`;
        },
      }),
    },

    'tool.definition': async (input, output) => {
      if (SEARCH_IDS.has(input.toolID)) return;

      vault.add(input.toolID, output.description, output.parameters);

      if (!alwaysOn.has(input.toolID)) {
        output.description = deferLabel;
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      total = vault.count;
      deferrals = total - (alwaysOn.size - SEARCH_IDS.size);
      if (deferrals < 0) deferrals = 0;

      if (deferrals > 0) {
        output.system.push(
          `${total} tools loaded — ${deferrals} have "${deferLabel}" descriptions. `
          + `Call tool_search({ query: "<prefix or description>" }) before using any "${deferLabel}" tool.`
        );

        if (!alerted) {
          alerted = true;
          toast(ctx, 'Tool Search', `${deferrals}/${total} tools deferred.`, 'info', 4000);
        }
      }
    },

    event: async ({ event }) => {
      if (event.type !== 'session.created') return;
      if (hasCheckedForUpdate) return;
      hasCheckedForUpdate = true;

      const result = await checkForUpdate();
      if (result.needsUpdate && result.latestVersion) {
        const msg = formatUpdateMessage(result);
        toast(ctx, msg.title, msg.message, msg.variant, 6000);
      }
    },
  };
};
