# OpenStellar Tool Search

<p align="center">
  <a href="https://www.npmjs.com/package/@openstellar/tool-search"><img src="https://img.shields.io/npm/v/@openstellar/tool-search.svg?style=flat-square&color=blue" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@openstellar/tool-search"><img src="https://img.shields.io/npm/dm/@openstellar/tool-search.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="INSTALL_PROMPT.md"><img src="https://img.shields.io/badge/🤖_Install_with-AI_Prompt-blueviolet.svg?style=flat-square" alt="Install with AI Prompt" /></a>
</p>

<p align="center">
  <strong>Cut MCP prompt context by ~35% on every turn. Eliminate tool hallucination. Keep 100% tool discoverability.</strong>
</p>

---

## Table of Contents

- [The 100-Tool Dilemma in Agentic Coding](#the-100-tool-dilemma-in-agentic-coding)
- [The Solution: Deferred Tool Virtualization](#the-solution-deferred-tool-virtualization)
- [How It Works in Practice](#how-it-works-in-practice)
- [Installation](#installation)
  - [🤖 1-Click AI Setup (Recommended)](#-1-click-ai-setup-recommended)
  - [Manual Setup](#manual-setup)
- [How Dual Search Works](#how-dual-search-works)
  - [1. Search by Intent (`tool_search`)](#1-search-by-intent-tool_search)
  - [2. Search by Name / Pattern (`tool_search_regex`)](#2-search-by-name--pattern-tool_search_regex)
  - [3. Deferred Authorization Lifecycle](#3-deferred-authorization-lifecycle)
- [Empirical Context Reduction & Customer ROI](#empirical-context-reduction--customer-roi)
  - [Per-Turn Context Savings across 105 Real Tools](#per-turn-context-savings-across-105-real-tools)
  - [Multi-Turn Compounding Scale](#multi-turn-compounding-scale)
  - [Engine Performance & Latency Profile](#engine-performance--latency-profile)
- [Configuration Reference (v1.0.0)](#configuration-reference-v100)
  - [MCP Server Configuration (`mcp.servers`)](#mcp-server-configuration-mcpservers)
- [Architecture & MCP Prewarming](#architecture--mcp-prewarming)
- [Troubleshooting](#troubleshooting)
- [Development & Verification](#development--verification)

---

## The 100-Tool Dilemma in Agentic Coding

Modern agentic engineering workflows connect multiple Model Context Protocol (MCP) servers: codebase knowledge graphs, git providers, issue trackers, database inspectors, browser automation, and terminal tools.

In a standard environment with ~100 MCP tools:
1. **60,000+ tokens of static tool descriptions and parameter schemas are injected into every single prompt turn**.
2. **Context Window Saturation**: Over 50% of the active context window is consumed before the agent reads a single line of your codebase.
3. **Model Degradation & Hallucination**: Heavy system prompts cause attention drift, leading the model to call outdated tools, guess parameter shapes, or ignore instructions.
4. **Session Startup Deadlocks**: OpenCode freezes session tool snapshots at boot (~0–2s). Slow-starting MCP servers get dropped or orphaned permanently.

---

## The Solution: Deferred Tool Virtualization

**OpenStellar Tool Search** virtualizes tool delivery inside OpenCode:

- **Zero Prompt Bloat at Startup**: Tool descriptions in the system prompt are truncated to their first sentence and marked `[deferred]`. Full parameter schemas are preserved for protocol compliance while slashing prompt weight by ~35%.
- **Local Hybrid Search Engine**: Tools are indexed locally using BM25 Okapi and local ONNX vector embeddings (`@xenova/transformers`) running in a background Node.js worker thread.
- **On-Demand Tool Delivery**: When an agent needs a tool, it calls `tool_search` (by natural language task) or `tool_search_regex` (by exact name or wildcard). Full tool descriptions and parameters are delivered dynamically.
- **OpenCode v2 Parallel MCP Prewarming**: Enabled MCP servers start concurrently before returning hooks, guaranteeing all tools are safely captured in OpenCode's initial startup snapshot without unbounded hangs (fail-open timeouts).

---

## How It Works in Practice

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│  AI AGENT RUNTIME: 105 tools loaded ([deferred])                                                │
│                                                                                                  │
│  Agent Intent: "Search the codebase knowledge graph for auth handlers"                          │
│                                                                                                  │
│  1. Semantic Discovery:                                                                          │
│     tool_search({ query: "find functions in code graph" })                                       │
│     └── Hits: [ codebase_memory_mcp_search_graph (score: 0.94), codebase_memory_mcp_trace_path ] │
│                                                                                                  │
│  2. Exact ID / Regex Discovery:                                                                  │
│     tool_search_regex({ pattern: "^codebase_memory_mcp_" })                                     │
│     └── Unlocks: codebase_memory_mcp_search_graph, codebase_memory_mcp_trace_path, etc.          │
│                                                                                                  │
│  3. Execution:                                                                                   │
│     codebase_memory_mcp_search_graph({ query: "auth handlers", project: "app" })                │
│     └── Output: [ src/auth/jwt.ts:handleAuth, src/auth/session.ts:verifySession ]                │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Installation

### 🤖 1-Click AI Setup (Recommended)

You can have your AI assistant in OpenCode install and configure this plugin automatically, including migrating existing MCP servers into deferred loading.

👉 **[View or Copy the 1-Click AI Setup Prompt](INSTALL_PROMPT.md)**

<details>
<summary><b>Click to expand the 1-Click Setup Prompt directly</b></summary>

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
</details>

---

### Manual Setup

1. Install the package globally:
```bash
npm install -g @openstellar/tool-search
```

2. Add `@openstellar/tool-search` to your `opencode.jsonc` (or `.opencode/opencode.json`):
```jsonc
{
  "plugin": [
    [
      "@openstellar/tool-search@latest",
      {
        "maxResults": 5,
        "mode": "hybrid"
      }
    ]
  ]
}
```

3. Restart OpenCode. Your tools will automatically appear with `[deferred]` tags in the system prompt.

---

## How Dual Search Works

### 1. Search by Intent (`tool_search`)
When the model knows what task it wants to achieve but doesn't know the exact tool identifier:
```jsonc
tool_search({ query: "create a pull request on GitHub" })
```
- Performs **Reciprocal Rank Fusion (RRF)** combining BM25 keyword matching and vector cosine similarity.
- Delivers the full description, canonical ID, and parameter documentation.

### 2. Search by Name / Pattern (`tool_search_regex`)
When the model or agent needs a specific known tool, namespace, or regex pattern:
```jsonc
// Exact lookup
tool_search_regex({ pattern: "^github_create_issue$" })

// Pattern / namespace sweep
tool_search_regex({ pattern: "^(read|write|edit|glob|grep|bash)$" })
```

### 3. Deferred Authorization Lifecycle
- **Search-Gated Invocation**: Calling an unsearched `[deferred]` tool returns a helpful `[Tool Search Required]` message pointing to the canonical search.
- **Session Persistence**: Authorizations are cached per session (persisted atomically in `~/.cache/openstellar/tool-search/auth-state.json` with a 30-day TTL).
- **Compaction Sync**: When Sleev or OpenCode compacts context history, tool authorizations are cleanly reset so stale tool assumptions do not pollute subsequent reasoning turns.

---

## Empirical Context Reduction & Customer ROI

### Per-Turn Context Savings across 105 Real Tools

Empirically measured on standard OpenAI / Anthropic `cl100k_base` and `gpt-4o` tokenizers across 105 real MCP and built-in tools:

| Tool Suite | Total Tools | Standard Prompt Tokens | With Tool Search | Tokens Saved / Turn | Context Reduction |
|---|---|---|---|---|---|
| **MCP `codebase-memory`** | 8 | 3,179 | 2,362 | 817 | **25.7%** |
| **MCP `pieces` Suite** | 69 | 53,723 | 35,366 | 18,357 | **34.2%** |
| **Built-in Core & Context-Mode** | 28 | 7,773 | 4,689 | 3,084 | **39.7%** |
| **Total Combined Suite** | **105** | **64,675** | **42,417** | **22,258** | **~34.4%** |

### Multi-Turn Compounding Scale

Because system prompt tool definitions are transmitted on **every single conversational turn**, savings compound rapidly throughout a development session:

| Session Length | Without Tool Search | With Tool Search | Tokens Saved | Estimated Cost Saved (Claude 3.5 Sonnet / GPT-4o) |
|---|---|---|---|---|
| **1 turn** | 64,675 tokens | 42,417 tokens | **22,258 tokens** | ~$0.07 |
| **10 turns** | 646,750 tokens | 424,170 tokens | **222,580 tokens** | ~$0.67 |
| **20 turns** | 1,293,500 tokens | 848,340 tokens | **445,160 tokens** | ~$1.34 |
| **50 turns** | 3,233,750 tokens | 2,120,850 tokens | **1,112,900 tokens** | **~$3.34 – $16.70+** |

### Engine Performance & Latency Profile
- **BM25 Search Latency**: `< 15ms`
- **Hybrid Vector Matching**: `< 120ms` (executed asynchronously in background Node.js `worker_threads`)
- **Memory Footprint**: Quantized INT8 vector embeddings (`< 35MB RAM`)
- **Zero Startup Lag**: Search indexes are instantiated lazily on the first search request.

---

## Configuration Reference (v1.0.0)

| Option | Type | Default | Description |
|---|---|---|---|
| `alwaysLoad` | `string[]` | `[]` | Array of tool IDs exempt from deferral (full descriptions always loaded in prompt). |
| `maxResults` | `number` | `5` | Maximum number of ranked tool matches returned per query. |
| `mode` | `'hybrid' \| 'keyword'` | `'hybrid'` | Search mode: `'hybrid'` (BM25 + ONNX vectors) or `'keyword'` (BM25 only). |
| `resetTools` | `string[]` | `['compress']` | Tool names that trigger authorization reset upon execution (e.g. context compression). |
| `timeout` | `number` | `60000` | Global MCP server prewarm timeout in ms. Servers exceeding timeout fail-open cleanly. |
| `mcp.servers` | `Record<string, McpServerConfig>` | `{}` | MCP server definitions adhering to the OpenCode v2 `mcp.servers` schema. |

### MCP Server Configuration (`mcp.servers`)

> **Note on Upgrading from v0.2.x**: v1.0.0 enforces the OpenCode v2 `mcp.servers` dictionary wrapper. Legacy bare maps (`mcp: { "<server>": {...} }`) are rejected.

```jsonc
{
  "plugin": [
    [
      "@openstellar/tool-search@latest",
      {
        "maxResults": 5,
        "timeout": 30000,
        "mcp": {
          "servers": {
            "codebase-memory": {
              "type": "local",
              "command": ["npx", "-y", "codebase-memory-mcp@latest"]
            },
            "remote-docs": {
              "type": "remote",
              "url": "https://mcp.example.com/sse",
              "timeout": 15000
            }
          }
        }
      }
    ]
  ]
}
```

---

## Architecture & MCP Prewarming

```text
OpenCode Startup
       │
       ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ McpWiring: Parallel Warmup & Connection                     │
 │ ├── server 1 (local stdio)  ──► Settled                     │
 │ ├── server 2 (remote sse)   ──► Settled                     │
 │ └── server 3 (slow/failed)  ──► Status-Only Placeholder     │
 └─────────────────────────────┬───────────────────────────────┘
                               │ (All servers settled or deadlined)
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Plugin Hook Export: tool.definition                         │
 │ ├── Truncates descriptions to first sentence + [deferred]   │
 │ ├── Inlines JSON parameter schemas                          │
 │ └── Caches full metadata in ToolVault                       │
 └─────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Agent Runtime Execution                                     │
 │ ├── tool_search / tool_search_regex ──► Authorizes Tool     │
 │ └── tool.execute.* ───────────────────► Invokes MCP Bridge  │
 └─────────────────────────────────────────────────────────────┘
```

1. **Prewarm Before Return**: The plugin awaits enabled MCP servers before returning hooks, guaranteeing tools exist in OpenCode's initial immutable session snapshot.
2. **Fail-Open Isolation**: If an MCP server crashes or exceeds its timeout, it is marked with a status placeholder tool, allowing all other servers and tools to operate normally without hanging OpenCode.
3. **Atomic Authorization Cache**: Authorizations survive CLI restarts via atomic JSON cache with automatic 30-day TTL expiration.

---

## Troubleshooting

| Symptom | Root Cause | Solution |
|---|---|---|
| **Slow startup when opening OpenCode** | An enabled MCP server is slow to start. | The plugin awaits servers up to `timeout` (default 60s). Lower `timeout` or set a per-server `timeout` in `mcp.servers.<name>.timeout`. |
| **`[Tool Search Required]` error** | The LLM attempted to call a `[deferred]` tool without searching first. | Call `tool_search({ query: "..." })` or `tool_search_regex({ pattern: "^name$" })` first. |
| **MCP server status placeholder shown** | Server failed or timed out during prewarm. | Check server command/URL and stderr logs. Once fixed, restart OpenCode. |
| **Legacy config warning** | Using old `mcp: { "<server>": {...} }` format. | Wrap server definitions in `mcp: { servers: { ... } }`. |

---

## Development & Verification

```bash
# Install dependencies
npm install

# Run Vitest test suite (91 tests across 4 suites)
npm test

# Typecheck
npm run typecheck

# Build bundle and roll types
npm run build

# Run isolated npm pack and load smoke test
npm run smoke:plugin
```
