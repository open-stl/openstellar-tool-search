import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  bootstrapLog,
  setLogDirForTesting,
  LOG_FILE_NAME,
  ROTATED_LOG_FILE_NAME,
  MAX_LOG_BYTES,
} from '../src/core/bootstrap.js';

// ============================================================================
// Ticket #17: Log file rotation with size cap
// ============================================================================

describe('bootstrapLog rotation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsr-log-'));
    setLogDirForTesting(tmpDir);
  });

  afterEach(() => {
    setLogDirForTesting(undefined);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends to the log file when under the size cap', () => {
    bootstrapLog('hello world');
    const content = fs.readFileSync(path.join(tmpDir, LOG_FILE_NAME), 'utf-8');
    expect(content).toContain('hello world');
    expect(fs.existsSync(path.join(tmpDir, ROTATED_LOG_FILE_NAME))).toBe(false);
  });

  it('rotates the log when appending would exceed the size cap', () => {
    // Write one line under the cap, then grow the file past the cap through
    // direct writes, then log again — the pre-existing oversized file must be
    // rotated, and the fresh file must contain only the new line.
    const logPath = path.join(tmpDir, LOG_FILE_NAME);
    bootstrapLog('first line');
    fs.appendFileSync(logPath, 'x'.repeat(MAX_LOG_BYTES), 'utf-8');

    bootstrapLog('second line after rotation');

    const rotated = fs.readFileSync(path.join(tmpDir, ROTATED_LOG_FILE_NAME), 'utf-8');
    expect(rotated).toContain('first line');
    const fresh = fs.readFileSync(logPath, 'utf-8');
    expect(fresh).toContain('second line after rotation');
    expect(fresh).not.toContain('first line');
  });

  it('replaces an existing rotated file instead of failing', () => {
    const logPath = path.join(tmpDir, LOG_FILE_NAME);
    const rotatedPath = path.join(tmpDir, ROTATED_LOG_FILE_NAME);
    fs.writeFileSync(rotatedPath, 'old rotated content', 'utf-8');
    fs.writeFileSync(logPath, 'x'.repeat(MAX_LOG_BYTES + 1), 'utf-8');

    bootstrapLog('new epoch');

    expect(fs.readFileSync(rotatedPath, 'utf-8')).toContain('x'.repeat(10));
    expect(fs.readFileSync(logPath, 'utf-8')).toContain('new epoch');
  });
});
