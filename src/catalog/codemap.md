# src/catalog/

## Responsibility

`src/catalog/` serves as the centralized catalog management, schema normalization, and multi-tier Dual Search subsystem for OpenStellar Tool Search. It is responsible for:
- Ingesting, indexing, and maintaining the metadata of all available tools across local OpenCode tools and remote Model Context Protocol (MCP) servers.
- Normalizing diverse parameter schema structures, including dereferencing JSON Schema `$ref` pointers and translating Effect-TS schemas into standard JSON Schema Draft 2020-12 representations.
- Providing high-performance tool retrieval via full-text lexical ranking (Okapi BM25), regular expression scanning (`grep`), and semantic vector embeddings (ONNX feature extraction via worker threads or main thread).
- Aggregating and scoring query results through cascade gating and Reciprocal Rank Fusion (RRF) to optimize retrieval accuracy while minimizing latency.
- Resolving tool identifier aliases, handling environment-specific naming variations (such as `_ide` suffixes and kebab/snake-case naming), and preventing state clobbering from truncated deferred tool descriptions.

---

## Design Patterns

### 1. Façade / Gateway Pattern (`ToolVault`)
- **Location**: `vault.ts`
- **Details**: `ToolVault` acts as the primary external boundary and façade for the entire catalog subsystem. It encapsulates internal components (`ToolStore` and `DualSearchEngine`), coordinating state invalidation via event subscriptions (`this.store.onChanged(() => this.engine.notifyChanged())`), and exposes a clean, unified API for tool registration, lifecycle readiness polling, regex pattern matching, and dual search execution.

### 2. Inverted Index & Okapi BM25 Ranking (`RankEngine<T>`)
- **Location**: `rank.ts`
- **Details**: A generic full-text retrieval engine implementing Okapi BM25 ranking algorithm. Features:
  - Tokenization and Unicode term extraction via `breakWords()`.
  - Inverted term frequency tracking (`countTerms()`) and document frequency mapping (`docFreq`).
  - Robertson-Spärck Jones Inverse Document Frequency (`inverseDocFreq`) calculation:
    $$\text{IDF}(q) = \ln\left(\frac{N - n(q) + 0.5}{n(q) + 0.5} + 1\right)$$
  - Parameterized term saturation ($k_1$) and document length normalization ($b$) against average document length ($\text{avgLen}$).

