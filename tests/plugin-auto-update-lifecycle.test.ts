import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkForUpdate, mockedFormatUpdateMessage } = vi.hoisted(() => ({
  checkForUpdate: vi.fn(async (): Promise<any> => ({
    outcome: 'up-to-date' as const,
    currentVersion: '0.2.0',
    latestVersion: '0.2.0',
  })),
  mockedFormatUpdateMessage: vi.fn((result: any) => {
    if (result.outcome === 'update-staged') return { title: 'Tool Search Update', message: `v${result.currentVersion} -> v${result.latestVersion}. Restart OpenCode to apply.`, variant: 'warning' as const };
    if (result.outcome === 'check-failed' || result.outcome === 'invalidation-failed') return { title: 'Tool Search Update Check', message: result.error, variant: 'error' as const };
    return { title: 'Tool Search', message: 'Up-to-date', variant: 'info' as const };
  }),
}));

vi.mock('../src/hooks/auto-update-checker.js', async () => {
  const actual = await vi.importActual<typeof import('../src/hooks/auto-update-checker.js')>('../src/hooks/auto-update-checker.js');
  return { ...actual, checkForUpdate, formatUpdateMessage: mockedFormatUpdateMessage };
});

import { ToolSearchPlugin } from '../src/plugin.js';

describe('ToolSearchPlugin update-check lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    checkForUpdate.mockReset();
    mockedFormatUpdateMessage.mockClear();
  });

  const createContext = () => ({
    client: { tui: { showToast: vi.fn(async () => {}) } },
  });

  it('rechecks after a later sequential completed session.created event', async () => {
    checkForUpdate.mockResolvedValue({ outcome: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' });
    const hooks = await ToolSearchPlugin(createContext() as any, { mode: 'keyword' } as any);

    await hooks.event!({ event: { type: 'session.created' } } as any);
    await hooks.event!({ event: { type: 'session.created' } } as any);

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent session.created events and awaits the shared promise', async () => {
    let resolveCheck!: (value: any) => void;
    checkForUpdate.mockReturnValueOnce(new Promise((resolve) => { resolveCheck = resolve; }));
    const hooks = await ToolSearchPlugin(createContext() as any, { mode: 'keyword' } as any);

    const first = hooks.event!({ event: { type: 'session.created' } } as any);
    const second = hooks.event!({ event: { type: 'session.created' } } as any);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    resolveCheck({ outcome: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' });
    await Promise.all([first, second]);

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['check failure', { outcome: 'check-failed', currentVersion: '0.2.0', latestVersion: null, error: 'registry unavailable' }],
    ['invalidation failure', { outcome: 'invalidation-failed', currentVersion: '0.1.0', latestVersion: '0.2.0', error: 'cache target unavailable' }],
  ])('retries after %s', async (_label, failedResult) => {
    checkForUpdate.mockResolvedValueOnce(failedResult as any).mockResolvedValueOnce({ outcome: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' });
    const hooks = await ToolSearchPlugin(createContext() as any, { mode: 'keyword' } as any);

    await hooks.event!({ event: { type: 'session.created' } } as any);
    await hooks.event!({ event: { type: 'session.created' } } as any);

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('formats all four outcomes with the real formatter', async () => {
    expect((await vi.importActual<typeof import('../src/hooks/auto-update-checker.js')>('../src/hooks/auto-update-checker.js')).formatUpdateMessage({ outcome: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' })).toEqual({ title: 'Tool Search', message: 'Up-to-date', variant: 'info' });
    expect((await vi.importActual<typeof import('../src/hooks/auto-update-checker.js')>('../src/hooks/auto-update-checker.js')).formatUpdateMessage({ outcome: 'update-staged', currentVersion: '0.1.0', latestVersion: '0.2.0' })).toEqual({ title: 'Tool Search Update', message: 'v0.1.0 -> v0.2.0. Restart OpenCode to apply.', variant: 'warning' });
    expect((await vi.importActual<typeof import('../src/hooks/auto-update-checker.js')>('../src/hooks/auto-update-checker.js')).formatUpdateMessage({ outcome: 'invalidation-failed', currentVersion: '0.1.0', latestVersion: '0.2.0', error: 'remove failed' })).toEqual({ title: 'Tool Search Update Check', message: 'remove failed', variant: 'error' });
    expect((await vi.importActual<typeof import('../src/hooks/auto-update-checker.js')>('../src/hooks/auto-update-checker.js')).formatUpdateMessage({ outcome: 'check-failed', currentVersion: null, latestVersion: null, error: 'registry failed' })).toEqual({ title: 'Tool Search Update Check', message: 'registry failed', variant: 'error' });
  });

  it('latches after staged update and suppresses later check and toast', async () => {
    const context = createContext();
    checkForUpdate.mockImplementation(async () => ({ outcome: 'update-staged' as const, currentVersion: '0.1.0', latestVersion: '0.2.0' }));
    const hooks = await ToolSearchPlugin(context as any, { mode: 'keyword' } as any);
    await hooks.event!({ event: { type: 'session.created' } } as any);
    await vi.advanceTimersByTimeAsync(100);
    expect(context.client.tui.showToast).toHaveBeenCalledWith({ body: {
      title: 'Tool Search Update',
      message: 'v0.1.0 -> v0.2.0. Restart OpenCode to apply.',
      variant: 'warning',
      duration: 6000,
    }});
    const callsAfterFirst = checkForUpdate.mock.calls.length;
    const toastsAfterFirst = context.client.tui.showToast.mock.calls.length;
    await hooks.event!({ event: { type: 'session.created' } } as any);
    await vi.advanceTimersByTimeAsync(100);
    expect(checkForUpdate).toHaveBeenCalledTimes(callsAfterFirst);
    expect(context.client.tui.showToast).toHaveBeenCalledTimes(toastsAfterFirst);
  });

  it('notifies only staged and failed outcomes, using the centralized formatter', async () => {
    const context = createContext();
    const results: any[] = [
      { outcome: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' },
      { outcome: 'invalidation-failed', currentVersion: '0.1.0', latestVersion: '0.2.0', error: 'target removal failed' },
      { outcome: 'check-failed', currentVersion: '0.2.0', latestVersion: null, error: 'registry failed' },
      { outcome: 'update-staged', currentVersion: '0.1.0', latestVersion: '0.2.0' },
    ];
    checkForUpdate.mockImplementation(async () => results.shift());
    const hooks = await ToolSearchPlugin(context as any, { mode: 'keyword' } as any);

    for (let i = 0; i < 4; i += 1) {
      await hooks.event!({ event: { type: 'session.created' } } as any);
    }
    await hooks.event!({ event: { type: 'session.created' } } as any);
    await hooks.event!({ event: { type: 'session.created' } } as any);
    await hooks.event!({ event: { type: 'session.created' } } as any);
    await vi.advanceTimersByTimeAsync(100);

    expect(mockedFormatUpdateMessage).toHaveBeenCalledTimes(4);
    expect(context.client.tui.showToast).toHaveBeenCalledTimes(3);
    expect(context.client.tui.showToast).toHaveBeenNthCalledWith(1, { body: {
      title: 'Tool Search Update Check', message: 'target removal failed', variant: 'error', duration: 6000,
    }});
    expect(context.client.tui.showToast).toHaveBeenNthCalledWith(2, { body: {
      title: 'Tool Search Update Check', message: 'registry failed', variant: 'error', duration: 6000,
    }});
    expect(context.client.tui.showToast).toHaveBeenNthCalledWith(3, { body: {
      title: 'Tool Search Update', message: 'v0.1.0 -> v0.2.0. Restart OpenCode to apply.', variant: 'warning', duration: 6000,
    }});
  });

  it('notifies when the checker throws and permits a later retry', async () => {
    const context = createContext();
    checkForUpdate.mockRejectedValueOnce(new Error('unexpected checker failure')).mockResolvedValueOnce({ outcome: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' });
    const hooks = await ToolSearchPlugin(context as any, { mode: 'keyword' } as any);

    await hooks.event!({ event: { type: 'session.created' } } as any);
    await hooks.event!({ event: { type: 'session.created' } } as any);
    await vi.advanceTimersByTimeAsync(100);

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(context.client.tui.showToast).toHaveBeenCalledTimes(1);
  });

  it('ignores non-session events', async () => {
    const hooks = await ToolSearchPlugin(createContext() as any, { mode: 'keyword' } as any);

    await hooks.event!({ event: { type: 'session.deleted' } } as any);

    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});
