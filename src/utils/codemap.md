# src/utils/

## Responsibility
`src/utils/` provides cross-cutting, reusable low-level utility functions for filesystem operations and shared helpers. Its primary component is `atomic-write.ts`, which guarantees crash-safe, race-free filesystem persistence for state and cache files across platforms.

## Design Patterns
- **Atomic File Replacement / Transaction**: Uses the temp-file-write followed by atomic rename pattern (`writeFileSync` to a unique temp file -> `renameSync` to the target destination) to ensure that files are never partially written or corrupted during unexpected termination or concurrent reads.
- **Fallback / Self-Healing Strategy**: Implements fallback direct writing (`writeFileSync` directly to destination with best-effort cleanup of temp files) when atomic rename fails due to cross-mount or OS-specific filesystem locking issues.
- **Idempotent Directory Provisioning**: Automatically ensures destination directories exist (`mkdirSync(..., { recursive: true })`) prior to executing write operations.

## Data & Control Flow
1. **Invocation**:
   - Callers invoke `writeJsonAtomic(filePath, payload)`.
2. **Directory & Temp Path Resolution**:
   - Evaluates `dirname(filePath)` and ensures path directory existence via `existsSync` and `mkdirSync`.
   - Serializes `payload` into formatted JSON (`JSON.stringify(payload, null, 2)`).
   - Generates a unique temporary filename (`<filePath>.tmp.<timestamp>.<random>`).
3. **Atomic Commit**:
   - Synchronously writes JSON content to the temporary file.
   - Renames temporary file to destination path atomically via `renameSync`.
4. **Fallback Handling**:
   - Catches rename failures, writes directly to `filePath`, and unlinks the leftover temporary file if present.

## Integration Points
- **Node.js Core Modules**: Relies on `node:fs` (`existsSync`, `mkdirSync`, `renameSync`, `unlinkSync`, `writeFileSync`) and `node:path` (`dirname`).
- **Consumer Modules**: Used across persistence boundaries (such as auth token caching, session state persistence, and embedding cache management) where consistent JSON serialization to disk is required.
