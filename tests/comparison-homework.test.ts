import { describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';
import { ToolVault } from '../src/vault.js';
import { SemanticMatcher } from '../src/matcher.js';

// Keep public integration checks and internal BM25 checks independent of model loading.
vi.spyOn(SemanticMatcher.prototype, 'index').mockResolvedValue(undefined);
vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());

const FIXTURE_TOOLS = [
  { id: 'github_create_issue', description: 'Creates a new GitHub issue in the specified repository', parameters: { type: 'object', properties: { body: { type: 'string', description: 'Issue body in markdown' } } } },
  { id: 'github_create_pr', description: 'Creates a pull request in a GitHub repository', parameters: { type: 'object', properties: { base: { type: 'string', description: 'Target branch' } } } },
  { id: 'figma_create_shape', description: 'Creates a new shape in a Figma design', parameters: { type: 'object', properties: { shape: { type: 'string', description: 'Shape type' } } } },
  { id: 'read_file', description: 'Reads the contents of a file from disk', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Filesystem path' } } } },
  { id: 'git_commit', description: 'Creates a git commit with staged changes', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Commit message' } } } },
];

function makeVault(): ToolVault {
  const vault = new ToolVault({ embedding: { enabled: false } });
  for (const tool of FIXTURE_TOOLS) vault.add(tool.id, tool.description, tool.parameters);
  return vault;
}

function makeCtx(): PluginInput {
  return { client: { tui: { showToast: vi.fn().mockResolvedValue(undefined) } }, project: {} as any, directory: '/tmp', worktree: '/tmp', experimental_workspace: { register: vi.fn() }, serverUrl: new URL('http://localhost'), $: {} as any };
}

const TOOL_CTX = { sessionID: 'comparison', messageID: 'message', agent: 'test', directory: '/tmp', worktree: '/tmp', abort: new AbortController().signal, metadata: vi.fn(), ask: vi.fn().mockResolvedValue(undefined) };

async function pluginTools() {
  const hooks = await (ToolSearchPlugin as Plugin)(makeCtx(), {});
  for (const tool of FIXTURE_TOOLS) await hooks['tool.definition']!({ toolID: tool.id }, { description: tool.description, parameters: tool.parameters });
  return { search: (hooks.tool as any).tool_search, regex: (hooks.tool as any).tool_search_regex };
}

async function execute(tool: any, args: any): Promise<string> {
  const result = await tool.execute(args, TOOL_CTX);
  return typeof result === 'string' ? result : result.output;
}

function firstId(output: string): string | undefined {
  return output.match(/^Found \d+ tool\(s\):\n\n(\w+):/m)?.[1];
}

describe('comparison: public plugin integration', () => {
  it('returns usable natural-language and regex results without ranking controls', async () => {
    const tools = await pluginTools();
    const natural = await execute(tools.search, { query: 'github issue' });
    const regex = await execute(tools.regex, { pattern: '^github_' });
    expect(natural).toMatch(/^Found \d+ tool\(s\):/);
    expect(natural).toContain('github_create_issue');
    expect(regex).toContain('github_create_issue');
  });

  it('does not assert a semantic winner through the public plugin seam', async () => {
    const tools = await pluginTools();
    const output = await execute(tools.search, { query: 'make something for a repository' });
    expect(output).toMatch(/^Found \d+ tool\(s\):|^No matches for/);
    if (output.startsWith('Found')) expect(FIXTURE_TOOLS.map((tool) => tool.id)).toContain(firstId(output));
  });
});

describe('comparison: deterministic internal BM25 seam', () => {
  it('checks deterministic lexical ordering directly through ToolVault', () => {
    const vault = makeVault();
    expect(vault.queryBM25('github issue', 3).map((tool) => tool.id)[0]).toBe('github_create_issue');
    expect(vault.queryBM25('commit', 3).map((tool) => tool.id)[0]).toBe('git_commit');
  });

  it('keeps regex matching deterministic at the vault layer', () => {
    expect(makeVault().grep('^github_', 5).map((tool) => tool.id)).toEqual(['github_create_issue', 'github_create_pr']);
  });
});

describe('comparison: semantic fallback internal seam', () => {
  it('falls back to BM25 when semantic locate returns no scores', async () => {
    const locate = vi.spyOn(SemanticMatcher.prototype, 'locate').mockResolvedValue(new Map());
    const results = await makeSemanticVault().query('github', 3);
    expect(results.map((tool) => tool.id)).toContain('github_create_issue');
    locate.mockRestore();
  });
});

function makeSemanticVault(): ToolVault {
  const vault = new ToolVault({ embedding: { enabled: true } });
  for (const tool of FIXTURE_TOOLS) vault.add(tool.id, tool.description, tool.parameters);
  return vault;
}
