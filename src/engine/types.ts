import type { BM25Config } from '../shared/index.js';

/**
 * Internal document representation for BM25 indexing.
 */
export interface Document {
  terms: string[];
  termFrequency: Map<string, number>;
  length: number;
}

/**
 * A BM25 index over items of type T.
 */
export interface Index<T> {
  documents: Document[];
  items: T[];
  documentFrequency: Map<string, number>;
  averageDocumentLength: number;
  documentCount: number;
  config: BM25Config;
}
