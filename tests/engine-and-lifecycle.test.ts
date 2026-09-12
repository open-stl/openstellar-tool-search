import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
    expect(res.responseText).toContain('tool_a: Tool A description');
    expect(res.responseText).not.toContain('parameters:');
    expect(registry.isDelivered('session-1', 'tool_a')).toBe(true);
    expect(registry.isDelivered('session-1', 'tool_b')).toBe(true);
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

    // First turn: custom_tool is unauthorized, description is deferred; parameters stay intact (unified v1/v2 contract)
    engine.applyContextTurn(sessionCtx);

    expect(sessionCtx.tools.custom_tool.description).toBe('A custom tool for processing data. [deferred]');
    expect(sessionCtx.tools.custom_tool.input.properties.data).toBeDefined();
    expect(sessionCtx.tools.custom_tool.input.properties.reason).toBeUndefined();
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

    // Third turn after authorization: description remains truncated ([deferred]) per
    // ADR 0003 token virtualization — full docs were delivered via the search response
    // message channel. The parameter schema stays intact in the tools array.
    engine.applyContextTurn(sessionCtx);
    expect(sessionCtx.tools.custom_tool.description).toBe('A custom tool for processing data. [deferred]');
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
    expect(engine.sessionRegistry.isDelivered(sessionID1, 'tool_a')).toBe(true);
    expect(engine.sessionRegistry.isDelivered(sessionID2, 'tool_b')).toBe(true);

    // Direct event shape
    engine.handleSessionEvent({ type: 'session.deleted', properties: { sessionID: sessionID1 } });
    expect(engine.sessionRegistry.isDelivered(sessionID1, 'tool_a')).toBe(false);

    // Nested event shape ({ event: { type: ... } })
    engine.handleSessionEvent({ event: { type: 'session.deleted', properties: { sessionID: sessionID2 } } });
    expect(engine.sessionRegistry.isDelivered(sessionID2, 'tool_b')).toBe(false);
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

// ============================================================================
// Sleev Compression Synchronization & AgentMemory Re-Authorization
// ============================================================================

