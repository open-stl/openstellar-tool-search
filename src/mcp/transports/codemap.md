# src/mcp/transports/

## Responsibility
The `src/mcp/transports/` module provides the low-level Transport Layer implementations for Model Context Protocol (MCP) communication within `openstellar-tool-search`. Its responsibility includes spawning and managing local child processes over standard I/O (`stdio`), establishing remote streamable HTTP connections, capturing and buffering process diagnostics (`stderr`), binding protocol-level message interceptors, and ensuring error-safe transport teardown.

## Design Patterns
- **Strategy Pattern (Concrete Strategies)**: `LocalTransportConnector` and `RemoteTransportConnector` implement the `TransportConnector<T>` interface (`src/mcp/transport-factory.ts`), encapsulating connection algorithms for `LocalMcpServerConfig` and `RemoteMcpServerConfig`.
- **Resource Management / Safe Teardown**: `closeTransport` implements a null-safe, exception-suppressed cleanup function to reliably close transports during error unwinding or system shutdown without throwing unhandled rejections.
- **Stream Buffering / Observer**: `LocalTransportConnector.captureStderr` attaches an event listener to the child process's `stderr` stream, accumulating up to 8 KB (`STDERR_CAPTURE_LIMIT_BYTES`) of diagnostics in memory to surface actionable error messages if process launch or handshake fails.
- **Interceptor Hookup**: Both transport connectors invoke `attachMcpTransportInterceptor` on newly instantiated transports before triggering `client.connect()`, ensuring JSON-RPC message preprocessing is established prior to protocol handshake.

## Data & Control Flow
1. **Local Stdio Transport (`LocalTransportConnector.connect`)**:
   - Accepts `LocalMcpServerConfig` (command executable and arguments, environment variables, `stderr` mode, handshake timeout) and an MCP `Client`.
   - Validates that the command array is non-empty.
   - Merges system `process.env` with custom server `env` overrides.
   - Instantiates `StdioClientTransport` configured for standard I/O streaming.
   - Attaches `captureStderr` to the transport's standard error stream.
   - Attaches the transport interceptor via `attachMcpTransportInterceptor(transport)`.
   - Executes `client.connect(transport, { timeout })` with default timeout fallback (e.g. 180s for `npx` commands).
   - If the handshake fails, captures the buffered `stderr` trace, triggers `closeTransport(transport)`, and throws a detailed error containing connection diagnostics.
2. **Remote HTTP Transport (`RemoteTransportConnector.connect`)**:
   - Accepts `RemoteMcpServerConfig` (endpoint URL, HTTP headers, timeout) and an MCP `Client`.
   - Constructs `RequestInit` with custom authentication or transport headers if provided.
   - Instantiates `StreamableHTTPClientTransport` targeting the remote URL.
   - Attaches the transport interceptor via `attachMcpTransportInterceptor(transport)`.
   - Executes `client.connect(transport, { timeout })`.
   - If the connection fails, executes `closeTransport(transport)` and rethrows the underlying error.
3. **Transport Disposal (`closeTransport`)**:
   - Accepts a `Transport` instance (or null/undefined).
   - Invokes `transport.close()`, awaiting asynchronous completion if a Promise is returned.
   - Safely catches and suppresses any errors emitted during transport shutdown.

## Integration Points
- **External Dependencies**:
  - `@modelcontextprotocol/sdk/client/index.js`: MCP `Client` type and lifecycle methods.
  - `@modelcontextprotocol/sdk/client/stdio.js`: `StdioClientTransport` implementation.
  - `@modelcontextprotocol/sdk/client/streamableHttp.js`: `StreamableHTTPClientTransport` implementation.
  - `node:stream`: Node.js `Stream` interface for `stderr` stream observation.
- **Internal Dependencies**:
  - `src/mcp/types.ts`: Type definitions for `LocalMcpServerConfig` and `RemoteMcpServerConfig`.
  - `src/mcp/transport-factory.ts`: `Transport` and `TransportConnector` interface contracts.
  - `src/mcp/server-connection.ts`: `attachMcpTransportInterceptor` function for schema resolution.
- **Consumers**:
  - `src/mcp/mcp-tool-provider.ts`: Registers `LocalTransportConnector` and `RemoteTransportConnector` into the `TransportFactory`.
  - `src/mcp/mcp-tool-adapter.ts`: Uses `closeTransport` for cache clearing and evicted connection teardown.
