import { describe, expect, it, vi, afterEach } from 'vitest';
import { ToolSearchPlugin } from '../src/plugin.js';
import { ToolVault } from '../src/vault.js';

// Track SemanticMatcher instantiation for Bug 6 test.
let matcherInstantiated = false;

// Mock the embedding module so we can detect when SemanticMatcher is created
// (and avoid loading real transformer models during tests).
vi.mock('../src/matcher.js', () => ({
  SemanticMatcher: class {
    constructor() {
      matcherInstantiated = true;
    }
    async open() {}
    async index() {}
    async locate() {
      return new Map();
    }
    get active() {
      return false;
    }
    get entryCount() {
      return 0;
    }
    get fault() {
      return null;
    }
  },
}));

describe('ToolSearchPlugin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports a plugin function', () => {
    expect(typeof ToolSearchPlugin).toBe('function');
  });

  // =========================================================================
  // RED Test 1 — Bug 1: JSON.stringify strips Zod-like schema data
  // =========================================================================
  //
  // The current code does:
  //   vault.add(id, description,
  //     output.parameters ? JSON.parse(JSON.stringify(output.parameters))
  //                       : output.parameters
  //   );
  //
  // JSON.stringify on a Zod schema returns "{}", losing all parameter data.
  // The CORRECT fix is to pass output.parameters directly.
  //
  // This test creates a mock Zod-like object whose internal data is stored in
  // non-enumerable properties (like real Zod schemas). JSON.stringify silently
  // drops those properties. The test asserts that the vault stores the *same
  // reference* as the original object — a guarantee that cloning is skipped.
  // On current code this fails because JSON.parse(JSON.stringify(…)) produces
  // a new empty object, not the original.
  // =========================================================================
  it('stores raw parameters without JSON cloning (Bug 1 - RED)', async () => {
    const addSpy = vi.spyOn(ToolVault.prototype, 'add');
    const hooks = await ToolSearchPlugin({} as any, { alwaysLoad: ['test_tool1'] });

    // Simulate a Zod-object-like schema whose shape data lives in
    // non-enumerable properties — JSON.stringify silently drops them.
    const zodLikeParams: Record<string, unknown> = {};
    Object.defineProperties(zodLikeParams, {
      type: { value: 'object', enumerable: true },
      shape: {
        value: () => ({
          name: { type: 'string', description: 'User name parameter' },
        }),
        enumerable: false, // Non-enumerable — like Zod's internal shape
      },
      _def: {
        value: { typeName: 'ZodObject' },
        enumerable: false,
      },
    });

    await hooks['tool.definition']!(
      { toolID: 'test_tool1' },
      { description: 'A test tool', parameters: zodLikeParams },
    );

    // CORRECT behavior: the vault should store a reference to the original
    // parameter object, NOT a JSON-roundtripped clone.
    // CURRENT BUG: JSON.parse(JSON.stringify(…)) creates a different reference
    // and loses all non-enumerable / Symbol-keyed data.
    expect(addSpy.mock.calls[0][2]).toBe(zodLikeParams);
  });

  // =========================================================================
  // RED Test 2 — Bug 2: stripDescriptions mutates the original schema
  // =========================================================================
  //
  // The current code calls stripDescriptions(output.parameters, deferLabel)
  // which does:
  //   if ('description' in obj && …) { obj.description = label; }
  //
  // This overwrites .description on the original schema object.  Zod stores
  // descriptions internally (not as plain writable properties), so this
  // mutation is both ineffective on real Zod schemas AND destructive to any
  // object that uses a getter or computed description property.
  //
  // The CORRECT fix is to remove the stripDescriptions call entirely.
  //
  // This test creates a schema with a getter-based .description (simulating
  // Zod's internal description storage).  After the hook runs, the getter
  // should still be intact.  On current code it fails because
  // stripDescriptions replaces the getter with the literal string '[d]'.
  // =========================================================================
  it('does not mutate original schema description getter (Bug 2 - RED)', async () => {
    const hooks = await ToolSearchPlugin({} as any, {} as any);

    // Simulate a Zod schema where description is a getter (Zod stores
    // descriptions internally, not as a plain writable own property).
    const descriptionValue = 'Original parameter description';
    const params: Record<string, unknown> = {};
    Object.defineProperty(params, 'description', {
      get() {
        return descriptionValue;
      },
      enumerable: true,
      configurable: true,
    });

    // toolID NOT in alwaysOn → stripDescriptions WILL be called
    await hooks['tool.definition']!(
      { toolID: 'test_bug2' },
      { description: 'A test tool', parameters: params },
    );

    // CORRECT behaviour: the original schema object should NOT be mutated.
    // CURRENT BUG: stripDescriptions replaces the getter wit hthe string '[d]'.
    expect(Object.getOwnPropertyDescriptor(params, 'description')?.get).toBeDefined();
  });

  // =========================================================================
  // RED Test 3 — Bug 6: embedding defaults to enabled
  // =========================================================================
  //
  // The current code does:
  //   embedding: opts.embedding ?? { enabled: true }
  //
  // When no options are passed (opts.embedding is undefined), the fallback
  // `{ enabled: true }` is used.  The ToolVault then creates a
  // SemanticMatcher, which tries to load an embedding model at runtime — and
  // fails because the model is not available.
  //
  // The CORRECT default is { enabled: false }.  Embedding should be opt-in.
  //
  // This test calls the plugin with NO options and asserts that no
  // SemanticMatcher is created (the matcherInstantiated flag stays false).
  // On current code it fails because the default `{ enabled: true }` causes a
  // SemanticMatcher to be instantiated.
  // =========================================================================
  it('defaults to embedding disabled when no options provided (Bug 6 - RED)', async () => {
    matcherInstantiated = false; // Reset from any prior test

    // Call plugin with NO embedding-related options
    await ToolSearchPlugin({} as any, {} as any);

    // CORRECT behaviour: SemanticMatcher should NOT be created.
    // CURRENT BUG: opts.embedding ?? { enabled: true } enables by default.
    expect(matcherInstantiated).toBe(false);
  });
});
