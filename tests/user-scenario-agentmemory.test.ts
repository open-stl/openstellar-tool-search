/**
 * USER SCENARIO: agentmemory slow-server visibility (wait-all prewarm).
 *
 * OPT-IN (E2E_AGENTMEMORY=1): requires the REAL agentmemory MCP server to boot
 * via `npx @agentmemory/mcp`, which is environment-dependent (intermittently
 * hangs on cold npx download / native prebuild). Gated out of the default
 * suite; run explicitly when the server is reachable.
 *
 * The user's exact reported scenario: with the REAL agentmemory MCP config
 * (a local `npx @agentmemory/mcp` server whose handshake takes ~10.5s), the
 * model's FIRST prompt (built ~0-2s, before warm-up lands) saw NO agentmemory
 * tools and answered "ไม่มี agentmemory" — it didn't even know to tool_search.
 *
 * WAIT-ALL design: the factory blocks until every enabled server settles or is
 * cut at its per-server timeout (default 60s — covers the ~10.5s
 * agentmemory boot). So after the factory returns, the REAL agentmemory tools
 * are in the bridge PRE-SNAPSHOT, and the placeholder is removed (server
 * settled with tools). The model's first prompt sees the real tools.
 *
 * Uses the existing plugin harness pattern (tests/tool-search-e2e.test.ts:
 * `ToolSearchPlugin as Plugin` + `plugin(ctx, options)`); no static tool
 * fixtures are fired — this exercises the REAL MCP wiring end-to-end.
 *
 * Robustness: if the factory returns before the real tool lands (config-hook
 * edge, or agentmemory boot racing the wait), poll up to ~20s for it. The KEY
 * assertions: real tool present after settle, placeholder removed, tool_search
 * finds the real tool. There is NO assertion of "non-blocking" or
 * "placeholder visible after factory" (wait-all removed that state).
 */
import { describe, it, expect, vi } from 'vitest';
import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';

const E2E_ENABLED = process.env.E2E_AGENTMEMORY === '1';

const AGENTMEMORY_CONFIG: PluginOptions = {
  mode: 'keyword',
  mcp: {
    servers: {
      agentmemory: {
        type: 'local',
        command: ['npx', '-y', '@agentmemory/mcp'],
        defer_loading: true,
      },
    },
  },
} as PluginOptions;

function makeCtx(): PluginInput {
  return {
    client: {
      tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
        appendPrompt: vi.fn(),
        openHelp: vi.fn(),
        openSessions: vi.fn(),
        openThemes: vi.fn(),
        openModels: vi.fn(),
        showInput: vi.fn(),
        setTheme: vi.fn(),
        setMessages: vi.fn(),
        getMessages: vi.fn(),
      } as any,
    },
    project: {} as any,
    directory: '/tmp',
    worktree: '/tmp',
    experimental_workspace: { register: vi.fn() } as any,
    serverUrl: new URL('http://localhost'),
    $: {} as any,
  } as any;
}

interface UserScenarioFixture {
  hooks: Hooks;
  toolSearch: any;
}

/** Load the real plugin with the real agentmemory MCP config (no static tools). */
async function loadPlugin(options: PluginOptions): Promise<UserScenarioFixture> {
  const ctx = makeCtx();
  const plugin = ToolSearchPlugin as Plugin;
  const hooks = await plugin(ctx, options);
  if (!hooks.tool) throw new Error('plugin returned no tool hook');
  return { hooks, toolSearch: (hooks.tool as any).tool_search };
}

const TOOL_CTX = {
  sessionID: 'user-scenario-agentmemory',
  messageID: 'msg1',
  agent: 'test',
  directory: '/tmp',
  worktree: '/tmp',
  abort: new AbortController().signal,
  metadata: vi.fn(),
  ask: vi.fn().mockResolvedValue(undefined),
};

async function execSearch(tool: any, args: any): Promise<string> {
  const result = await tool.execute(args, TOOL_CTX);
  return typeof result === 'string' ? result : (result as any).output;
}

describe('USER SCENARIO: agentmemory slow server via real plugin', { skip: !E2E_ENABLED }, () => {
  it('wait-all: real agentmemory tool present after factory returns; placeholder removed; search finds it', async () => {
    const tLoad0 = Date.now();
    const { hooks, toolSearch } = await loadPlugin(AGENTMEMORY_CONFIG);
    const loadElapsed = Date.now() - tLoad0;
    console.log(`[USER] plugin loaded in ${loadElapsed}ms (wait-all: blocks until agentmemory settled or cut)`);

    // The real agentmemory tool should be present (server settled pre-snapshot
    // under wait-all). Poll up to ~20s if the factory returned early (cold
    // npx / config-hook edge) — the KEY assertion is it APPEARS, not when.
    let realToolSeen = !!(hooks.tool as any)['agentmemory_memory_recall'];
    const pollDeadline = Date.now() + 20_000;
    while (!realToolSeen && Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 500));
      realToolSeen = !!(hooks.tool as any)['agentmemory_memory_recall'];
    }
    expect(realToolSeen).toBe(true);
    console.log('[USER] real agentmemory_memory_recall present after settle');

    // Placeholder removed (server settled with tools).
    expect((hooks.tool as any)['agentmemory']).toBeUndefined();

    // tool_search finds the real agentmemory tool.
    const searchOut = await execSearch(toolSearch, { query: 'recall' });
    console.log('[USER] tool_search("recall") ->');
    console.log('  ' + searchOut.slice(0, 300));
    expect(searchOut).toContain('agentmemory_memory_recall');
  }, 45_000);
});
