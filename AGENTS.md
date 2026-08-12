## Context Reduction Benchmark

`@openstellar/tool-search` reduces per-prompt system prompt token usage by deferring tool descriptions. Full parameter schemas are preserved; only descriptions are truncated to a first sentence + `[deferred]` label.

**Measured across 105 real tools (28 Built-in + 8 codebase-memory MCP + 69 pieces MCP):**

| Tool Catalog | Tools | Full Tokens | Deferred Tokens | Saved | Reduction |
|---|---|---|---|---|---|
| MCP `codebase-memory` | 8 | 3,179 | 2,362 | 817 | 25.7% |
| MCP `pieces` Suite | 69 | 53,723 | 35,366 | 18,357 | 34.2% |
| Built-in Core & Context-Mode | 28 | 7,773 | 4,689 | 3,084 | 39.7% |
| **All 105 Tools Combined** | **105** | **64,675** | **42,417** | **22,258** | **~34%** |

**Cumulative savings scale linearly with session length** (descriptions are re-sent every turn):

| Session length | Without Tool Search | With Tool Search | Tokens saved |
|---|---|---|---|
| 1 turn | 64,675 | 42,417 | 22,258 |
| 10 turns | 646,750 | 424,170 | 222,580 |
| 20 turns | 1,293,500 | 848,340 | 445,160 |
| 50 turns | 3,233,750 | 2,120,850 | 1,112,900 |

Encoder: `cl100k_base` (GPT-4 / Claude). See full methodology in `docs/research/context-reduction-benchmark.md`.

> **Note:** savings come exclusively from description truncation. Parameter schemas ship in full on every turn. A future parameter-stripping optimization would increase savings to ~60–70%.

## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.

## Cloned Dependency Source

Read-only dependency source repositories are available under `.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/anomalyco__opencode/` - `anomalyco/opencode` at `v1.17.2`; inspect OpenCode tool dispatch and plugin-hook behavior used by `@opencode-ai/plugin` and `@opencode-ai/sdk`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repository layout (`CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.
