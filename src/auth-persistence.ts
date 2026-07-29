import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { env } from 'node:process';

export interface CanonicalToolAuthorization { kind: 'canonical-tool'; version: 1; canonicalId: string; }
export type PersistedToolAuthorization = string | CanonicalToolAuthorization;
export interface PersistedSession { encoding?: 'canonical-ids-v1'; tools: PersistedToolAuthorization[]; revision?: number; deleted?: false; }
export interface PersistedTombstone { revision: number; deleted: true; }
export type PersistedEntry = PersistedSession | PersistedTombstone;
export type PersistedAuthMap = Record<string, PersistedEntry>;
export interface AuthPersistenceOptions { filePath?: string; debounceMs?: number; }

export function getDefaultAuthStoragePath(): string {
  if (platform() === 'win32' && env.APPDATA) return join(env.APPDATA, 'opencode', 'tool-search', 'authorizations.json');
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opencode', 'tool-search', 'authorizations.json');
}

function decodeTool(value: unknown, canonicalEncoding: boolean): string | undefined {
  if (typeof value === 'string') return canonicalEncoding || (!value.startsWith('@canonical:') && !value.endsWith('_ide')) ? value : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 3 && candidate.kind === 'canonical-tool' && candidate.version === 1
    && typeof candidate.canonicalId === 'string' && candidate.canonicalId.length > 0 ? candidate.canonicalId : undefined;
}
function sameTools(a: Set<string> | undefined, b: Set<string> | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.size === b.size && Array.from(a).every((id) => b.has(id));
}
function copyState(state: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map(Array.from(state, ([id, tools]) => [id, new Set(tools)]));
}
function isTombstone(entry: PersistedEntry | undefined): entry is PersistedTombstone { return !!entry && entry.deleted === true && typeof entry.revision === 'number'; }
function isSession(entry: PersistedEntry | undefined): entry is PersistedSession { return !!entry && entry.deleted !== true && Array.isArray(entry.tools); }

export class AuthPersistence {
  private filePath: string;
  private debounceMs: number;
  private timer: NodeJS.Timeout | null = null;
  private pendingState: Map<string, Set<string>> | null = null;
  private pendingRevisions = new Map<string, number>();
  private pendingObservedRevisions = new Map<string, number>();
  private writePromise: Promise<void> | null = null;
  private baseline = new Map<string, Set<string>>();
  private revisions = new Map<string, number>();
  private dirtySessions = new Set<string>();
  private deletedSessions = new Set<string>();
  private logicalRevision = 0;

  constructor(options: AuthPersistenceOptions = {}) { this.filePath = options.filePath ?? getDefaultAuthStoragePath(); this.debounceMs = options.debounceMs ?? 50; }
  private nextRevision(): number { this.logicalRevision = Math.max(this.logicalRevision + 1, Date.now()); return this.logicalRevision; }

