import { describe, expect, it } from 'vitest';
import { flattenParameterKeys, summarizeParameters } from '../../src/shared/index.js';

describe('flattenParameterKeys', () => {
  it('returns empty for null input', () => {
    expect(flattenParameterKeys(null)).toEqual([]);
  });

  it('returns empty for undefined input', () => {
    expect(flattenParameterKeys(undefined)).toEqual([]);
  });

  it('returns empty for non-object input', () => {
    expect(flattenParameterKeys('string')).toEqual([]);
  });

  it('returns empty for object without properties', () => {
    expect(flattenParameterKeys({})).toEqual([]);
  });

  it('returns flat keys for simple schema', () => {
    const result = flattenParameterKeys({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
    });
    expect(result).toContain('query');
    expect(result).toContain('limit');
    expect(result.length).toBe(2);
  });

  it('returns nested keys with dot notation', () => {
    const result = flattenParameterKeys({
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            date: { type: 'string' },
          },
        },
      },
    });
    expect(result).toContain('filters');
    expect(result).toContain('filters.status');
    expect(result).toContain('filters.date');
  });

  it('handles array-of-object schemas', () => {
    const result = flattenParameterKeys({
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
            },
          },
        },
      },
    });
    expect(result).toContain('tags');
    expect(result).toContain('tags.name');
    expect(result).toContain('tags.value');
  });

  it('handles deeply nested schemas', () => {
    const result = flattenParameterKeys({
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            b: {
              type: 'object',
              properties: {
                c: { type: 'string' },
              },
            },
          },
        },
      },
    });
    expect(result).toContain('a');
    expect(result).toContain('a.b');
    expect(result).toContain('a.b.c');
  });

  it('includes non-object property definitions as valid parameter names', () => {
    const result = flattenParameterKeys({
      type: 'object',
      properties: {
        good: { type: 'string' },
        bad: null,
        worse: 'not-an-object',
      },
    });
    // flattenParameterKeys pushes all parameter names, even for null/non-object defs
    expect(result).toContain('good');
    expect(result).toContain('bad');
    expect(result).toContain('worse');
  });

  it('returns all top-level keys even when all defs are non-object', () => {
    const result = flattenParameterKeys({
      type: 'object',
      properties: { bad: null },
    });
    // Even null/string definitions produce a key entry
    expect(result).toEqual(['bad']);
  });
});

describe('summarizeParameters', () => {
  it('returns (none) for null', () => {
    expect(summarizeParameters(null)).toBe('(none)');
  });

  it('returns (none) for undefined', () => {
    expect(summarizeParameters(undefined)).toBe('(none)');
  });

  it('returns (none) for non-object', () => {
    expect(summarizeParameters('string')).toBe('(none)');
    expect(summarizeParameters(42)).toBe('(none)');
  });

  it('returns (none) for object without properties', () => {
    expect(summarizeParameters({})).toBe('(none)');
    expect(summarizeParameters({ type: 'object' })).toBe('(none)');
  });

  it('summarizes a simple schema with required field', () => {
    const schema = {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords',
        },
      },
      required: ['query'],
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('query');
    expect(result).toContain('string');
    expect(result).toContain('(required)');
    expect(result).toContain('Search keywords');
  });

  it('marks optional fields without (required)', () => {
    const schema = {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max results',
        },
      },
      required: [],
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('limit');
    expect(result).not.toContain('(required)');
  });

  it('handles multiple properties', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('query');
    expect(result).toContain('limit');
  });

  it('handles property without description', () => {
    const schema = {
      type: 'object',
      properties: {
        flag: { type: 'boolean' },
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('flag');
    expect(result).toContain('boolean');
  });

  it('handles property without type', () => {
    const schema = {
      type: 'object',
      properties: {
        data: { description: 'Some data' },
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('unknown');
  });

  it('skips non-object property definitions', () => {
    const schema = {
      type: 'object',
      properties: {
        good: { type: 'string' },
        bad: null,
        worse: 'not-an-object',
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('good');
    expect(result).not.toContain('bad');
    expect(result).not.toContain('worse');
  });

  it('returns (none) when all properties are non-object', () => {
    const schema = {
      type: 'object',
      properties: {
        bad: null,
      },
    };
    expect(summarizeParameters(schema)).toBe('(none)');
  });

  it('flattens nested object parameters with dot notation', () => {
    const schema = {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          description: 'Filter criteria',
          properties: {
            status: { type: 'string', description: 'Filter by status' },
            date: { type: 'string', description: 'Filter by date' },
          },
        },
        limit: { type: 'number', description: 'Max results' },
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('limit');
    expect(result).toContain('filters.status');
    expect(result).toContain('filters.date');
    expect(result).toContain('filters');
    expect(result).toContain('Filter criteria');
  });

  it('handles array-of-object in summarizeParameters', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Tag name' },
            },
          },
        },
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('tags');
    expect(result).toContain('tags.name');
  });
});
