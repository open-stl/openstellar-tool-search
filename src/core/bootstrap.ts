import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ToolSearchConfig, EmbedConfig } from '../types.js';
import type { McpServerConfig } from '../mcp/types.js';
import { SessionRuntime, SEARCH_IDS, DEFAULT_DEFER } from '../engine/session-engine.js';
import { UpdateCheckLifecycle } from '../hooks/update-check.js';
import { McpWiring, parseMcpConfig } from '../hooks/mcp-wiring.js';
import { DEFAULT_WARMUP_TIMEOUT_MS } from '../mcp/mcp-tool-provider.js';
import { toast } from '../hooks/toast.js';

export const ALLOWED_CONFIG_KEYS = new Set(['alwaysLoad', 'maxResults', 'mode', 'resetTools', 'mcp', 'timeout']);

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

export function parseJsonc(content: string): unknown {
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

export function bootstrapLog(msg: string, data?: unknown): void {
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

export interface PluginCore {
  runtime: SessionRuntime;
  mcp: McpWiring;
  updateCheck: UpdateCheckLifecycle;
  opts: ToolSearchConfig;
}

export async function bootstrapPluginCore(
  ctx: any,
  rawOptions?: Record<string, unknown>,
  workspaceDir?: string,
): Promise<PluginCore> {
  const rawOpts = (rawOptions ?? ctx?.options ?? {}) as Record<string, unknown>;
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
    pluginMcpConfig = loadFallbackMcpConfig(workspaceDir);
  }
  if (pluginMcpConfig) {
    const serverNames = Array.isArray(pluginMcpConfig)
      ? pluginMcpConfig.map((s) => s.name ?? 'unnamed')
      : Object.keys(pluginMcpConfig);
    bootstrapLog(`Initializing MCP servers: ${serverNames.join(', ')}`);
    mcp.init(pluginMcpConfig);
    await mcp.preWarm();
    bootstrapLog(`MCP pre-warm completed. Total catalog tools in vault: ${runtime.vault.count}`);
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

  return { runtime, mcp, updateCheck, opts };
}
