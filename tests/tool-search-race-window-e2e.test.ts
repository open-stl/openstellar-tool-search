/**
 * Phase-3 e2e coverage for the two-phase MCP warm-up wait fix.
 *
 * Extends the Phase-2 unit tests (tests/tool-search-race-window.test.ts) with
 * the production-shaped scenarios Bea-1 asked for:
 *
 *   1. RETRY-RECOVERY: a search against a hung server returns WARMING_MESSAGE
 *      (NOT "No matches") — the model is told the tool MAY exist and to retry.
 *      After warm-up settles, a re-search finds the tool. Proves no poisoning.
 *
 *   2. MULTI-PROVIDER AGGREGATE: ONE plugin, TWO MCP servers — one fast
 *      (~100ms) + one hung. Exercises the fresh awaitReady(0) disambiguation
 *      in production shape:
 *        (a) the fast server's tool is found in phase 1 even while the hung
 *            server still warms — no spurious warming message;
 *        (b) a search for the hung server's tool returns WARMING_MESSAGE —
 *            still warming, not "No matches".
 *
 *   3. (Real-opencode CLI validation lives in tests/e2e-real-opencode.test.ts
 *      + scripts/e2e-real-opencode.sh — opt-in via E2E_OPENCODE=1.)
 *
 *   4. NO-MCP REGRESSION: the static-tools-only flow already asserts the
 *      prompt honest "No matches" in tests/tool-search-e2e.test.ts (tests 8
 *      and 14) and in this file's test 4 (empty catalog). No gap.
 *
 * Reuses the Phase-2 seeding pattern (globalAdapterCache pre-seed) extended
 * to MULTI-server seeding. All MCP transports are faked; only the plugin,
 * provider, vault and store are real. Deterministic: no network, no fake
 * timers, real small delays (hung-server tests cost ~7s by design).
 */

import { describe, it, expect, vi } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Hooks, PluginInput } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';
import { McpToolProvider, DEFAULT_WARMUP_TIMEOUT_MS } from '../src/mcp/mcp-tool-provider.js';
import { globalAdapterCache } from '../src/mcp/adapter-cache.js';
import type { Transport } from '../src/mcp/transport-factory.js';
import { ToolVault } from '../src/vault.js';
import {
  SEARCH_TIMEOUT_MS,
  EXTENDED_WAIT_MS,
  WARMING_MESSAGE,
} from '../src/session-runtime.js';

// Phase-1 ceiling (2s) and phase-2 extended budget (3s).
const CEILING_MS = SEARCH_TIMEOUT_MS;
const EXTENDED_MS = EXTENDED_WAIT_MS;

// Fast server answers warm-up in ~100ms — well within phase 1.
const FAST_SERVER_MS = 100;
// Hung server never resolves (until the warm-up deadline bounds it).
const HUNG_MS = Infinity;
// Slow-but-alive server: answers at ~2.5s — after the phase-1 ceiling, within
// the total budget. Used for the visibility/resolution tests.
const SLOW_SERVER_MS = 2500;

// Generous slack for "did NOT exceed" bounds (slow CI).
const BUDGET_SLACK = 2.5;

const FAST_TOOL = { name: 'fast_query', description: 'Fast server query tool' };
const FAST_TOOL_ID = 'fast_srv_fast_query';
const HUNG_TOOL = { name: 'hung_probe', description: 'Hung server probe tool' };
const HUNG_TOOL_ID = 'hung_srv_hung_probe';

const FAST_SRV = { name: 'fast_srv', type: 'remote' as const, url: 'http://127.0.0.1:9/sse', defer_loading: true };
const HUNG_SRV = { name: 'hung_srv', type: 'remote' as const, url: 'http://127.0.0.1:9/sse', defer_loading: true };

/** Single slow-server fixture used by tests 8a/8b/8c. */
const SRV_CONFIG = { name: 'srv', type: 'remote' as const, url: 'http://127.0.0.1:9/sse', defer_loading: true };
const MCP_TOOL = { name: 'query_docs', description: 'Query the documentation for a package' };
const MCP_TOOL_ID = 'srv_query_docs';

interface FakeEntry {
  tools: Record<string, never>;
  client: {
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
  };
  transport: Transport;
}

