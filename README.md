# OpenStellar Tool Search

**Every tool has a name. Only you know what you need to do.**

OpenCode defers tool descriptions to save context — the `[d]` tag is everywhere.
Efficient, but the LLM goes blind. It calls the wrong tool, loads everything, or guesses.

Tool Search is the bridge. The LLM describes the **job**, not the name. You get
BM25 + semantic search over tool IDs, descriptions, and parameter schemas —
ranked results, with full descriptions, in one call.

---

## What You Get

| Feature | What it does | Why it matters |
| --- | --- | --- |
| **Semantic + BM25 search** | Match the job against tool names, descriptions, and every nested parameter (`filters.status`, `items[].id`) | The LLM finds tools by capability, not by guessing names |
| **Regex precision** | `^github.*create`, `mcp\|context`, `^read$` — when you know the shape | Fast pinpoint lookup, no false positives |
| **Deferred descriptions** | Keeps OpenCode's `[d]` token savings intact | Full descriptions load **only** when searched. Best of both worlds. |
| **Lazy indexing** | Zero cost on register. BM25 + embeddings built on first search only | Plugin does nothing until you ask. No startup tax. |
| **Self-contrasting tools** | Each search tool tells the LLM *when to use the other* | No "which one do I call?" paralysis |
| **Local embeddings** | `@xenova/transformers` runs MiniLM in-process | No API calls. No data leaves the machine. |
| **Drop-in plugin** | One npm install + one config block | Works with any OpenCode tool registry |

---

## Get Started

```bash
npm install -g @openstellar/tool-search
```

Add to `opencode.jsonc`:

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

Restart OpenCode. Tools get `[d]`. The LLM uses `tool_search` when it needs to know what they do.

---

## How It Works

```
OpenCode tool.definition hook                  tool_search({ query: "create github issue" })
        │                                                   │
        ▼                                                   ▼
  Tool Vault  ────────  Lazy BM25 + Embeddings  ──────  Ranked hits
  (ID + desc + params)        (built on first search)     with full descriptions
```

Each tool registered gets its **ID**, **description**, and **every nested parameter name** indexed.
Search returns the richest match — not just the first alphabetical hit.

---

## Config

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `alwaysLoad` | `string[]` | `[]` | Tool IDs to never defer (`tool_search` and `tool_search_regex` are auto-added) |
| `searchLimit` | `number` | `5` | Max results per search |
| `deferDescription` | `string` | `"[d]"` | Placeholder used for deferred descriptions |
| `bm25.k1` | `number` | `0.9` | Term frequency saturation — higher = more weight on repeated terms |
| `bm25.b` | `number` | `0.4` | Length normalization — `0` = none, `1` = full |
| `embedding.enabled` | `boolean` | `true` | Use local semantic search via `@xenova/transformers` |
| `embedding.model` | `string` | `"Xenova/all-MiniLM-L6-v2"` | Any HuggingFace model the transformers pipeline supports |
| `embedding.threshold` | `number` | `0.3` | Cosine similarity floor for semantic hits |

---

## Architecture

```
src/
├── shared/       — Types, JSON Schema utilities, tokenizer
│                   (extractable to @openstellar/shared)
├── engine/       — BM25 ranking (pure, zero dependencies)
├── catalog/      — Tool vault with lazy indexing
└── plugin/       — OpenCode hooks + tool definitions
```

Why layered? The `shared/` and `engine/` modules can be extracted to `@openstellar/shared`
and reused across other OpenStellar packages — no duplication.

---

## Development

```bash
npm install
npm test          # 66 tests
npm run typecheck
npm run build
```

Smoke test the built tarball (proves `npm publish` will work):

```bash
npm run smoke:plugin
```

---

## License

MIT © 2026 OpenStellar
