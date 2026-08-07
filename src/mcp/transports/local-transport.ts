import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Stream } from 'node:stream';
import type { LocalMcpServerConfig } from '../types.js';
import type { Transport, TransportConnector } from '../transport-factory.js';

export const STDERR_CAPTURE_LIMIT_BYTES = 8192;

export class LocalTransportConnector implements TransportConnector<LocalMcpServerConfig> {
  async connect(server: LocalMcpServerConfig, client: Client): Promise<Transport> {
    if (!server.command || server.command.length === 0) {
      throw new Error(`Invalid local server config: ${server.name} - command array is empty`);
    }

    const [cmd, ...args] = server.command;

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    if (server.env) {
      Object.assign(env, server.env);
    }

    const transport = new StdioClientTransport({
      command: cmd,
      args,
      env,
      stderr: server.stderr === 'inherit' ? 'inherit' : 'pipe',
    });
    const stderrTrace = this.captureStderr(transport.stderr);
    const handshakeTimeout = server.timeout ?? (cmd === 'npx' ? 180000 : undefined);

    try {
      await client.connect(transport, handshakeTimeout ? { timeout: handshakeTimeout } : undefined);
      return transport;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const trace = stderrTrace();
      const guidance = ' Enable OPENSTELLAR_MCP_DEBUG=true for diagnostics or set stderr: "inherit" for live child stderr.';
      await this.closeTransport(transport);
      throw new Error(`Failed to connect to local MCP server ${server.name}: ${message}.${guidance}${trace ? `\nStderr trace: ${trace}` : ''}`, { cause: err });
    }
  }

  captureStderr(stream: Stream | null): () => string {
    if (!stream || typeof (stream as Stream).on !== 'function') return () => '';

    const limit = STDERR_CAPTURE_LIMIT_BYTES;
    const retained: Buffer[] = [];
    let retainedBytes = 0;
    let totalBytes = 0;
    let truncated = false;

    const read = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (retainedBytes >= limit) {
        if (totalBytes > limit) truncated = true;
        return;
      }
      const remaining = limit - retainedBytes;
      if (buf.length <= remaining) {
        retained.push(buf);
        retainedBytes += buf.length;
      } else {
        retained.push(buf.subarray(0, remaining));
        retainedBytes += remaining;
      }
      if (retainedBytes >= limit && totalBytes > limit) truncated = true;
    };

    (stream as Stream).on('data', read);

    return () => Buffer.concat(retained, retainedBytes).toString('utf8') + (truncated ? '\n[stderr truncated]' : '');
  }

  private async closeTransport(transport: Transport): Promise<void> {
    try {
      await Promise.resolve(transport.close());
    } catch {
      // best-effort cleanup
    }
  }
}
