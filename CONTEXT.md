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
