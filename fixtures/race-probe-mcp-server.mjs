/**
 * Mock MCP server fixture for the real-opencode e2e.
 *
 * A tiny stdio MCP server implemented on the raw JSON-RPC wire protocol
 * (no SDK dependency, no network). It advertises ONE tool —
 * `race_probe_ping` — so the plugin's warm-up has something to find.
 *
 * The handshake is a small state machine over stdin lines:
 *   initialize        -> respond with protocol capabilities
 *   notifications/initialized -> ignore (server is ready)
 *   tools/list        -> return the single tool definition
 *   tools/call        -> return a canned text result
 *
 * Deliberately simple: the real-opencode script drives the REAL opencode
 * CLI with this server as a `local` MCP server; the plugin's warm-up runs a
 * real stdio handshake against it (no fake transports anywhere in this path).
 */
import { createInterface } from 'node:readline';

const TOOL = {
  name: 'race_probe_ping',
  description: 'Ping the race-window e2e probe server',
  inputSchema: { type: 'object', properties: {} },
};

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore malformed input
  }

  const { id, method, params } = msg;

  // Notifications carry no id — acknowledge silently.
  if (id === undefined) return;

  let result;
  switch (method) {
    case 'initialize':
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'race-probe', version: '1.0.0' },
      };
      break;
    case 'tools/list':
      result = { tools: [TOOL] };
      break;
    case 'tools/call':
      result = {
        content: [{ type: 'text', text: 'race-probe pong' }],
      };
      break;
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

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
});
