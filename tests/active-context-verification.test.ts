import { describe, expect, it } from 'vitest';
import type { PluginInput } from '@opencode-ai/plugin';
import { SessionRuntime } from '../src/engine/session-engine.js';

describe('Active Context Tool Verification (Selective Context-Presence Checking)', () => {
  const dummyCtx = {
    directory: '/tmp/test',
  } as unknown as PluginInput;

  function createRuntime() {
    return new SessionRuntime(dummyCtx, {
      maxResults: 10,
      deferLabel: '[deferred]',
      embedding: { enabled: false } as any,
      alwaysOn: ['tool_search', 'tool_search_regex'],
      resetTools: [],
    });
  }

  it('keeps tool authorized as long as tool schema/output exists in active messages', async () => {
    const runtime = createRuntime();
    const sessionID = 'ses_active_1';

    runtime.deferTool('bash', 'Run bash commands', { type: 'object' });
    runtime.deferTool('glob', 'Find files by pattern', { type: 'object' });

    // Initially requires reminder / search
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).toThrow(/\[Tool Search Required\]/);
    expect(() => runtime.assertAuthorized('glob', sessionID, 'glob')).toThrow(/\[Tool Search Required\]/);

    // Execute search for bash
    const searchRes = await runtime.searchTools.tool_search.execute({ query: 'bash' }, { sessionID } as any);
    expect(String(searchRes)).toContain('bash');

    // Bash is now authorized
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).not.toThrow();

    // Active conversation contains the search result for bash
    const messages = [
      { role: 'user', content: 'Can you search for bash?' },
      { role: 'assistant', content: String(searchRes) },
      { role: 'user', content: 'Now run a bash command' },
    ];

    // Sync active context — bash is verified as present in active context
    const revoked = runtime.syncActiveAuthorizations(sessionID, messages);
    expect(revoked).toEqual([]);
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).not.toThrow();
  });

  it('selectively revokes only tools whose search output was pruned from messages', async () => {
    const runtime = createRuntime();
    const sessionID = 'ses_active_2';

    runtime.deferTool('tool_alpha', 'Alpha tool description', { type: 'object' });
    runtime.deferTool('tool_beta', 'Beta tool description', { type: 'object' });

    // Search both alpha and beta using regex or query
    const resAlpha = await runtime.searchTools.tool_search_regex.execute({ pattern: '^tool_alpha$' }, { sessionID } as any);
    const resBeta = await runtime.searchTools.tool_search_regex.execute({ pattern: '^tool_beta$' }, { sessionID } as any);

    expect(() => runtime.assertAuthorized('tool_alpha', sessionID, 'tool_alpha')).not.toThrow();
    expect(() => runtime.assertAuthorized('tool_beta', sessionID, 'tool_beta')).not.toThrow();

    // Simulate Sleev pruning: message containing tool_alpha is pruned, but tool_beta is still in context
    const prunedMessages = [
      { role: 'system', content: '<sleev-id-compressed>Earlier turns pruned</sleev-id-compressed>' },
      { role: 'user', content: 'What about beta?' },
      { role: 'assistant', content: String(resBeta) },
      { role: 'user', content: 'Let us use both tools' },
    ];

    // Run active verification
    const revoked = runtime.syncActiveAuthorizations(sessionID, prunedMessages);
    expect(revoked).toContain('tool_alpha');
    expect(revoked).not.toContain('tool_beta');

    // tool_alpha now requires search again, while tool_beta is STILL authorized!
    expect(() => runtime.assertAuthorized('tool_alpha', sessionID, 'tool_alpha')).toThrow(/\[Tool Search Required\]/);
    expect(() => runtime.assertAuthorized('tool_beta', sessionID, 'tool_beta')).not.toThrow();
  });

  it('supports complex message structures (blocks, parts, object arrays)', async () => {
    const runtime = createRuntime();
    const sessionID = 'ses_active_3';

    runtime.deferTool('complex_tool', 'Complex tool for tests', { type: 'object' });

    await runtime.searchTools.tool_search.execute({ query: 'complex_tool' }, { sessionID } as any);
    expect(() => runtime.assertAuthorized('complex_tool', sessionID, 'complex_tool')).not.toThrow();

    // Nested blocks structure (OpenCode / LLM multi-part shape)
    const complexMessages = [
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'tool_use',
            text: 'I found complex_tool with parameter schemas',
          },
        ],
      },
    ];

    const revoked = runtime.syncActiveAuthorizations(sessionID, complexMessages);
    expect(revoked).toEqual([]);
    expect(() => runtime.assertAuthorized('complex_tool', sessionID, 'complex_tool')).not.toThrow();
  });
});
