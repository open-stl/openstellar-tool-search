import { tool } from '@opencode-ai/plugin';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { jsonSchemaToZod } from './json-schema-to-zod.js';

const zObj = tool.schema;

const DEFAULT_TIMEOUT_MS = 60_000;

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
  const zodSchema = mcpTool.inputSchema
    ? jsonSchemaToZod(mcpTool.inputSchema)
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
