import type { ToolSearchConfig } from '../types.js';
import { SessionRuntime, SEARCH_IDS, DEFAULT_DEFER } from '../engine/session-engine.js';
import { UpdateCheckLifecycle } from '../hooks/update-check.js';
import { McpWiring, parseMcpConfig } from '../hooks/mcp-wiring.js';
import { DEFAULT_WARMUP_TIMEOUT_MS } from '../mcp/mcp-tool-provider.js';
import { truncateDescription } from '../hooks/deferral.js';
import { normalizeParameters } from '../catalog/schema-normalize.js';
import { toast } from '../hooks/toast.js';
import { validateConfig, buildEmbedding } from '../plugin.js';

export async function setupV2(ctx: any, options?: Record<string, unknown>): Promise<void> {
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

  // OpenCode 2.0 tool registration
  ctx.tool?.transform?.((registry: any) => {
    if (typeof registry?.add === 'function') {
      registry.add({
        name: 'tool_search',
        options: { codemode: false },
        description: runtime.searchTools.tool_search.description,
        input: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Semantic capability or task description (e.g. "search code AST", "fetch web page").',
            },
          },
          required: ['query'],
        },
        execute: (args: any, context: any) => runtime.searchTools.tool_search.execute(args, context),
      });

      registry.add({
        name: 'tool_search_regex',
        options: { codemode: false },
        description: runtime.searchTools.tool_search_regex.description,
        input: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Anchored regex for exact ID: "^id$", multiple IDs: "^(toolA|toolB)$", or prefix: "^prefix_".',
            },
          },
          required: ['pattern'],
        },
        execute: (args: any, context: any) => runtime.searchTools.tool_search_regex.execute(args, context),
      });
    }
  });

  // OpenCode 2.0 tool execution hooks
  ctx.tool?.hook?.('execute.before', async (input: any) => {
    if (!input || SEARCH_IDS.has(input.tool)) return;
    const meta = runtime.vault.resolveAlias(input.tool);
    const canonical = meta?.id ?? input.tool;
    runtime.assertAuthorized(input.tool, input.sessionID, canonical);
  });

  ctx.tool?.hook?.('execute.after', async (input: any, output: any) => {
    try {
      if (!input || !output) return;
      const notice = runtime.handleToolExecuted(input.tool, input.sessionID);
      if (notice) {
        output.output = `${String(output.output ?? '')}${notice}`;
      }
    } catch {
      // silently ignore
    }
  });

  // OpenCode 2.0 session context hook
  ctx.session?.hook?.('context', async (sessionCtx: any) => {
    if (!sessionCtx) return;
    runtime.syncSleevCompression(sessionCtx.sessionID, sessionCtx.messages);
    if (sessionCtx.tools && typeof sessionCtx.tools === 'object') {
      for (const [toolName, toolDef] of Object.entries(sessionCtx.tools as Record<string, any>)) {
        if (!toolDef || typeof toolDef !== 'object' || SEARCH_IDS.has(toolName)) continue;
        const normalizedInput = normalizeParameters(toolDef.input, toolDef.jsonSchema);
        runtime.vault.add(toolName, toolDef.description, normalizedInput);
        if (runtime.sessionRegistry.registerTool(toolName)) {
          if (!runtime.sessionRegistry.isAuthorized(sessionCtx.sessionID, toolName)) {
            const pristineDesc = runtime.vault.get(toolName)?.description ?? toolDef.description;
            toolDef.description = truncateDescription(pristineDesc, runtime.deferLabel);
            toolDef.input = {
              type: 'object',
              properties: {
                reason: {
                  type: 'string',
                  description: 'Brief explanation of why you are calling this tool',
                },
              },
              required: ['reason'],
            };
          } else {
            const stored = runtime.vault.get(toolName);
            if (stored) {
              toolDef.description = stored.description;
              toolDef.input = stored.parameters;
            }
          }
        }
      }
    }
    const state = runtime.prepareForSystemTransform();
    if (state.policyText && Array.isArray(sessionCtx.system)) {
      sessionCtx.system.push(state.policyText);
    }
    if (state.alert) {
      toast(ctx, state.alert.title, state.alert.message, state.alert.variant, state.alert.duration);
    }
  });

  // OpenCode 2.0 event subscriber
  ctx.event?.subscribe?.(async (event: any) => {
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
  });
}
