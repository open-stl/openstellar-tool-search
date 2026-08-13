import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionToolRegistry } from '../src/engine/session-tool-registry.js';
import type { ToolMeta } from '../src/types.js';

describe('SessionToolRegistry', () => {
  let testFile: string;

  beforeEach(() => {
    testFile = join(tmpdir(), `test-session-registry-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(() => {
    if (existsSync(testFile)) {
      try { rmSync(testFile, { force: true }); } catch {}
    }
  });

  const toolA: ToolMeta = { id: 'tool_a', description: 'Tool A description', parameters: { type: 'object' } };
  const toolB: ToolMeta = { id: 'tool_b', description: 'Tool B description', parameters: { type: 'object' } };
  const toolC: ToolMeta = { id: 'tool_c', description: 'Tool C description', parameters: { type: 'object' } };

  it('registers tools as deferred when not in alwaysOn', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    expect(registry.registerTool('tool_search')).toBe(false);
    expect(registry.registerTool('tool_a')).toBe(true);
    expect(registry.deferredCount).toBe(1);
  });

  it('processes search results and authorizes new discoveries', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    registry.registerTool('tool_a');
    registry.registerTool('tool_b');

    const res = registry.processSearchResult('session-1', [toolA, toolB], 10);
    expect(res.kind).toBe('new');
    expect(res.hits).toHaveLength(2);
    expect(res.responseText).toContain('Found 2 tool(s):');
    expect(registry.isAuthorized('session-1', 'tool_a')).toBe(true);
    expect(registry.isAuthorized('session-1', 'tool_b')).toBe(true);
  });

  it('returns No-Op Discovery when all results are previously delivered and authorized', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    registry.registerTool('tool_a');
    registry.processSearchResult('session-1', [toolA], 10);

    const second = registry.processSearchResult('session-1', [toolA], 10);
    expect(second.kind).toBe('no-op');
    expect(second.hits).toHaveLength(1);
    expect(second.responseText).toBe('No new tools discovered. Previously delivered: tool_a.');
  });

  it('enforces Rule 41: re-authorizes previously delivered tools when authorization was cleared', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    registry.registerTool('tool_a');
    registry.registerTool('tool_b');

    // Initial search delivers tool_a and tool_b
    registry.processSearchResult('session-1', [toolA, toolB], 10);

    // Authorization Reset clears authorization but preserves delivery history
    registry.resetAuthorization('session-1');
    expect(registry.isAuthorized('session-1', 'tool_a')).toBe(false);

    // Subsequent search for tool_a and tool_c (tool_a delivered but unauthorized, tool_c new)
    const res = registry.processSearchResult('session-1', [toolA, toolC], 10);
    expect(res.kind).toBe('new');
    expect(res.hits.map((h: ToolMeta) => h.id)).toContain('tool_a');
    expect(res.hits.map((h: ToolMeta) => h.id)).toContain('tool_c');
    expect(registry.isAuthorized('session-1', 'tool_a')).toBe(true);

    // Reset authorization again, then search ONLY for tool_a (pure re-auth)
    registry.resetAuthorization('session-1');
    const reAuthRes = registry.processSearchResult('session-1', [toolA], 10);
    expect(reAuthRes.kind).toBe('re-auth');
    expect(reAuthRes.hits.map((h: ToolMeta) => h.id)).toEqual(['tool_a']);
    expect(registry.isAuthorized('session-1', 'tool_a')).toBe(true);
  });

  it('performs Compaction Reset: clears both authorization and delivery history', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    registry.registerTool('tool_a');
    registry.processSearchResult('session-1', [toolA], 10);

    registry.compactSession('session-1');
    expect(registry.isAuthorized('session-1', 'tool_a')).toBe(false);

    // After compaction reset, tool_a is treated as a new discovery again
    const res = registry.processSearchResult('session-1', [toolA], 10);
    expect(res.kind).toBe('new');
  });

  it('checks execution reminder requirements', () => {
    const registry = new SessionToolRegistry({
      alwaysOn: ['tool_search'],
      resetTools: ['compress'],
      filePath: testFile,
      debounceMs: 10,
    });

    registry.registerTool('tool_a');

    // Tool A requires reminder before search
    expect(registry.requiresReminder('session-1', 'tool_a', 'tool_a')).toBe(true);

    // Search authorizes tool_a
    registry.processSearchResult('session-1', [toolA], 10);
    expect(registry.requiresReminder('session-1', 'tool_a', 'tool_a')).toBe(false);

    // Reset tool (e.g. compress) clears authorization on execute
    expect(registry.resetIfConfigured('compress', 'session-1')).toBe(true);
    expect(registry.requiresReminder('session-1', 'tool_a', 'tool_a')).toBe(true);
  });

  it('persists delivery history to disk across registry reloads', async () => {
    const deliveryFile = testFile.replace(/\.json$/, '-delivery.json');
    try {
      const registry1 = new SessionToolRegistry({
        alwaysOn: ['tool_search'],
        resetTools: ['compress'],
        filePath: testFile,
        debounceMs: 0,
      });

      registry1.registerTool('tool_a');
      registry1.processSearchResult('session-1', [toolA], 10);

      await new Promise((r) => setTimeout(r, 20));
      expect(existsSync(deliveryFile)).toBe(true);

      const registry2 = new SessionToolRegistry({
        alwaysOn: ['tool_search'],
        resetTools: ['compress'],
        filePath: testFile,
        debounceMs: 0,
      });

      registry2.registerTool('tool_a');
      const secondRes = registry2.processSearchResult('session-1', [toolA], 10);
      expect(secondRes.kind).toBe('no-op');
    } finally {
      if (existsSync(deliveryFile)) {
        try { rmSync(deliveryFile, { force: true }); } catch {}
      }
    }
  });

  it('compactSession clears both authorization and delivery history on disk', async () => {
    const deliveryFile = testFile.replace(/\.json$/, '-delivery.json');
    try {
      const registry1 = new SessionToolRegistry({
        alwaysOn: ['tool_search'],
        resetTools: ['compress'],
        filePath: testFile,
        debounceMs: 0,
      });

      registry1.registerTool('tool_a');
      registry1.processSearchResult('session-1', [toolA], 10);

      await new Promise((r) => setTimeout(r, 20));

      registry1.compactSession('session-1');

      await new Promise((r) => setTimeout(r, 20));

      const registry2 = new SessionToolRegistry({
        alwaysOn: ['tool_search'],
        resetTools: ['compress'],
        filePath: testFile,
        debounceMs: 0,
      });

      registry2.registerTool('tool_a');
      const secondRes = registry2.processSearchResult('session-1', [toolA], 10);
      expect(secondRes.kind).toBe('new');
    } finally {
      if (existsSync(deliveryFile)) {
        try { rmSync(deliveryFile, { force: true }); } catch {}
      }
    }
  });
});
