import type { Transport } from '../transport-factory.js';

/**
 * Safely closes an MCP transport instance with best-effort error suppression.
 */
export async function closeTransport(transport: Transport | null | undefined): Promise<void> {
  if (!transport) return;
  try {
    await Promise.resolve(transport.close());
  } catch {
    // Best-effort cleanup
  }
}
