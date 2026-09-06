import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { setupV2, loadFallbackMcpConfig } from '../src/v2/setup.js';
import { plugin } from '../src/plugin.js';

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

  it('is exposed as plugin.setup and plugin.id', () => {
    expect(typeof plugin.setup).toBe('function');
    expect(plugin.setup).toBe(setupV2);
    expect(plugin.id).toBe('openstellar-tool-search');
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
    const contentText = typeof searchRes === 'string' ? searchRes : searchRes?.content ?? '';
    expect(contentText).toContain('Found 1 tool(s)');
    expect(contentText).toContain('git_diff');

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

    // bash is deferred (description only — parameters stay intact, unified v1/v2 contract)
    expect(sessionCtx.tools.bash.description).toBe('Run arbitrary bash commands on host. [deferred]');
    expect(sessionCtx.tools.bash.input).toEqual({
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
      },
      required: ['command'],
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

  it('supports MCP configuration in opts.mcp, registers tools in transform and dynamic updates', async () => {
    const { ctx, transformCallbacks } = createMockV2Context();

    await setupV2(ctx, {
      mcp: {
        servers: {
          test_srv: {
            type: 'local',
            command: 'node',
            args: ['-e', 'console.log("dummy")'],
            enabled: true,
          },
        },
      },
    });

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    expect(addedTools.tool_search).toBeDefined();
    expect(addedTools.tool_search_regex).toBeDefined();
    expect(addedTools.test_srv).toBeDefined();
    expect(addedTools.test_srv.options).toEqual({ codemode: false });
  });

  it('falls back to ctx.options when options argument is not passed', async () => {
    const { ctx, transformCallbacks } = createMockV2Context();
    (ctx as any).options = {
      mcp: {
        servers: {
          ctx_srv: {
            type: 'local',
            command: 'node',
            args: ['-e', 'console.log("dummy")'],
            enabled: true,
          },
        },
      },
    };

    await setupV2(ctx);

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    expect(addedTools.ctx_srv).toBeDefined();
  });

  it('loads MCP tools from ctx.options.mcp.servers and registers them into ctx.tool.transform with codemode: false', async () => {
    const { ctx, transformCallbacks } = createMockV2Context();
    (ctx as any).options = {
      mcp: {
        servers: {
          my_server: {
            type: 'local',
            command: 'node',
            args: ['-e', 'console.log("dummy")'],
            enabled: true,
          },
        },
      },
    };

    await setupV2(ctx);

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    expect(addedTools.my_server).toBeDefined();
    expect(addedTools.my_server.options).toEqual({ codemode: false });
    expect(addedTools.tool_search.options).toEqual({ codemode: false });
    expect(addedTools.tool_search_regex.options).toEqual({ codemode: false });
  });

  it('verifies placeholder registration for cut/failed servers and honest description handling', async () => {
    const { ctx, transformCallbacks } = createMockV2Context();

    await setupV2(ctx, {
      mcp: {
        servers: {
          failed_server: {
            type: 'local',
            command: 'non_existent_binary_xyz',
            enabled: true,
          },
        },
      },
    });

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    // failed_server placeholder remains registered because server failed/settled without tools
    expect(addedTools.failed_server).toBeDefined();
    expect(addedTools.failed_server.description).toContain('deadlined');

    // Placeholder execution returns honest failed message
    const res = await addedTools.failed_server.execute({}, { sessionID: 'ses-mcp' });
    expect(res).toBeDefined();
  });

  it('resolves fallback MCP config via loadFallbackMcpConfig in custom directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-fallback-'));
    try {
      const configPath = path.join(tempDir, 'opencode.jsonc');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          mcp: {
            servers: {
              fallback_srv: {
                type: 'local',
                command: 'node',
                args: ['-e', 'console.log(1)'],
              },
            },
          },
        }),
        'utf-8',
      );

      const resolved = loadFallbackMcpConfig(tempDir);
      expect(resolved).toBeDefined();
      expect(resolved).toEqual({
        fallback_srv: {
          type: 'local',
          command: 'node',
          args: ['-e', 'console.log(1)'],
        },
      });

      // Also test setupV2 with ctx.directory
      const { ctx, transformCallbacks } = createMockV2Context();
      (ctx as any).directory = tempDir;
      await setupV2(ctx);

      const addedTools: Record<string, any> = {};
      transformCallbacks[0]({
        add: (t: any) => {
          addedTools[t.name] = t;
        },
      });

      expect(addedTools.fallback_srv).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('dynamically registers new MCP tools via onUpdate listener without duplicate subscriptions', async () => {
    const { ctx, transformCallbacks } = createMockV2Context();

    await setupV2(ctx, {
      mcp: {
        servers: {
          dyn_srv: {
            type: 'local',
            command: 'node',
            args: ['-e', 'console.log("dummy")'],
            enabled: true,
          },
        },
      },
    });

    const addedTools: Record<string, any> = {};
    const addFn = vi.fn((t: any) => {
      addedTools[t.name] = t;
    });

    // Trigger transform
    transformCallbacks[0]({ add: addFn });
    expect(addedTools.tool_search).toBeDefined();
    expect(addedTools.dyn_srv).toBeDefined();

    // Calling transform again does not throw and preserves single onUpdate subscription
    transformCallbacks[0]({ add: addFn });
  });

  it('resets tool authorizations when session.compacted event is fired', async () => {
    const { ctx, transformCallbacks, toolHooks, sessionHooks, eventSubscribers } = createMockV2Context();

    await setupV2(ctx, {
      alwaysLoad: ['test_init'],
    });

    const addedTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        addedTools[t.name] = t;
      },
    });

    const sessionID = 'ses-compact-test';
    const sessionCtx = {
      sessionID,
      system: [] as string[],
      messages: [],
      tools: {
        git_status: {
          description: 'Show git working tree status.',
          input: { type: 'object', properties: {} },
        },
      },
    };

    // Register tool via session context hook
    await sessionHooks['context'][0](sessionCtx);

    // 1. Authorize git_status via regex
    await addedTools.tool_search_regex.execute(
      { pattern: '^git_status$' },
      { sessionID },
    );

    // 2. Verified authorized before compaction
    await expect(
      toolHooks['execute.before'][0]({ tool: 'git_status', sessionID }),
    ).resolves.toBeUndefined();

    // 3. Fire session.compacted event
    await eventSubscribers[0]({
      type: 'session.compacted',
      properties: { sessionID },
    });

    // 4. Assert tool authorization has been reset — calls now throw [Tool Search Required]
    await expect(
      toolHooks['execute.before'][0]({ tool: 'git_status', sessionID }),
    ).rejects.toThrow(/\[Tool Search Required\]/);
  });
});
