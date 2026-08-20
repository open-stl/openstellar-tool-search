import { Schema, JsonSchema } from 'effect';

const CACHE = new WeakMap<object, unknown>();

const MAX_SCHEMA_DEPTH = 20;

export function inlineLocalReferences(
  value: unknown,
  rootSchema?: Record<string, unknown>,
  seen = new Set<string>(),
  depth = 0,
): unknown {
  if (depth > MAX_SCHEMA_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => inlineLocalReferences(item, rootSchema, seen, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const currentRoot = rootSchema ?? record;

  if (typeof record.$ref === 'string') {
    const name = record.$ref.match(/^#\/\$defs\/(.+)$/)?.[1] ?? record.$ref.match(/^#\/definitions\/(.+)$/)?.[1];
    if (name && !seen.has(name)) {
      const defs = (typeof currentRoot.$defs === 'object' && currentRoot.$defs !== null
        ? currentRoot.$defs as Record<string, unknown>
        : typeof currentRoot.definitions === 'object' && currentRoot.definitions !== null
          ? currentRoot.definitions as Record<string, unknown>
          : undefined);
      const target = defs?.[name];
      if (target && typeof target === 'object') {
        const { $ref: _drop, ...rest } = record;
        return inlineLocalReferences(
          { ...(target as Record<string, unknown>), ...rest },
          currentRoot,
          new Set(seen).add(name),
          depth + 1,
        );
      }
      // If reference is unresolved at local level, strip $ref to prevent downstream resolver crashes
      const { $ref: _drop, ...rest } = record;
      const normalizedRest = Object.keys(rest).length === 0 ? { type: 'object' } : rest;
      return inlineLocalReferences(normalizedRest, currentRoot, seen, depth + 1);
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, inlineLocalReferences(item, currentRoot, seen, depth + 1)]),
  );
}

function hasLocalReference(value: unknown, depth = 0): boolean {
  if (depth > MAX_SCHEMA_DEPTH) return false;
  if (Array.isArray(value)) return value.some((item) => hasLocalReference(item, depth + 1));
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.$ref === 'string' &&
    (record.$ref.startsWith('#/$defs/') || record.$ref.startsWith('#/definitions/'))
  ) {
    return true;
  }
  return Object.values(record).some((item) => hasLocalReference(item, depth + 1));
}

function dropDefinitionsIfResolved(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || hasLocalReference(value)) return value;
  const { $defs: _dropDefs, definitions: _dropDefinitions, ...rest } = value as Record<string, unknown>;
  return rest;
}

function normalizeJsonSchema(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCHEMA_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeJsonSchema(item, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const schema: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === 'additionalProperties' && item === true) continue;
    schema[key] = normalizeJsonSchema(item, depth + 1);
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
      return normalizeJsonSchema({ ...(number as Record<string, unknown>), ...rest }, depth + 1);
    }
  }
  return schema;
}

function convertEffectSchema(schema: unknown): unknown {
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
  if (jsonSchema !== undefined) {
    if (hasLocalReference(jsonSchema)) {
      const inlined = inlineLocalReferences(jsonSchema);
      return dropDefinitionsIfResolved(inlined);
    }
    return jsonSchema;
  }
  if (isEffectSchema(parameters)) return convertEffectSchema(parameters);
  if (hasLocalReference(parameters)) {
    const inlined = inlineLocalReferences(parameters);
    return dropDefinitionsIfResolved(inlined);
  }
  return parameters;
}

const ABBREVIATIONS = new Set(['eg', 'ie', 'dr', 'mr', 'ms', 'mrs', 'vs', 'etc']);

export function getFirstSentence(desc: string): string {
  if (!desc) return '';
  const firstNewline = desc.indexOf('\n');
  const firstLine = firstNewline !== -1 ? desc.slice(0, firstNewline).trim() : desc.trim();
  const sentenceBoundaryRegex = /\.(?:\s|$)/g;
  let match;
  while ((match = sentenceBoundaryRegex.exec(firstLine)) !== null) {
    const index = match.index;
    const beforeSegment = firstLine.slice(0, index);
    const wordMatch = beforeSegment.match(/\b[a-zA-Z.]+$/);
    if (wordMatch) {
      const cleanWord = wordMatch[0].toLowerCase().replace(/\./g, '');
      if (ABBREVIATIONS.has(cleanWord) || cleanWord.length === 1) continue;
    }
    return firstLine.slice(0, index + 1).trim();
  }
  return firstLine;
}

/**
 * Compose the deferred description for a tool: the first sentence (when
 * available) plus the deferral label, or the label alone.
 */
export function truncateDescription(desc: string, deferLabel: string): string {
  const firstSentence = getFirstSentence(desc);
  return firstSentence ? `${firstSentence} ${deferLabel}` : deferLabel;
}

export const PLACEHOLDER_PARAMS = {
  type: 'object',
  properties: {
    reason: {
      type: 'string',
      description: 'Brief explanation of why you are calling this tool',
    },
  },
  required: ['reason'],
} as const;


