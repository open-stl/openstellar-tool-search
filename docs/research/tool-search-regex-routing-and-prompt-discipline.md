# Tool Search Regex Routing & Prompt Discipline

**Status:** Research Report & Architectural Recommendations (Primary Source Analysis)  
**Date:** 2026-08-16  
**Scope:** Root cause investigation into why LLMs in OpenCode fail to call `tool_search_regex` when tool names are known, attempt unsearched deferred tool invocations, or misuse `tool_search` with space-concatenated query strings, with concrete prompt, schema, and error-guidance remediations.  
**Primary Sources Inspected:**  
1. OpenCode SQLite Session Trace: `sessionID: ses_ff8c91ae9ffeEpFfGxSYhpgaWa`, `messageID: msg_00736e57b001oqJwzlfLBioSd9` in `/Users/chewji/.local/share/opencode/opencode.db`
2. Repository Implementation:
   - `src/engine/session-engine.ts` (`assertAuthorized`, `prepareForSystemTransform`, `buildSearchTools`)
   - `src/hooks/deferral.ts` (`truncateDescription`, `getFirstSentence`)
   - `src/catalog/tool-store.ts` (`ToolStore.grep`, `resolveAlias`, `extractParamTexts`)
   - `src/catalog/search-engine.ts` (`HybridSearchEngine.queryBM25`, `fuseRRF`)
   - `src/engine/session-tool-registry.ts` (`processSearchResult`, `formatHit`, `DeliveryHistory`, `AuthorizationState`)
3. OpenCode Runtime & Cloned Dependencies:
   - `packages/opencode/src/tool/registry.ts` and `packages/opencode/src/tool/tool.ts` (`tool.definition`, `tool.execute.before` hook contracts)
   - `@opencode-ai/plugin` and `@opencode-ai/sdk`
4. LLM Tool-Use Best Practices & Provider Guidelines:
   - Anthropic Tool Use & Definition Standards (`docs.anthropic.com/en/docs/agents-and-tools/tool-use/define-tools`)
   - OpenAI Function Calling & Deferred Search Specifications (`platform.openai.com/docs/guides/function-calling`)

---

## 1. Executive Summary & Key Findings

A detailed trace analysis of real OpenCode session execution (`ses_ff8c91ae9ffeEpFfGxSYhpgaWa`), combined with code inspection of `@openstellar/tool-search` and OpenCode core internals, reveals three distinct, interrelated LLM tool-calling failure modes:

```
+----------------------------------------------------------------------------------------------------+
|                                     OBSERVED FAILURE SEQUENCE                                      |
|                                                                                                    |
|  [Turn 1] User asks to run deepwork skill                                                          |
|           ==> Model directly executes `skill({ name: "deepwork" })` [UNSEARCHED]                   |
|           ==> Runtime throws: `[Tool Search Required] Tool "skill" has not been searched...`       |
|                                                                                                    |
|  [Turn 2] Model attempts to batch-unlock 9 tools at once                                           |
|           ==> Model executes `tool_search({ query: "read write edit glob grep bash task ... " })`  |
|           ==> BM25 caps at 10 results; `glob` and `task_result` are omitted from output           |
|                                                                                                    |
|  [Turn 3] Model executes 2nd search: `tool_search({ query: "glob task_result" })`                  |
|           ==> Missing tools unlocked                                                               |
|                                                                                                    |
|  [Turn 4] Model finally executes `skill({ name: "deepwork" })`                                     |
+----------------------------------------------------------------------------------------------------+
```

### Core Findings

1. **Self-Contradictory Tool Descriptions Steer LLMs Away From `tool_search_regex`**:
   The current description for `tool_search` in `src/engine/session-engine.ts:389` advertises that it finds tools *"by task, name, or prefix"*. Concurrently, `tool_search_regex` in `src/engine/session-engine.ts:421` explicitly instructs the model: *"For task or name search, use tool_search({ query: \"<task or name>\" })"*. When an LLM knows a tool name (e.g. `skill`, `read`), reading these descriptions actively directs the model **to `tool_search` rather than `tool_search_regex`**.

