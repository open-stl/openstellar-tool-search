import { inlineLocalReferences } from '../catalog/schema-normalize.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@opencode-ai/plugin';
import type { ToolDefinition } from '../catalog/tool-provider.js';
import type { BaseServerConfig } from './types.js';
import type { Transport } from './transport-factory.js';
import { closeTransport } from './transports/close-transport.js';

const zObj = tool.schema;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ZOD_SCHEMA_DEPTH = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodType = any;

/**
 * Converts a JSON Schema representation into a Zod schema using open-code plugin tool.schema primitives.
 */
export function jsonSchemaToZod(schema: unknown, depth = 0): any {
  if (depth > MAX_ZOD_SCHEMA_DEPTH) {
    return zObj.string();
  }
  if (!schema || typeof schema !== 'object') {
    return zObj.string();
  }

  // Clone to avoid mutation
  const s = { ...(schema as Record<string, unknown>) };

  // Handle type arrays like ["string", "null"] — union all non-null + nullable wrapper
  if (Array.isArray(s.type)) {
    const nonNullTypes = s.type.filter((t) => t !== 'null');
    if (nonNullTypes.length === 0) {
      return zObj.string();
    }
    const isNullable = (s.type as string[]).includes('null');
    if (nonNullTypes.length === 1) {
      const result = createFromType(nonNullTypes[0] as string, s, depth + 1);
      return isNullable ? result.nullable() : result;
    }
    const branches = nonNullTypes.map((t: string) => createFromType(t, s, depth + 1));
    const union = zObj.union(branches as [ZodType, ZodType, ...ZodType[]]);
    return isNullable ? union.nullable() : union;
  }

  // Handle $ref
  if (s.$ref && typeof s.$ref === 'string') {
    return zObj.string();
  }

  // Handle union/intersection types
  if (s.anyOf && Array.isArray(s.anyOf) && s.anyOf.length > 0) {
    const branches = s.anyOf.map((branch: unknown) => jsonSchemaToZod(branch, depth + 1));
    return branches.length === 1 ? branches[0] : zObj.union(branches as [ZodType, ZodType, ...ZodType[]]);
  }
  if (s.oneOf && Array.isArray(s.oneOf) && s.oneOf.length > 0) {
    const branches = s.oneOf.map((branch: unknown) => jsonSchemaToZod(branch, depth + 1));
    return branches.length === 1 ? branches[0] : zObj.union(branches as [ZodType, ZodType, ...ZodType[]]);
  }
  if (s.allOf && Array.isArray(s.allOf) && s.allOf.length > 0) {
    const merged: Record<string, unknown> = { type: 'object', properties: {}, required: [] };
    for (const sub of s.allOf) {
      if (sub && typeof sub === 'object') {
        const subObj = sub as Record<string, unknown>;
        const subProps = subObj.properties;
        if (subProps && typeof subProps === 'object') {
          (merged.properties as Record<string, unknown>) = {
            ...(merged.properties as Record<string, unknown>),
            ...(subProps as Record<string, unknown>),
          };
        }
        const subRequired = subObj.required;
        if (Array.isArray(subRequired)) {
          for (const r of subRequired) {
            if (typeof r === 'string' && !(merged.required as string[]).includes(r)) {
              (merged.required as string[]).push(r);
            }
          }
        }
      }
    }
    return jsonSchemaToZod(merged, depth + 1);
  }

  return createFromType(s.type as string | undefined, s, depth + 1);
}

function createFromType(type: string | undefined, s: Record<string, unknown>, depth = 0): ZodType {
  if (depth > MAX_ZOD_SCHEMA_DEPTH) {
    return zObj.string();
  }

  if (type === 'string') {
    const enumValues = s.enum;
    if (Array.isArray(enumValues) && enumValues.every((v): v is string => typeof v === 'string')) {
      if (enumValues.length === 0) {
        return zObj.string();
      }
      return zObj.enum(enumValues as [string, ...string[]]);
    }
    return zObj.string();
  }

  if (type === 'number' || type === 'integer') {
    return zObj.number();
  }

  if (type === 'boolean') {
    return zObj.boolean();
  }

  if (type === 'null') {
    return zObj.null();
  }

  if (type === 'array') {
    return zObj.array(s.items ? jsonSchemaToZod(s.items, depth + 1) : zObj.string());
  }

  if (type === 'object' || s.properties) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape: Record<string, any> = {};
    const required = new Set((s.required as string[] | undefined) || []);
    const properties = (s.properties as Record<string, unknown> | undefined) || {};

    for (const [key, prop] of Object.entries(properties)) {
      let zodType = jsonSchemaToZod(prop, depth + 1);
      if (!required.has(key)) {
        zodType = zodType.optional();
      }
      shape[key] = zodType;
    }

    return zObj.object(shape);
  }

  return zObj.string().describe(s.description ? String(s.description) : 'Unknown type fallback');
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function extractText(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;

  if (c.type === 'text' && typeof c.text === 'string') {
    return c.text;
  }

  if (c.type === 'image' && typeof c.data === 'string' && typeof c.mimeType === 'string') {
    return `[image: ${c.mimeType}] (base64 data, ${c.data.length} chars)`;
  }

  if (c.type === 'audio' && typeof c.data === 'string' && typeof c.mimeType === 'string') {
    return `[audio: ${c.mimeType}] (base64 data, ${c.data.length} chars)`;
  }

  if (c.type === 'resource' && c.resource && typeof c.resource === 'object') {
    const r = c.resource as Record<string, unknown>;
    const meta = typeof r.uri === 'string' ? r.uri : '';
    if (typeof r.text === 'string') {
      return `[resource] ${meta} — ${r.text}`;
    }
    if (typeof r.blob === 'string') {
      return `[resource] ${meta} (base64 blob, ${r.blob.length} chars)`;
    }
    return `[resource] ${meta || '(no uri)'}`;
  }

  if (c.type === 'resource_link' && typeof c.uri === 'string') {
    return `[resource_link] ${c.uri}`;
  }

  if (typeof c.text === 'string') {
    return c.text;
  }
  return null;
}

