import type { Hooks, Plugin, PluginOptions } from '@opencode-ai/plugin';
import type { ToolSearchConfig, EmbedConfig } from './types.js';
import { SessionRuntime, SEARCH_IDS, DEFAULT_DEFER } from './session-runtime.js';
import { UpdateCheckLifecycle } from './hooks/update-check.js';
import { McpWiring, parseMcpConfig } from './hooks/mcp-wiring.js';
import { DEFAULT_WARMUP_TIMEOUT_MS } from './mcp/mcp-tool-provider.js';
import { toast } from './hooks/toast.js';

const ALLOWED_CONFIG_KEYS = new Set(['alwaysLoad', 'maxResults', 'mode', 'resetTools', 'mcp', 'timeout']);

function validateConfig(rawOpts: Record<string, unknown>): void {
  for (const key of Object.keys(rawOpts)) {
    if (!ALLOWED_CONFIG_KEYS.has(key) && process.env.TOOL_SEARCH_DEBUG) {
      console.warn(
        `[ToolSearchPlugin] Unknown or deprecated configuration key "${key}". Allowed keys: ${Array.from(ALLOWED_CONFIG_KEYS).join(', ')}.`,
      );
    }
  }
}

function buildEmbedding(isKeywordMode: boolean): EmbedConfig {
  return {
    enabled: !isKeywordMode,
    quantized: false,
    useWorker: true,
  };
}

/**
 * OpenCode adapter for the tool-search runtime. Kept deliberately thin: all
 * deferred-tool behavior (catalog, authorization, delivery filtering,
 * semantic prebuild, compaction) lives in SessionRuntime; MCP warm-up and
 * process cleanup live in McpWiring; update-check dedup/latch lives in
 * UpdateCheckLifecycle; and toast/deferral formatting live in the hooks
 * modules. This file only translates OpenCode hook calls into those seams.
 */
const ToolSearchPluginImpl: Plugin = async (ctx, options?: PluginOptions): Promise<Hooks> => {
  const rawOpts = (options ?? {}) as Record<string, unknown>;
  validateConfig(rawOpts);

  const opts = rawOpts as ToolSearchConfig;
  const resetToolIDs = new Set(['compress', ...(opts.resetTools ?? [])]);
  const maxResults = opts.maxResults ?? 10;
  const alwaysLoadTools = opts.alwaysLoad ?? [];
  const deferLabel = DEFAULT_DEFER;
  const isKeywordMode = opts.mode === 'keyword';

  const runtime = new SessionRuntime(ctx, {
    alwaysOn: [...SEARCH_IDS, ...alwaysLoadTools],
    resetTools: resetToolIDs,
    maxResults,
    deferLabel,
    embedding: buildEmbedding(isKeywordMode),
  });

  const mcp = new McpWiring(
    runtime.vault,
    runtime.sessionRegistry,
    runtime.searchTools,
    opts.timeout ?? DEFAULT_WARMUP_TIMEOUT_MS,
  );
  const updateCheck = new UpdateCheckLifecycle(ctx);

  const pluginMcpConfig = parseMcpConfig(opts.mcp);
  if (pluginMcpConfig) {
    // WAIT-ALL PRE-WARM: opencode freezes the session tool-set at start
    // (~0-2s); MCP tools registered after that snapshot are permanently
    // uncallable. So the factory blocks until EVERY enabled server settles or
    // is CUT at its per-server ceiling (timeout, default 60s — a cut emits
    // console.warn). Anything that settles is first-class in the session;
    // anything cut is honestly absent (status-only placeholder retained).
    // Non-MCP loads: no call, no delay.
    mcp.init(pluginMcpConfig);
    await mcp.preWarm();
  }

  setTimeout(() => toast(ctx, 'Tool Search', 'Active — tools will be deferred on first prompt.', 'info', 4000), 3000);

  const hooks: Hooks = {
    config: async (cfg) => {
      const topLevelMcp = parseMcpConfig((cfg as { mcp?: unknown } | undefined)?.mcp);
      if (topLevelMcp && !mcp.isInitialized) {
        mcp.init(topLevelMcp);
        await mcp.preWarm();
      }
    },
    tool: runtime.searchTools,
    'tool.definition': async (input, output) => {
      if (SEARCH_IDS.has(input.toolID)) return;
      // opencode's runtime hook output carries `jsonSchema` (Tool.Def.jsonSchema)
      // alongside `parameters` — prefer it when present (already model-facing
      // JSON Schema). The typed contract omits it, so read it defensively.
      const jsonSchema = (output as { jsonSchema?: unknown }).jsonSchema;
      output.description = runtime.deferTool(input.toolID, output.description, output.parameters, jsonSchema);
    },
    'tool.execute.before': async (input) => {
      if (SEARCH_IDS.has(input.tool)) return;
      const meta = runtime.vault.resolveAlias(input.tool);
      const canonical = meta?.id ?? input.tool;
      runtime.assertAuthorized(input.tool, input.sessionID, canonical);
    },
    'tool.execute.after': async (input, output) => {
      const notice = runtime.handleToolExecuted(input.tool, input.sessionID);
      if (notice) {
        output.output = `${String(output.output ?? '')}${notice}`;
        return;
      }
    },
    'experimental.chat.messages.transform': async (_input, output) => {
      const msgs = output?.messages;
      if (Array.isArray(msgs) && msgs.length > 0) {
        // Extract sessionID from messages if available
        const firstMsg = msgs[0];
        const sessionID = (firstMsg?.info as { sessionID?: string } | undefined)?.sessionID;
        runtime.syncSleevCompression(sessionID, msgs);
      }
    },
    'experimental.chat.system.transform': async (input, output) => {
      const inputTyped = input as { sessionID?: string; messages?: Array<{ role?: string; content?: unknown }> };
      runtime.syncSleevCompression(inputTyped.sessionID, inputTyped.messages);
      const state = runtime.prepareForSystemTransform();
      if (state.policyText) {
        output.system.push(state.policyText);
      }
      if (state.alert) {
        toast(ctx, state.alert.title, state.alert.message, state.alert.variant, state.alert.duration);
      }
    },
    'experimental.session.compacting': async (input, output) => {
      output.context.push(runtime.compactSession(input.sessionID));
    },
    event: async ({ event }) => {
      if (event.type === 'session.deleted') {
        const sessionID = (event.properties as { sessionID?: unknown } | undefined)?.sessionID;
        if (typeof sessionID === 'string' && sessionID.length > 0) {
          runtime.deleteSession(sessionID);
        }
        return;
      }
      await updateCheck.handleEvent(event.type);
    },
  };
  return hooks;
};

export const ToolSearchPlugin = Object.assign(ToolSearchPluginImpl, {
  id: 'openstellar-tool-search',
  server: ToolSearchPluginImpl,
});