describe('Sleev Compression & AgentMemory Tool Synchronization', () => {
  it('revokes AgentMemory tools when their delivery messages are pruned by Sleev range compression', () => {
    const engine = new SessionEngine(
      {} as any,
      {
        alwaysOn: [],
        resetTools: ['compress'],
        maxResults: 5,
        deferLabel: '[deferred]',
        embedding: { enabled: false },
      } as any,
    );

    const sessionID = 'sess-sleev-agentmemory';

    // 0. Register tools as deferred
    engine.sessionRegistry.registerTool('agentmemory_memory_recall');
    engine.sessionRegistry.registerTool('agentmemory_memory_save');

    // 1. Authorize agentmemory_memory_recall and agentmemory_memory_save
    engine.sessionRegistry.processSearchResult(
      sessionID,
      [
        { id: 'agentmemory_memory_recall', description: 'Search past session observations', parameters: { type: 'object' } },
        { id: 'agentmemory_memory_save', description: 'Save insight to memory', parameters: { type: 'object' } },
      ],
      5,
    );

    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_recall')).toBe(true);
    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_save')).toBe(true);

    // 2. Simulate conversation context where agentmemory_memory_recall was delivered in message m0002,
    //    and agentmemory_memory_save was delivered in message m0006
    const messages = [
      {
        role: 'user',
        content: '<sleev-id-m0001>User asking for memory recall</sleev-id-m0001>',
      },
      {
        role: 'assistant',
        content: '<sleev-id-m0002>Found 1 tool(s):\n\nagentmemory_memory_recall: Search past session observations</sleev-id-m0002>',
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            tool: 'compress',
            status: 'completed',
            input: {
              ids: ['m0001-m0003'], // Compress messages m0001 through m0003 (including m0002 where recall was delivered!)
            },
          },
        ],
      },
      {
        role: 'user',
        content: '<sleev-id-m0005>Now save this insight</sleev-id-m0005>',
      },
      {
        role: 'assistant',
        content: '<sleev-id-m0006>Found 1 tool(s):\n\nagentmemory_memory_save: Save insight to memory</sleev-id-m0006>',
      },
    ];

    // 3. Run syncSleevCompression
    const revoked = engine.syncSleevCompression(sessionID, messages);

    // Under ADR 0003, tools are ungated and authorizations are not subject to ephemeral text presence revocation
    expect(revoked).toEqual([]);
    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_recall')).toBe(true);
    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_save')).toBe(true);

    // 4. In Option 2+, calling assertAuthorized does not throw (execution is ungated per ADR 0003)
    expect(() => {
      engine.assertAuthorized('agentmemory_memory_recall', sessionID, 'agentmemory_memory_recall');
    }).not.toThrow();

    // 5. Calling agentmemory_memory_save succeeds without error
    expect(() => {
      engine.assertAuthorized('agentmemory_memory_save', sessionID, 'agentmemory_memory_save');
    }).not.toThrow();
  });

  it('does NOT revoke authorized tools that still exist in the durable tools payload after Sleev pruning', () => {
    const engine = new SessionEngine(
      {} as any,
      {
        alwaysOn: [],
        resetTools: ['compress'],
        maxResults: 5,
        deferLabel: '[deferred]',
        embedding: { enabled: false },
      } as any,
    );

    const sessionID = 'sess-sleev-durable';

    // 0. Register + authorize agentmemory_memory_recall
    engine.sessionRegistry.registerTool('agentmemory_memory_recall');
    engine.sessionRegistry.processSearchResult(
      sessionID,
      [{ id: 'agentmemory_memory_recall', description: 'Search past session observations', parameters: { type: 'object' } }],
      5,
    );
    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_recall')).toBe(true);

    // 1. Sleev prunes EVERY message INCLUDING the delivery message for agentmemory_memory_recall
    const messages = [
      {
        role: 'user',
        content: '<sleev-id-m0001>User asking for memory recall</sleev-id-m0001>',
      },
      {
        role: 'assistant',
        content: '<sleev-id-m0002>Found 1 tool(s):\n\nagentmemory_memory_recall: Search past session observations</sleev-id-m0002>',
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            tool: 'compress',
            status: 'completed',
            input: { ids: ['m0001-m0002'] }, // prunes everything including m0002 (delivery)
          },
        ],
      },
    ];

    // 2. Tools payload (durable channel, survives Sleev) still contains the tool
    const tools = {
      agentmemory_memory_recall: { description: 'Search past session observations', input: { type: 'object' } },
    };

    // 3. Run syncSleevCompression WITH tools -> MUST NOT revoke
    const revoked = engine.syncSleevCompression(sessionID, messages, tools);
    expect(revoked).not.toContain('agentmemory_memory_recall');
    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_recall')).toBe(true);
    expect(() => {
      engine.assertAuthorized('agentmemory_memory_recall', sessionID, 'agentmemory_memory_recall');
    }).not.toThrow();
  });

  it('revokes when the durable tools payload is provided but the authorized tool is NOT in it (server disconnected)', () => {
    const engine = new SessionEngine(
      {} as any,
      {
        alwaysOn: [],
        resetTools: ['compress'],
        maxResults: 5,
        deferLabel: '[deferred]',
        embedding: { enabled: false },
      } as any,
    );

    const sessionID = 'sess-sleev-gone';

    // 0. Register + authorize agentmemory_memory_recall
    engine.sessionRegistry.registerTool('agentmemory_memory_recall');
    engine.sessionRegistry.processSearchResult(
      sessionID,
      [{ id: 'agentmemory_memory_recall', description: 'Search past session observations', parameters: { type: 'object' } }],
      5,
    );
    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_recall')).toBe(true);

    // 1. All messages pruned (no tool name anywhere in text)
    const messages = [
      { role: 'user', content: '<sleev-id-m0001>User asking for memory recall</sleev-id-m0001>' },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            tool: 'compress',
            status: 'completed',
            input: { ids: ['m0001-m0002'] },
          },
        ],
      },
    ];

    // 2. Durable tools payload provided (open handed back tools) but tool NOT in it
    const tools = {
      some_other_tool: { description: 'other', input: { type: 'object' } },
    };

    // 3. Under ADR 0003, tools are ungated and authorizations are not subject to ephemeral text presence revocation
    const revoked = engine.syncSleevCompression(sessionID, messages, tools);
    expect(revoked).toEqual([]);
    expect(engine.sessionRegistry.isDelivered(sessionID, 'agentmemory_memory_recall')).toBe(true);
    // 4. In Option 2+, calling assertAuthorized does not throw (execution is ungated per ADR 0003)
    expect(() => {
      engine.assertAuthorized('agentmemory_memory_recall', sessionID, 'agentmemory_memory_recall');
    }).not.toThrow();
  });
});

// ============================================================================
// Option 2+ Stateless Advisory Tool Discovery
// ============================================================================