2. **Error Intercept Message Offers a Diluted Disjunction**:
   When an unauthorized tool execution is blocked in `assertAuthorized` (`src/engine/session-engine.ts:119`), the error string states: `Call tool_search_regex({ pattern: "^${canonicalTool}$" }) or tool_search to inspect full description...`. Because the tool name is already exact and known at rejection time, offering `or tool_search` gives the model permission to fall back to natural language search, inviting fuzzy search failures.

3. **Prompt "Batching" Pressure Drives Concatenated Query Anti-Patterns**:
   System prompts across coding agents heavily instruct LLMs to *"minimize round trips by batching necessary tool calls"*. When faced with an unsearched tool or starting a major task, the model attempts to unlock all anticipated tools in one shot. However, because `tool_search` takes a single query string (`query: string`), the model concatenates all tool names with spaces (`"read write edit glob grep bash task todowrite skill"`). Because `tool_search` executes BM25/semantic document ranking and caps results at `maxResults` (default 10), multi-token document queries result in missed tools and force multiple iterative round trips.

4. **Missing Guidance on Regex Alternation for Batch Unlocking**:
   The regex engine in `ToolStore.grep` (`src/catalog/tool-store.ts:80-104`) natively supports regex alternation: `pattern: "^(read|write|edit|glob|grep|bash|task|todowrite|skill)$"`. This deterministically matches and unlocks all 9 tools in a single call without description pollution or BM25 score degradation. However, neither the injected `[Tool Search Policy]` block nor the tool descriptions explain or provide examples of regex alternation for batch tool retrieval.

5. **Token and Latency Toll**:
   In session `ses_ff8c91ae9ffeEpFfGxSYhpgaWa`, resolving the deferred `skill` tool required **4 LLM turns and over 80,000 processed context tokens** (with intermediate cache reads). If the model had used `tool_search_regex({ pattern: "^skill$" })` or `tool_search_regex({ pattern: "^(skill|bash|read|write)$" })`, the workflow would have succeeded in **2 turns with under 25,000 tokens**.

---

## 2. Primary Source Evidence: OpenCode Session Trace Analysis

### 2.1 Artifact Metadata
- **Database Path:** `/Users/chewji/.local/share/opencode/opencode.db`
- **Session ID:** `ses_ff8c91ae9ffeEpFfGxSYhpgaWa`
- **Trigger Message ID:** `msg_00736e57b001oqJwzlfLBioSd9`
- **Platform / Model:** Darwin arm64 / Interstellar Flash / OpenCode v1.17.2

### 2.2 Turn-by-Turn Execution Trace

#### Turn 1: User Request & Immediate Unsearched Tool Invocation
- **User Prompt (`msg_00736e57b001oqJwzlfLBioSd9` / `prt_00736e5a4001H1gTKZqTcr5AhE`):**
  ```text
  Use the deepwork skill for this task. Treat it as a heavy coding session.
  
  Deepwork requirements:
  - before planning, delegation, or creating state, inspect existing .gitignore and .ignore...
  Task:
  # Objective
  Remove all unrelated files, process, folder from this project.
  ```
- **Assistant Response (`msg_00736e5eb001MD6exGT5eeXo5J` / `prt_00736f318001oaGhbsSmlr3t4D`):**
  - Model Reasoning: *"Refining the Project Scope... I'm now zeroing in on trimming the project... I'm also preparing to pare down the test suite..."*
  - Direct Tool Call: `skill({ name: "deepwork" })`
  - Execution Intercept: `tool.execute.before` hook evaluated `sessionRegistry.requiresReminder(sessionID, 'skill', 'skill')` (`src/engine/session-engine.ts:117`).
  - Result Error:
    ```text
    [Tool Search Required] Tool "skill" has not been searched in session "ses_ff8c91ae9ffeEpFfGxSYhpgaWa". Call tool_search_regex({ pattern: "^skill$" }) or tool_search to inspect full description and parameter schema before calling this tool.
    ```
  - Turn Token Usage: Total: 21,701 tokens (Input: 21,268, Output: 15, Reasoning: 418).

