/**
 * Deterministic spec for the MCP warm-up race-window fix (Phase 2).
 *
 * Original bug: plugin startup fires MCP warm-up off in the background
 * (src/plugin.ts:64 `mcp.init(pluginMcpConfig)`, src/hooks/mcp-wiring.ts:52
 * `void this.warmUp(mcpProvider)`) and returns the plugin to OpenCode before
 * the MCP tools exist. A `tool_search` / `tool_search_regex` executed inside
 * that window previously went through `await vault.awaitReady(SEARCH_TIMEOUT_MS)`
 * and — because the provider's awaitReady raced warm-up against a 2s timer
 * that won whenever warm-up was slower than 2s
 * (src/mcp/mcp-tool-provider.ts:113-130) — fell through to a 0-hit query and
 * reported "No matches ..." (src/session-runtime.ts). The model then believed
 * the MCP tool did not exist.
 *
 * FIX (implemented): awaitReady is now status-returning (Promise<boolean> —
 * true = ready/settled, false = still warming). The search executors are
 * two-phase: phase 1 waits the standard 2s budget; if it found no hits while
 * the catalog was still warming (`!ready`), phase 2 waits the extended 3s
 * budget and re-runs the SAME query before declaring a negative. A slow-but-
 * alive server (like this file's SLOW_SERVER_MS = 2.5s) now resolves IN-CALL
 * and the search finds the tool. A genuinely hung server degrades to a
 * distinguishable "still warming up" message — never "No matches".
 *
 * These tests document the FIXED behavior: 1a/1b now assert the tool IS found
 * in-call (they were the bug repros asserting "No matches"). No src/ regressions:
 * the fast path (catalog already ready) is unchanged, and a genuinely empty
 * catalog still returns the honest "No matches" (test 4).
 *
 * NOTE re tests/plugin-startup-latency.test.ts: that test now asserts the
 * WAIT-ALL contract — L2 (fast server) resolves at settle with the real tool
 * pre-snapshot; L3 (hanging server) resolves bounded with the `hanging`
 * placeholder retained (`Object.keys(tools)` = ['hanging']). No "empty-tool
 * state" assertion remains: under wait-all the factory returns only after
 * every server settled or was cut.
 *
 * Test mechanics: the MCP transport is faked end-to-end at the AdapterCache
 * boundary (no network). A cache entry whose handshake + `listTools` resolve
 * after a controlled delay is pre-seeded into the REAL globalAdapterCache, so
 * the REAL McpToolProvider (constructed by the real plugin) finds it via
 * getReady/isAlive. The moment warm-up finishes — and its tools land in the
 * ToolStore via onUpdate propagation — is exactly observable. Deterministic:
 * no real network, real small delays, no fake timers.
 *
 * Timing note: the fixed search waits warm-up out in-call, so the slow-server
 * tests 1a/1b cost ~2.5s of real time each (the wait until the server
 * answers). The 600ms "no long sleeps" guideline applies to the test's own
 * orchestration sleeps; the >2s fake-server delay is the subject under test.
 */

import { describe, it, expect, vi } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Hooks, PluginInput } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';
import { McpToolProvider } from '../src/mcp/mcp-tool-provider.js';
import { globalAdapterCache } from '../src/mcp/adapter-cache.js';
import type { Transport } from '../src/mcp/transport-factory.js';
import { SEARCH_TIMEOUT_MS, EXTENDED_WAIT_MS, WARMING_MESSAGE } from '../src/session-runtime.js';
import { ToolVault } from '../src/vault.js';

// Phase-1 readiness ceiling (SEARCH_TIMEOUT_MS = 2s) and phase-2 extended
// budget (EXTENDED_WAIT_MS = 3s). A slow-but-alive server answering between
// them resolves in-call via phase 2.
const CEILING_MS = SEARCH_TIMEOUT_MS;
const EXTENDED_MS = EXTENDED_WAIT_MS;

// Slow server: answers warm-up at ~2.5s — AFTER the 2s phase-1 ceiling but
// comfortably WITHIN the 5s (2s+3s) total budget, with ~2.5s of CI margin.
// The fixed search therefore waits it out in-call and finds the tool.
const SLOW_SERVER_MS = 2500;

// Fast server: answers warm-up in ~10ms so tests 2a/2b finish quickly.
const FAST_SERVER_MS = 10;

// Orchestration sleep for propagation (warmUp → notifyListeners → onUpdate →
// store.add). Generous; the test's own sleeps never exceed 600ms.
const PROPAGATION_SLEEP_MS = 600;

// Generous multiplier for "did NOT exceed the budget" bounds (slow CI).
const BUDGET_SLACK = 2.5;

/** MCP tool fixture surfaced by the fake server. */
const MCP_TOOL = { name: 'query_docs', description: 'Query the documentation for a package' };
const MCP_TOOL_ID = 'srv_query_docs';

/** Server config used BOTH for seeding the cache key and the plugin's mcp option. */
const SRV_CONFIG = {
  name: 'srv',
  type: 'remote' as const,
  url: 'http://127.0.0.1:9/sse',
  defer_loading: true,
};

