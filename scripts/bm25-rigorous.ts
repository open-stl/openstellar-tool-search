/**
 * Rigorous BM25 parameter optimization for tool search.
 * Uses real fixture tools + comprehensive ground truth from existing tests.
 * Evaluates with MRR, Top-1, Top-5, and NDCG@5.
 */

import { ToolVault } from '../src/vault.js';

// ── Fixture tools (from tests/plugin.test.ts and test fixtures) ──
const TOOLS: Array<{ id: string; desc: string; params: any }> = [
  { id: "read_file",        desc: "Read the contents of a file at the specified path", params: { type: "object", properties: { file_path: { type: "string", description: "Path to the file to read" } } } },
  { id: "write_file",       desc: "Write content to a file, creating it if it does not exist", params: { type: "object", properties: { file_path: { type: "string", description: "Path to write" }, content: { type: "string", description: "Content to write" } } } },
  { id: "edit_file",        desc: "Edit a file by replacing old text with new text", params: { type: "object", properties: { file_path: { type: "string" }, old: { type: "string" }, new: { type: "string" } } } },
  { id: "bash",             desc: "Execute a shell command in the terminal", params: { type: "object", properties: { command: { type: "string", description: "The command to execute" }, timeout: { type: "number", description: "Timeout in ms" } } } },
  { id: "grep",             desc: "Search for a regex pattern across files in the project", params: { type: "object", properties: { pattern: { type: "string", description: "Regex pattern" }, path: { type: "string", description: "Search directory" } } } },
  { id: "glob",             desc: "Find files matching a glob pattern", params: { type: "object", properties: { pattern: { type: "string", description: "Glob pattern like **/*.ts" } } } },
  { id: "read_lints",       desc: "Read and display linter errors from the current workspace", params: {} },
  { id: "git_commit",       desc: "Stage and commit tracked files with a message", params: { type: "object", properties: { message: { type: "string", description: "Commit message" }, amend: { type: "boolean", description: "Amend previous commit" } } } },
  { id: "git_push",         desc: "Push local commits to the remote repository", params: { type: "object", properties: { force: { type: "boolean", description: "Force push" } } } },
  { id: "git_status",       desc: "Show the working tree status", params: {} },
  { id: "github_create_issue", desc: "Create a new GitHub issue in a specified repository", params: { type: "object", properties: { title: { type: "string", description: "Issue title" }, body: { type: "string", description: "Issue body" }, labels: { type: "array", items: { type: "string" }, description: "Labels" }, repo: { type: "string" } } } },
  { id: "github_create_pr", desc: "Open a pull request on GitHub", params: { type: "object", properties: { title: { type: "string" }, base: { type: "string", description: "Base branch" }, head: { type: "string", description: "Head branch" }, repo: { type: "string" } } } },
  { id: "github_list_issues", desc: "List issues in a GitHub repository", params: { type: "object", properties: { repo: { type: "string" }, state: { type: "string", description: "open/closed/all" } } } },
  { id: "figma_get_file",   desc: "Retrieve a Figma file by its key", params: { type: "object", properties: { file_key: { type: "string", description: "The Figma file key" } } } },
  { id: "figma_get_comments", desc: "List comments on a Figma file", params: { type: "object", properties: { file_key: { type: "string" } } } },
  { id: "figma_create_shape", desc: "Create a new shape in a Figma file", params: { type: "object", properties: { file_key: { type: "string" }, shape_type: { type: "string" } } } },
  { id: "context7_resolve_library_id", desc: "Resolve a library name to its Context7 identifier", params: { type: "object", properties: { libraryName: { type: "string" }, query: { type: "string" } } } },
  { id: "context7_query_docs", desc: "Query documentation from Context7 for a specific library", params: { type: "object", properties: { libraryId: { type: "string" }, query: { type: "string" } } } },
  { id: "exa_web_search",   desc: "Search the web for any topic and get clean, ready-to-use content", params: { type: "object", properties: { query: { type: "string" }, numResults: { type: "number" } } } },
  { id: "exa_web_fetch",    desc: "Fetch and extract content from specific URLs", params: { type: "object", properties: { urls: { type: "array", items: { type: "string" } } } } },
  { id: "read_file_safari", desc: "Open and read a web page in Safari and return its content", params: { type: "object", properties: { url: { type: "string", description: "The URL to open" } } } },
  { id: "write_browser_script", desc: "Write and inject a JavaScript snippet into a browser tab", params: { type: "object", properties: { code: { type: "string", description: "JS code to inject" }, url: { type: "string" } } } },
  { id: "agentmemory_memory_save", desc: "Explicitly save an important insight, decision, or pattern to long-term memory", params: { type: "object", properties: { content: { type: "string" }, project: { type: "string" }, concepts: { type: "string" } } } },
  { id: "agentmemory_memory_recall", desc: "Search memory for past observations about a topic using hybrid BM25+vector+graph", params: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } } },
  { id: "agentmemory_memory_diagnose", desc: "Run health checks across all subsystems", params: {} },
  { id: "playwright_browser_take_screenshot", desc: "Take a screenshot of the current browser page", params: { type: "object", properties: { full_page: { type: "boolean" } } } },
  { id: "playwright_browser_navigate", desc: "Navigate the browser to a URL", params: { type: "object", properties: { url: { type: "string" } } } },
  { id: "playwright_browser_click", desc: "Click an element on the page by selector", params: { type: "object", properties: { selector: { type: "string" } } } },
];

