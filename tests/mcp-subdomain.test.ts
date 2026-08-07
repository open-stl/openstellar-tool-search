import { describe, it, expect } from 'vitest';
import { jsonSchemaToZod } from '../src/mcp/json-schema-to-zod.js';
import { TransportFactory } from '../src/mcp/transport-factory.js';

describe('MCP Sub-domain Port', () => {
  it('converts JSON Schema primitives and objects to Zod schema', () => {
    const jsonSchema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
        limit: { type: 'number' },
      },
      required: ['query'],
    };

    const zodSchema = jsonSchemaToZod(jsonSchema);
    expect(zodSchema).toBeDefined();
    expect(zodSchema.shape).toHaveProperty('query');
    expect(zodSchema.shape).toHaveProperty('limit');
  });

  it('registers and connects transport connectors in TransportFactory', async () => {
    const factory = new TransportFactory();
    const mockConnector = {
      connect: async () => ({ close: () => {} }),
    };

    factory.register('mock', mockConnector);
    expect(factory.getSupportedTypes()).toContain('mock');

    const transport = await factory.connect({ name: 'test', type: 'mock' }, {} as any);
    expect(transport).toBeDefined();
    expect(typeof transport.close).toBe('function');
  });
});