interface FakeEntry {
  tools: Record<string, never>;
  client: {
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
  };
  transport: Transport;
}

/**
 * Fake server client. `listTools` call #1 is the cache's isAlive probe and
 * resolves instantly; subsequent calls are the actual warm-up listTools and
 * resolve after `delayMs`. `delayMs === Infinity` hangs forever (never
 * resolves) for the ceiling test.
 */
function fakeEntry(delayMs: number, tools: { name: string; description: string }[] = []): FakeEntry {
  let calls = 0;
  return {
    tools: {},
    client: {
      listTools: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls === 1) return { tools: [] }; // isAlive probe: instant
        if (delayMs === Infinity) return new Promise(() => {}); // hang forever
        await sleep(delayMs);
        return { tools };
      }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    },
    transport: { close: vi.fn() } as unknown as Transport,
  } as unknown as FakeEntry;
}

/**
 * Seed the real globalAdapterCache with a fake server entry. The real
 * McpToolProvider then finds it via getReady/isAlive — no network, fully
 * deterministic warm-up timing. Provider and cache are both real; only the
 * transport is faked. Returns the cache key for cleanup.
 */
function seedCache(delayMs: number, tools: { name: string; description: string }[] = [MCP_TOOL]): { key: string; entry: FakeEntry } {
  const entry = fakeEntry(delayMs, tools);
  const key = globalAdapterCache.getServerKey(SRV_CONFIG);
  globalAdapterCache.set(
    key,
    entry as unknown as Parameters<typeof globalAdapterCache.set>[1],
  );
  return { key, entry };
}

/** Load the real plugin with an `mcp` config whose transport is pre-seeded. */
async function loadPluginWithSeededMcp(delayMs: number, preWarmMs?: number): Promise<Hooks> {
  seedCache(delayMs);
  return (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
    makeCtx(),
    {
      mode: 'keyword',
      ...(preWarmMs !== undefined ? { preWarmMs } : {}),
      mcp: { srv: { type: 'remote', url: SRV_CONFIG.url, defer_loading: true } },
    },
  );
}

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
      },
    } as any,
    project: {} as any,
    directory: '/tmp',
    worktree: '/tmp',
    experimental_workspace: { register: vi.fn() } as any,
    serverUrl: new URL('http://localhost'),
    $: {} as any,
  } as any;
}

function searchToolOf(hooks: Hooks, name: 'tool_search' | 'tool_search_regex'): any {
  return (hooks.tool as any)[name];
}

async function execSearch(searchTool: any, args: { query?: string; pattern?: string }, sessionID: string): Promise<string> {
  const result = await searchTool.execute(args, {
    sessionID,
    messageID: `msg-${sessionID}`,
    agent: 'test',
    directory: '/tmp',
    worktree: '/tmp',
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn().mockResolvedValue(undefined),
  });
  return typeof result === 'string' ? result : (result as any).output;
}

/** Remove the seeded fake from the global cache. */
function clearSeeded(key: string): void {
  globalAdapterCache.delete(key).catch(() => {});
}

describe('wait-all factory: slow server settles pre-snapshot; search finds it in phase 1', () => {
  it('1a. tool_search finds the MCP tool immediately after wait-all factory (no extended wait)', async () => {
    // Wait-all: the factory blocks until the 2.5s server settles, so the tool
    // is pre-snapshot. The search finds it in PHASE 1 (fast) — the two-phase
    // executor's extended wait is only a config-hook safety net now.
    const hooks = await loadPluginWithSeededMcp(SLOW_SERVER_MS);
    const searchTool = searchToolOf(hooks, 'tool_search');

    const start = Date.now();
    const out = await execSearch(searchTool, { query: 'documentation' }, 'race-sess-1a');
    const elapsed = Date.now() - start;

    expect(out).toContain(MCP_TOOL_ID);
    expect(out).toContain('Query the documentation for a package');
    // Found immediately (phase 1) — NOT after the 2s+3s extended wait.
    expect(elapsed).toBeLessThan(CEILING_MS * 0.5);
  }, 15_000);

  it('1b. tool_search_regex finds the MCP tool immediately after wait-all factory', async () => {
    const hooks = await loadPluginWithSeededMcp(SLOW_SERVER_MS);
    const regexTool = searchToolOf(hooks, 'tool_search_regex');

    const start = Date.now();
    const out = await execSearch(regexTool, { pattern: `^${MCP_TOOL_ID}$` }, 'race-sess-1b');
    const elapsed = Date.now() - start;

    expect(out).toContain(MCP_TOOL_ID);
    expect(out).toContain('Query the documentation for a package');
    expect(elapsed).toBeLessThan(CEILING_MS * 0.5);
  }, 15_000);

  it('1c. wait-all factory populated the bridge pre-snapshot (placeholder removed, real tool present)', async () => {
    // After wait-all, the bridge has the REAL tool and the placeholder is
    // removed (server settled with tools) — no "empty window" state remains.
    const hooks = await loadPluginWithSeededMcp(SLOW_SERVER_MS);

    expect((hooks.tool as any)[MCP_TOOL_ID]).toBeDefined();
    expect((hooks.tool as any)['srv']).toBeUndefined();
    expect(hooks.tool).toHaveProperty('tool_search');
    expect(hooks.tool).toHaveProperty('tool_search_regex');
  }, 15_000);
});

