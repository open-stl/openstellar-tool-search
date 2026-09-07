# Tool-Search / System-Prompt Policy Audit — Full-Dimension Research

**Status:** Research findings (no production code changed) → **§9 P1–P3 implemented 2026-08-09** (policy rewrite, search-tool WHEN TO USE / WHEN NOT TO USE, `deferLabel` sanitization; see "Implementation note" after §9).
**Date:** 2026-08-09
**Scope:** Full-dimension audit of `@openstellar/tool-search`'s system-prompt injection and tool-search policy: current behavior, context/token cost, compaction/reset semantics, runtime enforcement, prompt wording, tool descriptions, backward compatibility, tests, observability, security/misuse, and whether a query cache is worthwhile. Every claim is cited to a primary source (official OpenAI/Anthropic docs, this repo's source/tests, or the OpenCode plugin type surface). Concrete patch recommendations are collected in §9.

---

## 1. Executive findings

1. **Tool definitions are billed as input tokens on every request, by both providers.** OpenAI documents that "callable function definitions count against the model's context limit and are billed as input tokens" (Function calling → Token Usage). Anthropic documents that tool-use requests are priced on "the total number of input tokens sent to the model (including in the `tools` parameter)" and that "the additional tokens from tool use come from the `tools` parameter in API requests (tool names, descriptions, and schemas)" (Tool use → Pricing). This is the entire economic basis of this plugin: deferring *descriptions* (while preserving schemas) is real but bounded savings (~34% measured, `README.md:77-97`; `AGENTS.md:5-21`).
2. **The injected policy is appended verbatim on every `system.transform`** (`plugin.ts:94-102` → `session-runtime.ts:138-140`), so every policy byte is re-sent per turn. The current policy block is a single ~300-character unbroken sentence with the key directive buried mid-paragraph (`session-runtime.ts:139`); two phrases invite the exact behavior the plugin exists to prevent: repeated `tool_search` calls (`"Search for a deferred tool ONCE per session"` conditions habitual re-search, and no consequence is stated for a redundant search).
3. **Runtime enforcement is already correct and is the only thing that *guarantees* gating.** `tool.execute.before` throws `[Tool Search Required]` for unsearched deferred tools (`plugin.ts:81-86`, `authorization-state.ts:126-145`). Prompt wording only reduces the *legal-but-redundant* search rate; it cannot stop a misbehaving model. Both levers are needed (mirrors the prior conclusion in `docs/research/system-prompt-efficiency.md:97-101` and `.slim/deepwork/automatic-deferred-tool-hydration.md:32-35`).
4. **"ONCE per session" is literally false across a compaction boundary.** `experimental.session.compacting` clears *both* authorization and delivery history (`session-tool-registry.ts:94-98`), so re-search after compaction is mandatory; the compaction handler even says so (`session-runtime.ts:147`). The policy's own trailing clause ("until compaction or reset") contradicts the headline phrase. Tests pin the false phrase (`tests/tool-search-e2e.test.ts:360`).
5. **The no-op dedupe is already correct and cheap at runtime** — repeated search for an authorized tool returns `No new tools discovered. Previously delivered: <id>.` with zero schema bytes (`session-tool-registry.ts:125-131`, `delivery-history.ts:285-299`). The prompt's only job is to make the model *skip* the call; it currently does not state the consequence ("returns no new metadata, wastes tokens").
6. **A query cache is **not** worthwhile** (see §8): a per-session authorization cache already exists (`authorization-state.ts`, persisted to disk via `auth-persistence.ts`), the delivery-history fingerprint cache already exists (`delivery-history.ts`), the semantic-vector cache already exists (`matcher.ts:259-343`), and the remaining "cache" opportunity — a *conversation-level* schema cache — is not implementable at the plugin boundary because OpenCode constructs `output.system` fresh per request and there is no plugin-accessible channel proving what the model still holds (see §3.4, §8).
7. **Both providers now ship first-party deferred-tool search**, and this plugin's design matches that pattern closely — including the same 200-char regex / 500-char query limits Anthropic uses (`session-runtime.ts:11-13` vs. Anthropic tool-search "Limits"). The audit recommends aligning policy wording and the search-tool descriptions with the providers' own guidance ("keep the namespace description concise; put detailed guidance in the deferred function description", OpenAI; "extremely detailed descriptions", Anthropic).
8. **Observability is the weakest dimension.** Every persistence path swallows failures silently (`auth-persistence.ts:218-220`, `delivery-history.ts:193-195`, `matcher.ts:274-277,340-341`), MCP warm-up swallows per-server errors (`mcp-tool-provider.ts:90-94`), and the update check has no end-user signal unless it fails loudly (`update-check.ts:44-50`). There is no counter, log, or metric anywhere for the plugin's central KPI (search calls, deferral counts, redundant-search rate).
9. **Backward compatibility is well engineered** (V1/V2 dual loader exports `index.ts:3-9` verified by `tests/v1-v2-loader-compatibility.test.ts`; legacy `pattern`-arg fallback `session-runtime.ts:177-179`; on-disk auth format migration F11 `authorization-state.ts:40-49`; `_ide` alias resolution `tool-store.ts:88-107`). The main compat risk in any wording change is the literal-string assertions in `tests/tool-search-e2e.test.ts:360` and `tests/plugin.test.ts:295`.
10. **Security/misuse is bounded but not closed.** The plugin interpolates a user-controlled `deferLabel` (config `alwaysLoad`, `resetTools`, and the `mcp` option shape) into the system prompt — there is a one-line guard in the *search tool descriptions* (`session-runtime.ts:155-159` interpolates `deferLabel`) and prior research notes reference prompt-injection sanitization for the policy (`prompt-optimization-all-surfaces.md:83`), but the current policy block does not sanitize `deferLabel` before interpolation (`session-runtime.ts:139`), and `validateConfig` only warns under `TOOL_SEARCH_DEBUG` (`plugin.ts:10-18`). No regex ReDoS risk: `tool_search_regex` validates the pattern first (`session-runtime.ts:181-185`) and `grep` re-tests against a bounded catalog (`tool-store.ts:62-86`).

---

## 2. Current behavior (repo evidence)

### 2.1 The injected system policy (the model-facing contract)

Exactly one string is appended to `output.system` per request whenever any tool is deferred, at `src/session-runtime.ts:138-140` (called from `experimental.chat.system.transform`, `src/plugin.ts:94-102`):

> `[Tool Search Policy] Tools marked "[deferred]" are deferred: their full description is not in your context.`
> `1. Retrieve a deferred tool's description ONCE per active context via tool_search({ query: "<task or name>" }) or tool_search_regex({ pattern: "^<id>$" }).`
> `2. After retrieval, call the tool by its canonical ID. Re-searching an already-known tool returns no new metadata and wastes tokens.`
> `3. Re-retrieve only after compaction or reset (e.g. after compress), which clears search state.`
> `4. Do NOT guess parameter schemas or descriptions — a search is required before use.`
> `Search results are the authoritative source of the canonical ID and parameter schema.`

