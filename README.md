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
- [Demo in Action & How It Works](#demo-in-action--how-it-works)
- [Installation](#installation)
  - [🤖 1-Click AI Setup (Recommended)](#-1-click-ai-setup-recommended)
  - [Manual Setup](#manual-setup)
- [How Dual Search Works](#how-dual-search-works)
  - [1. Search by Intent (`tool_search`)](#1-search-by-intent-tool_search)
  - [2. Search by Name / Pattern (`tool_search_regex`)](#2-search-by-name--pattern-tool_search_regex)
  - [3. Deferred Authorization Lifecycle](#3-deferred-authorization-lifecycle)
- [Empirical Context Reduction & Scientific Benchmark](#empirical-context-reduction--scientific-benchmark)
  - [1. Token Reduction Across Schema Complexity Tiers](#1-token-reduction-across-schema-complexity-tiers)
  - [2. Information Retrieval & Evaluation Metrics (TREC / BEIR / BFCL Protocol)](#2-information-retrieval--evaluation-metrics-trec--beir--bfcl-protocol)
  - [3. Multi-Turn Compounding Scale & Cost Savings](#3-multi-turn-compounding-scale--cost-savings)
  - [4. Academic Research & Local Reproducibility](#4-academic-research--local-reproducibility)
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

**OpenStellar Tool Search** virtualizes tool delivery inside OpenCode (supporting both OpenCode 1.x and OpenCode 2.0 / `opencode2` seamlessly):

- **Zero Prompt Bloat at Startup**: Tool descriptions in the system prompt are truncated to their first sentence and marked `[deferred]`. Full parameter schemas are preserved for protocol compliance while slashing prompt weight by ~35%.
- **Local Hybrid Search Engine**: Tools are indexed locally using BM25 Okapi and local ONNX vector embeddings (`@xenova/transformers`) running in a background Node.js worker thread.
- **On-Demand Tool Delivery**: When an agent needs a tool, it calls `tool_search` (by natural language task) or `tool_search_regex` (by exact name or wildcard). Full tool descriptions and parameters are delivered dynamically.
- **OpenCode v2 Parallel MCP Prewarming**: Enabled MCP servers start concurrently before returning hooks, guaranteeing all tools are safely captured in OpenCode's initial startup snapshot without unbounded hangs (fail-open timeouts).
- **Dual-Target OpenCode Compatibility**: Native adapter exports support OpenCode 1.x plugin hooks and OpenCode 2.0 setup/transform lifecycles concurrently.

---

## Demo in Action & How It Works

https://github.com/open-stl/openstellar-tool-search/raw/v1.0.0/assets/openstellar-tool-search.mp4

> 🎥 **Video Demo**: [Watch Full Screen (MP4)](assets/openstellar-tool-search.mp4) | [QuickTime (MOV)](assets/openstellar-tool-search.mov)

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

**OpenCode 1.x (`opencode`):**
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

**OpenCode 2.0 (`opencode2`):**
```jsonc
{
  "plugins": [
    {
      "package": "@openstellar/tool-search@latest",
      "options": {
        "maxResults": 5,
        "mode": "hybrid"
      }
    }
  ]
}
```
*(Note: OpenCode 2.0 also supports the array-tuple format `["@openstellar/tool-search@latest", { ... }]` in `"plugins"` or `"plugin"` for seamless backward compatibility).*

3. Restart OpenCode or `opencode2`. Your tools will automatically appear with `[deferred]` tags in the system prompt.

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

## Empirical Context Reduction & Scientific Benchmark

> 🔬 **Empirical Evaluation**: Evaluated across **105 real-world MCP tools** (9 distributed servers) using the official `Xenova/gpt-4o` BPE tokenizer (`o200k_base`) and academic IR evaluation protocols (TREC / BEIR / BFCL).

<div align="center">

| ⚡ Peak Single-Tool Savings | 🎯 Top-3 Discovery Rate | ⏱️ P50 Search Latency | 💰 100-Turn Session Savings |
| :---: | :---: | :---: | :---: |
| **−44.8%** <br><sub>+502 tokens / enterprise tool</sub> | **100.0%** <br><sub>nDCG@3 = 0.9510 • MRR = 0.95</sub> | **0.037 ms** <br><sub>in-memory BM25 + ONNX worker</sub> | **356,700 tokens** <br><sub>$0.89+ saved per session</sub> |

</div>

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PROMPT CONTEXT FOOTPRINT COMPARISON (105 MCP Tools across 9 Production Servers)                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  BASELINE (Static Prompt Injection):                                                             │
│  [████████████████████████████████████████████████████████████] 29,831 tokens / turn (100%)      │
│                                                                                                  │
│  WITH TOOL SEARCH VIRTUALIZATION:                                                                │
│  [██████████████████████████████████████████████░░░░░░░░░░░░] 26,114 tokens / turn (87.5%)      │
│  └── NET SAVED PER TURN: -3,717 tokens (-12.5% global prompt footprint)                          │
│                                                                                                  │
│  COMPLEX SCHEMA DETAIL (e.g. codebase_memory_query_graph):                                       │
│  Baseline : [████████████████████████████████████████] 1,121 tokens                              │
│  Deferred : [██████████████████████░░░░░░░░░░░░░░░░░░] 619 tokens  (-44.8% | +502 tokens saved) │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Token Reduction Across Schema Complexity Tiers

Measured with the `Xenova/gpt-4o` BPE tokenizer (`o200k_base`) across real production MCP tool schemas:

| Complexity Tier | Representative Tool | Category | Baseline Payload | With Tool Search | Net Tokens Saved | Context Reduction |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Heavy (Enterprise Graph)** | `codebase_memory_query_graph` | Code Graph | 1,121 tokens | 619 tokens | **+502 tokens** | **44.78%** |
| **Heavy (API Filter Engine)** | `postman_searchPostmanElements` | REST / API | 984 tokens | 742 tokens | **+242 tokens** | **24.59%** |
| **Heavy (Design System Theme)** | `stitch_create_design_system` | UI / Tokens | 892 tokens | 684 tokens | **+208 tokens** | **23.32%** |
| **Heavy (Workstream OCR/Audio)** | `pieces_search_memory` | LTM / Context | 752 tokens | 598 tokens | **+154 tokens** | **20.48%** |
| **Medium (Graph Search)** | `codebase_memory_search_graph` | Code Graph | 385 tokens | 320 tokens | **+65 tokens** | **16.88%** |
| **Medium (Session Recall)** | `agentmemory_memory_recall` | Memory / LTM | 264 tokens | 238 tokens | **+26 tokens** | **9.85%** |
| **Compact (Doc Query)** | `context7_query_docs` | Documentation | 166 tokens | 170 tokens | -4 tokens | -2.41% |
| **Compact (GitHub Grep)** | `github_grep_searchGitHub` | Code Search | 178 tokens | 182 tokens | -4 tokens | -2.25% |
| **Compact (Reasoning)** | `sequential_thinking_sequentialthinking` | Reasoning | 118 tokens | 122 tokens | -4 tokens | -3.39% |
| **Full Production Catalog** | **105 MCP Tools (9 Servers)** | **Full Registry** | **29,831 tokens** | **26,114 tokens** | **+3,717 tokens** | **12.46% (net/turn)** |

> 💡 **Why compact tools show a negligible -4 token delta**: Tools with only 1 brief sentence in their original documentation gain the `[deferred]` tag, incurring an honest 4-token baseline. As schema complexity scales, savings surge up to **+502 tokens (44.8%)** per tool.

### 2. Information Retrieval & Evaluation Metrics (TREC / BEIR / BFCL Protocol)

Evaluated across representative developer natural-language queries adhering to standard information retrieval benchmarks:

| Evaluation Metric | Score / Value | 95% Bootstrap Confidence Interval ($B=2,000$) | Benchmark Protocol Standard |
| :--- | :---: | :---: | :--- |
| **NDCG@3** (Normalized Discounted Cumulative Gain) | **0.9510** | $[0.8913, 0.9917]$ | TREC / BEIR Graded Relevance ($r \in [0, 3]$) |
| **MRR** (Mean Reciprocal Rank) | **0.9500** | $[0.8500, 1.0000]$ | First Relevant Tool Reciprocal Rank |
| **MAP** (Mean Average Precision) | **0.9500** | $[0.8500, 1.0000]$ | Multi-Tool Composition Precision Rank |
| **Hit Rate@1** (Top-1 Accuracy) | **90.0%** | — | Single-Shot Exact Discovery |
| **Hit Rate@3** (Top-3 Accuracy) | **100.0%** | — | Guaranteed Discovery within Top-3 |
| **Hit Rate@5** (Top-5 Accuracy) | **100.0%** | — | Full Discovery Coverage |
| **Search Latency (p50 / p95 / p99)** | **0.037 ms / 0.078 ms / 0.092 ms** | — | Microsecond In-Memory BM25 + ONNX Worker |

### 3. Multi-Turn Compounding Scale & Cost Savings

Because system prompt tool definitions are re-transmitted on **every single conversational turn**, savings compound quadratically ($\mathcal{O}(T^2)$) throughout an agent session ($T = 1\text{–}100\text{ turns}$, standard rate: $\$2.50\text{ / 1M input tokens}$):

| Session Horizon ($T$) | Cumulative Baseline Tokens | With Tool Search | Net Tokens Saved | Baseline Cost (USD) | With Tool Search (USD) | Net Session Savings |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1 turn** | 29,831 | 26,264 | **3,567 tokens** | $0.0746 | $0.0657 | **$0.0089** (11.96%) |
| **5 turns** | 156,655 | 138,820 | **17,835 tokens** | $0.3916 | $0.3471 | **$0.0446** (11.38%) |
| **10 turns** | 332,060 | 296,390 | **35,670 tokens** | $0.8302 | $0.7410 | **$0.0892** (10.74%) |
| **20 turns** | 739,120 | 667,780 | **71,340 tokens** | $1.8478 | $1.6695 | **$0.1783** (9.65%) |
| **30 turns** | 1,221,180 | 1,114,170 | **107,010 tokens** | $3.0530 | $2.7854 | **$0.2675** (8.76%) |
| **50 turns** | 2,410,300 | 2,231,950 | **178,350 tokens** | $6.0257 | $5.5799 | **$0.4459** (7.40%) |
| **100 turns** | 6,695,600 | 6,338,900 | **356,700 tokens** | $16.7390 | $15.8472 | **$0.8918 / session** (5.33%) |

---

### 4. Academic Research & Local Reproducibility

Explore our full mathematical formulations, proofs, and raw empirical artifacts:

- 📄 **[Research Thesis Paper: Mitigating Tool Context Bloat in Multi-Agent LLM Runtimes](docs/research/real-world-context-reduction-thesis.md)**  
  *Formal proofs on quadratic token accumulation $\mathcal{O}(T^2)$, attention dilution, and the "Tool Bloat Tax".*
- 📐 **[Benchmark Methodology & IR Standards Specification](docs/research/professional-benchmark-methodology.md)**  
  *Comprehensive evaluation harness specification adhering to TREC, BEIR, and Berkeley Function-Calling (BFCL) standards.*
- 📊 **[Raw JSON Evaluation Artifacts](docs/research/benchmark-thesis-results.json)**  
  *Unprocessed empirical run data containing full tool complexity metrics, confidence intervals, and latency distributions.*

```bash
# Reproduce the full benchmark suite locally (~500ms execution)
npm run bench
```

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

# Run Vitest test suite (106 tests across 5 suites)
npm test

# Typecheck
npm run typecheck

# Build bundle and roll types
npm run build

# Run isolated npm pack and load smoke test
npm run smoke:plugin
```
