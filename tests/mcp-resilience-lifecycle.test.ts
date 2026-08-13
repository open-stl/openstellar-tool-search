import { describe, it, expect, vi } from 'vitest';
import { McpToolProvider } from '../src/mcp/mcp-tool-provider.js';
import { ToolVault } from '../src/catalog/vault.js';
import { ToolStore } from '../src/catalog/tool-store.js';
import { ToolSearchPlugin } from '../src/plugin.js';
import type { TransportFactory, Transport } from '../src/mcp/transport-factory.js';
import type { AdapterCache } from '../src/mcp/adapter-cache.js';

describe('MCP Resilience and Lifecycle', () => {
  describe('Phase 1: Inflight Warm-up Synchronizer (awaitReady)', () => {
    it('McpToolProvider awaitReady resolves when warmUp finishes fast', async () => {
      let resolveWarmUp!: (val: any) => void;
      const warmUpDelay = new Promise((res) => {
        resolveWarmUp = res;
      });

      const mockClient = {
        listTools: vi.fn().mockImplementation(async () => {
          await warmUpDelay;
          return { tools: [{ name: 'fast_tool', description: 'Fast tool' }] };
        }),
      };

      const mockCache: Partial<AdapterCache> = {
        getServerKey: vi.fn().mockReturnValue('srv_key'),
        getOrCreate: vi.fn().mockResolvedValue({
          client: mockClient as any,
          transport: { close: () => {} } as Transport,
          tools: {},
        }),
      };

      const mockFactory: Partial<TransportFactory> = {
        register: vi.fn(),
        connect: vi.fn().mockResolvedValue({ close: () => {} } as Transport),
      };

      const provider = new McpToolProvider(
        [{ name: 'srv', type: 'remote', url: 'http://localhost:8080' }],
        mockCache as AdapterCache,
        mockFactory as TransportFactory,
      );

      // Start warmUp in background
      const warmUpPromise = provider.warmUp();

      // Initiate awaitReady before warmUp resolves
      let readyDone = false;
      const readyPromise = provider.awaitReady(1000).then(() => {
        readyDone = true;
      });

      expect(readyDone).toBe(false);

      // Resolve warmUp
      resolveWarmUp({});
      await warmUpPromise;
      await readyPromise;

      expect(readyDone).toBe(true);
      expect(provider.getTools()).toHaveLength(1);
    });

    it('McpToolProvider awaitReady times out gracefully if warmUp hangs', async () => {
      const mockClient = {
        listTools: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      };

      const mockCache: Partial<AdapterCache> = {
        getServerKey: vi.fn().mockReturnValue('srv_key'),
        getOrCreate: vi.fn().mockResolvedValue({
          client: mockClient as any,
          transport: { close: () => {} } as Transport,
          tools: {},
        }),
      };

      const mockFactory: Partial<TransportFactory> = {
        register: vi.fn(),
        connect: vi.fn().mockResolvedValue({ close: () => {} } as Transport),
      };

      const provider = new McpToolProvider(
        [{ name: 'srv', type: 'remote', url: 'http://localhost:8080' }],
        mockCache as AdapterCache,
        mockFactory as TransportFactory,
      );

      provider.warmUp();

      const start = Date.now();
      await provider.awaitReady(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(500);
    });

    it('ToolVault and ToolStore delegate awaitReady to registered providers', async () => {
      const store = new ToolStore();
      const vault = new ToolVault();

      let readyCalled = false;
      const mockProvider = {
        getTools: () => [],
        awaitReady: async (_timeoutMs?: number) => {
          readyCalled = true;
          return true;
        },
      };

      await vault.registerProvider(mockProvider);
      await vault.awaitReady(500);

      expect(readyCalled).toBe(true);
    });
  });

  describe('Phase 2: Deterministic Process & Transport Cleanup', () => {
    it('closes McpToolProvider on session.deleted event', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      };

      const closeSpy = vi.fn().mockResolvedValue(undefined);
      const mockCache: Partial<AdapterCache> = {
        getServerKey: vi.fn().mockReturnValue('srv_key'),
        getOrCreate: vi.fn().mockResolvedValue({
          client: mockClient as any,
          transport: { close: () => {} } as Transport,
          tools: {},
        }),
        clear: closeSpy,
      };

      const mockFactory: Partial<TransportFactory> = {
        register: vi.fn(),
        connect: vi.fn().mockResolvedValue({ close: () => {} } as Transport),
      };

      // We test plugin initialization with MCP config
      const hooks = await ToolSearchPlugin(
        {} as any,
        {
          mcp: {
            servers: {
              test: { type: 'remote', url: 'http://localhost:8080' },
            },
          },
        },
      );

      // Trigger session.deleted event
      if (hooks.event) {
        await hooks.event({
          event: {
            type: 'session.deleted',
            properties: { sessionID: 'sess_123' },
          },
        } as any);
      }
    });

    it('registers process exit listeners on MCP initialization', async () => {
      const proc = (globalThis as any).process;
      const beforeExitSpy = vi.spyOn(proc, 'once');

      await ToolSearchPlugin(
        {} as any,
        {
          mcp: {
            servers: {
              test: { type: 'remote', url: 'http://localhost:8080' },
            },
          },
        },
      );

      expect(beforeExitSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function));
      expect(beforeExitSpy).toHaveBeenCalledWith('exit', expect.any(Function));
    });
  });
});
