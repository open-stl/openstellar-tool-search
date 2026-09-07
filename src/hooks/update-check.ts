import type { PluginInput } from '@opencode-ai/plugin';
import { checkForUpdate, formatUpdateMessage } from './auto-update-checker.js';
import { toast } from './toast.js';

/**
 * Update-check lifecycle for the plugin.
 *
 * Owns the dedup/latch state machine around `checkForUpdate`: concurrent
 * `session.created` events share one in-flight check, failed checks retry on
 * the next event, and a staged update latches permanently (the plugin stops
 * re-checking and stops notifying for the lifetime of the process).
 *
 * `checkForUpdate` and `formatUpdateMessage` are re-exported from the
 * auto-update-checker module so test suites can mock that module and still
 * intercept this lifecycle.
 */
export class UpdateCheckLifecycle {
  private checkInFlight: Promise<void> | null = null;
  private staged = false;

  public constructor(private readonly ctx: PluginInput) {}

  public async handleEvent(eventType: string): Promise<void> {
    if (eventType !== 'session.created' || this.staged) return;
    if (!this.checkInFlight) {
      // Fire-and-forget: `checkForUpdate` runs npm config probes + a fetch
      // (up to ~15s of worst-case I/O), so the caller (the `event` hook, which
      // OpenCode dispatches around the message-send flow) must never await it.
      // Completion — toast + staged latch — happens in the background;
      // `checkInFlight` only dedupes concurrent checks.
      this.checkInFlight = this.runCheck().finally(() => {
        this.checkInFlight = null;
      });
    }
  }

  private async runCheck(): Promise<void> {
    try {
      const result = await checkForUpdate();
      const msg = formatUpdateMessage(result);
      if (result.outcome === 'update-staged') {
        this.staged = true;
        toast(this.ctx, msg.title, msg.message, msg.variant, 6000);
      } else if (result.outcome !== 'up-to-date') {
        toast(this.ctx, msg.title, msg.message, msg.variant, 6000);
      }
    } catch (error) {
      toast(this.ctx, 'Tool Search Update Check', error instanceof Error ? error.message : 'Update check failed.', 'error', 6000);
    }
  }
}
