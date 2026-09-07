import { AutoTokenizer } from '@xenova/transformers';
import { bootstrapPluginCore } from '../src/core/bootstrap.js';
import { truncateDescription } from '../src/catalog/schema-normalize.js';
import { execSync } from 'child_process';
import fs from 'fs';

async function measureLiveAllTools() {
  console.log('🔍 Fetching live MCP configuration from opencode.jsonc...');
  
  // Extract real options from opencode config
  const cfgStr = execSync('opencode2 api --standalone GET /api/config', { encoding: 'utf8' });
  const entries = JSON.parse(cfgStr);
  let options = {};
  for (const entry of entries) {
    const plugins = entry.info?.plugins ?? [];
    for (const p of plugins) {
      if (typeof p === 'object' && p.package?.includes('openstellar-tool-search')) {
        options = p.options || {};
        break;
      }
    }
  }

  const serverCount = Object.keys(options?.mcp?.servers || {}).length;
  console.log(`🔌 Found ${serverCount} configured MCP servers. Connecting and pre-warming in parallel...`);

  const ctx = {
    options,
    client: {
      tui: {
        showToast: async () => {}
      }
    }
  };

  const { runtime } = await bootstrapPluginCore(ctx, options, process.cwd());

  const tools = runtime.vault.list();
  console.log(`\n🎉 Successfully loaded ${tools.length} LIVE tools into the vault!`);

  if (tools.length === 0) {
    console.error('❌ Error: No tools loaded from MCP servers.');
    process.exit(1);
  }

  console.log('\n⏳ Loading Xenova/gpt-4o (o200k_base) tokenizer for 100% authentic BPE token measurement...');
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/gpt-4o');

  let totalBaselineTokens = 0;
  let totalDeferredDescOnlyTokens = 0;
  let totalFullVirtualizationTokens = 0;

  let totalDescTokens = 0;
  let totalDeferredDescTokens = 0;

  let totalParamsTokens = 0;

  const perToolStats = [];

  for (const t of tools) {
    const fullTool = {
      type: 'function',
      function: {
        name: t.id,
        description: t.description,
        parameters: t.parameters ?? { type: 'object', properties: {} }
      }
    };

    const deferredDescOnlyTool = {
      type: 'function',
      function: {
        name: t.id,
        description: truncateDescription(t.description, '[deferred]'),
        parameters: t.parameters ?? { type: 'object', properties: {} }
      }
    };

    const fullVirtualizedTool = {
      type: 'function',
      function: {
        name: t.id,
        description: truncateDescription(t.description, '[deferred]'),
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Brief explanation of why you are calling this tool'
            }
          },
          required: ['reason']
        }
      }
    };

    // Use standard compact wire format (no whitespace / newlines) matching real HTTP API transmissions
    const bJson = JSON.stringify(fullTool);
    const dDescJson = JSON.stringify(deferredDescOnlyTool);
    const dFullJson = JSON.stringify(fullVirtualizedTool);

    const bTokens = tokenizer.encode(bJson).length;
    const dDescTokens = tokenizer.encode(dDescJson).length;
    const dFullTokens = tokenizer.encode(dFullJson).length;

    const descTokens = tokenizer.encode(t.description || '').length;
    const truncDescTokens = tokenizer.encode(truncateDescription(t.description, '[deferred]')).length;

    const paramsTokens = tokenizer.encode(JSON.stringify(t.parameters ?? {})).length;

    totalBaselineTokens += bTokens;
    totalDeferredDescOnlyTokens += dDescTokens;
    totalFullVirtualizationTokens += dFullTokens;

    totalDescTokens += descTokens;
    totalDeferredDescTokens += truncDescTokens;
    totalParamsTokens += paramsTokens;

    perToolStats.push({
      id: t.id,
      baselineTokens: bTokens,
      descTokens,
      truncDescTokens,
      paramsTokens,
      savedDescOnly: bTokens - dDescTokens,
      savedFull: bTokens - dFullTokens,
      pctDescOnly: ((bTokens - dDescTokens) / bTokens) * 100,
      pctFull: ((bTokens - dFullTokens) / bTokens) * 100
    });
  }

  // Breakdown by server prefix
  const serverMap = {};
  for (const s of perToolStats) {
    const prefix = s.id.split('_')[0];
    if (!serverMap[prefix]) serverMap[prefix] = { count: 0, baseline: 0, descSaved: 0, fullSaved: 0, descTokens: 0 };
    serverMap[prefix].count++;
    serverMap[prefix].baseline += s.baselineTokens;
    serverMap[prefix].descSaved += s.savedDescOnly;
    serverMap[prefix].fullSaved += s.savedFull;
    serverMap[prefix].descTokens += s.descTokens;
  }

  const descSavedTokens = totalBaselineTokens - totalDeferredDescOnlyTokens;
  const descSavedPct = (descSavedTokens / totalBaselineTokens) * 100;

  const fullSavedTokens = totalBaselineTokens - totalFullVirtualizationTokens;
  const fullSavedPct = (fullSavedTokens / totalBaselineTokens) * 100;

  console.log('\n' + '='.repeat(96));
  console.log(`        AUTHENTIC EMPIRICAL BENCHMARK: ${tools.length} LIVE PRODUCTION TOOLS (NO MOCK)`);
  console.log('='.repeat(96));
  console.log(`📌 TOTAL TOOLS EVALUATED                     : ${tools.length} live tools across all active servers`);
  console.log(`📌 BASELINE PROMPT FOOTPRINT (Every Turn)    : ${totalBaselineTokens.toLocaleString()} tokens (100.0%)`);
  console.log(`   ├── Total Parameter Schema Tokens         : ${totalParamsTokens.toLocaleString()} tokens (${((totalParamsTokens/totalBaselineTokens)*100).toFixed(1)}% of baseline)`);
  console.log(`   └── Total Description Prose Tokens        : ${totalDescTokens.toLocaleString()} tokens (${((totalDescTokens/totalBaselineTokens)*100).toFixed(1)}% of baseline)`);

  console.log('\n' + '-'.repeat(96));
  console.log(`📋 MODE 1: DESCRIPTION-ONLY DEFERRAL (Current v1.0.0 Architecture)`);
  console.log(`   Parameters kept 100% intact; only prose after the first sentence is deferred to [deferred]`);
  console.log('-'.repeat(96));
  console.log(`⚡ Footprint with Description Deferral       : ${totalDeferredDescOnlyTokens.toLocaleString()} tokens / turn`);
  console.log(`💰 Net Tokens Saved Per Turn                 : -${descSavedTokens.toLocaleString()} tokens`);
  console.log(`📉 Net Context Reduction                    : -${descSavedPct.toFixed(2)}% per turn`);
  console.log(`✂️ Description Tokens Cut                    : ${totalDescTokens.toLocaleString()} -> ${totalDeferredDescTokens.toLocaleString()} (-${(totalDescTokens - totalDeferredDescTokens).toLocaleString()} tokens | -${(((totalDescTokens - totalDeferredDescTokens)/totalDescTokens)*100).toFixed(1)}%)`);
  console.log(`💵 50-Turn Session Cumulative Savings        : -${(descSavedTokens * 50).toLocaleString()} tokens`);
  console.log(`💵 100-Turn Session Cumulative Savings       : -${(descSavedTokens * 100).toLocaleString()} tokens`);

  console.log('\n' + '-'.repeat(96));
  console.log(`🚀 MODE 2: FULL VIRTUALIZATION (Description + Parameter Virtualization via Placeholder)`);
  console.log(`   Parameters substituted with { reason: string } until searched; full schema restored on demand`);
  console.log('-'.repeat(96));
  console.log(`⚡ Footprint with Full Virtualization        : ${totalFullVirtualizationTokens.toLocaleString()} tokens / turn`);
  console.log(`💰 Net Tokens Saved Per Turn                 : -${fullSavedTokens.toLocaleString()} tokens`);
  console.log(`📉 Net Context Reduction                    : -${fullSavedPct.toFixed(2)}% per turn`);
  console.log(`💵 50-Turn Session Cumulative Savings        : -${(fullSavedTokens * 50).toLocaleString()} tokens`);
  console.log(`💵 100-Turn Session Cumulative Savings       : -${(fullSavedTokens * 100).toLocaleString()} tokens`);

  console.log('\n' + '='.repeat(96));
  console.log('📊 SERVER-BY-SERVER BREAKDOWN (Real Tools Loaded):');
  console.log('='.repeat(96));
  console.log(' Server Prefix        | Tools | Baseline Tokens | Desc-Only Saved    | Full Virt Saved');
  console.log('-'.repeat(96));
  for (const [prefix, stats] of Object.entries(serverMap).sort((a, b) => b[1].baseline - a[1].baseline)) {
    const descPct = ((stats.descSaved / stats.baseline) * 100).toFixed(1);
    const fullPct = ((stats.fullSaved / stats.baseline) * 100).toFixed(1);
    console.log(` ${prefix.padEnd(20)} | ${stats.count.toString().padStart(5)} | ${stats.baseline.toLocaleString().padStart(15)} | -${stats.descSaved.toLocaleString().padStart(6)} (-${descPct.padStart(4)}%) | -${stats.fullSaved.toLocaleString().padStart(6)} (-${fullPct.padStart(4)}%)`);
  }

  // Top 15 tools with biggest descriptions
  perToolStats.sort((a, b) => b.descTokens - a.descTokens);
  console.log('\n' + '='.repeat(96));
  console.log('🏆 TOP 15 TOOLS WITH LARGEST DESCRIPTION FOOTPRINT:');
  console.log('='.repeat(96));
  for (let i = 0; i < Math.min(15, perToolStats.length); i++) {
    const s = perToolStats[i];
    console.log(`  ${(i + 1).toString().padStart(2)}. ${s.id.padEnd(45)}: Desc ${s.descTokens.toString().padStart(4)} tok -> ${s.truncDescTokens.toString().padStart(3)} tok (Saved -${s.savedDescOnly.toString().padStart(3)} tok | -${s.pctDescOnly.toFixed(1)}%) | Total Base: ${s.baselineTokens} tok`);
  }

  // Save results to json
  const outPath = './docs/research/live-real-tools-measurement.json';
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalTools: tools.length,
    tokenizer: 'Xenova/gpt-4o (o200k_base)',
    baselineTokens: totalBaselineTokens,
    totalDescTokens,
    totalParamsTokens,
    descOnly: {
      deferredTokens: totalDeferredDescOnlyTokens,
      savedTokens: descSavedTokens,
      reductionPct: parseFloat(descSavedPct.toFixed(2)),
      cum50Turns: descSavedTokens * 50,
      cum100Turns: descSavedTokens * 100
    },
    fullVirtualization: {
      virtualizedTokens: totalFullVirtualizationTokens,
      savedTokens: fullSavedTokens,
      reductionPct: parseFloat(fullSavedPct.toFixed(2)),
      cum50Turns: fullSavedTokens * 50,
      cum100Turns: fullSavedTokens * 100
    },
    serverBreakdown: serverMap,
    tools: perToolStats
  }, null, 2));

  console.log(`\n💾 Detailed raw measurement data written to: ${outPath}\n`);
  process.exit(0);
}

measureLiveAllTools().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
