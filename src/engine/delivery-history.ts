import { createHash } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import type { ToolMeta } from '../types.js';
import { resolveStorageDir, safeReadJson, safeWriteJson } from '../utils/storage-path.js';
import { normalizeToolId } from '../utils/tool-id.js';

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

export function getDefaultDeliveryHistoryPath(): string {
  return join(resolveStorageDir(), 'session-deliveries.json');
}

export interface DeliveryHistoryPersistenceOptions {
  filePath?: string;
  debounceMs?: number;
  maxSessions?: number;
}

const activeDeliveryHistoryInstances = new Set<DeliveryHistoryPersistence>();
let deliveryExitHandlerRegistered = false;

function registerGlobalDeliveryExitHandler(): void {
  if (deliveryExitHandlerRegistered || typeof process === 'undefined' || typeof process.on !== 'function') return;
  deliveryExitHandlerRegistered = true;
  process.on('beforeExit', () => {
    for (const instance of activeDeliveryHistoryInstances) {
      try {
        instance.flushSync();
      } catch {
        // Ignore exit flush failures
      }
    }
  });
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

    activeDeliveryHistoryInstances.add(this);
    registerGlobalDeliveryExitHandler();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public load(): Map<string, Map<string, string>> {
    const result = new Map<string, Map<string, string>>();

    try {
      const data = safeReadJson<PersistedDeliveryHistory>(this.filePath);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
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
    this.timer?.unref?.();
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
        const raw = safeReadJson<PersistedDeliveryHistory>(this.filePath);
        const payload: PersistedDeliveryHistory =
          raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};

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

        safeWriteJson(this.filePath, payload);
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

      safeWriteJson(this.filePath, payload);
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
  private readonly maxSessions: number;

  constructor(options?: DeliveryHistoryPersistenceOptions | DeliveryHistoryPersistence) {
    if (options && 'save' in options && typeof options.save === 'function') {
      this.persistence = options as DeliveryHistoryPersistence;
      this.maxSessions = 256;
    } else {
      const opts = options as DeliveryHistoryPersistenceOptions | undefined;
      this.persistence = new DeliveryHistoryPersistence(opts);
      this.maxSessions = opts?.maxSessions ?? 256;
    }
    this.history = this.persistence.load();
  }

  private getDeliveredFingerprint(session: Map<string, string>, canonicalID: string): string | undefined {
    const direct = session.get(canonicalID);
    if (direct) return direct;
    const norm = normalizeToolId(canonicalID);
    for (const [key, val] of session.entries()) {
      if (normalizeToolId(key) === norm) return val;
    }
    return undefined;
  }

  private touch(sessionID: string): void {
    const s = this.history.get(sessionID);
    if (s) {
      this.history.delete(sessionID);
      this.history.set(sessionID, s);
    }
  }

  hasDelivered(sessionID: string, canonicalID: string): boolean {
    this.touch(sessionID);
    const session = this.history.get(sessionID);
    if (!session) return false;
    return this.getDeliveredFingerprint(session, canonicalID) !== undefined;
  }

  /** Check if (id, fingerprint) pair is new for this session. */
  isNewDiscovery(sessionID: string, canonicalID: string, fingerprint: string): boolean {
    this.touch(sessionID);
    const session = this.history.get(sessionID);
    if (!session) return true;
    const existing = this.getDeliveredFingerprint(session, canonicalID);
    if (!existing) return true;
    return existing !== fingerprint;
  }

  /** Record that a tool was delivered to the session (rule 34). */
  recordDelivered(sessionID: string, canonicalID: string, fingerprint: string): void {
    let session = this.history.get(sessionID);
    if (session) {
      this.history.delete(sessionID);
    } else {
      session = new Map();
    }
    session.set(canonicalID, fingerprint);
    this.history.set(sessionID, session);

    while (this.history.size > this.maxSessions) {
      const oldest = this.history.keys().next().value;
      if (!oldest) break;
      this.history.delete(oldest);
    }

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

  /** Remove delivery records for specific tools in a session. */
  remove(sessionID: string, canonicalIDs: Iterable<string>): void {
    const session = this.history.get(sessionID);
    if (!session) return;
    const toRemove = new Set(canonicalIDs);
    const toRemoveNorm = new Set(Array.from(canonicalIDs).map(normalizeToolId));
    for (const id of Array.from(session.keys())) {
      if (toRemove.has(id) || toRemoveNorm.has(normalizeToolId(id))) {
        session.delete(id);
      }
    }
    if (session.size === 0) {
      this.history.delete(sessionID);
    }
    this.persistence.save(this.history);
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