describe('after warm-up completes, search finds the MCP tools (fixed-path proof)', () => {
  it('2a. tool_search finds the MCP tool end-to-end after warm-up propagates', async () => {
    const hooks = await loadPluginWithSeededMcp(FAST_SERVER_MS); // warm-up lands in ~10ms
    const searchTool = searchToolOf(hooks, 'tool_search');

    // Wait for warm-up + onUpdate propagation into the store, plus the wiring
    // bridge (warmUp → notifyListeners → store.add → bridge write).
    await sleep(PROPAGATION_SLEEP_MS);

    const out = await execSearch(searchTool, { query: 'documentation' }, 'race-sess-2a');
    expect(out).toContain(MCP_TOOL_ID);
    expect(out).toContain('Query the documentation for a package');

    // The wiring bridge surfaces the tool with a DEFERRED description
    // (mcp-wiring.ts:72-74 truncates + appends the deferral label).
    const bridgeTool = (hooks.tool as any)[MCP_TOOL_ID];
    expect(bridgeTool).toBeDefined();
    expect(bridgeTool.description).toBe('Query the documentation for a package [deferred]');
  }, 10_000);

  it('2b. provider warm-up awaited directly: deferred flag on the MCP tool definition', async () => {
    const { key } = seedCache(FAST_SERVER_MS);
    const provider = new McpToolProvider({ srv: { type: 'remote', url: SRV_CONFIG.url, defer_loading: true } });
    const definitions = await provider.warmUp(); // awaited, unlike the fire-and-forget startup path

    expect(definitions).toHaveLength(1);
    expect(definitions[0].id).toBe(MCP_TOOL_ID);
    expect(definitions[0].deferred).toBe(true); // defer_loading: true → deferred flag
    expect(definitions[0].description).toBe('Query the documentation for a package');
    clearSeeded(key);
  }, 10_000);
});

describe('wait-all + ceiling: hung server is CUT; honest negative after settle', () => {
  it('3. a hung MCP server cut at its ceiling yields honest "No matches" (settled), not warming', async () => {
    // Never-resolving handshake — listTools hangs forever. With a small
    // per-server ceiling (250ms), wait-all returns ≈ the ceiling with the hung
    // server CUT (fail-open). The aggregate is SETTLED → the search returns
    // the honest definitive negative, never WARMING_MESSAGE.
    const { key } = seedCache(Infinity, []);
    const provider = new McpToolProvider(
      { srv: { type: 'remote', url: SRV_CONFIG.url, defer_loading: true } },
      undefined,
      undefined,
      250,
    );
    const vault = new ToolVault({ embedding: { enabled: false } });
    await vault.registerProvider(provider);
    void provider.warmUp(); // fire-and-forget — cut at 250ms ceiling

    // After the ceiling, the provider is settled (awaitReady(0) → true).
    await sleep(400);
    expect(await provider.awaitReady(0)).toBe(true);
    expect(vault.count).toBe(0);

    // Full search path through the plugin (same 250ms ceiling): factory
    // returns ≈ ceiling, aggregate settled → honest "No matches".
    const hooks = await loadPluginWithSeededMcp(Infinity, 250);
    const searchTool = searchToolOf(hooks, 'tool_search');
    const out = await execSearch(searchTool, { query: 'documentation' }, 'race-sess-3');
    expect(out).toMatch(/^No matches for "documentation"/);
    expect(out).not.toContain('warming');
    // Placeholder retained (cut server → status reader).
    expect((hooks.tool as any)['srv']).toBeDefined();
    clearSeeded(key);
  }, 15_000);
});

describe('genuinely empty catalog still returns the honest "No matches"', () => {
  it('4. a search with no providers and no tools reports "No matches", never the warming message', async () => {
    // No MCP config, no providers, nothing seeded: the catalog is genuinely
    // empty. awaitReady is vacuously true (no providers → ready), so phase 2
    // never runs and the honest definitive negative must be returned — this
    // proves the warming message does not leak into the empty-catalog case.
    const noMcpHooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      { mode: 'keyword' }, // no mcp option → no provider ever registered
    );

    const searchTool = searchToolOf(noMcpHooks, 'tool_search');
    const start = Date.now();
    const out = await execSearch(searchTool, { query: 'documentation' }, 'race-sess-4');
    const elapsed = Date.now() - start;

    expect(out).toMatch(/^No matches for "documentation"/);
    expect(out).not.toContain('warming');
    // Returns immediately — no 2s wait, no phase 2.
    expect(elapsed).toBeLessThan(CEILING_MS * 0.5);

    // Same for the regex path.
    const regexTool = searchToolOf(noMcpHooks, 'tool_search_regex');
    const outRegex = await execSearch(regexTool, { pattern: `^${MCP_TOOL_ID}$` }, 'race-sess-4b');
    expect(outRegex).toBe(`No tools matched pattern "^${MCP_TOOL_ID}$".`);
  }, 10_000);
});
