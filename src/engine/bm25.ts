import type { BM25Config, SearchResult } from '../shared/index.js';
import { tokenize } from '../shared/index.js';
import type { Document, Index } from './types.js';

const DEFAULT_CONFIG: BM25Config = {
  k1: 0.9,
  b: 0.4,
};

function buildTermFrequency(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const term of terms) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }
  return tf;
}

/**
 * IDF: log((N - df + 0.5) / (df + 0.5) + 1)
 */
function calculateIDF(documentCount: number, df: number): number {
  return Math.log((documentCount - df + 0.5) / (df + 0.5) + 1);
}

function scoreDocument(doc: Document, queryTerms: string[], index: Index<unknown>): number {
  const { k1, b } = index.config;
  let score = 0;

  for (const term of queryTerms) {
    const df = index.documentFrequency.get(term) ?? 0;
    if (df === 0) continue;

    const tf = doc.termFrequency.get(term) ?? 0;
    if (tf === 0) continue;

    const idf = calculateIDF(index.documentCount, df);
    // BM25 term score: idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl/avgdl))
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (doc.length / index.averageDocumentLength));
    score += idf * (numerator / denominator);
  }

  return score;
}

/**
 * Creates a BM25 index from a list of items.
 * @param items - The items to index
 * @param getFields - Extracts string fields from each item (concatenated for search)
 * @param config - Optional BM25 config (k1, b)
 */
export function createIndex<T>(
  items: T[],
  getFields: (item: T) => string[],
  config: Partial<BM25Config> = {},
): Index<T> {
  const finalConfig: BM25Config = { ...DEFAULT_CONFIG, ...config };
  const documents: Document[] = [];
  const documentFrequency = new Map<string, number>();

  for (const item of items) {
    const terms = getFields(item)
      .filter((f): f is string => typeof f === 'string')
      .flatMap(tokenize);
    const termFrequency = buildTermFrequency(terms);

    for (const term of termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }

    documents.push({ terms, termFrequency, length: terms.length });
  }

  const totalLength = documents.reduce((sum, d) => sum + d.length, 0);
  const averageDocumentLength = documents.length > 0 ? totalLength / documents.length : 0;

  return {
    documents,
    items,
    documentFrequency,
    averageDocumentLength,
    documentCount: documents.length,
    config: finalConfig,
  };
}

/**
 * Searches a BM25 index with the given query string.
 * @param index - The BM25 index to search
 * @param query - Search keywords
 * @param limit - Max results (default 10)
 * @returns Sorted results by relevance score descending
 */
export function search<T>(index: Index<T>, query: string, limit = 10): SearchResult<T>[] {
  if (index.documentCount === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results: SearchResult<T>[] = [];

  for (let i = 0; i < index.documents.length; i++) {
    const score = scoreDocument(index.documents[i], queryTerms, index);
    if (score > 0) {
      results.push({ item: index.items[i], score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