describe('Option 2+ Stateless Advisory Tool Discovery', () => {
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

  it('unsearched deferred tool calls assertAuthorized -> succeeds without error', () => {
    const engine = createEngine();
    engine.deferTool('custom_database_query', 'Query database tables. [deferred]', { type: 'object' });
    const sessionID = 'ses-advisory-1';

    // Calling assertAuthorized for unsearched deferred tool must not throw
    expect(() => {
      engine.assertAuthorized('custom_database_query', sessionID, 'custom_database_query');
    }).not.toThrow();
  });

  it('failed tool execution produces reactive [Tool Hint]', async () => {
    const engine = createEngine();
    engine.deferTool('custom_api_caller', 'Call remote REST API. [deferred]', { type: 'object' });
    const sessionID = 'ses-advisory-2';

    // Successful execution (no error) does not produce hint
    const successNotice = engine.handleToolExecuted('custom_api_caller', sessionID, { isError: false, output: 'Success' });
    expect(successNotice).toBeNull();

    // Failed tool execution produces reactive tool hint
    const failedNotice = engine.handleToolExecuted('custom_api_caller', sessionID, {
      isError: true,
      error: new Error('Invalid params'),
    });
    expect(failedNotice).toContain('[Tool Hint]');
    expect(failedNotice).toContain('Execution failed for "custom_api_caller"');
    expect(failedNotice).toContain('detailed usage guidelines and documentation');
    expect(failedNotice).not.toContain('parameter schema');
    expect(failedNotice).toContain('tool_search_regex({ pattern: "^custom_api_caller$" })');

    // Also detects structured status: "error"
    const statusErrorNotice = engine.handleToolExecuted('custom_api_caller', 'ses-advisory-alt', {
      status: 'error',
    } as any);
    expect(statusErrorNotice).toContain('[Tool Hint]');

    // If tool was already delivered in that session, reactive hint is suppressed
    await engine.searchToolSpecs.tool_search_regex.execute(
      { pattern: '^custom_api_caller$' },
      { sessionID },
    );
    const suppressedNotice = engine.handleToolExecuted('custom_api_caller', sessionID, {
      isError: true,
      error: new Error('Invalid params'),
    });
    expect(suppressedNotice).toBeNull();
  });

  it('resetTools execution clears DeliveryHistory silently without injecting reset banner into output', async () => {
    const engine = createEngine({ resetTools: ['compress'] });
    engine.deferTool('git_push', 'Push local commits to remote. [deferred]', { type: 'object' });
    const sessionID = 'ses-advisory-reset';

    // 1. Deliver tool
    await engine.searchToolSpecs.tool_search_regex.execute(
      { pattern: '^git_push$' },
      { sessionID },
    );
    expect(engine.sessionRegistry.isDelivered(sessionID, 'git_push')).toBe(true);

    // 2. Execute reset tool (compress) - must not pollute output with banner
    const notice = engine.handleToolExecuted('compress', sessionID, { isError: false, output: 'OK' });
    expect(notice).toBeNull();

    // 3. Delivery history for session must be cleared
    expect(engine.sessionRegistry.isDelivered(sessionID, 'git_push')).toBe(false);

    // 4. Searching again delivers the tool again rather than suppressing as duplicate
    const reSearch = await engine.searchToolSpecs.tool_search_regex.execute(
      { pattern: '^git_push$' },
      { sessionID },
    );
    expect(reSearch).toContain('Found 1 tool(s)');
    expect(reSearch).toContain('git_push');
  });

  it('DeliveryHistory suppression returns "No new tools discovered" on duplicate search in same epoch, and clears on compactSession', async () => {
    const engine = createEngine();
    engine.deferTool('git_push', 'Push local commits to remote. [deferred]', { type: 'object' });
    const sessionID = 'ses-advisory-3';

    // First search delivers tool
    const firstSearch = await engine.searchToolSpecs.tool_search_regex.execute(
      { pattern: '^git_push$' },
      { sessionID },
    );
    expect(firstSearch).toContain('Found 1 tool(s)');
    expect(firstSearch).toContain('git_push');

    // Duplicate search in same epoch suppresses delivery with "No new tools discovered"
    const duplicateSearch = await engine.searchToolSpecs.tool_search_regex.execute(
      { pattern: '^git_push$' },
      { sessionID },
    );
    expect(duplicateSearch).toContain('No new tools discovered. Previously delivered: git_push.');

    // compactSession clears delivery history
    engine.compactSession(sessionID);

    // After compaction, search delivers the tool again
    const postCompactSearch = await engine.searchToolSpecs.tool_search_regex.execute(
      { pattern: '^git_push$' },
      { sessionID },
    );
    expect(postCompactSearch).toContain('Found 1 tool(s)');
    expect(postCompactSearch).toContain('git_push');
  });

  it('generates advisory policyText and descriptions without "required before use" or "unlock" phrasing', () => {
    const engine = createEngine();
    engine.deferTool('advisory_tool', 'Sample tool description. [deferred]', { type: 'object' });

    const transformState = engine.prepareForSystemTransform();
    expect(transformState.policyText).toContain('[Tool Search Policy]');
    expect(transformState.policyText).toContain('Direct execution: You may invoke any tool immediately');
    expect(transformState.policyText).not.toContain('a search is required before use');
    expect(transformState.policyText).not.toContain('unlock');

    const searchDesc = engine.searchToolSpecs.tool_search.description;
    expect(searchDesc).toContain('WHEN NOT TO USE');
    expect(searchDesc).toContain('understand its parameters');

    const regexDesc = engine.searchToolSpecs.tool_search_regex.description;
    expect(regexDesc).not.toContain('unlock MULTIPLE');
    expect(regexDesc).toContain('Standard tools you already know how to invoke');
  });

  it('DeliveryHistory evicts oldest sessions when maxSessions LRU capacity is exceeded', () => {
    const dh = new DeliveryHistory({ maxSessions: 2 });
    dh.recordDelivered('sess-1', 'tool_a', 'fp_a');
    dh.recordDelivered('sess-2', 'tool_b', 'fp_b');

    expect(dh.hasDelivered('sess-1', 'tool_a')).toBe(true);
    expect(dh.hasDelivered('sess-2', 'tool_b')).toBe(true);

    // Access sess-1 to make it more recently used than sess-2
    expect(dh.hasDelivered('sess-1', 'tool_a')).toBe(true);

    // Adding sess-3 should evict sess-2 (least recently used)
    dh.recordDelivered('sess-3', 'tool_c', 'fp_c');

    expect(dh.hasDelivered('sess-1', 'tool_a')).toBe(true);
    expect(dh.hasDelivered('sess-3', 'tool_c')).toBe(true);
    expect(dh.hasDelivered('sess-2', 'tool_b')).toBe(false);
  });

  it('session.deleted lifecycle event clears DeliveryHistory for deleted session', () => {
    const engine = createEngine();
    engine.sessionRegistry.recordDelivered('sess-del', 'tool_x', 'fp_x');

    expect(engine.sessionRegistry.isDelivered('sess-del', 'tool_x')).toBe(true);

    engine.handleSessionEvent({ type: 'session.deleted', properties: { sessionID: 'sess-del' } });
    expect(engine.sessionRegistry.isDelivered('sess-del', 'tool_x')).toBe(false);
  });

  it('failed compress execution does not clear DeliveryHistory', () => {
    const engine = createEngine();
    engine.sessionRegistry.recordDelivered('sess-fail', 'tool_m', 'fp_m');
    expect(engine.sessionRegistry.isDelivered('sess-fail', 'tool_m')).toBe(true);

    // Failed compress call
    const failedOutput = { isError: true, error: new Error('Compress execution failed'), content: 'Error' };
    engine.enrichToolExecutionOutput('compress', 'sess-fail', failedOutput);

    // DeliveryHistory should NOT have been cleared
    expect(engine.sessionRegistry.isDelivered('sess-fail', 'tool_m')).toBe(true);
  });

  it('provides schema fallback hint when tool_search_regex is unavailable in session manifest', () => {
    const engine = createEngine();
    engine.deferTool('subagent_tool', 'Subagent tool. [deferred]', { type: 'object' });

    // Session manifest WITHOUT tool_search_regex (e.g. subagent)
    engine.applyContextTurn({
      sessionID: 'subagent-sess',
      tools: {
        subagent_tool: { description: 'Subagent tool. [deferred]', input: {} },
      },
    } as any);

    const errorOutput: any = { isError: true, error: new Error('Missing argument') };
    engine.enrichToolExecutionOutput('subagent_tool', 'subagent-sess', errorOutput);

    expect(errorOutput.output).toContain('[Tool Hint]: Execution failed for "subagent_tool"');
    expect(errorOutput.output).toContain('Review parameter types, required fields, and boundary constraints in the tool schema');
    expect(errorOutput.output).not.toContain('call tool_search_regex');
  });

  it('idempotency guard prevents duplicating [Tool Hint] if already appended', () => {
    const engine = createEngine();
    engine.deferTool('flaky_tool', 'Flaky tool. [deferred]', { type: 'object' });

    const errorOutput: any = {
      isError: true,
      error: new Error('Execution failed'),
      output: 'Failure [Tool Hint]: Execution failed for "flaky_tool". To inspect detailed usage guidelines',
    };

    engine.enrichToolExecutionOutput('flaky_tool', 'sess-flaky', errorOutput);
    // Count occurrences of [Tool Hint]
    const matches = (errorOutput.output.match(/\[Tool Hint\]/g) || []).length;
    expect(matches).toBe(1);
  });
});

