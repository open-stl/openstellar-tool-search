import type { Hooks, Plugin, PluginOptions } from '@opencode-ai/plugin';
import { SEARCH_IDS } from './engine/session-engine.js';
import { parseMcpConfig } from './hooks/mcp-wiring.js';
import { toast } from './hooks/toast.js';
import { setupV2 } from './v2/setup.js';
import { bootstrapPluginCore, validateConfig, buildEmbedding } from './core/bootstrap.js';

/**
 * OpenCode adapter for the tool-search runtime. Kept deliberately thin: all
 * deferred-tool behavior (catalog, authorization, delivery filtering,
 * semantic prebuild, compaction) lives in SessionRuntime; MCP warm-up and
 * process cleanup live in McpWiring; update-check dedup/latch lives in
 * UpdateCheckLifecycle; and toast/deferral formatting live in the hooks
 * modules. This file only translates OpenCode hook calls into those seams.
 */
const ToolSearchPluginImpl: Plugin = async (ctx, options?: PluginOptions): Promise<Hooks> => {
  const { runtime, mcp, updateCheck } = await bootstrapPluginCore(ctx, options as any);

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
        runtime.enrichToolExecutionOutput(input.tool, input.sessionID, output);
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
        runtime.handleSessionEvent(event);
        if (event?.type && event.type !== 'session.deleted') {
          await updateCheck.handleEvent(event.type);
        }
      } catch {
        // silently ignore
      }
    },
  };

  return hooks;
};

export { validateConfig, buildEmbedding };
export const ToolSearchPlugin = ToolSearchPluginImpl;
export const plugin = {
  id: 'openstellar-tool-search',
  server: ToolSearchPluginImpl,
  setup: setupV2,
};

export default plugin;
