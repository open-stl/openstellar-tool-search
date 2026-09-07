import { describe, it, expect } from 'vitest';
import { Schema } from 'effect';
import { ToolVault } from '../src/catalog/vault.js';
import { ToolStore } from '../src/catalog/tool-store.js';
import { RankEngine } from '../src/catalog/rank.js';
import { SemanticMatcher } from '../src/catalog/matcher.js';
import { normalizeParameters } from '../src/catalog/schema-normalize.js';
import { computeFingerprint } from '../src/engine/delivery-history.js';
import type { ToolMeta } from '../src/types.js';

// ============================================================================
// ToolVault & ToolStore
// ============================================================================

describe('ToolVault & ToolStore', () => {
  const toolA: ToolMeta = {
    id: 'git_commit',
    description: 'Record changes to the repository',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
      },
    },
  };

  it('stores tools, counts items, and resolves by exact ID', () => {
    const vault = new ToolVault({ embedding: { enabled: false } });
    expect(vault.count).toBe(0);

    vault.add(toolA.id, toolA.description, toolA.parameters);
    expect(vault.count).toBe(1);
    expect(vault.get('git_commit')).toEqual(toolA);
    expect(vault.get('nonexistent')).toBeUndefined();
  });

  it('guards against truncated-description poisoning (defer label is the fixed [deferred])', () => {
    const vault = new ToolVault({ embedding: { enabled: false } });

    // 1. Full description stored first (as plugin.tool.definition captures pristine before truncation)
    vault.add(toolA.id, 'Record changes to the repository with detailed schema docs', toolA.parameters);
    expect(vault.get('git_commit')?.description).toBe('Record changes to the repository with detailed schema docs');

    // 2. Truncated description with the FIXED label arrives later (as applyContextTurn does)
    vault.add(toolA.id, 'Record changes to the repository [deferred]', { type: 'object', properties: { reason: { type: 'string' } } });

    // 3. The full description must be preserved — truncated text must NOT overwrite it
    expect(vault.get('git_commit')?.description).toBe('Record changes to the repository with detailed schema docs');
    expect(vault.get('git_commit')?.parameters).toEqual(toolA.parameters);
  });

  it('resolves _ide aliases to canonical tools', () => {
    const store = new ToolStore();
    store.add(toolA.id, toolA.description, toolA.parameters);

    expect(store.resolveAlias('git_commit')).toEqual(toolA);
    expect(store.resolveAlias('git_commit_ide')).toEqual(toolA);
    expect(store.resolveAlias('unknown_ide')).toBeUndefined();
  });

  it('prefers canonical tool over alias when both exist', () => {
    const store = new ToolStore();
    store.add('foo', 'Canonical foo', {});
    store.add('foo_ide', 'Real foo_ide', {});

    expect(store.resolveAlias('foo')?.id).toBe('foo');
    expect(store.resolveAlias('foo_ide')?.id).toBe('foo_ide');
  });

  it('greps by regex pattern with _ide fallback', () => {
    const store = new ToolStore();
    store.add(toolA.id, toolA.description, toolA.parameters);

    const hits = store.grep('git_commit_ide', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('git_commit');

    const exactHits = store.grep('^git_', 10);
    expect(exactHits).toHaveLength(1);
    expect(exactHits[0].id).toBe('git_commit');
  });

  it('greps flexibly across hyphens and underscores', () => {
    const store = new ToolStore();
    store.add('codebase-memory_list_projects', 'List indexed projects', {});

    // Exact search with snake_case
    expect(store.grep('^codebase_memory_list_projects$', 10)).toHaveLength(1);
    expect(store.grep('^codebase_memory_list_projects$', 10)[0].id).toBe('codebase-memory_list_projects');

    // Exact search with kebab-case
    expect(store.grep('^codebase-memory-list-projects$', 10)).toHaveLength(1);

    // Partial regex search
    expect(store.grep('.*list_projects.*', 10)).toHaveLength(1);
    expect(store.grep('.*list-projects.*', 10)).toHaveLength(1);

    // Multi-tool regex alternation
    expect(store.grep('^(codebase_memory_list_projects|other_tool)$', 10)).toHaveLength(1);
  });

  it('prepares indexed text from description and schema properties', () => {
    const store = new ToolStore();
    const text = store.prepareIndexedText(toolA);

    expect(text).toContain('git_commit');
    expect(text).toContain('Record changes');
    expect(text).toContain('message');
    expect(text).toContain('Commit message');
  });

  it('delegates awaitReady to registered providers', async () => {
    const vault = new ToolVault({ embedding: { enabled: false } });
    let readyCalled = false;
    await vault.registerProvider({
      getTools: () => [],
      awaitReady: async () => {
        readyCalled = true;
        return true;
      },
    });

    await vault.awaitReady(500);
    expect(readyCalled).toBe(true);
  });
});