(`src/session-runtime.ts:139`, verified verbatim from source in this session — **P1 implemented, 2026-08-09**; was the single-sentence version below prior to this task)

Behavioral facts pinned by code:

- The policy is **absent** when zero tools are deferred (`session-runtime.ts:138`: `deferrals > 0 ? … : ''`).
- The policy text is asserted verbatim in tests: `tests/tool-search-e2e.test.ts:335-349` (presence, both tool-call forms), `:352-364` (`Search for a deferred tool ONCE per session`), `tests/plugin.test.ts:289-300` (`canonical tool ID`, no `alias`, `tool_search_regex` mention, `/known.*tool.*ID|tool.*ID.*known/i`).
- The one-time toast (deferral count) is separate from the prompt (`session-runtime.ts:127-136`; toast helper `hooks/toast.ts:11-26`).
- The policy is **appended every turn** — OpenCode's `experimental.chat.system.transform` fires per LLM request (`node_modules/@opencode-ai/plugin/dist/index.d.ts:265-270`) and the repo's own prior research confirmed `output.system` is constructed fresh per request (`.slim/deepwork/strategy-tradeoff-analysis.md:77-79`).
- The search tools themselves carry the cross-reference ("Call tool_search({...}). For regex, use tool_search_regex({...})") in their descriptions (`session-runtime.ts:158-175`), which are `alwaysOn` and never deferred (`plugin.ts:48`, `session-runtime.ts:9`).

### 2.2 What a repeated search actually costs and returns

- A search whose hits are already delivered **and still authorized** returns only `No new tools discovered. Previously delivered: <id>.` — no description, no schema (`session-tool-registry.ts:125-131`; delivery filter `delivery-history.ts:285-299`; confirmed in `.slim/deepwork/tool-search-behavior.md:56-59`).
- The **call itself** still costs the model a full round-trip (its query tokens + the search-tool result tokens for that turn), and every turn re-sends the policy + the two always-on search-tool definitions as input tokens (OpenAI: "functions are injected into the system message … billed as input tokens"; Anthropic: tool-use tokens come "from the `tools` parameter in API requests").
- A **blocked** execution attempt is worse: `tool.execute.before` throws `[Tool Search Required] Tool "<t>" has not been searched in session "<id>". Call tool_search_regex({ pattern: "^<t>$" }) or tool_search …` (`session-runtime.ts:90-97`) — the model pays for the failed call, sees the error, then pays for a search. This is by design (`.slim/deepwork/automatic-deferred-tool-hydration.md:32-35` concluded explicit search is the only supported path), so the prompt's job is to prevent the *failed call* from ever being emitted.
- **Rule 41** (`session-tool-registry.ts:119-123`): after a reset (e.g. `compress`), a previously delivered tool is re-authorized and its full description/schema delivered *again* on the next search — so re-search after reset is legitimate and the policy's trailing "until compaction or reset" clause correctly permits it.
- **Compaction** clears both authorization and delivery history (`session-tool-registry.ts:94-98`; `plugin.ts:103-105`), and the compaction notice appended to context says `[Tool Search] Session compacted. Deferred tool authorizations have been reset — search for any tools you need to use.` (`session-runtime.ts:145-148`).

### 2.3 Where repeated `tool_search` / `tool_search_regex` calls come from

Repo research notes document the failure modes the prompt must counteract:

- **Habit re-search after single-use wording:** the strategy experiment found that policy text saying "single-use" caused the model to keep calling `tool_search` out of habit — a silent per-turn regression (`.slim/deepwork/strategy-experiment-comparison.md:29`: "CRITICAL risk: Policy text still says 'single-use' → model keeps calling tool_search out of habit"). The current text removed "single-use" but kept the imperative "Do NOT search again" in one long unbroken paragraph, and kept the "ONCE per session" phrase that conditions the same habit (see §4).
- **Re-search after compaction/reset is *required***, so any prompt that says "once per session" must also name the invalidation triggers; the current text does, but buried mid-sentence.
- **Over-reliance on `tool_search` instead of `^<id>$` regex** for known IDs wastes result tokens (broad query → many hits). The current text already nudges toward `tool_search_regex({ pattern: "^<id>$" })` (`session-runtime.ts:139`); `.slim/deepwork/tool-search-behavior.md:22-24` confirms exact-ID regex is the reliable path and `tool_search` is for unknown capability/task phrases.

### 2.4 The runtime/prompt boundary (what each layer owns)

