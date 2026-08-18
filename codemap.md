# Repository Atlas: @openstellar/tool-search

## Project Responsibility
`@openstellar/tool-search` is an on-demand tool search and deferred loading plugin for OpenCode, supporting both OpenCode 1.x and OpenCode 2.0 (`opencode2`) via a dual-compatibility architecture. It dramatically reduces initial LLM context consumption and prompt bloat by stripping full parameter schemas from inactive tool definitions, deferring them behind lightweight placeholders (`[deferred]`), and providing high-precision Dual Search discovery (`tool_search` via BM25 + ONNX dense vector embeddings + RRF ranking, and `tool_search_regex` via regex filtering).

The plugin manages per-session authorization state machines, tool delivery deduplication, MCP client connections (local stdio and remote HTTP transports), schema normalization (dereferencing `$ref` and converting Effect-TS ASTs), and automatic background update checks with package cache invalidation.

## System Entry Points & Root Assets
- `src/plugin.ts`: Primary dual-target plugin entry point supporting OpenCode 1.x callable function interface and OpenCode 2.0 `{ id, setup }` structure.
- `src/v2/setup.ts`: OpenCode 2.0 lifecycle adapter implementing tool transformations, execution hooks, session context synchronization, and event listeners.
- `src/core/bootstrap.ts`: Shared plugin lifecycle bootstrapper (`bootstrapPluginCore`), config validation, fallback MCP loading, and logging.
- `src/types.ts`: Core TypeScript definitions for configurations, search scoring, tool metadata (`ToolMeta`), hit structures (`Hit<T>`), and embedding settings.
- `package.json`: Project manifest, dependency definitions (`@modelcontextprotocol/sdk`, `@xenova/transformers`, `effect`), and build scripts.
- `esbuild.config.mjs`: Dual-target ESBuild bundling configuration producing ESM bundles for main runtime and isolated worker threads.
- `rollup.dts.config.mjs`: Type declaration bundling configuration generating consolidated `.d.ts` outputs.
- `tsconfig.json`: TypeScript compiler configuration targeting modern ES module resolutions.

---

## Repository Directory Map (Aggregated)

| Directory | Responsibility Summary | Detailed Map |
| :--- | :--- | :--- |
| `src/` | Plugin entry point, option validation, hook orchestration, and system-level coordination between engine, catalog, MCP, and host. | [View Map](src/codemap.md) |
| `src/core/` | Shared core bootstrap (`bootstrapPluginCore`), configuration validation, JSONC parsing, fallback MCP loading, and logging. | [View Map](src/core/codemap.md) |
| `src/v2/` | OpenCode 2.0 plugin lifecycle adapter, tool registration (`tool.transform`), execution hooks (`execute.before`, `execute.after`), and session context synchronization (`session.hook('context')`). | — |
| `src/catalog/` | Centralized tool metadata catalog, schema normalization (`$ref` inlining, Effect-TS conversion), Okapi BM25 ranking, ONNX vector embeddings with worker-thread offloading, and Reciprocal Rank Fusion (RRF). | [View Map](src/catalog/codemap.md) |
| `src/engine/` | Session runtime, state-machine authorization enforcement, content-addressable tool fingerprinting, delivery deduplication (Rule 41), context pruning synchronization, and persistence adapters. | [View Map](src/engine/codemap.md) |
| `src/hooks/` | OpenCode hook interceptors (`tool.definition`, `tool.execute.*`, `system.transform`), MCP server pre-warming lifecycle, update checks, package cache invalidation, and TUI toast delivery. | [View Map](src/hooks/codemap.md) |
| `src/mcp/` | Model Context Protocol (MCP) client manager, dynamic `ToolProvider`, JSON Schema-to-Zod adapter, connection pooling with promise coalescing, and tool execution wrappers. | [View Map](src/mcp/codemap.md) |
| `src/mcp/transports/` | Low-level transport connectors for local child process standard I/O (`stdio` with `stderr` diagnostics capture), remote streamable HTTP, and safe teardown. | [View Map](src/mcp/transports/codemap.md) |
| `src/utils/` | Reusable cross-cutting utilities, featuring crash-safe, race-free atomic file persistence (`writeJsonAtomic`). | [View Map](src/utils/codemap.md) |

---

## High-Level System Architecture & Flow

```
                                  +---------------------------------------+
                                  |            OpenCode Host              |
                                  +---------------------------------------+
                                        │                           │
                   tool.definition hook │                           │ tool.execute.* hook
                                        ▼                           ▼
                           +─────────────────────────+     +─────────────────────────+
                           |  src/hooks/deferral.ts  |     |   src/engine/session-   |
                           |   (Strip full schemas   |     |        engine.ts        |
                           |   & append [deferred])  |     |  (Assert Authorization  |
                           +─────────────────────────+     |   & Enforce Policies)   |
                                        │                  +─────────────────────────+
                                        ▼                               ▲
                           +─────────────────────────+                  │
                           |   src/catalog/vault.ts  |                  │
                           |       (ToolVault)       |                  │
                           +─────────────────────────+                  │
                             │                     │                    │
              BM25 Lexical   │                     │ Dense Vector       │ Unlocks tool
                 Retrieval   │                     │ (ONNX / Worker)    │ for session
                             ▼                     ▼                    │
                    +───────────────────────────────────+               │
                    |    src/catalog/search-engine.ts   |               │
                    |  (Cascade Gating & RRF Fusion)    |               │
                    +───────────────────────────────────+               │
                                        │                               │
                                        ▼                               │
                       +──────────────────────────────────+             │
                       |    tool_search / tool_search_    |             │
                       |              regex               |─────────────+
                       +──────────────────────────────────+
                                        ▲
                                        │ Discovers & Adapts
                       +──────────────────────────────────+
                       |    src/mcp/ (MCP Tool Provider   |
                       |    & Transport Connectors)       |
                       +──────────────────────────────────+
```

## Key Architectural Principles
1. **Context Window Minimization**: Full JSON parameter schemas are removed from initial model context; only short summary sentences marked with `[deferred]` are exposed until explicitly queried.
2. **Deterministic Multi-Stage Retrieval**: Fast-path Okapi BM25 scoring with fallback to ONNX vector cosine similarity and Reciprocal Rank Fusion ($k=60$) balances low latency with high recall.
3. **Off-Thread Processing**: CPU-bound embedding generation runs on a dedicated Node.js `worker_thread` with automatic main-thread fallback and disk cache.
4. **Resilient Session Authorization**: Tool access is strictly checked before execution; Sleev compression and context compaction prune stale authorizations to prevent hallucinated tool calls.
5. **Fail-Open MCP Integration**: Individual MCP server discovery is bounded by strict deadlines with diagnostic capture, ensuring slow or failing servers never block plugin boot.
