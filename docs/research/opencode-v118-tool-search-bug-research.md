# opencode v1.17.2 → v1.18.15: tool-availability research for `@openstellar/tool-search`

**Date:** 2026-08-10 · **Scope:** research only (no code changes) · **Status:** CONFIRMED / SPECULATED flags per finding

**Context being investigated:** some sessions can't find tools, some can. The plugin defers tool
descriptions via `[deferred]` labels and requires models to call `tool_search` /
`tool_search_regex` (registered as plugin tools) to discover/authorize tools first.

> **Local clone caveat:** the `.slim/clonedeps/repos/anomalyco__opencode` directory does not exist
> in this checkout (`.slim/` only contains `deepwork/` and `worktrees/`; `find` across
> `/Volumes/DB/Projects` and `/Users/chewji` found no `anomalyco__opencode`). All clone-inspection
> answers below were produced against the **same v1.17.2 source** via `raw.githubusercontent.com` at
> the `v1.17.2` tag and `gh` API, with file:line citations. The plugin source inspected on disk is
> this repo (`src/plugin.ts`, `src/session-runtime.ts`, etc.).

---

## Q1. v1.17.2 → v1.18.15 changes relevant to plugin tool registration / tool_search / MCP / deferral

### 1.1 CONFIRMED — The plugin hooks contract used by this plugin is byte-identical across 1.17.2 → 1.18.15

`@opencode-ai/plugin@1.17.2` and `@opencode-ai/plugin@1.18.15` ship the **identical**
`dist/index.d.ts` (both exactly 9,285 chars), including:

- `Hooks.tool?: { [key: string]: ToolDefinition }` — the surface used to register `tool_search`
- `"tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any })`
- `"tool.execute.before"?: (input: { tool: string; sessionID: string; callID: string }, output: { args: any })`
- `"tool.execute.after"?: (input: { tool: string; sessionID: string; callID: string; args: any }, output: ...)`
- `ToolContext` (the second arg of every `tool().execute`) carries `sessionID`, `messageID`, `agent`,
  `directory`, `worktree` (from `dist/tool.d.ts`).

Sources:
- https://unpkg.com/@opencode-ai/plugin@1.17.2/dist/index.d.ts
- https://unpkg.com/@opencode-ai/plugin@1.18.15/dist/index.d.ts (identical)
- https://unpkg.com/@opencode-ai/plugin@1.18.15/dist/tool.d.ts

The plugin's `tool.definition`-deferral / `tool.execute.before`-authorization mechanism therefore has
**no upstream contract change** in this range.

### 1.2 CONFIRMED — `tool_search` / `toolSearch` / deferred descriptions do not exist in stock opencode (neither tag)

Full tree scans of both tags:

- `v1.17.2` tree (`gh api .../git/trees/v1.17.2?recursive=1`, 6,437 entries): **0 hits** for `tool_search` / `toolSearch`.
- `v1.18.15` tree (7,270 entries): **0 hits**.
- No "defer" mentions in `packages/core/src/tool/registry.ts`, `packages/opencode/src/session/tools.ts`, `packages/opencode/src/mcp/catalog.ts` at v1.18.15.

Implication: `tool_search` / `tool_search_regex` are **plugin-provided tools** (this plugin registers
them via the `tool:` hook — `src/plugin.ts:76`), not an opencode built-in. Any version-specific
breakage must come from the *hooks runtime / catalog* behavior, not a `tool_search` implementation.

### 1.3 CONFIRMED — The only MCP-client change in range (SDK v2 in 1.18.8) was fully reverted in 1.18.9; net zero by 1.18.15

