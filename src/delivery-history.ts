import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import process, { env } from 'node:process';
import type { ToolMeta } from './types.js';
import { writeJsonAtomic } from './utils/atomic-write.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveryResult {
  id: string;
  description: string;
  parameters: unknown;
}

interface DeliveryEntry {
  canonicalID: string;
  fingerprint: string;
}

interface PersistedDeliveryHistory {
  [sessionID: string]: DeliveryEntry[];
}

// ---------------------------------------------------------------------------
// Fingerprint for stable tool-definition identity
// ---------------------------------------------------------------------------

/** Recursively sort object keys for stable serialization. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const sorted = Object.keys(value as Record<string, unknown>).sort();
  return `{${sorted.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** Stable hash of (id + description + schema) -- changes when tool definition changes. */
export function computeFingerprint(toolMeta: ToolMeta): string {
  const raw = toolMeta.id + toolMeta.description + stableStringify(toolMeta.parameters ?? {});
  return createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Delivery history persistence
// ---------------------------------------------------------------------------

function getDefaultDeliveryHistoryPath(): string {
  if (platform() === 'win32' && env.APPDATA) {
    return join(env.APPDATA, 'opencode', 'tool-search', 'delivery-history.json');
  }
  const baseDir = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(baseDir, 'opencode', 'tool-search', 'delivery-history.json');
}

interface DeliveryHistoryPersistenceOptions {
  filePath?: string;
  debounceMs?: number;
}

export class DeliveryHistoryPersistence {
  private filePath: string;
  private debounceMs: number;
  private timer: NodeJS.Timeout | null = null;
  private pendingData: Map<string, Map<string, string>> | null = null;
  private trackedSessions = new Set<string>();
  private writePromise: Promise<void> | null = null;

  constructor(options: DeliveryHistoryPersistenceOptions = {}) {
    this.filePath = options.filePath ?? getDefaultDeliveryHistoryPath();
    // Accepted-loss window: 50ms debounce window accepts write loss on sudden SIGKILL/uncaught crash.
    // Flush on process 'beforeExit' ensures clean exit persistence.
    this.debounceMs = options.debounceMs ?? 50;

    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      process.on('beforeExit', () => {
        this.flushSync();
      });
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public load(): Map<string, Map<string, string>> {
    const result = new Map<string, Map<string, string>>();

    if (!existsSync(this.filePath)) {
      return result;
    }

    try {
      const content = readFileSync(this.filePath, 'utf-8');
      if (!content.trim()) {
        return result;
      }
      const data = JSON.parse(content) as PersistedDeliveryHistory;
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return result;
      }

      for (const [sessionID, entries] of Object.entries(data)) {
        if (!Array.isArray(entries)) continue;
        const sessionMap = new Map<string, string>();
        for (const entry of entries) {
          if (
            entry &&
            typeof entry === 'object' &&
            typeof entry.canonicalID === 'string' &&
            typeof entry.fingerprint === 'string'
          ) {
            sessionMap.set(entry.canonicalID, entry.fingerprint);
          }
        }
        if (sessionMap.size > 0) {
          result.set(sessionID, sessionMap);
          this.trackedSessions.add(sessionID);
        }
      }
    } catch {
      // Load failure - silent fallback
    }

    return result;
  }

  public save(history: Map<string, Map<string, string>>): void {
    this.pendingData = new Map(
      Array.from(history.entries()).map(([k, v]) => [k, new Map(v)]),
    );
    for (const key of history.keys()) {
      this.trackedSessions.add(key);
    }

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

    if (!this.pendingData) {
      if (this.writePromise) {
        await this.writePromise;
      }
      return;
    }

    const stateToWrite = this.pendingData;
    this.pendingData = null;

    const doWrite = async () => {
      try {
        let payload: PersistedDeliveryHistory = {};
        if (existsSync(this.filePath)) {
          try {
            const raw = readFileSync(this.filePath, 'utf-8');
            payload = JSON.parse(raw);
          } catch {
            payload = {};
          }
        }
        for (const sessionID of this.trackedSessions) {
          if (!stateToWrite.has(sessionID)) {
            delete payload[sessionID];
          }
        }
        for (const [sessionID, sessionMap] of stateToWrite.entries()) {
          const entries: DeliveryEntry[] = [];
          for (const [canonicalID, fingerprint] of sessionMap.entries()) {
            entries.push({ canonicalID, fingerprint });
          }
          if (entries.length > 0) {
            payload[sessionID] = entries;
          } else {
            delete payload[sessionID];
          }
        }

        writeJsonAtomic(this.filePath, payload);
      } catch {
        // Write failure - silent fallback
      }
    };

    const currentWrite = (this.writePromise ?? Promise.resolve()).then(doWrite);
    this.writePromise = currentWrite;
    try {
      await currentWrite;
    } finally {
      if (this.writePromise === currentWrite && !this.pendingData) {
        this.writePromise = null;
      }
    }

    if (this.pendingData) {
      await this.flush();
    }
  }

  /** Synchronously flushes any pending data to disk (e.g. on process beforeExit). */
  public flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.pendingData) return;

    const stateToWrite = this.pendingData;
    this.pendingData = null;

    try {
      const payload: PersistedDeliveryHistory = {};
      for (const [sessionID, sessionMap] of stateToWrite.entries()) {
        const entries: DeliveryEntry[] = [];
        for (const [canonicalID, fingerprint] of sessionMap.entries()) {
          entries.push({ canonicalID, fingerprint });
        }
      if (entries.length > 0) {
        payload[sessionID] = entries;
      }
    }

    writeJsonAtomic(this.filePath, payload);
  } catch {
      // Write failure - silent fallback
    }
  }
}

