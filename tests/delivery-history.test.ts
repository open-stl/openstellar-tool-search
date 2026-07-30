import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DeliveryHistory,
  DeliveryHistoryPersistence,
  computeFingerprint,
} from '../src/delivery-history.js';
import type { ToolMeta } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTool(id: string, description: string, parameters: unknown = {}): ToolMeta {
  return { id, description, parameters };
}

const toolA = makeTool('tool_a', 'Tool A description', { type: 'object', properties: { x: { type: 'string' } } });
const toolB = makeTool('tool_b', 'Tool B description');
const toolAChanged = makeTool('tool_a', 'Tool A UPDATED description', { type: 'object', properties: { x: { type: 'string' } } });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeliveryHistory', () => {
  describe('filterNewDiscoveries splits correctly', () => {
    it('all hits are new on empty history', () => {
      const dh = new DeliveryHistory();
      const result = dh.filterNewDiscoveries('s1', [toolA, toolB]);
      expect(result.new).toHaveLength(2);
      expect(result.delivered).toHaveLength(0);
    });

    it('previously delivered hits are split into delivered', () => {
      const dh = new DeliveryHistory();
      dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));
      dh.recordDelivered('s1', 'tool_b', computeFingerprint(toolB));

      const result = dh.filterNewDiscoveries('s1', [toolA, toolB]);
      expect(result.new).toHaveLength(0);
      expect(result.delivered).toHaveLength(2);
    });

    it('mixed new and delivered are split correctly', () => {
      const dh = new DeliveryHistory();
      dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));

      const result = dh.filterNewDiscoveries('s1', [toolA, toolB]);
      expect(result.new).toHaveLength(1);
      expect(result.new[0].id).toBe('tool_b');
      expect(result.delivered).toHaveLength(1);
      expect(result.delivered[0].id).toBe('tool_a');
    });
  });

  describe('fingerprint change re-marks as new (rule 35)', () => {
    it('tool with changed description is treated as new discovery', () => {
      const dh = new DeliveryHistory();
      dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));

      // toolAChanged has different description -> different fingerprint
      const result = dh.filterNewDiscoveries('s1', [toolAChanged]);
      expect(result.new).toHaveLength(1);
      expect(result.new[0].id).toBe('tool_a');
      expect(result.delivered).toHaveLength(0);
    });

    it('tool with same fingerprint remains delivered', () => {
      const dh = new DeliveryHistory();
      dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));

      const result = dh.filterNewDiscoveries('s1', [toolA]);
      expect(result.new).toHaveLength(0);
      expect(result.delivered).toHaveLength(1);
    });
  });

  describe('session isolation', () => {
    it('delivery in one session does not affect another', () => {
      const dh = new DeliveryHistory();
      dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));

      const result = dh.filterNewDiscoveries('s2', [toolA]);
      expect(result.new).toHaveLength(1);
      expect(result.delivered).toHaveLength(0);
    });
  });

  describe('Compaction Reset clears history (rule 42)', () => {
    it('clear removes all entries for a session', () => {
      const dh = new DeliveryHistory();
      dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));
      dh.recordDelivered('s1', 'tool_b', computeFingerprint(toolB));

      dh.clear('s1');

      const result = dh.filterNewDiscoveries('s1', [toolA, toolB]);
      expect(result.new).toHaveLength(2);
      expect(result.delivered).toHaveLength(0);
    });

    it('clear does not affect other sessions', () => {
      const dh = new DeliveryHistory();
      dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));
      dh.recordDelivered('s2', 'tool_a', computeFingerprint(toolA));

      dh.clear('s1');

      const result = dh.filterNewDiscoveries('s2', [toolA]);
      expect(result.new).toHaveLength(0);
      expect(result.delivered).toHaveLength(1);
    });
  });
});

describe('DeliveryHistory Persistence (rule 43)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'tool-search-dh-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('persists and reloads delivery history across instances', async () => {
    const filePath = join(testDir, 'delivery-history.json');
    const persistence1 = new DeliveryHistoryPersistence({ filePath, debounceMs: 10 });
    const dh1 = new DeliveryHistory(persistence1);
    dh1.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));
    dh1.recordDelivered('s1', 'tool_b', computeFingerprint(toolB));
    await dh1.flush();

    // Verify file exists
    expect(existsSync(filePath)).toBe(true);

    // Load from a fresh instance
    const persistence2 = new DeliveryHistoryPersistence({ filePath, debounceMs: 10 });
    const dh2 = new DeliveryHistory(persistence2);

    // History should be restored
    expect(dh2.isNewDiscovery('s1', 'tool_a', computeFingerprint(toolA))).toBe(false);
    expect(dh2.isNewDiscovery('s1', 'tool_b', computeFingerprint(toolB))).toBe(false);

    // New tool should still be new
    const toolC = makeTool('tool_c', 'Tool C');
    expect(dh2.isNewDiscovery('s1', 'tool_c', computeFingerprint(toolC))).toBe(true);
  });

  it('persists with correct JSON schema', async () => {
    const filePath = join(testDir, 'delivery-history.json');
    const persistence = new DeliveryHistoryPersistence({ filePath, debounceMs: 10 });
    const dh = new DeliveryHistory(persistence);
    dh.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));
    await dh.flush();

    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content).toHaveProperty('s1');
    expect(Array.isArray(content.s1)).toBe(true);
    expect(content.s1[0]).toEqual({
      canonicalID: 'tool_a',
      fingerprint: computeFingerprint(toolA),
    });
  });

  it('clear persists to disk so restarts see cleared state', async () => {
    const filePath = join(testDir, 'delivery-history.json');
    const persistence1 = new DeliveryHistoryPersistence({ filePath, debounceMs: 10 });
    const dh1 = new DeliveryHistory(persistence1);
    dh1.recordDelivered('s1', 'tool_a', computeFingerprint(toolA));
    await dh1.flush();

    // Clear and flush
    dh1.clear('s1');
    await dh1.flush();

    // Reload — should see empty history
    const persistence2 = new DeliveryHistoryPersistence({ filePath, debounceMs: 10 });
    const dh2 = new DeliveryHistory(persistence2);
    expect(dh2.isNewDiscovery('s1', 'tool_a', computeFingerprint(toolA))).toBe(true);
  });
});

describe('computeFingerprint', () => {
  it('produces stable hash for same input', () => {
    const fp1 = computeFingerprint(toolA);
    const fp2 = computeFingerprint(toolA);
    expect(fp1).toBe(fp2);
  });

  it('produces different hash for different descriptions', () => {
    const fp1 = computeFingerprint(toolA);
    const fp2 = computeFingerprint(toolAChanged);
    expect(fp1).not.toBe(fp2);
  });

  it('produces different hash for different parameters', () => {
    const toolAParams1 = makeTool('tool_a', 'Same desc', { type: 'object', properties: { x: { type: 'string' } } });
    const toolAParams2 = makeTool('tool_a', 'Same desc', { type: 'object', properties: { y: { type: 'number' } } });
    expect(computeFingerprint(toolAParams1)).not.toBe(computeFingerprint(toolAParams2));
  });

  it('F3: same keys in different order produce identical fingerprint', () => {
    const paramsA = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } };
    const paramsB = { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' };
    const fp1 = computeFingerprint(makeTool('tool_x', 'desc', paramsA));
    const fp2 = computeFingerprint(makeTool('tool_x', 'desc', paramsB));
    expect(fp1).toBe(fp2);
  });
});