/**
 * Fake server client. `listTools` call #1 is the cache's isAlive probe
 * (instant); subsequent calls are the actual warm-up listTools and resolve
 * after `delayMs`. `delayMs === Infinity` hangs forever.
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

/** Seed the real globalAdapterCache with a fake entry for one server config. */
function seedServer(server: { name: string; type: string; url: string; defer_loading: boolean }, delayMs: number, tools: { name: string; description: string }[]): string {
  const entry = fakeEntry(delayMs, tools);
  const key = globalAdapterCache.getServerKey(server);
  globalAdapterCache.set(key, entry as unknown as Parameters<typeof globalAdapterCache.set>[1]);
  return key;
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

function clearSeeded(key: string): void {
  globalAdapterCache.delete(key).catch(() => {});
}

describe('e2e: wait-all factory — resolves only after ALL enabled servers settle', () => {
  it('5. factory with fast + slow-but-alive servers resolves only after BOTH settle (no early return)', async () => {
    // Fast server answers ~100ms; slow-but-alive server answers ~1.5s. With
    // wait-all + a ceiling ABOVE both (default-ish), the factory must NOT
    // return at ~100ms — it waits for the slow server too.
    const fastKey = seedServer(FAST_SRV, FAST_SERVER_MS, [FAST_TOOL]);
    const slowKey = seedServer(SRV_CONFIG, 1500, [MCP_TOOL]);
    const t0 = Date.now();
    const hooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      {
        mode: 'keyword',
        mcp: {
          servers: {
            fast_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
            srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
          },
        },
      },
    );
    const elapsed = Date.now() - t0;

    // Did NOT return early at the fast server's ~100ms settle.
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    // Both servers' real tools are in the bridge pre-snapshot.
    expect((hooks.tool as any)[FAST_TOOL_ID]).toBeDefined();
    expect((hooks.tool as any)[MCP_TOOL_ID]).toBeDefined();
    // Both placeholders removed (both settled with tools).
    expect((hooks.tool as any)['fast_srv']).toBeUndefined();
    expect((hooks.tool as any)['srv']).toBeUndefined();

    clearSeeded(fastKey);
    clearSeeded(slowKey);
  }, 15_000);

  it('5b. factory with a hung server + small ceiling returns ≈ ceiling; hung placeholder retained, fast tool present', async () => {
    // Hung server (never answers) with a small per-server ceiling (300ms).
    // Wait-all: the factory waits ≈ the ceiling, then the hung server is CUT
    // (placeholder retained as status reader); the fast server's tools are
    // present pre-snapshot.
    const fastKey = seedServer(FAST_SRV, FAST_SERVER_MS, [FAST_TOOL]);
    const hungKey = seedServer(HUNG_SRV, HUNG_MS, [HUNG_TOOL]);
    const t0 = Date.now();
    const hooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      {
        mode: 'keyword',
        timeout: 300, // per-server ceiling (cuts the hung server)
        mcp: {
          servers: {
            fast_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
            hung_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
          },
        },
      },
    );
    const elapsed = Date.now() - t0;

    // Factory waited ≈ the hung server's ceiling.
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2000);
    // Fast tool present; hung placeholder retained (status reader, re-described
    // as failed since it settled empty at the ceiling); hung real tool absent.
    expect((hooks.tool as any)[FAST_TOOL_ID]).toBeDefined();
    expect((hooks.tool as any)['hung_srv']).toBeDefined();
    expect((hooks.tool as any)['hung_srv'].description).toContain('failed to start');
    expect((hooks.tool as any)[HUNG_TOOL_ID]).toBeUndefined();

    clearSeeded(fastKey);
    clearSeeded(hungKey);
  }, 15_000);
});

