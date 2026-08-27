import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AuthPersistence,
  getDefaultAuthStoragePath,
  type PersistedToolAuthorization,
} from '../src/engine/auth-persistence.js';
import { AuthorizationState } from '../src/engine/authorization-state.js';
import { SessionToolRegistry } from '../src/engine/session-tool-registry.js';
import {
  SessionEngine,
  TOOL_SEARCH_PARAM_DESC,
  TOOL_SEARCH_REGEX_PARAM_DESC,
} from '../src/engine/session-engine.js';
import {
  DeliveryHistory,
  computeFingerprint,
} from '../src/engine/delivery-history.js';
import {
  checkForUpdate,
  isNewerVersion,
  getPackageCacheTargets,
} from '../src/hooks/auto-update-checker.js';
import {
  parseRegistryUrl,
  buildDistTagsUrl,
} from '../src/hooks/npm-registry.js';
import { UpdateCheckLifecycle } from '../src/hooks/update-check.js';
import { resolveStorageDir, safeReadJson, safeWriteJson } from '../src/utils/storage-path.js';
import { configureTransformersEnv } from '../src/catalog/transformers-env.js';
import type { ToolMeta } from '../src/types.js';

// ============================================================================
// AuthorizationState & AuthPersistence
// ============================================================================

describe('AuthorizationState & AuthPersistence', () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'tool-search-auth-test-'));
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
        lastSeen: now - 31 * 24 * 60 * 60 * 1000,
      },
      'active-session': {
        tools: ['toolC'],
        lastSeen: now - 10 * 24 * 60 * 60 * 1000,
      },
    };
    writeFileSync(testFilePath, JSON.stringify(initialData), 'utf-8');

    const ap = new AuthPersistence({ filePath: testFilePath });
    const { authorizations } = ap.load();

    expect(authorizations.has('old-session')).toBe(false);
    expect(authorizations.has('active-session')).toBe(true);
    expect(Array.from(authorizations.get('active-session')!)).toEqual(['toolC']);
  });

  it('handles invalid JSON gracefully (fail-open)', () => {
    writeFileSync(testFilePath, 'NOT_VALID_JSON{', 'utf-8');
    const ap = new AuthPersistence({ filePath: testFilePath });
    const { authorizations, lastSeen } = ap.load();

    expect(authorizations.size).toBe(0);
    expect(lastSeen.size).toBe(0);
  });

  it('flushes pending state to disk with atomic write', async () => {
    const ap = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const auths = new Map<string, Set<PersistedToolAuthorization>>([
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

  it('merges sessions from multiple processes writing to the same file without data loss', async () => {
    const ap1 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const ap2 = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const tA = Date.now() - 1000;
    const tB = Date.now();

    ap1.save(new Map([['sessionA', new Set(['toolA'])]]), new Map([['sessionA', tA]]));
    await ap1.flush();

    ap2.save(new Map([['sessionB', new Set(['toolB'])]]), new Map([['sessionB', tB]]));
    await ap2.flush();

    expect(existsSync(testFilePath)).toBe(true);
    const content = JSON.parse(readFileSync(testFilePath, 'utf-8'));
    expect(content).toEqual({
      sessionA: { tools: ['toolA'], lastSeen: tA },
      sessionB: { tools: ['toolB'], lastSeen: tB },
    });
  });

  it('AuthorizationState tracks authorizations and requires reminders', () => {
    const persistence = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const state = new AuthorizationState({
      alwaysOn: ['always_tool'],
      resetTools: ['compress'],
      persistence,
    });

    state.registerTool('tool_a');

    expect(state.isAuthorized('sess-1', 'tool_a')).toBe(false);
    expect(state.requiresReminder('sess-1', 'tool_a', 'tool_a')).toBe(true);

    state.authorize('sess-1', [{ id: 'tool_a', description: 'Tool A', parameters: {} }]);
    expect(state.isAuthorized('sess-1', 'tool_a')).toBe(true);
    expect(state.requiresReminder('sess-1', 'tool_a', 'tool_a')).toBe(false);

    state.resetSession('sess-1');
    expect(state.isAuthorized('sess-1', 'tool_a')).toBe(false);
  });

  it('handles hyphens and underscores interchangeably for authorization and reminders', () => {
    const persistence = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const state = new AuthorizationState({
      alwaysOn: ['always-on_tool'],
      resetTools: ['compress'],
      persistence,
    });

    state.registerTool('codebase-memory_list_projects');

    // Always-on check works across hyphens and underscores
    expect(state.requiresReminder('sess-1', 'always_on_tool', 'always-on_tool')).toBe(false);

    // Initial state: not authorized
    expect(state.isAuthorized('sess-1', 'codebase_memory_list_projects')).toBe(false);
    expect(state.isAuthorized('sess-1', 'codebase-memory_list_projects')).toBe(false);
    expect(state.requiresReminder('sess-1', 'codebase_memory_list_projects', 'codebase-memory_list_projects')).toBe(true);

    // Authorize using the catalog ID (with hyphen)
    state.authorize('sess-1', [{ id: 'codebase-memory_list_projects', description: 'List projects', parameters: {} }]);

    // Both snake_case and kebab-case are recognized as authorized
    expect(state.isAuthorized('sess-1', 'codebase_memory_list_projects')).toBe(true);
    expect(state.isAuthorized('sess-1', 'codebase-memory_list_projects')).toBe(true);
    expect(state.requiresReminder('sess-1', 'codebase_memory_list_projects', 'codebase-memory_list_projects')).toBe(false);
    expect(state.requiresReminder('sess-1', 'codebase-memory_list_projects', 'codebase-memory_list_projects')).toBe(false);

    // Revoke using snake_case ID revokes the normalized authorization
    state.revoke('sess-1', ['codebase_memory_list_projects']);
    expect(state.isAuthorized('sess-1', 'codebase-memory_list_projects')).toBe(false);
  });

  it('normalizes tool IDs across case, whitespace, and hyphens/underscores in alwaysOn and resetTools', () => {
    const persistence = new AuthPersistence({ filePath: testFilePath, debounceMs: 10 });
    const state = new AuthorizationState({
      alwaysOn: ['  READ  ', 'github-grep_searchGitHub', 'WRITE'],
      resetTools: ['  COMPRESS  ', 'my-reset_tool'],
      persistence,
    });

    // registerTool returns false (not deferred) for normalized alwaysOn matches
    expect(state.registerTool('read')).toBe(false);
    expect(state.registerTool('READ')).toBe(false);
    expect(state.registerTool('write')).toBe(false);
    expect(state.registerTool('github_grep_searchgithub')).toBe(false);
    expect(state.registerTool('github-grep_searchGitHub')).toBe(false);
    expect(state.deferredCount).toBe(0);

    // registerTool returns true (deferred) for other tools
    expect(state.registerTool('custom_tool')).toBe(true);
    expect(state.deferredCount).toBe(1);

    // requiresReminder is false for normalized alwaysOn tools
    expect(state.requiresReminder('sess-1', 'read', 'read')).toBe(false);
    expect(state.requiresReminder('sess-1', 'READ', 'read')).toBe(false);
    expect(state.requiresReminder('sess-1', 'github_grep_searchgithub', 'github_grep_searchGitHub')).toBe(false);

    // addAlwaysOn removes previously deferred tool under normalized matching
    state.addAlwaysOn('CUSTOM-TOOL');
    expect(state.deferredCount).toBe(0);
    expect(state.requiresReminder('sess-1', 'custom_tool', 'custom_tool')).toBe(false);

    // resetIfConfigured works case-insensitively and with hyphens/underscores
    state.authorize('sess-1', [{ id: 'some_tool', description: 'desc', parameters: {} }]);
    expect(state.isAuthorized('sess-1', 'some_tool')).toBe(true);

    expect(state.resetIfConfigured('compress', 'sess-1')).toBe(true);
    expect(state.isAuthorized('sess-1', 'some_tool')).toBe(false);

    state.authorize('sess-1', [{ id: 'some_tool', description: 'desc', parameters: {} }]);
    expect(state.isAuthorized('sess-1', 'some_tool')).toBe(true);

    expect(state.resetIfConfigured('my_reset_tool', 'sess-1')).toBe(true);
    expect(state.isAuthorized('sess-1', 'some_tool')).toBe(false);
  });
});

// ============================================================================
// SessionToolRegistry & DeliveryHistory
// ============================================================================

describe('SessionToolRegistry & DeliveryHistory', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = join(tmpdir(), `test-session-reg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(() => {
    if (existsSync(testFile)) {
      try { rmSync(testFile, { force: true }); } catch {}
    }
  });

  const toolA: ToolMeta = { id: 'tool_a', description: 'Tool A description', parameters: { type: 'object' } };
  const toolB: ToolMeta = { id: 'tool_b', description: 'Tool B description', parameters: { type: 'object' } };

  it('registers tools as deferred when not in alwaysOn', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    expect(registry.registerTool('tool_search')).toBe(false);
    expect(registry.registerTool('tool_a')).toBe(true);
    expect(registry.deferredCount).toBe(1);
  });

  it('processes search results and authorizes new discoveries', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    registry.registerTool('tool_a');
    registry.registerTool('tool_b');

    const res = registry.processSearchResult('session-1', [toolA, toolB], 10);
    expect(res.kind).toBe('new');
    expect(res.hits).toHaveLength(2);
    expect(registry.isAuthorized('session-1', 'tool_a')).toBe(true);
    expect(registry.isAuthorized('session-1', 'tool_b')).toBe(true);
  });

  it('returns No-Op Discovery when all results are previously delivered and authorized', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    registry.registerTool('tool_a');
    registry.processSearchResult('session-1', [toolA], 10);

    const second = registry.processSearchResult('session-1', [toolA], 10);
    expect(second.kind).toBe('no-op');
    expect(second.responseText).toContain('No new tools discovered');
  });

  it('DeliveryHistory splits new and delivered tools correctly', () => {
    const dh = new DeliveryHistory();
    const split1 = dh.filterNewDiscoveries('s1', [toolA, toolB]);
    expect(split1.new).toHaveLength(2);
    expect(split1.delivered).toHaveLength(0);

    dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));
    const split2 = dh.filterNewDiscoveries('s1', [toolA, toolB]);
    expect(split2.new).toHaveLength(1);
    expect(split2.new[0].id).toBe('tool_b');
    expect(split2.delivered).toHaveLength(1);
    expect(split2.delivered[0].id).toBe('tool_a');
  });

  it('DeliveryHistory detects fingerprint changes as new discoveries', () => {
    const dh = new DeliveryHistory();
    dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));

    const toolAChanged: ToolMeta = { id: 'tool_a', description: 'Updated desc', parameters: {} };
    const res = dh.filterNewDiscoveries('s1', [toolAChanged]);
    expect(res.new).toHaveLength(1);
    expect(res.new[0].id).toBe('tool_a');
  });

  it('DeliveryHistory maintains session isolation and supports clearing', () => {
    const dh = new DeliveryHistory();
    dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));

    expect(dh.filterNewDiscoveries('s2', [toolA]).new).toHaveLength(1);

    dh.clear('s1');
    expect(dh.filterNewDiscoveries('s1', [toolA]).new).toHaveLength(1);
  });
});

// ============================================================================
// AutoUpdateChecker & npm-registry
// ============================================================================

describe('AutoUpdateChecker & npm-registry', () => {
  it('compares semver versions accurately with isNewerVersion', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0-alpha')).toBe(true);
    expect(isNewerVersion('1.0.0-alpha', '1.0.0')).toBe(false);
    expect(isNewerVersion('invalid', '1.0.0')).toBe(false);
  });

  it('parses and normalizes registry URLs safely', () => {
    expect(parseRegistryUrl('https://registry.npmjs.org')).toBe('https://registry.npmjs.org/');
    expect(parseRegistryUrl('http://localhost:4873')).toBe('http://localhost:4873/');
    expect(parseRegistryUrl('https://token:secret@registry.npmjs.org')).toBeNull();
    expect(parseRegistryUrl('https://registry.npmjs.org?q=1')).toBeNull();
    expect(parseRegistryUrl('https://registry.npmjs.org#hash')).toBeNull();
  });

  it('builds dist-tags endpoint URL', () => {
    const url = buildDistTagsUrl('https://registry.npmjs.org/', '@openstellar/tool-search');
    expect(url).toBe('https://registry.npmjs.org/-/package/%40openstellar%2Ftool-search/dist-tags');
  });

  it('builds wrapper cache target directories', () => {
    expect(getPackageCacheTargets('/tmp/packages')).toEqual([
      '/tmp/packages/@openstellar/tool-search',
      '/tmp/packages/@openstellar/tool-search@latest',
    ]);
  });

  it('runs checkForUpdate lifecycle when newer version exists', async () => {
    let invalidated = false;
    const result = await checkForUpdate({
      getCurrentVersion: () => '1.0.0',
      getLatestVersion: async () => '1.0.1',
      invalidatePackageCache: () => {
        invalidated = true;
        return true;
      },
    });

    expect(result).toEqual({
      outcome: 'update-staged',
      currentVersion: '1.0.0',
      latestVersion: '1.0.1',
    });
    expect(invalidated).toBe(true);
  });

  it('UpdateCheckLifecycle handles events with cooldown and trigger check', async () => {
    const mockCtx = {
      client: {
        tui: {
          showToast: vi.fn().mockResolvedValue(undefined),
        },
      },
    };

    const lifecycle = new UpdateCheckLifecycle(mockCtx as any);
    await expect(lifecycle.handleEvent('session.created')).resolves.not.toThrow();
  });
});

// ============================================================================
// SessionEngine Canonical Specs & Context Seam Consolidation
// ============================================================================

describe('SessionEngine Canonical Specs & Context Seam', () => {
  function createEngine(overrides: Record<string, unknown> = {}) {
    return new SessionEngine(
      {} as any,
      {
        alwaysOn: [],
        resetTools: ['compress'],
        maxResults: 5,
        deferLabel: '[deferred]',
        embedding: { enabled: false },
        ...overrides,
      } as any,
    );
  }

  it('exposes authoritative searchToolSpecs with unified parameter descriptions', () => {
    const engine = createEngine();
    expect(engine.searchToolSpecs).toBeDefined();
    expect(engine.searchToolSpecs.tool_search).toBeDefined();
    expect(engine.searchToolSpecs.tool_search_regex).toBeDefined();

    expect(engine.searchToolSpecs.tool_search.argDescription).toBe(TOOL_SEARCH_PARAM_DESC);
    expect(engine.searchToolSpecs.tool_search.input.properties.query.description).toBe(TOOL_SEARCH_PARAM_DESC);

    expect(engine.searchToolSpecs.tool_search_regex.argDescription).toBe(TOOL_SEARCH_REGEX_PARAM_DESC);
    expect(engine.searchToolSpecs.tool_search_regex.input.properties.pattern.description).toBe(TOOL_SEARCH_REGEX_PARAM_DESC);
  });

  it('applies context turn: defers tools, prevents tag stacking, restores authorized tools, and injects policy', () => {
    const engine = createEngine();
    const sessionID = 'session-test-seam';

    const sessionCtx: any = {
      sessionID,
      system: ['Existing system prompt'],
      tools: {
        custom_tool: {
          description: 'A custom tool for processing data.',
          input: {
            type: 'object',
            properties: { data: { type: 'string', description: 'Data string' } },
            required: ['data'],
          },
        },
      },
    };

    // First turn: custom_tool is unauthorized, should be deferred
    engine.applyContextTurn(sessionCtx);

    expect(sessionCtx.tools.custom_tool.description).toBe('A custom tool for processing data. [deferred]');
    expect(sessionCtx.tools.custom_tool.input.properties.reason).toBeDefined();
    expect(sessionCtx.system.some((s: any) => typeof s === 'string' && s.includes('[Tool Search Policy]'))).toBe(true);

    // Second turn without authorization: should NOT stack [deferred] [deferred]
    engine.applyContextTurn(sessionCtx);
    expect(sessionCtx.tools.custom_tool.description).toBe('A custom tool for processing data. [deferred]');

    // Authorize custom_tool
    engine.sessionRegistry.processSearchResult(
      sessionID,
      [{ id: 'custom_tool', description: 'A custom tool for processing data.', parameters: {} }],
      5,
    );

    // Third turn: should restore original description and input schema
    engine.applyContextTurn(sessionCtx);
    expect(sessionCtx.tools.custom_tool.description).toBe('A custom tool for processing data.');
    expect(sessionCtx.tools.custom_tool.input.properties.data).toBeDefined();
    expect(sessionCtx.tools.custom_tool.input.properties.reason).toBeUndefined();
  });

  it('injects policy text into structured { type: "text", text } system array', () => {
    const engine = createEngine();
    const sessionCtx: any = {
      sessionID: 'session-struct-sys',
      system: [{ type: 'text', text: 'Existing system prompt' }],
      tools: {
        deferred_tool: {
          description: 'Does something useful.',
          input: { type: 'object', properties: {} },
        },
      },
    };

    engine.applyContextTurn(sessionCtx);
    const injected = sessionCtx.system.find((item: any) => typeof item === 'object' && item.text?.includes('[Tool Search Policy]'));
    expect(injected).toBeDefined();
    expect(injected.type).toBe('text');
  });

  it('handles session.deleted event across direct and nested event shapes', () => {
    const engine = createEngine();
    const sessionID1 = 'session-del-1';
    const sessionID2 = 'session-del-2';

    engine.sessionRegistry.processSearchResult(
      sessionID1,
      [{ id: 'tool_a', description: 'desc', parameters: {} }],
      5,
    );
    engine.sessionRegistry.processSearchResult(
      sessionID2,
      [{ id: 'tool_b', description: 'desc', parameters: {} }],
      5,
    );
    expect(engine.sessionRegistry.isAuthorized(sessionID1, 'tool_a')).toBe(true);
    expect(engine.sessionRegistry.isAuthorized(sessionID2, 'tool_b')).toBe(true);

    // Direct event shape
    engine.handleSessionEvent({ type: 'session.deleted', properties: { sessionID: sessionID1 } });
    expect(engine.sessionRegistry.isAuthorized(sessionID1, 'tool_a')).toBe(false);

    // Nested event shape ({ event: { type: ... } })
    engine.handleSessionEvent({ event: { type: 'session.deleted', properties: { sessionID: sessionID2 } } });
    expect(engine.sessionRegistry.isAuthorized(sessionID2, 'tool_b')).toBe(false);
  });
});

// ============================================================================
// Storage Path & Transformers Env Utilities
// ============================================================================

describe('Storage Path & Transformers Env Utilities', () => {
  it('resolveStorageDir resolves valid storage directory with optional subdir', () => {
    const defaultDir = resolveStorageDir();
    expect(defaultDir).toContain('tool-search');

    const customSubdir = resolveStorageDir('custom-subdir');
    expect(customSubdir).toContain('custom-subdir');
  });

  it('safeReadJson and safeWriteJson round-trip JSON data cleanly', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'tool-search-storage-test-'));
    const testFile = join(testDir, 'test-payload.json');
    try {
      expect(safeReadJson(testFile)).toBeNull();

      const payload = { hello: 'world', numbers: [1, 2, 3] };
      safeWriteJson(testFile, payload);

      const readBack = safeReadJson<{ hello: string; numbers: number[] }>(testFile);
      expect(readBack).toEqual(payload);

      // Malformed JSON returns null without throwing
      writeFileSync(testFile, '{ not valid json');
      expect(safeReadJson(testFile)).toBeNull();
    } finally {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }
  });

  it('configureTransformersEnv sets log levels and env settings safely', () => {
    const mockEnv: any = {};
    configureTransformersEnv(mockEnv);
    expect(mockEnv.logLevel).toBe('error');
    expect(mockEnv.backends?.onnx?.logLevel).toBe('error');

    // Safe when passed null / undefined / primitives
    expect(() => configureTransformersEnv(null)).not.toThrow();
    expect(() => configureTransformersEnv(undefined)).not.toThrow();
  });
});