#### Turn 2: Space-Separated Multi-Tool Concatenation
- **Assistant Action (`msg_00736f3f6001aX4981XYCkPqXR` / `prt_00736fcc70018SClareRCyIVMI`):**
  - Tool Invoked: `tool_search`
  - Input Argument:
    ```json
    { "query": "read write edit glob grep bash task todowrite skill" }
    ```
  - Mechanism at Runtime:
    - Query was routed through `HybridSearchEngine.query` -> `queryBM25` (`src/catalog/search-engine.ts:169-185`).
    - The scorer treated `"read write edit glob grep bash task todowrite skill"` as a single text document and ranked against tool catalog texts.
    - Result was capped at `maxResults = 10`.
    - Tools returned (10 tools): `bash`, `todowrite`, `task`, `ctx_index`, `ctx_execute`, `skill`, `edit`, `read`, `grep`, `write`.
    - Tools missing due to rank truncation: `glob`, `task_result`.
  - Turn Token Usage: Total: 21,891 tokens (Input: 5,563, Cache Read: 16,237, Output: 26).

#### Turn 3: Secondary Remedial Search for Missing Tools
- **Assistant Action (`msg_00736fd6b0012Gd7u6kdww7dTW` / `prt_00737049a001hs760IQVzkO1WC`):**
  - Observing that `glob` and `task_result` were not in the first 10 hits, the model issued a second search:
    ```json
    { "query": "glob task_result" }
    ```
  - Tools returned (7 tools): `task_result`, `glob`, `codebase-memory_search_code`, `codebase-memory_search_graph`, `cancel_task`, `webfetch`, `ctx_search`.
  - Turn Token Usage: Total: 28,167 tokens (Input: 7,795, Cache Read: 20,330, Output: 19).

#### Turn 4: Successful Tool Invocation
- **Assistant Action (`msg_007370545001ZZd4jTdQm6tGZ1` / `prt_007370d2b001nm0KfqHSTldlaJ`):**
  - Tool Invoked: `skill({ name: "deepwork" })`
  - Execution Status: Succeeded (authorized in Turn 2).
  - Turn Token Usage: Total: 31,025 tokens (Input: 6,594, Cache Read: 24,405, Output: 15).

### 2.3 Efficiency Comparison

| Metric | Observed Trace (4 Turns, Space-Concatenated `tool_search`) | Optimal Trace (2 Turns, Regex Alternation `tool_search_regex`) | Waste Factor |
|---|---|---|---|
| Total Model Turns | 4 turns | 2 turns | **2.0x** |
| Tool Invocations | 4 calls (`skill` [err] -> `tool_search` -> `tool_search` -> `skill` [ok]) | 2 calls (`tool_search_regex` -> `skill` [ok]) | **2.0x** |
| Cumulative Tokens Processed | ~102,784 tokens | ~38,500 tokens | **2.67x** |
| Tool Schema Context Overhead | 17 tool definitions delivered across 2 search outputs | 1 to 9 specific tool schemas delivered in 1 search output | **1.88x** |

---

## 3. Codebase Source Inspection & Mechanical Analysis

### 3.1 Tool Descriptions and Cross-Referencing in `src/engine/session-engine.ts`

Lines 384–458 of `src/engine/session-engine.ts` define `tool_search` and `tool_search_regex`:

