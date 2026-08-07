import { describe, it, expect, vi } from 'vitest';
import defaultPlugin, { ToolSearchPlugin, plugin } from '../index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isServerPlugin(value: unknown): boolean {
  return typeof value === 'function';
}

function getServerPlugin(value: unknown) {
  if (isServerPlugin(value)) return value;
  if (!value || typeof value !== 'object' || !('server' in value)) return;
  if (!isServerPlugin((value as any).server)) return;
  return (value as any).server;
}

function simulateOpenCodeV2Loader(mod: Record<string, unknown>) {
  const value = mod.default;
  if (!isRecord(value)) return undefined;
  if (!('id' in value) && !('server' in value)) return undefined;
  return value;
}

function simulateOpenCodeV1LegacyLoader(mod: Record<string, unknown>) {
  const result: any[] = [];
  const seen = new Set<unknown>();

  for (const entry of Object.values(mod)) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    const serverPlugin = getServerPlugin(entry);
    if (serverPlugin) {
      result.push(serverPlugin);
    }
  }
  return result;
}

describe('OpenCode V1 & V2 Loader Compatibility Test Suite', () => {
  it('1. OpenCode V2 loader inspects default export as plain record with id and server', () => {
    expect(isRecord(defaultPlugin)).toBe(true);
    expect(defaultPlugin).toHaveProperty('id', 'openstellar-tool-search');
    expect(defaultPlugin).toHaveProperty('server');
    expect(typeof (defaultPlugin as any).server).toBe('function');

    const v2Loaded = simulateOpenCodeV2Loader({ default: defaultPlugin, ToolSearchPlugin, plugin });
    expect(v2Loaded).toBeDefined();
    expect((v2Loaded as any).id).toBe('openstellar-tool-search');
    expect(typeof (v2Loaded as any).server).toBe('function');
  });

  it('2. OpenCode V1 legacy loader locates server function from exports without throwing on non-plugins', () => {
    const mod = { default: defaultPlugin, ToolSearchPlugin, plugin };
    const legacyPlugins = simulateOpenCodeV1LegacyLoader(mod);
    expect(legacyPlugins.length).toBeGreaterThan(0);
    expect(typeof legacyPlugins[0]).toBe('function');
  });

  it('3. OpenCode V2 loader execution flow operates identically for tool registration and regex search', async () => {
    const ctx = { client: { tui: { showToast: vi.fn() } } };
    const opts = { embedding: { enabled: false } };

    const v2Plugin = simulateOpenCodeV2Loader({ default: defaultPlugin })!;
    const hooks = await (v2Plugin as any).server(ctx, opts);

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool.tool_search).toBeDefined();
    expect(hooks.tool.tool_search_regex).toBeDefined();

    const toolDef = {
      description: 'Search files in repository',
      parameters: { type: 'object', properties: { pattern: { type: 'string' } } },
    };

    await hooks['tool.definition']!({ toolID: 'file_search' }, toolDef);
    expect(toolDef.description).toContain('[deferred]');

    const regexResult = await hooks.tool.tool_search_regex.execute({ pattern: '^file_search$' }, { sessionID: 'v2-session' });
    expect(regexResult).toContain('file_search');
    expect(regexResult).toContain('Search files in repository');

    await expect(
      hooks['tool.execute.before']!({ tool: 'file_search', sessionID: 'v2-session' } as any, {} as any)
    ).resolves.toBeUndefined();
  });

  it('4. OpenCode V1 loader execution flow operates identically for tool registration and regex search', async () => {
    const ctx = { client: { tui: { showToast: vi.fn() } } };
    const opts = { embedding: { enabled: false } };

    const legacyPlugins = simulateOpenCodeV1LegacyLoader({ default: defaultPlugin, ToolSearchPlugin });
    const serverFn = legacyPlugins[0];
    const hooks = await serverFn(ctx, opts);

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool.tool_search).toBeDefined();
    expect(hooks.tool.tool_search_regex).toBeDefined();

    const toolDef = {
      description: 'Read contents from disk',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    };

    await hooks['tool.definition']!({ toolID: 'read_disk' }, toolDef);
    expect(toolDef.description).toContain('[deferred]');

    const regexResult = await hooks.tool.tool_search_regex.execute({ pattern: '^read_disk$' }, { sessionID: 'v1-session' });
    expect(regexResult).toContain('read_disk');
    expect(regexResult).toContain('Read contents from disk');

    await expect(
      hooks['tool.execute.before']!({ tool: 'read_disk', sessionID: 'v1-session' } as any, {} as any)
    ).resolves.toBeUndefined();
  });

  it('5. Direct named export ToolSearchPlugin acts as callable function with attached v2 properties', async () => {
    expect(typeof ToolSearchPlugin).toBe('function');
    expect((ToolSearchPlugin as any).id).toBe('openstellar-tool-search');
    expect(typeof (ToolSearchPlugin as any).server).toBe('function');

    const ctx = { client: { tui: { showToast: vi.fn() } } } as any;
    const hooksDirect = await ToolSearchPlugin(ctx, { embedding: { enabled: false } } as any);
    expect(hooksDirect.tool?.tool_search).toBeDefined();

    const hooksViaServer = await (ToolSearchPlugin as any).server(ctx, { embedding: { enabled: false } } as any);
    expect(hooksViaServer.tool?.tool_search).toBeDefined();
  });
});
