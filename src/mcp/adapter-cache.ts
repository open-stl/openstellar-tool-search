import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { BaseServerConfig } from './types.js';
import type { Transport } from './transport-factory.js';

export interface ServerCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>;
  transport: Transport;
  client: Client;
}

export type ServerConnectionFactory = () => Promise<ServerCacheEntry>;

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;

  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((obj as Record<string, unknown>)[key])}`)
    .join(',');
  return `{${sorted}}`;
}

function serializeServerConfig(server: BaseServerConfig): string {
  const serverRecord = server as unknown as Record<string, unknown>;
  const { name, type, timeout, ...rest } = serverRecord;
  return stableStringify({
    name,
    type,
    timeout: timeout ?? null,
    ...rest,
  });
}

export class AdapterCache {
  private cache = new Map<string, ServerCacheEntry>();
  private inFlight = new Map<string, Promise<ServerCacheEntry>>();

  getServerKey(server: BaseServerConfig): string {
    return serializeServerConfig(server);
  }

  get(key: string): ServerCacheEntry | undefined {
    return this.cache.get(key);
  }

  set(key: string, entry: ServerCacheEntry): void {
    this.cache.set(key, entry);
  }

  async getReady(key: string): Promise<ServerCacheEntry | undefined> {
    const cached = this.cache.get(key);
    if (!cached) return undefined;

    if (await this.isAlive(cached)) {
      return cached;
    }

    this.cache.delete(key);
    await this.closeTransport(cached.transport);
    return undefined;
  }

  async getOrCreate(key: string, create: ServerConnectionFactory): Promise<ServerCacheEntry> {
    const ready = await this.getReady(key);
    if (ready) return ready;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const entry = await create();
        this.cache.set(key, entry);
        return entry;
      } catch (error) {
        const entry = this.cache.get(key);
        if (entry) {
          this.cache.delete(key);
          await this.closeTransport(entry.transport);
        }
        throw error;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  async delete(key: string): Promise<void> {
    this.inFlight.delete(key);
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      await this.closeTransport(entry.transport);
    }
  }

  async clear(): Promise<void> {
    const entries = Array.from(this.cache.values());
    this.cache.clear();
    this.inFlight.clear();
    await Promise.all(
      entries.map(async (entry) => {
        await this.closeTransport(entry.transport);
      }),
    );
  }

  async closeAllTransports(): Promise<void> {
    const entries = Array.from(this.cache.values());
    await Promise.all(
      entries.map(async (entry) => {
        await this.closeTransport(entry.transport);
      }),
    );
  }

  private async closeTransport(transport: Transport): Promise<void> {
    try {
      await Promise.resolve(transport.close());
    } catch {
      // best-effort cleanup
    }
  }

  private async isAlive(entry: ServerCacheEntry): Promise<boolean> {
    try {
      await entry.client.listTools();
      return true;
    } catch {
      return false;
    }
  }
}

export const globalAdapterCache = new AdapterCache();
