import type { PluginInput } from '@opencode-ai/plugin';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

/**
 * Display a toast in the OpenCode TUI. The toast is deferred by 100ms so the
 * plugin construction path can schedule notifications without racing the
 * host's own startup sequence. Failures are swallowed (notifications are
 * best-effort and must never break the plugin lifecycle).
 */
export function toast(
  ctx: PluginInput,
  title: string,
  msg: string,
  variant: ToastVariant = 'info',
  duration = 3000,
): void {
  setTimeout(() => {
    try {
      ctx?.client?.tui?.showToast({ body: { title, message: msg, variant, duration } }).catch(() => {});
    } catch {
      // A synchronous host error (e.g. TUI not yet attached) must never break
      // the plugin lifecycle; async rejections are swallowed by the .catch above.
    }
  }, 100);
}
