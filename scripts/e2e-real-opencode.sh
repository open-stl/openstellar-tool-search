#!/usr/bin/env bash
# =============================================================================
# Real-opencode e2e for the MCP warm-up two-phase wait fix (Phase 3).
#
# WHAT THIS DOES
#   1. Builds the plugin (`npm run build`) so dist/index.js exists.
#   2. Spins up a REAL local MCP server (fixtures/race-probe-mcp-server.mjs) —
#      a tiny stdio JSON-RPC server advertising one tool `race_probe_ping`.
#   3. Runs the REAL installed `opencode` CLI headlessly (`opencode run`) inside
#      a SANDBOXED HOME (temporary dir with the fixture config installed as
#      ~/.config/opencode/opencode.jsonc + a copied auth credential). v1.18.15
#      has no `--config` flag, so HOME isolation is the supported way to point
#      the CLI at a specific config. The config loads dist/index.js + the local
#      MCP server — exactly the plugin format opencode accepts (same shape as
#      the user's real opencode.jsonc).
#   4. Asks the model to call `race_probe_ping`. Because the plugin defers MCP
#      tools, the model must first discover it via tool_search; the two-phase
#      warm-up wait lets the search find the tool, and the run must return
#      "race-probe pong".
#
# PREREQUISITES
#   - `opencode` on PATH (tested: 1.18.15)
#   - A model credential (`opencode auth list` non-empty; OpenCode Zen works).
#   - No network needed (all local; the MCP server is stdio).
#
# USAGE
#   scripts/e2e-real-opencode.sh [--model provider/model]
#     Default model: opencode/big-pickle (fast + cheap on Zen).
#     Set OPENCODE_E2E_MODEL to override, or pass --model.
#
# EXIT CODES
#   0  SUCCESS — the run called the MCP tool and got "race-probe pong".
#   1  Build/auth/prerequisite failure, or the run did NOT produce the expected
#      output (tool not found / not callable → the two-phase fix is not
#      working in the real CLI).
#   2  The CLI run itself failed (opencode error) — inspect stderr.
#
# WHY NOT A DEFAULT VITEST: driving a real LLM session is slow, costs tokens,
# and is environment-dependent. The vitest wrapper (tests/e2e-real-opencode.test.ts)
# runs this same scenario only when E2E_OPENCODE=1. Run:
#     E2E_OPENCODE=1 npx vitest run tests/e2e-real-opencode.test.ts
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL="${OPENCODE_E2E_MODEL:-opencode/big-pickle}"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

if [[ "${1:-}" == "--model" && -n "${2:-}" ]]; then
  MODEL="$2"
fi

echo "==> opencode version: $(opencode --version 2>&1)"

echo "==> Building plugin..."
(cd "$ROOT" && npm run build >/dev/null)

echo "==> Preparing sandboxed HOME (fixture config + copied auth)..."
mkdir -p "$SANDBOX/.config/opencode" "$SANDBOX/.local/share/opencode"
cp "$ROOT/fixtures/opencode.e2e.jsonc" "$SANDBOX/.config/opencode/opencode.jsonc"
cp "$HOME/.local/share/opencode/auth.json" "$SANDBOX/.local/share/opencode/auth.json"

echo "==> Checking model credential..."
if ! HOME="$SANDBOX" opencode auth list 2>&1 | grep -qi 'credential'; then
  echo "ERROR: no model credential found (sandboxed auth.json missing)." >&2
  exit 1
fi

echo "==> Running real opencode session (model=${MODEL})..."
echo "    prompt: call race_probe_ping and report what it returns"
set +e
OUTPUT="$(
  HOME="$SANDBOX" opencode run \
    --model "$MODEL" \
    --format json \
    --dir "$ROOT" \
    "Call the race_probe_ping tool and report exactly what it returns." 2>&1
)"
RC=$?
set -e

if [[ $RC -ne 0 ]]; then
  echo "ERROR: opencode run exited ${RC}." >&2
  echo "$OUTPUT" | tail -40 >&2
  exit 2
fi

if grep -q 'race-probe pong' <<<"$OUTPUT"; then
  echo "PASS: MCP tool discovered + called via tool_search in a real CLI session."
  echo "--- tail of session output ---"
  echo "$OUTPUT" | tail -15
  exit 0
fi

echo "FAIL: the session did NOT produce 'race-probe pong'." >&2
echo "The plugin likely did not expose the MCP tool (two-phase wait broken)." >&2
echo "--- tail of session output ---" >&2
echo "$OUTPUT" | tail -40 >&2
exit 1
