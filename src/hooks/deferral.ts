/**
 * First-sentence extraction for tool descriptions.
 *
 * Deferral truncates a tool description to its first sentence so the model
 * keeps enough signal to decide whether to search, while the deferred label
 * signals the description was shortened. Abbreviations (e.g. "i.e.", "vs.")
 * and single-letter initials do not terminate a sentence.
 */

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
