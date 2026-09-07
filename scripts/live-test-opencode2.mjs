#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

/**
 * Runs an opencode2 scenario and collects JSON stream events.
 */
async function runOpencode2Scenario(
  scenarioName,
  description,
  prompt,
  validator,
  timeoutMs = 120000
) {
  const start = performance.now();
  const result = {
    scenario: scenarioName,
    description,
    passed: false,
    durationMs: 0,
    toolCalls: [],
    finalText: '',
    error: undefined,
  };

  return new Promise((resolve) => {
    const args = [
      'run',
      '--model',
      'interstellar/balance',
      '--standalone',
      '--auto',
      '--format',
      'json',
      prompt,
    ];

    const proc = spawn('opencode2', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const events = [];
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      result.error = `Timeout after ${timeoutMs}ms`;
      result.durationMs = Math.round(performance.now() - start);
      resolve(result);
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          events.push(parsed);
          if (parsed.type === 'tool_use' && parsed.part) {
            const toolName = parsed.part.tool;
            const input = parsed.part.state?.input ?? parsed.part.state?.rawInput;
            const output = parsed.part.state?.output;
            result.toolCalls.push({ tool: toolName, input, output });
          } else if (parsed.type === 'text' && parsed.part?.text) {
            result.finalText = (result.finalText || '') + parsed.part.text;
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (stdoutBuffer.trim()) {
        try {
          const parsed = JSON.parse(stdoutBuffer.trim());
          events.push(parsed);
        } catch {
          // Ignore trailing non-json
        }
      }

      result.durationMs = Math.round(performance.now() - start);

      if (code !== 0 && !result.error) {
        result.error = `Process exited with code ${code}. Stderr: ${stderrBuffer.slice(0, 300)}`;
      }

      try {
        result.passed = validator(events, result);
      } catch (valErr) {
        result.passed = false;
        result.error = valErr?.message || String(valErr);
      }

      resolve(result);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      result.error = `Process spawn error: ${err.message}`;
      result.durationMs = Math.round(performance.now() - start);
      resolve(result);
    });
  });
}

async function main() {
  console.log('===============================================================');
  console.log('  OpenCode 2.0 Live Integration Test Harness');
  console.log('  Testing @openstellar/tool-search against live `opencode2`');
  console.log('===============================================================\n');

  const results = [];

  // Scenario A: Tool Deferral & Schema Inspection
  console.log('▶ Running Scenario A: Tool Deferral & Schema Inspection...');
  const resA = await runOpencode2Scenario(
    'Scenario A',
    'Tool Deferral & Schema Truncation',
    'Briefly list your discovery tools (such as tool_search and tool_search_regex) and confirm that standard tools are deferred.',
    (events, res) => {
      const text = (res.finalText || '').toLowerCase();
      const mentionsToolSearch = text.includes('tool_search') || text.includes('tool_search_regex');
      const mentionsDeferred = text.includes('deferred');
      return Boolean(mentionsToolSearch && mentionsDeferred);
    }
  );
  results.push(resA);
  console.log(`  Result: ${resA.passed ? '✔ PASSED' : '✖ FAILED'} (${resA.durationMs}ms)`);
  if (resA.error) console.log(`  Error: ${resA.error}`);

  // Scenario B: On-Demand Tool Search Regex & Execution
  console.log('\n▶ Running Scenario B: On-Demand Tool Search Regex & Execution...');
  const resB = await runOpencode2Scenario(
    'Scenario B',
    'On-Demand Tool Search Regex & Execution',
    'Use tool_search_regex to unlock the "shell" tool, then use shell to execute: echo "scenario_b_live_pass"',
    (events, res) => {
      const searchCall = res.toolCalls.find(
        (c) => c.tool === 'tool_search_regex' && (
          (typeof c.input?.pattern === 'string' && c.input.pattern.includes('shell')) ||
          (typeof c.input === 'string' && c.input.includes('shell'))
        )
      );
      const shellCall = res.toolCalls.find((c) => c.tool === 'shell');
      const hasOutputPass = shellCall?.output?.includes('scenario_b_live_pass') || (res.finalText && res.finalText.includes('scenario_b_live_pass'));
      return Boolean(searchCall && shellCall && hasOutputPass);
    }
  );
  results.push(resB);
  console.log(`  Result: ${resB.passed ? '✔ PASSED' : '✖ FAILED'} (${resB.durationMs}ms)`);
  console.log(`  Tool Calls: ${resB.toolCalls.map((c) => c.tool).join(' -> ')}`);
  if (resB.error) console.log(`  Error: ${resB.error}`);

  // Scenario C: Multi-Tool Batch Search
  console.log('\n▶ Running Scenario C: Multi-Tool Batch Regex Search...');
  const resC = await runOpencode2Scenario(
    'Scenario C',
    'Multi-Tool Batch Regex Search',
    'Batch unlock the tools "read" and "glob" using a single tool_search_regex call with regex alternation "^(read|glob)$". Then summarize what tool schemas were returned.',
    (events, res) => {
      const batchSearch = res.toolCalls.find(
        (c) => c.tool === 'tool_search_regex' && (
          (typeof c.input?.pattern === 'string' && (c.input.pattern.includes('read') || c.input.pattern.includes('glob'))) ||
          (typeof c.input === 'string' && (c.input.includes('read') || c.input.includes('glob')))
        )
      );
      const text = (res.finalText || '').toLowerCase();
      return Boolean(batchSearch && (text.includes('read') || text.includes('glob')));
    }
  );
  results.push(resC);
  console.log(`  Result: ${resC.passed ? '✔ PASSED' : '✖ FAILED'} (${resC.durationMs}ms)`);
  console.log(`  Tool Calls: ${resC.toolCalls.map((c) => c.tool).join(' -> ')}`);
  if (resC.error) console.log(`  Error: ${resC.error}`);

  // Scenario D: Semantic Tool Search
  console.log('\n▶ Running Scenario D: Semantic Tool Search Discovery...');
  const resD = await runOpencode2Scenario(
    'Scenario D',
    'Semantic Natural Language Tool Search',
    'Call the tool_search tool with a query to find tools for executing terminal shell commands.',
    (events, res) => {
      const semanticSearch = res.toolCalls.find((c) => c.tool === 'tool_search');
      return Boolean(semanticSearch);
    }
  );
  results.push(resD);
  console.log(`  Result: ${resD.passed ? '✔ PASSED' : '✖ FAILED'} (${resD.durationMs}ms)`);
  console.log(`  Tool Calls: ${resD.toolCalls.map((c) => c.tool).join(' -> ')}`);
  if (resD.error) console.log(`  Error: ${resD.error}`);

  console.log('\n===============================================================');
  console.log('  Live Integration Test Summary');
  console.log('===============================================================');
  let totalPassed = 0;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    console.log(`- [${status}] ${r.scenario}: ${r.description} (${r.durationMs}ms)`);
    if (r.toolCalls.length > 0) {
      console.log(`    Calls: ${r.toolCalls.map((c) => `${c.tool}(${JSON.stringify(c.input)})`).join(', ')}`);
    }
    if (r.passed) totalPassed++;
  }
  console.log(`\nTotal: ${totalPassed}/${results.length} scenarios passed.`);

  if (totalPassed !== results.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal live test harness failure:', err);
  process.exit(1);
});
