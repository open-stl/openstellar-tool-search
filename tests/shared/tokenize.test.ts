import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/shared/index.js';

describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips non-alphanumeric characters', () => {
    expect(tokenize('file.read()')).toEqual(['file', 'read']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles mixed punctuation and numbers', () => {
    expect(tokenize('v2.0-beta_3')).toEqual(['v2', '0', 'beta', '3']);
  });

  it('collapses multiple spaces', () => {
    expect(tokenize('a   b   c')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for number input', () => {
    expect(tokenize(42 as unknown as string)).toEqual([]);
  });

  it('returns empty array for boolean input', () => {
    expect(tokenize(true as unknown as string)).toEqual([]);
  });

  it('returns empty array for null input', () => {
    expect(tokenize(null as unknown as string)).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });
});