export function convertMcpTool(
  mcpTool: McpToolDefinition,
  clientOrGetter: Client | (() => Promise<Client> | Client),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ReturnType<typeof tool> {
  const getClient = typeof clientOrGetter === 'function' ? clientOrGetter : () => clientOrGetter;
  const inlinedSchema = mcpTool.inputSchema ? inlineLocalReferences(mcpTool.inputSchema) : undefined;
  const zodSchema = inlinedSchema
    ? jsonSchemaToZod(inlinedSchema)
    : zObj.object({});

  return tool({
    description: mcpTool.description ?? '',
    args: zodSchema instanceof zObj.ZodObject ? zodSchema.shape : {},
    async execute(args: Record<string, unknown>, _context: unknown) {
      try {
        const client = await Promise.resolve(getClient());
        const result = await client.callTool(
          { name: mcpTool.name, arguments: args },
          CallToolResultSchema,
          { resetTimeoutOnProgress: true, timeout: timeoutMs },
        );

        if (result.isError) {
          const errorParts: string[] = [];
          if (result.content && Array.isArray(result.content)) {
            for (const content of result.content) {
              const text = extractText(content);
              if (text) errorParts.push(text);
            }
          }
          const errorMsg = errorParts.join('\n') || 'Unknown MCP tool error';
          throw new Error(`MCP tool "${mcpTool.name}" error: ${errorMsg}`);
        }

        const textParts: string[] = [];
        if (result.content && Array.isArray(result.content)) {
          for (const content of result.content) {
            const text = extractText(content);
            if (text) textParts.push(text);
          }
        }

        if (textParts.length === 0 && result.structuredContent) {
          return JSON.stringify(result.structuredContent, null, 2);
        }

        return textParts.join('\n\n') || 'No output';
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) {
          throw new Error(`MCP tool "${mcpTool.name}" timed out after ${timeoutMs}ms`);
        }
        throw error;
      }
    },
  });
}

export interface ServerCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>;
  transport: Transport;
  client: Client;
}

type ServerConnectionFactory = () => Promise<ServerCacheEntry>;

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
    await closeTransport(cached.transport);
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
          await closeTransport(entry.transport);
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
      await closeTransport(entry.transport);
    }
  }

  async clear(): Promise<void> {
    const entries = Array.from(this.cache.values());
    this.cache.clear();
    this.inFlight.clear();
    await Promise.allSettled(
      entries.map(async (entry) => {
        await closeTransport(entry.transport);
      }),
    );
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

/**
 * Builds a stable, namespaced tool ID for a server/tool pair.
 *
 * Existing tool names that already carry the server prefix keep their shape;
 * everything else is prefixed with the server name.
 */
export function sanitizeToolId(serverName: string, toolName: string): string {
  const cleanServer = serverName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTool = toolName.toLowerCase();
  if (cleanTool.startsWith(cleanServer + '_') || cleanTool.startsWith(cleanServer + '-')) {
    return toolName;
  }
  return `${serverName}_${toolName}`;
}

interface AdaptedMcpTool {
  definition: ToolDefinition;
  executable: ReturnType<typeof tool>;
}

interface McpToolSource {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Translates a single MCP tool into its openstellar ToolDefinition plus the
 * executable opencode tool backed by an MCP client.
 *
 * The client may be a live client or a getter (function) so the executable
 * can re-resolve the connection through the cache at call time.
 */
export function adaptMcpTool(
  mcpTool: McpToolSource,
  serverName: string,
  deferral: boolean,
  getClient: Client | (() => Promise<Client> | Client),
  timeoutMs: number,
): AdaptedMcpTool {
  const toolId = sanitizeToolId(serverName, mcpTool.name);

  const sanitizedSchema = mcpTool.inputSchema
    ? inlineLocalReferences(mcpTool.inputSchema)
    : undefined;

  return {
    definition: {
      id: toolId,
      description: mcpTool.description ?? '',
      parameters: (sanitizedSchema as Record<string, unknown>) ?? {},
      deferred: deferral,
    },
    executable: convertMcpTool(
      {
        name: mcpTool.name,
        description: mcpTool.description,
        inputSchema: sanitizedSchema as Record<string, unknown>,
      },
      getClient,
      timeoutMs,
    ),
  };
}
