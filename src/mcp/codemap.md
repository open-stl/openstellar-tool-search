# src/mcp/

## Responsibility
The `src/mcp/` module serves as the Model Context Protocol (MCP) subsystem and bridge for `openstellar-tool-search`. It acts as an MCP Client manager, dynamic `ToolProvider`, schema conversion layer (translating MCP JSON Schemas into OpenCode Zod tool schemas), and connection lifecycle/caching coordinator. It enables the plugin to discover, lazily load, namespace, and execute tools provided by external local (stdio) and remote (HTTP/SSE) MCP servers.

## Design Patterns
- **Provider Pattern**: `McpToolProvider` implements the catalog's `ToolProvider` interface (`src/catalog/tool-provider.ts`), supplying tool definitions, lazy discovery hooks (`warmUp`, `awaitReady`), and change notifications (`onUpdate`).
- **Adapter Pattern**: `adaptMcpTool`, `convertMcpTool`, and `jsonSchemaToZod` adapt MCP JSON-RPC protocol messages and JSON Schema specifications into OpenCode plugin `tool(...)` definitions and search catalog `ToolDefinition` metadata.
- **Factory Pattern**: `TransportFactory` maintains an extensible registry mapping configuration type identifiers (`local`, `remote`) to concrete `TransportConnector` implementations.
- **Strategy Pattern**: `TransportConnector<T>` abstracts transport establishment strategies across differing execution environments (`LocalTransportConnector` for child processes vs `RemoteTransportConnector` for HTTP streams).
- **Multiton / Connection Pool with Promise Coalescing**: `AdapterCache` (and `globalAdapterCache`) provides cached MCP client/transport instances keyed by deterministic server configuration hashes (`serializeServerConfig`). It deduplicates concurrent connection attempts (`inFlight` map), performs active liveness health checks (`getReady` via `client.listTools()`), and handles graceful teardown.
- **Interceptor / Decorator Pattern**: `attachMcpTransportInterceptor` wraps `transport.onmessage` to dynamically rewrite and inline `$defs` / `$ref` references directly on incoming `tools/list` responses before MCP SDK client handlers parse them.
- **Fail-Open & Circuit Breaker with Deadline**: `withTimeout` in `McpToolProvider.warmUp` bounds individual server discovery handshakes, cutting unresponsive servers cleanly so overall plugin initialization remains resilient and non-blocking.

## Data & Control Flow
1. **Registration & Configuration**:
   - Server configurations (`LocalMcpServerConfig`, `RemoteMcpServerConfig`) are supplied to `McpToolProvider`.
   - `isServerEnabled` filters out disabled server configurations (`disabled: true` or `enabled: false`).
   - `TransportFactory` is populated with `LocalTransportConnector` and `RemoteTransportConnector`.
2. **Discovery & Warm-Up (`McpToolProvider.warmUp`)**:
   - `McpToolProvider.warmUp()` spawns concurrent discovery tasks for each server, racing against deadlines via `withTimeout`.
   - `getConnection()` queries `AdapterCache`. If a live entry exists and passes `isAlive`, it is reused; otherwise `createMcpConnection` constructs an MCP `Client` and invokes `TransportFactory.connect()`.
   - The selected connector creates a transport (`StdioClientTransport` or `StreamableHTTPClientTransport`) and decorates it with `attachMcpTransportInterceptor`.
   - `client.listTools()` sends a JSON-RPC `tools/list` request.
   - `attachMcpTransportInterceptor` intercepts incoming messages and runs `inlineLocalReferences` on all tool parameter schemas.
   - Each retrieved tool is converted using `adaptMcpTool`:
     - Namespaces the tool name using `sanitizeToolId` (`${serverName}_${toolName}`).
     - Inlines local references and converts JSON Schema to Zod schema via `jsonSchemaToZod`.
     - Creates an executable OpenCode tool wrapper via `convertMcpTool`.
   - Discovered `ToolDefinition` entries are appended to the provider catalog, executable wrappers are stored in `executableTools`, and update listeners are notified.
3. **Tool Execution (`convertMcpTool`)**:
   - When an MCP tool is invoked, the wrapper resolves the client instance (via cached reference or dynamic getter).
   - Calls `client.callTool({ name, arguments }, CallToolResultSchema, { timeout, resetTimeoutOnProgress })`.
   - Extracts result payloads using `extractText` across multi-modal types (`text`, `image`, `audio`, `resource`, `resource_link`) or JSON-serialized `structuredContent`.
   - Handles progress resets and formats user-friendly timeout/error messages.
4. **Disposal & Teardown**:
   - `McpToolProvider.close()` clears all pending warm-up timeout handles (`activeTimers`) and calls `AdapterCache.clear()`.
   - Each cached `Transport` is cleanly shut down via `closeTransport`.

## Integration Points
- **External Dependencies**:
  - `@modelcontextprotocol/sdk`: Provides core MCP `Client`, protocol schemas (`CallToolResultSchema`), and transport bindings.
  - `@opencode-ai/plugin`: Provides tool declaration helpers (`tool`, `tool.schema`).
- **Internal Dependencies**:
  - `src/catalog/tool-provider.ts`: Implements `ToolProvider` interface and outputs `ToolDefinition` objects.
  - `src/catalog/schema-normalize.ts`: Uses `inlineLocalReferences` to resolve JSON Schema `$defs` and circular references.
  - `src/mcp/transports/*`: Consumes `LocalTransportConnector`, `RemoteTransportConnector`, and `closeTransport`.
- **Consumers**:
  - `src/hooks/mcp-wiring.ts`: Instantiates `McpToolProvider`, feeds the tool search vault, and registers deferred tool placeholders.
  - `src/plugin.ts`: Top-level plugin entry point orchestrating MCP tool discovery and hook attachment.
