import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolSearchPlugin } from '../src/plugin.js';
import { ToolVault } from '../src/vault.js';
import { AuthPersistence } from '../src/auth-persistence.js';
import type { PersistedToolAuthorization } from '../src/auth-persistence.js';

// Track SemanticMatcher instantiation for Bug 6 test.
let matcherInstantiated = false;

// Mock the embedding module so we can detect when SemanticMatcher is created
// (and avoid loading real transformer models during tests).
vi.mock('../src/matcher.js', () => ({
  SemanticMatcher: class {
    constructor() {
      matcherInstantiated = true;
    }
    async open() {}
    async index() {}
    async locate() {
      return new Map();
    }
    get active() {
      return false;
    }
    get entryCount() {
      return 0;
    }
    get fault() {
      return null;
    }
  },
}));

describe('ToolSearchPlugin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports a plugin function', () => {
    expect(typeof ToolSearchPlugin).toBe('function');
  });


  // =========================================================================
  // RED Test 1 — Bug 1: JSON.stringify strips Zod-like schema data
  // =========================================================================
  //
  // The current code does:
  //   vault.add(id, description,
  //     output.parameters ? JSON.parse(JSON.stringify(output.parameters))
  //                       : output.parameters
  //   );
  //
  // JSON.stringify on a Zod schema returns "{}", losing all parameter data.
  // The CORRECT fix is to pass output.parameters directly.
  //
  // This test creates a mock Zod-like object whose internal data is stored in
  // non-enumerable properties (like real Zod schemas). JSON.stringify silently
  // drops those properties. The test asserts that the vault stores the *same
  // reference* as the original object — a guarantee that cloning is skipped.
  // On current code this fails because JSON.parse(JSON.stringify(…)) produces
  // a new empty object, not the original.
  // =========================================================================
  it('stores raw parameters without JSON cloning (Bug 1 - RED)', async () => {
    const addSpy = vi.spyOn(ToolVault.prototype, 'add');
    const hooks = await ToolSearchPlugin({} as any, { alwaysLoad: ['test_tool1'] });

    // Simulate a Zod-object-like schema whose shape data lives in
    // non-enumerable properties — JSON.stringify silently drops them.
    const zodLikeParams: Record<string, unknown> = {};
    Object.defineProperties(zodLikeParams, {
      type: { value: 'object', enumerable: true },
      shape: {
        value: () => ({
          name: { type: 'string', description: 'User name parameter' },
        }),
        enumerable: false, // Non-enumerable — like Zod's internal shape
      },
      _def: {
        value: { typeName: 'ZodObject' },
        enumerable: false,
      },
    });

    await hooks['tool.definition']!(
      { toolID: 'test_tool1' },
      { description: 'A test tool', parameters: zodLikeParams },
    );

    // CORRECT behavior: the vault should store a reference to the original
    // parameter object, NOT a JSON-roundtripped clone.
    // CURRENT BUG: JSON.parse(JSON.stringify(…)) creates a different reference
    // and loses all non-enumerable / Symbol-keyed data.
    expect(addSpy.mock.calls[0][2]).toBe(zodLikeParams);
  });

  // =========================================================================
  // RED Test 2 — Bug 2: stripDescriptions mutates the original schema
  // =========================================================================
  //
  // The current code calls stripDescriptions(output.parameters, deferLabel)
  // which does:
  //   if ('description' in obj && …) { obj.description = label; }
  //
  // This overwrites .description on the original schema object.  Zod stores
  // descriptions internally (not as plain writable properties), so this
  // mutation is both ineffective on real Zod schemas AND destructive to any
  // object that uses a getter or computed description property.
  //
  // The CORRECT fix is to remove the stripDescriptions call entirely.
  //
  // This test creates a schema with a getter-based .description (simulating
  // Zod's internal description storage).  After the hook runs, the getter
  // should still be intact.  On current code it fails because
  // stripDescriptions replaces the getter with the literal string '[d]'.
  // =========================================================================
  it('does not mutate original schema description getter (Bug 2 - RED)', async () => {
    const hooks = await ToolSearchPlugin({} as any, {} as any);

    // Simulate a Zod schema where description is a getter (Zod stores
    // descriptions internally, not as a plain writable own property).
    const descriptionValue = 'Original parameter description';
    const params: Record<string, unknown> = {};
    Object.defineProperty(params, 'description', {
      get() {
        return descriptionValue;
      },
      enumerable: true,
      configurable: true,
    });

    // toolID NOT in alwaysOn → stripDescriptions WILL be called
    await hooks['tool.definition']!(
      { toolID: 'test_bug2' },
      { description: 'A test tool', parameters: params },
    );

    // CORRECT behaviour: the original schema object should NOT be mutated.
    // CURRENT BUG: stripDescriptions replaces the getter wit hthe string '[d]'.
    expect(Object.getOwnPropertyDescriptor(params, 'description')?.get).toBeDefined();
  });

  // =========================================================================
  // Bug 6: embedding defaults to enabled
  // =========================================================================
  //
  // The current code does:
  //   embedding: opts.embedding ?? { enabled: true }
  //
  // Embedding is enabled by default because BM25 cannot handle multilingual
  // queries (Thai, Japanese, etc.) — the tokenizer strips non-ASCII chars.
  // Semantic search via @xenova/transformers allows intent matching across
  // languages. Disable with { embedding: { enabled: false } } in options.
  // =========================================================================
  it('defaults to embedding enabled when no options provided', async () => {
    matcherInstantiated = false; // Reset from any prior test

    // Call plugin with NO embedding-related options
    await ToolSearchPlugin({} as any, {} as any);

    // SemanticMatcher should be created by default.
    expect(matcherInstantiated).toBe(true);
  });




  it('persists structured _ide authorization through a real serialized restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tool-search-auth-'));
    const previousCache = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = directory;
    try {
      const first = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
      await first['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
      await first['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
      await (first.tool as any).tool_search_regex.execute({ pattern: '^foo_ide$' }, { sessionID: 'disk-session' });
      await new Promise((resolve) => setTimeout(resolve, 80));

      const second = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
      await second['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
      await second['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    await expect(
      second['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'disk-session' } as any, {} as any)
    ).resolves.not.toThrow();
    const output = { output: 'Real result' };
      await second['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'disk-session', callID: 'disk' } as any, output as any);
      expect(output.output).toBe('Real result');
    } finally {
      if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousCache;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed for a legacy literal JSON structured-looking authorization after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tool-search-legacy-json-'));
    const previousCache = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = directory;
    try {
      const filePath = join(directory, 'opencode', 'tool-search', 'authorizations.json');
      mkdirSync(join(directory, 'opencode', 'tool-search'), { recursive: true });
      writeFileSync(filePath, JSON.stringify({ 'legacy-json-session': {
        tools: ['{"kind":"canonical-tool","version":1,"canonicalId":"foo_ide"}'],
      } }), 'utf8');
      const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
      await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
      await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
      await expect(
        hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'legacy-json-session' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');
    } finally {
      if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousCache;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('migrates legacy ambiguous _ide authorization to canonical object form after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tool-search-legacy-'));
    const previousCache = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = directory;
    try {
      const filePath = join(directory, 'opencode', 'tool-search', 'authorizations.json');
      const writeLegacy = (tool: string) => {
                mkdirSync(join(directory, 'opencode', 'tool-search'), { recursive: true });
        writeFileSync(filePath, JSON.stringify({ 'legacy-session': { tools: [tool] } }), 'utf8');
      };
      for (const legacyTool of ['foo_ide', '@canonical:foo_ide']) {
        writeLegacy(legacyTool);
        const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
        await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
        await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
        // F11 fix: legacy _ide and @canonical: strings are migrated, not purged
        // So the tool should be authorized after migration
        await expect(
          hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'legacy-session' } as any, {} as any)
        ).resolves.not.toThrow();
        const output = { output: 'Legacy result' };
        await hooks['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'legacy-session', callID: 'legacy' } as any, output as any);
        expect(output.output).toBe('Legacy result');
      }
    } finally {
      if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousCache;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves real _ide canonical authorization across plugin restart', async () => {
    const authorizations = new Map<string, Set<PersistedToolAuthorization>>();
    const lastSeen = new Map<string, number>();
    const loadSpy = vi.spyOn(AuthPersistence.prototype, 'load').mockReturnValue({ authorizations, lastSeen });
    const saveSpy = vi.spyOn(AuthPersistence.prototype, 'save').mockImplementation(() => {});

    const first = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await first['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await first['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    await (first.tool as any).tool_search_regex.execute({ pattern: '^foo_ide$' }, { sessionID: 'restart-session' });
    expect(Array.from(authorizations.get('restart-session') ?? []).some((entry: any) => entry && typeof entry === 'object' && entry.kind === 'canonical-tool' && entry.version === 1 && entry.canonicalId === 'foo_ide')).toBe(true);

    const second = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await second['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await second['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    const output = { output: 'Real result' };
    await second['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'restart-session', callID: 'restart' } as any, output as any);
    expect(output.output).toBe('Real result');
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy).toHaveBeenCalled();
  });

  it('migrates legacy synthesized _ide authorization to a real canonical tool', async () => {
    const authorizations = new Map<string, Set<PersistedToolAuthorization>>([['legacy-session', new Set<PersistedToolAuthorization>(['foo_ide'])]]);
    const lastSeen = new Map<string, number>();
    vi.spyOn(AuthPersistence.prototype, 'load').mockReturnValue({ authorizations, lastSeen });
    vi.spyOn(AuthPersistence.prototype, 'save').mockImplementation(() => {});

    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    // F11 fix: legacy _ide string is migrated to canonical object, not purged
    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'legacy-session' } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('documents precise canonical tool policy guidance', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'policy_tool' }, { description: 'Policy tool', parameters: {} });
    const output = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']!({ sessionID: 'policy-session' } as any, output as any);
    const text = output.system.join('\n');
    expect(text).toContain('canonical tool ID');
    expect(text).toContain('which must be used for execution');
    expect(text).not.toContain('alias');
    // When the tool ID is already known, AI should use tool_search_regex for a reliable exact match.
    expect(text).toContain('tool_search_regex');
    expect(text).toMatch(/known.*tool.*ID|tool.*ID.*known/i);
  });

  it('does not authorize a real tool after searching another canonical tool', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    const regexTool = (hooks.tool as any).tool_search_regex;
    await regexTool.execute({ pattern: '^foo$' }, { sessionID: 'collision-session' });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'collision-session' } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  describe('skill tool authorization', () => {
    it('authorizes skill like every other deferred tool (session-wide, multiple invocations, reset by compress)', async () => {
      const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
      await hooks['tool.definition']!({ toolID: 'skill' }, { description: 'Run a skill', parameters: {} });
      await hooks['tool.definition']!({ toolID: 'ordinary_tool' }, { description: 'Ordinary tool', parameters: {} });

      const sessionID = 'skill-standard-session';
      const searchTool = (hooks.tool as any).tool_search;

      // 1. Natural search for "skill" should authorize it
      await searchTool.execute({ query: 'skill' }, { sessionID });

      // 2. First execution of skill resolves without throwing in tool.execute.before
      await expect(
        hooks['tool.execute.before']!({ tool: 'skill', sessionID } as any, {} as any)
      ).resolves.not.toThrow();
      const out1 = { output: 'Skill result 1' };
      await hooks['tool.execute.after']!({ tool: 'skill', sessionID, callID: 'c1' } as any, out1 as any);
      expect(out1.output).toBe('Skill result 1');

      // 3. Intervening unauthorized tool execution should throw [Tool Search Required] in tool.execute.before, and does NOT clear skill authorization
      await expect(
        hooks['tool.execute.before']!({ tool: 'ordinary_tool', sessionID } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');

      // 4. Second execution of skill in same session should STILL be authorized
      await expect(
        hooks['tool.execute.before']!({ tool: 'skill', sessionID } as any, {} as any)
      ).resolves.not.toThrow();
      const out2 = { output: 'Skill result 2' };
      await hooks['tool.execute.after']!({ tool: 'skill', sessionID, callID: 'c3' } as any, out2 as any);
      expect(out2.output).toBe('Skill result 2');

      // 5. Authorization resets on compress
      await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c4' } as any, { output: 'compressed' } as any);

      // 6. After compress reset, skill requires search again (throws [Tool Search Required])
      await expect(
        hooks['tool.execute.before']!({ tool: 'skill', sessionID } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');
    });
  });


  it('blocks unauthorized deferred tool execution and resolves after authorization', async () => {
    const hooks = await ToolSearchPlugin({} as any);

    await hooks['tool.definition']!(
      { toolID: 'my_deferred_tool' },
      { description: 'My deferred tool', parameters: {} },
    );

    // Unauthorized deferred tool execution throws [Tool Search Required]
    await expect(
      hooks['tool.execute.before']!({ tool: 'my_deferred_tool', sessionID: 'sess1' } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');

    // Authorized tool resolves without throwing
    const searchTool = (hooks.tool as any).tool_search_regex;
    await searchTool.execute({ pattern: '^my_deferred_tool$' }, { sessionID: 'sess1' });

    await expect(
      hooks['tool.execute.before']!({ tool: 'my_deferred_tool', sessionID: 'sess1' } as any, {} as any)
    ).resolves.not.toThrow();

    const authorizedAfterOut = { output: 'Tool execution result' };
    await hooks['tool.execute.after']!({ tool: 'my_deferred_tool', sessionID: 'sess1', callID: 'c1' } as any, authorizedAfterOut as any);
    expect(authorizedAfterOut.output).toBe('Tool execution result');
  });

  it('authorizes only the exact regex match among deferred siblings', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'tool_a' }, { description: 'Tool A', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'tool_b' }, { description: 'Tool B', parameters: {} });

    const regexTool = (hooks.tool as any).tool_search_regex;
    await regexTool.execute({ pattern: '^tool_a$' }, { sessionID: 'sibling-session' });

    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_a', sessionID: 'sibling-session' } as any, {} as any)
    ).resolves.not.toThrow();
    const toolAOutput = { output: 'A result' };
    await hooks['tool.execute.after']!({ tool: 'tool_a', sessionID: 'sibling-session', callID: 'a' } as any, toolAOutput as any);
    expect(toolAOutput.output).toBe('A result');

    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_b', sessionID: 'sibling-session' } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  describe('configurable resetTools', () => {
    it('resets session authorizations for default compress tool', async () => {
      const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });

      await hooks['tool.definition']!(
        { toolID: 'git_commit' },
        { description: 'Commit staged changes', parameters: {} },
      );

      // Authorize git_commit in session A
      const regexTool = (hooks.tool as any).tool_search_regex;
      await regexTool.execute({ pattern: '^git_commit$' }, { sessionID: 'sess_default_a' });

      // Before reset: git_commit executed in sess_default_a resolves without throwing
      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_default_a' } as any, {} as any)
      ).resolves.not.toThrow();
      const beforeGit = { output: 'Commit successful' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_default_a', callID: 'c1' } as any, beforeGit as any);
      expect(beforeGit.output).toBe('Commit successful');

      // Execute default compress tool in sess_default_a
      const compressOut = { output: 'Compaction finished' };
      await hooks['tool.execute.after']!({ tool: 'compress', sessionID: 'sess_default_a', callID: 'c2' } as any, compressOut as any);
       // Compress preserves its result and appends a deterministic model-visible reset notice.
       expect(compressOut.output).toBe('Compaction finished\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      // After reset: git_commit throws [Tool Search Required] in tool.execute.before
      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_default_a' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');
    });

    it('resets session authorizations for custom resetTools while maintaining additive semantics and session isolation', async () => {
      const hooks = await ToolSearchPlugin({} as any, {
        embedding: { enabled: false },
        resetTools: ['custom_compaction'],
      });

      await hooks['tool.definition']!(
        { toolID: 'git_commit' },
        { description: 'Commit staged changes', parameters: {} },
      );
      await hooks['tool.definition']!(
        { toolID: 'custom_compaction' },
        { description: 'Custom compaction tool', parameters: {} },
      );

      const regexTool = (hooks.tool as any).tool_search_regex;
      // Authorize git_commit in session A and session B
      await regexTool.execute({ pattern: '^git_commit$' }, { sessionID: 'sess_custom_a' });
      await regexTool.execute({ pattern: '^git_commit$' }, { sessionID: 'sess_custom_b' });

      // Executing custom_compaction in session A should produce reset notice
      const customResetOut = { output: 'Custom compaction done' };
      await hooks['tool.execute.after']!({ tool: 'custom_compaction', sessionID: 'sess_custom_a', callID: 'c1' } as any, customResetOut as any);
      expect(customResetOut.output).toBe('Custom compaction done\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      // Session A's git_commit should now throw [Tool Search Required] in tool.execute.before
      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_custom_a' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');

      // Session B's git_commit remains authorized (session isolation)
      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_custom_b' } as any, {} as any)
      ).resolves.not.toThrow();
      const afterGitB = { output: 'Commit done' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_custom_b', callID: 'c3' } as any, afterGitB as any);
      expect(afterGitB.output).toBe('Commit done');

      // Additive check: default compress still works as reset tool in session B
      const compressOutB = { output: 'Compressed session B' };
      await hooks['tool.execute.after']!({ tool: 'compress', sessionID: 'sess_custom_b', callID: 'c4' } as any, compressOutB as any);
      expect(compressOutB.output).toBe('Compressed session B\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      // Session B git_commit throws [Tool Search Required] after compress reset
      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_custom_b' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');
    });

    it('does not reset authorizations when a non-reset tool executes', async () => {
      const hooks = await ToolSearchPlugin({} as any, {
        embedding: { enabled: false },
        resetTools: ['custom_compaction'],
      });

      await hooks['tool.definition']!(
        { toolID: 'git_commit' },
        { description: 'Commit staged changes', parameters: {} },
      );
      await hooks['tool.definition']!(
        { toolID: 'read_file' },
        { description: 'Read file', parameters: {} },
      );

      const regexTool = (hooks.tool as any).tool_search_regex;
      await regexTool.execute({ pattern: '^(git_commit|read_file)$' }, { sessionID: 'sess_non_reset' });

      // Execute non-reset tool git_commit
      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_non_reset' } as any, {} as any)
      ).resolves.not.toThrow();
      const gitOut = { output: 'Committed' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_non_reset', callID: 'c1' } as any, gitOut as any);
      expect(gitOut.output).toBe('Committed');

      // read_file should remain authorized
      await expect(
        hooks['tool.execute.before']!({ tool: 'read_file', sessionID: 'sess_non_reset' } as any, {} as any)
      ).resolves.not.toThrow();
      const readOut = { output: 'File content' };
      await hooks['tool.execute.after']!({ tool: 'read_file', sessionID: 'sess_non_reset', callID: 'c2' } as any, readOut as any);
      expect(readOut.output).toBe('File content');
    });
  });

  it('resolves _ide cloaked tool via search and allows execution', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    // Register bash (original ID, as tool.definition fires with original)
    await hooks['tool.definition']!({ toolID: 'bash' }, { description: 'Execute bash command', parameters: {} });

    const sessionID = 'cloak-test-1';
    const regexTool = (hooks.tool as any).tool_search_regex;

    // Agent searches for bash_ide (cloaked name) — should find bash
    const result = await regexTool.execute({ pattern: '^bash_ide$' }, { sessionID });
    expect(result).toContain('bash');
    expect(result).toContain('Found 1 tool');

    // Executing bash_ide should be allowed (bash is now authorized)
    await expect(
      hooks['tool.execute.before']!({ tool: 'bash_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('does not allow _ide variant when only canonical name was authorized for a different tool', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'bash' }, { description: 'Execute bash', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'read' }, { description: 'Read file', parameters: {} });

    const sessionID = 'cloak-isolation-1';
    const regexTool = (hooks.tool as any).tool_search_regex;

    // Authorize only bash
    await regexTool.execute({ pattern: '^bash_ide$' }, { sessionID });

    // read_ide should NOT be authorized
    await expect(
      hooks['tool.execute.before']!({ tool: 'read_ide', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  it('real _ide canonical tool is not confused with cloaked alias', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    // Register both foo (canonical) and foo_ide (real separate tool)
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo_ide tool', parameters: {} });

    const sessionID = 'real-ide-canon-1';
    const regexTool = (hooks.tool as any).tool_search_regex;

    // Search and authorize foo_ide explicitly
    await regexTool.execute({ pattern: '^foo_ide$' }, { sessionID });

    // foo_ide executes fine (authorized directly)
    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();

    // foo is NOT authorized (only foo_ide was searched)
    await expect(
      hooks['tool.execute.before']!({ tool: 'foo', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  it('F2 regression: foo_ide is not falsely exempted when foo is alwaysOn', async () => {
    // foo is alwaysOn (via alwaysLoad), but foo_ide is a separate deferred tool.
    // Before the F2 fix, baseID stripping would check alwaysOn.has('foo') and
    // falsely exempt foo_ide from the reminder gate.
    const hooks = await ToolSearchPlugin({} as any, {
      embedding: { enabled: false },
      alwaysLoad: ['foo'],
    });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Separate foo_ide tool', parameters: {} });

    const sessionID = 'f2-regression-session';

    // foo_ide should still require a reminder (it is NOT alwaysOn)
    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');

    // After searching foo_ide, it should be authorized
    const regexTool = (hooks.tool as any).tool_search_regex;
    await regexTool.execute({ pattern: '^foo_ide$' }, { sessionID });

    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('blocks malformed/double-cloaked ID bash_ide_ide when base tool bash is deferred and unauthorized', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'bash' }, { description: 'Execute bash command', parameters: {} });

    const sessionID = 'double-cloak-session';

    // Attempting to execute bash_ide_ide without authorizing bash must throw [Tool Search Required]
    await expect(
      hooks['tool.execute.before']!({ tool: 'bash_ide_ide', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');

    // Once bash is searched and authorized, bash_ide_ide execution should succeed
    const regexTool = (hooks.tool as any).tool_search_regex;
    await regexTool.execute({ pattern: '^bash$' }, { sessionID });

    await expect(
      hooks['tool.execute.before']!({ tool: 'bash_ide_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('tool_search_regex({ pattern: "_ide" }) returns only exact regex matches and does not act as wildcard', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'read' }, { description: 'Read file', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'write' }, { description: 'Write file', parameters: {} });

    const sessionID = 'wildcard-test-session';
    const regexTool = (hooks.tool as any).tool_search_regex;

    // Searching pattern '_ide' when no tool matches should return no matches and not authorize read or write
    const result = await regexTool.execute({ pattern: '_ide' }, { sessionID });
    expect(result).toContain('No tools matched pattern "_ide"');

    // read and write must remain unauthorized
    await expect(
      hooks['tool.execute.before']!({ tool: 'read', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
    await expect(
      hooks['tool.execute.before']!({ tool: 'write', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  // =========================================================================
  // Delivery History + No-Op Discovery tests (CONTEXT.md rules 32-43)
  // =========================================================================

  it('returns No-Op Discovery response when all results are delivered and authorized (rule 36)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'bar' }, { description: 'Canonical bar', parameters: {} });

    const sessionID = 'noop-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    // First search: delivers both tools
    const firstResult = await searchTool.execute({ pattern: '^foo$|^bar$' }, { sessionID });
    expect(firstResult).toContain('Found 2 tool(s)');
    expect(firstResult).toContain('foo');
    expect(firstResult).toContain('bar');

    // Second search: same query -> No-Op Discovery (rule 36)
    const secondResult = await searchTool.execute({ pattern: '^foo$|^bar$' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');
    expect(secondResult).toContain('foo');
    expect(secondResult).toContain('bar');
  });

  it('returns unauthorized delivered tool again when authorization was reset (rule 41)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'reauth-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    // First search: delivers foo
    const firstResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');

    // Second search: No-Op because already delivered and authorized
    const secondResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');

    // Reset authorization (simulating compress)
    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    // Third search: foo was delivered but authorization was reset
    // Should return foo again to restore authorization (rule 41)
    const thirdResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(thirdResult).toContain('Found 1 tool(s)');
    expect(thirdResult).toContain('foo');

    // foo should be authorized again
    await expect(
      hooks['tool.execute.before']!({ tool: 'foo', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('delivers only new results and applies limit after filtering (rules 32-33)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false }, searchLimit: 2 });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'bar' }, { description: 'Canonical bar', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'baz' }, { description: 'Canonical baz', parameters: {} });

    const sessionID = 'limit-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    // First search with limit=2: delivers foo and bar (first 2 of 3)
    const firstResult = await searchTool.execute({ pattern: '^foo$|^bar$|^baz$' }, { sessionID });
    expect(firstResult).toContain('Found 2 tool(s)');
    expect(firstResult).toContain('foo');
    expect(firstResult).toContain('bar');

    // Second search: foo and bar are delivered, baz is new -> returns baz only
    const secondResult = await searchTool.execute({ pattern: '^foo$|^bar$|^baz$' }, { sessionID });
    expect(secondResult).toContain('Found 1 tool(s)');
    expect(secondResult).toContain('baz');
    expect(secondResult).not.toContain('foo:');
    expect(secondResult).not.toContain('bar:');
  });

  it('no-match search does not record in delivery history (rule 37)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'nomatch-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    // No-match search
    const noMatchResult = await searchTool.execute({ pattern: '^nonexistent$' }, { sessionID });
    expect(noMatchResult).toContain('No tools matched');

    // foo should still be discoverable (not affected by no-match)
    const searchResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(searchResult).toContain('Found 1 tool(s)');
    expect(searchResult).toContain('foo');
  });

  it('compaction clears delivery history (rule 42)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'compact-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    // First search: delivers foo
    const firstResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');

    // Second search: No-Op (already delivered)
    const secondResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');

    // Compaction clears both authorization and delivery history
    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    // Third search: foo is new again (delivery history cleared)
    const thirdResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(thirdResult).toContain('Found 1 tool(s)');
    expect(thirdResult).toContain('foo');
  });

  it('tool_search also applies delivery history filtering', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'ts-session';
    const searchTool = (hooks.tool as any).tool_search;

    // First search via tool_search
    const firstResult = await searchTool.execute({ query: 'Canonical' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');

    // Second search via tool_search: foo already delivered -> No-Op
    const secondResult = await searchTool.execute({ query: 'Canonical' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');
  });

  it('F5: re-auth path limits results to maxResults when many tools lose auth simultaneously', async () => {
    // Register 5 tools with searchLimit: 3
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false }, searchLimit: 3 });
    for (let i = 1; i <= 5; i++) {
      await hooks['tool.definition']!({ toolID: `tool${i}` }, { description: `Tool ${i}`, parameters: {} });
    }

    const sessionID = 'f5-limit-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    // First search: delivers tool1-tool3 (limited by searchLimit=3)
    const firstResult = await searchTool.execute({ pattern: '^tool[123]$' }, { sessionID });
    expect(firstResult).toContain('Found 3 tool(s)');

    // Second search: delivers tool4-tool5 (new, within limit)
    const secondResult = await searchTool.execute({ pattern: '^tool[45]$' }, { sessionID });
    expect(secondResult).toContain('Found 2 tool(s)');

    // Now all 5 tools are delivered. Reset authorization (simulating compress)
    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    // Third search: all 5 delivered tools match pattern, all unauthorized -> re-auth path
    // F5: must be limited to maxResults (3)
    const thirdResult = await searchTool.execute({ pattern: '^tool' }, { sessionID });
    expect(thirdResult).toContain('Found 3 tool(s)');
    expect(thirdResult).toContain('tool1');

    // tool1 should be re-authorized
    await expect(
      hooks['tool.execute.before']!({ tool: 'tool1', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('returns and authorizes both new tools and previously delivered but unauthorized tools', async () => {
    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'tool_a' }, { description: 'Tool A', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'tool_b' }, { description: 'Tool B', parameters: {} });

    const sessionID = 'mixed-delivery-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    // First search: deliver tool_a
    const firstResult = await searchTool.execute({ pattern: '^tool_a$' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');
    expect(firstResult).toContain('tool_a');

    // Reset authorization for tool_a (e.g. compress)
    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    // Verify tool_a is unauthorized
    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_a', sessionID } as any, {} as any)
    ).rejects.toThrow();

    // Now search pattern '^tool_' which matches tool_a (delivered, unauthorized) AND tool_b (new)
    const secondResult = await searchTool.execute({ pattern: '^tool_' }, { sessionID });
    expect(secondResult).toContain('Found 2 tool(s)');
    expect(secondResult).toContain('tool_a');
    expect(secondResult).toContain('tool_b');

    // Verify both tool_a and tool_b are now authorized
    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_a', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_b', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });
});
