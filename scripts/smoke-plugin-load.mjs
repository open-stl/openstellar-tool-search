import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(join(tmpdir(), 'openstellar-tool-search-smoke-'));

try {
  const { stdout: packStdout } = await execFileAsync('npm', ['pack', '--silent'], {
    cwd: new URL('..', import.meta.url),
  });

  const tarball = packStdout.trim().split('\n').at(-1);

  await execFileAsync('npm', ['init', '-y'], { cwd: tempDir });
  await execFileAsync('npm', ['install', join(process.cwd(), tarball)], {
    cwd: tempDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import('@openstellar/tool-search').then(async (mod) => { if (typeof mod.default !== 'function') throw new Error('Default export is not a function'); if (typeof mod.ToolSearchPlugin !== 'function') throw new Error('ToolSearchPlugin export is not a function'); const result = await mod.default({}, { tool: {} }); if (!result || typeof result !== 'object') throw new Error('Plugin did not return an object'); console.log('plugin-smoke-ok'); })",
    ],
    { cwd: tempDir },
  );

  process.stdout.write(stdout);
  await rm(new URL(`../${tarball}`, import.meta.url), { force: true });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
