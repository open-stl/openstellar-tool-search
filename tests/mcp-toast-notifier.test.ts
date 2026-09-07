import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpToastNotifier } from '../src/hooks/mcp-toast-notifier.js';

describe('McpToastNotifier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies for a single server connection after the debounce window', () => {
    const notify = vi.fn();
    const notifier = new McpToastNotifier(notify, { debounceMs: 100 });

    notifier.onServerConnected('srv1', 5);
    expect(notify).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'Tool Search',
      expect.stringContaining('Connected MCP server "srv1" — loaded 5 tool(s)'),
      'info',
      expect.any(Number),
    );
  });

  it('debounces multiple rapid server connections into a single summary toast', () => {
    const notify = vi.fn();
    const notifier = new McpToastNotifier(notify, { debounceMs: 100 });

    notifier.onServerConnected('srv1', 5);
    notifier.onServerConnected('srv2', 10);
    notifier.onServerConnected('srv3', 15);

    vi.advanceTimersByTime(100);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'Tool Search',
      expect.stringContaining('Connected 3 MCP servers (30 tools loaded)'),
      'info',
      expect.any(Number),
    );
  });

  it('reports server failures as warning/error toasts', () => {
    const notify = vi.fn();
    const notifier = new McpToastNotifier(notify, { debounceMs: 100 });

    notifier.onServerFailed('bad_srv', 'Connection refused');

    vi.advanceTimersByTime(100);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'Tool Search',
      expect.stringContaining('Failed MCP server "bad_srv": Connection refused'),
      'warning',
      expect.any(Number),
    );
  });

  it('does not throw or fail when notify is undefined (headless/test environment)', () => {
    const notifier = new McpToastNotifier(undefined, { debounceMs: 50 });
    expect(() => {
      notifier.onServerConnected('srv1', 2);
      notifier.onServerFailed('srv2', 'err');
      vi.advanceTimersByTime(100);
    }).not.toThrow();
  });

  it('collapses multiple concurrent failures into a single summary toast', () => {
    const notify = vi.fn();
    const notifier = new McpToastNotifier(notify, { debounceMs: 100 });

    notifier.onServerFailed('srv1', 'err A');
    notifier.onServerFailed('srv2', 'err B');

    vi.advanceTimersByTime(100);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'Tool Search',
      expect.stringContaining('Failed to connect 2 MCP servers'),
      'warning',
      expect.any(Number),
    );
  });

  it('swallows synchronous host errors from the notify callback', () => {
    const notify = vi.fn(() => {
      throw new Error('TUI not attached');
    });
    const notifier = new McpToastNotifier(notify, { debounceMs: 50 });

    expect(() => {
      notifier.onServerConnected('srv1', 1);
      vi.advanceTimersByTime(100);
    }).not.toThrow();
  });
});
