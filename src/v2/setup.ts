import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ToolSearchConfig } from '../types.js';
import type { McpServerConfig } from '../mcp/types.js';
import { SessionRuntime, SEARCH_IDS, DEFAULT_DEFER } from '../engine/session-engine.js';
import { UpdateCheckLifecycle } from '../hooks/update-check.js';
import { McpWiring, parseMcpConfig } from '../hooks/mcp-wiring.js';
import { DEFAULT_WARMUP_TIMEOUT_MS } from '../mcp/mcp-tool-provider.js';
import { truncateDescription } from '../hooks/deferral.js';
import { normalizeParameters } from '../catalog/schema-normalize.js';
import { toast } from '../hooks/toast.js';
import { validateConfig, buildEmbedding } from '../plugin.js';

function v2log(msg: string, data?: unknown): void {
  try {
    const logDir = path.join(os.homedir(), '.local', 'share', 'opencode', 'log');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, 'tool-search.log');
    const timestamp = new Date().toISOString();
    const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}${dataStr}\n`, 'utf-8');
  } catch {
    // silently ignore log writing errors
  }
}

function parseJsonc(content: string): unknown {
  try {
    const noComments = content.replace(/("(?:\\.|[^"\\])*")|(\/\*[\s\S]*?\*\/)|(\/\/.*$)/gm, (match, str) => (str ? str : ''));
    const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(noTrailingCommas);
  } catch {
    return undefined;
  }
}

export function loadFallbackMcpConfig(workspaceDir?: string): Record<string, McpServerConfig> | McpServerConfig[] | undefined {
  const rootDir = workspaceDir ?? process.cwd();
  const candidatePaths = [
    path.join(rootDir, 'opencode.jsonc'),
    path.join(rootDir, 'opencode.json'),
    path.join(rootDir, '.opencode', 'opencode.jsonc'),
    path.join(rootDir, '.opencode', 'opencode.json'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseJsonc(content) as Record<string, unknown> | undefined;
        if (parsed && typeof parsed === 'object' && parsed.mcp) {
          const mcpCfg = parseMcpConfig(parsed.mcp);
          if (mcpCfg) return mcpCfg;
        }
      }
    } catch {
      // ignore file read / parse error
    }
  }
  return undefined;
}

export async function setupV2(ctx: any, options?: Record<string, unknown>): Promise<void> {
  v2log('[v2] setupV2 invoked', { options: options ?? {} });
  const rawOpts = (options ?? ctx?.options ?? {}) as Record<string, unknown>;
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
    notify: (title, message, variant, duration) => toast(ctx, title, message, variant, duration),
  });

  const mcp = new McpWiring(
    runtime.vault,
    runtime.sessionRegistry,
    runtime.searchTools,
    opts.timeout ?? DEFAULT_WARMUP_TIMEOUT_MS,
  );
  const updateCheck = new UpdateCheckLifecycle(ctx);

  let pluginMcpConfig = parseMcpConfig(opts.mcp);
  if (!pluginMcpConfig) {
    pluginMcpConfig = loadFallbackMcpConfig(ctx?.directory ?? ctx?.cwd);
  }
  if (pluginMcpConfig) {
    const serverNames = Array.isArray(pluginMcpConfig)
      ? pluginMcpConfig.map((s) => s.name ?? 'unnamed')
      : Object.keys(pluginMcpConfig);
    v2log(`[v2] Initializing MCP servers: ${serverNames.join(', ')}`);
    mcp.init(pluginMcpConfig);
    await mcp.preWarm();
    v2log(`[v2] MCP pre-warm completed. Total catalog tools in vault: ${runtime.vault.count}`);
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

  let updateSubscribed = false;

  // OpenCode 2.0 tool registration
  ctx.tool?.transform?.((registry: any) => {
    v2log('[v2] ctx.tool.transform registering search tools');
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
    v2log('[v2] execute.before check', { tool: input.tool, sessionID: input.sessionID });
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
    v2log('[v2] session.hook(context) called', { sessionID: sessionCtx.sessionID });
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
