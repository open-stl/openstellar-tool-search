import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => process.env.TOOL_SEARCH_TEST_HOME ?? actual.homedir(),
    platform: () => 'darwin',
  };
});

describe('auto-update-checker cache target characterization', () => {
  let testHome: string;

  afterEach(() => {
    if (testHome) rmSync(testHome, { recursive: true, force: true });
    delete process.env.TOOL_SEARCH_TEST_HOME;
    vi.resetModules();
  });

  it('removes only the latest tool-search wrapper while preserving sibling wrappers', async () => {
    testHome = mkdtempSync(join(process.cwd(), '.tmp-tool-search-cache-'));
    process.env.TOOL_SEARCH_TEST_HOME = testHome;

    const packages = join(testHome, '.cache', 'opencode', 'packages');
    const target = join(packages, '@openstellar', 'tool-search@latest');
    const scopedSibling = join(packages, '@openstellar', 'other-plugin@latest');
    const unscopedSibling = join(packages, 'other-plugin@latest');
    for (const wrapper of [target, scopedSibling, unscopedSibling]) {
      mkdirSync(join(wrapper, 'node_modules', '@openstellar', 'tool-search'), { recursive: true });
      writeFileSync(join(wrapper, 'package.json'), '{}');
      writeFileSync(join(wrapper, 'package-lock.json'), '{}');
      writeFileSync(join(wrapper, 'node_modules', '@openstellar', 'tool-search', 'package.json'), '{}');
    }

    const { invalidatePackageCache } = await import('../src/hooks/auto-update-checker.js');
    expect(invalidatePackageCache()).toBe(true);

    expect(existsSync(target)).toBe(false);
    expect(existsSync(scopedSibling)).toBe(true);
    expect(existsSync(unscopedSibling)).toBe(true);
  });
});
