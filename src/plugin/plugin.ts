import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { Catalog } from '../catalog/index.js';
import type { CatalogEntry, ToolSearchConfig } from '../shared/index.js';
import { summarizeParameters } from '../shared/index.js';

const SEARCH_TOOL_IDS = new Set(['tool_search', 'tool_search_regex']);
const DEFAULT_DEFER_MSG = '[d]';

function showToast(
  ctx: PluginInput,
  title: string,
  message: string,
  variant: 'info' | 'success' | 'error' = 'info',
  duration = 3000,
): void {
  // Schedule outside the current execution context (Effect-ts runtime / hook pipeline)
  // so the in-process fetch to /tui/show-toast doesn't conflict with the active request.
  setTimeout(() => {
    ctx.client.tui.showToast({ body: { title, message, variant, duration } }).catch(() => {});
  }, 100);
}

export const ToolSearchPlugin: Plugin = async (ctx, options?: PluginOptions): Promise<Hooks> => {
  const config = (options ?? {}) as ToolSearchConfig;

  const alwaysLoad = new Set([...SEARCH_TOOL_IDS, ...(config.alwaysLoad ?? [])]);

  const searchLimit = config.searchLimit ?? 5;
  const deferDescription = config.deferDescription ?? DEFAULT_DEFER_MSG;

  const catalog = new Catalog({
    k1: config.bm25?.k1,
    b: config.bm25?.b,
  });

  let deferredCount = 0;
  let totalCount = 0;
  let toastShown = false;

  setTimeout(() => {
    showToast(ctx, 'Tool Search', 'Active — tools will be deferred on first prompt.', 'info', 4000);
  }, 3000);

  return {
    tool: {
      tool_search: tool({
        description: [
          'Most tools around you have abbreviated descriptions like "[d]" to save context.',
          'When you need to understand what a [d]-masked tool actually does, or when you',
          'suspect the right tool exists but cannot recall its exact name — use this.',
          '',
          'Describe the capability you want, not the tool name. This search understands',
          'intent: it reads tool names, descriptions, and even parameter names, then',
          'ranks results by relevance. A single precise keyword beats a vague sentence.',
          '',
          'How to search effectively:',
          '  • Still figuring out → one broad keyword:  "file", "search", "git", "image"',
          '  • Have a hunch → two or three:            "github issue create", "file read write"',
          '  • Need a specific capability → be literal: "regex search", "image generation"',
          '',
          'When to use this instead of tool_search_regex:',
          '  • You do NOT know the tool name — just what it should do',
          '  • The tool you need might have an abstract or unrelated name',
          '  • You want the most relevant tool, ranked by fit',
          '  • You are exploring: "what tools do I have for X?"',
        ].join('\n'),
        args: {
          query: tool.schema
            .string()
            .describe('Query describing the capability you need — not the tool name. Be concise and concrete. "create file" works better than "I want to make a new document".'),
        },
        async execute(args) {
          const results = catalog.search(args.query, searchLimit);

          if (results.length === 0) {
            return `No tools matched "${args.query}". Try a shorter or more generic query — tool names are often technical (e.g., "search" may be "grep").`;
          }

          const formatted = results
            .map(
              (r) =>
                `### ${r.id}\n${r.description}\n\nParameters:\n${summarizeParameters(r.parameters)}`,
            )
            .join('\n\n---\n\n');

          return `Found ${results.length} tool(s):\n\n${formatted}`;
        },
      }),

      tool_search_regex: tool({
        description: [
          'Use this when you know the shape of a tool name but want to narrow down precisely.',
          'Unlike tool_search which understands intent, this matches literal patterns against',
          'tool IDs and descriptions using regular expressions.',
          '',
          'Best for precision scenarios:',
          '  • Confirm a tool exists:           "github.*create"     → finds github_create_issue',
          '  • Filter by naming convention:     "^opencode_"         → all opencode-* tools',
          '  • Discover related tools:          "mcp|model.context"   → any MCP-related tools',
          '  • Exact match (anchored):          "^read$"             → only the tool named "read"',
          '',
          'When to use this instead of tool_search:',
          '  • You know the tool name pattern and want confirmation',
          '  • You want to discover tools sharing a prefix or suffix',
          '  • tool_search returned too many results and you need precision',
          '  • You are looking for specific parameter patterns, not capabilities',
        ].join('\n'),
        args: {
          pattern: tool.schema
            .string()
            .describe('Regular expression pattern (case-insensitive by default). Examples: "^read" matches tools starting with "read", "github.*issue" matches GitHub issue tools, "file|directory" matches either. Do NOT wrap in /slashes/.'),
        },
        async execute(args) {
          let results: CatalogEntry[];
          try {
            results = catalog.searchRegex(args.pattern, searchLimit);
          } catch {
            return `Invalid regex: "${args.pattern}". Provide a valid regex pattern.`;
          }

          if (results.length === 0) {
            return `No tools matched /${args.pattern}/. Try simplifying — remove anchors (^, $) or try a broader pattern.`;
          }

          const formatted = results
            .map(
              (r) =>
                `### ${r.id}\n${r.description}\n\nParameters:\n${summarizeParameters(r.parameters)}`,
            )
            .join('\n\n---\n\n');

          return `Found ${results.length} tool(s):\n\n${formatted}`;
        },
      }),
    },

    'tool.definition': async (input, output) => {
      // Search tools are meta — skip cataloging them as discoverable tools
      if (SEARCH_TOOL_IDS.has(input.toolID)) return;


      catalog.register(input.toolID, output.description, output.parameters);

      if (!alwaysLoad.has(input.toolID)) {
        output.description = deferDescription;
        // Keep original parameters — empty schemas break OpenAI Responses API
        // (Missing required parameter: 'input[N].arguments'). See issue #7.
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      totalCount = catalog.size;
      const alwaysLoadCount = alwaysLoad.size - SEARCH_TOOL_IDS.size;
      deferredCount = Math.max(0, totalCount - alwaysLoadCount);

      if (deferredCount > 0) {
        // Action-first instruction: tell the model WHAT to do before describing state.
        // Consequence-aware: "wastes a turn" primes the model to avoid the penalty.
        output.system.push(
          `[Tool Search] ${deferredCount}/${totalCount} tools are [d]. Search with tool_search before using a [d] tool — calling one spec-blind wastes a turn.`,
        );

        if (!toastShown) {
          toastShown = true;
          showToast(ctx, 'Tool Search', `${deferredCount}/${totalCount} deferred — search to discover`, 'info', 4000);
        }
      }
    },
  };
};
