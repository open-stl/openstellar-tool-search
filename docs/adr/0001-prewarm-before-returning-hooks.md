# Prewarm before returning hooks

MCP tools used to be registered fire-and-forget after plugin startup, because awaiting the handshake made the CLI slow to open. Evidence from real sessions showed opencode captures each session's tool set at start (the snapshot) and never re-reads keys added later — so any MCP tool that arrived after startup was permanently uncallable in that session. We now prewarm: the factory waits for every enabled MCP server to settle, each bounded by its own timeout (default 60s, `timeout`), and a server past its timeout is deadlined (console.warn + failopen) while the others finish.

Considered Options: fire-and-forget warm-up (rejected — late-arriving tools are uncallable); a short 3-4s budget (rejected by measurement — gave up real tools for marginal speed); per-turn re-registration (rejected — no mechanism exists in the plugin contract); a forwarding proxy tool (rejected — the model must learn a wrapper convention, and deadlined servers have nothing to forward).

Consequences: CLI-open delay is now bounded by the slowest enabled server (≤ 60s), not ~instant. Users with no MCP servers see no delay. `timeout: 0` fire-and-forget mode was removed.
