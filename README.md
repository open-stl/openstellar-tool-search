# OpenStellar Tool Search

**Every tool has a name. Only you know what you need to do.**

Tool Search bridges that gap. It's an OpenCode plugin that lets the LLM discover tools by **capability, not by name** — reducing context waste, eliminating guesswork, and turning deferred descriptions from a liability into an advantage.

## Why This Exists

OpenCode defers tool descriptions to save context. That `[d]` is efficient — but it leaves the LLM blind. What does that tool do? Which one should I call?

Without tool search, the LLM either:
- Calls the wrong tool and wastes a turn
- Loads everything and wastes context
- Guesses and hopes

**Tool Search fixes this.** The LLM asks "what tools do I have for X?" — and gets ranked, parameter-aware results instantly.

## Features

- **BM25 intent search** — Describe what you want, not the tool name. Searches names, descriptions, and parameter keys. Ranks by relevance.
- **Regex precision search** — When you know the name shape: `^github.*create`, `mcp|context`, `^read$`.
- **Deferred descriptions** — Keeps `[d]` efficiency without the blindness. Full descriptions loaded only when searched.
- **Parameter name indexing** — Deep-recursive: `filters.status`, `items[].id` — all indexed for discovery.
- **Self-contrasting tools** — Each search tool tells the LLM *when to use the other one*. No guessing.
- **Lazy BM25 indexing** — Zero cost on register. Index rebuilt on first search, delta-only on subsequent changes.

## How It Works

```
tool.definition hook                          tool_search({ query: "create github issue" })
       │                                               │
       ▼                                               ▼
  Catalog │─────────── Lazy BM25 Index ───────────│ Ranked results
 (entries)      (built on first search only)        with full descriptions
```

Each tool registered gets its ID, description, and **every nested parameter name** indexed. Search returns the richest match, not just the first alphabetically.

## Installation

```bash
npm install -g @openstellar/tool-search
```

```jsonc
{
  "plugin": [
    [
      "@openstellar/tool-search@latest",
      {
        "searchLimit": 5,
        "bm25": { "k1": 0.9, "b": 0.4 }
      }
    ]
  ]
}
```

> `tool_search` and `tool_search_regex` are auto-included. No config needed.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `alwaysLoad` | `string[]` | `[]` | Tools to never defer (tool_search/regex auto-included) |
| `searchLimit` | `number` | `5` | Maximum results per search |
| `deferDescription` | `string` | `"[d]"` | Deferred description placeholder |
| `bm25.k1` | `number` | `0.9` | Term frequency saturation — higher = more weight on repeated terms |
| `bm25.b` | `number` | `0.4` | Length normalization — 0 = no normalization, 1 = full |

## LLM Behaviour

The plugin injects two tools into the LLM's tool belt:

```
tool_search({ query: "file read write" })
    → BM25-ranked tools matching file capabilities

tool_search_regex({ pattern: "^github.*issue" })
    → Regex-matched tools matching the name pattern
```

Each description explains *when* to use itself and *when* to use the other — the LLM self-selects correctly.

## Architecture

```
src/
├── shared/       — Types, schema utilities, tokenizer
│                 → Extractable to @openstellar/shared
├── engine/       — BM25 algorithm (pure, zero dependencies)
│                 → No plugin code, no OpenCode dependency
├── catalog/      — Tool registry with lazy BM25 indexing
└── plugin/       — OpenCode plugin hooks & tool definitions
```

Why layered? The `shared/` and `engine/` directories can be extracted to `@openstellar/shared` and consumed by other packages — no duplication required.

## Development

```bash
npm install
npm test          # 66 tests
npm run typecheck
npm run build
```

## License

MIT © 2026 OpenStellar
