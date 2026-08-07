import type { ToolMeta } from './types.js';
import {
  AuthPersistence,
  type PersistedToolAuthorization,
} from './auth-persistence.js';

const CANONICAL_PREFIX = '@canonical:';

function canonicalAuthorization(id: string): PersistedToolAuthorization {
  return { kind: 'canonical-tool', version: 1, canonicalId: id };
}

/**
 * Returns true for legacy string patterns that should be migrated to the
 * canonical object form by `migrateAuthorization()`.
 */
function isLegacyAuthorization(value: PersistedToolAuthorization): boolean {
  return typeof value === 'string'
    && (value.startsWith(CANONICAL_PREFIX) || value.endsWith('_ide'));
}

/**
 * Extract the canonical tool ID from a persisted authorization value.
 * Returns `undefined` for legacy strings (pre-migration) or unknown shapes.
 */
function canonicalIdOf(value: PersistedToolAuthorization): string | undefined {
  if (typeof value === 'string') {
    if (isLegacyAuthorization(value)) return undefined;
    return value;
  }
  return value.kind === 'canonical-tool' && value.version === 1 ? value.canonicalId : undefined;
}

/**
 * F11 migration: convert legacy string-typed entries to canonical object form.
 * - "@canonical:foo" -> { kind: 'canonical-tool', version: 1, canonicalId: 'foo' }
 * - "foo_ide"        -> { kind: 'canonical-tool', version: 1, canonicalId: 'foo_ide' }
 * - plain string     -> { kind: 'canonical-tool', version: 1, canonicalId: '<string>' }
 */
function migrateAuthorization(value: PersistedToolAuthorization): PersistedToolAuthorization {
  if (typeof value !== 'string') return value;
  let canonicalId: string;
  if (value.startsWith(CANONICAL_PREFIX)) {
    canonicalId = value.slice(CANONICAL_PREFIX.length);
  } else {
    canonicalId = value;
  }
  return { kind: 'canonical-tool', version: 1, canonicalId };
}

export interface AuthorizationStateOptions {
  alwaysOn: Iterable<string>;
  resetTools: Iterable<string>;
  persistence?: AuthPersistence;
}

/** Owns session authorization policy, transitions, and their durable sequencing. */
export class AuthorizationState {
  private readonly alwaysOn: Set<string>;
  private readonly resetTools: Set<string>;
  private readonly deferredTools = new Set<string>();
  private readonly persistence: AuthPersistence;
  private readonly authorizations: Map<string, Set<PersistedToolAuthorization>>;
  private readonly lastSeen: Map<string, number>;

  constructor(options: AuthorizationStateOptions) {
    this.alwaysOn = new Set(options.alwaysOn);
    this.resetTools = new Set(options.resetTools);
    this.persistence = options.persistence ?? new AuthPersistence();
    const loaded = this.persistence.load();
    this.authorizations = loaded.authorizations;
    this.lastSeen = loaded.lastSeen;
    let migrated = false;
    for (const [sessionID, values] of this.authorizations) {
      for (const value of values) {
        if (isLegacyAuthorization(value)) {
          // F11 fix: migrate legacy string entries instead of purging them
          const migratedValue = migrateAuthorization(value);
          values.delete(value);
          values.add(migratedValue);
          migrated = true;
        }
      }
      if (values.size === 0) this.authorizations.delete(sessionID);
    }
    if (migrated) this.persistence.save(this.authorizations, this.lastSeen);
  }

  public registerTool(toolID: string): boolean {
    const deferred = !this.alwaysOn.has(toolID);
    if (deferred) this.deferredTools.add(toolID);
    return deferred;
  }

  public addAlwaysOn(toolID: string): void {
    this.alwaysOn.add(toolID);
    this.deferredTools.delete(toolID);
  }

  public get deferredCount(): number {
    return this.deferredTools.size;
  }

  public authorize(sessionID: string | undefined, hits: ToolMeta[]): void {
    if (!sessionID) return;
    if (hits.length === 0) return;
    let authorized = this.authorizations.get(sessionID);
    if (!authorized) {
      authorized = new Set();
      this.authorizations.set(sessionID, authorized);
    }
    for (const hit of hits) authorized.add(canonicalAuthorization(hit.id));
    this.persistence.save(this.authorizations, this.lastSeen);
  }

  /** Check if a tool is authorized for execution in a session (used by Delivery History). */
  public isAuthorized(sessionID: string | undefined, canonicalID: string): boolean {
    if (!sessionID) return false;
    const authorized = this.authorizations.get(sessionID);
    if (!authorized) return false;
    return Array.from(authorized).some((value) => {
      return canonicalIdOf(value) === canonicalID;
    });
  }

  public requiresReminder(sessionID: string | undefined, executedID: string, canonicalID: string): boolean {
    // F2 fix: only compare executedID and canonicalID against alwaysOn — NOT baseID.
    // Stripping _ide from executedID would falsely exempt foo_ide when the
    // separate tool foo happens to be alwaysOn.
    if (this.alwaysOn.has(executedID) || this.alwaysOn.has(canonicalID)) return false;
    // baseID is still needed for the deferred-tools and authorization checks so
    // that double-cloaked IDs like bash_ide_ide (canonicalID stays 'bash_ide_ide'
    // because resolveAlias only strips one _ide suffix) are still gated when
    // the underlying tool bash is deferred.
    const baseID = executedID.replace(/(_ide)+$/, '');
    const targetID = this.deferredTools.has(canonicalID) ? canonicalID : baseID;
    if (!this.deferredTools.has(executedID) && !this.deferredTools.has(canonicalID) && !this.deferredTools.has(baseID)) return false;
    if (!sessionID) return true;
    const authorized = this.authorizations.get(sessionID);
    return authorized === undefined
      || !Array.from(authorized).some((value) => {
        const id = canonicalIdOf(value);
        return id === targetID || id === canonicalID;
      });
  }

  public resetIfConfigured(toolID: string, sessionID: string | undefined): boolean {
    if (!this.resetTools.has(toolID)) return false;
    this.resetSession(sessionID);
    return true;
  }

  public resetSession(sessionID: string | undefined): void {
    if (!sessionID) return;
    this.authorizations.delete(sessionID);
    this.lastSeen.delete(sessionID);
    this.persistence.deleteSession(sessionID);
    this.persistence.save(this.authorizations, this.lastSeen);
  }
}
