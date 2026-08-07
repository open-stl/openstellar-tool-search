import { describe, it, expect, vi } from 'vitest';
import { convertMcpTool } from '../src/mcp/convert-mcp-tool.js';

describe('Dynamic MCP Client Reconnect', () => {
  it('dynamically resolves client instance on tool execution', async () => {
    const mockCallTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'reconnected output' }],
    });

    const clientGetter = vi.fn().mockResolvedValue({
      callTool: mockCallTool,
    });

    const converted = convertMcpTool(
      { name: 'fetch_resource', description: 'Dynamic fetch' },
      clientGetter as any,
    );

    const result = await converted.execute({}, {} as any);
    expect(result).toBe('reconnected output');
    expect(clientGetter).toHaveBeenCalledTimes(1);
    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });
});
