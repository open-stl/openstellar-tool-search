# src/engine/

## Responsibility
The `src/engine/` module serves as the core runtime, session lifecycle, and authorization engine for the `openstellar-tool-search` plugin. It implements:
- **Deferred Tool Lifecycle Management**: Dynamically intercepts tool registration, truncating tool descriptions to defer full schemas until requested.
- **Session-Scoped Authorization State Machine**: Tracks which tools have been unlocked/authorized per session context, enforcing pre-execution search policies.
- **Tool Delivery Deduplication & Fingerprinting**: Maintains content-addressable tool fingerprints (`computeFingerprint`) to suppress redundant schema deliveries while supporting re-authorization (Rule 41).
- **Execution Gatekeeper & Enforcement**: Intercepts tool dispatch and throws explicit reminder errors when unsearched deferred tools are invoked.
- **Context Compaction & Pruning Synchronization**: Monitors conversation messages and Sleev compression events (`syncActiveAuthorizations`, `syncSleevCompression`) to selectively revoke tool authorizations when tool schemas are pruned from the active LLM context.
- **Search Tool Exposure**: Provides the native OpenCode plugin tools (`tool_search` and `tool_search_regex`) with warming retry mechanisms.

---

## Design Patterns

### 1. Facade / Mediator (`SessionToolRegistry`)
- **Role**: Provides a unified domain seam over `AuthorizationState` and `DeliveryHistory`.
- **Purpose**: Encapsulates the interplay between durable authorizations and delivery tracking. Enforces Rule 41 (Authorization Precedence) and coordinates atomic state transitions across searches, revoking, and compaction resets.

### 2. State Machine & Policy Engine (`AuthorizationState`)
- **Role**: Maintains per-session authorized tool sets and policy sets (`alwaysOn`, `resetTools`, `deferredTools`).
- **Purpose**: Evaluates authorization transitions, checks alias/cloaking variations (handling `_ide` and recursive multi-suffix cloaks like `bash_ide_ide`), and migrates legacy authorization formats to structured canonical records (`CanonicalToolAuthorization`).

### 3. Persistence Adapter / Unit of Work (`AuthPersistence`, `DeliveryHistoryPersistence`)
- **Role**: Handles debounced, atomic filesystem persistence for authorizations (`authorizations.json`) and delivery tracking (`session-deliveries.json`).
- **Key Features**:
  - Uses `writeJsonAtomic` to prevent partial write corruption.
  - Debounced write queue (default 50ms window) with asynchronous write chaining (`writePromise`).
  - Process lifecycle hook registration (`beforeExit` via `registerGlobal*ExitHandler`) ensuring clean synchronous flushes (`flushSync`) on process termination.
  - Concurrency reconciliation: Merges in-memory delta state with concurrent disk state on write.
  - TTL pruning: Automatically expires stale session records older than 30 days.

### 4. Content-Addressable Fingerprint / Value Object (`computeFingerprint`)
- **Role**: Produces deterministic SHA-256 hashes over tool definitions `(id + description + stableStringify(parameters))`.
- **Purpose**: Accurately detects schema updates or description changes across server reloads, distinguishing truly new discoveries from unchanged tools.

### 5. Orchestrator / Subsystem Runtime (`SessionEngine` / `SessionRuntime`)
- **Role**: Central entry point and orchestrator binding the catalog (`ToolVault`), session registry (`SessionToolRegistry`), OpenCode plugin context (`PluginInput`), prompt transformations, and active search tools.

---

## Data & Control Flow

### 1. Tool Registration Flow
```
OpenCode Startup / Provider Registration
   │
   ▼
SessionEngine.deferTool(toolID, description, parameters, jsonSchema)
   │
   ├─► ToolVault.add(toolID, description, normalizedParams)
   │     └─► Stores in catalog index (BM25 + Semantic Embeddings)
   │
   └─► SessionToolRegistry.registerTool(toolID)
         └─► AuthorizationState.registerTool(toolID)
               ├─► If in alwaysOn: return false (not deferred)
               └─► Else: add to deferredTools, return true (deferred)
   │
   └─► If deferred: returns truncateDescription(description, deferLabel)
       Else: returns original description
```

### 2. Search & Tool Delivery Flow (`tool_search` / `tool_search_regex`)
```
Model calls tool_search(query) or tool_search_regex(pattern)
   │
   ▼
SessionEngine.searchTools[name].execute(args, context)
   │
   ├─► ToolVault.query() / ToolVault.grep()
   │     └─► (If 0 hits and catalog warming: awaits ToolVault.awaitReady())
   │
   ▼
SessionToolRegistry.processSearchResult(sessionID, allHits, maxResults)
   │
   ├─► DeliveryHistory.filterNewDiscoveries(sessionID, allHits)
   │     └─► Computes fingerprints; partitions into `new` vs `delivered`
   │
   ├─► Rule 41 Evaluation (Authorization Precedence):
   │     └─► toDeliver = hits that are either NEW or NOT currently authorized
   │
   ├─► If toDeliver is empty and delivered.length > 0:
   │     └─► Returns 'no-op' response ("No new tools discovered...")
   │
   ├─► Slice to maxResults
   ├─► AuthorizationState.authorize(sessionID, limitedHits)
   │     └─► Persists to AuthPersistence (debounced)
   ├─► DeliveryHistory.recordDelivered(sessionID, hit.id, fingerprint)
   │     └─► Persists to DeliveryHistoryPersistence (debounced)
   │
   ▼
Formatted tool descriptions & schemas returned to Model
```

