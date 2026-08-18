# src/

## Responsibility
The root `src/` directory serves as the core entry point and orchestration layer for the `openstellar-tool-search` OpenCode plugin. It defines the public plugin interface (`ToolSearchPlugin`), the configuration schema and data structures (`types.ts`), and wires together the session runtime, tool deferred catalog, MCP server management, and hook lifecycle listeners that integrate with OpenCode.

## Design Patterns
- **Plugin Architecture**: Implements the `@opencode-ai/plugin` specification via `ToolSearchPluginImpl` exported as `ToolSearchPlugin` (v1) and `setupV2` (v2).
- **Core Bootstrapper & Lifecycle Unification**: Delegates shared configuration parsing, runtime instantiation, fallback MCP discovery, pre-warming, and startup notifications to `src/core/bootstrap.ts` (`bootstrapPluginCore`).
- **Facade & Orchestration**: Acts as a thin boundary coordinating sub-modules (`core`, `engine`, `catalog`, `hooks`, `mcp`, `utils`) while translating OpenCode hook events into internal runtime actions.
- **Dependency Injection**: Injects the plugin execution context (`PluginContext`), configuration options, and subordinate managers into `SessionRuntime`, `McpWiring`, and `UpdateCheckLifecycle`.
- **Options Normalizer / Factory**: Validates input plugin configuration against known keys (`ALLOWED_CONFIG_KEYS`) and constructs typed runtime configurations (such as embedding settings via `buildEmbedding`).

## Data & Control Flow
1. **Plugin Initialization**:
   - OpenCode loads `ToolSearchPlugin(ctx, options)` (v1) or `setupV2(ctx, options)` (v2).
   - `bootstrapPluginCore` merges options and validates config with `validateConfig`.
   - `SessionRuntime` is instantiated with configured `alwaysLoad` tools, `resetTools`, `maxResults`, `deferLabel`, and embedding settings (`buildEmbedding`).
   - `McpWiring` and `UpdateCheckLifecycle` are instantiated with runtime dependencies.
   - MCP configurations (from options or fallback discovery via `loadFallbackMcpConfig`) are initialized and pre-warmed via `mcp.preWarm()`.
   - Diagnostic logging is written via `bootstrapLog` and a deferred startup notification toast is scheduled.
2. **Hook Execution**:
   - **`config`**: Ingests top-level OpenCode MCP configuration and triggers pre-warming if not previously initialized.
   - **`tool`**: Exposes the search meta-tools (`tool_search`, `tool_search_regex`) provided by `runtime.searchTools`.
   - **`tool.definition`**: Intercepts tool definitions to strip schemas and append deferral markers using `runtime.deferTool`.
   - **`tool.execute.before`**: Intercepts tool invocation to verify authorization in `runtime.assertAuthorized`.
   - **`tool.execute.after`**: Notifies runtime of tool execution (`runtime.handleToolExecuted`) and appends any pending reminder notices to output.
   - **`experimental.chat.messages.transform` & `experimental.chat.system.transform`**: Syncs active compression / compaction state (e.g. Sleev IDs) and injects dynamic search policy instructions into the system prompt.
   - **`experimental.session.compacting`**: Injects compacted active tool state when a session undergoes context compaction.
   - **`event`**: Captures lifecycle events like `session.deleted` (purges session state) and routes remaining events to `updateCheck.handleEvent`.

## Integration Points
- **OpenCode Framework (`@opencode-ai/plugin`)**: Subscribes to `Hooks`, `Plugin`, and `PluginOptions`.
- **`src/core/bootstrap.ts`**: Shared plugin bootstrapper (`bootstrapPluginCore`), config validation, and fallback MCP resolution.
- **`src/engine/session-engine.js`**: `SessionRuntime` managing Tool Vault instances, authorization state, and delivery history.
- **`src/hooks/mcp-wiring.js`**: `McpWiring` and `parseMcpConfig` managing MCP server lifecycles and tool registration.
- **`src/hooks/update-check.js`**: `UpdateCheckLifecycle` tracking npm registry updates.
- **`src/hooks/toast.js`**: User-facing notification dispatch.
- **`src/types.ts`**: Shared type definitions (`ToolMeta`, `ScoreParams`, `Hit<T>`, `ToolSearchConfig`, `EmbedConfig`).
