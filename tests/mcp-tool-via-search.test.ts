/**
 * Verify: plugin's tool_search can discover MCP tools like context7_*
 * (which is what an LLM would do instead of calling them directly)
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Hooks, Plugin, PluginInput } from '@opencode-ai/plugin';
import { ToolSearchPlugin } from '../src/plugin.js';
import { ToolVault } from '../src/vault.js';

const MCP_TOOLS = [
  {
    id: 'context7_resolve-library-id',
    description: 'Resolves a package name to a Context7-compatible library ID',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for the library' },
        libraryName: { type: 'string', description: 'Library name to search for' },
      },
    },
  },
  {
    id: 'context7_query-docs',
    description: 'Retrieves documentation for a specific library using Context7',
    parameters: {
      type: 'object',
      properties: {
        libraryId: { type: 'string', description: 'Context7-compatible library ID' },
        query: { type: 'string', description: 'The documentation query' },
      },
    },
  },
  {
    id: 'exa_web_search_exa',
    description: 'Search the web using Exa AI',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        numResults: { type: 'number', description: 'Number of results' },
      },
    },
  },
];

function makeCtx(): PluginInput {
  return {
    client: {
      tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
        appendPrompt: vi.fn(),
        openHelp: vi.fn(),
        openSessions: vi.fn(),
        openThemes: vi.fn(),
        openModels: vi.fn(),
        showInput: vi.fn(),
        setTheme: vi.fn(),
        setMessages: vi.fn(),
        getMessages: vi.fn(),
      } as any,
    },
    project: {} as any,
    directory: '/tmp',
    worktree: '/tmp',
    experimental_workspace: { register: vi.fn() } as any,
    serverUrl: new URL('http://localhost'),
    $: {} as any,
  } as any;
}

const TOOL_CTX = {
  sessionID: 's',
  messageID: 'm',
  agent: 'a',
  directory: '/tmp',
  worktree: '/tmp',
  abort: new AbortController().signal,
  metadata: vi.fn(),
  ask: vi.fn().mockResolvedValue(undefined),
};

async function load() {
  const ctx = makeCtx();
  const hooks = (await (ToolSearchPlugin as Plugin)(ctx, {})) as Hooks;
  const defHook = hooks['tool.definition']!;
  for (const t of MCP_TOOLS) {
    await defHook(
      { toolID: t.id },
      { description: t.description, parameters: JSON.parse(JSON.stringify(t.parameters)) },
    );
  }
  const vault = new ToolVault({ embedding: { enabled: false } });
  for (const t of MCP_TOOLS) {
    vault.add(t.id, t.description, JSON.parse(JSON.stringify(t.parameters)));
  }
  return { toolSearch: (hooks.tool as any).tool_search, vault };
}

describe('tool_search discovers MCP tools', () => {
  let fx: Awaited<ReturnType<typeof load>>;
  beforeAll(async () => {
    fx = await load();
  });

  it('"context7" finds context7_resolve-library-id', async () => {
    const r = await fx.toolSearch.execute({ query: 'context7' }, TOOL_CTX);
    expect(r).toContain('context7_resolve-library-id');
  });

  it('"documentation library" finds context7_query-docs via param desc', async () => {
    const r = await fx.toolSearch.execute({ query: 'documentation library' }, TOOL_CTX);
    expect(r).toContain('context7_query-docs');
  });

  it('"exa web search" finds exa_web_search_exa', async () => {
    const r = await fx.toolSearch.execute({ query: 'exa web search' }, TOOL_CTX);
    expect(r).toContain('exa_web_search_exa');
  });

  it('"library id" finds context7_resolve-library-id via param name', async () => {
    const r = await fx.toolSearch.execute({ query: 'library id' }, TOOL_CTX);
    expect(r).toContain('context7_resolve-library-id');
  });

  it('full output (regression)', async () => {
    const r = await fx.toolSearch.execute({ query: 'context7 documentation' }, TOOL_CTX);
    console.log('\n--- tool_search("context7 documentation") ---\n' + r + '\n---');
    expect(r).toMatch(/^Found/);
  });
});
