# OpenStellar Tool Search

> ⚠️ **Required:** This plugin must be used with [`@openstellar/mcp-adapter`](https://github.com/open-stl/openstellar-mcp-adapter) to function.

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
| **Auto-update** | Checks npm registry on first session, invalidates stale cache, notifies you by toast | Always runs the latest version. No manual cleanup. |

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
| `searchLimit` | `number` | `10` | Max results per search |
| `deferDescription` | `string` | `"[d]"` | Placeholder used for deferred descriptions |
| `bm25.k1` | `number` | `0.9` | Term frequency saturation — higher = more weight on repeated terms |
| `bm25.b` | `number` | `0.4` | Length normalization — `0` = none, `1` = full |
| `embedding.enabled` | `boolean` | `true` | Use local semantic search via `@xenova/transformers` |
| `embedding.model` | `string` | `"Xenova/paraphrase-multilingual-MiniLM-L12-v2"` | Any HuggingFace model supported by the transformers pipeline |
| `embedding.threshold` | `number` | `0.5` | Cosine similarity floor for semantic hits |

---

## Architecture

```
src/
├── plugin.ts       — OpenCode hooks (tool.definition, system.transform, event)
├── vault.ts        — ToolVault (BM25 + semantic search engine)
├── matcher.ts      — SemanticMatcher (@xenova/transformers embeddings)
├── rank.ts         — RankEngine (BM25 tokenizer & scorer)
├── types.ts        — TypeScript types
└── hooks/
    └── auto-update-checker.ts  — npm registry version check + cache invalidation
```

---

## Development

```bash
npm install
npm test          # 115 tests
npm run typecheck
npm run build
```

Smoke test the built tarball:

```bash
npm run smoke:plugin
```

---

## Related Repositories

* [openstellar-mcp-adapter](https://github.com/open-stl/openstellar-mcp-adapter)
* [opencode-tool-search](https://github.com/M0Rf30/opencode-tool-search)
* [opencode-mcp-adapter](https://github.com/CloudedQuartz/opencode-mcp-adapter)

---

## License

MIT © 2026 OpenStellar
