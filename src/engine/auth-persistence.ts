import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import process, { env } from 'node:process';
import { writeJsonAtomic } from '../utils/atomic-write.js';

interface CanonicalToolAuthorization {
  kind: 'canonical-tool';
  version: 1;
  canonicalId: string;
}

export type PersistedToolAuthorization = string | CanonicalToolAuthorization;

interface PersistedSession {
  tools: PersistedToolAuthorization[];
  lastSeen?: number;
}

type PersistedAuthMap = Record<string, PersistedSession>;

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface AuthPersistenceOptions {
  filePath?: string;
  debounceMs?: number;
  ttlMs?: number;
}

export function getDefaultAuthStoragePath(): string {
  if (platform() === 'win32' && env.LOCALAPPDATA) {
    return join(env.LOCALAPPDATA, 'openstellar', 'tool-search', 'authorizations.json');
  }
  const baseDir = env.XDG_CACHE_HOME || (env.VITEST ? join(tmpdir(), 'tool-search-test-' + process.pid + '-' + Math.random().toString(36).slice(2)) : join(homedir(), '.cache'));
  return join(baseDir, 'openstellar', 'tool-search', 'authorizations.json');
}

function looksLikeSessionEntry(entry: unknown): entry is PersistedSession {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    !Array.isArray(entry) &&
    Array.isArray((entry as PersistedSession).tools)
  );
}

export class AuthPersistence {
  private filePath: string;
  private debounceMs: number;
  private ttlMs: number;
  private timer: NodeJS.Timeout | null = null;
  private pendingState: { authorizations: Map<string, Set<PersistedToolAuthorization>>; lastSeen?: Map<string, number> } | null = null;
  private writePromise: Promise<void> | null = null;
  private knownSessions = new Set<string>();
  private deletedSessions = new Set<string>();

  constructor(options: AuthPersistenceOptions = {}) {
    this.filePath = options.filePath ?? getDefaultAuthStoragePath();
    // Accepted-loss window: 50ms debounce window accepts write loss on sudden SIGKILL/uncaught crash.
    // Flush on process 'beforeExit' ensures clean exit persistence.
    this.debounceMs = options.debounceMs ?? 50;
    this.ttlMs = options.ttlMs ?? THIRTY_DAYS_MS;

    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      process.on('beforeExit', () => {
        this.flushSync();
      });
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public load(): { authorizations: Map<string, Set<PersistedToolAuthorization>>; lastSeen: Map<string, number> } {
    const authorizations = new Map<string, Set<PersistedToolAuthorization>>();
    const lastSeen = new Map<string, number>();

    if (!existsSync(this.filePath)) {
      return { authorizations, lastSeen };
    }

    try {
      const content = readFileSync(this.filePath, 'utf-8');
      if (!content.trim()) {
        return { authorizations, lastSeen };
      }
      const data = JSON.parse(content) as PersistedAuthMap;
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { authorizations, lastSeen };
      }

      const now = Date.now();
      for (const [sessionID, entry] of Object.entries(data)) {
        if (!looksLikeSessionEntry(entry)) {
          continue;
        }

        // Expire sessions older than ttlMs
        if (typeof entry.lastSeen === 'number' && now - entry.lastSeen > this.ttlMs) {
          continue;
        }

        const validTools = entry.tools.filter((t): t is string => typeof t === 'string');
        const structuredTools = entry.tools.filter((t): t is CanonicalToolAuthorization => {
          if (!t || typeof t !== 'object' || Array.isArray(t)) return false;
          const candidate = t as unknown as Record<string, unknown>;
          return Object.keys(candidate).length === 3
            && candidate.kind === 'canonical-tool'
            && candidate.version === 1
            && typeof candidate.canonicalId === 'string'
            && candidate.canonicalId.length > 0;
        });
        authorizations.set(sessionID, new Set<PersistedToolAuthorization>([
          ...validTools,
          ...structuredTools,
        ]));
        if (typeof entry.lastSeen === 'number') {
          lastSeen.set(sessionID, entry.lastSeen);
        }
        this.knownSessions.add(sessionID);
      }
    } catch {
      // Load failure - silent fallback
    }

    return { authorizations, lastSeen };
  }

  public deleteSession(sessionID: string): void {
    this.knownSessions.add(sessionID);
    this.deletedSessions.add(sessionID);
  }

