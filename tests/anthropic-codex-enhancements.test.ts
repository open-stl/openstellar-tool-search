import { describe, it, expect } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

describe('Anthropic & Codex-Grade Enhancements', () => {
  it('outputs static system prompt instruction without dynamic count mutations', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {});

    // Simulate tool definition
    if (hooks['tool.definition']) {
      await hooks['tool.definition'](
        { toolID: 'test_tool' },
        { description: 'Test tool description', parameters: { type: 'object', properties: { p: { type: 'string' } } } },
      );
    }

    const systemOutput1 = { system: [] as string[] };
    if (hooks['experimental.chat.system.transform']) {
      await hooks['experimental.chat.system.transform']({} as any, systemOutput1);
    }

    const systemOutput2 = { system: [] as string[] };
    if (hooks['experimental.chat.system.transform']) {
      await hooks['experimental.chat.system.transform']({} as any, systemOutput2);
    }

    expect(systemOutput1.system[0]).toBeDefined();
    expect(systemOutput1.system[0]).toBe(systemOutput2.system[0]);
    expect(systemOutput1.system[0]).not.toContain('1/1 tools are deferred');
    expect(systemOutput1.system[0]).toContain('Tools marked "[deferred]" are deferred');
  });

  it('strips parameter JSON schemas from prompt-zero tool definitions for deferred tools', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {});

    const toolDefOutput = {
      description: 'Fetch user details',
      parameters: { type: 'object', properties: { userId: { type: 'string' } } },
    };

    if (hooks['tool.definition']) {
      await hooks['tool.definition']({ toolID: 'get_user' }, toolDefOutput);
    }

    // Prompt-zero definition has parameters stripped
    expect(toolDefOutput.parameters).toEqual({ type: 'object', properties: {} });

    // Search discovery payload retains full parameters
    const searchTool = (hooks.tool as any).tool_search;
    const searchResult = await searchTool.execute({ query: 'Fetch user' }, { sessionID: 'sess-schema-1' });
    expect(searchResult).toContain('userId');
  });

  it('enforces regex pattern length limits and returns diagnostic hints on invalid regex', async () => {
    const mockCtx = {} as PluginInput;
    const hooks = await ToolSearchPlugin.server(mockCtx, {});
    const regexTool = (hooks.tool as any).tool_search_regex;

    // Pattern > 200 chars
    const longPattern = 'a'.repeat(201);
    const longResult = await regexTool.execute({ pattern: longPattern }, { sessionID: 'sess-regex-1' });
    expect(longResult).toContain('exceeds maximum length of 200 characters');

    // Invalid regex syntax
    const invalidResult = await regexTool.execute({ pattern: '[unclosed' }, { sessionID: 'sess-regex-2' });
    expect(invalidResult).toContain('Invalid regex pattern');
  });
});
