/**
 * Tokenizes text for BM25 indexing and search.
 * Lowercases, strips non-alphanumeric characters, splits on whitespace.
 * Type-safe guard: returns empty array for non-string or empty input.
 */
export function tokenize(text: string): string[] {
  if (typeof text !== 'string' || !text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}
