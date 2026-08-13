import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import type { tool } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';
import { McpWiring, parseMcpConfig } from '../src/hooks/mcp-wiring.js';
import { ToolVault } from '../src/vault.js';
import { SessionToolRegistry } from '../src/session-tool-registry.js';
import { globalAdapterCache } from '../src/mcp/adapter-cache.js';
import type { Transport } from '../src/mcp/transport-factory.js';
import { DEFAULT_WARMUP_TIMEOUT_MS } from '../src/mcp/mcp-tool-provider.js';

/**
 * Startup latency regression test (BOUNDED PRE-WARM contract, Bea-1 final).
 *
 * opencode freezes the session tool-set at start (~0-2s); MCP tools registered
 * after that snapshot are permanently uncallable. So the factory now BLOCKS
 * (bounded ≤ timeout / per-server deadline) until warm-up settles. Three
 * cases:
 *   L1 no-MCP:      no mcp config → no pre-warm call, no delay (<100ms).
 *   L2 fast server: ~300ms settle → factory resolves ≈ settle (<2000ms) —
 *                   proves there is NO fixed pre-warm delay; the real tool is
 *                   in the bridge pre-snapshot.
 *   L3 hung server: fails open → factory resolves ≈ handshake timeout
 *                   (≤ the 60s per-server timeout), bridge holds the `hanging`
 *                   placeholder re-described as failed, NO real tools.
 */

// Mock the auto-update checker so session events never hit the npm registry.
vi.mock('../src/hooks/auto-update-checker.js', () => ({
  checkForUpdate: vi.fn(async () => ({
    outcome: 'up-to-date',
    currentVersion: '0.0.0',
    latestVersion: '0.0.0',
  })),
  formatUpdateMessage: (result: any) => ({
    title: 'Tool Search',
    message: result.error ?? 'Up-to-date',
    variant: 'info',
  }),
  getCurrentVersion: () => '0.0.0',
  getLatestVersion: async () => '0.0.0',
  invalidatePackageCache: () => true,
}));

const NO_MCP_BUDGET_MS = 100;
const FAST_SETTLE_MS = 300;
const FAST_BUDGET_MS = 2000;
const HANDSHAKE_TIMEOUT_MS = 300;
const RESPONSE_GRACE_MS = 500;

const FAST_TOOL = { name: 'fast_query', description: 'Fast server query tool' };
const FAST_TOOL_ID = 'fast_srv_fast_query';

function makeCtx() {
  return {
    client: { tui: { showToast: vi.fn().mockResolvedValue(undefined) } },
    project: {} as any,
    directory: '/tmp',
    worktree: '/tmp',
    experimental_workspace: { register: vi.fn() },
    serverUrl: new URL('http://localhost'),
    $: {} as any,
  } as any;
}

/** Seed the global cache with a fake server answering after `delayMs`. */
function seedFastServer(): string {
  let calls = 0;
  const entry = {
    tools: {},
    client: {
      listTools: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls === 1) return { tools: [] }; // isAlive probe
        await sleep(FAST_SETTLE_MS);
        return { tools: [FAST_TOOL] };
      }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    },
    transport: { close: vi.fn() } as unknown as Transport,
  } as any;
  const key = globalAdapterCache.getServerKey({
    name: 'fast_srv', type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true,
  } as any);
  globalAdapterCache.set(key, entry);
  return key;
}

describe('L1: no-MCP load is non-blocking', () => {
  it('factory resolves <100ms without mcp config (no pre-warm call)', async () => {
    const start = Date.now();
    const hooks = await ToolSearchPlugin.server(makeCtx(), { mode: 'keyword' });
    const elapsed = Date.now() - start;

    expect(hooks).toBeDefined();
    expect(hooks.tool).toHaveProperty('tool_search');
    expect(hooks.tool).toHaveProperty('tool_search_regex');
    expect(elapsed).toBeLessThan(NO_MCP_BUDGET_MS);
  }, 15_000);
});

