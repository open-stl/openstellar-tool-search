import { describe, expect, it, vi, afterEach } from 'vitest';
import { setupV2 } from '../src/v2/setup.js';
import { ToolSearchPlugin } from '../src/plugin.js';

// Mock the embedding module to avoid loading real transformer models during tests.
vi.mock('../src/catalog/matcher.js', () => ({
  SemanticMatcher: class {
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

function createMockV2Context() {
  const transformCallbacks: Array<(registry: any) => void> = [];
  const toolHooks: Record<string, Function[]> = {};
  const sessionHooks: Record<string, Function[]> = {};
  const eventSubscribers: Function[] = [];

  const ctx = {
    client: {
      tui: {
        showToast: vi.fn(async () => {}),
      },
    },
    tool: {
      transform: vi.fn((cb: (registry: any) => void) => {
        transformCallbacks.push(cb);
      }),
      hook: vi.fn((name: string, fn: Function) => {
        if (!toolHooks[name]) toolHooks[name] = [];
        toolHooks[name].push(fn);
      }),
    },
    session: {
      hook: vi.fn((name: string, fn: Function) => {
        if (!sessionHooks[name]) sessionHooks[name] = [];
        sessionHooks[name].push(fn);
      }),
    },
    event: {
      subscribe: vi.fn((fn: Function) => {
        eventSubscribers.push(fn);
      }),
    },
  };

  return {
    ctx,
    transformCallbacks,
    toolHooks,
    sessionHooks,
    eventSubscribers,
  };
}

describe('OpenCode 2.0 setupV2', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is exposed as ToolSearchPlugin.setup', () => {
    expect(typeof ToolSearchPlugin.setup).toBe('function');
    expect(ToolSearchPlugin.setup).toBe(setupV2);
    expect(ToolSearchPlugin.id).toBe('openstellar-tool-search');
  });

  it('registers tool_search and tool_search_regex with codemode: false and valid schemas', async () => {
    const { ctx, transformCallbacks } = createMockV2Context();
    await setupV2(ctx, {});

    expect(transformCallbacks.length).toBe(1);
    const addedTools: any[] = [];
    const mockRegistry = {
      add: vi.fn((toolDef: any) => {
        addedTools.push(toolDef);
      }),
    };

    transformCallbacks[0](mockRegistry);
    expect(addedTools.length).toBe(2);

    const searchTool = addedTools.find((t) => t.name === 'tool_search');
    expect(searchTool).toBeDefined();
    expect(searchTool.options).toEqual({ codemode: false });
    expect(searchTool.input).toEqual({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Semantic capability or task description (e.g. "search code AST", "fetch web page").',
        },
      },
      required: ['query'],
    });
    expect(typeof searchTool.execute).toBe('function');

    const regexTool = addedTools.find((t) => t.name === 'tool_search_regex');
    expect(regexTool).toBeDefined();
    expect(regexTool.options).toEqual({ codemode: false });
    expect(regexTool.input).toEqual({
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Anchored regex for exact ID: "^id$", multiple IDs: "^(toolA|toolB)$", or prefix: "^prefix_".',
        },
      },
      required: ['pattern'],
    });
    expect(typeof regexTool.execute).toBe('function');
  });

  it('enforces authorization on execute.before and supports search tool bypass', async () => {
    const { ctx, transformCallbacks, toolHooks, sessionHooks } = createMockV2Context();
    await setupV2(ctx, {});

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    const sessionCtx = {
      sessionID: 'ses-1',
      system: [] as string[],
      messages: [],
      tools: {
        git_diff: {
          description: 'Show git diff between commits. Very useful tool.',
          input: {
            type: 'object',
            properties: {
              target: { type: 'string' },
            },
            required: ['target'],
          },
        },
      },
    };

    // Register tool via session context hook
    await sessionHooks['context'][0](sessionCtx);

    // execute.before for tool_search passes
    const beforeHook = toolHooks['execute.before'][0];
    await expect(beforeHook({ tool: 'tool_search', sessionID: 'ses-1' })).resolves.toBeUndefined();
    await expect(beforeHook({ tool: 'tool_search_regex', sessionID: 'ses-1' })).resolves.toBeUndefined();

    // execute.before for unauthorized git_diff throws
    await expect(beforeHook({ tool: 'git_diff', sessionID: 'ses-1' })).rejects.toThrow(
      /\[Tool Search Required\] Tool "git_diff" has not been searched in session "ses-1"/,
    );

    // Authorize git_diff via tool_search_regex
    const searchRes = await addedTools.tool_search_regex.execute(
      { pattern: '^git_diff$' },
      { sessionID: 'ses-1' },
    );
    expect(searchRes).toContain('Found 1 tool(s)');
    expect(searchRes).toContain('git_diff');

    // execute.before for now-authorized git_diff succeeds
    await expect(beforeHook({ tool: 'git_diff', sessionID: 'ses-1' })).resolves.toBeUndefined();
  });

  it('appends reset notice on execute.after when compress executes', async () => {
    const { ctx, transformCallbacks, toolHooks, sessionHooks } = createMockV2Context();
    await setupV2(ctx, {});

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    const sessionCtx = {
      sessionID: 'ses-2',
      system: [] as string[],
      messages: [],
      tools: {
        file_read: {
          description: 'Read file contents from disk.',
          input: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    };

    await sessionHooks['context'][0](sessionCtx);

    // Authorize file_read
    await addedTools.tool_search_regex.execute({ pattern: '^file_read$' }, { sessionID: 'ses-2' });
    const beforeHook = toolHooks['execute.before'][0];
    await expect(beforeHook({ tool: 'file_read', sessionID: 'ses-2' })).resolves.toBeUndefined();

    // Execute non-reset tool in after hook: output unchanged
    const afterHook = toolHooks['execute.after'][0];
    const normalOutput = { output: 'Read completed' };
    await afterHook({ tool: 'file_read', sessionID: 'ses-2' }, normalOutput);
    expect(normalOutput.output).toBe('Read completed');

    // Execute reset tool (compress) in after hook: appends notice
    const compressOutput = { output: 'Context compressed' };
    await afterHook({ tool: 'compress', sessionID: 'ses-2' }, compressOutput);
    expect(compressOutput.output).toBe(
      'Context compressed\n\n[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.',
    );

    // file_read is now blocked again until re-searched
    await expect(beforeHook({ tool: 'file_read', sessionID: 'ses-2' })).rejects.toThrow(
      /\[Tool Search Required\] Tool "file_read" has not been searched in session "ses-2"/,
    );
  });

  it('defers tools, injects system prompt, restores full schema on authorization, and prevents stacking [deferred] tags', async () => {
    const { ctx, transformCallbacks, sessionHooks } = createMockV2Context();
    await setupV2(ctx, {});

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    const sessionCtx = {
      sessionID: 'ses-3',
      system: [] as string[],
      messages: [],
      tools: {
        bash: {
          description: 'Run arbitrary bash commands on host. Use with caution.',
          input: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to run' },
            },
            required: ['command'],
          },
        },
      },
    };

    // First context turn
    await sessionHooks['context'][0](sessionCtx);

    // System prompt policy text is injected
    expect(sessionCtx.system.length).toBe(1);
    expect(sessionCtx.system[0]).toContain('tool_search_regex');

    // bash is deferred
    expect(sessionCtx.tools.bash.description).toBe('Run arbitrary bash commands on host. [deferred]');
    expect(sessionCtx.tools.bash.input).toEqual({
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief explanation of why you are calling this tool',
        },
      },
      required: ['reason'],
    });

    // Second context turn without authorization: [deferred] does NOT stack
    await sessionHooks['context'][0](sessionCtx);
    expect(sessionCtx.tools.bash.description).toBe('Run arbitrary bash commands on host. [deferred]');

    // Authorize bash via tool_search_regex
    await addedTools.tool_search_regex.execute({ pattern: '^bash$' }, { sessionID: 'ses-3' });

    // Third context turn after authorization: full description and input restored
    await sessionHooks['context'][0](sessionCtx);
    expect(sessionCtx.tools.bash.description).toBe('Run arbitrary bash commands on host. Use with caution.');
    expect(sessionCtx.tools.bash.input).toEqual({
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
      },
      required: ['command'],
    });
  });

  it('removes session state on session.deleted event', async () => {
    const { ctx, transformCallbacks, toolHooks, sessionHooks, eventSubscribers } = createMockV2Context();
    await setupV2(ctx, {});

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    const sessionCtx = {
      sessionID: 'ses-delete-me',
      system: [] as string[],
      messages: [],
      tools: {
        search_files: {
          description: 'Find files matching pattern.',
          input: { type: 'object' },
        },
      },
    };

    await sessionHooks['context'][0](sessionCtx);
    await addedTools.tool_search_regex.execute({ pattern: '^search_files$' }, { sessionID: 'ses-delete-me' });

    const beforeHook = toolHooks['execute.before'][0];
    await expect(beforeHook({ tool: 'search_files', sessionID: 'ses-delete-me' })).resolves.toBeUndefined();

    // Trigger session.deleted event
    const eventHandler = eventSubscribers[0];
    await eventHandler({
      type: 'session.deleted',
      properties: { sessionID: 'ses-delete-me' },
    });

    // Now search_files should be blocked again
    await expect(beforeHook({ tool: 'search_files', sessionID: 'ses-delete-me' })).rejects.toThrow(
      /\[Tool Search Required\] Tool "search_files" has not been searched in session "ses-delete-me"/,
    );
  });
});