describe('e2e: multi-provider aggregate (fast + hung in one plugin)', () => {
  it('6a. fast server tool found immediately while hung server still warms (no spurious warming)', async () => {
    // Seed BOTH servers: fast answers at 100ms, hung never answers. Small
    // ceiling (300ms) cuts the hung server; wait-all returns at ~300ms.
    const fastKey = seedServer(FAST_SRV, FAST_SERVER_MS, [FAST_TOOL]);
    const hungKey = seedServer(HUNG_SRV, HUNG_MS, [HUNG_TOOL]);
    const hooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      {
        mode: 'keyword',
        timeout: 300, // per-server ceiling (cuts the hung server)
        mcp: {
          servers: {
            fast_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
            hung_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
          },
        },
      },
    );
    const searchTool = (hooks.tool as any).tool_search;

    // The fast tool is in the store — the query-first executor delivers it
    // immediately.
    const start = Date.now();
    const out = await execSearch(searchTool, { query: 'fast' }, 'multi-sess-a');
    const elapsed = Date.now() - start;

    expect(out).toContain(FAST_TOOL_ID);
    expect(out).toContain('Fast server query tool');
    expect(out).not.toBe(WARMING_MESSAGE);
    expect(out).not.toMatch(/^No matches/);
    // Bridge propagation: the fast tool is surfaced as an executable tool.
    expect((hooks.tool as any)[FAST_TOOL_ID]).toBeDefined();
    // Delivered ~immediately (well under the 5s combined budget).
    expect(elapsed).toBeLessThan(CEILING_MS + EXTENDED_MS);

    clearSeeded(fastKey);
    clearSeeded(hungKey);
  }, 15_000);

  it('6b. hung server tool search returns honest "No matches" (cut at ceiling, settled)', async () => {
    const fastKey = seedServer(FAST_SRV, FAST_SERVER_MS, [FAST_TOOL]);
    const hungKey = seedServer(HUNG_SRV, HUNG_MS, [HUNG_TOOL]);
    const hooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      {
        mode: 'keyword',
        timeout: 300, // per-server ceiling (cuts the hung server)
        mcp: {
          servers: {
            fast_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
            hung_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true },
          },
        },
      },
    );
    const searchTool = (hooks.tool as any).tool_search;

    // The hung server was CUT at its ceiling → the aggregate is SETTLED. A
    // search for a genuinely-missing tool returns the honest "No matches"
    // (settled), never WARMING_MESSAGE (wait-all means no warming state).
    const out = await execSearch(searchTool, { query: 'zzzqqq' }, 'multi-sess-b');
    expect(out).toMatch(/^No matches for "zzzqqq"/);
    expect(out).not.toContain('warming');
    // Hung placeholder retained (status reader); hung real tool absent.
    expect((hooks.tool as any)['hung_srv']).toBeDefined();
    expect((hooks.tool as any)[HUNG_TOOL_ID]).toBeUndefined();

    clearSeeded(fastKey);
    clearSeeded(hungKey);
  }, 15_000);
});

describe('e2e: no-MCP regression (static tools only)', () => {
  it('7. static-tools-only session returns the prompt honest "No matches" (no warming leak)', async () => {
    // Plugin with NO mcp option at all → no providers → catalog genuinely empty.
    const hooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      { mode: 'keyword' },
    );
    const searchTool = (hooks.tool as any).tool_search;

    const start = Date.now();
    const out = await execSearch(searchTool, { query: 'nonexistent_tool' }, 'nomcp-sess');
    const elapsed = Date.now() - start;

    // Honest definitive negative — proves WARMING_MESSAGE does not leak into a
    // catalog that is genuinely empty (ready=true vacuously).
    expect(out).toMatch(/^No matches for "nonexistent_tool"/);
    expect(out).not.toContain('warming');
    // No 2s wait: no providers → ready immediately.
    expect(elapsed).toBeLessThan(CEILING_MS * 0.5);
  }, 10_000);
});