- **v1.18.8** shipped `feat(mcp): upgrade client SDK to v2` (PR #39247): swapped
  `@modelcontextprotocol/sdk@1.29.0` for `@modelcontextprotocol/client@2.0.0-beta.5`.
- **v1.18.9** shipped `fix(mcp): restore legacy SDK compatibility` (PR #39373): fully reverted #39247,
  #39259, #39265, #39369 back to `@modelcontextprotocol/sdk` 1.29.0, citing compatibility issues with
  legacy MCP servers (Xcode startup timeout, Atlassian OAuth issuer mismatch, Draft-07 schema rejection,
  ReUI OAuth auth failure, missing fallback after `server/discover` rejection).
- Confirmed in the code: `packages/opencode/src/mcp/catalog.ts` imports
  `@modelcontextprotocol/client` at `v1.18.8` but `@modelcontextprotocol/sdk/client/index.js` at both
  `v1.18.9` and `v1.18.15`.
- `mcp/index.ts` diff 1.17.2→1.18.15 shows 193 removed / 193 added lines — churn that nets to zero
  around the SDK switch.

**A user on 1.18.15 is on the stable MCP client path.** Sessions on 1.18.8 (transiently) would have
seen the v2 client, but the bug "some sessions, some not" doesn't line up with a tag-wide revert.

Sources:
- Release notes: v1.18.8 (`Reconnects MCP servers after expired SDK sessions...`) and v1.18.9
  (`Restored compatibility with legacy MCP SDK clients.`) — https://github.com/anomalyco/opencode/releases
- PR #39247 body (feat(mcp): upgrade client SDK to v2) — https://github.com/anomalyco/opencode/pull/39247
- PR #39373 body (fix(mcp): restore legacy SDK compatibility) — https://github.com/anomalyco/opencode/pull/39373
- `packages/opencode/src/mcp/catalog.ts` @ v1.18.8 / v1.18.9 / v1.18.15 — imports shown above

### 1.4 CONFIRMED — v1.17.10 "namespaced plugin hook APIs" + "V2 plugin API" added new surfaces, did not change the v1 `Hooks` contract used here

Release v1.17.10 lists:
- "Added namespaced plugin hook APIs."
- "Added the V2 plugin API for Effect and Promise plugins."

The v2 API lives under package export maps `@opencode-ai/plugin/v2/effect` and `/v2/promise`
(confirmed in `@opencode-ai/plugin@1.18.15/package.json` exports) and is additive. The v1 `Hooks`
interface this plugin uses is unchanged (finding 1.1). No change to v1 hook semantics in the range.

### 1.5 SPECULATED — no other release-note item in v1.17.1…v1.18.15 mentions tool registration, tool visibility, per-session tool lists, or warm-up

Keyword-screened all release bodies (v1.17.1–v1.18.15, from the GitHub releases API): the only
tool/MCP/session lines are MCP-catalog/progress/instructions/resource-tool items (v1.17.4–v1.17.8,
v1.17.10–v1.17.11), MCP SDK v2 + revert (1.18.8/1.18.9), and v1.18.15's
"Repeated compaction now keeps earlier tool-call history in summaries instead of dropping orphaned results."
Nothing mentions deferred/truncated tool descriptions or `tool_search`-style discovery. (SPECULATED only
because the release notes are abbreviated; the source diffs in 1.3 and the identical d.ts in 1.1 back it up.)

- Changelog note: **there is no CHANGELOG.md** in the repo at `v1.18.15` (raw fetch → 404); release notes are the changelog.

---

## Q2. How opencode calls `tool_search` on plugins + "unavailable-but-searchable" signaling (from v1.17.2 source)

### 2.1 CONFIRMED — `tool_search` is not "called by opencode": it is a plugin-registered tool executed like any other

The two search tools are created with `tool()` from `@opencode-ai/plugin` and returned from the
`tool:` hook:
- `src/session-runtime.ts:9` `SEARCH_IDS = {tool_search, tool_search_regex}`
- `src/session-runtime.ts:170-212` `buildSearchTools()` (both tools, with `execute(args, context)` using `context?.sessionID`)
- `src/plugin.ts:76` `tool: runtime.searchTools` — the Hooks.tool registration

Docs: "Plugins can also add custom tools to opencode" (`tool:` hook + `tool()` helper), and "If a
plugin tool uses the same name as a built-in tool, the plugin tool takes precedence."
- https://opencode.ai/docs/plugins/ (Custom tools section)

### 2.2 CONFIRMED — plugin tools and the hooks they trigger flow through a single per-process `Plugin.Service`

`packages/opencode/src/plugin/index.ts` @ v1.17.2:
- `Plugin.Service` exposes `hooks: Hooks[]` (lines ~33-53) and `applyPlugin()` (line 108) which pushes
  each plugin's returned hooks into the shared `hooks[]`.
- Plugin loading is sequential and **per Location (project/directory)**, not per session
  (lines ~130-218): "Keep plugin execution sequential so hook registration and execution" (line 215).
- The same Service is injected into `SessionTools.resolve` (`packages/opencode/src/session/tools.ts`
  @ v1.17.2: `const plugin = yield* Plugin.Service`).

### 2.3 CONFIRMED — "unavailable-but-searchable" is implemented by the plugin, not by opencode: `tool.definition` truncates; `tool.execute.before` throws

- `src/plugin.ts:77-80` — `tool.definition` hook: skips `SEARCH_IDS`; otherwise rewrites
  `output.description` to first sentence + `[deferred]` (via `runtime.deferTool`, `src/session-runtime.ts:86-92`).
- `src/plugin.ts:81-86` — `tool.execute.before` hook: skips search tools; resolves alias; calls
  `runtime.assertAuthorized(tool, sessionID, canonical)`.
- `src/session-runtime.ts:99-106` — `assertAuthorized` throws
  `[Tool Search Required] Tool "..." has not been searched in session "..."` when the session has not
  searched the tool yet.
- `src/session-runtime.ts:161-164` — `compactSession` resets authorizations on `experimental.session.compacting`.

The throwing hook is a documented pattern: opencode docs show `tool.execute.before` throwing to block a
tool (`.env protection` example) — https://opencode.ai/docs/plugins/ (Tool events / .env protection).

### 2.4 CONFIRMED — the hook inputs the plugin relies on are exactly `{tool, sessionID, callID}` and are unchanged

- `@opencode-ai/plugin` d.ts (both tags, identical): `"tool.execute.before"?: (input: { tool: string; sessionID: string; callID: string }, output: { args: any })`.
- v1.17.2 runtime call sites:
  - `packages/opencode/src/session/tools.ts` @ v1.17.2 (registry branch, lines ~88-89):
    `plugin.trigger("tool.execute.before", { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID }, { args })`
  - Same file, legacy branch (lines ~129-130) with `{ tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId }`.
- The plugin's `tool_search` `execute` receives `ToolContext.sessionID` — `src/session-runtime.ts:181, 202`.

---

## Q3. Is the tool catalog snapshotted per session, or resolved per request?

### 3.1 CONFIRMED — the catalog is NOT snapshotted per session; it is rebuilt lazily on every prompt

- Upstream issue #19300 "OpenCode MCP Tool Resolution Causes Large First-Turn and Per-Turn Overhead"
  (2026-03-26, closed): "On the first prompt for a workspace, MCP initialization connects every
  enabled MCP server... On later prompts, OpenCode still calls `listTools()` again for every connected
  MCP client inside `MCP.tools()`." — https://github.com/anomalyco/opencode/issues/19300
- v1.17.2 source: `SessionTools.resolve` (`packages/opencode/src/session/tools.ts`) builds the
  `tools: Record<string, AITool>` map from `registry.tools({modelID, providerID, agent})` + MCP tools
  inside the per-turn prompt path. Each tool call wraps `plugin.trigger("tool.execute.before", ...)`
  and `tool.execute.after` (lines 88-104, 129-148).

### 3.2 CONFIRMED — tool-call authorization is per-session in the plugin, stored in a runtime-owned map

`SessionToolRegistry` (`src/session-tool-registry.ts`) keys authorization by `sessionID`
(`assertAuthorized` → `sessionKey = sessionID ?? 'default'`, `src/session-runtime.ts:99-106`), and is
reset on compaction (`compactSession`, `src/session-runtime.ts:161-164`) or when `compress`/`resetTools`
executes (`handleToolExecuted`, `src/session-runtime.ts:109-112`).

### 3.3 CONFIRMED — "tools not found / unavailable tool" is a real upstream bug class, with matching reports

- **#33027 "MCP tools connected but not exposed to agent"** (open): MCP server connects, `tools/list`
  returns 6 valid tools, but they never reach the agent's tool list. Commenters reproduce on
  **1.18.1, 1.18.11, 2.0-next** (chrome-devtools-mcp, mcp-atlassian, pdfrag). One commenter:
  "The model then reports `Model tried to call unavailable tool`." — https://github.com/anomalyco/opencode/issues/33027
- **#39370 "tool_search no-match handling"** (closed as nit by maintainer): when `tool_search`'s query
  matches nothing, the model produced a malformed `input[N].arguments` call instead of failing cleanly.
  Reports on **1.18.8**. — https://github.com/anomalyco/opencode/issues/39370
- **#37650** (open): optional tool-input fields stored as `undefined` in permission metadata break
  `session.permission.list` schema encoding (tools: optional search metadata). — https://github.com/anomalyco/opencode/issues/37650
- **#34089** (open): compaction fails on Bedrock-backed providers when `toolConfig` is missing —
  compaction is the exact moment this plugin resets authorizations, so a failed compaction could leave
  a session's tools unauthorized. — https://github.com/anomalyco/opencode/issues/34089
- Related duplicates referenced by #33027 bot: #26357 (Docker MCP gateway connects but LLM can't
  invoke), #16491 (subagents can't execute MCP tools despite registry presence).

### 3.4 SPECULATED — compaction interplay

The v1.18.15 release note "Repeated compaction now keeps earlier tool-call history in summaries
instead of dropping orphaned results" indicates compaction behavior changed within the 1.18 line; since
this plugin resets authorizations on every compaction and the model must re-search after compaction,
any compaction failure/skip (e.g. #34089) would leave the session unauthorized for deferred tools.
SPECULATED — no source directly links this release note to the plugin's reset semantics.

---

## Q4. Parallel sessions: shared plugin instance / shared MCP connection?

### 4.1 CONFIRMED — all sessions in one opencode process share ONE plugin instance and ONE hook set

- `Plugin.Service` is a single Effect service; `applyPlugin` pushes every plugin's hooks into one
  shared `hooks[]` (`packages/opencode/src/plugin/index.ts` @ v1.17.2, lines 33-53, 108, 130-218).
  "Plugin execution" is a per-process singleton, loaded per Location (project dir), not per session.
- Each tool call triggers the *shared* hooks with a per-call `sessionID` in the input — so any state
  the plugin keeps must be keyed by `sessionID`, which this plugin does (`SessionToolRegistry`).

### 4.2 CONFIRMED — the plugin itself has a per-session map + a shared vault, and MCP wiring is session-scoped

- `src/session-runtime.ts:47-70` — one `SessionRuntime` per plugin instance; `vault` (tool catalog) is
  shared across sessions in the process; `sessionRegistry` holds per-session authorization.
- `src/plugin.ts:47-55` — `McpWiring` holds `runtime.vault`, `runtime.sessionRegistry`,
  `runtime.searchTools`, and warm-up is **fire-and-forget** (`mcp.init(...)` not awaited,
  `src/plugin.ts:59-65`): "MCP warm-up is background work and must never block initial plugin startup."
- `src/mcp/server-connection.ts` (in this repo) manages MCP connections; `src/hooks/mcp-wiring.ts`
  wires them. These are the pieces that could race across parallel sessions (see 4.3).

### 4.3 SPECULATED — plausible shared-state races matching "some sessions, some not"

- Parallel sessions share the same `vault` (tool catalog) and the same MCP wiring. A session that
  prompts while warm-up/`tools/list` is still in flight, or whose MCP connection is scoped to a
  directory/instance that differs from another session's, would see a different tool set.
- Upstream corroboration: #33027 comment (2026-07-15, opencode 1.18.1): "MCP state is scoped to the
  OpenCode instance directory. If OpenCode is started from a different working directory... the session
  prompt runs in another instance without its MCP tools. The model then reports
  `Model tried to call unavailable tool`." — https://github.com/anomalyco/opencode/issues/33027
- `McpWiring.init` is guarded by `mcp.isInitialized` (`src/plugin.ts:71-74`): a second session's
  `config` hook can race the first session's warm-up. SPECULATED — the repo's MCP wiring internals were
  not fully diffed in this pass.

---

## Bottom line for the reported bug

1. **Plugin contract: no change.** `@opencode-ai/plugin` Hooks (`tool`, `tool.definition`,
   `tool.execute.before/after`) is byte-identical 1.17.2 → 1.18.15 (CONFIRMED).
2. **The mechanism is plugin-side, not upstream.** Stock opencode has no `tool_search`; it's this
   plugin's tool, executed like any other with `sessionID` in context (CONFIRMED).
3. **"Some sessions, some not" is a documented upstream symptom** for MCP tools — #33027 with
   reproductions on 1.18.1/1.18.11/2.0-next, including the exact "Model tried to call unavailable tool"
   message, with working-directory/instance scoping as one root cause (CONFIRMED as a reported bug
   class; the directory-scope root cause is a reporter's analysis).
4. **No opencode version changed the tool-catalog semantics** in a way that would make a *plugin
   tool* disappear per-session; the catalog is rebuilt per prompt, and hook inputs are stable
   (CONFIRMED).
5. **Most probable non-version root causes** (SPECULATED, ordered): (a) MCP warm-up race / shared
   vault state across parallel sessions (4.2/4.3); (b) compaction failing or not firing the
   reset/`experimental.session.compacting` hook (3.3/3.4, #34089); (c) `tool_search` no-match →
   model hallucination path from #39370.

---

## Sources index

| Source | URL |
|---|---|
| Releases v1.17.0–v1.18.15 | https://github.com/anomalyco/opencode/releases |
| PR #39247 (MCP SDK v2, 1.18.8) | https://github.com/anomalyco/opencode/pull/39247 |
| PR #39373 (revert, 1.18.9) | https://github.com/anomalyco/opencode/pull/39373 |
| Issue #33027 (MCP connected, tools not exposed) | https://github.com/anomalyco/opencode/issues/33027 |
| Issue #19300 (MCP tools re-resolved per prompt) | https://github.com/anomalyco/opencode/issues/19300 |
| Issue #39370 (tool_search no-match) | https://github.com/anomalyco/opencode/issues/39370 |
| Issue #37650 (optional search metadata) | https://github.com/anomalyco/opencode/issues/37650 |
| Issue #34089 (compaction toolConfig) | https://github.com/anomalyco/opencode/issues/34089 |
| Issue #35963 (plugin tools isolate on reload) | https://github.com/anomalyco/opencode/issues/35963 |
| Plugins docs (tool hook, tool.execute.before throw) | https://opencode.ai/docs/plugins/ |
| `@opencode-ai/plugin` d.ts (both tags, identical) | https://unpkg.com/@opencode-ai/plugin@1.18.15/dist/index.d.ts |
| v1.17.2 source (raw) | https://raw.githubusercontent.com/anomalyco/opencode/v1.17.2/packages/opencode/src/plugin/index.ts, .../session/tools.ts, .../mcp/index.ts |
| This plugin (local) | `src/plugin.ts`, `src/session-runtime.ts`, `src/session-tool-registry.ts`, `src/hooks/mcp-wiring.ts` |

**Not found in sources:** any opencode change that would make a plugin-registered tool
(`tool:` hook) disappear for some sessions but not others; any CHANGELOG.md (does not exist at
v1.18.15); any `tool_search`/deferred-description implementation inside the opencode monorepo
(it is entirely plugin-side).
