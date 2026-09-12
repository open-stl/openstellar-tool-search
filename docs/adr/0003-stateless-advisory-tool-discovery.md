# 0003. Stateless Advisory Tool Discovery

Date: 2026-09-10

## Status

Accepted

## Context

In `@openstellar/tool-search`, ~300 tools are declared across built-in utilities and connected MCP servers. To conserve LLM context window tokens, non-essential tool descriptions are truncated to `[deferred]` placeholders, while full schemas and descriptions are stored in the Tool Vault.

Previously, `SessionEngine.assertAuthorized` enforced a hard execution gate: if a tool had not been searched in the current session via `tool_search` or `tool_search_regex`, any attempt to execute it was rejected with:
```
[Tool Search Required] Tool "<tool>" has not been searched in session "<sessionID>". Call tool_search_regex(...) to retrieve the full description and authorize this tool.
```

In production, this design suffered from critical failure modes:
1. **Model Retry Storms & Cognitive Collapse**: Models often failed to parse the rejection as an actionable directive, instead suffering from attention anchoring or meta-doubt (fearing the search tool was also blocked) and repeatedly retrying the blocked tool 19 to 78 times, exhausting tokens and eventually failing.
2. **Session Lifecycle Incompatibility**: OpenCode session forks and context compactions created new session IDs or cleared in-memory authorization states, repeatedly wiping permissions and triggering unexpected rejections mid-task.
3. **Subagent Bricking**: Subagents spawned with restricted tool sets (e.g. read-only review agents) lacked `tool_search_regex` in their tool manifests. When invoking deferred standard tools like `read` or `glob`, they deadlocked permanently.
4. **Accidental Complexity**: To keep the gate functional, the engine accumulated extensive stateful workarounds: in-memory `AuthorizationState`, message history scraping, LRU caches, and presence-regex heuristics.

Crucially, in the OpenCode tool declaration protocol, complete JSON parameter schemas (`properties`, `types`, `required`) remain present in the tools array even when prose descriptions are truncated with `[deferred]`. Models already possess sufficient structural information to invoke standard and self-describing tools without prior search.

## Decision

We eliminate the hard execution gate entirely and transition `@openstellar/tool-search` to **Stateless Advisory Tool Discovery (Option 2+)**:

1. **Ungated Execution**: `SessionEngine.assertAuthorized` no longer blocks tool execution. Any tool present in the active tool manifest executes immediately upon invocation without requiring prior search.
2. **Preserved Prompt Token Virtualization**: Non-essential tool descriptions remain truncated with `[deferred]` in tool declarations, preserving 100% of the upfront prompt token savings.
3. **On-Demand Discovery & Delivery Suppression**: `tool_search` and `tool_search_regex` remain first-class discovery utilities for inspecting full descriptions and schemas. `DeliveryHistory` is retained to suppress duplicate schema deliveries within the same context epoch (cleared on compaction/reset).
4. **On-Failure Reactive Guidance**: If a deferred tool invocation fails (e.g., parameter validation failure from Zod or MCP runtime), an advisory hint is appended to the error payload guiding the model to inspect the full schema via `tool_search_regex`.
5. **Decommission Ephemeral Authorization State**: In-memory session authorization maps, history-scraping lazy grants, and compaction authorization resets are removed as accidental complexity.

## Consequences

### Positive
- Zero artificial retry loops or execution deadlocks.
- 100% compatibility with session forking, compaction, and specialized subagents.
- Immediate turn-0 execution for tools the model already knows how to invoke (`bash`, `read`, `glob`, `grep`, well-typed MCP tools).
- Deletion of fragile in-memory authorization state and LRU history caches.

### Negative / Mitigations
- If a model invokes a complex, unfamiliar MCP tool without searching, it may pass invalid arguments. This is mitigated by native JSON Schema validation rejecting the call with an exact, typed error, augmented with a reactive discovery hint to inspect the full schema.
