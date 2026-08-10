import type { ToolMeta } from './types.js';
import { AuthorizationState } from './authorization-state.js';
import { DeliveryHistory, computeFingerprint } from './delivery-history.js';
import { AuthPersistence } from './auth-persistence.js';

export interface SessionToolRegistryOptions {
  alwaysOn: Iterable<string>;
  resetTools: Iterable<string>;
  filePath?: string;
  deliveryHistoryFilePath?: string;
  debounceMs?: number;
  persistence?: AuthPersistence;
}

export type SearchResultKind = 'no-op' | 're-auth' | 'new';

export interface SearchResultProcessing {
  kind: SearchResultKind;
  hits: ToolMeta[];
  responseText: string;
}

function formatHit(r: ToolMeta): string {
  const paramsInfo = r.parameters && typeof r.parameters === 'object' && Object.keys(r.parameters).length > 0
    ? `\n  parameters: ${JSON.stringify(r.parameters)}`
    : '';
  return `${r.id}: ${r.description}${paramsInfo}`;
}

function formatNoOpDiscovery(deliveredHits: ToolMeta[]): string {
  const names = deliveredHits.map((h) => h.id).join(', ');
  return `No new tools discovered. Previously delivered: ${names}.`;
}

/**
 * Unified domain module that owns per-session tool delivery filtering,
 * fingerprint tracking, tool authorization precedence (Rule 41), and
 * compaction resets behind a single seam.
 */
export class SessionToolRegistry {
  private readonly authorization: AuthorizationState;
  private readonly deliveryHistory: DeliveryHistory;

  constructor(options: SessionToolRegistryOptions) {
    const persistence = options.persistence ?? new AuthPersistence({
      filePath: options.filePath,
      debounceMs: options.debounceMs,
    });
    this.authorization = new AuthorizationState({
      alwaysOn: options.alwaysOn,
      resetTools: options.resetTools,
      persistence,
    });
    this.deliveryHistory = new DeliveryHistory({
      filePath: options.deliveryHistoryFilePath ?? (options.filePath ? options.filePath.replace(/\.json$/, '-delivery.json') : undefined),
      debounceMs: options.debounceMs,
    });
  }

  public registerTool(toolID: string): boolean {
    return this.authorization.registerTool(toolID);
  }

  /** Mark a tool as always-on (never deferred, never requires search first). */
  public addAlwaysOn(toolID: string): void {
    this.authorization.addAlwaysOn(toolID);
  }

  public registerProviderTools(tools: import('./tool-provider.js').ToolDefinition[]): void {
    for (const tool of tools) {
      if (tool.deferred !== false) {
        this.authorization.registerTool(tool.id);
      } else {
        this.authorization.addAlwaysOn(tool.id);
      }
    }
  }

  public get deferredCount(): number {
    return this.authorization.deferredCount;
  }

  public isAuthorized(sessionID: string | undefined, canonicalID: string): boolean {
    return this.authorization.isAuthorized(sessionID, canonicalID);
  }

  public requiresReminder(sessionID: string | undefined, executedID: string, canonicalID: string): boolean {
    return this.authorization.requiresReminder(sessionID, executedID, canonicalID);
  }

  public resetIfConfigured(toolID: string, sessionID: string | undefined): boolean {
    return this.authorization.resetIfConfigured(toolID, sessionID);
  }

  public resetAuthorization(sessionID: string | undefined): void {
    this.authorization.resetSession(sessionID);
  }

  public compactSession(sessionID: string | undefined): void {
    if (!sessionID) return;
    this.authorization.resetSession(sessionID);
    this.deliveryHistory.clear(sessionID);
  }

  public deleteSession(sessionID: string | undefined): void {
    if (!sessionID) return;
    this.authorization.resetSession(sessionID);
    this.deliveryHistory.clear(sessionID);
  }

  /**
   * Process discovery hits for a search invocation. Atomically applies delivery
   * suppression, enforces Rule 41 (re-authorizing delivered tools that lost authorization),
   * updates delivery history fingerprints, grants session authorization, and formats the output.
   */
  public processSearchResult(
    sessionID: string | undefined,
    allHits: ToolMeta[],
    maxResults: number,
  ): SearchResultProcessing {
    const sid = sessionID ?? '';
    const { new: newHits, delivered: deliveredHits } = this.deliveryHistory.filterNewDiscoveries(sid, allHits);

    // Rule 41: Authorization takes precedence over Delivery History.
    const newSet = new Set(newHits.map((h) => h.id));
    const toDeliver = allHits.filter(
      (hit) => newSet.has(hit.id) || !this.authorization.isAuthorized(sid, hit.id),
    );

    if (toDeliver.length === 0 && deliveredHits.length > 0) {
      return {
        kind: 'no-op',
        hits: deliveredHits,
        responseText: formatNoOpDiscovery(deliveredHits),
      };
    }

    const limited = toDeliver.slice(0, maxResults);
    this.authorization.authorize(sid, limited);
    for (const hit of limited) {
      this.deliveryHistory.recordDelivered(sid, hit.id, computeFingerprint(hit));
    }

    const kind: SearchResultKind = newHits.length > 0 ? 'new' : 're-auth';
    return {
      kind,
      hits: limited,
      responseText: `Found ${limited.length} tool(s):\n\n${limited.map(formatHit).join('\n\n')}`,
    };
  }
}
