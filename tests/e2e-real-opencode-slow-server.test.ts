/**
 * Real-opencode SLOW-SERVER e2e (OPT-IN via E2E_OPENCODE_SLOW=1).
 *
 * THE DECISIVE TEST for the final design (Bea-1 ruling: bounded pre-warm +
 * status-only placeholders).
 *
 * opencode freezes the session tool-set at start (~0-2s); MCP tools registered
 * after that snapshot are permanently uncallable. The fix: the plugin factory
 * WAIT-ALLs until every enabled server settles or is cut at its per-server
 * ceiling (preWarmMs, default 60s), so MCP tools are in the bridge BEFORE the
 * snapshot. Anything that settles is first-class; anything cut is honestly
 * absent (status-only placeholder retained).
 *
 * SCENARIO (ONE `opencode run`, slow-probe server with ~10s handshake, default
 * preWarmMs = 60s): the factory waits out the 10s server, so the model's
 * FIRST turn must see the REAL tool `slow_probe_ping` in its tool list AND be
 * able to call it directly (getting "slow-probe pong"). If the model instead
 * sees only the placeholder / cannot call the tool → the fix is broken.
 *
 * Assertions: the model's tool list mentions slow_probe_ping; the model calls
 * it and gets "slow-probe pong".
 *
 * WHY OPT-IN: real CLI + real LLM session, ~30-60s, costs tokens, needs a
 * model credential + `npm run build`. Set E2E_OPENCODE_SLOW=1 to enable.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

const E2E_ENABLED = process.env.E2E_OPENCODE_SLOW === '1';
const REPO_ROOT = join(__dirname, '..');
const DIST_INDEX = join(REPO_ROOT, 'dist', 'index.js');
const SLOW_SERVER = join(REPO_ROOT, 'fixtures', 'slow-probe-mcp-server.mjs');
const SLOW_CONFIG = join(REPO_ROOT, 'fixtures', 'opencode.e2e-slow.jsonc');

function isSkipWhen(enabled: boolean): boolean {
  return !enabled;
}

/** Run a single `opencode run` in a sandboxed HOME; kill the whole tree on timeout. */
function runOpencode(sandboxHome: string, model: string, prompt: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'opencode',
      ['run', '--model', model, '--format', 'json', '--dir', REPO_ROOT, prompt],
      {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: sandboxHome,
          XDG_CONFIG_HOME: join(sandboxHome, '.config'),
          XDG_DATA_HOME: join(sandboxHome, '.local', 'share'),
          XDG_CACHE_HOME: join(sandboxHome, '.cache'),
          XDG_STATE_HOME: join(sandboxHome, '.local', 'state'),
          OPENCODE_DISABLE_AUTOUPDATE: '1',
        },
      },
    );

    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));

    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGTERM'); // whole process group
      } catch {
        /* already gone */
      }
      reject(new Error(`opencode run timed out after ${timeoutMs}ms. Output so far:\n${output.slice(-2000)}`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? null : code, output });
    });
  });
}

/** Extract model text + tool-use summary from a JSON-lines opencode event. */
function extractText(output: string): { text: string; toolUses: string[] } {
  const text: string[] = [];
  const toolUses: string[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'text' && typeof evt.part?.text === 'string') text.push(evt.part.text);
      if (evt.type === 'tool_use' && evt.part?.state) {
        const out = typeof evt.part.state.output === 'string' ? evt.part.state.output.slice(0, 200) : '';
        toolUses.push(`[${evt.part.state.status}] ${evt.part.tool} ${JSON.stringify(evt.part.state.input ?? {})} -> ${out.replace(/\n/g, ' ')}`);
      }
    } catch {
      /* not JSON */
    }
  }
  return { text: text.join('\n'), toolUses };
}

describe('E2E: real opencode SLOW-server — does the real tool become visible after warm-up?', { skip: isSkipWhen(E2E_ENABLED) }, () => {
  beforeAll(() => {
    if (!E2E_ENABLED) return;
    if (!existsSync(DIST_INDEX)) {
      throw new Error('dist/index.js missing — run `npm run build` before this e2e');
    }
    if (!existsSync(SLOW_SERVER)) throw new Error(`slow server missing: ${SLOW_SERVER}`);
    if (!existsSync(SLOW_CONFIG)) throw new Error(`slow config missing: ${SLOW_CONFIG}`);
  });

  it('placeholder visible turn-1; real tool visible + callable turn-2 (or verdict: snapshot-at-start)', async () => {
    const model = process.env.OPENCODE_E2E_MODEL || 'opencode/big-pickle';

    // Sandboxed HOME with the slow config installed + auth copied.
    const sandbox = mkdtempSync(join(tmpdir(), 'opencode-e2e-slow-'));
    try {
      mkdirSync(join(sandbox, '.config', 'opencode'), { recursive: true });
      mkdirSync(join(sandbox, '.local', 'share', 'opencode'), { recursive: true });
      copyFileSync(SLOW_CONFIG, join(sandbox, '.config', 'opencode', 'opencode.jsonc'));
      copyFileSync(join(homedir(), '.local', 'share', 'opencode', 'auth.json'), join(sandbox, '.local', 'share', 'opencode', 'auth.json'));

      const prompt =
        'First, list the tools you have available right now (just their names). ' +
        'Then call the slow_probe_ping tool and report exactly what it returns. ' +
        'If it is not available, say exactly: SLOW_TOOL_NOT_AVAILABLE.';

      const { code, output } = await runOpencode(sandbox, model, prompt, 240_000);
      const { text, toolUses } = extractText(output);

      // Report BOTH turns' observations verbatim (trimmed).
      console.log('=== SLOW-SERVER E2E: model text (trimmed) ===');
      console.log(text.slice(0, 6000));
      console.log('=== TOOL USES ===');
      for (const tu of toolUses) console.log('  ' + tu.slice(0, 300));
      console.log('=== END ===');
      console.log(`[E2E-SLOW] exit code: ${code}`);

      // THE CALL PROOF (transcript-level): the model must ACTUALLY invoke the
      // real MCP tool (tool === 'slow-probe_slow_probe_ping') and its output
      // must contain the server's response. This is the decisive evidence the
      // real tool is callable in the session — not just text ABOUT it.
      const realToolCall = toolUses.find(
        (tu) => tu.includes('slow-probe_slow_probe_ping') && tu.includes('slow-probe pong'),
      );
      console.log(`[E2E-SLOW] real tool call (toolUses contains slow-probe_slow_probe_ping -> pong): ${Boolean(realToolCall)}`);
      const explicitlyNotAvailable = text.includes('SLOW_TOOL_NOT_AVAILABLE');
      console.log(`[E2E-SLOW] model explicitly said tool NOT available: ${explicitlyNotAvailable}`);

      // DECISIVE: with wait-all, the slow server's real tool is in the frozen
      // session snapshot → the model calls it and gets the pong.
      expect(code, `opencode run failed (exit ${code}). Output:\n${text.slice(-3000)}`).toBe(0);
      expect(realToolCall).toBeDefined();
      expect(explicitlyNotAvailable).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 300_000);
});
