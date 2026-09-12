import type { ToolMeta } from '../types.js';
import { DeliveryHistory, computeFingerprint } from './delivery-history.js';
import { normalizeToolId } from '../utils/tool-id.js';

export interface SessionToolRegistryOptions {
  alwaysOn: Iterable<string>;
  resetTools: Iterable<string>;
  filePath?: string;
  deliveryHistoryFilePath?: string;
  deliveryHistoryMaxSessions?: number;
  debounceMs?: number;
}

export type SearchResultKind = 'no-op' | 're-auth' | 'new';

export interface SearchResultProcessing {
  kind: SearchResultKind;
  hits: ToolMeta[];
  responseText: string;
}

function formatHit(r: ToolMeta): string {
  // Search responses carry name + description only. The full parameter schema
  // always lives in the tools array: v1 never truncates parameters, and v2
  // re-injects the full schema after search-time authorization. Returning
  // parameters here would duplicate data in a Sleev-prunable channel.
  return `${r.id}: ${r.description}`;
}

function formatNoOpDiscovery(deliveredHits: ToolMeta[]): string {
  const names = deliveredHits.map((h) => h.id).join(', ');
  return `No new tools discovered. Previously delivered: ${names}.`;
}

/**
 * Unified domain module that owns per-session tool delivery filtering,
 * fingerprint tracking, and compaction resets behind a single seam.
 */
export class SessionToolRegistry {
  private readonly alwaysOn = new Set<string>();
  private readonly resetTools = new Set<string>();
  private readonly deferredTools = new Set<string>();
  private readonly deliveryHistory: DeliveryHistory;

  constructor(options: SessionToolRegistryOptions) {
    for (const id of options.alwaysOn) {
      this.alwaysOn.add(id);
      this.alwaysOn.add(normalizeToolId(id));
    }
    for (const id of options.resetTools) {
      this.resetTools.add(id);
      this.resetTools.add(normalizeToolId(id));
    }
    this.deliveryHistory = new DeliveryHistory({
      filePath: options.deliveryHistoryFilePath ?? (options.filePath ? options.filePath.replace(/\.json$/, '-delivery.json') : undefined),
      debounceMs: options.debounceMs,
      maxSessions: options.deliveryHistoryMaxSessions,
    });
  }

  public registerTool(toolID: string): boolean {
    if (this.isAlwaysOn(toolID)) return false;
    this.deferredTools.add(toolID);
    return true;
  }

  /** Mark a tool as always-on (never deferred, never requires search first). */
  public addAlwaysOn(toolID: string): void {
    this.alwaysOn.add(toolID);
    this.alwaysOn.add(normalizeToolId(toolID));
    this.deferredTools.delete(toolID);
  }

  public registerProviderTools(tools: import('../catalog/tool-provider.js').ToolDefinition[]): void {
    for (const tool of tools) {
      if (tool.deferred !== false) {
        this.registerTool(tool.id);
      } else {
        this.addAlwaysOn(tool.id);
      }
    }
  }

  public get deferredCount(): number {
    return this.deferredTools.size;
  }

  public isAlwaysOn(toolID: string): boolean {
    return this.alwaysOn.has(toolID) || this.alwaysOn.has(normalizeToolId(toolID));
  }

  public isDeferred(toolID: string, isKnownInVault?: boolean): boolean {
    return this.deferredTools.has(toolID) || (!this.isAlwaysOn(toolID) && Boolean(isKnownInVault));
  }

  public isDelivered(sessionID: string | undefined, canonicalID: string): boolean {
    if (!sessionID) return false;
    return this.deliveryHistory.hasDelivered(sessionID, canonicalID);
  }

  public resetIfConfigured(toolID: string, sessionID: string | undefined): boolean {
    const isReset = this.resetTools.has(toolID) || this.resetTools.has(normalizeToolId(toolID));
    if (isReset && sessionID) {
      this.deliveryHistory.clear(sessionID);
    }
    return isReset;
  }

  public compactSession(sessionID: string | undefined): void {
    if (!sessionID) return;
    this.deliveryHistory.clear(sessionID);
  }

  public deleteSession(sessionID: string | undefined): void {
    if (!sessionID) return;
    this.deliveryHistory.clear(sessionID);
  }

  public recordDelivered(sessionID: string, canonicalID: string, fingerprint: string): void {
    this.deliveryHistory.recordDelivered(sessionID, canonicalID, fingerprint);
  }

  /**
   * Process discovery hits for a search invocation. Atomically applies delivery
   * suppression, updates delivery history fingerprints, and formats the output.
   */
  public processSearchResult(
    sessionID: string | undefined,
    allHits: ToolMeta[],
    maxResults: number,
  ): SearchResultProcessing {
    const sid = sessionID ?? '';
    const { new: newHits, delivered: deliveredHits } = this.deliveryHistory.filterNewDiscoveries(sid, allHits);

    if (newHits.length === 0 && deliveredHits.length > 0) {
      return {
        kind: 'no-op',
        hits: deliveredHits,
        responseText: formatNoOpDiscovery(deliveredHits),
      };
    }

    const limited = newHits.slice(0, maxResults);
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
