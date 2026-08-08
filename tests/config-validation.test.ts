import { describe, it, expect, vi } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { PluginInput } from '@opencode-ai/plugin';

describe('Simplified ToolSearchConfig Surface & Validation', () => {
  it('emits console.warn when unknown or deprecated configuration options are passed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockCtx = {} as PluginInput;

    await ToolSearchPlugin.server(mockCtx, {
      alwaysLoad: ['my_tool'],
      maxResults: 5,
      bm25: { k1: 1.2 },
      invalidKnob: 'value',
    } as any);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ToolSearchPlugin] Unknown or deprecated configuration key "bm25"')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ToolSearchPlugin] Unknown or deprecated configuration key "invalidKnob"')
    );

    warnSpy.mockRestore();
  });

  it('does not emit console.warn when only valid configuration options are passed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockCtx = {} as PluginInput;

    const hooks = await ToolSearchPlugin.server(mockCtx, {
      alwaysLoad: ['critical_tool'],
      maxResults: 8,
      mode: 'keyword',
      resetTools: ['compress'],
    });

    const pluginWarns = warnSpy.mock.calls.filter(([arg]) =>
      typeof arg === 'string' && arg.startsWith('[ToolSearchPlugin]')
    );
    expect(pluginWarns).toHaveLength(0);
    expect(hooks.tool).toHaveProperty('tool_search');
    expect(hooks.tool).toHaveProperty('tool_search_regex');

    warnSpy.mockRestore();
  });
});
