import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import process, { env } from 'node:process';
import { writeJsonAtomic } from './atomic-write.js';

/**
 * Single authoritative resolver for plugin storage directories across
 * OPENCODE_STORAGE_DIR, XDG_CACHE_HOME / XDG_DATA_HOME, Windows LOCALAPPDATA, and defaults.
 */
export function resolveStorageDir(subdir = 'tool-search'): string {
  if (env.OPENCODE_STORAGE_DIR) {
    return join(env.OPENCODE_STORAGE_DIR, 'openstellar', subdir);
  }
  if (platform() === 'win32' && env.LOCALAPPDATA) {
    return join(env.LOCALAPPDATA, 'openstellar', subdir);
  }
  const baseDir =
    env.XDG_CACHE_HOME ||
    env.XDG_DATA_HOME ||
    (env.VITEST
      ? join(tmpdir(), `tool-search-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
      : join(homedir(), '.cache'));
  return join(baseDir, 'openstellar', subdir);
}

/**
 * Safely read and parse JSON file. Returns null on missing file, empty content, or parse error.
 */
export function safeReadJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (!content.trim()) return null;
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Safely write JSON payload atomically to disk. Catches and suppresses non-critical I/O errors.
 */
export function safeWriteJson<T>(filePath: string, data: T): void {
  try {
    writeJsonAtomic(filePath, data);
  } catch {
    // Non-critical background persistence failure
  }
}
