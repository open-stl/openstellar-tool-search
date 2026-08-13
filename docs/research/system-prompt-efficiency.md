# System Prompt Efficiency & Tool-Search Instruction Design

**Status:** Research findings (no production code changed) → **§5 recommendations landed 2026-08-09** in `src/session-runtime.ts` (see §5 implementation note and `tool-search-policy-audit.md` end-of-file note).
**Date:** 2026-08-09
**Scope:** How to write system prompts efficiently; how `@openstellar/tool-search` should word its injected policy and tool descriptions to (a) prevent unnecessary repeated `tool_search` / `tool_search_regex` calls and (b) reduce per-turn context cost. Recommendations are sourced to the owning documentation or repository file/line.

---

## 1. Executive findings

1. **Tool definitions are billed as input tokens on every request** — both OpenAI and Anthropic document this. The savings this plugin measures (`AGENTS.md:5-21`, `README.md:77-93`) are real but only cover *description* truncation: **parameter schemas still ship in full every turn** (`AGENTS.md:3`, `README.md:75`), and each `tool_search`/`tool_search_regex` call *adds* the search result tokens to context on top of that.
2. **The current injected policy already contains the correct anti-repeat directive**, but it is one long single-sentence block, and **two phrasing weaknesses invite repeated searches**: (a) it never states the *consequence* of a repeated search ("no new metadata, ~N tokens wasted"), and (b) the "once per session … until compaction or reset" framing plus the error-message text (`session-runtime.ts:94`) reads like re-search is *required* after any interruption, which conditions models to re-search out of habit.
3. **Runtime enforcement (not prompt wording) is what actually prevents unauthorized execution.** The `tool.execute.before` gate (`plugin.ts:81-86`, `authorization-state.ts:126-145`) throws for unsearched deferred tools; the prompt only reduces the *noise* of redundant searches. Prompt wording and runtime gates must be designed together — a prompt-only fix cannot stop a misbehaving model, and enforcement-only makes every turn noisy.
4. **The deduplication machinery is already correct at runtime** — repeated searches for an authorized tool return `No new tools discovered. Previously delivered: <id>.` with zero tokens of schema (`session-tool-registry.ts:125-131`, `delivery-history.ts:285-299`). The prompt just needs to teach the model that this is a **no-op to avoid**, not an error to retry around.
5. **"ONCE per session" is subtly wrong under compaction.** `experimental.session.compacting` clears *both* authorization and delivery history (`session-tool-registry.ts:94-98`), so after a compaction the *next* use *must* re-search. The current policy says "remains authorized … until compaction or reset" (which is accurate), but the headline phrase "ONCE per session" and the tests that pin it (`tests/tool-search-e2e.test.ts:360`) should be reconciled to a per-active-context framing.
6. **Anthropic's "tool use system prompt" is assembled by the API** (`define-tools` docs), and **OpenAI's Responses API natively supports deferred "tool search"** — meaning this plugin's design matches a first-party pattern, and its guidance should align with those providers' own instructions.

---

## 2. Observed current behavior (repo evidence)

### 2.1 Injected system policy (the model-facing contract)

Exactly one string is appended to `output.system` per request when any tool is deferred, at `src/session-runtime.ts:138-140` (called from the `experimental.chat.system.transform` hook, `src/plugin.ts:94-102`):

> `Tools marked "[deferred]" are deferred. Search for a deferred tool ONCE per session before its first use using tool_search({ query: "<task or name>" }) or tool_search_regex({ pattern: "<regex>" }). Search results identify the canonical tool ID, which must be used for execution. Once searched, a tool remains authorized for all subsequent calls in the current session until compaction or reset. Do NOT search again for tools already searched in this session — call authorized tools directly. When the exact tool ID is known, prefer tool_search_regex({ pattern: "^<id>$" }).`

(`src/session-runtime.ts:139`)

Behavioral facts pinned by code:

