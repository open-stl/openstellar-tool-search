import { ToolVault } from '../src/vault.js';

const TOOLS = [
  { id: "read_file",        desc: "Read the contents of a file at the specified path", params: {} },
  { id: "write_file",       desc: "Write content to a file, creating it if it does not exist", params: {} },
  { id: "bash",             desc: "Execute a shell command in the terminal", params: {} },
  { id: "grep",             desc: "Search for a regex pattern across files in the project", params: {} },
  { id: "read_lints",       desc: "Read and display linter errors from the current workspace", params: {} },
  { id: "git_commit",       desc: "Stage and commit tracked files with a message", params: {} },
  { id: "git_push",         desc: "Push local commits to the remote repository", params: {} },
  { id: "github_create_issue", desc: "Create a new GitHub issue in a specified repository", params: {} },
  { id: "github_create_pr", desc: "Open a pull request on GitHub", params: {} },
  { id: "figma_get_file",   desc: "Retrieve a Figma file by its key", params: {} },
  { id: "figma_get_comments", desc: "List comments on a Figma file", params: {} },
  { id: "read_file_safari", desc: "Open and read a web page in Safari and return its content", params: {} },
  { id: "write_browser_script", desc: "Write and inject a JavaScript snippet into a browser tab", params: {} },
];

const GROUND_TRUTH = [
  { query: "read file content",           expect: ["read_file"] },
  { query: "open and view a file",        expect: ["read_file"] },
  { query: "save text to disk",           expect: ["write_file"] },
  { query: "run shell command",           expect: ["bash"] },
  { query: "search for text in files",    expect: ["grep"] },
  { query: "find pattern in code",        expect: ["grep"] },
  { query: "lint my code",                expect: ["read_lints"] },
  { query: "commit changes",              expect: ["git_commit"] },
  { query: "make a git commit",           expect: ["git_commit"] },
  { query: "create issue on github",      expect: ["github_create_issue"] },
  { query: "open github issue",           expect: ["github_create_issue"] },
  { query: "pull request github",         expect: ["github_create_pr"] },
  { query: "open PR",                     expect: ["github_create_pr"] },
  { query: "get figma design",            expect: ["figma_get_file"] },
  { query: "figma file download",         expect: ["figma_get_file"] },
  { query: "comments on figma",           expect: ["figma_get_comments"] },
  { query: "push to remote",              expect: ["git_push"] },
  { query: "browser read webpage",        expect: ["read_file_safari"] },
  { query: "inject javascript browser",   expect: ["write_browser_script"] },
  { query: "js snippet in page",          expect: ["write_browser_script"] },
];

function evaluate(k1: number, b: number) {
  const vault = new ToolVault({ k1, b, embedding: { enabled: false } });
  for (const t of TOOLS) vault.add(t.id, t.desc, t.params);

  let mrr = 0, top1 = 0, top5 = 0;
  for (const { query, expect: expectIds } of GROUND_TRUTH) {
    const results = vault.queryBM25(query, 10);
    let rr = 0;
    for (let i = 0; i < results.length; i++) {
      if (expectIds.includes(results[i].id)) { rr = 1 / (i + 1); break; }
    }
    mrr += rr;
    if (results[0] && expectIds.includes(results[0].id)) top1++;
    if (results.slice(0, 5).some(r => expectIds.includes(r.id))) top5++;
  }
  const n = GROUND_TRUTH.length;
  return { mrr: mrr / n, top1: top1 / n, top5: top5 / n };
}

const orig = evaluate(0.9, 0.4);
console.log(`Current (k1=0.9, b=0.4): MRR=${orig.mrr.toFixed(4)}  Top1=${(orig.top1*100).toFixed(0)}%  Top5=${(orig.top5*100).toFixed(0)}%`);

const results: Array<{ k1: number; b: number; mrr: number; top1: number; top5: number }> = [];
for (let k1 = 0.1; k1 <= 2.0; k1 += 0.1) {
  for (let b = 0.0; b <= 1.0; b += 0.1) {
    results.push({ k1: Math.round(k1*10)/10, b: Math.round(b*10)/10, ...evaluate(k1, b) });
  }
}
results.sort((a, b) => b.mrr - a.mrr);

console.log("\n=== Top 10 ===");
for (const r of results.slice(0, 10)) {
  const mark = r.k1 === 0.9 && r.b === 0.4 ? " ← current" : "";
  console.log(`k1=${String(r.k1).padEnd(4)} b=${String(r.b).padEnd(4)} MRR=${r.mrr.toFixed(4)}  Top1=${(r.top1*100).toFixed(0)}%${mark}`);
}
console.log("");
const best = results[0];
const impr = ((best.mrr - orig.mrr) / orig.mrr * 100);
console.log(`Optimal: k1=${best.k1}  b=${best.b}  (MRR: ${(best.mrr*100).toFixed(1)}%, improvement: ${impr > 0 ? "+" : ""}${impr.toFixed(1)}%)`);
