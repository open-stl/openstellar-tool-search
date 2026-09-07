# src/core/

## Responsibility
The `src/core/` directory provides shared initialization, configuration normalization, and bootstrapping logic across both OpenCode v1 and v2 plugin adapters.

## Exports
- `ALLOWED_CONFIG_KEYS`: Set of permitted top-level configuration options.
- `validateConfig`: Validates user configuration keys.
- `buildEmbedding`: Configures semantic embedding options.
- `parseJsonc`: Parses JSON files with comments and trailing commas.
- `loadFallbackMcpConfig`: Resolves fallback MCP configuration across candidate configuration paths.
- `bootstrapPluginCore`: Core plugin bootstrapper providing `runtime`, `mcp`, `updateCheck`, and `opts`.
- `bootstrapLog`: Diagnostic logger for bootstrap and adapter lifecycle events.
