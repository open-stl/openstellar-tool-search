# 🤖 OpenStellar Tool Search — AI Setup Prompt

Copy and paste the prompt below into your AI assistant in OpenCode to automatically install and configure `@openstellar/tool-search` and migrate your MCP servers into deferred loading:

---

```text
Please install and configure the @openstellar/tool-search plugin for OpenCode:

1. Run the global installation command:
   npm install -g @openstellar/tool-search

2. Locate or create my OpenCode configuration file:
   - Check for `opencode.jsonc` or `.opencode/opencode.json` in the workspace root, or fallback to the global OpenCode config in `~/.config/opencode/opencode.jsonc` (or `~/.config/opencode/opencode.json`).

3. Configure the plugin and migrate existing MCP servers:
   - Check if there is an existing top-level "mcp" or "mcp.servers" configuration in the file.
   - If existing MCP servers exist, MOVE those server definitions inside the plugin config under `mcp.servers: { ... }` so that Tool Search can manage, prewarm, and defer them, and remove the top-level "mcp" key to prevent duplicate initialization.
   - Add or merge the plugin entry into the "plugin" array:
     [
       "@openstellar/tool-search@latest",
       {
         "maxResults": 5,
         "mode": "hybrid",
         "mcp": {
           "servers": {
             // <moved existing MCP servers here>
           }
         }
       }
     ]
   - If the "plugin" array already exists, merge this entry cleanly. If not, create it.
   - Preserve all existing comments, formatting, and other non-MCP settings.

4. Validate the JSON/JSONC syntax and confirm when finished so I can restart OpenCode.
```

---

### Manual Verification
After running the prompt and restarting OpenCode:
1. All static and MCP tools will display the `[deferred]` tag in system prompts, saving ~35% context tokens per turn.
2. When the model needs a tool, it will dynamically discover and authorize it via `tool_search` or `tool_search_regex`.
