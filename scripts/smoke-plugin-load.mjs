import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(join(tmpdir(), 'openstellar-tool-search-smoke-'));
let tarball;

try {
  const { stdout: packStdout } = await execFileAsync('npm', ['pack', '--silent'], {
    cwd: new URL('..', import.meta.url),
  });

  tarball = packStdout.trim().split('\n').at(-1);

  await execFileAsync('npm', ['init', '-y'], { cwd: tempDir });
  await execFileAsync('npm', ['install', join(process.cwd(), tarball)], {
    cwd: tempDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import('@openstellar/tool-search').then(async (mod) => { if (!mod.default || (typeof mod.default !== 'object' && typeof mod.default !== 'function')) throw new Error('Default export is not an object or function'); if (typeof mod.default.id !== 'string') throw new Error('Default export missing id string'); if (typeof mod.default.setup !== 'function') throw new Error('Default export missing setup function'); if (typeof mod.default.server !== 'function') throw new Error('Default export missing server function'); if (typeof mod.ToolSearchPlugin !== 'function') throw new Error('ToolSearchPlugin export is not a function'); const ctx = { client: { tui: { showToast: async () => {} } } }; const resV2 = await mod.default.server(ctx, {}); if (!resV2 || typeof resV2 !== 'object') throw new Error('V2 plugin did not return hooks object'); const resV1 = await mod.ToolSearchPlugin(ctx, {}); if (!resV1 || typeof resV1 !== 'object') throw new Error('V1 plugin did not return hooks object'); console.log('plugin-smoke-ok'); })",
    ],
    { cwd: tempDir },
  );

  process.stdout.write(stdout);
} finally {
  if (tarball) await rm(new URL(`../${tarball}`, import.meta.url), { force: true });
  await rm(tempDir, { recursive: true, force: true });
}