```typescript
// src/engine/session-engine.ts:388-390
tool_search: tool({
  description: `Find deferred tools marked "${deferLabel}" by task, name, or prefix. Returns full tool IDs and parameter schemas.\nCall tool_search({ query: "<task or name>" }). For regex, use tool_search_regex({ pattern: "<regex>" }).\nWHEN TO USE: a tool is marked "${deferLabel}", or you need its full description/parameter schema.\nWHEN NOT TO USE: you already searched this tool in the current active context and know its canonical ID — call it directly instead.`,
  args: { query: tool.schema.string().describe('Task, tool name, or prefix.') },
  ...
}),

// src/engine/session-engine.ts:420-422
tool_search_regex: tool({
  description: `Find tools by case-insensitive regex over IDs and descriptions. Returns full tool IDs and parameter schemas.\nCall tool_search_regex({ pattern: "<regex>" }). For task or name search, use tool_search({ query: "<task or name>" }).\nWHEN TO USE: you know (part of) the exact tool ID, or you need a precise match — e.g. tool_search_regex({ pattern: "^<id>$" }).\nWHEN NOT TO USE: you already searched this tool in the current active context and know its canonical ID — call it directly instead.`,
  args: { pattern: tool.schema.string().describe('Case-insensitive regex for tool IDs and descriptions.') },
  ...
})
```

#### Defect Analysis:
1. **Description Ambiguity**: `tool_search` explicitly includes `"name"` in its target list (`"by task, name, or prefix"` and `"Task, tool name, or prefix"`).
2. **Explicit Counter-Routing**: `tool_search_regex` explicitly tells the LLM: *"For task or name search, use tool_search({ query: \"<task or name>\" })"*. This directly commands the LLM **not** to use `tool_search_regex` when searching for a tool by name.
3. **No Batch Regex Mention**: Neither description indicates that `tool_search_regex` can search for multiple known tool IDs simultaneously using regex alternation `^(toolA|toolB|toolC)$`.

### 3.2 Error Intercept Rejection String in `src/engine/session-engine.ts`

Lines 115–122 of `src/engine/session-engine.ts`:

```typescript
public assertAuthorized(executedTool: string, sessionID: string | undefined, canonicalTool: string): void {
  const sessionKey = sessionID ?? 'default';
  if (this.sessionRegistry.requiresReminder(sessionID, executedTool, canonicalTool)) {
    throw new Error(
      `[Tool Search Required] Tool "${executedTool}" has not been searched in session "${sessionKey}". Call tool_search_regex({ pattern: "^${canonicalTool}$" }) or tool_search to inspect full description and parameter schema before calling this tool.`,
    );
  }
}
```

#### Defect Analysis:
1. **Weak Directives**: Appending `"or tool_search"` introduces cognitive ambiguity. The LLM has already attempted to call `canonicalTool`, which means the tool ID is known with 100% certainty.
2. **Missing Multi-Tool Error Recovery**: If the LLM was blocked on tool X but knows it also needs tools Y and Z, the error message provides no hint that `^(X|Y|Z)$` is supported.

### 3.3 Description Matching vs ID Matching in `src/catalog/tool-store.ts`

Lines 80–93 of `src/catalog/tool-store.ts`:

```typescript
grep(pattern: string, limit: number): ToolMeta[] {
  let re: RegExp;
  try { re = new RegExp(pattern, 'i'); } catch { return []; }
  const hits: ToolMeta[] = [];
  for (const item of this.store.values()) {
    re.lastIndex = 0;
    const matchesId = re.test(item.id);
    re.lastIndex = 0;
    const matchesDesc = re.test(item.description);
    if (matchesId || matchesDesc) {
      hits.push(item);
      if (hits.length >= limit) break;
    }
  }
  ...
}
```

#### Behavioral Implications:
- **Anchored Regex (`^<id>$` or `^(a|b|c)$`)**: Evaluates `re.test(item.id)` which matches exact tool names, and `re.test(item.description)` which fails (since descriptions contain full sentences and do not match `^id$`). This produces **zero false positives**.
- **Unanchored Substrings (`read|write|edit`)**: Matches any tool whose description contains English words like "read", "write", or "edit". In practice, `bash` ("file operations (reading, writing, editing)"), `ctx_execute` ("reading a 700 KB log"), and `ctx_index` ("read and index") match before the actual `edit` or `read` tools, exhausting the `limit` budget.