  public save(
    authorizations: Map<string, Set<PersistedToolAuthorization>>,
    lastSeen?: Map<string, number>,
  ): void {
    // Track sessions deleted by this process instance
    for (const sessionID of this.knownSessions) {
      const tools = authorizations.get(sessionID);
      if (!tools || tools.size === 0) {
        this.deletedSessions.add(sessionID);
      }
    }

    // Track active sessions in this process instance
    for (const [sessionID, tools] of authorizations.entries()) {
      if (tools.size > 0) {
        this.knownSessions.add(sessionID);
        this.deletedSessions.delete(sessionID);
      }
    }

    this.pendingState = {
      authorizations: new Map(Array.from(authorizations.entries()).map(([k, v]) => [k, new Set(v)])),
      lastSeen: lastSeen ? new Map(lastSeen) : undefined,
    };

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.debounceMs);
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.pendingState) {
      if (this.writePromise) {
        await this.writePromise;
      }
      return;
    }

    const stateToWrite = this.pendingState;
    this.pendingState = null;

    const doWrite = async () => {
      try {
        let mergedPayload: PersistedAuthMap = {};
        if (existsSync(this.filePath)) {
          try {
            const content = readFileSync(this.filePath, 'utf-8');
            if (content.trim()) {
              const data = JSON.parse(content) as PersistedAuthMap;
              if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
                mergedPayload = data;
              }
            }
          } catch {
            mergedPayload = {};
          }
        }

        // Apply explicit deletions from this process instance
        for (const sessionID of this.deletedSessions) {
          delete mergedPayload[sessionID];
          this.knownSessions.delete(sessionID);
        }
        this.deletedSessions.clear();

        // Overlay/overwrite with this process instance's in-memory entries
        for (const [sessionID, toolsSet] of stateToWrite.authorizations.entries()) {
          const tools: PersistedToolAuthorization[] = Array.from(toolsSet).map((value) => value);
          if (tools.length > 0) {
            const ls = stateToWrite.lastSeen?.get(sessionID) ?? mergedPayload[sessionID]?.lastSeen ?? Date.now();
            mergedPayload[sessionID] = { tools, lastSeen: ls };
          } else {
            delete mergedPayload[sessionID];
          }
        }

        // Validate persisted structure without expiring entries by elapsed time.
        const now = Date.now();
        for (const [sessionID, entry] of Object.entries(mergedPayload)) {
          if (!looksLikeSessionEntry(entry)) {
            delete mergedPayload[sessionID];
          } else if (typeof entry.lastSeen === 'number' && now - entry.lastSeen > this.ttlMs) {
            delete mergedPayload[sessionID];
          }
        }

        writeJsonAtomic(this.filePath, mergedPayload);
      } catch {
        // Write failure - silent fallback
      }
    };

    const currentWrite = (this.writePromise ?? Promise.resolve()).then(doWrite);
    this.writePromise = currentWrite;
    try {
      await currentWrite;
    } finally {
      if (this.writePromise === currentWrite && !this.pendingState) {
        this.writePromise = null;
      }
    }

    if (this.pendingState) {
      await this.flush();
    }
  }

  /** Synchronously flushes any pending data to disk (e.g. on process beforeExit). */
  public flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.pendingState) return;

    const stateToWrite = this.pendingState;
    this.pendingState = null;

    try {
      let mergedPayload: PersistedAuthMap = {};
      if (existsSync(this.filePath)) {
        try {
          const content = readFileSync(this.filePath, 'utf-8');
          if (content.trim()) {
            const data = JSON.parse(content) as PersistedAuthMap;
            if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
              mergedPayload = data;
            }
          }
        } catch {
          mergedPayload = {};
        }
      }

      for (const sessionID of this.deletedSessions) {
        delete mergedPayload[sessionID];
        this.knownSessions.delete(sessionID);
      }
      this.deletedSessions.clear();

      for (const [sessionID, toolsSet] of stateToWrite.authorizations.entries()) {
        const tools: PersistedToolAuthorization[] = Array.from(toolsSet).map((value) => value);
        if (tools.length > 0) {
          const ls = stateToWrite.lastSeen?.get(sessionID) ?? mergedPayload[sessionID]?.lastSeen ?? Date.now();
          mergedPayload[sessionID] = { tools, lastSeen: ls };
        } else {
          delete mergedPayload[sessionID];
        }
      }

      const now = Date.now();
      for (const [sessionID, entry] of Object.entries(mergedPayload)) {
        if (!looksLikeSessionEntry(entry)) {
          delete mergedPayload[sessionID];
        } else if (typeof entry.lastSeen === 'number' && now - entry.lastSeen > this.ttlMs) {
          delete mergedPayload[sessionID];
        }
      }

      writeJsonAtomic(this.filePath, mergedPayload);
    } catch {
      // Write failure - silent fallback
    }
  }
}