- The policy is **absent** when zero tools are deferred (`session-runtime.ts:138`: `deferrals > 0 ? … : ''`).
- The deferral label and the "search first" instruction are also embedded in each search tool's own description (`session-runtime.ts:158-175`), which are `alwaysOn` and never deferred themselves (`plugin.ts:48`: `[...SEARCH_IDS, ...alwaysLoadTools]`, `session-runtime.ts:9`).
- The one-time toast is separate from the prompt (`session-runtime.ts:127-136`).
- The policy text is asserted verbatim in tests: `tests/tool-search-e2e.test.ts:335-349` (message presence, both tool call forms), `tests/tool-search-e2e.test.ts:352-364` (contains `Search for a deferred tool ONCE per session`), `tests/plugin.test.ts:289-300` (contains `canonical tool ID`, no `alias`, mentions `tool_search_regex`).

### 2.2 What a repeated search actually costs and returns

- A search hit that was already delivered and is still authorized returns **only** `No new tools discovered. Previously delivered: <id>.` — no description, no schema (`session-tool-registry.ts:125-131`; delivery filter at `delivery-history.ts:285-299`; confirmed in repo research note `.slim/deepwork/tool-search-behavior.md:56-59`).
- But the *call itself* still costs the model the full search-tool output tokens for that turn, plus whatever query the model typed. **Every turn re-sends the entire system prompt including the policy and the two always-on search-tool definitions** (OpenAI documents that tool definitions are injected into the system message and billed as input tokens each request — see §5.1; Anthropic documents the same for `tools` — see §5.2).
- A **failed/blocked** execution attempt is worse: the `tool.execute.before` gate throws `[Tool Search Required] Tool "<t>" has not been searched in session "<id>". Call tool_search_regex({ pattern: "^<t>$" }) or tool_search …` (`session-runtime.ts:90-97`) — the model pays for the failed call, sees the error, then pays for a search. This is by design (`automatic-deferred-tool-hydration.md` concluded explicit search is the only supported path), so the prompt's job is to prevent the *failed call* from happening in the first place.
- **Rule 41** (`session-tool-registry.ts:119-123`): after a reset (e.g. `compress`), a previously-delivered tool is re-authorized and its full description/schema are delivered *again* on the next search — so re-search after reset is legitimate and the policy's "until compaction or reset" clause correctly permits it.

### 2.3 Where repeated `tool_search`/`tool_search_regex` calls come from

Repo research notes document the failure modes the prompt must counteract:

- **Habit re-search after single-use wording:** the strategy experiment found the policy text saying "single-use" caused the model to keep calling `tool_search` out of habit, a silent per-turn regression (`strategy-experiment-comparison` → "CRITICAL risk: Policy text still says 'single-use' → model keeps calling tool_search out of habit"). The current text removed "single-use" but kept the imperative "Do NOT search again" in a long unbroken paragraph.
- **Re-search after compaction/reset is *required***, so any prompt that says "once per session" absolutely must also state the invalidation triggers; the current text does, but buried mid-sentence.
- **Over-reliance on `tool_search` instead of `^<id>$` regex** for known IDs wastes result tokens (broad query → many hits). The current text already nudges toward `tool_search_regex({ pattern: "^<id>$" })` (`session-runtime.ts:139`); the research note `tool-search-behavior.md:22-24` confirms exact-ID regex is the reliable path and `tool_search` is for unknown capability/task phrases.

### 2.4 The runtime/prompt boundary (what each layer owns)

