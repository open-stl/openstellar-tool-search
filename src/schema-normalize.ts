import { Schema, JsonSchema } from 'effect';

/**
 * Deep module owning Effect-Schema → JSON Schema conversion for tool
 * parameters captured from OpenCode's `tool.definition` hook.
 *
 * OpenCode's hook contract types `output.parameters` as `any`
 * (`@opencode-ai/plugin` `Hooks["tool.definition"]`): for Effect-declared
 * tools it is a live Effect `Schema` instance whose `JSON.stringify` leaks the
 * internal AST (e.g. `{"ast":{"~effect/Schema":...}}`). MCP servers deliver
 * `inputSchema` as JSON Schema by spec, so those must pass through unchanged.
 *
 * This module detects the shape at the single ingestion choke point
 * (`session-runtime.ts deferTool`) and converts once — before catalog
 * storage — so `tool_search` output, delivery-history fingerprints, and the
 * search index all see a stable JSON Schema document instead of a raw AST.
 *
 * The conversion mirrors opencode's own `packages/opencode/src/tool/json-schema.ts`
 * (`Schema.toJsonSchemaDocument(schema, { additionalProperties: true })`,
 * 2020-12 `$schema`, `$defs` inlined, `additionalProperties: true` dropped
 * as it is the JSON-Schema default).
 */

const CACHE = new WeakMap<object, unknown>();

/**
 * Recursively inline local `$ref`/`$defs` references (opencode's
 * `inlineLocalReferences`): replaces `#/$defs/<name>` with the target
 * definition so the model sees a self-contained document.
 */
function inlineLocalReferences(value: unknown, definitions?: Record<string, unknown>, seen = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((item) => inlineLocalReferences(item, definitions, seen));
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const localDefinitions = definitions ?? (typeof record.$defs === 'object' && record.$defs !== null
    ? record.$defs as Record<string, unknown>
    : undefined);
  if (typeof record.$ref === 'string' && localDefinitions) {
    const name = record.$ref.match(/^#\/\$defs\/(.+)$/)?.[1] ?? record.$ref.match(/^#\/definitions\/(.+)$/)?.[1];
    if (name && !seen.has(name)) {
      const target = localDefinitions[name];
      if (target && typeof target === 'object') {
        const { $ref: _drop, ...rest } = record;
        return inlineLocalReferences(
          { ...(target as Record<string, unknown>), ...rest },
          localDefinitions,
          new Set(seen).add(name),
        );
      }
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, inlineLocalReferences(item, localDefinitions, seen)]),
  );
}

/** True when any local `$ref` remains in the tree. */
function hasLocalReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasLocalReference);
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.$ref === 'string' &&
    (record.$ref.startsWith('#/$defs/') || record.$ref.startsWith('#/definitions/'))
  ) {
    return true;
  }
  return Object.values(record).some(hasLocalReference);
}

/** Drop `$defs`/`definitions` once every local reference has been inlined. */
function dropDefinitionsIfResolved(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || hasLocalReference(value)) return value;
  const { $defs: _dropDefs, definitions: _dropDefinitions, ...rest } = value as Record<string, unknown>;
  return rest;
}

/**
 * Recurse and strip `additionalProperties: true` (opencode's `normalize`
 * deletes it because it is the JSON-Schema default) and collapse Effect's
 * `anyOf` noise: single-branch wrappers (optional keys) and the
 * number + non-finite-string-enum pattern Effect emits for `Number`/`number`
 * (opencode's `normalize` does the same). Bounded: only touches plain
 * JSON-Schema-shaped objects; never mutates the input.
 */
function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const schema: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'additionalProperties' && item === true) continue;
    schema[key] = normalizeJsonSchema(item);
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as Record<string, unknown>[];
    // Collapse a lone anyOf branch (Effect emits anyOf:[X] for optional keys).
    if (branches.length === 1 && typeof branches[0] === 'object' && branches[0] !== null) {
      const { anyOf: _drop, ...rest } = schema;
      return { ...branches[0], ...rest };
    }
    // Collapse number + non-finite-string-enum branches (Effect's `Number`).
    const number = branches.find((b) => typeof b === 'object' && b !== null && b.type === 'number');
    const nonFinite = branches.filter(
      (b) =>
        typeof b === 'object' && b !== null &&
        Array.isArray(b.enum) &&
        (b.enum as unknown[]).every((e) => e === 'NaN' || e === 'Infinity' || e === '-Infinity'),
    );
    if (number && nonFinite.length === branches.length - 1) {
      const { anyOf: _drop, ...rest } = schema;
      return normalizeJsonSchema({ ...(number as Record<string, unknown>), ...rest });
    }
  }
  return schema;
}

/**
 * Convert an Effect Schema instance to a model-facing JSON Schema document.
 * Never throws: unsupported schemas (e.g. `BigIntFromSelf` — Effect cannot
 * render a JSON Schema for them) fall back to `undefined`, which the caller
 * treats as "omit parameters".
 */
function convertEffectSchema(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const cached = CACHE.get(schema as object);
  if (cached !== undefined) return cached;

  try {
    // `Schema.toJsonSchemaDocument` is the same API opencode uses
    // (effect@4.0.0-beta.74, bundled by @opencode-ai/plugin@1.17.2).
    const document = Schema.toJsonSchemaDocument(schema as never, { additionalProperties: true });
    const composed: Record<string, unknown> = {
      $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
      ...(document.schema as Record<string, unknown>),
    };
    if (document.definitions && Object.keys(document.definitions).length > 0) {
      composed.$defs = document.definitions;
    }
    const inlined = inlineLocalReferences(composed);
    const dropped = dropDefinitionsIfResolved(inlined);
    const normalized = normalizeJsonSchema(dropped);
    if (typeof normalized === 'object' && normalized !== null) {
      CACHE.set(schema as object, normalized);
    }
    return normalized;
  } catch {
    // Unsupported schema (e.g. BigIntFromSelf): omit parameters rather than crash.
    return undefined;
  }
}

/** True when the value is an Effect Schema instance (carries an internal `ast`). */
function isEffectSchema(value: unknown): value is object {
  return typeof value === 'object' && value !== null && 'ast' in value;
}

/**
 * Normalize tool parameters captured from `tool.definition` before catalog
 * storage. Returns the model-facing form:
 *   - `jsonSchema` (opencode `Tool.Def.jsonSchema`) wins when present — it is
 *     already the model-facing JSON Schema.
 *   - Effect Schema instances → converted JSON Schema (2020-12, `$defs`
 *     inlined). Same instance converts identically (WeakMap cache).
 *   - Plain JSON Schema objects (MCP `inputSchema`) → passed through by
 *     reference, untouched.
 *   - `{}` / `null` / `undefined` → passed through (display omits them).
 *   - Unsupported schemas → `undefined` (display omits; no crash).
 *
 * The returned value is safe to store: it is either the caller's own plain
 * JSON Schema object (never mutated) or a fresh converted document.
 */
export function normalizeParameters(parameters: unknown, jsonSchema?: unknown): unknown {
  if (jsonSchema !== undefined) return jsonSchema;
  // Effect Schema instances carry an internal `ast` — convert them.
  if (isEffectSchema(parameters)) return convertEffectSchema(parameters);
  // Everything else (plain JSON Schema, `{}`, `null`, `undefined`, primitives)
  // passes through untouched, by reference.
  return parameters;
}
