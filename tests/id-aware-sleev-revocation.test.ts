import { describe, expect, it } from 'vitest';
import type { PluginInput } from '@opencode-ai/plugin';
import { SessionRuntime } from '../src/session-runtime.js';

describe('Sleev ID-Aware Selective Tool Revocation', () => {
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

  it('selectively revokes tools whose message ID was pruned by compress tool call', async () => {
    const runtime = createRuntime();
    const sessionID = 'ses_sleev_id_1';

    runtime.deferTool('bash', 'Run bash commands', { type: 'object' });
    runtime.deferTool('glob', 'Find files by pattern', { type: 'object' });

    // Initial search for bash and glob
    const resBash = await runtime.searchTools.tool_search_regex.execute({ pattern: '^bash$' }, { sessionID } as any);
    const resGlob = await runtime.searchTools.tool_search_regex.execute({ pattern: '^glob$' }, { sessionID } as any);

    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).not.toThrow();
    expect(() => runtime.assertAuthorized('glob', sessionID, 'glob')).not.toThrow();

    // Message history from OpenCode:
    // bash schema delivered in m0005
    // glob schema delivered in m0010
    // compress called in m0015 targeting m0001-m0005
    const messages = [
      {
        info: { id: 'msg_1', role: 'assistant' },
        parts: [
          {
            type: 'text',
            text: `<sleev-id-m0005>${String(resBash)}</sleev-id-m0005>`,
          },
        ],
      },
      {
        info: { id: 'msg_2', role: 'assistant' },
        parts: [
          {
            type: 'text',
            text: `<sleev-id-m0010>${String(resGlob)}</sleev-id-m0010>`,
          },
        ],
      },
      {
        info: { id: 'msg_3', role: 'assistant' },
        parts: [
          {
            type: 'tool',
            tool: 'compress',
            callID: 'call_cmp_1',
            state: {
              status: 'completed',
              input: {
                ids: ['m0001', 'm0002', 'm0003', 'm0004', 'm0005'],
              },
              output: 'Scheduled 5 entries: m0001-m0005. Do not compress these IDs again.',
            },
          },
        ],
      },
    ];

    // Sync via messages transform
    const revoked = runtime.syncSleevCompression(sessionID, messages as any);
    expect(revoked).toContain('bash');
    expect(revoked).not.toContain('glob');

    // Bash is revoked (requires tool_search), Glob remains authorized!
    expect(() => runtime.assertAuthorized('bash', sessionID, 'bash')).toThrow(/\[Tool Search Required\]/);
    expect(() => runtime.assertAuthorized('glob', sessionID, 'glob')).not.toThrow();
  });

  it('handles multiple compress calls and accumulates pruned message IDs', async () => {
    const runtime = createRuntime();
    const sessionID = 'ses_sleev_id_2';

    runtime.deferTool('read', 'Read file content', { type: 'object' });
    runtime.deferTool('write', 'Write file content', { type: 'object' });

    const resRead = await runtime.searchTools.tool_search_regex.execute({ pattern: '^read$' }, { sessionID } as any);
    const resWrite = await runtime.searchTools.tool_search_regex.execute({ pattern: '^write$' }, { sessionID } as any);

    const messages = [
      {
        info: { id: 'msg_1', role: 'assistant' },
        parts: [
          {
            type: 'text',
            text: `<sleev-id-m0020>${String(resRead)}</sleev-id-m0020>`,
          },
        ],
      },
      {
        info: { id: 'msg_2', role: 'assistant' },
        parts: [
          {
            type: 'tool',
            tool: 'compress',
            callID: 'call_cmp_1',
            state: {
              status: 'completed',
              input: { ids: ['m0010', 'm0011'] },
              output: 'Scheduled 2 entries: m0010, m0011.',
            },
          },
        ],
      },
      {
        info: { id: 'msg_3', role: 'assistant' },
        parts: [
          {
            type: 'text',
            text: `<sleev-id-m0030>${String(resWrite)}</sleev-id-m0030>`,
          },
        ],
      },
      {
        info: { id: 'msg_4', role: 'assistant' },
        parts: [
          {
            type: 'tool',
            tool: 'compress',
            callID: 'call_cmp_2',
            state: {
              status: 'completed',
              input: { ids: ['m0020'] }, // Pruning read tool in m0020
              output: 'Scheduled 1 entry: m0020.',
            },
          },
        ],
      },
    ];

    const revoked = runtime.syncSleevCompression(sessionID, messages as any);
    expect(revoked).toEqual(['read']);

    expect(() => runtime.assertAuthorized('read', sessionID, 'read')).toThrow(/\[Tool Search Required\]/);
    expect(() => runtime.assertAuthorized('write', sessionID, 'write')).not.toThrow();
  });
});
