# src/hooks/

## Responsibility
The `src/hooks/` directory houses the lifecycle interceptors, bridge adapters, and auxiliary background subsystems for the OpenCode plugin integration. Its core responsibilities encompass:
- **Tool Description Deferral (`deferral.ts`)**: Sentence boundary extraction and truncation logic that reduces tool descriptions to their initial summary sentence and appends deferral markers (`[deferred]`), optimizing prompt token consumption while signaling tool availability.
- **Model Context Protocol (MCP) Wiring (`mcp-wiring.ts`)**: Lifecycle orchestration and bridge management for MCP server instances. Manages pre-warming concurrency, fail-open timeout deadlines, dynamic tool injection into `ToolVault` / `SessionToolRegistry`, process exit cleanups, and status placeholder tools for early snapshot visibility.
- **Update Check & Package Cache Invalidation Pipeline (`auto-update-checker.ts`, `update-check.ts`, `npm-registry.ts`)**:
  - Automated detection of newer package releases published to scoped or global npm registries.
  - Scoped dist-tags endpoint resolution and network fetch with timeout guards.
  - Invalidation and recursive purge of cached OpenCode package artifacts across platform-specific directories upon staging new versions.
  - Deduplicated, non-blocking background execution latch triggered by session lifecycle events.
- **TUI Toast Notification Dispatcher (`toast.ts`)**: Safe, non-blocking delivery of asynchronous status and diagnostic toast notifications to the OpenCode terminal user interface (TUI).

## Design Patterns
- **Hook / Interceptor Pattern**: Intercepts OpenCode plugin lifecycle points (`event`, `config`, `tool.definition`, `tool.execute.*`) and translates host-level dispatches into domain operations.
- **Adapter / Bridge Pattern**:
  - `McpWiring`: Bridges external MCP tool schemas from `McpToolProvider` into OpenCode-compatible `tool()` executable handlers and synchronizes metadata into the local `ToolVault`.
  - `toast.ts`: Adapts OpenCode client RPC calls (`ctx.client.tui.showToast`) into a resilient, fire-and-forget notification helper.
- **Dependency & Effect Injection**:
  - `auto-update-checker.ts` (`LatestVersionEffects`, `CacheInvalidationEffects`, `UpdateCheckEffects`) and `npm-registry.ts` (`ResolveEffects`): Decouple filesystem I/O, process execution (`execFile`), and HTTP networking into injectable effect records, enabling fully deterministic unit testing without external side effects.
- **State Machine & Promise Latch**:
  - `UpdateCheckLifecycle`: Employs an in-flight promise latch (`checkInFlight`) to deduplicate concurrent `session.created` triggers and a state latch (`staged`) to halt checks permanently once an update has been staged.
  - `McpWiring`: Manages memoized pre-warming (`preWarmPromise`) and transitions placeholder status tools from initialization to settled readiness or failure states.
- **Placeholder / Diagnostic Status Reader**:
  - `McpWiring.registerPlaceholders`: Injects lightweight status tools during early startup so the model's frozen tool snapshot retains awareness of warming MCP servers without blocking the plugin factory.

## Data & Control Flow

### 1. Tool Deferral & Sentence Extraction Flow (`deferral.ts`)
```
OpenCode 'tool.definition' hook
  │
  ▼
SessionRuntime.deferTool(...)
  │
  ▼
truncateDescription(desc, deferLabel)
  ├─► getFirstSentence(desc) [Parses regex boundary `\.(?:\s|$)`, ignoring abbreviations (e.g. "vs.", "e.g.", "i.e.")]
  └─► Returns: `${firstSentence} [deferred]`
```

### 2. MCP Initialization & Pre-Warming Flow (`mcp-wiring.ts`)
```
Plugin Startup / config hook
  │
  ▼
parseMcpConfig(raw) [Validates OpenCode v2 shape: { servers: { <name>: McpServerConfig } }]
  │
  ▼
McpWiring.init(mcpConfig)
  ├─► Instantiates McpToolProvider(mcpConfig, ..., timeout)
  ├─► Registers provider with ToolVault
  ├─► registerPlaceholders(): Adds always-on status tools to SessionToolRegistry & tools bridge
  ├─► Subscribes to provider.onUpdate(...) for progressive per-server tool registration
  └─► Registers process exit cleanup handler (beforeExit, exit)
  │
  ▼
McpWiring.preWarm()
  ├─► Awaits provider.warmUp() with per-server timeout ceiling
  ├─► writeProviderTools(): Synchronizes full settled tool definitions into SessionToolRegistry
  └─► finalizePlaceholders(): Removes placeholders for active servers; rewrites failed ones to honest diagnostic text
```

### 3. Update Verification & Cache Invalidation Flow (`update-check.ts`, `auto-update-checker.ts`, `npm-registry.ts`)
```
OpenCode 'event' hook (event.type === 'session.created')
  │
  ▼
UpdateCheckLifecycle.handleEvent(eventType)
  ├─► Guards: checks if already staged or checkInFlight
  └─► runCheck() (Background / Unawaited)
        │
        ▼
      checkForUpdate()
        ├─► getCurrentVersion(): Reads package.json candidates
        ├─► resolveRegistryUrl(): Queries `npm config get @openstellar:registry` -> `npm config get registry` -> fallback
        ├─► buildDistTagsUrl(): Constructs percent-encoded dist-tags endpoint
        ├─► getLatestVersion(): Fetches latest tag with 5000ms AbortController timeout
        ├─► isNewerVersion(): Evaluates semver.gt(latest, current)
        └─► invalidatePackageCache(): Deletes cached package roots in ~/.cache, ~/.config, and %APPDATA%
        │
        ▼
      formatUpdateMessage(result): Builds notification payload
        │
        ▼
      toast(ctx, title, message, variant, duration): Schedules delayed notification (100ms, timer.unref())
        │
        ▼
      UpdateCheckLifecycle.staged = true (Latches update state)
```

## Integration Points
- **OpenCode Plugin Framework (`@opencode-ai/plugin`)**:
  - Consumes `PluginInput` for context and TUI client access (`ctx.client.tui.showToast`).
  - Consumes `tool` factory for generating executable placeholder and bridge tool instances.
- **Engine & Catalog Subsystems**:
  - `src/catalog/vault.ts`: Registers tool providers, adds/removes placeholder entries, and resolves aliases.
  - `src/engine/session-tool-registry.ts`: Tracks always-on tools, registers provider tools, and monitors deferred counts.
  - `src/mcp/mcp-tool-provider.ts` & `src/mcp/types.ts`: Manages underlying MCP client connections, tool discovery, and configuration schemas.
- **Node.js Subsystems**:
  - `node:child_process`: Executes `npm config` probes within `npm-registry.ts`.
  - `node:fs` & `node:path`: Reads local `package.json` manifests and purges package cache directories.
  - `node:os` & `node:process`: Identifies platform cache locations and binds graceful exit listeners.
- **External Dependencies**:
  - `semver`: Validates and compares semantic version identifiers.