// ============================================================================
// RankEngine & BM25 / SearchEngine
// ============================================================================

describe('RankEngine', () => {
  const items = [
    { id: 'git_commit', desc: 'creates a git commit' },
    { id: 'read_file', desc: 'reads file contents from filesystem' },
    { id: 'figma_create', desc: 'creates a figma vector shape' },
  ];

  it('returns empty for untrained engine', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    expect(r.query('git', 5)).toEqual([]);
    expect(r.trained).toBe(false);
  });

  it('ranks by BM25 relevance and respects limit', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    r.feed(items, (x) => [x.id, x.desc]);
    expect(r.trained).toBe(true);

    const results = r.query('creates', 5);
    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(0);

    const limited = r.query('creates', 1);
    expect(limited.length).toBe(1);
  });

  it('handles empty query and non-matching query', () => {
    const r = new RankEngine<{ id: string; desc: string }>(0.9, 0.4);
    r.feed(items, (x) => [x.id, x.desc]);

    expect(r.query('', 5)).toEqual([]);
    expect(r.query('nonexistentunmatchedterm', 5)).toEqual([]);
  });

  it('ToolVault queries via BM25 ranking when embeddings are disabled', async () => {
    const vault = new ToolVault({ embedding: { enabled: false } });
    vault.add('git_commit', 'creates a git commit with message', {});
    vault.add('read_file', 'reads file contents from disk', {});
    vault.add('figma_create', 'creates a figma canvas shape', {});

    const hits = await vault.query('creates', 5);
    expect(hits.length).toBe(2);
    expect(hits.map((h) => h.id)).toContain('git_commit');
    expect(hits.map((h) => h.id)).toContain('figma_create');
  });
});

// ============================================================================
// SemanticMatcher
// ============================================================================

describe('SemanticMatcher', () => {
  it('instantiates and reports configuration state', () => {
    const m = new SemanticMatcher({
      enabled: true,
      model: 'Xenova/all-MiniLM-L6-v2',
      threshold: 0.5,
      quantized: true,
    });
    expect(m).toBeInstanceOf(SemanticMatcher);
    expect(m.active).toBe(false);
    expect(m.entryCount).toBe(0);
    expect(m.fault).toBeNull();
  });

  it('handles empty index and locate gracefully', async () => {
    const m = new SemanticMatcher({ enabled: false });
    await m.open();
    await m.index([]);
    expect(m.entryCount).toBe(0);

    const scores = await m.locate('any query');
    expect(scores.size).toBe(0);
  });

  it('supports vector caching flag configuration', () => {
    const m = new SemanticMatcher({
      enabled: true,
      cache: true,
      cacheDir: '/tmp/test-vectors',
      threshold: 0.7,
    });
    expect(m.isCacheEnabled).toBe(true);
  });
});

// ============================================================================
// Schema Normalization & Fingerprinting
// ============================================================================