// ── Comprehensive ground truth (query → expected tools, prioritized) ──
const GT: Array<{ query: string; expect: string[]; category: string }> = [
  // FILE OPERATIONS
  { query: "read file content",                   expect: ["read_file"], category: "file" },
  { query: "open and view a file",                expect: ["read_file"], category: "file" },
  { query: "save text to disk",                   expect: ["write_file"], category: "file" },
  { query: "write data to file",                  expect: ["write_file"], category: "file" },
  { query: "modify file content",                 expect: ["edit_file"], category: "file" },
  { query: "replace text in code",                expect: ["edit_file"], category: "file" },
  { query: "find files by pattern",               expect: ["glob"], category: "file" },
  { query: "list ts files",                       expect: ["glob"], category: "file" },

  // SHELL
  { query: "run shell command",                   expect: ["bash"], category: "shell" },
  { query: "execute terminal",                    expect: ["bash"], category: "shell" },
  { query: "terminal command",                    expect: ["bash"], category: "shell" },

  // SEARCH
  { query: "search for text in files",            expect: ["grep"], category: "search" },
  { query: "find pattern in code",                expect: ["grep"], category: "search" },
  { query: "regex search codebase",               expect: ["grep"], category: "search" },
  { query: "lint my code",                        expect: ["read_lints"], category: "search" },
  { query: "check for errors",                    expect: ["read_lints"], category: "search" },

  // GIT
  { query: "commit changes",                      expect: ["git_commit"], category: "git" },
  { query: "make a git commit",                   expect: ["git_commit"], category: "git" },
  { query: "push to remote",                      expect: ["git_push"], category: "git" },
  { query: "upload commits",                      expect: ["git_push"], category: "git" },
  { query: "working tree status",                 expect: ["git_status"], category: "git" },
  { query: "show git status",                     expect: ["git_status"], category: "git" },

  // GITHUB
  { query: "create issue on github",              expect: ["github_create_issue"], category: "github" },
  { query: "open github issue",                   expect: ["github_create_issue"], category: "github" },
  { query: "file bug report",                     expect: ["github_create_issue"], category: "github" },
  { query: "pull request github",                 expect: ["github_create_pr"], category: "github" },
  { query: "open PR",                             expect: ["github_create_pr"], category: "github" },
  { query: "create pull request",                 expect: ["github_create_pr"], category: "github" },
  { query: "list repo issues",                    expect: ["github_list_issues"], category: "github" },

  // FIGMA
  { query: "get figma design",                    expect: ["figma_get_file"], category: "figma" },
  { query: "figma file download",                 expect: ["figma_get_file"], category: "figma" },
  { query: "comments on figma",                   expect: ["figma_get_comments"], category: "figma" },
  { query: "add shape to figma",                  expect: ["figma_create_shape"], category: "figma" },
  { query: "create rectangle in design",          expect: ["figma_create_shape"], category: "figma" },

  // CONTEXT7 / DOCS
  { query: "look up library docs",                expect: ["context7_query_docs"], category: "docs" },
  { query: "find documentation for react",        expect: ["context7_resolve_library_id", "context7_query_docs"], category: "docs" },
  { query: "library api reference",               expect: ["context7_resolve_library_id", "context7_query_docs"], category: "docs" },

  // WEB
  { query: "search the internet",                 expect: ["exa_web_search"], category: "web" },
  { query: "web search for information",          expect: ["exa_web_search"], category: "web" },
  { query: "fetch url content",                   expect: ["exa_web_fetch"], category: "web" },
  { query: "download webpage",                    expect: ["exa_web_fetch", "read_file_safari"], category: "web" },

  // BROWSER
  { query: "browser read webpage",                expect: ["read_file_safari"], category: "browser" },
  { query: "open url in safari",                  expect: ["read_file_safari"], category: "browser" },
  { query: "inject javascript browser",           expect: ["write_browser_script"], category: "browser" },
  { query: "run js in page",                      expect: ["write_browser_script"], category: "browser" },
  { query: "take screenshot browser",             expect: ["playwright_browser_take_screenshot"], category: "browser" },
  { query: "capture page image",                  expect: ["playwright_browser_take_screenshot"], category: "browser" },
  { query: "go to website",                       expect: ["playwright_browser_navigate"], category: "browser" },
  { query: "click button on page",                expect: ["playwright_browser_click"], category: "browser" },

  // MEMORY
  { query: "save to memory",                      expect: ["agentmemory_memory_save"], category: "memory" },
  { query: "remember this",                       expect: ["agentmemory_memory_save"], category: "memory" },
  { query: "recall past conversation",            expect: ["agentmemory_memory_recall"], category: "memory" },
  { query: "find in memory",                      expect: ["agentmemory_memory_recall"], category: "memory" },
  { query: "health check system",                 expect: ["agentmemory_memory_diagnose"], category: "memory" },
];

