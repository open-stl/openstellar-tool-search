import { SEARCH_IDS } from '../engine/session-engine.js';
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
      for (const [name, spec] of Object.entries(runtime.searchToolSpecs)) {
        registry.add({
          name: spec.name,
          options: { codemode: false },
          description: spec.description,
          input: spec.input,
          execute: async (args: any, context: any) => {
            const res = await spec.execute(args, context);
            return typeof res === 'object' && res !== null ? res : { content: String(res ?? '') };
          },
        });
      }

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
    runtime.applyContextTurn(sessionCtx);
  });

  // OpenCode 2.0 event subscriber
  ctx.event?.subscribe?.(async (event: any) => {
    try {
      runtime.handleSessionEvent(event);
      const evt = event?.event ?? event;
      if (evt?.type && evt.type !== 'session.deleted') {
        await updateCheck.handleEvent(evt.type);
      }
    } catch {
      // silently ignore
    }
  });
}

