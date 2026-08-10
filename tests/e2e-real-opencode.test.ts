/**
 * Real-opencode end-to-end test (OPT-IN via E2E_OPENCODE=1).
 *
 * Drives the ACTUAL installed `opencode` CLI (headless `opencode run`) with a
 * fixture config that loads this plugin's BUILT dist/index.js together with a
 * real local MCP server (fixtures/race-probe-mcp-server.mjs), then asserts
 * the plugin's tool_search discovers the MCP tool in a real session.
 *
 * WHY OPT-IN: the harness shells out to the real CLI and requires (a) a build
 * (`npm run build`), (b) a model credential (`opencode auth list` non-empty),
 * and (c) network-free local MCP. None of that belongs in the default `npm
 * test` run. Set E2E_OPENCODE=1 to enable.
 *
 * Skipped by default (it.isSkipWhen). The full manual flow is scripted in
 * scripts/e2e-real-opencode.sh — run that for the complete scenario.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const E2E_ENABLED = process.env.E2E_OPENCODE === '1';
const REPO_ROOT = join(__dirname, '..');
const DIST_INDEX = join(REPO_ROOT, 'dist', 'index.js');
const PROBE_SERVER = join(REPO_ROOT, 'fixtures', 'race-probe-mcp-server.mjs');
const FIXTURE_CONFIG = join(REPO_ROOT, 'fixtures', 'opencode.e2e.jsonc');
const E2E_SCRIPT = join(REPO_ROOT, 'scripts', 'e2e-real-opencode.sh');

function isSkipWhen(enabled: boolean): boolean {
  return !enabled;
}

/** Run the e2e script, killing the whole process group on timeout. */
function runScript(timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // detached:true puts bash + its children (opencode, probe MCP server) in
    // their own process group so a timeout can kill the entire tree — killing
    // only bash would orphan opencode, which keeps the stdio pipes open and
    // hangs the test forever. stdin is ignored (the CLI never needs it).
    const child = spawn('bash', [E2E_SCRIPT], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: '1' },
    });

    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));

    const timer = setTimeout(() => {
      // SIGTERM the process group (negative pid) — bash + opencode + MCP.
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        /* already gone */
      }
      reject(new Error(`e2e script timed out after ${timeoutMs}ms. Output so far:\n${output.slice(-2000)}`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        resolve({ code: null, output });
        return;
      }
      resolve({ code, output });
    });
  });
}

describe('E2E: real opencode CLI discovers MCP tool via plugin tool_search (opt-in)', { skip: isSkipWhen(E2E_ENABLED) }, () => {
  beforeAll(() => {
    if (!E2E_ENABLED) return;
    if (!existsSync(DIST_INDEX)) {
      throw new Error('dist/index.js missing — run `npm run build` before the real-opencode e2e');
    }
    if (!existsSync(PROBE_SERVER)) {
      throw new Error(`probe server missing: ${PROBE_SERVER}`);
    }
    if (!existsSync(FIXTURE_CONFIG)) {
      throw new Error(`fixture config missing: ${FIXTURE_CONFIG}`);
    }
    if (!existsSync(E2E_SCRIPT)) {
      throw new Error(`e2e script missing: ${E2E_SCRIPT}`);
    }
  });

  it('tool_search finds the MCP tool through the real CLI', async () => {
    // Run the proven shell harness (scripts/e2e-real-opencode.sh): it builds
    // the plugin, spins a REAL local MCP server, runs the REAL installed
    // `opencode` CLI (headless `opencode run`) inside a sandboxed HOME with the
    // fixture config, and asserts the model discovers + calls the MCP tool.
    // v1.18.15 has no `--config` flag, so the script installs the fixture
    // config as ~/.config/opencode/opencode.jsonc in a sandboxed HOME.
    // Spawned detached (own process group) so timeout kills the whole tree —
    // execFile's timeout only kills bash, orphaning opencode with open pipes.
    const { code, output } = await runScript(180_000);

    expect(code, `script failed (exit ${code}). Output:\n${output.slice(-3000)}`).toBe(0);
    expect(output).toContain('race-probe pong');
    expect(output).toContain('PASS:');
  }, 200_000);
});
