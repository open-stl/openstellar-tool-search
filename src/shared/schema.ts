/**
 * Recursively collects all leaf parameter names from a JSON Schema object.
 * Handles nested `type: object` properties and `type: array` with items.
 * Produces dot-notation keys: `parent.child.grandchild`.
 */
export function flattenParameterKeys(params: unknown, prefix: string = ''): string[] {
  if (!params || typeof params !== 'object') return [];
  const obj = params as Record<string, unknown>;
  const properties = obj.properties;
  if (!properties || typeof properties !== 'object') return [];
  const keys: string[] = [];
  for (const [name, def] of Object.entries(properties as Record<string, unknown>)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    keys.push(fullName);
    if (def && typeof def === 'object') {
      const d = def as Record<string, unknown>;
      if (d.type === 'object' || d.properties) {
        keys.push(...flattenParameterKeys(def, fullName));
      } else if (d.type === 'array' && d.items && typeof d.items === 'object') {
        keys.push(...flattenParameterKeys(d.items as Record<string, unknown>, fullName));
      }
    }
  }
  return keys;
}

/**
 * Converts a JSON Schema parameters object to a markdown summary string.
 * Handles required/optional markers, nested objects with dot notation,
 * and non-object/null property definitions.
 */
export function summarizeParameters(params: unknown): string {
  const lines = summarizeParams(params, '');
  return lines.length > 0 ? lines.join('\n') : '(none)';
}

function summarizeParams(params: unknown, prefix: string): string[] {
  if (!params || typeof params !== 'object') return [];

  const schema = params as Record<string, unknown>;
  const props = schema.properties;
  if (!props || typeof props !== 'object') return [];

  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);

  const lines: string[] = [];
  for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
    if (!def || typeof def !== 'object') continue;
    const d = def as Record<string, unknown>;
    const fullName = prefix ? `${prefix}.${name}` : name;
    const type = typeof d.type === 'string' ? d.type : 'unknown';
    const desc = typeof d.description === 'string' ? d.description : '';
    const req = required.has(name) ? ' (required)' : '';
    lines.push(`  - ${fullName}: ${type}${req}${desc ? ` — ${desc}` : ''}`);
    // Recurse into nested object properties
    if (d.type === 'object' || d.properties) {
      lines.push(...summarizeParams(def, fullName));
    } else if (d.type === 'array' && d.items && typeof d.items === 'object') {
      lines.push(...summarizeParams(d.items as Record<string, unknown>, fullName));
    }
  }

  return lines;
}
