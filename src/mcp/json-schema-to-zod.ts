import { tool } from '@opencode-ai/plugin';

const zObj = tool.schema;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodType = any;

export function jsonSchemaToZod(schema: unknown): any {
  if (!schema || typeof schema !== 'object') {
    return zObj.string();
  }

  // Clone to avoid mutation
  const s = { ...(schema as Record<string, unknown>) };

  // Handle type arrays like ["string", "null"] — union all non-null + nullable wrapper
  if (Array.isArray(s.type)) {
    const nonNullTypes = s.type.filter((t) => t !== 'null');
    if (nonNullTypes.length === 0) {
      return zObj.string();
    }
    const isNullable = (s.type as string[]).includes('null');
    if (nonNullTypes.length === 1) {
      const result = createFromType(nonNullTypes[0] as string, s);
      return isNullable ? result.nullable() : result;
    }
    const branches = nonNullTypes.map((t: string) => createFromType(t, s));
    const union = zObj.union(branches as [ZodType, ZodType, ...ZodType[]]);
    return isNullable ? union.nullable() : union;
  }

  // Handle $ref
  if (s.$ref && typeof s.$ref === 'string') {
    return zObj.string();
  }

  // Handle union/intersection types
  if (s.anyOf && Array.isArray(s.anyOf) && s.anyOf.length > 0) {
    const branches = s.anyOf.map((branch: unknown) => jsonSchemaToZod(branch));
    return branches.length === 1 ? branches[0] : zObj.union(branches as [ZodType, ZodType, ...ZodType[]]);
  }
  if (s.oneOf && Array.isArray(s.oneOf) && s.oneOf.length > 0) {
    const branches = s.oneOf.map((branch: unknown) => jsonSchemaToZod(branch));
    return branches.length === 1 ? branches[0] : zObj.union(branches as [ZodType, ZodType, ...ZodType[]]);
  }
  if (s.allOf && Array.isArray(s.allOf) && s.allOf.length > 0) {
    const merged: Record<string, unknown> = { type: 'object', properties: {}, required: [] };
    for (const sub of s.allOf) {
      if (sub && typeof sub === 'object') {
        const subObj = sub as Record<string, unknown>;
        const subProps = subObj.properties;
        if (subProps && typeof subProps === 'object') {
          (merged.properties as Record<string, unknown>) = {
            ...(merged.properties as Record<string, unknown>),
            ...(subProps as Record<string, unknown>),
          };
        }
        const subRequired = subObj.required;
        if (Array.isArray(subRequired)) {
          for (const r of subRequired) {
            if (typeof r === 'string' && !(merged.required as string[]).includes(r)) {
              (merged.required as string[]).push(r);
            }
          }
        }
      }
    }
    return jsonSchemaToZod(merged);
  }

  return createFromType(s.type as string | undefined, s);
}

function createFromType(type: string | undefined, s: Record<string, unknown>): ZodType {
  if (type === 'string') {
    const enumValues = s.enum;
    if (Array.isArray(enumValues) && enumValues.every((v): v is string => typeof v === 'string')) {
      if (enumValues.length === 0) {
        return zObj.string();
      }
      return zObj.enum(enumValues as [string, ...string[]]);
    }
    return zObj.string();
  }

  if (type === 'number' || type === 'integer') {
    return zObj.number();
  }

  if (type === 'boolean') {
    return zObj.boolean();
  }

  if (type === 'null') {
    return zObj.null();
  }

  if (type === 'array') {
    return zObj.array(s.items ? jsonSchemaToZod(s.items) : zObj.string());
  }

  if (type === 'object' || s.properties) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape: Record<string, any> = {};
    const required = new Set((s.required as string[] | undefined) || []);
    const properties = (s.properties as Record<string, unknown> | undefined) || {};

    for (const [key, prop] of Object.entries(properties)) {
      let zodType = jsonSchemaToZod(prop);
      if (!required.has(key)) {
        zodType = zodType.optional();
      }
      shape[key] = zodType;
    }

    return zObj.object(shape);
  }

  return zObj.string().describe(s.description ? String(s.description) : 'Unknown type fallback');
}
