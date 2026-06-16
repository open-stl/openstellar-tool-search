import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { ToolVault } from './vault.js';
import type { ToolMeta, ToolSearchConfig } from './types.js';

const SEARCH_IDS = new Set(['tool_search', 'tool_search_regex']);
const DEFAULT_DEFER = '[d]';

function toast(
  ctx: PluginInput,
  title: string,
  msg: string,
  variant: 'info' | 'success' | 'error' = 'info',
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

  setTimeout(() => {
    toast(ctx, 'Tool Search', 'Active — tools will be deferred on first prompt.', 'info', 4000);
  }, 3000);

  return {
    tool: {
      tool_search: tool({
        description: [
          'Most tools list abbreviated tags like "[d]" to save space.',
          'If you see a tag and need to know what it does, or you need a capability',
          'but cannot recall the exact tool name — run this.',
          '',
          'Uses AI-powered semantic search (local embedding model) to match your',
          'description against tool names, descriptions, and parameter schemas.',
          '',
          'Modes:',
          '  - describe the job:  tool_search({ query: "save code to github" }) → ranked matches',
          '',
          'Tips:',
          '  • Describe the job, not the tool: "find text in files" not "grep"',
          '  • Full sentences are fine: "upload image to figma"',
          '  • Works even when you misremember the name',
          '',
          'Use tool_search_regex when you know the exact name pattern.',
        ].join('\n'),
        args: {
          query: tool.schema
            .string()
            .describe('What you want to do — natural language, not the tool name. Example: "find files by name" or "commit code".'),
        },
        async execute(args) {
          const hits = await vault.query(args.query, maxResults);

          if (hits.length === 0) {
            const prefixes = Array.from(new Set(
              vault.list().map((t) => t.id.includes('_') ? t.id.split('_')[0] : t.id)
            )).sort().join(', ');
            return `No matches. Available prefixes: ${prefixes}. Try one as keyword.`;
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
          'Regex-based search against tool IDs and descriptions.',
          'Use when you know the naming pattern but need to pinpoint.',
          '',
          'Examples:',
          '  tool_search_regex({ pattern: "github.*issue" }) → GitHub issue tools',
          '  tool_search_regex({ pattern: "^figma" })        → all figma-* tools',
          '  tool_search_regex({ pattern: "file|read" })     → union of file and read tools',
          '',
          'For fuzzy or intent-based search, use tool_search instead.',
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
          `${total} tools loaded—${deferrals} have "${deferLabel}" descriptions. `
          + `Expand a "${deferLabel}" tool via tool_search({ query: "prefix" }) before calling it.`
        );

        if (!alerted) {
          alerted = true;
          toast(ctx, 'Tool Search', `${deferrals}/${total} tools deferred.`, 'info', 4000);
        }
      }
    },
  };
};