describe('e2e: pre-warm — real tool pre-snapshot; failed-server honesty', () => {
  it('8a. pre-warm proof: 2.5s server settles pre-factory; real tool in bridge at resolve', async () => {
    // Slow server (2.5s) with DEFAULT timeout (60s ceiling) → the factory
    // WAIT-ALLs until warm-up settles (~2.5s), so the REAL tool is in the
    // bridge before the session snapshot. Placeholder removed (settled with
    // tools).
    const slowKey = seedServer(SRV_CONFIG, SLOW_SERVER_MS, [MCP_TOOL]);
    const t0 = Date.now();
    const hooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      {
        mode: 'keyword',
        mcp: { servers: { srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true } } },
      },
    );
    const loadElapsed = Date.now() - t0;

    // Factory blocked until the 2.5s server settled (pre-snapshot).
    expect(loadElapsed).toBeGreaterThanOrEqual(SLOW_SERVER_MS * 0.75);
    // REAL tool present at resolve (not just the placeholder).
    expect((hooks.tool as any)[MCP_TOOL_ID]).toBeDefined();
    // Placeholder removed — server settled with tools.
    expect((hooks.tool as any)['srv']).toBeUndefined();

    // Search finds the real tool at phase 1 (settled).
    const searchTool = (hooks.tool as any).tool_search;
    const out = await execSearch(searchTool, { query: 'documentation' }, 'prewarm-sess');
    expect(out).toContain(MCP_TOOL_ID);
    expect(out).toContain('Query the documentation for a package');

    clearSeeded(slowKey);
  }, 15_000);

  it('8b. failed-server honesty: CUT server (ceiling) keeps a STATUS-ONLY placeholder', async () => {
    // Hung server (never answers) with timeout: 250 → 250ms per-server
    // CEILING cuts it (fail-open). The placeholder is retained as a status
    // reader; the server is SETTLED (awaitReady(0) → true) so the placeholder
    // reports the failed/cut state.
    const hungKey = seedServer(HUNG_SRV, HUNG_MS, [HUNG_TOOL]);
    const t0 = Date.now();
    const hooks: Hooks = await (ToolSearchPlugin as (ctx: PluginInput, opts?: any) => Promise<Hooks>)(
      makeCtx(),
      {
        mode: 'keyword',
        timeout: 250,
        mcp: { servers: { hung_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true } } },
      },
    );
    const loadElapsed = Date.now() - t0;

    // Factory returned ≈ the 250ms ceiling (hung server cut).
    expect(loadElapsed).toBeLessThan(2000);
    // Placeholder retained AND re-described as failed (server settled empty at
    // the ceiling) — the snapshot description is honest, not "starting up".
    const placeholder = (hooks.tool as any)['hung_srv'];
    expect(placeholder).toBeDefined();
    expect(placeholder.description).toContain('failed to start');
    expect(placeholder.description).not.toContain('starting up');
    // Real tool absent.
    expect((hooks.tool as any)[HUNG_TOOL_ID]).toBeUndefined();

    // The cut server is SETTLED → the placeholder reports the failed/cut
    // state.
    const failedOut = await placeholder.execute({}, {});
    expect(failedOut).toContain('failed to start');

    clearSeeded(hungKey);
  }, 15_000);

  it('8c. layer-2 guard: deadline loser NEVER propagates (settled-is-final by construction)', async () => {
    // Provider-level unit (fast, no plugin): inject a 500ms warm-up deadline
    // with a server that answers at ~800ms — AFTER the deadline. The work
    // loses the race, so its tools must NEVER append or notifyListeners.
    const SHORT_DEADLINE_MS = 500;
    const LATE_ANSWER_MS = 800;

    const key = globalAdapterCache.getServerKey({
      name: 'late_srv', type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true,
    } as any);
    let calls = 0;
    const entry = fakeEntry(LATE_ANSWER_MS, [MCP_TOOL]);
    // fakeEntry's call #1 is the instant isAlive probe; #2 is the real list.
    void calls;
    globalAdapterCache.set(key, entry as unknown as Parameters<typeof globalAdapterCache.set>[1]);

    const provider = new McpToolProvider(
      { late_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true } },
      undefined,
      undefined,
      SHORT_DEADLINE_MS,
    );
    const updateSpy = vi.fn();
    provider.onUpdate(updateSpy);

    const start = Date.now();
    const result = await provider.warmUp();
    const elapsed = Date.now() - start;

    // warmUp settles at ~500ms (deadline) with [] — the late answer is ignored.
    expect(elapsed).toBeGreaterThanOrEqual(SHORT_DEADLINE_MS * 0.75);
    expect(elapsed).toBeLessThan(LATE_ANSWER_MS);
    expect(result).toEqual([]);
    expect(provider.getTools()).toEqual([]);

    // Wait past the late answer time: the loser's continuation must NOT have
    // appended anything or fired onUpdate.
    await sleep(LATE_ANSWER_MS + 300);
    expect(provider.getTools()).toEqual([]);
    expect(updateSpy).not.toHaveBeenCalled();

    // Search against the settled provider → honest "No matches" (not warming).
    const vault = new ToolVault({ embedding: { enabled: false } });
    await vault.registerProvider(provider);
    expect(await vault.awaitReady(0)).toBe(true);
    const hits = await vault.query('query_docs', 10, 0);
    expect(hits).toEqual([]);

    globalAdapterCache.delete(key).catch(() => {});
  }, 10_000);
});
