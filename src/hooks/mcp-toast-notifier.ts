export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export type ToastNotifyFn = (
  title: string,
  message: string,
  variant: ToastVariant,
  duration?: number,
) => void;

interface ConnectedServerInfo {
  serverName: string;
  toolCount: number;
}

interface FailedServerInfo {
  serverName: string;
  error: string;
}

export interface McpToastNotifierOptions {
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;
const TOAST_DURATION_MS = 3500;

/**
 * TUI-safe MCP connection progress reporter.
 *
 * Emits TUI toast notifications for MCP server connection lifecycle events.
 * Multiple concurrent server connections within the debounce window are collapsed
 * into a single aggregate toast to avoid visual spam in the TUI.
 *
 * Never writes to stdout or stderr — logging must remain completely decoupled
 * from terminal streams.
 */
export class McpToastNotifier {
  private readonly notify?: ToastNotifyFn;
  private readonly debounceMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private connectedQueue: ConnectedServerInfo[] = [];
  private failedQueue: FailedServerInfo[] = [];

  constructor(notify?: ToastNotifyFn, options?: McpToastNotifierOptions) {
    this.notify = notify;
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  onServerConnected(serverName: string, toolCount: number): void {
    if (!this.notify) return;
    this.connectedQueue.push({ serverName, toolCount });
    this.scheduleFlush();
  }

  onServerFailed(serverName: string, error: string): void {
    if (!this.notify) return;
    this.failedQueue.push({ serverName, error });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (!this.notify) {
      this.connectedQueue = [];
      this.failedQueue = [];
      return;
    }

    // Drain queues BEFORE invoking callbacks so a throwing notify callback
    // can never cause duplicate delivery on a later flush (CQS: mutate state
    // first, then emit). Each notify call is guarded — a synchronous host
    // error (TUI not attached) must never break the plugin lifecycle.
    if (this.connectedQueue.length > 0) {
      const queue = this.connectedQueue;
      this.connectedQueue = [];
      try {
        if (queue.length === 1) {
          const item = queue[0];
          this.notify(
            'Tool Search',
            `Connected MCP server "${item.serverName}" — loaded ${item.toolCount} tool(s).`,
            'info',
            TOAST_DURATION_MS,
          );
        } else {
          const totalTools = queue.reduce((acc, curr) => acc + curr.toolCount, 0);
          this.notify(
            'Tool Search',
            `Connected ${queue.length} MCP servers (${totalTools} tools loaded)`,
            'info',
            TOAST_DURATION_MS,
          );
        }
      } catch {
        // Host TUI errors are swallowed: notifications are best-effort.
      }
    }

    // Flush failed connections. A single failure gets its own warning toast;
    // multiple concurrent failures (e.g. machine offline) collapse into one
    // summary toast to avoid a warning storm overwriting itself in the TUI.
    if (this.failedQueue.length > 0) {
      const failures = this.failedQueue;
      this.failedQueue = [];
      try {
        if (failures.length === 1) {
          this.notify(
            'Tool Search',
            `Failed MCP server "${failures[0].serverName}": ${failures[0].error}`,
            'warning',
            TOAST_DURATION_MS,
          );
        } else {
          const names = failures.map((f) => `"${f.serverName}"`).join(', ');
          this.notify(
            'Tool Search',
            `Failed to connect ${failures.length} MCP servers (${names}) — see tool-search.log for details.`,
            'warning',
            TOAST_DURATION_MS,
          );
        }
      } catch {
        // Host TUI errors are swallowed: notifications are best-effort.
      }
    }
  }
}
