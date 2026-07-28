import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const testCacheDir = mkdtempSync(join(tmpdir(), 'tool-search-test-cache-'));

process.env.XDG_CACHE_HOME = testCacheDir;
process.env.APPDATA = testCacheDir;

afterAll(() => {
  try {
    rmSync(testCacheDir, { recursive: true, force: true });
  } catch {}
});
