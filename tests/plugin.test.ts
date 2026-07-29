import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolSearchPlugin } from '../src/plugin.js';
import { SemanticMatcher } from '../src/matcher.js';

// Plugin tests exercise BM25 and authorization behavior; avoid loading the model.
vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());

const ctx = { client: { tui: { showToast: vi.fn().mockResolvedValue(undefined) } } } as any;
const call = (tool: string, sessionID: string) => ({ tool, sessionID, callID: 'call' }) as any;

async function define(hooks: any, id: string) {
  await hooks['tool.definition']!({ toolID: id }, { description: `Description for ${id}`, parameters: {} });
}

async function before(hooks: any, tool: string, sessionID: string) {
  return hooks['tool.execute.before']!(call(tool, sessionID));
}

describe('ToolSearchPlugin authorization enforcement', () => {
  it('rejects unauthorized deferred tools in before-hook and permits after successful search', async () => {
    const hooks = await ToolSearchPlugin(ctx, {});
    await define(hooks, 'deferred_tool');
    await expect(before(hooks, 'deferred_tool', 's')).rejects.toThrow('The tool ID is already known, so run tool_search_regex({ pattern: "^deferred_tool$" }) successfully first');
    await (hooks.tool as any).tool_search_regex.execute({ pattern: '^deferred_tool$' }, { sessionID: 's' });
    await expect(before(hooks, 'deferred_tool', 's')).resolves.toBeUndefined();
  });

  it('requires discovery for configured reset tools before resetting authorization', async () => {
    const hooks = await ToolSearchPlugin(ctx, { alwaysLoad: ['always_tool'], resetTools: ['reset_tool'] });
    await define(hooks, 'always_tool');
    await define(hooks, 'reset_tool');
    await expect(before(hooks, 'tool_search', 's')).resolves.toBeUndefined();
    await expect(before(hooks, 'tool_search_regex', 's')).resolves.toBeUndefined();
    await expect(before(hooks, 'always_tool', 's')).resolves.toBeUndefined();
    await expect(before(hooks, 'reset_tool', 's')).rejects.toThrow('run tool_search_regex({ pattern: "^reset_tool$" }) successfully first');

    await (hooks.tool as any).tool_search_regex.execute({ pattern: '^reset_tool$' }, { sessionID: 's' });
    await expect(before(hooks, 'reset_tool', 's')).resolves.toBeUndefined();
    await (hooks.tool as any).tool_search_regex.execute({ pattern: '^always_tool$' }, { sessionID: 's' });
    await expect(before(hooks, 'always_tool', 's')).resolves.toBeUndefined();

    const output = { output: 'reset done' };
    await hooks['tool.execute.after']!(call('reset_tool', 's'), output);
    expect(output.output).toContain('Deferred tool authorizations have been reset');
    await expect(before(hooks, 'always_tool', 's')).resolves.toBeUndefined();
    await expect(before(hooks, 'reset_tool', 's')).rejects.toThrow();
  });

  it('requires discovery before compress and resets authorization after successful compression', async () => {
    const hooks = await ToolSearchPlugin(ctx, {});
    await define(hooks, 'compress');
    await define(hooks, 'deferred_tool');

    await expect(before(hooks, 'compress', 's')).rejects.toThrow('run tool_search_regex({ pattern: "^compress$" }) successfully first');
    await (hooks.tool as any).tool_search_regex.execute({ pattern: '^compress$' }, { sessionID: 's' });
    await expect(before(hooks, 'compress', 's')).resolves.toBeUndefined();

    const output = { output: 'compressed' };
    await hooks['tool.execute.after']!(call('compress', 's'), output);
    expect(output.output).toContain('Deferred tool authorizations have been reset');
    await expect(before(hooks, 'compress', 's')).rejects.toThrow();
  });

  it('reset tools and compaction revoke permission', async () => {
    const hooks = await ToolSearchPlugin(ctx, { resetTools: ['reset_tool'] });
    await define(hooks, 'deferred_tool');
    const search = (hooks.tool as any).tool_search_regex;
    await search.execute({ pattern: '^deferred_tool$' }, { sessionID: 's' });
    await expect(before(hooks, 'deferred_tool', 's')).resolves.toBeUndefined();
    await hooks['tool.execute.after']!(call('reset_tool', 's'), { output: 'done' });
    await expect(before(hooks, 'deferred_tool', 's')).rejects.toThrow();
    await search.execute({ pattern: '^deferred_tool$' }, { sessionID: 's' });
    await hooks['experimental.session.compacting']!({ sessionID: 's' }, { context: [] });
    await expect(before(hooks, 'deferred_tool', 's')).rejects.toThrow();
  });

  it('uses distinct default result limits for natural-language and regex search', async () => {
    const hooks = await ToolSearchPlugin(ctx, {});
    for (let index = 0; index < 6; index += 1) await define(hooks, `common_tool_${index}`);

    const natural = await (hooks.tool as any).tool_search.execute({ query: 'common' }, { sessionID: 'defaults' });
    const regex = await (hooks.tool as any).tool_search_regex.execute({ pattern: 'common_tool' }, { sessionID: 'defaults' });
    expect(natural).toContain('Found 3 tool(s):');
    expect(regex).toContain('Found 5 tool(s):');
  });

  it('retains authorization across plugin restart and rejects unsafe legacy encodings', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tool-search-plugin-'));
    const previous = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = directory;
    try {
      const first = await ToolSearchPlugin(ctx, {});
      await define(first, 'restart_tool');
      await (first.tool as any).tool_search_regex.execute({ pattern: '^restart_tool$' }, { sessionID: 's' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const persistedPath = join(directory, 'opencode', 'tool-search', 'authorizations.json');
      expect(readFileSync(persistedPath, 'utf8')).toContain('restart_tool');
      const second = await ToolSearchPlugin(ctx, {});
      await define(second, 'restart_tool');
      await expect(before(second, 'restart_tool', 's')).resolves.toBeUndefined();
      const path = join(directory, 'opencode', 'tool-search', 'authorizations.json');
      mkdirSync(join(directory, 'opencode', 'tool-search'), { recursive: true });
      writeFileSync(path, JSON.stringify({ unsafe: { tools: ['@canonical:restart_tool', 'restart_tool_ide'] } }));
      const third = await ToolSearchPlugin(ctx, {});
      await define(third, 'restart_tool_ide');
      await expect(before(third, 'restart_tool_ide', 'unsafe')).rejects.toThrow();
      expect(JSON.parse(readFileSync(path, 'utf8')).unsafe.tools).toHaveLength(2);
    } finally {
      if (previous === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
