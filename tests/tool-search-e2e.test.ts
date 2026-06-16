/**
 * True E2E test of tool_search and tool_search_regex
 *
 * Calls ToolSearchPlugin(ctx, options) → gets hooks → fires tool.definition
 * for each fixture tool → then calls tool_search.execute() and
 * tool_search_regex.execute() with REAL args as the LLM would.
 *
 * Proves every feature works end-to-end.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';

const FIXTURE_TOOLS = [
  {
    id: 'github_create_issue',
    description: 'Creates a new GitHub issue in the specified repository',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'GitHub repository name in owner/repo format' },
        title: { type: 'string', description: 'Issue title text' },
        body: { type: 'string', description: 'Issue body content in markdown format' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply to the issue' },
        filter: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by issue status: open, closed, all' },
          },
        },
      },
      required: ['repo', 'title'],
    },
  },
  {
    id: 'github_create_pr',
    description: 'Creates a pull request in a GitHub repository',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository identifier' },
        head: { type: 'string', description: 'Source branch name' },
        base: { type: 'string', description: 'Target branch name' },
      },
      required: ['repo', 'head', 'base'],
    },
  },
  {
    id: 'figma_create_shape',
    description: 'Creates a new shape in a Figma design',
    parameters: {
      type: 'object',
      properties: {
        shape: { type: 'string', description: 'Shape type: rectangle, ellipse, polygon' },
      },
    },
  },
  {
    id: 'read_file',
    description: 'Reads the contents of a file from disk',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path to the file' },
      },
      required: ['path'],
    },
  },
  {
    id: 'git_commit',
    description: 'Creates a git commit with the staged changes',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message describing the change' },
      },
      required: ['message'],
    },
  },
  {
    id: 'agentmemory_memory_action_create',
    description: 'Create a memory action',
    parameters: { type: 'object', properties: {} },
  },
];

interface PluginFixture {
  hooks: Hooks;
  ctx: PluginInput;
  toolSearch: any;
  toolSearchRegex: any;
}

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
  sessionID: 'sess1',
  messageID: 'msg1',
  agent: 'test',
  directory: '/tmp',
  worktree: '/tmp',
  abort: new AbortController().signal,
  metadata: vi.fn(),
  ask: vi.fn().mockResolvedValue(undefined),
};

async function loadPlugin(options: PluginOptions = {}): Promise<PluginFixture> {
  const ctx = makeCtx();
  const plugin = ToolSearchPlugin as Plugin;
  const hooks = await plugin(ctx, options);

  if (!hooks.tool) throw new Error('plugin returned no tool hook');
  const toolSearch = (hooks.tool as any).tool_search;
  const toolSearchRegex = (hooks.tool as any).tool_search_regex;

  const defHook = hooks['tool.definition']!;
  for (const t of FIXTURE_TOOLS) {
    const paramsClone = JSON.parse(JSON.stringify(t.parameters));
    await defHook({ toolID: t.id }, { description: t.description, parameters: paramsClone });
  }

  return { hooks, ctx, toolSearch, toolSearchRegex };
}

async function executeSearch(tool: any, args: any): Promise<string> {
  const result = await tool.execute(args, TOOL_CTX);
  return typeof result === 'string' ? result : (result as any).output;
}

function countIds(out: string): number {
  return (out.match(/^\w+:\s/gm) ?? []).length;
}

function firstId(out: string): string {
  return out.match(/^Found \d+ tool\(s\):\n\n(\w+):/m)![1];
}

describe('E2E: tool_search (BM25 path)', () => {
  let fx: PluginFixture;
  beforeAll(async () => { fx = await loadPlugin({ embedding: { enabled: false } }); });

  it('1. Returns "Found N tool(s)" header', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'github' });
    expect(out).toMatch(/^Found \d+ tool\(s\):\n\n/);
  });

  it('2. Each hit is formatted as "id: description\\n  parameters: {JSON}"', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'github' });
    const body = out.split('\n\n').slice(1).join('\n\n');
    expect(body).toMatch(/\w+:\s+.+\n  parameters: /);
  });

  it('3. Tool IDs that match "github" rank first', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'github' });
    expect(firstId(out)).toMatch(/^github/);
  });

  it('4. Param descriptions are searchable — "markdown" matches github_create_issue', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'markdown' });
    expect(out).toContain('github_create_issue');
    expect(firstId(out)).toBe('github_create_issue');
  });

  it('5. "filesystem" matches read_file via path param description', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'filesystem' });
    expect(firstId(out)).toBe('read_file');
  });

  it('6. "commit" matches git_commit (tool name match)', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'commit' });
    expect(firstId(out)).toBe('git_commit');
  });

  it('7. JSON parameters are embedded in result string', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'github issue' });
    expect(out).toContain('"repo"');
    expect(out).toContain('"title"');
    expect(out).toContain('owner/repo format');
  });

  it('8. No matches → returns prefix suggestion', async () => {
    const out = await executeSearch(fx.toolSearch, { query: 'xyzzy_unicorn_tool_42' });
    expect(out).toMatch(/^No matches\./);
    expect(out).toContain('Available prefixes:');
    expect(out).toContain('github');
    expect(out).toContain('figma');
  });

  it('9. searchLimit config caps results (re-fires defHook on new instance)', async () => {
    // Fresh plugin instance — re-fire defHook for fixtures so vault is populated
    const fresh = await loadPlugin({ embedding: { enabled: false }, searchLimit: 1 });
    for (const t of FIXTURE_TOOLS) {
      await fresh.hooks['tool.definition']!({ toolID: t.id }, {
        description: t.description,
        parameters: JSON.parse(JSON.stringify(t.parameters)),
      });
    }
    // "github" matches 2 tools (issue, pr) — limit=1 caps to 1
    const out = await executeSearch(fresh.toolSearch, { query: 'github' });
    expect(countIds(out)).toBe(1);
  });
});

describe('E2E: tool_search_regex', () => {
  let fx: PluginFixture;
  beforeAll(async () => { fx = await loadPlugin({ embedding: { enabled: false } }); });

  it('10. Returns "Found N tool(s)" header', async () => {
    const out = await executeSearch(fx.toolSearchRegex, { pattern: 'github' });
    expect(out).toMatch(/^Found \d+ tool\(s\):\n\n/);
  });

  it('11. ^github matches BOTH github_create_issue and github_create_pr', async () => {
    const out = await executeSearch(fx.toolSearchRegex, { pattern: '^github' });
    expect(out).toContain('github_create_issue');
    expect(out).toContain('github_create_pr');
    // Assert actual count of matched tools (not just presence)
    expect(countIds(out)).toBe(2);
  });

  it('12. ^figma matches only figma_create_shape', async () => {
    const out = await executeSearch(fx.toolSearchRegex, { pattern: '^figma' });
    expect(out).toContain('figma_create_shape');
    expect(out).not.toContain('github');
  });

  it('13. Union pattern "^github|^read" matches github_* AND read_file', async () => {
    const out = await executeSearch(fx.toolSearchRegex, { pattern: '^github|^read' });
    expect(out).toContain('github_create_issue');
    expect(out).toContain('github_create_pr');
    expect(out).toContain('read_file');
    expect(countIds(out)).toBe(3);
  });

  it('14. No matches → "No tools matched pattern" message', async () => {
    const out = await executeSearch(fx.toolSearchRegex, { pattern: '^unicorn_xyzzy$' });
    expect(out).toBe('No tools matched pattern "^unicorn_xyzzy$".');
  });

  it('15. Invalid regex → no crash, returns empty results', async () => {
    const out = await executeSearch(fx.toolSearchRegex, { pattern: '[unclosed' });
    expect(out).toBe('No tools matched pattern "[unclosed".');
  });

  it('16. Result includes parameters JSON in same format as tool_search', async () => {
    const out = await executeSearch(fx.toolSearchRegex, { pattern: '^github' });
    expect(out).toContain('parameters:');
    expect(out).toContain('"head"');
  });
});

describe('E2E: tool.definition hook side-effects', () => {
  it('17. Deferred tools have description replaced with [d]', async () => {
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: false } } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    const out: any = { description: 'Real description', parameters: { type: 'object', properties: { x: { type: 'string', description: 'X desc' } } } };
    await defHook({ toolID: 'some_other_tool' }, out);
    expect(out.description).toBe('[d]');
  });

  it('18. SEARCH_IDS (tool_search, tool_search_regex) are NEVER deferred', async () => {
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: false } } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    const out: any = { description: 'Real description of tool_search itself', parameters: { type: 'object', properties: { q: { type: 'string' } } } };
    await defHook({ toolID: 'tool_search' }, out);
    expect(out.description).toBe('Real description of tool_search itself');
  });

  it('19. defers top-level description but preserves parameter descriptions in place (reference preserved)', async () => {
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: false } } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    const params = { type: 'object', properties: { x: { type: 'string', description: 'Original X desc' } } };
    const out: any = { description: 'Real', parameters: params };
    await defHook({ toolID: 'other_tool' }, out);
    expect(out.description).toBe('[d]');
    // Parameter descriptions are preserved (not scrubbed — matches npm behavior)
    expect((out.parameters as any).properties.x.description).toBe('Original X desc');
    // Reference preserved — this prevents DeepSeek schema error
    expect(out.parameters).toBe(params);
  });

  it('19b. parameter descriptions are preserved at any depth (no longer scrubbed)', async () => {
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: false } } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    const params = {
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: {
            inner: {
              type: 'object',
              properties: {
                leaf: { type: 'string', description: 'Deep nested description' },
              },
            },
          },
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Item name' },
            },
          },
        },
      },
    };
    const out: any = { description: 'Real', parameters: params };
    await defHook({ toolID: 'deeply_nested_tool' }, out);
    const p = out.parameters as any;
    expect(out.description).toBe('[d]');
    // Parameter descriptions preserved at any depth
    expect(p.properties.outer.properties.inner.properties.leaf.description).toBe('Deep nested description');
    expect(p.properties.items.items.properties.name.description).toBe('Item name');
  });
});

describe('E2E: system.transform hook', () => {
  it('20. Adds "N tools loaded—M have [d]" message when deferrals > 0', async () => {
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: false } } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    for (const t of FIXTURE_TOOLS.slice(0, 2)) {
      await defHook({ toolID: t.id }, { description: t.description, parameters: JSON.parse(JSON.stringify(t.parameters)) });
    }
    const sysHook = hooks['experimental.chat.system.transform']!;
    const out: any = { system: [] };
    await sysHook({} as any, out);
    expect(out.system).toHaveLength(1);
    expect(out.system[0]).toMatch(/tools loaded.*have "\[d\]"/);
    expect(out.system[0]).toMatch(/tool_search\(\{ query: "prefix" \}\)/);
  });
});

describe('E2E: config options', () => {
  it('21. deferDescription custom label replaces [d] with user value', async () => {
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: false }, deferDescription: '[hidden]' } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    const out: any = { description: 'Real', parameters: { type: 'object', properties: { x: { type: 'string', description: 'X' } } } };
    await defHook({ toolID: 'some_tool' }, out);
    expect(out.description).toBe('[hidden]');
    // Parameter descriptions preserved (only top-level desc is scrubbed)
    expect((out.parameters as any).properties.x.description).toBe('X');
  });

  it('22. alwaysLoad exempts specific tools from [d] deferral', async () => {
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, { embedding: { enabled: false }, alwaysLoad: ['important_tool'] } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    const important: any = { description: 'Important tool desc', parameters: { type: 'object', properties: { x: { type: 'string', description: 'X desc' } } } };
    await defHook({ toolID: 'important_tool' }, important);
    expect(important.description).toBe('Important tool desc');
    expect((important.parameters as any).properties.x.description).toBe('X desc');

    const other: any = { description: 'Other desc', parameters: { type: 'object', properties: { y: { type: 'string', description: 'Y desc' } } } };
    await defHook({ toolID: 'other_tool' }, other);
    expect(other.description).toBe('[d]');
    // Parameter descriptions preserved (only top-level desc is scrubbed)
    expect((other.parameters as any).properties.y.description).toBe('Y desc');
  });

  it('23. bm25.k1 and bm25.b config are accepted and produce results', async () => {
    const fx = await loadPlugin({ embedding: { enabled: false }, bm25: { k1: 1.2, b: 0.75 } });
    const out = await executeSearch(fx.toolSearch, { query: 'github' });
    expect(out).toMatch(/^Found \d+ tool\(s\):/);
    expect(firstId(out)).toMatch(/^github/);
  });
});

describe('E2E: semantic search is default ON', () => {
  it('24. Loading plugin with NO config enables embedding by default', async () => {
    // No options → embedding should be on (default behavior in src/plugin.ts:49)
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, {} as PluginOptions);
    const defHook = hooks['tool.definition']!;
    for (const t of FIXTURE_TOOLS) {
      await defHook({ toolID: t.id }, { description: t.description, parameters: JSON.parse(JSON.stringify(t.parameters)) });
    }
    const tSearch = (hooks.tool as any).tool_search;
    // Paraphrased query — semantic search should still produce results
    const out = await executeSearch(tSearch, { query: 'create something on github' });
    expect(out).toMatch(/Found \d+ tool\(s\):/);
    expect(out).toContain('github_create_issue');
  }, 30000);

  it('25. BM25 fallback when semantic fails — broken embedding model', async () => {
    // Pass an embedding model that will fail to load
    // The plugin's try/catch (vault.ts:87-90) should fall back to BM25
    const ctx = makeCtx();
    const hooks = await (ToolSearchPlugin as Plugin)(ctx, {
      embedding: { enabled: true, model: 'nonexistent/model-that-cannot-load-xyzzy' },
    } as PluginOptions);
    const defHook = hooks['tool.definition']!;
    for (const t of FIXTURE_TOOLS) {
      await defHook({ toolID: t.id }, { description: t.description, parameters: JSON.parse(JSON.stringify(t.parameters)) });
    }
    const tSearch = (hooks.tool as any).tool_search;
    // Even with broken embedding, BM25 should kick in and return github tools
    const out = await executeSearch(tSearch, { query: 'github' });
    expect(out).toMatch(/Found \d+ tool\(s\):/);
    expect(out).toContain('github_create_issue');
  }, 30000);
});

describe('E2E: cross-references in tool descriptions', () => {
  it('26. tool_search description tells the LLM when to use tool_search_regex (and vice versa)', async () => {
    const fx = await loadPlugin({ embedding: { enabled: false } });
    expect(fx.toolSearch.description).toContain('tool_search_regex');
    expect(fx.toolSearchRegex.description).toContain('tool_search');
  });
});
