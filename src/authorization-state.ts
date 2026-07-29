import type { ToolMeta } from './types.js';
import {
  AuthPersistence,
  type PersistedToolAuthorization,
} from './auth-persistence.js';

const CANONICAL_PREFIX = '@canonical:';

function canonicalAuthorization(id: string): PersistedToolAuthorization {
  return { kind: 'canonical-tool', version: 1, canonicalId: id };
}

function authorizationId(value: PersistedToolAuthorization): string | undefined {
  if (typeof value === 'string') {
    return value.startsWith(CANONICAL_PREFIX) || value.endsWith('_ide') ? undefined : value;
  }
  return value.kind === 'canonical-tool' && value.version === 1 ? value.canonicalId : undefined;
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
  private readonly skillPermits = new Set<string>();

  constructor(options: AuthorizationStateOptions) {
    this.alwaysOn = new Set(options.alwaysOn);
    this.resetTools = new Set(options.resetTools);
    this.persistence = options.persistence ?? new AuthPersistence();
    const loaded = this.persistence.load();
    this.authorizations = loaded.authorizations;
    this.lastSeen = loaded.lastSeen;
    let sanitized = false;
    for (const [sessionID, values] of this.authorizations) {
      for (const value of values) {
        const id = authorizationId(value);
        if (id === undefined || id === 'skill') {
          values.delete(value);
          sanitized = true;
        }
      }
      if (values.size === 0) this.authorizations.delete(sessionID);
    }
    if (sanitized) this.persistence.save(this.authorizations, this.lastSeen);
  }

  public registerTool(toolID: string): boolean {
    const deferred = !this.alwaysOn.has(toolID);
    if (deferred) this.deferredTools.add(toolID);
    return deferred;
  }

  public get deferredCount(): number {
    return this.deferredTools.size;
  }

  public grantSkillPermit(sessionID: string | undefined, pattern: string, hits: ToolMeta[]): void {
    if (pattern === '^skill$' && sessionID && hits.some((h) => h.id === 'skill')) {
      this.skillPermits.add(sessionID);
    }
  }

  public beforeToolExecute(toolID: string, sessionID: string | undefined): void {
    if (toolID === 'skill') {
      if (sessionID && this.skillPermits.has(sessionID)) {
        this.skillPermits.delete(sessionID);
        return;
      }
      throw new Error('Every skill call requires a new literal tool_search_regex({ pattern: "^skill$" }) immediately before the call.');
    }
    if (sessionID) this.skillPermits.delete(sessionID);
  }

  public authorize(sessionID: string | undefined, hits: ToolMeta[]): void {
    if (!sessionID) return;
    const genericHits = hits.filter((hit) => hit.id !== 'skill');
    if (genericHits.length === 0) return;
    let authorized = this.authorizations.get(sessionID);
    if (!authorized) {
      authorized = new Set();
      this.authorizations.set(sessionID, authorized);
    }
    for (const hit of genericHits) authorized.add(canonicalAuthorization(hit.id));
    this.persistence.save(this.authorizations, this.lastSeen);
  }

  public requiresReminder(sessionID: string | undefined, executedID: string, canonicalID: string): boolean {
    if (this.alwaysOn.has(executedID) || this.alwaysOn.has(canonicalID)) return false;
    if (!this.deferredTools.has(executedID) && !this.deferredTools.has(canonicalID)) return false;
    if (!sessionID || executedID !== canonicalID) return true;
    const authorized = this.authorizations.get(sessionID);
    return authorized === undefined
      || !Array.from(authorized).some((value) => authorizationId(value) === canonicalID);
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
    this.skillPermits.delete(sessionID);
    this.persistence.deleteSession(sessionID);
    this.persistence.save(this.authorizations, this.lastSeen);
  }
}
