import { Schema, JsonSchema } from 'effect';

const CACHE = new WeakMap<object, unknown>();

export function inlineLocalReferences(value: unknown, definitions?: Record<string, unknown>, seen = new Set<string>()): unknown {
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

export function dropDefinitionsIfResolved(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || hasLocalReference(value)) return value;
  const { $defs: _dropDefs, definitions: _dropDefinitions, ...rest } = value as Record<string, unknown>;
  return rest;
}

export function normalizeJsonSchema(value: unknown): unknown {
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
    if (branches.length === 1 && typeof branches[0] === 'object' && branches[0] !== null) {
      const { anyOf: _drop, ...rest } = schema;
      return { ...branches[0], ...rest };
    }
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

export function convertEffectSchema(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const cached = CACHE.get(schema as object);
  if (cached !== undefined) return cached;

  try {
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
    return undefined;
  }
}

function isEffectSchema(value: unknown): value is object {
  return typeof value === 'object' && value !== null && 'ast' in value;
}

export function normalizeParameters(parameters: unknown, jsonSchema?: unknown): unknown {
  if (jsonSchema !== undefined) return jsonSchema;
  if (isEffectSchema(parameters)) return convertEffectSchema(parameters);
  return parameters;
}
