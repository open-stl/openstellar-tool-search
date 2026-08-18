import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plugin } from '../src/plugin.js';
import { ToolVault } from '../src/catalog/vault.js';
import { AuthPersistence } from '../src/engine/auth-persistence.js';
import type { PersistedToolAuthorization } from '../src/engine/auth-persistence.js';

const ToolSearchPlugin = plugin.server;

// Track SemanticMatcher instantiation
let matcherInstantiated = false;

// Mock the embedding module to avoid loading real transformer models during tests.
vi.mock('../src/catalog/matcher.js', () => ({
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

  it('exports a plugin function and v2 plugin object', () => {
    expect(typeof ToolSearchPlugin).toBe('function');
    expect(plugin.id).toBe('openstellar-tool-search');
  });

  it('stores raw parameters without JSON cloning', async () => {
    const addSpy = vi.spyOn(ToolVault.prototype, 'add');
    const hooks = await ToolSearchPlugin({} as any, { alwaysLoad: ['test_tool1'] });

    const zodLikeParams: Record<string, unknown> = {};
    Object.defineProperties(zodLikeParams, {
      type: { value: 'object', enumerable: true },
      shape: {
        value: () => ({
          name: { type: 'string', description: 'User name parameter' },
        }),
        enumerable: false,
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

    expect(addSpy.mock.calls[0][2]).toBe(zodLikeParams);
  });

  it('does not mutate original schema description getter', async () => {
    const hooks = await ToolSearchPlugin({} as any, {} as any);

    const descriptionValue = 'Original parameter description';
    const params: Record<string, unknown> = {};
    Object.defineProperty(params, 'description', {
      get() {
        return descriptionValue;
      },
      enumerable: true,
      configurable: true,
    });

    await hooks['tool.definition']!(
      { toolID: 'test_bug2' },
      { description: 'A test tool', parameters: params },
    );

    expect(Object.getOwnPropertyDescriptor(params, 'description')?.get).toBeDefined();
  });

  it('truncates descriptions to first sentence and appends [deferred] tag on tool.definition', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    const output = {
      description: 'First sentence of description. Second sentence that should be trimmed.',
      parameters: { type: 'object' },
    };
    await hooks['tool.definition']!({ toolID: 'tool_trunc' }, output);

    expect(output.description).toContain('[deferred]');
    expect(output.description).toContain('First sentence of description.');
    expect(output.description).not.toContain('Second sentence that should be trimmed.');
  });

  it('defaults to embedding enabled when no options provided', async () => {
    matcherInstantiated = false;
    await ToolSearchPlugin({} as any, {} as any);
    expect(matcherInstantiated).toBe(true);
  });

  it('registers tool_search and tool_search_regex in tool hook with disambiguated descriptions', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    expect(hooks.tool).toBeDefined();
    const tools = hooks.tool as Record<string, any>;
    expect(tools.tool_search).toBeDefined();
    expect(tools.tool_search_regex).toBeDefined();
    expect(tools.tool_search.description).toContain('capability, or semantic intent');
    expect(tools.tool_search.description).toContain('DO NOT pass space-separated lists');
    expect(tools.tool_search_regex.description).toContain('regex alternation');
    expect(tools.tool_search_regex.description).toContain('known tool ID(s)');
  });

  it('persists structured _ide authorization through a real serialized restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tool-search-auth-'));
    const previousCache = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = directory;
    try {
      const first = await ToolSearchPlugin({} as any, { mode: 'keyword' });
      await first['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
      await first['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
      await (first.tool as any).tool_search_regex.execute({ pattern: '^foo_ide$' }, { sessionID: 'disk-session' });
      await new Promise((resolve) => setTimeout(resolve, 80));

      const second = await ToolSearchPlugin({} as any, { mode: 'keyword' });
      await second['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
      await second['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
      await expect(
        second['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'disk-session' } as any, {} as any)
      ).resolves.not.toThrow();
      const output = { output: 'Real result' };
      await second['tool.execute.after']!({ tool: 'foo_ide', sessionID: 'disk-session', callID: 'disk' } as any, output as any);
      expect(output.output).toBe('Real result');
    } finally {
      if (previousCache === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousCache;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed for a legacy literal JSON structured-looking authorization after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tool-search-legacy-json-'));
    const previousCache = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = directory;
    try {
      const filePath = join(directory, 'openstellar', 'tool-search', 'authorizations.json');
      mkdirSync(join(directory, 'openstellar', 'tool-search'), { recursive: true });
      writeFileSync(filePath, JSON.stringify({ 'legacy-json-session': {
        tools: ['{"kind":"canonical-tool","version":1,"canonicalId":"foo_ide"}'],
      } }), 'utf8');
      const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
      await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
      await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
      await expect(
        hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'legacy-json-session' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');
    } finally {
      if (previousCache === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousCache;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('migrates legacy ambiguous _ide authorization to canonical object form after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tool-search-legacy-'));
    const previousCache = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = directory;
    try {
      const filePath = join(directory, 'openstellar', 'tool-search', 'authorizations.json');
      const writeLegacy = (tool: string) => {
        mkdirSync(join(directory, 'openstellar', 'tool-search'), { recursive: true });
        writeFileSync(filePath, JSON.stringify({ 'legacy-session': { tools: [tool] } }), 'utf8');
      };
      for (const legacyTool of ['foo_ide', '@canonical:foo_ide']) {
        writeLegacy(legacyTool);
        const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
        await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
        await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
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

    const first = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await first['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await first['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    await (first.tool as any).tool_search_regex.execute({ pattern: '^foo_ide$' }, { sessionID: 'restart-session' });
    expect(Array.from(authorizations.get('restart-session') ?? []).some((entry: any) => entry && typeof entry === 'object' && entry.kind === 'canonical-tool' && entry.version === 1 && entry.canonicalId === 'foo_ide')).toBe(true);

    const second = await ToolSearchPlugin({} as any, { mode: 'keyword' });
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

    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo ide', parameters: {} });
    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID: 'legacy-session' } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('documents precise canonical tool policy guidance with batch regex alternation', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'policy_tool' }, { description: 'Policy tool', parameters: {} });
    const output = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']!({ sessionID: 'policy-session' } as any, output as any);
    const text = output.system.join('\n');
    expect(text).toContain('canonical ID');
    expect(text).not.toContain('alias');
    expect(text).toContain('tool_search_regex');
    expect(text).toMatch(/known.*tool.*ID|tool.*ID.*known/i);
    expect(text).toContain('regex alternation');
    expect(text).toContain('^(toolA|toolB|toolC)$');
  });

  it('rejects unsearched deferred tools with strict tool_search_regex prescription without or tool_search dilution', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'unsearched_tool' }, { description: 'Deferred unsearched tool', parameters: {} });
    await expect(
      hooks['tool.execute.before']!({ tool: 'unsearched_tool', sessionID: 'strict-error-session' } as any, {} as any)
    ).rejects.toThrow(
      '[Tool Search Required] Tool "unsearched_tool" has not been searched in session "strict-error-session". Call tool_search_regex({ pattern: "^unsearched_tool$" }) to inspect full description and parameter schema before calling this tool.'
    );
  });

  it('does not authorize a real tool after searching another canonical tool', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
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
      const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
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

      // 3. Intervening unauthorized tool execution should throw [Tool Search Required]
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

      // 6. After compress reset, skill requires search again
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
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
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
      const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });

      await hooks['tool.definition']!(
        { toolID: 'git_commit' },
        { description: 'Commit staged changes', parameters: {} },
      );

      const regexTool = (hooks.tool as any).tool_search_regex;
      await regexTool.execute({ pattern: '^git_commit$' }, { sessionID: 'sess_default_a' });

      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_default_a' } as any, {} as any)
      ).resolves.not.toThrow();
      const beforeGit = { output: 'Commit successful' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_default_a', callID: 'c1' } as any, beforeGit as any);
      expect(beforeGit.output).toBe('Commit successful');

      const compressOut = { output: 'Compaction finished' };
      await hooks['tool.execute.after']!({ tool: 'compress', sessionID: 'sess_default_a', callID: 'c2' } as any, compressOut as any);
      expect(compressOut.output).toBe('Compaction finished\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_default_a' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');
    });

    it('resets session authorizations for custom resetTools while maintaining additive semantics and session isolation', async () => {
      const hooks = await ToolSearchPlugin({} as any, {
        mode: 'keyword',
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
      await regexTool.execute({ pattern: '^git_commit$' }, { sessionID: 'sess_custom_a' });
      await regexTool.execute({ pattern: '^git_commit$' }, { sessionID: 'sess_custom_b' });

      const customResetOut = { output: 'Custom compaction done' };
      await hooks['tool.execute.after']!({ tool: 'custom_compaction', sessionID: 'sess_custom_a', callID: 'c1' } as any, customResetOut as any);
      expect(customResetOut.output).toBe('Custom compaction done\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_custom_a' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');

      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_custom_b' } as any, {} as any)
      ).resolves.not.toThrow();
      const afterGitB = { output: 'Commit done' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_custom_b', callID: 'c3' } as any, afterGitB as any);
      expect(afterGitB.output).toBe('Commit done');

      const compressOutB = { output: 'Compressed session B' };
      await hooks['tool.execute.after']!({ tool: 'compress', sessionID: 'sess_custom_b', callID: 'c4' } as any, compressOutB as any);
      expect(compressOutB.output).toBe('Compressed session B\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.');

      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_custom_b' } as any, {} as any)
      ).rejects.toThrow('[Tool Search Required]');
    });

    it('does not reset authorizations when a non-reset tool executes', async () => {
      const hooks = await ToolSearchPlugin({} as any, {
        mode: 'keyword',
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

      await expect(
        hooks['tool.execute.before']!({ tool: 'git_commit', sessionID: 'sess_non_reset' } as any, {} as any)
      ).resolves.not.toThrow();
      const gitOut = { output: 'Committed' };
      await hooks['tool.execute.after']!({ tool: 'git_commit', sessionID: 'sess_non_reset', callID: 'c1' } as any, gitOut as any);
      expect(gitOut.output).toBe('Committed');

      await expect(
        hooks['tool.execute.before']!({ tool: 'read_file', sessionID: 'sess_non_reset' } as any, {} as any)
      ).resolves.not.toThrow();
      const readOut = { output: 'File content' };
      await hooks['tool.execute.after']!({ tool: 'read_file', sessionID: 'sess_non_reset', callID: 'c2' } as any, readOut as any);
      expect(readOut.output).toBe('File content');
    });
  });

  it('resolves _ide cloaked tool via search and allows execution', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'bash' }, { description: 'Execute bash command', parameters: {} });

    const sessionID = 'cloak-test-1';
    const regexTool = (hooks.tool as any).tool_search_regex;

    const result = await regexTool.execute({ pattern: '^bash_ide$' }, { sessionID });
    expect(result).toContain('bash');
    expect(result).toContain('Found 1 tool');

    await expect(
      hooks['tool.execute.before']!({ tool: 'bash_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('does not allow _ide variant when only canonical name was authorized for a different tool', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'bash' }, { description: 'Execute bash', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'read' }, { description: 'Read file', parameters: {} });

    const sessionID = 'cloak-isolation-1';
    const regexTool = (hooks.tool as any).tool_search_regex;

    await regexTool.execute({ pattern: '^bash_ide$' }, { sessionID });

    await expect(
      hooks['tool.execute.before']!({ tool: 'read_ide', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  it('real _ide canonical tool is not confused with cloaked alias', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Real foo_ide tool', parameters: {} });

    const sessionID = 'real-ide-canon-1';
    const regexTool = (hooks.tool as any).tool_search_regex;

    await regexTool.execute({ pattern: '^foo_ide$' }, { sessionID });

    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();

    await expect(
      hooks['tool.execute.before']!({ tool: 'foo', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  it('F2 regression: foo_ide is not falsely exempted when foo is alwaysOn', async () => {
    const hooks = await ToolSearchPlugin({} as any, {
      mode: 'keyword',
      alwaysLoad: ['foo'],
    });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'foo_ide' }, { description: 'Separate foo_ide tool', parameters: {} });

    const sessionID = 'f2-regression-session';

    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');

    const regexTool = (hooks.tool as any).tool_search_regex;
    await regexTool.execute({ pattern: '^foo_ide$' }, { sessionID });

    await expect(
      hooks['tool.execute.before']!({ tool: 'foo_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('blocks malformed/double-cloaked ID bash_ide_ide when base tool bash is deferred and unauthorized', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'bash' }, { description: 'Execute bash command', parameters: {} });

    const sessionID = 'double-cloak-session';

    await expect(
      hooks['tool.execute.before']!({ tool: 'bash_ide_ide', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');

    const regexTool = (hooks.tool as any).tool_search_regex;
    await regexTool.execute({ pattern: '^bash$' }, { sessionID });

    await expect(
      hooks['tool.execute.before']!({ tool: 'bash_ide_ide', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('tool_search_regex({ pattern: "_ide" }) returns only exact regex matches and does not act as wildcard', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'read' }, { description: 'Read file', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'write' }, { description: 'Write file', parameters: {} });

    const sessionID = 'wildcard-test-session';
    const regexTool = (hooks.tool as any).tool_search_regex;

    const result = await regexTool.execute({ pattern: '_ide' }, { sessionID });
    expect(result).toContain('No tools matched pattern "_ide"');

    await expect(
      hooks['tool.execute.before']!({ tool: 'read', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
    await expect(
      hooks['tool.execute.before']!({ tool: 'write', sessionID } as any, {} as any)
    ).rejects.toThrow('[Tool Search Required]');
  });

  // Delivery history and no-op discovery tests
  it('returns No-Op Discovery response when all results are delivered and authorized (rule 36)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'bar' }, { description: 'Canonical bar', parameters: {} });

    const sessionID = 'noop-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const firstResult = await searchTool.execute({ pattern: '^foo$|^bar$' }, { sessionID });
    expect(firstResult).toContain('Found 2 tool(s)');
    expect(firstResult).toContain('foo');
    expect(firstResult).toContain('bar');

    const secondResult = await searchTool.execute({ pattern: '^foo$|^bar$' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');
    expect(secondResult).toContain('foo');
    expect(secondResult).toContain('bar');
  });

  it('returns unauthorized delivered tool again when authorization was reset (rule 41)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'reauth-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const firstResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');

    const secondResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');

    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    const thirdResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(thirdResult).toContain('Found 1 tool(s)');
    expect(thirdResult).toContain('foo');

    await expect(
      hooks['tool.execute.before']!({ tool: 'foo', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('delivers only new results and applies limit after filtering (rules 32-33)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword', maxResults: 2 });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'bar' }, { description: 'Canonical bar', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'baz' }, { description: 'Canonical baz', parameters: {} });

    const sessionID = 'limit-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const firstResult = await searchTool.execute({ pattern: '^foo$|^bar$|^baz$' }, { sessionID });
    expect(firstResult).toContain('Found 2 tool(s)');
    expect(firstResult).toContain('foo');
    expect(firstResult).toContain('bar');

    const secondResult = await searchTool.execute({ pattern: '^foo$|^bar$|^baz$' }, { sessionID });
    expect(secondResult).toContain('Found 1 tool(s)');
    expect(secondResult).toContain('baz');
    expect(secondResult).not.toContain('foo:');
    expect(secondResult).not.toContain('bar:');
  });

  it('no-match search does not record in delivery history (rule 37)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'nomatch-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const noMatchResult = await searchTool.execute({ pattern: '^nonexistent$' }, { sessionID });
    expect(noMatchResult).toContain('No tools matched');

    const searchResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(searchResult).toContain('Found 1 tool(s)');
    expect(searchResult).toContain('foo');
  });

  it('compaction clears delivery history (rule 42)', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'compact-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const firstResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');

    const secondResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');

    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    const thirdResult = await searchTool.execute({ pattern: '^foo$' }, { sessionID });
    expect(thirdResult).toContain('Found 1 tool(s)');
    expect(thirdResult).toContain('foo');
  });

  it('tool_search also applies delivery history filtering', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'foo' }, { description: 'Canonical foo', parameters: {} });

    const sessionID = 'ts-session';
    const searchTool = (hooks.tool as any).tool_search;

    const firstResult = await searchTool.execute({ query: 'Canonical' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');

    const secondResult = await searchTool.execute({ query: 'Canonical' }, { sessionID });
    expect(secondResult).toContain('No new tools discovered');
  });

  it('F5: re-auth path limits results to maxResults when many tools lose auth simultaneously', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword', maxResults: 3 });
    for (let i = 1; i <= 5; i++) {
      await hooks['tool.definition']!({ toolID: `tool${i}` }, { description: `Tool ${i}`, parameters: {} });
    }

    const sessionID = 'f5-limit-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const firstResult = await searchTool.execute({ pattern: '^tool[123]$' }, { sessionID });
    expect(firstResult).toContain('Found 3 tool(s)');

    const secondResult = await searchTool.execute({ pattern: '^tool[45]$' }, { sessionID });
    expect(secondResult).toContain('Found 2 tool(s)');

    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    const thirdResult = await searchTool.execute({ pattern: '^tool' }, { sessionID });
    expect(thirdResult).toContain('Found 3 tool(s)');
    expect(thirdResult).toContain('tool1');

    await expect(
      hooks['tool.execute.before']!({ tool: 'tool1', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('applies default maxResults of 5 when unspecified', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    for (let i = 1; i <= 8; i++) {
      await hooks['tool.definition']!({ toolID: `default_tool_${i}` }, { description: `Default Tool ${i}`, parameters: {} });
    }

    const sessionID = 'default-maxresults-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const result = await searchTool.execute({ pattern: '^default_tool_' }, { sessionID });
    expect(result).toContain('Found 5 tool(s)');
  });

  it('returns and authorizes both new tools and previously delivered but unauthorized tools', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await hooks['tool.definition']!({ toolID: 'tool_a' }, { description: 'Tool A', parameters: {} });
    await hooks['tool.definition']!({ toolID: 'tool_b' }, { description: 'Tool B', parameters: {} });

    const sessionID = 'mixed-delivery-session';
    const searchTool = (hooks.tool as any).tool_search_regex;

    const firstResult = await searchTool.execute({ pattern: '^tool_a$' }, { sessionID });
    expect(firstResult).toContain('Found 1 tool(s)');
    expect(firstResult).toContain('tool_a');

    await hooks['tool.execute.after']!({ tool: 'compress', sessionID, callID: 'c1' } as any, { output: 'compressed' } as any);

    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_a', sessionID } as any, {} as any)
    ).rejects.toThrow();

    const secondResult = await searchTool.execute({ pattern: '^tool_' }, { sessionID });
    expect(secondResult).toContain('Found 2 tool(s)');
    expect(secondResult).toContain('tool_a');
    expect(secondResult).toContain('tool_b');

    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_a', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
    await expect(
      hooks['tool.execute.before']!({ tool: 'tool_b', sessionID } as any, {} as any)
    ).resolves.not.toThrow();
  });

  it('transforms messages and handles sleev compression synchronization', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    const messages = [
      { info: { sessionID: 'sess-sync' }, role: 'user', content: '<sleev-id-compressed>old prompt</sleev-id-compressed>' },
    ];
    await expect(
      hooks['experimental.chat.messages.transform']!({} as any, { messages } as any)
    ).resolves.not.toThrow();
  });

  it('handles session compacting lifecycle hook', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    const output = { context: [] as string[] };
    await hooks['experimental.session.compacting']!({ sessionID: 'sess-comp' } as any, output as any);
    expect(output.context.length).toBeGreaterThan(0);
    expect(output.context[0]).toContain('tool');
  });

  it('handles session.deleted event and other event types', async () => {
    const hooks = await ToolSearchPlugin({} as any, { mode: 'keyword' });
    await expect(
      hooks.event!({ event: { type: 'session.deleted', properties: { sessionID: 'sess-del' } } } as any)
    ).resolves.not.toThrow();
    await expect(
      hooks.event!({ event: { type: 'chat.message' } } as any)
    ).resolves.not.toThrow();
  });
});