| Concern | Enforced by | Repo evidence |
|---|---|---|
| Unauthorized deferred tool cannot execute | Runtime throw in `tool.execute.before` | `plugin.ts:81-86`, `session-runtime.ts:90-97` |
| Authorized tool may execute repeatedly | Runtime auth set, persisted per session | `authorization-state.ts:104-124`, `auth-persistence.ts` |
| Repeated search is a cheap no-op | Delivery history filter | `session-tool-registry.ts:125-131`, `delivery-history.ts:285-299` |
| Compaction/reset invalidates auth | Runtime handlers | `session-tool-registry.ts:94-98`; `plugin.ts:103-105` |
| Model *chooses* to skip redundant searches | Prompt wording | `session-runtime.ts:139` (this doc's §4 proposals) |
| Model knows when a tool's metadata is gone | Prompt wording + compaction notice | `session-runtime.ts:147` (compaction notice) |

This split mirrors the findings of `.slim/deepwork/automatic-deferred-tool-hydration.md:32-47`: automatic hydration is not possible at the plugin boundary; explicit search + strict per-invocation enforcement is the supported design. **Therefore prompt wording is the only lever for reducing *redundant-but-legal* searches** (searches for already-authorized tools), while runtime gates handle the *illegal* case.

---

## 3. Prompt design recommendations (each traced to its source)

### R1. Restructure the injected policy: short headline rule first, consequences second, exceptions last

**Source:** Anthropic's system-prompt guidance — put the most important instruction at the start and keep it unambiguous (`docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts`, "Structure prompts with XML tags", "Write clear instructions"); OpenAI's tool guidance — "Use the system prompt to describe when (and when not) to use each function. Generally, tell the model *exactly* what to do" (`platform.openai.com/docs/guides/function-calling` → "Best practices for defining functions").

Current problem: `session-runtime.ts:139` is one 300+ character unbroken sentence block; the imperative "Do NOT search again" sits after the explanation of authorization semantics. A model skimming the middle loses the rule.

### R2. State the *consequence* of a redundant search ("no new metadata, wasted tokens")

**Source:** the plugin's own runtime behavior — a redundant search yields only `No new tools discovered. Previously delivered: <id>.` (`session-tool-registry.ts:125-131`) and costs the turn's search tokens; OpenAI documents that all injected function definitions are billed as input tokens per request (`platform.openai.com/docs/guides/function-calling` → "Token Usage"). The repo's own benchmark quantifies the per-turn cost of shipping descriptions/schemas (`README.md:75-97`).

Why it helps: models are more compliant when a rule is tied to a concrete, verifiable outcome (Anthropic: "Provide context or motivation behind your instructions, such as explaining *why* … is important"; `docs.anthropic.com/…/prompt-engineering/system-prompts` → "Add context to improve performance").

### R3. Change the headline from "ONCE per session" to "once per active context" (per compaction semantics)

**Source:** the repo's own runtime — compaction clears both authorization and delivery history (`session-tool-registry.ts:94-98`), so re-search after compaction is mandatory, and the compaction handler explicitly tells the model "authorizations have been reset — search for any tools you need to use" (`session-runtime.ts:147`). "Once per session" is therefore literally false across a compaction boundary. The scope-change note in `.slim/deepwork/openai-deferred-schema-compatibility.md` ("Scope change — mandatory once-per-active-context retrieval") already uses the "active context" framing.

### R4. Keep the exact-ID regex preference, and state *when each search tool is the right one*

**Source:** OpenAI — "For deferred tools, put detailed guidance in the function description and keep the namespace description concise"; "Aim for fewer than 20 functions available at the start of a turn"; "Use tool search to defer large or infrequently used parts of your tool surface" (`platform.openai.com/docs/guides/function-calling` → "Best practices for defining functions"). Anthropic — "Provide extremely detailed descriptions … When it should be used (and when it shouldn't)" (`docs.anthropic.com/en/docs/agents-and-tools/tool-use/define-tools` → "Best practices for tool definitions"). Repo internal: `tool-search-behavior.md:22-24` (exact-ID regex is the reliable path) and the existing cross-references in both search tool descriptions (`session-runtime.ts:158-175`).

### R5. Move the durable decision guidance into AGENTS.md-style instructions, and make the *policy* shorter

**Source:** OpenAI — "For deferred tools, put detailed guidance in the function description and keep the namespace description concise. The namespace helps the model choose what to load; the function description helps it use the loaded tool correctly" (`platform.openai.com/docs/guides/function-calling`). Applied to this repo: the always-on search-tool *descriptions* (`session-runtime.ts:158-175`) are the "namespace"; the per-tool deferred stub is the first sentence of the tool's own description (`hooks/deferral.ts:35-37`). Every byte of the policy is re-sent each turn, so anything that can live in the user's own AGENTS.md (e.g. "which tool to prefer when" guidance) should live there, not in the injected block.

---

## 4. Runtime-vs-prompt enforcement boundary (where each lever applies)

- **Prompt wording** (`session-runtime.ts:139`) only influences model *behavior*. It cannot stop execution.
- **Runtime gates** (`plugin.ts:81-86`) guarantee an unsearched deferred tool cannot run; the error message (`session-runtime.ts:94`) is itself a prompt surface the model sees when it guessed wrong — it should stay terse and actionable (it currently is).
- **The delivery filter** (`session-tool-registry.ts:125-131`) already guarantees redundant searches cost ~0 tokens of *result*; prompt wording decides whether the search happens at all.
- **Compaction/reset** are the only two events that legitimately force re-search; the prompt must name both, and the runtime already emits notices for both (`session-runtime.ts:102`, `session-runtime.ts:147`).
- **Not enforceable by this plugin at all** (per `automatic-deferred-tool-hydration.md:23-45`): transparent hydration of deferred metadata into an in-flight call. Any prompt wording must therefore *assume* a search round-trip is the only retrieval path.

---

## 5. Concrete proposed prompt wording

> **Implementation note (2026-08-09):** §5.1–§5.3 landed in `src/session-runtime.ts` (policy block at `:139`; search-tool descriptions at `:159`/`:175`) with the no-guess clause added as rule 4 per `tool-search-policy-audit.md` §9-P1. See the end of that audit for the exact landed text and verification.

### 5.1 Proposed replacement for `src/session-runtime.ts:139` (policy block)

Keep the same single-string shape the hook appends (`plugin.ts:94-102`), but split into a headline rule, a consequence, and explicit invalidation triggers:

```text
[Tool Search Policy] Tools marked "[deferred]" are deferred: their full description is not in your context.
1. Before first use of a deferred tool, retrieve it ONCE per active context via tool_search({ query: "<task or name>" }) or, when the exact ID is known, tool_search_regex({ pattern: "^<id>$" }).
2. After retrieval, call the tool by its canonical ID. Do NOT call tool_search again for tools already retrieved — a repeat search returns no new metadata and wastes tokens.
3. Re-retrieve a tool only after session compaction or a reset (e.g. the "compress" tool) clears its authorization — the runtime will tell you when this happens.
Search results are the authoritative source of the canonical ID and parameter schema.
```

Rationale (each clause sourced in §3): numbered rules are easier to follow than one paragraph (R1); "wastes tokens" supplies the motivation (R2); "per active context" + the explicit trigger list matches the actual invalidation semantics in `session-tool-registry.ts:94-98` (R3); the exact-ID preference is preserved (R4); the "Search results are authoritative" line restates the canonical-ID requirement currently at `session-runtime.ts:139`.

> **Compatibility note (superseded 2026-08-09):** the tests previously asserted `Search for a deferred tool ONCE per session` (`tests/tool-search-e2e.test.ts:360`) and `canonical tool ID` (`tests/plugin.test.ts:295`). The landed wording drops the former literal string — the assertion was updated to `ONCE per active context`; `canonical tool ID` was changed to `canonical ID` (preserved in the "canonical ID" clause).

### 5.2 Proposed `tool_search` description (replaces `session-runtime.ts:158-160`)

```text
Find deferred tools marked "[deferred]" by task, name, or prefix; returns canonical tool IDs, full descriptions, and parameter schemas.
WHEN TO USE: you need a tool you have not retrieved in the active context, or you only know the task, not the ID.
WHEN NOT TO USE: the tool ID is already known (use tool_search_regex with pattern "^<id>$"); the tool was already retrieved this context (call it directly).
```

### 5.3 Proposed `tool_search_regex` description (replaces `session-runtime.ts:174-176`)

```text
Find tools by case-insensitive regex over canonical tool IDs and descriptions; returns full tool IDs and parameter schemas.
WHEN TO USE: exact-ID lookup (pattern "^<id>$") or a precise ID/description pattern.
WHEN NOT TO USE: natural-language task search (use tool_search); tools already retrieved this context (call them directly).
```

The `WHEN TO USE` / `WHEN NOT TO USE` split follows the concrete redesign already approved in the repo's own prompt-optimization research note (`.slim/deepwork/prompt-optimization-all-surfaces.md:8-12`, applied as Surfaces 2 and 3 there) and matches OpenAI's "describe when (and when not) to use each function" guidance (`platform.openai.com/docs/guides/function-calling`).

---

## 6. Risks & tradeoffs

1. **Prompt-length vs. clarity.** The proposed block is longer than the current single sentence. Every extra token is re-sent each turn (`session-runtime.ts:138-140` appended on every `system.transform`), so the added structure must pay for itself in fewer redundant search round-trips. If it does not, the net context cost rises. Mitigation: keep the policy ≤ ~450 tokens and measure (the repo has a benchmark harness: `scripts/benchmark_context_reduction.py`, `README.md:95`).
2. **Test coupling (resolved 2026-08-09).** `tests/tool-search-e2e.test.ts:360` previously pinned `Search for a deferred tool ONCE per session` → now asserts `ONCE per active context`; `tests/plugin.test.ts:295` pinned `canonical tool ID` → now asserts `canonical ID`. The cross-reference test at `tests/tool-search-e2e.test.ts:400-406` (each search tool's description must mention the other) still passes.
3. **Model-specific compliance.** Anthropic and OpenAI models respond differently to imperative vs. motivational phrasing; a wording that stops Claude from re-searching may not stop a GPT model (and vice versa). The repo already runs a multi-model council for prompt changes (`.slim/deepwork/prompt-optimization-all-surfaces.md:68-76`). Recommend the same before shipping wording.
4. **"Active context" is fuzzy.** The model cannot reliably know whether compaction actually removed a tool's metadata. The runtime notices (`session-runtime.ts:102,147`) are the ground truth; the prompt should defer to them rather than asking the model to self-assess context completeness (per the "mandatory once-per-active-context retrieval" scope note in `.slim/deepwork/openai-deferred-schema-compatibility.md`).
5. **Error-message coupling.** The `[Tool Search Required]` throw text (`session-runtime.ts:94`) is itself prompt-visible; if the policy changes the search-tool preference, the error text should stay consistent (it already names both tools).
6. **No runtime change can make redundant searches free of *call* overhead** — each is a model round-trip even when the result is a no-op string (`session-tool-registry.ts:125-131`). Prompt wording is the only lever for the redundant-call rate; runtime gates handle the unauthorized-call rate. Both are needed.
7. **First-sentence deferral loses detail by design** (`hooks/deferral.ts:35-37`): the stub keeps only "information scent," so the model may *under*-search (guess parameters) rather than over-search. The policy's "do not guess" clause is therefore as important as the "do not re-search" clause; keep both.

---

## 7. Source list

### First-party provider documentation (primary sources)

1. **OpenAI — Function calling guide** (Tool definitions billed as input tokens each request; tool search for deferred tools; <20 functions at start of turn; "describe when and when not to use each function"; namespace vs. function description guidance)
   - `https://platform.openai.com/docs/guides/function-calling` → sections "Token Usage", "Best practices for defining functions" (fetched 2026-08-09; indexed in this session)
2. **OpenAI — Tools: tool search** (native deferred-tool search pattern this plugin mirrors)
   - `https://platform.openai.com/api/docs/guides/tools-tool-search` (fetched 2026-08-09)
3. **Anthropic — Define tools** (API constructs a system prompt from tool definitions; "provide extremely detailed descriptions"; when to use / when not to use; parameter meanings)
   - `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/define-tools` (fetched 2026-08-09)
4. **Anthropic — Prompt engineering: system prompts** (XML/structure guidance; context/motivation behind instructions; role setting)
   - `https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts` (fetched 2026-08-09)
5. **Anthropic — Tool use overview** (per-request tool-definition token counts added to input tokens; tool use loop)
   - `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview` (fetched 2026-08-09)

### First-party API / type surface (OpenCode plugin contract)

6. **`@opencode-ai/plugin` type surface** — `Hooks` interface, `experimental.chat.system.transform` (mutates `output.system: string[]`) and `experimental.session.compacting`
   - `node_modules/@opencode-ai/plugin/dist/index.d.ts:173-288` (specifically `:265-270` for system.transform, `:283-288` for compaction)
7. OpenCode core dispatch/plugin-hook source (referenced but **not present** in this checkout — `.slim/clonedeps/repos/anomalyco__opencode/` is missing; AGENTS.md:42 documents it as the intended location, and prior research notes cite `packages/opencode/src/plugin/index.ts:277-290` and `session/tools.ts:83-92` from it)

### Repository source code (this repo)

8. `src/session-runtime.ts:9-13` (SEARCH_IDS, DEFAULT_DEFER, length caps), `:77-97` (deferTool, assertAuthorized error text), `:100-103` (reset notice), `:110-143` (prepareForSystemTransform + **policy text at :139**), `:145-148` (compaction notice), `:154-196` (search tool definitions)
9. `src/plugin.ts:41-53` (always-on wiring), `:77-80` (tool.definition deferral), `:81-86` (tool.execute.before gate), `:94-102` (system.transform hook), `:103-105` (compacting hook)
10. `src/session-tool-registry.ts:111-145` (processSearchResult; Rule 41; **no-op response at :125-131**), `:94-98` (compaction clears both)
11. `src/authorization-state.ts:89-124` (registerTool/authorize/isAuthorized), `:126-145` (requiresReminder logic)
12. `src/delivery-history.ts:285-299` (filterNewDiscoveries), `:40-44` (computeFingerprint)
13. `src/hooks/deferral.ts:35-37` (truncateDescription — first sentence + label)
14. `src/types.ts:20-35` (ToolSearchConfig options incl. `alwaysLoad`, `maxResults`, `mode`, `resetTools`)
15. `README.md:7-12, 52-54, 73-97` (positioning, auto-included search tools, context-savings tables), `:95` (docs/research reference)
16. `AGENTS.md:3-25` (benchmark summary; `docs/research/context-reduction-benchmark.md` reference), `:42` (clone location)

### Repository research notes (`.slim/deepwork/` — gitignored per `.gitignore:14`, local-only)

17. `.slim/deepwork/tool-search-behavior.md:22-27, 49-59` (search-tool selection; no-op on repeated search; persistence/reset semantics)
18. `.slim/deepwork/automatic-deferred-tool-hydration.md:12-18, 32-47` (plugin boundary limits; explicit search is the only supported path)
19. `.slim/deepwork/prompt-optimization-all-surfaces.md:7-12, 16-59` (5 prompt surfaces; WHEN TO USE / WHEN NOT TO USE redesign; council remediation incl. prompt-injection sanitization)
20. `.slim/deepwork/strategy-experiment-comparison.md` (Phase 2: "single-use" wording → habit re-search → CRITICAL risk; policy rewrite scope)
21. `.slim/deepwork/tool-search-strategy-comparison.md` (Phase 1 reconciliation: reuse of discovered tools is provider-aligned; stable prefix vs. re-injection)
22. `.slim/deepwork/openai-deferred-schema-compatibility.md` (Scope change: mandatory once-per-active-context retrieval; Gate 2 wording remediation)
23. `.slim/deepwork/context-reduction-benchmark.md` (methodology; deliverables; the `docs/research/` convention this file follows)

### Tests pinning current wording (must be updated with any wording change)

24. `tests/tool-search-e2e.test.ts:334-349` (system.transform message presence), `:352-364` (`Search for a deferred tool ONCE per session`), `:400-406` (cross-references)
25. `tests/plugin.test.ts:289-300` (`canonical tool ID`, no `alias`, regex preference)

---

*Method: primary sources only. Provider claims sourced to official OpenAI/Anthropic docs (fetched 2026-08-09). Repo claims sourced to `src/`, `tests/`, `README.md`, `AGENTS.md`, and `.slim/deepwork/` research notes with file:line citations. No production code was modified.*
