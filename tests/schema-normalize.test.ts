import { describe, it, expect } from 'vitest';
import { Schema } from 'effect';
import { normalizeParameters } from '../src/catalog/schema-normalize.js';
import { computeFingerprint } from '../src/engine/delivery-history.js';
import type { ToolMeta } from '../src/types.js';

/**
 * Focused regression tests for Effect Schema → JSON Schema conversion
 * (docs/research/effect-schema-parameter-display.md).
 *
 * Raw Effect Schema instances captured from OpenCode's tool.definition hook
 * must become model-facing JSON Schema before catalog storage; MCP / plain
 * JSON Schema must pass through untouched; unsupported shapes must fall back
 * safely; fingerprints must be stable across distinct Schema instances with
 * the same shape.
 */

describe('normalizeParameters: Effect Schema conversion', () => {
  it('converts a real Effect Schema to JSON Schema (no AST leak)', () => {
    const schema = Schema.Struct({
      query: Schema.String.annotate({ description: 'Search query text' }),
      limit: Schema.Number,
    });

    const out = normalizeParameters(schema);
    const text = JSON.stringify(out);

    expect(out).not.toBe(schema);
    expect(text).not.toContain('~effect/Schema');
    expect(text).not.toContain('"_tag"');
    expect(text).not.toContain('typeParameters');
    expect(text).not.toContain('"ast"');

    const doc = JSON.parse(text) as Record<string, unknown>;
    expect(doc.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(doc.type).toBe('object');
    const props = doc.properties as Record<string, unknown>;
    expect(props).toBeDefined();
    expect((props.query as Record<string, unknown>).description).toBe('Search query text');
    expect((props.limit as Record<string, unknown>).type).toBe('number');
    expect(doc.required).toEqual(expect.arrayContaining(['query', 'limit']));
  });

  it('inlines $defs references into a self-contained document', () => {
    const Id = Schema.String.annotate({ identifier: 'MyId' });
    const schema = Schema.Struct({ id: Id, name: Schema.String });

    const out = normalizeParameters(schema);
    const text = JSON.stringify(out);

    expect(text).not.toContain('$ref');
    expect(text).not.toContain('$defs');
    expect(text).toContain('"type":"string"');
    // The identifier target must be inlined where the $ref was.
    expect((JSON.parse(text) as { properties: { id: { type: string } } }).properties.id.type).toBe('string');
  });

  it('converts the SAME instance identically (WeakMap cache)', () => {
    const schema = Schema.Struct({ a: Schema.String });
    const first = normalizeParameters(schema);
    const second = normalizeParameters(schema);
    expect(second).toBe(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not mutate the caller-provided output.parameters object', () => {
    // Effect Schema instances are not plain objects; pass-through plain JSON
    // Schema must keep its reference (test 19 contract).
    const plain = { type: 'object', properties: { x: { type: 'string' } } };
    expect(normalizeParameters(plain)).toBe(plain);
  });
});

describe('normalizeParameters: MCP JSON Schema pass-through', () => {
  it('passes the MCP inputSchema shape through byte-identical', () => {
    const mcpSchema = {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location'],
    };
    expect(normalizeParameters(mcpSchema)).toBe(mcpSchema);
    expect(JSON.stringify(normalizeParameters(mcpSchema))).toBe(JSON.stringify(mcpSchema));
  });

  it('passes {} / null / undefined / primitives through', () => {
    expect(normalizeParameters({})).toEqual({});
    expect(normalizeParameters(null)).toBeNull();
    expect(normalizeParameters(undefined)).toBeUndefined();
    expect(normalizeParameters('not-an-object')).toBe('not-an-object');
  });
});

describe('normalizeParameters: unsupported-schema fallback', () => {
  it('returns undefined (omit) instead of crashing on a malformed Effect-shaped object', () => {
    // A value carrying an internal `ast` but not a valid Schema — the
    // converter's toJsonSchemaDocument throws; the fallback omits parameters.
    const fake = { ast: { _tag: 'Objects', fields: {} }, notARealSchema: true };
    expect(normalizeParameters(fake)).toBeUndefined();
  });

  it('never throws for any input (no-crash contract)', () => {
    const inputs: unknown[] = [
      { ast: { _tag: 'Broken' } },
      { ast: null },
      { ast: 42 },
      { ast: { _tag: 'Objects', fields: { a: { _tag: 'Missing' } } } },
      { type: 'object', properties: { circular: undefined } },
      [],
      new Date(),
      Symbol('x'),
    ];
    for (const input of inputs) {
      expect(() => normalizeParameters(input)).not.toThrow();
    }
  });
});

describe('normalizeParameters: jsonSchema field preference', () => {
  it('prefers the provided jsonSchema over the raw parameters', () => {
    const schema = Schema.Struct({ query: Schema.String });
    const jsonSchema = { type: 'object', properties: { query: { type: 'string' } } };
    expect(normalizeParameters(schema, jsonSchema)).toBe(jsonSchema);
  });
});

describe('stable fingerprints across distinct Schema instances', () => {
  it('computeFingerprint is identical for two distinct instances of the same shape', () => {
    const make = () =>
      Schema.Struct({
        query: Schema.String.annotate({ description: 'Search query' }),
        limit: Schema.Number,
      });

    const toolA: ToolMeta = {
      id: 'effect_tool',
      description: 'Effect tool',
      parameters: normalizeParameters(make()),
    };
    const toolB: ToolMeta = {
      id: 'effect_tool',
      description: 'Effect tool',
      parameters: normalizeParameters(make()),
    };

    expect(toolA.parameters).not.toBe(toolB.parameters); // distinct Schema instances
    expect(JSON.stringify(toolA.parameters)).toBe(JSON.stringify(toolB.parameters));
    expect(computeFingerprint(toolA)).toBe(computeFingerprint(toolB));
  });

  it('fingerprint CHANGES when the shape changes', () => {
    const schemaA = normalizeParameters(Schema.Struct({ a: Schema.String }));
    const schemaB = normalizeParameters(Schema.Struct({ a: Schema.String, b: Schema.Number }));

    const toolA: ToolMeta = { id: 't', description: 'd', parameters: schemaA };
    const toolB: ToolMeta = { id: 't', description: 'd', parameters: schemaB };
    expect(computeFingerprint(toolA)).not.toBe(computeFingerprint(toolB));
  });

  it('fingerprint does not contain AST noise', () => {
    const fp = computeFingerprint({
      id: 't',
      description: 'd',
      parameters: normalizeParameters(Schema.Struct({ a: Schema.String })),
    });
    // sha256 hex digest — 64 hex chars, no AST fragments.
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