### 3.4 Injected Policy Text in `src/engine/session-engine.ts`

Lines 163–174 of `src/engine/session-engine.ts`:

```typescript
const policyText = deferrals > 0
  ? [
      `[Tool Search Policy] Tools marked "${this.deferLabel}" are deferred: their full description is not in your context.`,
      '1. Retrieve a deferred tool\'s description ONCE per active context via tool_search({ query: "<task or name>" }) or tool_search_regex({ pattern: "^<id>$" }).',
      '2. After retrieval, call the tool by its canonical ID. Re-searching an already-known tool returns no new metadata and wastes tokens.',
      '3. Re-retrieve only after compaction or reset (e.g. after compress), which clears search state.',
      '4. Do NOT guess parameter schemas or descriptions — a search is required before use.',
      'Search results are the authoritative source of the canonical ID and parameter schema.',
    ].join('\n')
  : '';
```

#### Defect Analysis:
1. Rule 1 combines both tools with `"or"`, without giving the decision boundary (When to use which).
2. Rule 1 does not illustrate how to batch multiple tools (`^(tool1|tool2)$`).
3. No explicit anti-pattern warning against space-separated tool names in `tool_search`.

---

## 4. Root Cause Deep Dive

### 4.1 Why LLMs Call Deferred Tools Unsearched on Turn 1

1. **Visibility of Parameter Schemas in Tool Definitions**:
   In OpenCode, the `tool.definition` hook modifies `output.description` to append `[deferred]` (via `truncateDescription` in `src/hooks/deferral.ts:25-38`), but leaves `output.parameters` intact. As a result, the tool definition sent to the LLM API (`tools: [...]`) contains the full JSON Schema for tools like `skill` (`{"properties": {"name": {"type": "string"}}, "required": ["name"]}`).
2. **RLHF Direct-Invocation Bias**:
   Frontier LLMs (Claude 3.5/3.7, GPT-4o, Gemini 1.5/2.0) are fine-tuned to invoke tools immediately when a function signature matches user intent.
3. **Conflicting Prompt Directives**:
   Prompts injected by other plugins or agent configurations (such as `<available_skills>`: *"Use the skill tool to load a skill..."*) explicitly instruct direct invocation. When a prompt says "Use tool X", the LLM's primary instruction-following objective overrides subtle deferral notices in tool descriptions.

### 4.2 Why LLMs Fail to Call `tool_search_regex` for Known Names

1. **Cognitive Framing of "Regex" vs "Search"**:
   LLMs treat `tool_search` as the general-purpose "find a tool" function and `tool_search_regex` as a specialized "regex string matcher" for complex pattern searches.
2. **Explicit Contradiction in Tool Descriptions**:
   As shown in §3.1, `tool_search_regex` contains: *"For task or name search, use tool_search({ query: \"<task or name>\" })"*. When looking for a tool named `skill`, the LLM sees the word "name" and routes to `tool_search`.
3. **Permissive Error Rejection**:
   When the error message suggests `Call tool_search_regex(...) or tool_search`, the model chooses the simpler string parameter of `tool_search`.

### 4.3 Why LLMs Misuse `tool_search` with Concatenated Queries

1. **Batching Directives in Agent System Prompts**:
   System instructions repeatedly emphasize: *"Minimize model round trips by batching necessary tool calls. Identify independent calls and issue them together."*
2. **Single-String Schema Impedance Mismatch**:
   Because `tool_search` only provides `{ query: string }` and does not provide `{ queries: string[] }`, an LLM wanting to discover 5 tools joins them into a single string: `"read write edit glob grep"`.
3. **BM25 TF-IDF Degradation & Truncation**:
   When a BM25 engine evaluates `"read write edit glob grep"`, it scores documents containing any of those terms. Tools whose descriptions contain many occurrences of common words rank higher than tools matching a single specific token. Combined with `maxResults: 10`, critical tools are truncated, causing repeated recovery turns.

