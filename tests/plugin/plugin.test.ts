import { describe, expect, it } from 'vitest';

/**
 * Plugin hook integration tests require the OpenCode runtime.
 * Pure function tests (summarizeParameters, flattenParameterKeys)
 * are covered in tests/shared/schema.test.ts.
 *
 * This file validates plugin module structure without runtime deps.
 */

describe('ToolSearchPlugin', () => {
  it('exports ToolSearchPlugin function', async () => {
    const mod = await import('../../src/plugin/index.js');
    expect(typeof mod.ToolSearchPlugin).toBe('function');
  });
});
