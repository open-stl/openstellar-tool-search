import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from 'node:process';
import type { Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { AuthPersistence, getDefaultAuthStoragePath } from '../src/auth-persistence.js';
import { ToolSearchPlugin } from '../src/plugin.js';
import { SemanticMatcher } from '../src/matcher.js';

// Persistence and authorization tests should not depend on embedding model startup.
vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());

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


async function runAfterHook(hooks: any, tool: string, sessionID: string, initialOutput: string = 'ok'): Promise<{ blocked: boolean; hasReminder: boolean; output: string }> {
  const input = { tool, sessionID, callID: 'c', args: {} };
  let unauthorized = false;
  try {
    await hooks['tool.execute.before']!(input);
  } catch {
    unauthorized = true;
  }
  if (unauthorized) return { blocked: true, hasReminder: false, output: initialOutput };

  const after = hooks['tool.execute.after']!;
  const out: any = { output: initialOutput };
  await after(input, out);
  const output = typeof out.output === 'string' ? out.output : String(out.output ?? '');
  return { blocked: false, hasReminder: output.includes('[Tool Search Reminder]'), output };
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
    const authorizations = ap.load();
    expect(authorizations.size).toBe(0);
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

    const authorizations = new AuthPersistence({ filePath: testFilePath }).load();
    expect(Array.from(authorizations.get('mixed-session')!)).toEqual(['ordinary_tool', 'foo_ide']);
  });

  it('loads authorization without elapsed-time expiration or pruning', () => {
    const initialData = {
      'old-session': {
        tools: ['toolA', 'toolB'],
      },
    };
    writeFileSync(testFilePath, JSON.stringify(initialData), 'utf-8');

    const ap = new AuthPersistence({ filePath: testFilePath });
    const authorizations = ap.load();

    expect(Array.from(authorizations.get('old-session')!)).toEqual(['toolA', 'toolB']);
    expect(JSON.parse(readFileSync(testFilePath, 'utf-8'))).toEqual(initialData);
  });

  it('handles invalid JSON gracefully (fail-open)', () => {
    writeFileSync(testFilePath, 'NOT_VALID_JSON{', 'utf-8');
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ap = new AuthPersistence({ filePath: testFilePath });
    const authorizations = ap.load();

    expect(authorizations.size).toBe(0);
    expect(spyWarn).toHaveBeenCalledWith(
      expect.stringContaining('[Tool Search] Warning: Failed to load authorization state from'),
      expect.any(Error),
    );
    spyWarn.mockRestore();
  });

  it('flushes pending state to disk in expected schema', async () => {
    const ap = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const auths = new Map<string, Set<string>>([
      ['s1', new Set(['git_commit', 'read_file'])],
    ]);

    ap.save(auths);
    await ap.flush();

    expect(existsSync(testFilePath)).toBe(true);
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content.s1).toMatchObject({ encoding: 'canonical-ids-v1', tools: ['git_commit', 'read_file'] });
  });

  it('round-trips foo_ide through save, load, and reload', async () => {
    const first = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    first.save(new Map([['session', new Set(['foo_ide'])]]));
    await first.flush();
    const loaded = new AuthPersistence({ filePath: testFilePath }).load();
    expect(Array.from(loaded.get('session') ?? [])).toEqual(['foo_ide']);
    const reloaded = new AuthPersistence({ filePath: testFilePath }).load();
    expect(Array.from(reloaded.get('session') ?? [])).toEqual(['foo_ide']);
  });

  it('fails open log warning on write error', async () => {
    // Provide a file path inside a file (directory creation will fail)
    const invalidPath = join(testFilePath, 'sub', 'file.json');
    writeFileSync(testFilePath, 'blocking-file', 'utf-8');

    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ap = new AuthPersistence({ filePath: invalidPath, debounceMs: 10 });
    ap.save(new Map([['s1', new Set(['t1'])]]));

    await expect(ap.flush()).resolves.toBeUndefined();
    expect(spyWarn).toHaveBeenCalledWith(
      expect.stringContaining('[Tool Search] Warning: Failed to write authorization state to'),
      expect.any(Error),
    );
    spyWarn.mockRestore();
  });

  it('merges sessions from multiple processes writing to the same file without data loss', async () => {
    const ap1 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const ap2 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });

    ap1.save(
      new Map([['sessionA', new Set(['toolA'])]]),
    );
    await ap1.flush();

    ap2.save(
      new Map([['sessionB', new Set(['toolB'])]]),
    );
    await ap2.flush();

    expect(existsSync(testFilePath)).toBe(true);
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content.sessionA).toMatchObject({ encoding: 'canonical-ids-v1', tools: ['toolA'] });
    expect(content.sessionB).toMatchObject({ encoding: 'canonical-ids-v1', tools: ['toolB'] });
  });

  it('respects explicit deletions during multi-process flushes', async () => {
    const ap1 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const ap2 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });

    ap1.save(
      new Map([['sessionA', new Set(['toolA'])]]),
    );
    await ap1.flush();

    ap2.save(
      new Map([['sessionB', new Set(['toolB'])]]),
    );
    await ap2.flush();

    // ap1 deletes sessionA
    ap1.deleteSession('sessionA');
    ap1.save(new Map());
    await ap1.flush();

    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content.sessionA).toMatchObject({ deleted: true });
    expect(content.sessionB).toMatchObject({ encoding: 'canonical-ids-v1', tools: ['toolB'] });
  });

  it('does not resurrect X when stale B dirties X before A creates and deletes X', async () => {
    const a = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const b = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    b.load();
    b.save(new Map([['sessionX', new Set(['stale'])]]));
    a.save(new Map([['sessionX', new Set(['fresh'])]]));
    await a.flush();
    a.deleteSession('sessionX');
    a.save(new Map());
    await a.flush();
    await b.flush();
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content.sessionX).toMatchObject({ deleted: true });
  });

  it('does not resurrect deleted X when a stale instance later saves unrelated Y', async () => {
    const first = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const stale = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    first.save(new Map([['sessionX', new Set(['toolX'])]]));
    await first.flush();
    stale.load();
    first.deleteSession('sessionX');
    first.save(new Map());
    await first.flush();
    stale.save(new Map([['sessionY', new Set(['toolY'])]]));
    await stale.flush();
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content.sessionX).toMatchObject({ deleted: true });
    expect(content.sessionY.tools).toEqual(['toolY']);
  });

  it('fresh load after deletion can recreate X', async () => {
    const a = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    a.save(new Map([['sessionX', new Set(['old'])]]));
    await a.flush();
    a.deleteSession('sessionX');
    a.save(new Map());
    await a.flush();
    const fresh = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const loaded = fresh.load();
    expect(loaded.has('sessionX')).toBe(false);
    fresh.save(new Map([['sessionX', new Set(['new'])]]));
    await fresh.flush();
    expect(new AuthPersistence({ filePath: testFilePath }).load().get('sessionX')).toEqual(new Set(['new']));
  });

  it('clears deletedSessions after flush so subsequent flushes do not re-delete sessions', async () => {
    const apA = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const apB = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const sessionX = 'sessionX';

    // Initial setup: process A creates sessionX
    apA.save(
      new Map([[sessionX, new Set(['toolA'])]]),
    );
    await apA.flush();

    // Process A deletes sessionX and flushes
    apA.deleteSession(sessionX);
    apA.save(new Map());
    await apA.flush();

    // A genuinely new authorization must observe the tombstone before recreating X.
    apB.load();
    apB.save(
      new Map([[sessionX, new Set(['toolB'])]]),
    );
    await apB.flush();

    // Process A performs another save and flush (e.g. for some other session)
    apA.save(
      new Map([['sessionY', new Set(['toolY'])]]),
    );
    await apA.flush();

    // A truly new authorization after deletion is allowed to recreate sessionX.
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content[sessionX]).toMatchObject({ encoding: 'canonical-ids-v1', tools: ['toolB'] });
  });
});

