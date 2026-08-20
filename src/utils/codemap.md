# src/utils/

## Responsibility
`src/utils/` provides cross-cutting, reusable low-level utility functions for filesystem operations, storage path resolution, and safe JSON persistence:
- `atomic-write.ts`: Guarantees crash-safe, race-free filesystem persistence for state and cache files across platforms (`writeJsonAtomic`).
- `storage-path.ts`: Centralized resolution of runtime storage directories (`resolveStorageDir`) across environment variables (`OPENCODE_STORAGE_DIR`, `XDG_DATA_HOME`, Windows `LOCALAPPDATA`), along with safe JSON file reading and writing helpers (`safeReadJson`, `safeWriteJson`).

## Design Patterns
- **Atomic File Replacement / Transaction**: Uses the temp-file-write followed by atomic rename pattern (`writeFileSync` to a unique temp file -> `renameSync` to the target destination) to ensure that files are never partially written or corrupted during unexpected termination or concurrent reads.
- **Single Source of Storage Resolution**: Centralizes storage path precedence logic in `resolveStorageDir`, ensuring cache and state locations remain consistent across subsystems.
- **Safe JSON Serialization & Error Bounding**: Encapsulates parse/read errors in `safeReadJson` returning `null` on corrupt or unreadable files rather than propagating unhandled exceptions.
- **Fallback / Self-Healing Strategy**: Implements fallback direct writing (`writeFileSync` directly to destination with best-effort cleanup of temp files) when atomic rename fails due to cross-mount or OS-specific filesystem locking issues.
- **Idempotent Directory Provisioning**: Automatically ensures destination directories exist (`mkdirSync(..., { recursive: true })`) prior to executing write operations.

## Data & Control Flow
1. **Invocation**:
   - Callers invoke `writeJsonAtomic(filePath, payload)`, `safeReadJson(filePath)`, or `safeWriteJson(filePath, data)`.
   - Callers resolve storage subdirectories using `resolveStorageDir(subdir)`.
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
- **Node.js Core Modules**: Relies on `node:fs` (`existsSync`, `mkdirSync`, `renameSync`, `unlinkSync`, `readFileSync`, `writeFileSync`), `node:os` (`homedir`, `platform`), and `node:path` (`join`, `dirname`).
- **Consumer Modules**: Used across persistence boundaries (such as `AuthPersistence`, `DeliveryHistoryPersistence`, session state persistence, and embedding cache management) where consistent JSON serialization and storage directories are required.