describe('schema-normalize: Effect Schema & JSON Schema', () => {
  it('converts an Effect Schema to JSON Schema without AST leaks', () => {
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
    expect((JSON.parse(text) as { properties: { id: { type: string } } }).properties.id.type).toBe('string');
  });

  it('caches normalized schema for the same instance', () => {
    const schema = Schema.Struct({ a: Schema.String });
    const first = normalizeParameters(schema);
    const second = normalizeParameters(schema);
    expect(second).toBe(first);
  });

  it('passes MCP JSON Schema and primitives through untouched', () => {
    const mcpSchema = {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location'],
    };
    expect(normalizeParameters(mcpSchema)).toBe(mcpSchema);
    expect(normalizeParameters({})).toEqual({});
    expect(normalizeParameters(null)).toBeNull();
    expect(normalizeParameters(undefined)).toBeUndefined();
    expect(normalizeParameters('primitive')).toBe('primitive');
  });

  it('prefers explicit jsonSchema field over raw parameters', () => {
    const schema = Schema.Struct({ query: Schema.String });
    const jsonSchema = { type: 'object', properties: { query: { type: 'string' } } };
    expect(normalizeParameters(schema, jsonSchema)).toBe(jsonSchema);
  });

  it('safely handles cyclical $ref schemas without crashing or stack overflow', () => {
    const cyclicalSchema: Record<string, unknown> = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      $defs: {
        Node: {
          type: 'object',
          properties: {
            next: { $ref: '#/$defs/Node' },
            val: { type: 'string' },
          },
        },
      },
      properties: {
        root: { $ref: '#/$defs/Node' },
      },
    };

    expect(() => normalizeParameters(cyclicalSchema)).not.toThrow();
    const result = normalizeParameters(cyclicalSchema) as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.type).toBe('object');
  });

  it('computes stable fingerprints across identical shapes and detects changes', () => {
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

    expect(computeFingerprint(toolA)).toBe(computeFingerprint(toolB));
    expect(computeFingerprint(toolA)).toMatch(/^[0-9a-f]{64}$/);

    const toolChanged: ToolMeta = {
      id: 'effect_tool',
      description: 'Updated tool',
      parameters: normalizeParameters(make()),
    };
    expect(computeFingerprint(toolA)).not.toBe(computeFingerprint(toolChanged));
  });

  it('normalizes deeply nested properties and array schemas', () => {
    const complexSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Tag name' },
                  weight: { type: 'number', description: 'Tag weight' },
                },
                required: ['name'],
              },
            },
          },
        },
      },
    };

    const out = normalizeParameters(complexSchema);
    expect(out).toBeDefined();
    const doc = out as typeof complexSchema;
    expect(doc.properties.filter.properties.tags.items.properties.name.description).toBe('Tag name');
  });

  it('resolves multi-level $defs and nested $ref references', () => {
    const multiRefSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      $defs: {
        Pagination: {
          type: 'object',
          properties: {
            cursor: { $ref: '#/$defs/Cursor' },
            limit: { type: 'number' },
          },
        },
        Cursor: {
          type: 'string',
          description: 'Pagination resume cursor token',
        },
      },
      properties: {
        page: { $ref: '#/$defs/Pagination' },
      },
    };

    const out = normalizeParameters(multiRefSchema);
    const text = JSON.stringify(out);
    expect(text).not.toContain('$ref');
    expect(text).not.toContain('$defs');
    expect(text).toContain('Pagination resume cursor token');
  });

  it('extracts search text from nested object and array parameter structures in ToolStore', () => {
    const store = new ToolStore();
    const meta: ToolMeta = {
      id: 'nested_search_tool',
      description: 'Finds items with deep criteria',
      parameters: {
        type: 'object',
        properties: {
          criteria: {
            type: 'object',
            properties: {
              subfield: { type: 'string', description: 'Subfield query criteria' },
            },
          },
          batches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                batchName: { type: 'string', description: 'Name of the batch payload' },
              },
            },
          },
        },
      },
    };

    const text = store.prepareIndexedText(meta);
    expect(text).toContain('nested_search_tool');
    expect(text).toContain('Finds items');
    expect(text).toContain('criteria.subfield');
    expect(text).toContain('Subfield query criteria');
    expect(text).toContain('batches.batchName');
    expect(text).toContain('Name of the batch payload');
  });
});