describe('Phase 2 E2E: Authorization Persistence across Restarts', () => {
  let testDir: string;
  let testFilePath: string;
  const origXdg = env.XDG_CACHE_HOME;
  const origAppData = env.APPDATA;

  beforeEach(() => {
    testDir = join(tmpdir(), `tool-search-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    env.XDG_CACHE_HOME = testDir;
    delete env.APPDATA;
    testFilePath = getDefaultAuthStoragePath();
  });

  afterEach(() => {
    if (origXdg !== undefined) env.XDG_CACHE_HOME = origXdg;
    else delete env.XDG_CACHE_HOME;

    if (origAppData !== undefined) env.APPDATA = origAppData;
    else delete env.APPDATA;

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function createPluginInstance(options: PluginOptions = {}) {
    const ctx = makeCtx();
    const opts: PluginOptions = { ...options };
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

    // Verify instance #1: no reminder after authorization
    const output1 = await runAfterHook(instance1.hooks, 'github_create_issue', sessionID);
    expect(output1.hasReminder).toBe(false);

    // Now instantiate plugin instance #2 (simulating OpenCode restart)
    const instance2 = await createPluginInstance();

    // Instance #2 should already authorize github_create_issue for sessionID WITHOUT new search
    const output2 = await runAfterHook(instance2.hooks, 'github_create_issue', sessionID);
    expect(output2.hasReminder).toBe(false);
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
    const aOutput = await runAfterHook(instance2.hooks, 'github_create_issue', sessionA);
    expect(aOutput.hasReminder).toBe(false);

    // Session B is not authorized in instance #2, so the before hook blocks it.
    const bOutput = await runAfterHook(instance2.hooks, 'github_create_issue', sessionB);
    expect(bOutput.blocked).toBe(true);
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

    // Compaction revokes permission, so the before hook blocks execution.
    expect((await runAfterHook(instance2.hooks, 'github_create_issue', sessionID)).blocked).toBe(true);

    // Fresh plugin instance #3 also blocks execution until re-authorized.
    const instance3 = await createPluginInstance();
    expect((await runAfterHook(instance3.hooks, 'github_create_issue', sessionID)).blocked).toBe(true);
  });

  it('D) Authorization survives simulated elapsed time across restarts', async () => {
    const sessionID = 'session-persistence-D';
    const oldState = {
      [sessionID]: {
        tools: ['github_create_issue'],
      },
    };
    mkdirSync(dirname(testFilePath), { recursive: true });
    writeFileSync(testFilePath, JSON.stringify(oldState), 'utf-8');

    const instance1 = await createPluginInstance();
    const output = await runAfterHook(instance1.hooks, 'github_create_issue', sessionID);
    expect(output.hasReminder).toBe(false);
  });

  it('session.deleted clears persisted authorization when payload includes sessionID', async () => {
    const sessionID = 'session-persistence-deleted';
    const instance = await createPluginInstance();
    const toolSearch = (instance.hooks.tool as any).tool_search;
    await toolSearch.execute({ query: 'github_create_issue' }, { ...TOOL_CTX, sessionID });
    await new Promise((r) => setTimeout(r, 100));
    expect((await runAfterHook(instance.hooks, 'github_create_issue', sessionID)).hasReminder).toBe(false);

    await instance.hooks.event!({ event: { type: 'session.deleted', properties: { sessionID, info: { id: sessionID } } } } as any);
    await new Promise((r) => setTimeout(r, 100));
    const fresh = await createPluginInstance();
    expect((await runAfterHook(fresh.hooks, 'github_create_issue', sessionID)).blocked).toBe(true);
  });

  it('E) Compress tool execution clears persisted auth across instances', async () => {
    const sessionID = 'session-persistence-compress';
    const instance1 = await createPluginInstance();

    const toolSearch = (instance1.hooks.tool as any).tool_search;
    await toolSearch.execute({ query: 'github_create_issue' }, { ...TOOL_CTX, sessionID });
    await new Promise((r) => setTimeout(r, 100));

    const instance2 = await createPluginInstance();
    // Authorized before compress
    const beforeOutput = await runAfterHook(instance2.hooks, 'github_create_issue', sessionID);
    expect(beforeOutput.hasReminder).toBe(false);

    // Execute compress tool in instance 2
     const compressOutput = await runAfterHook(instance2.hooks, 'compress', sessionID);
     expect(compressOutput.output).toContain('[Tool Search] Deferred tool authorizations have been reset');
     await new Promise((r) => setTimeout(r, 100));

    // Compress revokes permission, so the before hook blocks execution.
     const reminder2 = await runAfterHook(instance2.hooks, 'github_create_issue', sessionID);
     expect(reminder2.blocked).toBe(true);

     // Fresh plugin instance #3 also blocks execution because compress cleared persisted state.
     const instance3 = await createPluginInstance();
     const reminder3 = await runAfterHook(instance3.hooks, 'github_create_issue', sessionID);
     expect(reminder3.blocked).toBe(true);

  });
});
