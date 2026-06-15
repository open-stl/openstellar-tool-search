import { describe, expect, it } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';

describe('ToolSearchPlugin', () => {
  it('exports a plugin function', () => {
    expect(typeof ToolSearchPlugin).toBe('function');
  });
});
