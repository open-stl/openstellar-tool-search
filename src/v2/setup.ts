import { SEARCH_IDS } from '../engine/session-engine.js';
import { truncateDescription } from '../hooks/deferral.js';
import { normalizeParameters } from '../catalog/schema-normalize.js';
import { toast } from '../hooks/toast.js';
import { bootstrapPluginCore, bootstrapLog, loadFallbackMcpConfig } from '../core/bootstrap.js';

export { loadFallbackMcpConfig };

export async function setupV2(ctx: any, options?: Record<string, unknown>): Promise<void> {
  bootstrapLog('[v2] setupV2 invoked', { options: options ?? {} });
  const { runtime, mcp, updateCheck } = await bootstrapPluginCore(
    ctx,
    options ?? ctx?.options,
    ctx?.directory ?? ctx?.cwd,
  );

  let updateSubscribed = false;

  // OpenCode 2.0 tool registration
  ctx.tool?.transform?.((registry: any) => {
    bootstrapLog('[v2] ctx.tool.transform registering search tools');
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
        execute: async (args: any, context: any) => {
          const res = await runtime.searchTools.tool_search.execute(args, context);
          return typeof res === 'object' && res !== null ? res : { content: String(res ?? '') };
        },
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
        execute: async (args: any, context: any) => {
          const res = await runtime.searchTools.tool_search_regex.execute(args, context);
          return typeof res === 'object' && res !== null ? res : { content: String(res ?? '') };
        },
      });

      const registerToolToRegistry = (toolName: string, toolObj: any) => {
        if (toolName === 'tool_search' || toolName === 'tool_search_regex') return;
        const vaultEntry = runtime.vault.get(toolName);
        const desc = (toolObj as any)?.description ?? vaultEntry?.description ?? 'MCP tool';
        const params = vaultEntry?.parameters ?? (toolObj as any)?.args ?? { type: 'object', properties: {} };
        registry.add({
          name: toolName,
          options: { codemode: false },
          description: desc,
          input: params,
          execute: async (args: any, context: any) => {
            const res = await (toolObj as any)?.execute?.(args, context);
            return typeof res === 'object' && res !== null ? res : { content: String(res ?? '') };
          },
        });
      };

      for (const [toolName, toolObj] of Object.entries(runtime.searchTools)) {
        registerToolToRegistry(toolName, toolObj);
      }

      if (!updateSubscribed) {
        updateSubscribed = true;
        mcp.provider?.onUpdate?.((_updatedTools) => {
          for (const [toolName, toolObj] of Object.entries(runtime.searchTools)) {
            registerToolToRegistry(toolName, toolObj);
          }
        });
      }
    }
  });

  // OpenCode 2.0 tool execution hooks
  ctx.tool?.hook?.('execute.before', async (input: any) => {
    if (!input || SEARCH_IDS.has(input.tool)) return;
    bootstrapLog('[v2] execute.before check', { tool: input.tool, sessionID: input.sessionID });
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
    bootstrapLog('[v2] session.hook(context) called', { sessionID: sessionCtx.sessionID });
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
