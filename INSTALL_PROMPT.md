# 🤖 OpenStellar Tool Search — AI Setup Prompt

Copy and paste the prompt below into your AI coding assistant (**OpenCode**, **Claude Code**, **Cursor**, **Windsurf**, or **Roo Code**) to automatically install and configure `@openstellar/tool-search`:

---

```text
Please install and configure the @openstellar/tool-search plugin for OpenCode:

1. Run the global installation command:
   npm install -g @openstellar/tool-search

2. Locate or create my OpenCode configuration file:
   - Check for `opencode.jsonc` or `.opencode/opencode.json` in the workspace root, or fallback to the global OpenCode config in `~/.config/opencode/opencode.jsonc` (or `~/.config/opencode/opencode.json`).

3. Add the plugin entry to the "plugin" array:
   ["@openstellar/tool-search@latest", { "maxResults": 5 }]
   - If the "plugin" array already exists, append or merge this entry without removing existing plugins.
   - If the "plugin" array does not exist, create it.
   - Preserve all existing comments, formatting, and other settings (like "mcp", "models", etc.).

4. Validate the JSON/JSONC syntax and confirm when finished so I can restart OpenCode.
```

---

### Manual Verification
After running the prompt and restarting OpenCode, your tools will display the `[deferred]` tag in system prompts. When the model needs to inspect or use a tool, it will dynamically discover and authorize it via `tool_search` or `tool_search_regex`.
