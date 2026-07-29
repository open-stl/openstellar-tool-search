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
      const output = { output: 'Real result' };
      await hooks['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'legacy-json-session', callID: 'legacy-json' } as any, output as any);
      expect(output.output).toContain('executed without prior search');
    } finally {
      if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousCache;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed for legacy ambiguous _ide authorization after a real serialized restart', async () => {
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
        const output = { output: 'Real result' };
        await hooks['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'legacy-session', callID: 'legacy' } as any, output as any);
        expect(output.output).toContain('executed without prior search');
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

  it('does not migrate legacy synthesized _ide authorization to a real canonical tool', async () => {
    const authorizations = new Map<string, Set<PersistedToolAuthorization>>([['legacy-session', new Set<PersistedToolAuthorization>(['foo_ide'])]]);
    const lastSeen = new Map<string, number>();
    vi.spyOn(AuthPersistence.prototype, 'load').mockReturnValue({ authorizations, lastSeen });
    vi.spyOn(AuthPersistence.prototype, 'save').mockImplementation(() => {});

    const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    const output = { output: 'Real result' };
    await hooks['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'legacy-session', callID: 'legacy' } as any, output as any);
    expect(output.output).toContain('executed without prior search');
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
    const output = { output: 'Real result' };
    await hooks['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'collision-session', callID: 'collision' } as any, output as any);
    expect(output.output).toContain('executed without prior search');
    expect(output.output).toContain('^foo_ide$');
  });

  it('reminds after unauthorized deferred tool execution and stays quiet after authorization', async () => {
    const hooks = await ToolSearchPlugin({} as any);

    await hooks['tool.definition']!(
      { toolID: 'my_deferred_tool' },
      { description: 'My deferred tool', parameters: {} },
    );

    // The model may ignore the prompt policy; the after hook adds a reminder.
    const bypassOutput: { output?: string } = { output: 'Tool execution result' };
    await hooks['tool.execute.after']!({ tool: 'my_deferred_tool', sessionID: 'sess1', callID: 'c1' } as any, bypassOutput as any);
    expect(bypassOutput.output).toContain('executed without prior search');
    expect(bypassOutput.output).toContain('tool_search_regex({ pattern: "^my_deferred_tool$" })');
    expect(bypassOutput.output).toContain('Do not blindly repeat');

    // Authorized tool should not get reminder in after hook
    const searchTool = (hooks.tool as any).tool_search_regex;
    await searchTool.execute({ pattern: '^my_deferred_tool$' }, { sessionID: 'sess1' });

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

    const toolAOutput = { output: 'A result' };
    await hooks['tool.execute.after']!({ tool: 'tool_a', sessionID: 'sibling-session', callID: 'a' } as any, toolAOutput as any);
    expect(toolAOutput.output).toBe('A result');

    const toolBOutput = { output: 'B result' };
    await hooks['tool.execute.after']!({ tool: 'tool_b', sessionID: 'sibling-session', callID: 'b' } as any, toolBOutput as any);
    expect(toolBOutput.output).toContain('[Tool Search Reminder]');
  });

  describe('configurable resetTools', () => {
    it('resets session authorizations and avoids reminders for default compress tool', async () => {
      const hooks = await ToolSearchPlugin({} as any, { embedding: { enabled: false } });

      await hooks['tool.definition']!(
        { toolID: 'git_commit' },
        { description: 'Commit staged changes', parameters: {} },
      );

      // Authorize git_commit in session A
      const regexTool = (hooks.tool as any).tool_search_regex;
      await regexTool.execute({ pattern: '^git_commit$' }, { sessionID: 'sess_default_a' });

      // Before reset: git_commit executed in sess_default_a has no reminder
      const beforeGit = { output: 'Commit successful' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_default_a', callID: 'c1' } as any, beforeGit as any);
      expect(beforeGit.output).toBe('Commit successful');

      // Execute default compress tool in sess_default_a
      const compressOut = { output: 'Compaction finished' };
      await hooks['tool.execute.after']!({ tool: 'compress', sessionID: 'sess_default_a', callID: 'c2' } as any, compressOut as any);
       // Compress preserves its result and appends a deterministic model-visible reset notice.
       expect(compressOut.output).toBe('Compaction finished\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      // After reset: git_commit gets the non-blocking reminder again
      const afterGit = { output: 'Commit successful' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_default_a', callID: 'c3' } as any, afterGit as any);
      expect(afterGit.output).toContain('[Tool Search Reminder]');
    });

    it('resets session authorizations and avoids reminders for custom resetTools while maintaining additive semantics and session isolation', async () => {
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

      // Executing custom_compaction in session A should produce NO reminder
      const customResetOut = { output: 'Custom compaction done' };
      await hooks['tool.execute.after']!({ tool: 'custom_compaction', sessionID: 'sess_custom_a', callID: 'c1' } as any, customResetOut as any);
       expect(customResetOut.output).toBe('Custom compaction done\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      // Session A's git_commit should now receive the non-blocking reminder
      const afterGitA = { output: 'Commit done' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_custom_a', callID: 'c2' } as any, afterGitA as any);
      expect(afterGitA.output).toContain('[Tool Search Reminder]');

      // Session B's git_commit remains authorized (session isolation)
      const afterGitB = { output: 'Commit done' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_custom_b', callID: 'c3' } as any, afterGitB as any);
      expect(afterGitB.output).toBe('Commit done');

      // Additive check: default compress still works as reset tool in session B
      const compressOutB = { output: 'Compressed session B' };
      await hooks['tool.execute.after']!({ tool: 'compress', sessionID: 'sess_custom_b', callID: 'c4' } as any, compressOutB as any);
       expect(compressOutB.output).toBe('Compressed session B\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      // Session B git_commit gets a reminder after compress reset
      const afterCompressGitB = { output: 'Commit done' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_custom_b', callID: 'c5' } as any, afterCompressGitB as any);
      expect(afterCompressGitB.output).toContain('[Tool Search Reminder]');
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
      const gitOut = { output: 'Committed' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_non_reset', callID: 'c1' } as any, gitOut as any);
      expect(gitOut.output).toBe('Committed');

      // read_file should remain authorized
      const readOut = { output: 'File content' };
      await hooks['tool.execute.after']!({ tool: 'read_file', sessionID: 'sess_non_reset', callID: 'c2' } as any, readOut as any);
      expect(readOut.output).toBe('File content');
    });
  });
});