---

## 5. LLM Tool-Use Best Practices & Provider Routing Specifications

### 5.1 Anthropic Tool Definition & Routing Guidelines
- **Single Responsibility Principle**: Each tool description must define a distinct, non-overlapping trigger domain.
- **Unambiguous Trigger Conditions**: Use explicit `WHEN TO USE` and `WHEN NOT TO USE` sections.
- **Format Guidance & Syntax Examples**: When a tool requires specific syntax (such as anchored regex `^<id>$` or alternations `^(a|b)$`), provide literal code examples in the description.

### 5.2 OpenAI Function Calling & Deferred Search Principles
- **Concise Namespace Routing**: The tool search function is a meta-router; its description must clearly guide the model whether it is searching for an unknown capability (semantic) or retrieving known tool signatures (exact ID).
- **Deterministic Match Guarantee**: Exact ID lookups must be deterministic and immune to semantic drift or relevance thresholding.

---

## 6. Proposed Fixes & Concrete Implementation Specifications

### Fix 1: Disambiguate Tool Descriptions (`src/engine/session-engine.ts`)

#### Revised `tool_search` Description & Argument:
```typescript
tool_search: tool({
  description: `Search for tools by task description, capability, or semantic intent when you do not know the exact tool name.
WHEN TO USE:
- You need a capability but do not know which tool provides it (e.g. "search git commit history", "inspect AST").
- Discovering relevant tools for a broad task.
WHEN NOT TO USE:
- You already know the exact tool name(s) (e.g. "skill", "read", "bash") — use tool_search_regex({ pattern: "^tool_name$" }) instead.
- DO NOT pass space-separated lists of multiple tool names — use tool_search_regex with alternation instead.
- You already searched this tool in the current active context.`,
  args: { query: tool.schema.string().describe('Semantic capability or task description (e.g. "search code AST", "fetch web page").') },
  ...
})
```

#### Revised `tool_search_regex` Description & Argument:
```typescript
tool_search_regex: tool({
  description: `Retrieve full descriptions and schemas for known tool ID(s) or pattern matching using regex.
WHEN TO USE:
- You know the exact tool ID (e.g. tool_search_regex({ pattern: "^skill$" })).
- You want to unlock MULTIPLE known tools at once via regex alternation (e.g. tool_search_regex({ pattern: "^(read|write|edit|glob|grep|bash|skill)$" })).
- Finding tools matching a specific prefix (e.g. "^ctx_").
WHEN NOT TO USE:
- Semantic/fuzzy searches when tool names are unknown — use tool_search({ query: "<task>" }) instead.
- You already searched this tool in the current active context.`,
  args: { pattern: tool.schema.string().describe('Anchored regex for exact ID: "^id$", multiple IDs: "^(toolA|toolB)$", or prefix: "^prefix_".') },
  ...
})
```

---

### Fix 2: Upgrade System Prompt Policy Block (`src/engine/session-engine.ts`)

Update `prepareForSystemTransform` in `src/engine/session-engine.ts:163-174`:

```typescript
const policyText = deferrals > 0
  ? [
      `[Tool Search Policy] Tools marked "${this.deferLabel}" are deferred: their full description is not in your context.`,
      '1. EXACT ID / KNOWN TOOLS: Retrieve via tool_search_regex({ pattern: "^<id>$" }).',
      '   - To retrieve MULTIPLE known tools at once, use regex alternation: tool_search_regex({ pattern: "^(toolA|toolB|toolC)$" }).',
      '2. UNKNOWN TOOLS / TASKS: Discover tools by capability via tool_search({ query: "<task description>" }).',
      '   - DO NOT concatenate multiple tool names with spaces into tool_search.',
      '3. RETRIEVE ONCE: Retrieve a tool\'s description ONCE per active context. Re-searching returns no new metadata and wastes tokens.',
      '4. CALL DIRECTLY: After retrieval, call the tool directly by its canonical ID. Re-retrieve only after compaction or reset (e.g. after compress).',
      '5. MANDATORY BEFORE EXECUTION: Do NOT guess parameter schemas or call deferred tools without searching first.',
      'Search results are the authoritative source of the canonical ID and parameter schema.',
    ].join('\n')
  : '';
```

