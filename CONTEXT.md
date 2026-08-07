# Tool Search Context

## Glossary

### SessionToolRegistry
The unified domain module that owns per-session tool delivery filtering, fingerprint tracking, tool authorization precedence, and compaction resets behind a single seam.

### Delivered Tool
A canonical tool definition returned to the AI by `tool_search` or `tool_search_regex`, including its current description and parameter schema.

### Delivery History
Per-session state that records the current definition fingerprint of every Delivered Tool. It exists solely to suppress repeated tool definitions and reduce context usage.

### Discovery Result
A tool returned by one search invocation. Discovery Results may be new or previously delivered.

### New Discovery Result
A Discovery Result whose canonical ID has not appeared in Delivery History with the same current definition fingerprint.

### Authorization
Per-session permission to execute a deferred tool. Authorization is granted by a search result and may be reset independently of Delivery History.

### Authorization Reset
A configured reset-tool execution that clears Authorization. It does not necessarily clear Delivery History.

### Compaction Reset
A `compress` execution or host session compaction. It clears both Authorization and Delivery History.

### ToolProvider
A source seam that yields tool definitions to `ToolStore`. Providers can be static (local OpenCode tools) or dynamic (external MCP servers).

### MCP Server Connection
A managed stdio or Streamable HTTP/SSE transport link to an external Model Context Protocol server, configured with health checks and keep-alive reconnect logic.

### MCP Tool Adapter
The component that translates raw MCP tool definitions and JSON Schemas into OpenCode tool interfaces, assigning `deferred` status according to server deferral policy.

### No-Op Discovery
A concise successful search response used when a query produces results but none are New Discovery Results. It contains no repeated tool definitions.

## Rules

- Searches consider results across both `tool_search` and `tool_search_regex`.
- A search filters previously delivered results before applying the configured result limit, so an undiscovered result beyond an earlier result page remains discoverable.
- A search returns only New Discovery Results, limited by the configured result limit.
- Only definitions actually returned are added to Delivery History.
- A result becomes new again when the tool's description or parameter schema changes.
- If a search produces only previously delivered and still-authorized results, it returns a No-Op Discovery response that names the omitted canonical tools.
- A search that produces no matches is not recorded as a failed or blocked query.
- When a search finds both previously delivered and new results, it returns only the new results.
- A tool registered after a prior search remains discoverable from the same query if it is a New Discovery Result.
- Authorization Reset clears Authorization. A subsequent search returns an otherwise previously delivered definition when it is needed to reauthorize that tool.
- Authorization takes precedence over Delivery History: if a matching delivered tool is not authorized when searched, its definition is returned again to restore authorization.
- Compaction Reset clears Delivery History and Authorization, so the same tool definition may be delivered again afterward.
- Delivery History persists across plugin restarts for the same session.
