import { describe, expect, it } from 'vitest';
import type { PluginInput } from '@opencode-ai/plugin';
import { SessionRuntime } from '../src/session-runtime.js';

describe('Sleev External Compaction Live Loop Test', () => {
  const dummyCtx = {
    directory: '/tmp/test',
  } as unknown as PluginInput;

  it('handles a long session loop with Sleev Proxy pruning and resets authorization correctly', async () => {
    const runtime = new SessionRuntime(dummyCtx, {
      maxResults: 10,
      deferLabel: '[deferred]',
      embedding: { enabled: false } as any,
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
    });

    // Defer bash tool into session runtime
    runtime.deferTool('bash', 'Run bash shell commands', { type: 'object' });

    const sessionID = 'ses_sleev_live_long_loop';

    // 1. Initial State: Deferred tools require search
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).toThrow(
      /\[Tool Search Required\]/,
    );

    // 2. Execute tool_search to authorize bash
    const searchResult = await runtime.searchTools.tool_search.execute(
      { query: 'bash' },
      { sessionID } as any,
    );
    expect(String(searchResult)).toContain('Found');

    // 3. Long loop (15 calls): Ensure calls #1 through #15 pass without re-searching
    for (let turn = 1; turn <= 15; turn++) {
      expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).not.toThrow();
    }

    // 4. Simulate Sleev Proxy Pruning Turn (Sleev prunes context and injects compression marker tag)
    const simulatedSleevPrunedMessages = [
      { role: 'user', content: 'Here is a message' },
      { role: 'assistant', content: 'Processing <sleev-id-compressed> pruned state' },
    ];

    const revoked = runtime.syncActiveAuthorizations(sessionID, simulatedSleevPrunedMessages);
    expect(revoked).toContain('bash');

    // 5. Post-compression verification: Calling bash must now REQUIRE tool_search again!
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).toThrow(
      /\[Tool Search Required\]/,
    );

    // 6. Re-authorize bash via tool_search
    await runtime.searchTools.tool_search.execute(
      { query: 'bash' },
      { sessionID } as any,
    );

    // 7. Post-reauthorization long loop (15 calls): Ensure calls pass without re-searching
    for (let turn = 16; turn <= 30; turn++) {
      expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).not.toThrow();
    }
  });

  it('detects message count shrinkage (Sleev context window pruning)', async () => {
    const runtime = new SessionRuntime(dummyCtx, {
      maxResults: 10,
      deferLabel: '[deferred]',
      embedding: { enabled: false } as any,
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
    });

    runtime.deferTool('bash', 'Run bash shell commands', { type: 'object' });

    const sessionID = 'ses_sleev_shrinkage_test';

    // Authorize bash
    await runtime.searchTools.tool_search.execute(
      { query: 'bash' },
      { sessionID } as any,
    );
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).not.toThrow();

    // Turn 1: 10 messages accumulated in conversation, including bash search response
    const messagesTurn1 = Array.from({ length: 10 }, (_, i) => ({
      role: 'user',
      content: i === 1 ? 'Found 1 tool(s):\n\nbash: Run bash shell commands' : `Message ${i}`,
    }));
    runtime.syncActiveAuthorizations(sessionID, messagesTurn1);

    // Still authorized because bash search output is in messagesTurn1
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).not.toThrow();

    // Turn 2: Sleev prunes conversation down to 3 messages, pruning the bash search response
    const messagesTurn2 = [
      { role: 'user', content: 'Message 0' },
      { role: 'user', content: 'Message 8' },
      { role: 'user', content: 'Message 9' },
    ];
    const revoked = runtime.syncActiveAuthorizations(sessionID, messagesTurn2);
    expect(revoked).toContain('bash');

    // Authorization reset!
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).toThrow(
      /\[Tool Search Required\]/,
    );
  });
});