### 3. Worker Threading / Off-Event-Loop Concurrency (`SemanticMatcher`, `matcher.worker.ts`)
- **Location**: `matcher.ts`, `matcher.worker.ts`
- **Details**: Offloads CPU-intensive ONNX transformer embedding inference (`@xenova/transformers`, model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`) to a dedicated background Node.js `Worker` thread.
  - IPC protocol uses typed messages (`init`, `inference`, `ready`, `error`).
  - Main thread manages a sequence-based request map (`workerRequests`) with per-request timeouts (5,000 ms) and lifecycle fail-open fallbacks.
  - Workers use `.unref()` so background threads do not block process termination.

### 4. Repository & Store Pattern with Write Protection (`ToolStore`)
- **Location**: `tool-store.ts`
- **Details**: In-memory repository managing `ToolMeta` records (`Map<string, ToolMeta>`).
  - **Deferred Description Guard**: Rejects updates that attempt to overwrite fully populated descriptions with truncated `[deferred]` placeholder descriptions.
  - **Indexed Text Extraction**: Recursively extracts nested JSON Schema property names and descriptions (`extractParamTexts`) to enrich the lexical index.
  - **Alias Resolution Engine**: Resolves tool identifiers with fallback matching across `_ide` suffix stripping, snake/kebab case normalization, and scoped namespace suffix matching.

### 5. Observer / Reactive Invalidation Pattern
- **Location**: `tool-store.ts`, `vault.ts`, `search-engine.ts`, `tool-provider.ts`
- **Details**: Decouples catalog mutations from search index freshness. When tools are added, updated, or removed in `ToolStore`, `notifyChanged()` triggers registered listeners in `DualSearchEngine`. The search engine increments its `semanticGeneration` counter and marks `scorerStale = true` and `semanticStale = true`, deferring index rebuilding until query time (lazy evaluation).

### 6. Port & Adapter / Strategy Pattern (`ToolProvider`, `ToolDefinition`)
- **Location**: `tool-provider.ts`
- **Details**: Defines abstract contracts (`ToolProvider`, `ToolDefinition`) for plugging in heterogeneous tool sources (e.g. static built-ins, dynamic MCP client connections). Supports lifecycle polling (`awaitReady`) and dynamic runtime catalog updates (`onUpdate`).

### 7. Multi-Tier Retrieval & Reciprocal Rank Fusion Pipeline (`DualSearchEngine`)
- **Location**: `search-engine.ts`
- **Details**: Implements a staged retrieval pipeline:
  - **Stage 1 (Lexical Fast-Path)**: Evaluates BM25 score. If the top document score satisfies `cascadeThreshold`, semantic search is bypassed entirely.
  - **Stage 2 (Vector Embedding & Threshold Sweeping)**: Conducts cosine similarity vector matching, with dynamic threshold relaxation ($0.7 \times \text{threshold}$) when candidate matches are sparse.
  - **Stage 3 (Reciprocal Rank Fusion)**: Combines disparate lexical and dense vector rankings into a unified score using RRF:
    $$\text{RRFScore}(d) = \sum_{m \in \{\text{BM25}, \text{Semantic}\}} \frac{1}{k + \text{rank}_m(d) + 1} \quad (k = 60)$$
  - **Stage 4 (Alias Token Injection)**: Injects exact keyword/alias matches (`resolveAlias`) into candidate results before ranking output.

### 8. Cache-Aside Pattern (`SemanticMatcher`)
- **Location**: `matcher.ts`
- **Details**: Persists precomputed document embedding vectors on disk in JSON format (`.cache/vectors-<hash>.json`). Cache keys are deterministically generated via SHA-256 hashing of the model name, quantization/data type pipeline options, and the concatenated document IDs and texts. Valid cache hits bypass ONNX model execution entirely.

### 9. Tree Rewriting & AST Transformation (`schema-normalize.ts`)
- **Location**: `schema-normalize.ts`
- **Details**: Functional recursive transformers normalize parameter schemas:
  - Inlines local `$ref` definitions (`#/$defs/`, `#/definitions/`) with cycle tracking (`seen: Set<string>`) and maximum depth safety bounding (`MAX_SCHEMA_DEPTH = 20`).
  - Prunes unreferenced `$defs` / `definitions` trees once inlining succeeds.
  - Unwraps singleton or NaN/Infinity-wrapped `anyOf` unions from effect schemas.
  - Converts Effect-TS AST schemas to standard JSON Schema documents with `WeakMap` memoization.

---

## Data & Control Flow

```
+-----------------------------------------------------------------------------+
|                                Tool Ingestion                               |
+-----------------------------------------------------------------------------+
   MCP / Static Source
           |
           v
   ToolProvider.getTools() / onUpdate()
           |
           v
   normalizeParameters(schema)  ---> [Inline $ref, convert Effect-TS, prune $defs]
           |
           v
   ToolVault.add() / registerProvider()
           |
           v
   ToolStore.add()  ---> [Guard against [deferred] overwriting full descriptions]
           |
           v (fires onChanged)
    DualSearchEngine.notifyChanged() ---> [scorerStale=true, semanticStale=true, generation++]
```

```
+-----------------------------------------------------------------------------+
|                            Dual Query Execution                             |
+-----------------------------------------------------------------------------+
   Client Query: ToolVault.query(text, limit, timeoutMs)
           |
           v
   DualSearchEngine.query(text, limit, timeoutMs)
           |
   +-------+------------------------------------------+
   |                                                  |
   v                                                  v
[Lexical Branch: BM25]                     [Semantic Branch: Vector]
   - Rebuild RankEngine if stale              - Check if enabled / cache hit
   - breakWords() & countTerms()              - Lazy index build (Worker / ONNX)
   - BM25 score calculation                   - runInference(query) -> Float32Array
   - store.resolveAlias() injection           - Cosine similarity sweep & sweep(0.7*thresh)
           |                                                  |
           +--------------------+-----------------------------+
                                |
                                v
               [Cascade Score Check >= cascadeThreshold?]
                     /                   \
                   YES                   NO
                   /                       \
        Return BM25 Hits            fuseRRF(bm25Hits, semanticScores, limit)
                                           |
                                           v
                                Map to ToolMeta from Store
                                           |
                                           v
                                    Final Tool Hits
```

### Key Execution Sequences:
1. **Catalog Ingestion & Invalidation**:
   - `ToolVault.registerProvider(provider)` calls `provider.getTools()`.
   - Iterates entries and calls `ToolStore.add(id, description, parameters)`.
   - `ToolStore.add()` verifies whether the entry is novel or updated, rejecting `[deferred]` overwrites on full descriptions.
   - `ToolStore.notifyChanged()` notifies `DualSearchEngine.notifyChanged()`, bumping `semanticGeneration`.

2. **Lexical Scoring Pipeline (`queryBM25`)**:
   - `DualSearchEngine.buildScorer()` checks `scorerStale`; if true, instantiates a new `RankEngine<ToolMeta>(k1, b)`.
   - `store.prepareIndexedText(tool)` flattens tool ID, description, and nested parameter field names/descriptions into a single string.
   - `RankEngine.feed()` tokenizes and builds frequency tables.
   - `RankEngine.query()` ranks items. Tokens in the raw search string are evaluated against `ToolStore.resolveAlias()` to inject exact matches.

3. **Semantic Inference & Worker Lifecycle**:
   - `SemanticMatcher.open()` checks worker availability (`matcher.worker.js`).
   - If `useWorker: true`, spawns `node:worker_threads` `Worker`, sending `{ type: 'init', model, pipelineOptions }`.
   - `SemanticMatcher.index(entries)` checks SHA-256 vector cache on disk. On cache miss, batches entries ($N=32$) and sends `{ type: 'inference', id, texts, options }` across IPC.
   - `SemanticMatcher.locate(query)` computes cosine similarity between query vector and normalized document vectors, dynamically relaxing thresholds when result count $< 2$.

4. **Regex Match Pipeline (`grep`)**:
   - `ToolVault.grep(pattern, limit)` invokes `ToolStore.grep(pattern, limit)`.
   - Compiles case-insensitive `RegExp(pattern, 'i')`.
   - Evaluates `re.test()` on `id` and `description`.
   - Fallback handler strips trailing `_ide` suffix if no matches are initially found.

---

## Integration Points

### Exported Types & Classes
| Symbol | Originating File | Role |
| :--- | :--- | :--- |
| `ToolVault` | `vault.ts` | Main façade orchestrating catalog storage and dual search. |
| `ToolStore` | `tool-store.ts` | In-memory store, alias resolver, parameter extractor, regex searcher. |
| `DualSearchEngine` | `search-engine.ts` | Multi-tier coordinator combining BM25, semantic embeddings, and RRF. |
| `SemanticMatcher` | `matcher.ts` | Dense vector indexer, worker manager, ONNX pipeline coordinator. |
| `RankEngine<T>` | `rank.ts` | Generic Okapi BM25 implementation. |
| `ToolProvider`, `ToolDefinition` | `tool-provider.ts` | Seam contracts for local and remote tool sources. |
| `normalizeParameters`, `inlineLocalReferences` | `schema-normalize.ts` | JSON Schema & Effect-TS AST normalization and reference dereferencing. |

### Upstream Subsystems & Consumer Modules
- **`src/engine/session-engine.ts` (`SessionRuntime`)**:
  - Instantiates and owns `ToolVault`.
  - Normalizes schemas on incoming tool definitions via `normalizeParameters()`.
  - Coordinates session tool authorization states with catalog discovery.
- **`src/hooks/mcp-wiring.ts`**:
  - Registers dynamic MCP tool providers into `ToolVault`.
  - Awaits provider warm-up settlement via `ToolVault.awaitReady()`.
- **`src/mcp/mcp-tool-provider.ts`**:
  - Implements the `ToolProvider` interface for MCP client instances.
- **`src/mcp/mcp-tool-adapter.ts` & `src/mcp/server-connection.ts`**:
  - Ingests tool schemas from remote MCP servers and applies `inlineLocalReferences` to resolve circular/remote schemas before catalog registration.
- **`src/engine/session-tool-registry.ts`**:
  - Consumes `ToolDefinition` contracts to manage per-session deferred vs loaded tool activation.

### Internal & External Dependencies
- **`@xenova/transformers`**: Local ONNX transformer model execution for vector embeddings.
- **`effect`**: `Schema` and `JsonSchema` utilities for converting Effect-TS schemas.
- **`node:worker_threads`**: Process isolation for embedding inference.
- **`node:crypto`, `node:fs`, `node:path`**: SHA-256 cache hashing and filesystem persistence.
- **`src/types.js`**: Consumes shared interfaces (`ToolMeta`, `ScoreParams`, `EmbedConfig`, `Hit<T>`).
