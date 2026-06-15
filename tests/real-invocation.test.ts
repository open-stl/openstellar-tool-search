/**
 * REAL INVOCATIONS of tool_search and tool_search_regex against
 * categorized query quality: correct, 50% correct, wrong, 10% correct.
 *
 * This is what the LLM actually sees — full plugin execute() path with
 * real fixtures, real hooks, real output strings. Captures stdout so
 * you can see what each path returns for each query category.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';
import { ToolVault } from '../src/vault.js';

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

function makeCtx(): PluginInput {
  return {
    client: { tui: { showToast: vi.fn().mockResolvedValue(undefined) } },
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

async function loadPlugin(options: PluginOptions = {}): Promise<{
  vault: ToolVault;
  toolSearch: any;
  toolSearchRegex: any;
}> {
  const ctx = makeCtx();
  const plugin = ToolSearchPlugin as Plugin;
  const hooks = (await plugin(ctx, options)) as Hooks;

  const defHook = hooks['tool.definition']!;
  for (const t of FIXTURE_TOOLS) {
    const paramsClone = JSON.parse(JSON.stringify(t.parameters));
    await defHook({ toolID: t.id }, { description: t.description, parameters: paramsClone });
  }

  const vault = new ToolVault({ embedding: { enabled: false } });
  for (const t of FIXTURE_TOOLS) {
    vault.add(t.id, t.description, JSON.parse(JSON.stringify(t.parameters)));
  }

  return {
    vault,
    toolSearch: (hooks.tool as any).tool_search,
    toolSearchRegex: (hooks.tool as any).tool_search_regex,
  };
}

async function exec(tool: any, args: any): Promise<string> {
  const r = await tool.execute(args, TOOL_CTX);
  return typeof r === 'string' ? r : (r as any).output;
}

function firstIds(out: string, n = 3): string[] {
  return (out.match(/^(\w+):/gm) ?? []).slice(0, n).map((m) => m.replace(':', ''));
}

function summarize(out: string): string {
  if (out.startsWith('No matches')) return 'NO MATCH';
  if (out.startsWith('No tools matched')) return 'NO MATCH (regex)';
  const ids = firstIds(out, 3);
  return `Found: ${ids.join(', ')}`;
}

describe('REAL tool_search invocations — query quality stress test', () => {
  let fx: Awaited<ReturnType<typeof loadPlugin>>;

  beforeAll(async () => {
    fx = await loadPlugin({ embedding: { enabled: false } });
  });

  describe('CORRECT queries (exact keywords)', () => {
    it.each([
      ['create github issue', 'github_create_issue'],
      ['create pull request', 'github_create_pr'],
      ['create figma shape', 'figma_create_shape'],
      ['read file', 'read_file'],
      ['git commit', 'git_commit'],
      ['create memory action', 'agentmemory_memory_action_create'],
    ])('"%s" → first hit is %s', async (q, expected) => {
      const out = await exec(fx.toolSearch, { query: q });
      expect(firstIds(out, 1)).toEqual([expected]);
    });
  });

  describe('50% CORRECT queries (typos / word order)', () => {
    it.each([
      ['githhub issue', 'typo: githhub'],
      ['issue github create', 'word order reversed'],
      ['figama shape', 'typo: figama'],
      ['comit', 'typo: comit'],
    ])('"%s" (%s)', async (q, label) => {
      const out = await exec(fx.toolSearch, { query: q });
      console.log(`[50%] "${q}" (${label}) → ${summarize(out)}`);
      expect(out).toMatch(/^(Found|No matches)/);
    });
  });

  describe('WRONG queries (unrelated domain)', () => {
    it.each([['quantum physics entanglement'], ['scone recipe buttermilk']])(
      '"%s" → no match',
      async (q) => {
        const out = await exec(fx.toolSearch, { query: q });
        expect(out).toMatch(/^No matches\./);
        expect(out).toContain('Available prefixes:');
      },
    );
  });

  describe('10% CORRECT queries (loose paraphrase / synonym)', () => {
    it.each([
      ['remember something', 'memory action?'],
      ['draw rectangle', 'figma create shape?'],
      ['send changes upstream', 'git commit / pr?'],
      ['look at file', 'read file?'],
    ])('"%s" (%s)', async (q, label) => {
      const out = await exec(fx.toolSearch, { query: q });
      console.log(`[10%] "${q}" (${label}) → ${summarize(out)}`);
      expect(out).toMatch(/^(Found|No matches)/);
    });
  });

  describe('COMPARISON: tool_search vs tool_search_regex', () => {
    const queries: Array<[string, string]> = [
      ['github', 'real token'],
      ['figma', 'real token'],
      ['create', 'generic word'],
      ['ghitub', 'typo'],
    ];

    for (const [q, label] of queries) {
      it(`"${q}" (${label})`, async () => {
        const searchOut = await exec(fx.toolSearch, { query: q });
        const regexOut = await exec(fx.toolSearchRegex, { pattern: q });
        const directGrep = fx.vault.grep(q, 10).map((t) => t.id);

        console.log(
          `\n[${label}] query="${q}"\n` +
            `  tool_search:        ${summarize(searchOut)}\n` +
            `  tool_search_regex:  ${summarize(regexOut)}\n` +
            `  direct vault.grep:  [${directGrep.join(', ')}]`,
        );

        expect(searchOut).toMatch(/^(Found|No matches)/);
        expect(regexOut).toMatch(/^(Found|No tools matched)/);
      });
    }
  });

  describe('REGRESSION — full LLM output capture (printf evidence)', () => {
    it('CORRECT: "create github issue"', async () => {
      const out = await exec(fx.toolSearch, { query: 'create github issue' });
      console.log('\n--- CORRECT ---\n' + out + '\n---');
      expect(out).toMatch(/^Found/);
    });

    it('50% typo: "githhub issue"', async () => {
      const out = await exec(fx.toolSearch, { query: 'githhub issue' });
      console.log('\n--- 50% TYPO ---\n' + out + '\n---');
      expect(out).toMatch(/^(Found|No matches)/);
    });

    it('10% paraphrase: "draw rectangle"', async () => {
      const out = await exec(fx.toolSearch, { query: 'draw rectangle' });
      console.log('\n--- 10% PARAPHRASE ---\n' + out + '\n---');
      expect(out).toMatch(/^(Found|No matches)/);
    });

    it('WRONG: "quantum physics"', async () => {
      const out = await exec(fx.toolSearch, { query: 'quantum physics' });
      console.log('\n--- WRONG ---\n' + out + '\n---');
      expect(out).toMatch(/^No matches/);
    });
  });
});
