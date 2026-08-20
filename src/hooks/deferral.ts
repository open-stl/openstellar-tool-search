/**
 * First-sentence extraction for tool descriptions and placeholder schema.
 *
 * Deferral truncates a tool description to its first sentence so the model
 * keeps enough signal to decide whether to search, while the deferred label
 * signals the description was shortened. Abbreviations (e.g. "i.e.", "vs.")
 * and single-letter initials do not terminate a sentence.
 */

export { truncateDescription, getFirstSentence } from '../catalog/schema-normalize.js';

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

