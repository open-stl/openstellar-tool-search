import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from 'node:process';
import type { Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { AuthPersistence, getDefaultAuthStoragePath, type PersistedToolAuthorization } from '../src/engine/auth-persistence.js';
import { AuthorizationState } from '../src/engine/authorization-state.js';
import { ToolSearchPlugin } from '../src/plugin.js';

const FIXTURE_TOOLS = [
  {
    id: 'github_create_issue',
    description: 'Creates a new GitHub issue in the specified repository',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        title: { type: 'string' },
      },
    },
  },
  {
    id: 'figma_create_shape',
    description: 'Creates a new shape in a Figma design',
    parameters: { type: 'object', properties: {} },
  },
];

function makeCtx(): PluginInput {
  return {
    client: {
      tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
      },
    },
    project: {} as any,
    directory: '/tmp',
    worktree: '/tmp',
    experimental_workspace: { register: vi.fn() },
    serverUrl: new URL('http://localhost'),
    $: {} as any,
  };
}

const TOOL_CTX = {
  sessionID: 'sess-persisted-1',
  messageID: 'msg1',
  agent: 'test',
  directory: '/tmp',
  worktree: '/tmp',
  abort: new AbortController().signal,
  metadata: vi.fn(),
  ask: vi.fn().mockResolvedValue(undefined),
};


async function runBeforeHook(hooks: any, tool: string, sessionID: string): Promise<void> {
  const before = hooks['tool.execute.before']!;
  await before({ tool, sessionID, callID: 'c', args: {} }, {});
}

async function runAfterHook(hooks: any, tool: string, sessionID: string, initialOutput: string = 'ok'): Promise<{ hasReminder: boolean; output: string }> {
  const after = hooks['tool.execute.after']!;
  const out: any = { output: initialOutput };
  await after({ tool, sessionID, callID: 'c', args: {} }, out);
  const output = typeof out.output === 'string' ? out.output : String(out.output ?? '');
  const hasReminder = output.includes('[Tool Search Reminder]');
  return { hasReminder, output };
}

