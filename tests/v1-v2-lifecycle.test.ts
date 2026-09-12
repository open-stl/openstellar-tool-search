import { describe, expect, it, vi, afterEach } from 'vitest';
import { plugin } from '../src/plugin.js';
import { setupV2 } from '../src/v2/setup.js';

// Mock semantic matcher so tests don't load the real ONNX model
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

describe('v1 and v2 Unified End-to-End Contract Verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('OpenCode v1: defers descriptions only, preserves parameters, ungated execution, authorizes via search, returns no parameters in search message', async () => {
    const ctx: any = {
      client: {
        tui: {
          showToast: vi.fn(async () => {}),
        },
      },
    };

    // v1 plugin server initialization
    const hooks = await plugin.server(ctx, {});
    expect(hooks).toBeDefined();
    expect(hooks.tool).toBeDefined();
    expect(hooks['tool.definition']).toBeDefined();
    expect(hooks['tool.execute.before']).toBeDefined();
    expect(hooks['tool.execute.after']).toBeDefined();

    const sampleParams = {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target file or symbol' },
        deep: { type: 'boolean', description: 'Perform deep scan' },
      },
      required: ['target'],
    };

    // 1. Definition hook intercepts tool definition:
    // Only description is deferred, parameters schema is NOT modified or substituted.
    const toolDefOutput: any = {
      description: 'Find references to symbols across all modules in the repository. Highly accurate.',
      parameters: sampleParams,
    };
    await hooks['tool.definition']!({ toolID: 'symbol_find' }, toolDefOutput);

    expect(toolDefOutput.description).toBe(
      'Find references to symbols across all modules in the repository. [deferred]',
    );
    expect(toolDefOutput.parameters).toBe(sampleParams);
    expect(toolDefOutput.parameters.properties.target).toBeDefined();
    expect(toolDefOutput.parameters.properties.deep).toBeDefined();
    expect(toolDefOutput.parameters.properties.reason).toBeUndefined();

    // 2. Before execution: unsearched tool execution is ungated per ADR 0003
    const sessionID = 'v1-test-session';
    await expect(
      hooks['tool.execute.before']!({ tool: 'symbol_find', sessionID } as any, {} as any),
    ).resolves.toBeUndefined();

    // 3. Search execution: tool_search_regex discovers and authorizes the tool
    const searchResult = await (hooks.tool as any).tool_search_regex.execute(
      { pattern: '^symbol_find$' },
      { sessionID } as any,
    );

    // Verifies the response returns name + full description, but NO parameter schemas
    expect(searchResult).toContain('Found 1 tool(s):');
    expect(searchResult).toContain('symbol_find: Find references to symbols across all modules in the repository. Highly accurate.');
    expect(searchResult).not.toContain('parameters:');
    expect(searchResult).not.toContain('"properties"');

    // 4. After search: tool is authorized and can now be executed without throwing
    await expect(
      hooks['tool.execute.before']!({ tool: 'symbol_find', sessionID } as any, {} as any),
    ).resolves.toBeUndefined();

    // 5. System transform: injects policy
    const systemOutput: any = { system: ['Base system prompt'] };
    await hooks['experimental.chat.system.transform']!({ sessionID } as any, systemOutput);
    expect(systemOutput.system.length).toBe(2);
    expect(systemOutput.system[1]).toContain('[Tool Search Policy]');
    expect(systemOutput.system[1]).toContain('parameter schemas are always present in the tools array');
  });

  it('OpenCode v2: defers descriptions only, preserves parameters, ungated execution, authorizes via search, returns no parameters in search message', async () => {
    const transformCallbacks: Array<(registry: any) => void> = [];
    const toolHooks: Record<string, Function[]> = {};
    const sessionHooks: Record<string, Function[]> = {};
    const eventSubscribers: Function[] = [];

    const ctx: any = {
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

    // v2 setup initialization
    await setupV2(ctx, {});
    expect(transformCallbacks.length).toBeGreaterThan(0);
    expect(sessionHooks['context']).toBeDefined();
    expect(toolHooks['execute.before']).toBeDefined();

    const registeredTools: Record<string, any> = {};
    transformCallbacks[0]({
      add: (t: any) => {
        registeredTools[t.name] = t;
      },
    });

    const sampleParams = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max items' },
      },
      required: ['query'],
    };

    const sessionID = 'v2-test-session';
    const sessionCtx: any = {
      sessionID,
      system: ['V2 base system prompt'],
      messages: [],
      tools: {
        data_query: {
          description: 'Query relational database tables using SQL syntax. Supports joins.',
          input: sampleParams,
        },
      },
    };

    // 1. Context hook turn 1: unauthorized tool
    // Description is deferred, parameter schema is NOT replaced with placeholder
    await sessionHooks['context'][0](sessionCtx);

    expect(sessionCtx.tools.data_query.description).toBe(
      'Query relational database tables using SQL syntax. [deferred]',
    );
    expect(sessionCtx.tools.data_query.input).toBe(sampleParams);
    expect(sessionCtx.tools.data_query.input.properties.query).toBeDefined();
    expect(sessionCtx.tools.data_query.input.properties.limit).toBeDefined();
    expect(sessionCtx.tools.data_query.input.properties.reason).toBeUndefined();

    // 2. Before execution: unsearched tool execution is ungated per ADR 0003
    await expect(
      toolHooks['execute.before'][0]({ tool: 'data_query', sessionID }),
    ).resolves.toBeUndefined();

    // 3. Search execution: tool_search authorizes the tool
    const searchRes = await registeredTools.tool_search_regex.execute(
      { pattern: '^data_query$' },
      { sessionID },
    );
    const contentText = typeof searchRes === 'string' ? searchRes : searchRes?.content ?? '';

    expect(contentText).toContain('Found 1 tool(s):');
    expect(contentText).toContain('data_query: Query relational database tables using SQL syntax. Supports joins.');
    expect(contentText).not.toContain('parameters:');
    expect(contentText).not.toContain('"properties"');

    // 4. Context hook turn 2: description remains truncated ([deferred]) per ADR 0003
    // token virtualization — full docs were delivered via the search response message
    // channel; the parameter schema stays intact in the tools array.
    await sessionHooks['context'][0](sessionCtx);
    expect(sessionCtx.tools.data_query.description).toBe(
      'Query relational database tables using SQL syntax. [deferred]',
    );
    expect(sessionCtx.tools.data_query.input.properties.query).toBeDefined();

    // 5. After search: execution succeeds without throwing
    await expect(
      toolHooks['execute.before'][0]({ tool: 'data_query', sessionID }),
    ).resolves.toBeUndefined();
  });
});