  public load(): Map<string, Set<string>> {
    const authorizations = new Map<string, Set<string>>();
    this.revisions.clear();
    if (!existsSync(this.filePath)) { this.baseline = copyState(authorizations); return authorizations; }
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      if (!content.trim()) { this.baseline = authorizations; return authorizations; }
      const data = JSON.parse(content) as PersistedAuthMap;
      if (typeof data !== 'object' || data === null || Array.isArray(data)) { console.warn(`[Tool Search] Warning: Invalid persistence format in ${this.filePath}`); return authorizations; }
      for (const [sessionID, entry] of Object.entries(data)) {
        if (isTombstone(entry)) { this.revisions.set(sessionID, entry.revision); this.logicalRevision = Math.max(this.logicalRevision, entry.revision); continue; }
        if (!isSession(entry)) continue;
        const tools = new Set(entry.tools.map((value) => decodeTool(value, entry.encoding === 'canonical-ids-v1')).filter((id): id is string => id !== undefined));
        if (tools.size > 0) authorizations.set(sessionID, tools);
        if (typeof entry.revision === 'number') { this.revisions.set(sessionID, entry.revision); this.logicalRevision = Math.max(this.logicalRevision, entry.revision); }
      }
    } catch (err) { console.warn(`[Tool Search] Warning: Failed to load authorization state from ${this.filePath}:`, err); }
    this.baseline = copyState(authorizations);
    return authorizations;
  }

  public deleteSession(sessionID: string): void {
    this.deletedSessions.add(sessionID); this.dirtySessions.add(sessionID); this.pendingRevisions.set(sessionID, this.nextRevision());
  }
  public save(authorizations: Map<string, Set<string>>): void {
    for (const [sessionID, tools] of authorizations) {
      if (!sameTools(tools, this.baseline.get(sessionID)) && !this.pendingRevisions.has(sessionID)) {
        this.pendingRevisions.set(sessionID, this.nextRevision());
        this.pendingObservedRevisions.set(sessionID, this.revisions.get(sessionID) ?? 0);
      }
      if (!sameTools(tools, this.baseline.get(sessionID))) this.dirtySessions.add(sessionID);
    }
    this.pendingState = copyState(authorizations);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, this.debounceMs);
  }

  public async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pendingState) { if (this.writePromise) await this.writePromise; return; }
    const stateToWrite = this.pendingState; this.pendingState = null;
    const dirty = new Set(this.dirtySessions); const deleted = new Set(this.deletedSessions);
    const revisions = new Map(this.pendingRevisions);
    const observedRevisions = new Map(this.pendingObservedRevisions);
    const doWrite = async () => {
      try {
        let mergedPayload: PersistedAuthMap = {};
        if (existsSync(this.filePath)) { try { const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')); if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) mergedPayload = parsed; } catch { mergedPayload = {}; } }
        for (const sessionID of dirty) {
          const revision = revisions.get(sessionID) ?? this.nextRevision();
          const existing = mergedPayload[sessionID];
          if (deleted.has(sessionID)) {
            // Deletion wins ties and all older pending writes.
            if (!isTombstone(existing) || existing.revision <= revision) mergedPayload[sessionID] = { deleted: true, revision };
          } else {
            const tools = stateToWrite.get(sessionID);
            if (tools?.size && (!isTombstone(existing) || revision > existing.revision) && (!isTombstone(existing) || (observedRevisions.get(sessionID) ?? 0) >= existing.revision)) mergedPayload[sessionID] = { encoding: 'canonical-ids-v1', tools: Array.from(tools), revision };
            else if (!tools?.size && (!isTombstone(existing) || revision > existing.revision)) mergedPayload[sessionID] = { deleted: true, revision };
          }
        }
        for (const [sessionID, entry] of Object.entries(mergedPayload)) if (!isTombstone(entry) && !isSession(entry)) delete mergedPayload[sessionID];
        const dir = dirname(this.filePath); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const content = JSON.stringify(mergedPayload, null, 2); const tmpPath = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        writeFileSync(tmpPath, content, 'utf-8');
        try { renameSync(tmpPath, this.filePath); } catch { writeFileSync(this.filePath, content, 'utf-8'); try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch {} }
        for (const sessionID of dirty) { const revision = revisions.get(sessionID)!; this.revisions.set(sessionID, revision); this.logicalRevision = Math.max(this.logicalRevision, revision); this.dirtySessions.delete(sessionID); this.deletedSessions.delete(sessionID); this.pendingRevisions.delete(sessionID); this.pendingObservedRevisions.delete(sessionID); }
        for (const [sessionID, tools] of stateToWrite) if (dirty.has(sessionID)) this.baseline.set(sessionID, new Set(tools));
      } catch (err) { console.warn(`[Tool Search] Warning: Failed to write authorization state to ${this.filePath}:`, err); }
    };
    const currentWrite = (this.writePromise ?? Promise.resolve()).then(doWrite); this.writePromise = currentWrite;
    try { await currentWrite; } finally { if (this.writePromise === currentWrite && !this.pendingState) this.writePromise = null; }
    if (this.pendingState) await this.flush();
  }
}