describe('AuthPersistence (Unit Tests)', () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `tool-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testFilePath = join(testDir, 'authorizations.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('getDefaultAuthStoragePath returns path under user cache / APPDATA', () => {
    const path = getDefaultAuthStoragePath();
    expect(path).toContain('tool-search');
    expect(path).toContain('authorizations.json');
  });

  it('returns empty maps if file does not exist', () => {
    const ap = new AuthPersistence({ filePath: testFilePath });
    const { authorizations, lastSeen } = ap.load();
    expect(authorizations.size).toBe(0);
    expect(lastSeen.size).toBe(0);
  });

  it('loads mixed legacy and strictly valid structured tools while dropping malformed records', () => {
    const validStructured = { kind: 'canonical-tool', version: 1, canonicalId: 'foo_ide' };
    const initialData = {
      'mixed-session': {
        tools: [
          'ordinary_tool',
          validStructured,
          { kind: 'canonical-tool', version: 1, canonicalId: 'extra', extra: true },
          { kind: 'wrong-kind', version: 1, canonicalId: 'wrong' },
          { kind: 'canonical-tool', version: 2, canonicalId: 'wrong-version' },
          { kind: 'canonical-tool', version: 1, canonicalId: '' },
          { kind: 'canonical-tool', version: 1 },
          [],
          { kind: 'canonical-tool', version: 1, canonicalId: 42 },
        ],
      },
    };
    writeFileSync(testFilePath, JSON.stringify(initialData), 'utf-8');

    const { authorizations } = new AuthPersistence({ filePath: testFilePath }).load();
    expect(Array.from(authorizations.get('mixed-session')!)).toEqual(['ordinary_tool', validStructured]);
  });

  it('expires sessions older than 30 days during load', () => {
    const now = Date.now();
    const initialData = {
      'old-session': {
        tools: ['toolA', 'toolB'],
        lastSeen: now - (31 * 24 * 60 * 60 * 1000), // 31 days old
      },
      'active-session': {
        tools: ['toolC'],
        lastSeen: now - (10 * 24 * 60 * 60 * 1000), // 10 days old
      },
    };
    writeFileSync(testFilePath, JSON.stringify(initialData), 'utf-8');

    const ap = new AuthPersistence({ filePath: testFilePath });
    const { authorizations, lastSeen } = ap.load();

    expect(authorizations.has('old-session')).toBe(false);
    expect(authorizations.has('active-session')).toBe(true);
    expect(Array.from(authorizations.get('active-session')!)).toEqual(['toolC']);
  });

  it('handles invalid JSON gracefully (fail-open)', () => {
    writeFileSync(testFilePath, 'NOT_VALID_JSON{', 'utf-8');
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ap = new AuthPersistence({ filePath: testFilePath });
    const { authorizations, lastSeen } = ap.load();

    expect(authorizations.size).toBe(0);
    expect(lastSeen.size).toBe(0);
    expect(spyWarn).not.toHaveBeenCalled();
    spyWarn.mockRestore();
  });

  it('flushes pending state to disk in expected schema', async () => {
    const ap = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const auths = new Map<string, Set<string>>([
      ['s1', new Set(['git_commit', 'read_file'])],
    ]);
    const now = Date.now();
    const lastSeen = new Map<string, number>([['s1', now]]);

    ap.save(auths, lastSeen);
    await ap.flush();

    expect(existsSync(testFilePath)).toBe(true);
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content).toEqual({
      s1: {
        tools: ['git_commit', 'read_file'],
        lastSeen: now,
      },
    });
  });

  it('fails open silently on write error', async () => {
    // Provide a file path inside a file (directory creation will fail)
    const invalidPath = join(testFilePath, 'sub', 'file.json');
    writeFileSync(testFilePath, 'blocking-file', 'utf-8');

    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ap = new AuthPersistence({ filePath: invalidPath, debounceMs: 10 });
    ap.save(new Map([['s1', new Set(['t1'])]]), new Map([['s1', Date.now()]]));

    await expect(ap.flush()).resolves.toBeUndefined();
    expect(spyWarn).not.toHaveBeenCalled();
    spyWarn.mockRestore();
  });

  it('merges sessions from multiple processes writing to the same file without data loss', async () => {
    const ap1 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const ap2 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const tA = Date.now() - 1000;
    const tB = Date.now();

    ap1.save(
      new Map([['sessionA', new Set(['toolA'])]]),
      new Map([['sessionA', tA]]),
    );
    await ap1.flush();

    ap2.save(
      new Map([['sessionB', new Set(['toolB'])]]),
      new Map([['sessionB', tB]]),
    );
    await ap2.flush();

    expect(existsSync(testFilePath)).toBe(true);
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content).toEqual({
      sessionA: {
        tools: ['toolA'],
        lastSeen: tA,
      },
      sessionB: {
        tools: ['toolB'],
        lastSeen: tB,
      },
    });
  });

  it('respects explicit deletions during multi-process flushes', async () => {
    const ap1 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const ap2 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const tA = Date.now() - 1000;
    const tB = Date.now();

    ap1.save(
      new Map([['sessionA', new Set(['toolA'])]]),
      new Map([['sessionA', tA]]),
    );
    await ap1.flush();

    ap2.save(
      new Map([['sessionB', new Set(['toolB'])]]),
      new Map([['sessionB', tB]]),
    );
    await ap2.flush();

    // ap1 deletes sessionA
    ap1.deleteSession('sessionA');
    ap1.save(new Map(), new Map());
    await ap1.flush();

    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content).toEqual({
      sessionB: {
        tools: ['toolB'],
        lastSeen: tB,
      },
    });
  });

  it('clears deletedSessions after flush so subsequent flushes do not re-delete sessions', async () => {
    const apA = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const apB = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const sessionX = 'sessionX';
    const now = Date.now();

    // Initial setup: process A creates sessionX
    apA.save(
      new Map([[sessionX, new Set(['toolA'])]]),
      new Map([[sessionX, now]]),
    );
    await apA.flush();

    // Process A deletes sessionX and flushes
    apA.deleteSession(sessionX);
    apA.save(new Map(), new Map());
    await apA.flush();

    // Process B re-authorizes sessionX and flushes
    apB.save(
      new Map([[sessionX, new Set(['toolB'])]]),
      new Map([[sessionX, now + 100]]),
    );
    await apB.flush();

    // Process A performs another save and flush (e.g. for some other session)
    apA.save(
      new Map([['sessionY', new Set(['toolY'])]]),
      new Map([['sessionY', now + 200]]),
    );
    await apA.flush();

    // The file MUST still contain sessionX because A's deletedSessions was cleared on its prior flush
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content[sessionX]).toBeDefined();
    expect(content[sessionX].tools).toEqual(['toolB']);
  });

  it('F11: AuthorizationState migrates legacy string entries instead of purging them', () => {
    const sessionID = 'f11-migration-session';
    const authorizations = new Map<string, Set<PersistedToolAuthorization>>([
      [sessionID, new Set<PersistedToolAuthorization>([
        'ordinary_tool',
        'foo_ide',
        '@canonical:bar_ide',
      ])],
    ]);
    const lastSeen = new Map<string, number>();
    vi.spyOn(AuthPersistence.prototype, 'load').mockReturnValue({ authorizations, lastSeen });
    vi.spyOn(AuthPersistence.prototype, 'save').mockImplementation(() => {});

    const authState = new AuthorizationState({
      alwaysOn: ['tool_search', 'tool_search_regex'],
      resetTools: ['compress'],
    });

    // All three entries should be preserved (legacy _ide and @canonical: are migrated, plain strings stay)
    const auths = authorizations.get(sessionID)!;
    expect(auths.size).toBe(3);

    const values = Array.from(auths);

    // 'ordinary_tool' stays as a plain string (no migration needed)
    const plainEntry = values.find((v) => v === 'ordinary_tool');
    expect(plainEntry).toBe('ordinary_tool');

    // 'foo_ide' is migrated to canonical object form
    const fooIdeEntry = values.find((v): v is { kind: 'canonical-tool'; version: 1; canonicalId: string } =>
      typeof v === 'object' && v !== null && 'canonicalId' in v && (v as any).canonicalId === 'foo_ide'
    );
    expect(fooIdeEntry).toBeDefined();

    // '@canonical:bar_ide' is migrated to canonical object form with prefix stripped
    const barIdeEntry = values.find((v): v is { kind: 'canonical-tool'; version: 1; canonicalId: string } =>
      typeof v === 'object' && v !== null && 'canonicalId' in v && (v as any).canonicalId === 'bar_ide'
    );
    expect(barIdeEntry).toBeDefined();

    // isAuthorized should work for all three
    expect(authState.isAuthorized(sessionID, 'ordinary_tool')).toBe(true);
    expect(authState.isAuthorized(sessionID, 'foo_ide')).toBe(true);
    expect(authState.isAuthorized(sessionID, 'bar_ide')).toBe(true);
  });
});

describe('Phase 2 E2E: Authorization Persistence across Restarts', () => {
  let testDir: string;
  let testFilePath: string;
  const origXdgConfig = env.XDG_CONFIG_HOME;
  const origXdgCache = env.XDG_CACHE_HOME;
  const origAppData = env.APPDATA;

  beforeEach(() => {
    testDir = join(tmpdir(), `tool-search-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    env.XDG_CONFIG_HOME = testDir;
    env.XDG_CACHE_HOME = testDir;
    delete env.APPDATA;
    testFilePath = getDefaultAuthStoragePath();
  });

  afterEach(() => {
    if (origXdgConfig !== undefined) env.XDG_CONFIG_HOME = origXdgConfig;
    else delete env.XDG_CONFIG_HOME;

    if (origXdgCache !== undefined) env.XDG_CACHE_HOME = origXdgCache;
    else delete env.XDG_CACHE_HOME;

    if (origAppData !== undefined) env.APPDATA = origAppData;
    else delete env.APPDATA;

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function createPluginInstance(options: PluginOptions = {}) {
    const ctx = makeCtx();
    const opts: PluginOptions = {
      mode: 'keyword',
      ...options,
    };
    const plugin = ToolSearchPlugin as Plugin;
    const hooks = await plugin(ctx, opts);
    const defHook = hooks['tool.definition']!;
    for (const t of FIXTURE_TOOLS) {
      await defHook({ toolID: t.id }, { description: t.description, parameters: JSON.parse(JSON.stringify(t.parameters)) });
    }
    return { hooks, ctx };
  }

  it('A) Authorize in plugin instance #1 -> plugin instance #2 with same sessionID retains authorization', async () => {
    const sessionID = 'session-persistence-A';
    const instance1 = await createPluginInstance();

    const toolSearch = (instance1.hooks.tool as any).tool_search;
    await toolSearch.execute({ query: 'github_create_issue' }, { ...TOOL_CTX, sessionID });
    await new Promise((r) => setTimeout(r, 100));

    // Verify instance #1: pre-execution hook resolves without throwing
    await expect(runBeforeHook(instance1.hooks, 'github_create_issue', sessionID)).resolves.toBeUndefined();

    // Now instantiate plugin instance #2 (simulating OpenCode restart)
    const instance2 = await createPluginInstance();

    // Instance #2 should already authorize github_create_issue for sessionID WITHOUT new search
    await expect(runBeforeHook(instance2.hooks, 'github_create_issue', sessionID)).resolves.toBeUndefined();
  });

  it('B) Different sessionID in instance #2 does NOT inherit authorization', async () => {
    const sessionA = 'session-persistence-B1';
    const sessionB = 'session-persistence-B2';

    const instance1 = await createPluginInstance();
    const toolSearch = (instance1.hooks.tool as any).tool_search;
    await toolSearch.execute({ query: 'github_create_issue' }, { ...TOOL_CTX, sessionID: sessionA });
    await new Promise((r) => setTimeout(r, 100));

    const instance2 = await createPluginInstance();

    // Session A is authorized in instance #2
    await expect(runBeforeHook(instance2.hooks, 'github_create_issue', sessionA)).resolves.toBeUndefined();

    // Session B is not authorized in instance #2, so pre-execution hook blocks execution with error
    await expect(runBeforeHook(instance2.hooks, 'github_create_issue', sessionB)).rejects.toThrow('[Tool Search Required]');
  });

  it('C) Compaction in instance #2 clears persisted auth; fresh plugin instance #3 requires re-search', async () => {
    const sessionID = 'session-persistence-C';
    const instance1 = await createPluginInstance();

    const toolSearch = (instance1.hooks.tool as any).tool_search;
    await toolSearch.execute({ query: 'github_create_issue' }, { ...TOOL_CTX, sessionID });
    await new Promise((r) => setTimeout(r, 100));

    const instance2 = await createPluginInstance();
    // Compact session in instance #2
    const compacting = instance2.hooks['experimental.session.compacting']!;
    await compacting({ sessionID }, { context: [] } as any);
    await new Promise((r) => setTimeout(r, 100));

    // Instance #2 blocks execution with pre-execution error
    await expect(runBeforeHook(instance2.hooks, 'github_create_issue', sessionID)).rejects.toThrow('[Tool Search Required]');

    // Fresh plugin instance #3 also blocks execution with pre-execution error
    const instance3 = await createPluginInstance();
    await expect(runBeforeHook(instance3.hooks, 'github_create_issue', sessionID)).rejects.toThrow('[Tool Search Required]');
  });

  it('D) Authorization survives simulated elapsed time across restarts', async () => {
    const sessionID = 'session-persistence-D';
    const oldState = {
      [sessionID]: {
        tools: ['github_create_issue'],
        lastSeen: Date.now() - (3 * 60 * 60 * 1000),
      },
    };
    mkdirSync(dirname(testFilePath), { recursive: true });
    writeFileSync(testFilePath, JSON.stringify(oldState), 'utf-8');

    const instance1 = await createPluginInstance();
    await expect(runBeforeHook(instance1.hooks, 'github_create_issue', sessionID)).resolves.toBeUndefined();
  });

  it('session.deleted clears persisted authorization when payload includes sessionID', async () => {
    const sessionID = 'session-persistence-deleted';
    const instance = await createPluginInstance();
    const toolSearch = (instance.hooks.tool as any).tool_search;
    await toolSearch.execute({ query: 'github_create_issue' }, { ...TOOL_CTX, sessionID });
    await new Promise((r) => setTimeout(r, 100));
    await expect(runBeforeHook(instance.hooks, 'github_create_issue', sessionID)).resolves.toBeUndefined();

    await instance.hooks.event!({ event: { type: 'session.deleted', properties: { sessionID, info: { id: sessionID } } } } as any);
    await new Promise((r) => setTimeout(r, 100));
    const fresh = await createPluginInstance();
    await expect(runBeforeHook(fresh.hooks, 'github_create_issue', sessionID)).rejects.toThrow('[Tool Search Required]');
  });

  it('E) Compress tool execution clears persisted auth across instances', async () => {
    const sessionID = 'session-persistence-compress';
    const instance1 = await createPluginInstance();

    const toolSearch = (instance1.hooks.tool as any).tool_search;
    await toolSearch.execute({ query: 'github_create_issue' }, { ...TOOL_CTX, sessionID });
    await new Promise((r) => setTimeout(r, 100));

    const instance2 = await createPluginInstance();
    // Authorized before compress
    await expect(runBeforeHook(instance2.hooks, 'github_create_issue', sessionID)).resolves.toBeUndefined();

    // Execute compress tool in instance 2
    const compressOutput = await runAfterHook(instance2.hooks, 'compress', sessionID);
    expect(compressOutput.output).toContain('[Tool Search] Deferred tool authorizations have been reset');
    await new Promise((r) => setTimeout(r, 100));

    // Instance #2 blocks execution after compress
    await expect(runBeforeHook(instance2.hooks, 'github_create_issue', sessionID)).rejects.toThrow('[Tool Search Required]');

    // Fresh plugin instance #3 also requires a re-search because compress cleared persisted store
    const instance3 = await createPluginInstance();
    await expect(runBeforeHook(instance3.hooks, 'github_create_issue', sessionID)).rejects.toThrow('[Tool Search Required]');
  });
});
