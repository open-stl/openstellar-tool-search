import { SessionRuntime } from '../src/session-runtime.js';
import type { PluginInput } from '@opencode-ai/plugin';

async function main() {
  console.log('=== LIVE TEST: SLEEV COMPRESS SELECTIVE REVOCATION ===\n');

  const dummyCtx = { directory: '/tmp/test' } as unknown as PluginInput;
  const runtime = new SessionRuntime(dummyCtx, {
    maxResults: 10,
    deferLabel: '[deferred]',
    embedding: { enabled: false } as any,
    alwaysOn: ['tool_search', 'tool_search_regex'],
    resetTools: [],
  });

  const sessionID = 'ses_live_verification_123';
  runtime.deferTool('bash', 'Run bash commands', { type: 'object' });
  runtime.deferTool('glob', 'Find files by pattern', { type: 'object' });

  // 1. Initial State: Unsearched
  console.log('1. Checking initial authorization state...');
  try {
    runtime.assertAuthorized('bash', sessionID, 'bash');
    console.error('FAIL: bash should not be authorized initially');
    process.exit(1);
  } catch (e: any) {
    console.log('   ✅ PASS: bash blocked with:', e.message);
  }

  // 2. Search bash
  console.log('\n2. Executing tool_search for bash...');
  const searchResult = await runtime.searchTools.tool_search_regex.execute({ pattern: '^bash$' }, { sessionID } as any);
  console.log('   Search Result Header:', String(searchResult).slice(0, 50) + '...');
  
  // Bash is now authorized
  try {
    runtime.assertAuthorized('bash', sessionID, 'bash');
    console.log('   ✅ PASS: bash is now authorized and runnable!');
  } catch (e: any) {
    console.error('FAIL: bash should be authorized');
    process.exit(1);
  }

  // 3. Conversation history with Sleev tag <sleev-id-m0005>
  console.log('\n3. Building conversation history (bash schema in m0005)...');
  const messages = [
    {
      info: { id: 'msg_1', sessionID, role: 'assistant' },
      parts: [
        {
          type: 'text',
          text: `<sleev-id-m0005>${String(searchResult)}</sleev-id-m0005>`,
        },
      ],
    },
  ];

  // Sync without compress - bash stays authorized
  runtime.syncSleevCompression(sessionID, messages as any);
  runtime.assertAuthorized('bash', sessionID, 'bash');
  console.log('   ✅ PASS: bash remains authorized while m0005 is active.');

  // 4. Trigger Sleev compress tool call targeting m0005
  console.log('\n4. Adding completed compress tool call targeting m0005 (Sleev proxy pruning)...');
  messages.push({
    info: { id: 'msg_2', sessionID, role: 'assistant' },
    parts: [
      {
        type: 'tool',
        tool: 'compress',
        callID: 'call_cmp_live',
        state: {
          status: 'completed',
          input: { ids: ['m0001', 'm0002', 'm0003', 'm0004', 'm0005'] },
          output: 'Scheduled 5 entries: m0001-m0005. Do not compress these IDs again.',
        },
      } as any,
    ],
  });

  // 5. Run syncSleevCompression
  console.log('\n5. Running syncSleevCompression after compress...');
  const revoked = runtime.syncSleevCompression(sessionID, messages as any);
  console.log('   Revoked tools list:', revoked);

  if (!revoked.includes('bash')) {
    console.error('FAIL: bash was not revoked after compress!');
    process.exit(1);
  }
  console.log('   ✅ PASS: bash was selectively revoked!');

  // 6. Verify bash is now blocked
  console.log('\n6. Verifying bash execution is blocked with [Tool Search Required]...');
  try {
    runtime.assertAuthorized('bash', sessionID, 'bash');
    console.error('FAIL: bash should throw Tool Search Required');
    process.exit(1);
  } catch (e: any) {
    console.log('   ✅ PASS: Caught expected error:', e.message);
  }

  // 7. Re-search bash in the next turn
  console.log('\n7. Re-searching bash in next turn...');
  await runtime.searchTools.tool_search_regex.execute({ pattern: '^bash$' }, { sessionID } as any);
  runtime.assertAuthorized('bash', sessionID, 'bash');
  console.log('   ✅ PASS: bash re-authorized successfully for new turn!');

  console.log('\n======================================================');
  console.log('🎉 ALL LIVE SLEEV COMPRESS REVOCATION TESTS PASSED! 🎉');
  console.log('======================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
