/**
 * Slow-starting MCP server fixture for the real-opencode slow-server e2e.
 *
 * Mirrors fixtures/race-probe-mcp-server.mjs EXACTLY (same JSON-RPC framing,
 * same tool shape) with ONE deliberate difference: the `initialize` handler
 * delays its response by ~10 seconds (setTimeout before replying), simulating
 * agentmemory-class boot latency (~10.5s real handshake). The plugin's
 * warm-up therefore does NOT complete until ~10s in — long after the model's
 * first system prompt is built.
 *
 * Advertises ONE tool `slow_probe_ping` returning "slow-probe pong".
 */
import { createInterface } from 'node:readline';

const TOOL = {
  name: 'slow_probe_ping',
  description: 'Ping the slow-start probe server',
  inputSchema: { type: 'object', properties: {} },
};

/** ~10s delay to simulate agentmemory-class boot latency. */
const INIT_DELAY_MS = 10_000;

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore malformed input
  }

  const { id, method } = msg;

  // Notifications carry no id — acknowledge silently.
  if (id === undefined) return;

  switch (method) {
    case 'initialize':
      // Deliberately slow: simulate agentmemory-class handshake latency.
      setTimeout(() => {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'slow-probe', version: '1.0.0' },
            },
          }) + '\n',
        );
      }, INIT_DELAY_MS);
      return;
    case 'tools/list':
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [TOOL] } }) + '\n',
      );
      return;
    case 'tools/call':
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'slow-probe pong' }],
          },
        }) + '\n',
      );
      return;
    default:
      // Unknown methods resolve with an error result (per MCP JSON-RPC).
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }) + '\n',
      );
      return;
  }
});