// ---------------------------------------------------------------------------
// Delivery history state and authorization-aware delivery tracking
// ---------------------------------------------------------------------------

export class DeliveryHistory {
  private history = new Map<string, Map<string, string>>();
  private persistence: DeliveryHistoryPersistence;

  constructor(options?: DeliveryHistoryPersistenceOptions | DeliveryHistoryPersistence) {
    if (options && 'save' in options && typeof options.save === 'function') {
      this.persistence = options as DeliveryHistoryPersistence;
    } else {
      this.persistence = new DeliveryHistoryPersistence(options as DeliveryHistoryPersistenceOptions | undefined);
    }
    this.history = this.persistence.load();
  }

  /** Check if (id, fingerprint) pair is new for this session. */
  isNewDiscovery(sessionID: string, canonicalID: string, fingerprint: string): boolean {
    const session = this.history.get(sessionID);
    if (!session) return true;
    const existing = session.get(canonicalID);
    if (!existing) return true;
    return existing !== fingerprint;
  }

  /** Record that a tool was delivered to the session (rule 34). */
  recordDelivered(sessionID: string, canonicalID: string, fingerprint: string): void {
    let session = this.history.get(sessionID);
    if (!session) {
      session = new Map();
      this.history.set(sessionID, session);
    }
    session.set(canonicalID, fingerprint);
    this.persistence.save(this.history);
  }

  /**
   * Split hits into new and previously-delivered for a session.
   * Rule 32: filter delivered BEFORE applying result limit.
   */
  filterNewDiscoveries(sessionID: string, hits: ToolMeta[]): { new: DiscoveryResult[]; delivered: DiscoveryResult[] } {
    const newHits: DiscoveryResult[] = [];
    const deliveredHits: DiscoveryResult[] = [];

    for (const hit of hits) {
      const fp = computeFingerprint(hit);
      if (this.isNewDiscovery(sessionID, hit.id, fp)) {
        newHits.push(hit);
      } else {
        deliveredHits.push(hit);
      }
    }

    return { new: newHits, delivered: deliveredHits };
  }

  /** Clear delivery history for a session (rule 42 -- Compaction Reset). */
  clear(sessionID: string): void {
    this.history.delete(sessionID);
    this.persistence.save(this.history);
  }

  /** Expose persistence flush for tests. */
  async flush(): Promise<void> {
    await this.persistence.flush();
  }
}