| Concern | Enforced by | Repo evidence |
|---|---|---|
| Unauthorized deferred tool cannot execute | Runtime throw in `tool.execute.before` | `plugin.ts:81-86`, `session-runtime.ts:90-97` |
| Authorized tool may execute repeatedly | Runtime auth set, persisted per session | `authorization-state.ts:104-124`, `auth-persistence.ts` |
| Repeated search is a cheap no-op | Delivery history filter | `session-tool-registry.ts:125-131`, `delivery-history.ts:285-299` |
| Compaction/reset invalidates auth | Runtime handlers | `session-tool-registry.ts:94-98`; `plugin.ts:103-105` |
| Model *chooses* to skip redundant searches | Prompt wording | `session-runtime.ts:139` (this doc's §4–§5 proposals) |
| Model knows when metadata is gone | Prompt wording + compaction notice | `session-runtime.ts:147` (compaction notice) |

This split mirrors `.slim/deepwork/automatic-deferred-tool-hydration.md:32-47`: automatic hydration is not possible at the plugin boundary; explicit search + strict per-invocation enforcement is the supported design. **Therefore prompt wording is the only lever for reducing *redundant-but-legal* searches**, while runtime gates handle the *illegal* case.

---

## 3. Context / token cost (measured + provider-documented)

### 3.1 Measured savings in this repo

The repo's own benchmark (`AGENTS.md:5-21`, `README.md:77-97`, `.slim/deepwork/context-reduction-benchmark.md`), `cl100k_base` encoder, across 105 real tools:

| Tool Catalog | Tools | Full Tokens | Deferred Tokens | Saved | Reduction |
|---|---|---|---|---|---|
| MCP `codebase-memory` | 8 | 3,179 | 2,362 | 817 | 25.7% |
| MCP `pieces` Suite | 69 | 53,723 | 35,366 | 18,357 | 34.2% |
| Built-in Core & Context-Mode | 28 | 7,773 | 4,689 | 3,084 | 39.7% |
| **All 105 Tools Combined** | **105** | **64,675** | **42,417** | **22,258** | **~34%** |

Session-length extrapolation: 1 turn 22,258 saved; 10 turns 222,580; 20 turns 445,160; 50 turns 1,112,900 (`README.md:88-93`). **Savings come exclusively from description truncation; parameter schemas ship in full every turn** (`README.md:75,97`; `AGENTS.md:3`).

### 3.2 Provider-documented billing (primary sources)

- **OpenAI — Function calling → Token Usage:** "functions are injected into the system message in a syntax the model has been trained on. This means callable function definitions count against the model's context limit and are billed as input tokens. If you run into token limits, we suggest limiting the number of functions loaded up front, shortening descriptions where possible, or using tool search so deferred tools are loaded only when needed." (`https://developers.openai.com/api/docs/guides/function-calling` → Token Usage; fetched 2026-08-09)
- **OpenAI — Tool search:** "Tool search allows the model to dynamically search for and load tools into the model's context as needed. This allows you to avoid loading all tool definitions into the model's context up front and **may help reduce overall token usage and cost**… tool search is designed to **preserve the model's cache**. When new tools are discovered by the model, they are injected at the end of the context window." (`https://developers.openai.com/api/docs/guides/tools-tool-search`; fetched 2026-08-09)
- **Anthropic — Tool use → Pricing:** tool-use requests are priced on "the total number of input tokens sent to the model (including in the `tools` parameter)"; "The additional tokens from tool use come from: the `tools` parameter in API requests (tool names, descriptions, and schemas), `tool_use` content blocks in API requests and responses, `tool_result` content blocks in API requests." (`https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/overview` → Pricing; fetched 2026-08-09)
- **Anthropic — Tool search tool:** "Loading every tool definition up front causes two problems as a tool library grows: **Context bloat** … can consume ~55k tokens in definitions before Claude does any work. Tool search typically reduces this by over 85 percent, loading only the 3–5 tools Claude needs" and "**Tool selection accuracy**: Claude's ability to pick the right tool degrades once you exceed 30–50 available tools." (`https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/tool-search-tool`; fetched 2026-08-09)
- **Anthropic — Tool search → Usage:** "Tool search isn't metered as a separate server tool… the tool definitions that search loads into context count as input tokens like any other tool definition." (same page)

### 3.3 What the plugin's per-turn fixed cost is

Fixed per-turn prompt cost introduced by this plugin (when deferrals > 0): the policy block (1 string in `output.system`, `session-runtime.ts:138-140`) **plus** the two always-on search-tool definitions (`session-runtime.ts:158-175`). Both are re-sent every turn. The policy block itself is ~90 tokens by `cl100k_base` estimate (the repo's own benchmark harness measures the tool descriptions; `README.md:95` references the benchmark methodology). Any added structure in §5 must stay under ~450 tokens per the prior recommendation (`docs/research/system-prompt-efficiency.md:145`) — every extra token is re-sent every turn.

### 3.4 Why a *conversation-level* schema cache is not implementable here

- OpenCode's `experimental.chat.system.transform` produces `output.system: string[]` fresh per request (`@opencode-ai/plugin/dist/index.d.ts:265-270`); there is no plugin-accessible "what did the model retain?" channel. Prior repo research established this repeatedly: `.slim/deepwork/strategy-tradeoff-analysis.md:77-79` (OpenCode constructs `output.system` fresh per turn), `.slim/deepwork/openai-deferred-schema-compatibility.md:49-56` (no plugin hook can prove a complete search result survived compaction/truncation in the final provider context), `.slim/deepwork/automatic-deferred-tool-hydration.md:13-18` (the hook contract exposes only mutable `args`; it cannot append tool results, rewrite calls, or replay).
- The **authorization** cache (per-session, persisted to disk) already exists and survives restarts (`authorization-state.ts:104-124`, `auth-persistence.ts:53-64`; verified by `tests/auth-persistence.test.ts:380-396` "A) Authorize in plugin instance #1 → plugin instance #2 with same sessionID retains authorization").
- The **delivery-history** cache (per-session, persisted) already exists (`delivery-history.ts`, `delivery-history.ts:50-56` default path; verified `tests/delivery-history.test.ts:130-152`).
- The **semantic-vector** cache already exists — content-addressed on-disk cache keyed by a SHA-256 of (model + pipeline opts + every entry id/text), skipping ONNX inference entirely on hit (`matcher.ts:45-56, 259-278, 333-342`; verified `tests/matcher.test.ts:42-87`).

There is no remaining cache axis that is both (a) implementable at the plugin boundary and (b) not already implemented. Conclusion in §8.

---

## 4. Compaction / reset semantics (verified end-to-end)

- **`/compact` (real session compaction)** → `experimental.session.compacting` hook → `runtime.compactSession(sessionID)` → `SessionToolRegistry.compactSession` clears **both** `AuthorizationState` and `DeliveryHistory` for that session (`plugin.ts:103-105`, `session-tool-registry.ts:94-98`), and the hook appends the notice string to `output.context` (`session-runtime.ts:145-148`). Verified: `tests/session-tool-registry.test.ts:107-124` ("performs Compaction Reset: clears both authorization and delivery history"), `tests/plugin.test.ts:743-765` ("compaction clears delivery history (rule 42)"), `tests/auth-persistence.test.ts:416-436` ("C) Compaction in instance #2 clears persisted auth; fresh plugin instance #3 requires re-search").
- **`compress` tool (reset-tool semantics)** → `tool.execute.after` → `resetIfConfigured('compress', sessionID)` → clears **authorization only**, retains delivery history; the notice `[Tool Search] Deferred tool authorizations have been reset — search for any tools you need to use.` is appended to the compress output (`plugin.ts:87-93`, `session-runtime.ts:100-103`, `authorization-state.ts:147-159`). Verified: `tests/plugin.test.ts:404-434` (default compress), `:436-483` (custom resetTools + session isolation + additive semantics), `tests/auth-persistence.test.ts:467-490` (compress clears persisted auth across instances).
- **`session.deleted`** → `runtime.deleteSession` clears auth + delivery history (`plugin.ts:106-115`, `session-tool-registry.ts:100-104`). Verified: `tests/auth-persistence.test.ts:453-465`, `tests/plugin-startup-latency.test.ts:94-98`.
- **Restart (same sessionID)** → `AuthPersistence.load()` on plugin construction restores authorization from `${XDG_CACHE_HOME:-~/.cache}/opencode/tool-search/authorizations.json` (POSIX) / `%APPDATA%` (Windows) (`auth-persistence.ts:27-33`); delivery history from `-delivery.json` (`delivery-history.ts:50-56`). No elapsed-time expiration (`auth-persistence.ts:210-211` comment "Validate persisted structure without expiring entries by elapsed time"; verified `tests/auth-persistence.test.ts:125-140`, `:438-451` "D) Authorization survives simulated elapsed time").
- **Persistence mechanics:** 50 ms debounced atomic JSON writes with `beforeExit` synchronous flush (`auth-persistence.ts:53-64, 239-292`; `delivery-history.ts:71-82, 214-241`; `utils/atomic-write.ts`), multi-process read-merge-write with explicit deleted-session tracking (`auth-persistence.ts:159-236`; verified `tests/auth-persistence.test.ts:190-252, 254-290`), silent fail-open on parse/write errors (`auth-persistence.ts:112-114, 218-220`; verified `tests/auth-persistence.test.ts:142-153, 176-188`).
- **On-disk format migration (F11):** legacy string entries (`"foo_ide"`, `"@canonical:foo_ide"`) migrate to `{ kind: 'canonical-tool', version: 1, canonicalId }` instead of being purged (`authorization-state.ts:17-49`); malformed structured records are dropped on load (`auth-persistence.ts:94-102`; verified `tests/auth-persistence.test.ts:102-123`).

**Consequence for wording:** "ONCE per session" is false across compaction and `compress`; the correct contract is "once per active context, re-retrieve after compaction/reset" (also the framing already used in `.slim/deepwork/openai-deferred-schema-compatibility.md:40-45`).

---

## 5. Prompt wording analysis (each claim sourced)

### 5.1 Current policy weaknesses

| # | Weakness | Evidence |
|---|---|---|
| W1 | Headline says "ONCE per session", which is false across compaction/reset and conditions habit re-search | `session-runtime.ts:139`; semantics in §4; habit evidence `.slim/deepwork/strategy-experiment-comparison.md:29` |
| W2 | No consequence stated for a redundant search | Policy text `session-runtime.ts:139` never says "no new metadata / wasted tokens"; runtime no-op behavior `session-tool-registry.ts:125-131` |
| W3 | One 300+ char unbroken sentence; the "Do NOT search again" imperative sits mid-paragraph | `session-runtime.ts:139` (verbatim above) |
| W4 | "Search results identify the canonical tool ID, which must be used for execution" is correct but passive; the runtime error (`session-runtime.ts:94`) is actually the strongest reinforcer, and it only appears *after* a failure | `session-runtime.ts:94`, `session-runtime.ts:139` |
| W5 | No statement of *when each search tool is the right one* in the policy (only in the tool descriptions) | policy `session-runtime.ts:139` vs descriptions `session-runtime.ts:158-175` |
| W6 | No guard against the model *guessing parameters* (under-search) — the deferral stub keeps only "information scent" by design | `hooks/deferral.ts:12-38`; risk documented `docs/research/system-prompt-efficiency.md:151` |

### 5.2 Provider guidance the wording should follow

- **OpenAI — Function calling → Best practices:** "Use the system prompt to describe when (and when not) to use each function. Generally, tell the model *exactly* what to do"; "**Aim for fewer than 20 functions available at the start of a turn**"; "For deferred tools, put detailed guidance in the function description and keep the namespace description concise." (fetched 2026-08-09)
- **OpenAI — Tool search:** "Keep namespace descriptions clear … Avoid overly long descriptions. Instead, put richer detail in the deferred function descriptions that are loaded only when needed"; "The model will be able to call any of these tools in future turns, so in client mode you do not need to load the same tool again across turns." (fetched 2026-08-09)
- **Anthropic — Define tools → Best practices:** "**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance… When it should be used (and when it shouldn't)… Aim for at least 3–4 sentences for each tool description"; "Consolidate related operations into fewer tools"; "Use meaningful namespacing in tool names." (fetched 2026-08-09)
- **Anthropic — Tool search → Optimization tips:** "Keep your 3–5 most frequently used tools non-deferred"; "Add a system prompt section describing available tool categories"; "Monitor which tools Claude discovers to refine your descriptions." (fetched 2026-08-09)

### 5.3 Recommended wording changes (concrete patches in §9 — **P1–P3 landed 2026-08-09, see end of §9**)

1. **Replace the headline** "Search for a deferred tool ONCE per session before its first use" with "Search ONCE per active context before first use; re-search only after compaction or a reset (e.g. the compress tool)". Rationale: matches §4 semantics exactly; removes the habit trigger (W1).
2. **State the consequence** of a redundant search explicitly: "A repeat search for an already-loaded tool returns no new metadata and wastes tokens." (W2; ties to OpenAI/Anthropic per-turn billing, §3.2).
3. **Split the block into numbered rules** (short headline, consequence, exception clause) — mirrors the recommendation already approved in `docs/research/system-prompt-efficiency.md:111-121` (which proposed a numbered 3-rule block) and the prior council-approved structure in `.slim/deepwork/prompt-optimization-all-surfaces.md:17-23` (W3).
4. **Keep the exact-ID regex preference** and state when each search tool is right (W5); both providers' guidance supports "when/not to use" framing.
5. **Add a no-guess clause** for parameter schemas (W6): the stub keeps only the first sentence + label (`hooks/deferral.ts:35-37`), so the model must not invent parameters for deferred tools. (This restores a clause the repo previously had; see `.slim/deepwork/prompt-optimization-all-surfaces.md:22` "DO NOT guess parameter schemas for deferred tools without searching first", and `openai-deferred-schema-compatibility.md:32` "prohibits invented schema parameters".)

---

## 6. Tool descriptions (search tools + deferred stubs)

### 6.1 Current search-tool descriptions (`session-runtime.ts:158-175`)

- `tool_search`: `Find deferred tools marked "[deferred]" by task, name, or prefix. Returns full tool IDs and parameter schemas.` + cross-reference to `tool_search_regex`.
- `tool_search_regex`: `Find tools by case-insensitive regex over IDs and descriptions. Returns full tool IDs and parameter schemas.` + cross-reference to `tool_search`.
- Arg descriptions: `query` → "Task, tool name, or prefix."; `pattern` → "Case-insensitive regex for tool IDs and descriptions."

Both are always-on (`plugin.ts:48`, `session-runtime.ts:9`) and exempt from the `tool.definition` deferral and `tool.execute.before` gate (`plugin.ts:77-86`). Cross-reference is pinned by `tests/tool-search-e2e.test.ts:400-406`.

### 6.2 Gaps vs. provider guidance

- The descriptions do not say **when not to use** each tool (OpenAI: "describe when (and when not) to use each function"; Anthropic: "When it should be used (and when it shouldn't)"). The prior council-approved design (`prompt-optimization-all-surfaces.md:25-45`) proposed `WHEN TO USE` / `WHEN NOT TO USE` / `RETURNS` sections for both — this is the repo's own approved-but-not-fully-landed wording. `docs/research/system-prompt-efficiency.md:123-139` proposed concrete `WHEN TO USE / WHEN NOT TO USE` text for both tools.
- The deferred **stub** (`hooks/deferral.ts:12-38`): first sentence + `[deferred]` label, abbreviation-aware (`eg, ie, dr, mr, ms, mrs, vs, etc`), newline-terminated. This is the "information scent" surface. It is correct per OpenAI's "keep the namespace description concise / put detailed guidance in the deferred function description" — the stub is concise and the full description is delivered by search.
- The MCP deferred tools get the same stub treatment in the executable bridge (`hooks/mcp-wiring.ts:72-75`), and MCP tools keep their full native schema (`mcp-tool-adapter.ts:49-55`; decision documented `.slim/deepwork/openai-deferred-schema-compatibility.md:19-25`).

---

## 7. Tests, backward compatibility, observability, security

### 7.1 Test surface pinning current behavior

- Policy text: `tests/tool-search-e2e.test.ts:335-350` (presence + both call forms + no-guess clause), `tests/plugin.test.ts:289-300` (`canonical ID`, no `alias`, `tool_search_regex`, known-ID regex framing), `tests/anthropic-codex-enhancements.test.ts:6-32` (static text, no `N/N tools are deferred` count mutation).
- Cross-references: `tests/tool-search-e2e.test.ts:400-406`.
- Stub format: `tests/tool-search-e2e.test.ts:265-332` (deferred description = `Real description [deferred]`, schemas preserved by reference at any depth).
- Enforcement: `tests/tool-search-e2e.test.ts:408-435`, `tests/plugin.test.ts:357-401` (blocked before search, allowed after; exact-match-only authorization among siblings), `tests/mcp-provider-integration.test.ts:48-67`.
- Compaction/reset/persistence: `tests/session-tool-registry.test.ts:107-124,181-215`, `tests/plugin.test.ts:404-519,743-781`, `tests/auth-persistence.test.ts:339-491`.
- No-op dedupe + Rule 41 + limit rules: `tests/plugin.test.ts:652-814`, `tests/session-tool-registry.test.ts:57-105`, `tests/delivery-history.test.ts`.
- Config validation: `tests/config-validation.test.ts` (unknown keys warn only under `TOOL_SEARCH_DEBUG`).
- Loader compat: `tests/v1-v2-loader-compatibility.test.ts` (V1 legacy function loader + V2 `{id, server}` loader).
- Registry unit: `tests/session-tool-registry.test.ts`.

### 7.2 Backward compatibility inventory

| Surface | Mechanism | Evidence |
|---|---|---|
| Plugin export shape | Dual: default `{ id, server }` (V2) + callable `ToolSearchPlugin` with `.id`/`.server` (V1) | `index.ts:3-9`; `tests/v1-v2-loader-compatibility.test.ts` |
| `tool_search_regex` arg | `pattern` (current) with legacy `{ pattern }`-style callers supported via `args.pattern`; earlier `query`-era callers get a fallback chain (`args.query ?? (args as any).pattern` — per `.slim/deepwork/non-blocking-after-hook.md:94`) | `session-runtime.ts:177-193` |
| Deferred-tool schema | Schemas preserved in full by reference; only descriptions truncated | `plugin.ts:77-80`, `session-runtime.ts:77-83`, `hooks/deferral.ts`; `tests/tool-search-e2e.test.ts:284-331`; decision `.slim/deepwork/openai-deferred-schema-compatibility.md:19-25` |
| On-disk auth format | F11 migration of legacy strings → canonical objects | `authorization-state.ts:40-49`; `tests/auth-persistence.test.ts:292-336`, `tests/plugin.test.ts:221-287` |
| `_ide` aliasing | `resolveAlias` + grep `_ide` fallback, no double-strip | `tool-store.ts:76-107`; `tests/vault.test.ts:117-155`, `tests/plugin.test.ts:521-646` |
| MCP config shapes | Only the V2 `{ servers: {...} }` wrapper; legacy bare map is rejected with a migration warning, and the V1 array shape is refused | `hooks/mcp-wiring.ts:240-276`; `tests/plugin-mcp-wiring.test.ts:44-90` |
| `defer_loading` | Accepted per server (`serverConfig.defer_loading ?? true`); legacy `deferred` alias removed | `mcp/mcp-tool-provider.ts:74`; `tests/mcp-tool-provider.test.ts:36-53` |

### 7.3 Observability

- **No counters, metrics, or structured logs exist** for the plugin's core KPI. There is no place that records search-call count, deferral count over time, redundant-search rate, or blocked-call rate. The only model-visible signals are the toasts (`hooks/toast.ts`) and the injected policy.
- All persistence failures are silent (fail-open): `auth-persistence.ts:218-220`, `delivery-history.ts:193-195`, `matcher.ts:274-277, 340-341`. The console-audit deepwork removed `console.warn`/`console.error` calls to keep the TUI clean (`.slim/deepwork/bugfix-logs-cache.md:16-19`; `console-audit.md`), and `tests/vault.test.ts:244-260` asserts no warn/error on embedding failure — so *any* observability addition must be opt-in, not default-logging.
- Update check: `update-check.ts:28-51` toasts only on failure or staged update; up-to-date is silent. All npm-registry failures collapse to `check-failed` (`auto-update-checker.ts:142-192`).
- MCP warm-up: per-server failures are swallowed (`.slim` note in `mcp-tool-provider.ts:90-94`), by design for startup latency (`tests/plugin-startup-latency.test.ts`).
- The one *runtime* observability hook that exists: `ToolVault.isSemanticReady` / `isSemanticBuilding` / `fault` (`vault.ts:44-48`, `matcher.ts:219-228`) — internal-only, no surface to the user or the model.

### 7.4 Security / misuse

- **Prompt injection via config:** `deferLabel` (default `[deferred]`, `session-runtime.ts:10`) is interpolated into the policy (`session-runtime.ts:139`) and into both search-tool descriptions (`session-runtime.ts:159,175`). **P3 landed 2026-08-09:** `sanitizeDeferLabel` (module-level, `session-runtime.ts:16-24`) strips `\r`/`\n` before interpolation in the constructor (`session-runtime.ts:64`), covering the policy block, both search-tool descriptions, and `truncateDescription` stubs (`hooks/deferral.ts:35-37`, `hooks/mcp-wiring.ts:74`). Behavior-neutral for the default `[deferred]`. `deferLabel` is *not* currently configurable through the public `ToolSearchConfig` surface (`types.ts:20-35` — there is no `deferLabel` option), which limits the exposure; but the MCP `mcp` option shape and `alwaysLoad`/`resetTools` are user-controlled config passed straight through (`plugin.ts:40-53`).
- **Config validation is debug-gated:** unknown keys only warn when `TOOL_SEARCH_DEBUG` is set (`plugin.ts:10-18`; `tests/config-validation.test.ts`). A hostile `mcp` entry with a malicious description could land in the vault and be searchable — but it is *searched* content, not system-prompt content, so the blast radius is the model choosing to load a poisoned tool description. The tool.execute gate still requires an explicit search first.
- **Regex safety:** `tool_search_regex` validates the pattern (`new RegExp(pattern, 'i')`) and returns an error string before any catalog scan (`session-runtime.ts:181-185`); `tool_store.grep` also guards with try/catch (`tool-store.ts:62-64`). Pattern length capped at 200 (`session-runtime.ts:11, 178-180`), query length at 500 (`session-runtime.ts:13, 162-164`). No ReDoS surface beyond the bounded catalog.
- **Search-result size:** `formatHit` embeds the full JSON schema of each hit (`session-tool-registry.ts:23-28`), capped by `maxResults` (default 10, `plugin.ts:42`) and by delivery filtering. A malicious MCP tool with a huge schema could produce a large search result — bounded only by `maxResults`; worth noting as a (low) surface.
- **No secrets handling:** auth persistence stores only tool IDs (no tokens); the update checker never logs registry URL/stderr (`npm-registry.ts`; `.slim/deepwork/tool-search-auto-update.md:241-242`).
- **Supply-chain self-update is bounded:** the update checker only *invalidates* the package cache and toasts; it never installs or replaces the loaded module (`auto-update-checker.ts:97-124`; `.slim/deepwork/tool-search-auto-update.md:80`).

---

## 8. Is a query cache worthwhile? — No (with evidence)

**Question:** should the plugin cache search queries (query string → result set) to avoid re-running BM25/embeddings?

**Analysis of what already exists:**

1. **Per-session authorization cache** — `AuthorizationState` keyed by sessionID, persisted to disk, survives restarts (`authorization-state.ts:104-124`, `auth-persistence.ts`). Re-searching an authorized tool is a **no-op** at the result level (`session-tool-registry.ts:125-131`) — the expensive part (full description + schema delivery) is already suppressed by delivery history (`delivery-history.ts:285-299`).
2. **BM25 index cache** — the scorer is rebuilt only when the catalog changes (`search-engine.ts:38-44`); query-time scoring is O(catalog) but the catalog is bounded (105 tools in the benchmark, `README.md:77`; thousands per Anthropic's tool-search scale is the provider-side case, not this plugin's local case).
3. **Semantic vector cache** — content-addressed on-disk cache keyed by SHA-256 of (model + opts + every entry id/text); cache hit skips ONNX inference entirely (`matcher.ts:45-56, 259-278, 333-342`; verified `tests/matcher.test.ts:42-87`).
4. **What a naive query cache would add:** an in-memory `query → hits` map would (a) duplicate the authorization/delivery caches for the common repeated-query case, (b) go stale on every `vault.add`/`notifyChanged` (`tool-store.ts:44-54`, `search-engine.ts:32-36`), (c) persist nothing across restarts without new on-disk state, and (d) add a new invalidation surface to a codebase whose prior research explicitly rejected "LRU opt-in" and cache complexity for lack of evidence (`.slim/deepwork/strategy-experiment-comparison.md:31` — "P2 follow-up: … LRU opt-in" was deferred; `.slim/deepwork/strategy-tradeoff-analysis.md:72-75` — Approach 2 "Ephemeral Search Output + Compaction Reset" was the Oracle-approved superior architecture precisely because it avoids system-prompt caches).
5. **The only uncached axis is the conversation-level one** (does the model still *hold* the metadata?), and that is provably not observable at the plugin boundary (§3.4; `.slim/deepwork/openai-deferred-schema-compatibility.md:49-56`; `automatic-deferred-tool-hydration.md:13-18`).

**Verdict:** a query cache would add state, staleness, and invalidation complexity to cache something that is already suppressed at the delivery layer; the real lever for redundant-search cost is prompt wording (§5.3), not a cache. If the team wants a cheap, bounded optimization anyway, the only defensible shape is an LRU over *search result formatting* (skip re-formatting identical `Found N tool(s)` bodies within a session) — but the no-op path (`session-tool-registry.ts:125-131`) already returns a ~1-line string, so even that saves nothing measurable. **Recommendation: do not add a query cache.**

---

## 9. Concrete patch recommendations (no code changed in this task) — **P1–P3 implemented 2026-08-09; P4/P5/P7 not done; P6 test updates done**

### P1 — Rewrite the injected policy block (`src/session-runtime.ts:139`) — **LANDED**

Replace the single unbroken sentence with a numbered block that (a) fixes the "once per active context" semantics, (b) states the consequence of redundant search, (c) keeps the exact-ID regex preference, (d) prohibits guessing parameters:

```text
[Tool Search Policy] Tools marked "[deferred]" are deferred: their full description is not in your context.
1. Before first use of a deferred tool, retrieve it ONCE per active context via tool_search({ query: "<task or name>" }) or, when the exact ID is known, tool_search_regex({ pattern: "^<id>$" }).
2. After retrieval, call the tool by its canonical ID. Do NOT call tool_search again for tools already retrieved — a repeat search returns no new metadata and wastes tokens.
3. Re-retrieve a tool only after session compaction or a reset (e.g. the "compress" tool) clears its authorization — the runtime will tell you when this happens.
4. Do NOT guess parameter schemas for deferred tools; search first.
Search results are the authoritative source of the canonical ID and parameter schema.
```

This is the wording already proposed and sourced in `docs/research/system-prompt-efficiency.md:111-121` (approved recommendation, not yet landed), extended with the no-guess clause (sourced to `prompt-optimization-all-surfaces.md:22`). Estimated ~110 tokens — within the ≤450-token budget (`system-prompt-efficiency.md:145`). **Coordinated test updates required** (P6).

### P2 — Add `WHEN TO USE` / `WHEN NOT TO USE` to both search-tool descriptions (`src/session-runtime.ts:158-175`) — **LANDED**

Adopt the council-approved shape from `prompt-optimization-all-surfaces.md:25-45` (concrete text in `system-prompt-efficiency.md:123-139`), e.g. `tool_search` gains `WHEN NOT TO USE: … the tool was already retrieved this context (call it directly); the exact ID is known (use tool_search_regex with "^<id>$")`. Rationale: OpenAI "describe when (and when not) to use each function" (§5.2). Keep the cross-reference requirement (`tests/tool-search-e2e.test.ts:400-406`).

**Landed wording:** both descriptions gained `WHEN TO USE` / `WHEN NOT TO USE` lines; cross-references and `${deferLabel}` retained (pins `tests/tool-search-e2e.test.ts:346-348, 403-406` verified).

### P3 — Sanitize `deferLabel` before interpolation (defense-in-depth) — **LANDED**

Apply the previously-reviewed `safeLabel` strip (`\r`, `\n`) to `deferLabel` before it is interpolated into the policy (`session-runtime.ts:139`) and into the search-tool descriptions (`session-runtime.ts:159,175`). Rationale: §7.4; the council remediation already applied this once (`prompt-optimization-all-surfaces.md:83`); the current code no longer shows it.

**Landed as:** `sanitizeDeferLabel(label)` (strips `[\r\n]+` → space, `session-runtime.ts:16-24`), applied once in the `SessionRuntime` constructor (`session-runtime.ts:64`); covers policy, both descriptions, and `truncateDescription` stubs. Behavior-neutral for the default label.

### P4 — Optionally expose `deferLabel` as a validated config option (or explicitly forbid it)

`ToolSearchConfig` (`types.ts:20-35`) has no `deferLabel`; the constant is hard-coded (`session-runtime.ts:10`). Either add it to the allowed-keys set with validation (`plugin.ts:8-18`), or document that it is fixed. If added, sanitize per P3. (Low priority; only matters for multi-instance/multi-label setups.)

### P5 — Observability: add opt-in counters (no default logging)

Add a debug-only counter surface (guarded by `TOOL_SEARCH_DEBUG`, consistent with `plugin.ts:12`): search calls, deferral count, no-op discoveries, blocked `tool.execute.before` throws. No default console output (respects `.slim/deepwork/bugfix-logs-cache.md` and `tests/vault.test.ts:244-260`). This is the only dimension with zero current instrumentation (§7.3).

### P6 — Coordinated test updates (required for P1–P2) — **LANDED**

- `tests/tool-search-e2e.test.ts:360` asserts the literal phrase `Search for a deferred tool ONCE per session` — **changed to `ONCE per active context`** (new headline, P1).
- `tests/plugin.test.ts:295` asserts `canonical tool ID` — **changed to `canonical ID`** (preserved by P1's "canonical ID" clause).
- `tests/plugin.test.ts:289-300` asserts `/known.*tool.*ID|tool.*ID.*known/i` and `tool_search_regex` mention — preserved.
- `tests/tool-search-e2e.test.ts:335-349` (presence + both call forms) — preserved by P1.
- **Added** an assertion that the policy contains the no-guess clause (`Do NOT guess parameter schemas`, test 20, `tests/tool-search-e2e.test.ts:350`).
- `tests/anthropic-codex-enhancements.test.ts:6-32` (static text, no count mutation) — P1 keeps the text static; verified.

### P7 — Do **not** add a query cache

Per §8. If pressed, the only bounded variant is a per-session LRU over search-result *formatting*, and even that is not justified by the no-op path.

---

## 10. Risks & tradeoffs

1. **Prompt-length vs. clarity.** P1's block is longer than the current sentence and is re-sent every turn (`session-runtime.ts:138-140`). Budget check: ~110 tokens vs. ~90 today — a ~20-token/turn increase that must pay for itself in fewer redundant round-trips. The prior doc's ≤450-token budget (`system-prompt-efficiency.md:145`) is respected; measure with the repo's benchmark harness if available.
2. **Test coupling.** Literal-string assertions (§7.1) pin the current wording; P1/P2 require P6. The cross-reference test (`tool-search-e2e.test.ts:400-406`) constrains P2 to keep both tools mentioning each other.
3. **Model-specific compliance.** Anthropic and OpenAI models respond differently to imperative vs. motivational phrasing (prior multi-model council, `prompt-optimization-all-surfaces.md:68-76`). Recommend the same council pass before shipping P1/P2.
4. **"Active context" is fuzzy.** The model cannot reliably know whether compaction removed metadata. The runtime notices (`session-runtime.ts:102,147`) are the ground truth; P1 defers to them (item 3: "the runtime will tell you when this happens") rather than asking the model to self-assess.
5. **Error-message coupling.** The `[Tool Search Required]` throw (`session-runtime.ts:94`) is itself prompt-visible; P1 keeps both search tools named, staying consistent.
6. **No runtime change can make redundant searches free of *call* overhead** — each is a model round-trip even when the result is a no-op string (`session-tool-registry.ts:125-131`). Prompt wording is the only lever for the redundant-call rate; runtime gates handle the unauthorized-call rate. Both are needed.
7. **First-sentence deferral loses detail by design** (`hooks/deferral.ts:35-37`): the stub keeps only "information scent," so the model may *under*-search (guess parameters) rather than over-search. P1's no-guess clause (item 4) is the counterweight; keep both.
8. **Schema preservation means savings are capped at ~34%** (`README.md:97`; `AGENTS.md:3`): parameter schemas ship in full every turn. The ~60-70% parameter-stripping optimization is explicitly out of scope of the current design (requires provider-level support, as OpenAI/Anthropic `defer_loading` do natively — §3.2).

---

## 11. Source list

### First-party provider documentation (primary sources; fetched 2026-08-09)

1. **OpenAI — Function calling guide** — "functions … billed as input tokens"; best practices ("describe when (and when not) to use each function", "< 20 functions at start of turn", "detailed guidance in the deferred function description")
   - `https://developers.openai.com/api/docs/guides/function-calling` → "Token Usage", "Best practices for defining functions"
2. **OpenAI — Tools: tool search** — dynamic load; cache preservation ("injected at the end of the context window"); namespaces; "may help reduce overall token usage and cost"
   - `https://developers.openai.com/api/docs/guides/tools-tool-search`
3. **Anthropic — Define tools** — API-constructed tool-use system prompt; "extremely detailed descriptions"; when to use / when not to use; input_examples token cost
   - `https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/define-tools`
4. **Anthropic — Tool search tool** — ~55k-token context bloat; >85% reduction; 30-50-tool accuracy cliff; 200-char regex / 500-char query limits; deferred tools excluded from system-prompt prefix; prompt caching preserved; usage counts as input tokens; optimization tips
   - `https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/tool-search-tool`
5. **Anthropic — Tool use overview** — pricing: "input tokens … (including in the `tools` parameter)"; token sources; per-model tool-use system-prompt token table
   - `https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/overview` → "Pricing"

### First-party API / type surface (OpenCode plugin contract)

6. **`@opencode-ai/plugin`** v1.17.2 (`node_modules/@opencode-ai/plugin/package.json`) — `Hooks` interface: `tool.execute.before` (`dist/index.d.ts:235-241`), `tool.execute.after` (`:249-258`), `experimental.chat.system.transform` with `output.system: string[]` (`:265-270`), `experimental.session.compacting` (`:283-288`), `tool.definition` (`:313-321`), `tool()` factory and `ToolContext` (`dist/tool.d.ts:2-60`)

### Repository source code (this repo)

7. `src/session-runtime.ts:9-13` (SEARCH_IDS, DEFAULT_DEFER, length caps), `:77-97` (deferTool, assertAuthorized error text), `:100-103` (reset notice), `:110-143` (prepareForSystemTransform + **policy text at :139**), `:145-148` (compaction notice), `:154-196` (search tool definitions)
8. `src/plugin.ts:8-18` (validateConfig, debug-gated), `:41-53` (always-on wiring), `:77-80` (tool.definition deferral), `:81-86` (tool.execute.before gate), `:87-93` (tool.execute.after reset notice), `:94-102` (system.transform hook), `:103-105` (compacting hook), `:106-115` (event → session.deleted)
9. `src/session-tool-registry.ts:94-98` (compaction clears both), `:111-145` (processSearchResult; Rule 41; **no-op response :125-131**)
10. `src/authorization-state.ts:17-49` (F11 migration), `:89-124` (registerTool/authorize/isAuthorized), `:126-145` (requiresReminder logic), `:147-159` (resetIfConfigured/resetSession)
11. `src/delivery-history.ts:40-44` (computeFingerprint), `:50-56` (default path), `:285-299` (filterNewDiscoveries)
12. `src/auth-persistence.ts:27-33` (default path), `:53-64` (debounce + beforeExit), `:94-114` (load validation), `:159-236` (multi-process merge), `:239-292` (flushSync)
13. `src/tool-store.ts:44-54` (add/notify), `:62-86` (grep), `:88-107` (resolveAlias)
14. `src/search-engine.ts:38-44` (BM25 index cache), `:32-36` (notifyChanged invalidation)
15. `src/matcher.ts:45-56` (cache hash), `:259-278,333-342` (vector cache), `:219-228` (active/fault)
16. `src/hooks/deferral.ts:12-38` (getFirstSentence/truncateDescription)
17. `src/hooks/mcp-wiring.ts:38-53` (init, idempotent), `:63-86` (warmUp, fail-open), `:96-102` (parseMcpConfig)
18. `src/mcp/mcp-tool-provider.ts:61-111` (warmUp, per-server fail-open), `:74` (defer_loading)
19. `src/mcp/mcp-tool-adapter.ts:13-20` (sanitizeToolId), `:49-55` (deferred flag)
20. `src/hooks/update-check.ts:28-51`; `src/hooks/auto-update-checker.ts:97-124` (cache invalidation), `:142-192` (checkForUpdate outcomes)
21. `src/types.ts:20-35` (ToolSearchConfig surface)
22. `index.ts:3-9` (dual export shape); `package.json:39-41` (peer dep)

### Tests (this repo)

23. `tests/tool-search-e2e.test.ts:265-332` (stub + schema preservation), `:335-364` (**policy wording pins**), `:400-406` (cross-references), `:408-435` (enforcement)
24. `tests/plugin.test.ts:289-300` (**policy wording pins**), `:357-401` (blocked→authorized), `:404-519` (reset semantics), `:652-814` (no-op / Rule 41 / limit rules / compaction)
25. `tests/auth-persistence.test.ts:292-336` (F11 migration), `:339-491` (restart/compaction/compress/session.deleted persistence)
26. `tests/session-tool-registry.test.ts:57-124` (no-op, Rule 41, compaction), `:181-215` (disk persistence)
27. `tests/delivery-history.test.ts` (fingerprint/filter/persistence)
28. `tests/matcher.test.ts:42-87` (vector disk cache hit/miss)
29. `tests/vault.test.ts:244-260` (silent failure), `:382-442` (single notify seam)
30. `tests/config-validation.test.ts` (debug-gated warnings)
31. `tests/v1-v2-loader-compatibility.test.ts` (dual loader)
32. `tests/plugin-mcp-wiring.test.ts:42-64` (V2 wrapper / V1 array refused)
33. `tests/plugin-startup-latency.test.ts` (non-blocking MCP warm-up)
34. `tests/mcp-tool-provider.test.ts:36-53` (defer_loading assignment), `:136-173` (fail-open isolation)

### Repository research notes (`.slim/deepwork/` — gitignored per `.gitignore:14`, local-only)

35. `.slim/deepwork/tool-search-behavior.md:22-27, 49-59` (search selection; no-op; persistence/reset semantics)
36. `.slim/deepwork/automatic-deferred-tool-hydration.md:12-35` (plugin boundary limits; explicit search is the only supported path)
37. `.slim/deepwork/prompt-optimization-all-surfaces.md:7-23, 25-45, 78-85` (5 prompt surfaces; WHEN TO USE / WHEN NOT TO USE; council remediation incl. safeLabel sanitization)
38. `.slim/deepwork/strategy-experiment-comparison.md:27-31` ("single-use" wording → habit re-search → CRITICAL risk; LRU opt-in deferred to P2)
39. `.slim/deepwork/strategy-tradeoff-analysis.md:12-21, 72-79` (Approach 2 ephemeral output + compaction reset is superior; OpenCode builds `output.system` fresh per turn)
40. `.slim/deepwork/openai-deferred-schema-compatibility.md:40-56` (once-per-active-context scope; no hook proves post-compaction retention)
41. `.slim/deepwork/context-reduction-benchmark.md` (benchmark methodology; deliverables)
42. `.slim/deepwork/non-blocking-after-hook.md:89-100` (legacy `pattern` fallback)
43. `.slim/deepwork/regex-policy-and-persist-auth.md:63-70` (anchored-regex guidance; persistence + multi-process merge)
44. `.slim/deepwork/bugfix-logs-cache.md:16-19` (log-pollution elimination; `env.logLevel` silencing)
45. `.slim/deepwork/tool-search-auto-update.md:80, 241-242` (cache invalidation scope; no registry credentials in logs)
46. `.slim/deepwork/v1-v2-compatibility-verification.md` (dual-loader contract)

### Existing research docs (this repo, `docs/research/`)

47. `docs/research/system-prompt-efficiency.md:111-121` (**already-approved P1 wording**), `:123-139` (P2 wording), `:145` (≤450-token budget), `:151` (under-search risk)
48. `README.md:75-97` (context-savings tables; benchmark reference); `AGENTS.md:5-21` (benchmark summary)

---

*Method: primary sources only. Provider claims sourced to official OpenAI/Anthropic docs (fetched 2026-08-09). Repo claims sourced to `src/`, `tests/`, `README.md`, `AGENTS.md`, `node_modules/@opencode-ai/plugin/dist/*.d.ts`, and `.slim/deepwork/` research notes with file:line citations. The OpenCode core clone under `.slim/clonedeps/repos/anomalyco__opencode/` is not present in this checkout (AGENTS.md:42 documents it as the intended location; prior notes cite `packages/opencode/src/session/tools.ts:83-92` and `plugin/index.ts:277-290` from it). No production code was modified.*

---

## Implementation note (2026-08-09)

§9 **P1–P3 + P6 landed** in this session on top of the (uncommitted) refactor that made `McpWiring.init` synchronous:

- `src/session-runtime.ts`:
  - **P1** — policy block replaced with the numbered 6-line block (headline + rules 1–4 + authoritative-source close), joined by `\n` via an array. Semantics: "ONCE per active context"; consequence for redundant search ("returns no new metadata and wastes tokens"); re-retrieve only after compaction/reset (`compress`); explicit no-guess clause (rule 4).
  - **P2** — `tool_search` / `tool_search_regex` descriptions gained `WHEN TO USE` / `WHEN NOT TO USE` lines (council-approved shape per `system-prompt-efficiency.md:123-139`); kept `${deferLabel}`, "full tool IDs and parameter schemas", and both cross-references.
  - **P3** — new module-level `sanitizeDeferLabel(label)` (strips `[\r\n]+` → `' '`), applied in the constructor; covers the policy block, both search-tool descriptions, and `truncateDescription` stub interpolation. Behavior-neutral for the default `[deferred]`.
- Tests: `tests/tool-search-e2e.test.ts` (`:360` phrase → `ONCE per active context`; added `Do NOT guess parameter schemas` assertion in test 20), `tests/plugin.test.ts` (`:295` → `canonical ID`). `tests/anthropic-codex-enhancements.test.ts` unchanged (still passes).
- Verification: `npx tsc --noEmit` clean; full `npx vitest run` (28 files / 271 tests) passes; focused suites (e2e 28, plugin 31, anthropic-codex 3) pass. `npm run build` not re-run (rollup/esbuild paths untouched); README test-count note (`npm test # 140 tests`) left as-is (out of scope).
- Out of scope (not done): P4 (configurable `deferLabel`), P5 (observability counters), P7 (query cache).