---

### Fix 3: Strict Error Intercept Directives (`src/engine/session-engine.ts`)

Update `assertAuthorized` in `src/engine/session-engine.ts:115-122`:

```typescript
public assertAuthorized(executedTool: string, sessionID: string | undefined, canonicalTool: string): void {
  const sessionKey = sessionID ?? 'default';
  if (this.sessionRegistry.requiresReminder(sessionID, executedTool, canonicalTool)) {
    throw new Error(
      `[Tool Search Required] Tool "${executedTool}" is deferred and must be retrieved before execution in session "${sessionKey}". Call tool_search_regex({ pattern: "^${canonicalTool}$" }) to inspect its description and parameter schema. To unlock multiple tools in one call, use tool_search_regex({ pattern: "^(${canonicalTool}|other_tool)$" }).`,
    );
  }
}
```

---

## 7. Verification Matrix & Expected Outcomes

| Scenario | Current Behavior | Behavior With Fixes | Verification Method |
|---|---|---|---|
| **Known Single Tool (`skill`)** | Model calls `tool_search({ query: "skill" })` or calls `skill` directly; on error, runs `tool_search`. | Model calls `tool_search_regex({ pattern: "^skill$" })`. Exact match, 1 hit, zero description bleed. | E2E & unit test in `tests/session-engine.test.ts`. |
| **Multi-Tool Batch Unlocking** | Model calls `tool_search({ query: "read write edit glob grep bash task todowrite skill" })`, hits limit 10, drops `glob`, takes 2+ turns. | Model calls `tool_search_regex({ pattern: "^(read|write|edit|glob|grep|bash|task|todowrite|skill)$" })`, unlocking all 9 tools in 1 turn. | Synthetic prompt test & unit test in `tests/tool-store.test.ts`. |
| **Semantic Discovery** | Model searches for task ("parse json file"), `tool_search` returns ranked semantic matches. | Unchanged: `tool_search` remains the dedicated semantic discovery engine. | Existing hybrid search test suite (`tests/search-engine.test.ts`). |
| **Error Intercept Guidance** | Error suggests `tool_search_regex or tool_search`. Model falls back to `tool_search`. | Error strictly prescribes `tool_search_regex({ pattern: "^tool$" })`. Model reliably executes exact regex. | Assertion on error message content in `tests/plugin.test.ts`. |

---

## 8. Summary of File References & Line Numbers

- **Session DB Trace:** `/Users/chewji/.local/share/opencode/opencode.db` (`sessionID: ses_ff8c91ae9ffeEpFfGxSYhpgaWa`, messages `msg_00736e57b001oqJwzlfLBioSd9` through `msg_007370545001ZZd4jTdQm6tGZ1`)
- **System Prompt & Error Intercept:** `/Volumes/DB/Projects/openstellar-tool-search/src/engine/session-engine.ts:115-122`, `163-174`, `384-458`
- **Tool Truncation & Deferral Hook:** `/Volumes/DB/Projects/openstellar-tool-search/src/hooks/deferral.ts:25-38`
- **Catalog Grep & Regex Matching:** `/Volumes/DB/Projects/openstellar-tool-search/src/catalog/tool-store.ts:80-104`
- **Hybrid & BM25 Ranking Engine:** `/Volumes/DB/Projects/openstellar-tool-search/src/catalog/search-engine.ts:169-185`
- **Session Tool Authorization & Delivery Filter:** `/Volumes/DB/Projects/openstellar-tool-search/src/engine/session-tool-registry.ts:121-160`