### 3. Execution Authorization Check Flow
```
Model attempts tool invocation: executedTool (e.g. "bash_ide")
   │
   ▼
SessionEngine.assertAuthorized(executedTool, sessionID, canonicalTool)
   │
   ▼
SessionToolRegistry.requiresReminder(sessionID, executedTool, canonicalTool)
   │
   ▼
AuthorizationState.requiresReminder(sessionID, executedTool, canonicalTool)
   │
   ├─► 1. If alwaysOn contains executedTool or canonicalTool: ALLOW (no reminder)
   ├─► 2. Resolve baseID (strips trailing `_ide` suffixes)
   ├─► 3. If neither executedTool, canonicalTool, nor baseID is deferred: ALLOW
   ├─► 4. If sessionID is absent: DENY (requires reminder)
   ├─► 5. Check if session authorizations contain targetID or canonicalID
   │
   ├─► If NOT authorized:
   │     └─► Throws Error: "[Tool Search Required] Tool ... has not been searched..."
   └─► If authorized: ALLOW execution
```

### 4. Context Pruning & Compression Synchronization Flow
```
Prompt Transform / Hook Lifecycle
   │
   ▼
SessionEngine.syncSleevCompression(sessionID, messages)
   │
   ├─► 1. Scans messages for completed `compress` tool invocations and extracts pruned IDs
   ├─► 2. Inspects conversation message blocks (<sleev-id-mXXXX>)
   ├─► 3. Reconstructs active, unpruned context text
   ├─► 4. Matches active text against authorized tool IDs
   │
   ▼
If tool schema was pruned from context:
   ├─► SessionToolRegistry.revokeTools(sessionID, [toolID])
   │     ├─► AuthorizationState.revoke(sessionID, [toolID])
   │     └─► DeliveryHistory.remove(sessionID, [toolID])
   │
   ▼
Model is forced to re-search tool upon subsequent usage (preventing hallucinated schemas)
```

### 5. Compaction & Reset Trigger Flow
```
Tool Execution Event (e.g. compress / /clear)
   │
   ▼
SessionEngine.handleToolExecuted(toolID, sessionID) / compactSession(sessionID)
   │
   ▼
SessionToolRegistry.compactSession(sessionID)
   ├─► AuthorizationState.resetSession(sessionID)
   │     └─► Purges in-memory authorizations, deletes session in AuthPersistence
   └─► DeliveryHistory.clear(sessionID)
         └─► Purges delivery history in DeliveryHistoryPersistence
```

---

## Integration Points

### 1. Internal Dependencies
- **`../catalog/vault.js` (`ToolVault`)**: Core search catalog indexing tool metadata, embeddings, BM25 text search, and regex scanning.
- **`../catalog/schema-normalize.js` (`normalizeParameters`)**: Normalizes tool schema inputs before indexing and fingerprint hashing.
- **`../hooks/deferral.js` (`truncateDescription`)**: Formats deferred tool descriptions for system prompt consumption.
- **`../hooks/toast.js` (`toast`)**: Dispatches UI notifications for catalog indexing/search warnings and deferral summaries.
- **`../utils/atomic-write.js` (`writeJsonAtomic`)**: Guarantees atomic filesystem writes via temporary file renaming.

### 2. Exported APIs & Classes
- **`SessionEngine` (aliased as `SessionRuntime`)**: Primary subsystem orchestrator exposed to the plugin lifecycle hooks. Exposes canonical search tool specs (`searchToolSpecs`), context turn processing (`applyContextTurn`), and session lifecycle event routing (`handleSessionEvent`).
- **`SessionToolRegistry`**: Unified domain registry for testing, integration, and standalone session management.
- **`AuthorizationState`**: Authorization state machine managing permissions, migrations, and access control policies.
- **`DeliveryHistory` & `computeFingerprint`**: Deduplication and fingerprinting utilities.
- **`AuthPersistence` & `DeliveryHistoryPersistence`**: Standalone persistence adapters.
- **Constants**: `SEARCH_IDS`, `DEFAULT_DEFER`, `WARMING_MESSAGE`, `TOOL_SEARCH_PARAM_DESC`, `TOOL_SEARCH_REGEX_PARAM_DESC`.

### 3. Consumer Modules
- **`src/plugin.ts`**: Instantiates `SessionEngine`, registers `engine.searchTools` with OpenCode 1.x, passes provider tools, delegates session events to `engine.handleSessionEvent(event)`.
- **`src/v2/setup.ts`**: OpenCode 2.0 lifecycle adapter that registers `engine.searchToolSpecs` into `ctx.tool.transform`, applies `engine.applyContextTurn(sessionCtx)` on `session.hook('context')`, and delegates `session.deleted` to `engine.handleSessionEvent(event)`.
- **`src/hooks/`**:
  - `tool-definition.ts`: Calls `engine.deferTool()` during tool registration.
  - `tool-execute.ts`: Calls `engine.assertAuthorized()` and `engine.handleToolExecuted()`.
  - `system-transform.ts`: Calls `engine.prepareForSystemTransform()`, `engine.syncSleevCompression()`, and `engine.syncActiveAuthorizations()`.