// ── Metrics ──
interface Result { mrr: number; top1: number; top5: number; recall5: number; ndcg5: number }

function dcg(relevances: number[]): number {
  return relevances.reduce((sum, r, i) => sum + (r / Math.log2(i + 2)), 0);
}

function evaluate(k1: number, b: number): Result {
  const vault = new ToolVault({ k1, b, embedding: { enabled: false } });
  for (const t of TOOLS) vault.add(t.id, t.desc, t.params);

  let mrrSum = 0, top1Count = 0, top5Count = 0, recall5Count = 0, ndcgSum = 0;

  for (const { query, expect: expectIds } of GT) {
    const results = vault.queryBM25(query, 5);
    const expectSet = new Set(expectIds);
    let rr = 0;

    // Relevance at each position: 2 = exact match (first in expect list), 1 = acceptable
    const rels: number[] = [];
    for (let i = 0; i < results.length; i++) {
      if (expectSet.has(results[i].id)) {
        rels.push(expectIds[0] === results[i].id ? 2 : 1);
        if (rr === 0) rr = 1 / (i + 1);
      } else {
        rels.push(0);
      }
    }

    mrrSum += rr;
    if (results[0] && expectSet.has(results[0].id)) top1Count++;
    if (results.slice(0, 5).some(r => expectSet.has(r.id))) top5Count++;

    // Recall@5: was ANY expected tool found in top-5?
    if (results.slice(0, 5).some(r => expectSet.has(r.id))) recall5Count++;

    // NDCG@5: ideal DCG has all expected tools at positions 0..n-1 with highest relevance
    const idealRels = expectIds.map((_, i) => i === 0 ? 2 : 1).slice(0, 5);
    const idealDcg = dcg(idealRels);
    ndcgSum += idealDcg > 0 ? dcg(rels) / idealDcg : 1;
  }

  const n = GT.length;
  return {
    mrr: mrrSum / n,
    top1: top1Count / n,
    top5: top5Count / n,
    recall5: recall5Count / n,
    ndcg5: ndcgSum / n,
  };
}

// ── Baseline ──
const base = evaluate(0.9, 0.4);
console.log("╔═══════════════════════════════════════╗");
console.log("║   BM25 PARAMETER OPTIMIZATION         ║");
console.log("╠═══════════════════════════════════════╣");
console.log(`║ Tools: ${TOOLS.length}  |  Queries: ${GT.length}  |  Categories: ${new Set(GT.map(g => g.category)).size}`);
console.log("╚═══════════════════════════════════════╝");
console.log("");
console.log("BASELINE (npm default k1=0.9, b=0.4):");
console.log(`  MRR:     ${(base.mrr*100).toFixed(1)}%`);
console.log(`  Top-1:   ${(base.top1*100).toFixed(1)}%`);
console.log(`  Top-5:   ${(base.top5*100).toFixed(1)}%`);
console.log(`  Recall@5:${(base.recall5*100).toFixed(1)}%`);
console.log(`  NDCG@5:  ${(base.ndcg5*100).toFixed(1)}%`);

// ── Fine grid search (0.05 step) ──
console.log("\nRunning grid search (k1: 0.2–2.0 × b: 0.0–1.0, step=0.05)...");
const all: Array<{ k1: number; b: number } & Result> = [];
for (let k1 = 0.2; k1 <= 2.05; k1 += 0.05) {
  for (let b = 0.0; b <= 1.05; b += 0.05) {
    all.push({ k1: Math.round(k1*100)/100, b: Math.round(b*100)/100, ...evaluate(Math.round(k1*100)/100, Math.round(b*100)/100) });
  }
}