describe('L2: fast server resolves ≈ settle (no fixed pre-warm delay)', () => {
  it('factory blocks ~300ms (settle), real tool in bridge pre-snapshot', async () => {
    const key = seedFastServer();
    const start = Date.now();
    const hooks = await ToolSearchPlugin.server(makeCtx(), {
      mode: 'keyword',
      mcp: { servers: { fast_srv: { type: 'remote', url: 'http://127.0.0.1:9/sse', defer_loading: true } } },
    });
    const elapsed = Date.now() - start;

    // Resolves at ~the 300ms settle, NOT a fixed 60s pre-warm delay.
    expect(elapsed).toBeGreaterThanOrEqual(FAST_SETTLE_MS * 0.5);
    expect(elapsed).toBeLessThan(FAST_BUDGET_MS);
    // Real tool pre-snapshot (settled pre-factory); no placeholder retained.
    expect((hooks.tool as any)[FAST_TOOL_ID]).toBeDefined();
    expect((hooks.tool as any)['fast_srv']).toBeUndefined();

    globalAdapterCache.delete(key).catch(() => {});
  }, 15_000);
});

describe('L3: hanging server — factory bounded, placeholder retained (status-only)', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((_req, _res) => {
      // Accept but never respond — the client's POST never completes.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Failed to allocate test server port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('factory bounded (≤ 60s ceiling); bridge holds `hanging` placeholder re-described as failed, no real tools', async () => {
    const start = Date.now();
    const hooks = await ToolSearchPlugin.server(makeCtx(), {
      mode: 'keyword',
      mcp: {
        servers: {
          hanging: { type: 'remote', url: baseUrl, timeout: HANDSHAKE_TIMEOUT_MS },
        },
      },
    });
    const elapsed = Date.now() - start;

    // Bounded by the handshake fail-open (300ms), far under the 60s default
    // per-server timeout.
    expect(elapsed).toBeLessThan(DEFAULT_WARMUP_TIMEOUT_MS);
    expect(elapsed).toBeLessThan(FAST_BUDGET_MS);
    // Bridge: placeholder for the deadlined server (re-described as failed —
    // settled empty), NO real tools.
    expect(Object.keys((hooks.tool as any))).toContain('hanging');
    expect((hooks.tool as any)['hanging'].description).toContain('failed to start');
    expect((hooks.tool as any)['hanging_some_tool']).toBeUndefined();

    // Event + config hooks still behave normally.
    await expect(
      hooks.event!({ event: { type: 'session.deleted', properties: { sessionID: 'latency-session' } } } as any),
    ).resolves.toBeUndefined();
    await expect(hooks.config!({ mcp: { servers: { another: { type: 'remote', url: baseUrl } } } } as any)).resolves.toBeUndefined();
  }, 25_000);
});

describe('McpWiring preWarm memoization + placeholder lifecycle', () => {
  it('preWarm is memoized; init alone is non-blocking; placeholders finalized on preWarm', async () => {
    const tools: Record<string, ReturnType<typeof tool>> = {};
    const wiring = new McpWiring(
      new ToolVault(),
      new SessionToolRegistry({ alwaysOn: ['tool_search'], resetTools: ['compress'] }),
      tools,
      250,
    );

    // init is synchronous-ish (registers provider + placeholders, no await).
    const start = Date.now();
    wiring.init(parseMcpConfig({
      servers: {
        hanging: { type: 'remote', url: 'http://127.0.0.1:9/sse', timeout: HANDSHAKE_TIMEOUT_MS },
      },
    })!);
    expect(Date.now() - start).toBeLessThan(NO_MCP_BUDGET_MS);
    expect(wiring.isInitialized).toBe(true);
    // Placeholder present immediately after init (status-only).
    expect(Object.keys(tools)).toEqual(['hanging']);
    expect(tools.hanging.description).toContain('still starting up');

    // preWarm waits for the provider's 250ms timeout (hung server cut), then
    // memoized (same promise).
    const p1 = wiring.preWarm();
    const p2 = wiring.preWarm();
    expect(p1).toBe(p2);
    await p1;
    // Placeholder retained (deadlined server → status reader, not removed).
    expect(Object.keys(tools)).toEqual(['hanging']);
  }, 10_000);
});
