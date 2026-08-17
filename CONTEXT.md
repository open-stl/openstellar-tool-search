# openstellar-tool-search

A plugin that defers tool descriptions to shrink per-prompt tokens, and makes MCP servers' tools visible and callable inside opencode sessions despite opencode freezing each session's tool set at startup.

## Language

**Prewarm**:
The bounded wait, before the plugin factory returns, for every enabled MCP server to finish starting.
_Avoid_: pre-load, warm-start, boot-wait

**Settled**:
A server whose warm-up has ended, with tools or without.
_Avoid_: done, finished, ready

**Warming**:
A server still inside its prewarm window.
_Avoid_: starting up, booting, pending

**Deadlined**:
A server cut at its ceiling because it did not settle in time; it was warned about and contributed no tools.
_Avoid_: timed out, hung, failed

**Placeholder**:
The status tool, named after its server, that tells the model a server exists but is warming or deadlined.
_Avoid_: stub, proxy, marker tool

**Failopen**:
A server that settles without tools and does not block the others.
_Avoid_: fail-open, silent-fail, dropped

**Snapshot**:
The set of tools opencode captures at session start; tools outside it are uncallable for that session.
_Avoid_: tool list, catalog, frozen set

**Deferred Authorization**:
The session-bound permission state requiring a deferred tool to be discovered via search before execution.
_Avoid_: tool approval, whitelist, unlocked tool

**Tool Vault**:
The registry indexing all static and MCP tool metadata, descriptions, and parameter schemas.
_Avoid_: tool catalog, cache, index store

**Dual Search**:
The complementary discovery interface combining semantic/BM25 task discovery (`tool_search`) and exact/pattern ID matching (`tool_search_regex`).
_Avoid_: hybrid search, regex tool

**Tool Bloat Tax**:
The persistent computational, attention, and economic overhead induced by statically injecting complete, unused JSON tool schemas into every generation prompt turn.
_Avoid_: token waste, schema bloat, context cost

**Parameter-to-Description Ratio (PDR)**:
The structural ratio quantifying tool schema asymmetry: tokens consumed by parameter properties versus tokens consumed by unstructured prose descriptions.
_Avoid_: schema ratio, token split

**Deferred Tool Virtualization**:
The runtime mechanism transforming static tool declarations into single-sentence `[deferred]` placeholders while isolating full schemas out-of-band in the Tool Vault.
_Avoid_: lazy loading, stubbing, proxy tools

**Dual Context Optimization Theorem**:
The architectural principle establishing that Tool Search optimizes first-order static prompt bloat ($\mathcal{O}(T)$), which must be paired with message compaction (`compress`) to bound second-order conversation history accumulation ($\mathcal{O}(T^2)$).
_Avoid_: compound savings, double compression