// ── Top by MRR ──
console.log("\n╔═══════════════════════════════════════╗");
console.log("║   TOP 15 BY MRR                       ║");
console.log("╚═══════════════════════════════════════╝");
all.sort((a, b) => b.mrr - a.mrr);
for (let i = 0; i < 15; i++) {
  const r = all[i];
  const mark = r.k1 === 0.9 && r.b === 0.4 ? " ← npm default" : r.k1 === 0.8 && r.b === 0 ? " ← current" : "";
  console.log(`#${String(i+1).padStart(2)}  k1=${String(r.k1.toFixed(2)).padEnd(5)} b=${String(r.b.toFixed(2)).padEnd(5)}  MRR=${(r.mrr*100).toFixed(1)}%  Top1=${(r.top1*100).toFixed(0)}%  Top5=${(r.top5*100).toFixed(0)}%  R@5=${(r.recall5*100).toFixed(0)}%  NDCG=${(r.ndcg5*100).toFixed(1)}%${mark}`);
}

// ── Best per k1 when b=0 ──
const b0 = all.filter(r => r.b === 0).sort((a, b) => b.mrr - a.mrr);
console.log("\n╔═══════════════════════════════════════╗");
console.log("║   BEST AT b=0 (BY k1)                ║");
console.log("╚═══════════════════════════════════════╝");
for (const r of b0.slice(0, 10)) {
  console.log(`  k1=${r.k1.toFixed(2)}  MRR=${(r.mrr*100).toFixed(1)}%  Top1=${(r.top1*100).toFixed(0)}%  NDCG=${(r.ndcg5*100).toFixed(1)}%`);
}

// ── Best per b when k1=optimal ──
const optK1 = all[0].k1;
const byB = all.filter(r => r.k1 === optK1).sort((a, b) => b.mrr - a.mrr);
console.log(`\n╔═══════════════════════════════════════╗`);
console.log(`║   BEST AT k1=${optK1} (BY b)${" ".repeat(20 - String(optK1).length)}║`);
console.log("╚═══════════════════════════════════════╝");
for (const r of byB.slice(0, 10)) {
  console.log(`  b=${r.b.toFixed(2)}   MRR=${(r.mrr*100).toFixed(1)}%  Top1=${(r.top1*100).toFixed(0)}%  NDCG=${(r.ndcg5*100).toFixed(1)}%`);
}

// ── Category breakdown at optimal vs baseline ──
console.log("\n╔═══════════════════════════════════════╗");
console.log("║   CATEGORY BREAKDOWN (MRR)            ║");
console.log("╚═══════════════════════════════════════╝");
const cats = [...new Set(GT.map(g => g.category))].sort();
console.log("Category            base(0.9,0.4)   opt(" + optK1 + ",0.0)    delta");
for (const cat of cats) {
  const catGt = GT.filter(g => g.category === cat);
  // Quick re-evaluate per category
  const vBase = new ToolVault({ k1: 0.9, b: 0.4, embedding: { enabled: false } });
  const vOpt = new ToolVault({ k1: optK1, b: 0, embedding: { enabled: false } });
  for (const t of TOOLS) { vBase.add(t.id, t.desc, t.params); vOpt.add(t.id, t.desc, t.params); }

  let mrrBase = 0, mrrOpt = 0;
  for (const { query, expect } of catGt) {
    const set = new Set(expect);
    const rB = vBase.queryBM25(query, 10);
    const rO = vOpt.queryBM25(query, 10);
    for (let i = 0; i < rB.length; i++) { if (set.has(rB[i].id)) { mrrBase += 1/(i+1); break; } }
    for (let i = 0; i < rO.length; i++) { if (set.has(rO[i].id)) { mrrOpt += 1/(i+1); break; } }
  }
  mrrBase /= catGt.length; mrrOpt /= catGt.length;
  const delta = mrrOpt - mrrBase;
  console.log(`${cat.padEnd(18)}  ${(mrrBase*100).toFixed(1)}%         ${(mrrOpt*100).toFixed(1)}%         ${delta > 0 ? "+" : ""}${(delta*100).toFixed(1)}%`);
}

// ── Final recommendation ──
const best = all[0];
const imp = ((best.mrr - base.mrr) / base.mrr * 100);
console.log("\n╔═══════════════════════════════════════╗");
console.log("║   RECOMMENDATION                      ║");
console.log("╚═══════════════════════════════════════╝");
console.log(`  k1 = ${best.k1}  b = ${best.b}`);
console.log(`  MRR improvement: +${imp.toFixed(1)}%`);
console.log(`  Top-1: ${(base.top1*100).toFixed(0)}% → ${(best.top1*100).toFixed(0)}%`);
console.log(`  NDCG@5: ${(base.ndcg5*100).toFixed(1)}% → ${(best.ndcg5*100).toFixed(1)}%`);
