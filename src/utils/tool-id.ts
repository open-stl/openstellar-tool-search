/**
 * Standardize tool IDs across configuration, registration, search, and authorization.
 * Trims whitespace, converts to lowercase, and normalizes hyphens to underscores.
 */
export function normalizeToolId(id: string): string {
  return id.trim().toLowerCase().replace(/[-_]/g, '_');
}

/**
 * Filter and sanitize an array of raw string configuration values.
 */
export function sanitizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}
