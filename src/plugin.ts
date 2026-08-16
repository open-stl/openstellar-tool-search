import type { Hooks, Plugin, PluginOptions } from '@opencode-ai/plugin';
import type { ToolSearchConfig, EmbedConfig } from './types.js';
import { SessionRuntime, SEARCH_IDS, DEFAULT_DEFER } from './engine/session-engine.js';
import { UpdateCheckLifecycle } from './hooks/update-check.js';
import { McpWiring, parseMcpConfig } from './hooks/mcp-wiring.js';
import { DEFAULT_WARMUP_TIMEOUT_MS } from './mcp/mcp-tool-provider.js';
import { toast } from './hooks/toast.js';
import { setupV2 } from './v2/setup.js';

const ALLOWED_CONFIG_KEYS = new Set(['alwaysLoad', 'maxResults', 'mode', 'resetTools', 'mcp', 'timeout']);

export function validateConfig(rawOpts: Record<string, unknown>): void {
  for (const key of Object.keys(rawOpts)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      console.warn(
        `[ToolSearchPlugin] Unknown or deprecated configuration key "${key}". Allowed keys: ${Array.from(ALLOWED_CONFIG_KEYS).join(', ')}.`,
      );
    }
  }
}

export function buildEmbedding(isKeywordMode: boolean): EmbedConfig {
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
  const maxResults = opts.maxResults ?? 5;
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
    mcp.init(pluginMcpConfig);
    await mcp.preWarm();
  }

  const startupTimer = setTimeout(() => {
    const total = runtime.vault.count;
    const deferrals = runtime.sessionRegistry.deferredCount;
    const msg = deferrals > 0
      ? `Active — ${deferrals}/${total} tools deferred for search optimization.`
      : 'Active — tools will be deferred on first prompt.';
    toast(ctx, 'Tool Search', msg, 'info', 4000);
  }, 1000);
  if (typeof startupTimer.unref === 'function') {
    startupTimer.unref();
  }

  const hooks: Hooks = {
    config: async (cfg) => {
      try {
        const topLevelMcp = parseMcpConfig((cfg as { mcp?: unknown } | undefined)?.mcp);
        if (topLevelMcp && !mcp.isInitialized) {
          mcp.init(topLevelMcp);
          await mcp.preWarm();
        }
      } catch {
        // silently ignore
      }
    },
    tool: runtime.searchTools,
    'tool.definition': async (input, output) => {
      try {
        if (!input || !output || SEARCH_IDS.has(input.toolID)) return;
        const jsonSchema = (output as { jsonSchema?: unknown }).jsonSchema;
        output.description = runtime.deferTool(input.toolID, output.description, output.parameters, jsonSchema);
      } catch {
        // silently ignore
      }
    },
    'tool.execute.before': async (input) => {
      if (!input || SEARCH_IDS.has(input.tool)) return;
      const meta = runtime.vault.resolveAlias(input.tool);
      const canonical = meta?.id ?? input.tool;
      runtime.assertAuthorized(input.tool, input.sessionID, canonical);
    },
    'tool.execute.after': async (input, output) => {
      try {
        if (!input || !output) return;
        const notice = runtime.handleToolExecuted(input.tool, input.sessionID);
        if (notice) {
          output.output = `${String(output.output ?? '')}${notice}`;
        }
      } catch {
        // silently ignore
      }
    },
    'experimental.chat.messages.transform': async (_input, output) => {
      try {
        const msgs = output?.messages;
        if (Array.isArray(msgs) && msgs.length > 0) {
          const firstMsg = msgs[0];
          const sessionID = (firstMsg?.info as { sessionID?: string } | undefined)?.sessionID;
          runtime.syncSleevCompression(sessionID, msgs);
        }
      } catch {
        // silently ignore
      }
    },
    'experimental.chat.system.transform': async (input, output) => {
      try {
        const inputTyped = input as { sessionID?: string; messages?: Array<{ role?: string; content?: unknown }> };
        runtime.syncSleevCompression(inputTyped?.sessionID, inputTyped?.messages);
        const state = runtime.prepareForSystemTransform();
        if (state.policyText && output?.system) {
          output.system.push(state.policyText);
        }
        if (state.alert) {
          toast(ctx, state.alert.title, state.alert.message, state.alert.variant, state.alert.duration);
        }
      } catch {
        // silently ignore
      }
    },
    'experimental.session.compacting': async (input, output) => {
      try {
        if (!input?.sessionID || !output?.context) return;
        output.context.push(runtime.compactSession(input.sessionID));
      } catch {
        // silently ignore
      }
    },
    event: async ({ event }) => {
      try {
        if (event?.type === 'session.deleted') {
          const sessionID = (event.properties as { sessionID?: unknown } | undefined)?.sessionID;
          if (typeof sessionID === 'string' && sessionID.length > 0) {
            runtime.deleteSession(sessionID);
          }
          return;
        }
        if (event?.type) {
          await updateCheck.handleEvent(event.type);
        }
      } catch {
        // silently ignore
      }
    },
  };

  return hooks;
};

export const ToolSearchPlugin = Object.assign(ToolSearchPluginImpl, {
  id: 'openstellar-tool-search',
  setup: setupV2,
  server: ToolSearchPluginImpl,
});

export const plugin = ToolSearchPlugin;
export default ToolSearchPlugin;
