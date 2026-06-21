import { describe, it, expect } from 'vitest';
import { RankEngine } from '../src/rank.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ToolEntry {
  id: string;
  description: string;
  category: string;
}

interface ComboResult {
  k1: number;
  b: number;
  ndcg5: number;
  ndcg10: number;
  ciLow: number;
  ciHigh: number;
  catNDCG: Record<string, number>;
  catWarnings: string[];
}

/* ------------------------------------------------------------------ */
/*  Evaluation corpus — 5 categories × 22 tools = 110 entries          */
/* ------------------------------------------------------------------ */

const TOOLS: ToolEntry[] = [
  /* ---- git (22) ---- */
  { id: 'git_commit',      description: 'creates a git commit with message and author for the tool',           category: 'git' },
  { id: 'git_branch',      description: 'list, create or delete git branches for the tool',                    category: 'git' },
  { id: 'git_merge',       description: 'merge a branch into the current branch with the tool',                 category: 'git' },
  { id: 'git_rebase',      description: 'reapply commits from one branch onto another using the tool',            category: 'git' },
  { id: 'git_push',        description: 'push local commits to a remote repository via the tool',               category: 'git' },
  { id: 'git_pull',        description: 'fetch from and integrate with a remote repository tool',       category: 'git' },
  { id: 'git_stash',       description: 'stash changes in a dirty working directory tool',              category: 'git' },
  { id: 'git_diff',        description: 'show changes between commits or working tree tool',            category: 'git' },
  { id: 'git_log',         description: 'show commit logs and history tool',                            category: 'git' },
  { id: 'git_status',      description: 'show working tree status and staged changes tool',             category: 'git' },
  { id: 'git_tag',         description: 'create, list or verify git tag objects tool',                  category: 'git' },
  { id: 'git_reset',       description: 'reset current HEAD to a specified state tool',                 category: 'git' },
  { id: 'git_revert',      description: 'revert some existing commits using the tool',                            category: 'git' },
  { id: 'git_cherry_pick', description: 'apply changes from existing commits using the tool',                     category: 'git' },
  { id: 'git_clone',       description: 'clone a repository into a new directory with the tool',                 category: 'git' },
  { id: 'git_fetch',       description: 'download objects and refs from a remote repo tool',                 category: 'git' },
  { id: 'git_blame',       description: 'show what revision last modified each line of this tool',              category: 'git' },
  { id: 'git_checkout',    description: 'switch branches or restore working tree files tool',           category: 'git' },
  { id: 'git_remote',      description: 'manage tracked remote repositories tool',                      category: 'git' },
  { id: 'git_submodule',   description: 'initialize or update submodules in a repository tool',         category: 'git' },
  { id: 'git_config',      description: 'read and set git configuration variables tool',                category: 'git' },
  { id: 'git_worktree',    description: 'manage multiple working trees attached to a repo tool',        category: 'git' },

  /* ---- figma (22) ---- */
  { id: 'figma_create_frame',     description: 'create a new frame or artboard in the canvas tool',         category: 'figma' },
  { id: 'figma_create_shape',     description: 'add a rectangle ellipse or polygon shape tool',            category: 'figma' },
  { id: 'figma_create_text',      description: 'insert a text layer with specified content tool',           category: 'figma' },
  { id: 'figma_edit_fill',        description: 'edit the fill color or gradient of a layer tool',           category: 'figma' },
  { id: 'figma_edit_stroke',      description: 'edit the stroke width color or style tool',                  category: 'figma' },
  { id: 'figma_edit_corner',      description: 'edit corner radius properties of a shape tool',              category: 'figma' },
  { id: 'figma_read_selection',   description: 'read the currently selected nodes and their data tool',     category: 'figma' },
  { id: 'figma_read_styles',      description: 'read all local styles from the document tool',              category: 'figma' },
  { id: 'figma_search_layers',    description: 'search layers by name or type in the hierarchy tool',       category: 'figma' },
  { id: 'figma_search_assets',    description: 'search components and assets in the library tool',          category: 'figma' },
  { id: 'figma_config_grid',      description: 'configure layout grid settings for a frame tool',           category: 'figma' },
  { id: 'figma_config_auto',      description: 'configure auto layout properties for components tool',      category: 'figma' },
  { id: 'figma_deploy_export',    description: 'export selected frames as PNG or SVG files tool',           category: 'figma' },
  { id: 'figma_deploy_prototype', description: 'generate a shareable prototype link for review tool',       category: 'figma' },
  { id: 'figma_debug_nodes',     description: 'debug and inspect node properties and constraints tool',     category: 'figma' },
  { id: 'figma_debug_perf',      description: 'debug rendering performance of the current page tool',       category: 'figma' },
  { id: 'figma_cloud_sync',      description: 'sync local changes to the Figma cloud tool',                category: 'figma' },
  { id: 'figma_cloud_backup',    description: 'backup the current document to cloud storage tool',          category: 'figma' },
  { id: 'figma_commit_version',  description: 'commit a version snapshot to version history tool',          category: 'figma' },
  { id: 'figma_file_open',       description: 'open a Figma file by URL or file key tool',                 category: 'figma' },
  { id: 'figma_file_close',      description: 'close the currently active Figma file tool',                category: 'figma' },
  { id: 'figma_file_duplicate',  description: 'duplicate the current file with a new name tool',            category: 'figma' },

  /* ---- aws (22) ---- */
  { id: 'aws_s3_create_bucket',       description: 'create an S3 bucket for cloud storage tool',                 category: 'aws' },
  { id: 'aws_s3_upload_file',         description: 'upload a file to an S3 bucket tool',                          category: 'aws' },
  { id: 'aws_s3_read_object',         description: 'read an object from S3 by key tool',                          category: 'aws' },
  { id: 'aws_s3_list_objects',        description: 'list objects in an S3 bucket with prefix filter tool',       category: 'aws' },
  { id: 'aws_ec2_create_instance',    description: 'launch a new EC2 compute instance tool',                     category: 'aws' },
  { id: 'aws_ec2_read_instances',     description: 'read EC2 instance metadata and status tool',                 category: 'aws' },
  { id: 'aws_ec2_config_security',    description: 'configure security group rules for EC2 tool',                category: 'aws' },
  { id: 'aws_ec2_deploy_ami',         description: 'deploy a custom AMI image to an EC2 region tool',            category: 'aws' },
  { id: 'aws_lambda_create',          description: 'create a new Lambda function from source tool',              category: 'aws' },
  { id: 'aws_lambda_deploy',          description: 'deploy a Lambda function version to production tool',         category: 'aws' },
  { id: 'aws_lambda_config_env',      description: 'configure environment variables for a Lambda tool',          category: 'aws' },
  { id: 'aws_cloudfront_create',      description: 'create a CloudFront distribution tool',                      category: 'aws' },
  { id: 'aws_cloudfront_config',      description: 'configure CloudFront caching and origin settings tool',      category: 'aws' },
  { id: 'aws_cloudwatch_logs',        description: 'search CloudWatch logs for recent entries tool',             category: 'aws' },
  { id: 'aws_cloudwatch_alarm',       description: 'create or edit CloudWatch alarm thresholds tool',            category: 'aws' },
  { id: 'aws_rds_create_db',          description: 'create an RDS database instance tool',                       category: 'aws' },
  { id: 'aws_rds_read_snapshot',      description: 'read RDS snapshot details and status tool',                  category: 'aws' },
  { id: 'aws_rds_config_backup',      description: 'configure automated backup settings for RDS tool',           category: 'aws' },
  { id: 'aws_iam_create_role',        description: 'create an IAM role with a trust policy tool',                category: 'aws' },
  { id: 'aws_iam_config_policy',      description: 'attach or detach IAM policies from a role tool',             category: 'aws' },
  { id: 'aws_search_resources',       description: 'search across all AWS resources by tag or name tool',        category: 'aws' },
  { id: 'aws_edit_tags',              description: 'edit resource tags across AWS services tool',                category: 'aws' },

  /* ---- database (22) ---- */
  { id: 'db_create_table',         description: 'create a new database table with columns and constraints tool',  category: 'database' },
  { id: 'db_create_index',         description: 'create an index on a table column for performance tool',        category: 'database' },
  { id: 'db_read_query',           description: 'run a SELECT query against the database tool',                  category: 'database' },
  { id: 'db_read_explain',         description: 'read the query execution plan for optimization tool',           category: 'database' },
  { id: 'db_edit_row',             description: 'update rows matching a WHERE condition tool',                   category: 'database' },
  { id: 'db_edit_schema',          description: 'alter table schema add or rename columns tool',                 category: 'database' },
  { id: 'db_deploy_migration',     description: 'apply pending database migrations in order tool',               category: 'database' },
  { id: 'db_deploy_seed',          description: 'seed the database with initial data from file tool',            category: 'database' },
  { id: 'db_search_fulltext',      description: 'run a full-text search query across multiple tables tool',      category: 'database' },
  { id: 'db_search_foreign',       description: 'search for foreign key references to a given record tool',      category: 'database' },
  { id: 'db_config_connection',    description: 'configure database connection pool settings tool',              category: 'database' },
  { id: 'db_config_replication',   description: 'configure read replica or replication settings tool',           category: 'database' },
  { id: 'db_cloud_backup',         description: 'backup the database to cloud storage tool',                     category: 'database' },
  { id: 'db_cloud_restore',        description: 'restore a database from cloud backup tool',                     category: 'database' },
  { id: 'db_commit_ddl',           description: 'commit pending DDL changes as a versioned migration tool',      category: 'database' },
  { id: 'db_commit_transaction',   description: 'commit the current open transaction tool',                      category: 'database' },
  { id: 'db_debug_locks',          description: 'debug active locks and blocked queries tool',                   category: 'database' },
  { id: 'db_debug_performance',    description: 'debug slow queries with index usage analysis tool',             category: 'database' },
  { id: 'db_file_import',          description: 'import data from CSV or JSON file into a table tool',           category: 'database' },
  { id: 'db_file_export',          description: 'export query results to a CSV file tool',                       category: 'database' },
  { id: 'db_read_backup_list',     description: 'list available backups and their sizes tool',                   category: 'database' },
  { id: 'db_read_table_stats',     description: 'read table statistics row counts and sizes tool',               category: 'database' },

  /* ---- vscode (22) ---- */
  { id: 'vscode_file_open',          description: 'open a file in the editor by path tool',                      category: 'vscode' },
  { id: 'vscode_file_create',        description: 'create a new file in the workspace tool',                     category: 'vscode' },
  { id: 'vscode_file_delete',        description: 'delete a file from the workspace tool',                       category: 'vscode' },
  { id: 'vscode_edit_replace',       description: 'find and replace text across the editor tool',                category: 'vscode' },
  { id: 'vscode_edit_format',        description: 'format the current document with default formatter tool',     category: 'vscode' },
  { id: 'vscode_edit_multicursor',   description: 'add multiple cursors for simultaneous editing tool',          category: 'vscode' },
  { id: 'vscode_search_files',       description: 'search files by name pattern in the workspace tool',          category: 'vscode' },
  { id: 'vscode_search_text',        description: 'search for text across all files in workspace tool',          category: 'vscode' },
  { id: 'vscode_deploy_extension',   description: 'install or update a VS Code extension tool',                  category: 'vscode' },
  { id: 'vscode_deploy_settings',    description: 'deploy workspace settings from a JSON file tool',             category: 'vscode' },
  { id: 'vscode_config_theme',       description: 'change the editor color theme tool',                          category: 'vscode' },
  { id: 'vscode_config_keybindings', description: 'configure keyboard shortcuts tool',                           category: 'vscode' },
  { id: 'vscode_config_language',    description: 'configure language-specific editor settings tool',            category: 'vscode' },
  { id: 'vscode_debug_start',        description: 'start a debug session for the active file tool',              category: 'vscode' },
  { id: 'vscode_debug_breakpoint',   description: 'set or remove a breakpoint in the editor tool',               category: 'vscode' },
  { id: 'vscode_debug_step',         description: 'step over to the next line in debug mode tool',               category: 'vscode' },
  { id: 'vscode_read_outline',       description: 'read the document symbol outline tool',                       category: 'vscode' },
  { id: 'vscode_read_diagnostics',   description: 'read all diagnostics in the current file tool',               category: 'vscode' },
  { id: 'vscode_read_git_blame',    description: 'read git blame annotations for the open file tool',           category: 'vscode' },
  { id: 'vscode_cloud_sync',        description: 'sync workspace settings and extensions to the cloud tool',     category: 'vscode' },
  { id: 'vscode_cloud_restore',     description: 'restore workspace configuration from cloud backup tool',      category: 'vscode' },
  { id: 'vscode_create_snippet',    description: 'create a new code snippet in the user snippets file tool',    category: 'vscode' },

  /* ---- CJK entries for tokenizer validation ---- */
  { id: 'git_커밋',           description: 'git 저장소에 변경 사항을 커밋합니다',          category: 'git' },
  { id: 'figma_図形_作成',    description: 'フィグマで新しい図形を作成する',               category: 'figma' },
  { id: 'aws_クラウド_設定',   description: 'AWSクラウド環境の設定を変更する',              category: 'aws' },
  { id: 'vscode_検索',        description: 'VSCodeでファイル内容を検索する',              category: 'vscode' },
  { id: 'db_データ_検索',      description: 'データベースでレコードを検索する',             category: 'database' },
];

/* ------------------------------------------------------------------ */
/*  Benchmark queries                                                  */
/* ------------------------------------------------------------------ */

const QUERIES = ['commit', 'file', 'create', 'read', 'deploy', 'search', 'cloud', 'edit', 'config', 'debug'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function queryAppearsIn(text: string, query: string): boolean {
  return text.includes(query);
}

function isRelevant(tool: ToolEntry, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/);
  return terms.some((t) => queryAppearsIn(tool.id.toLowerCase(), t) || queryAppearsIn(tool.description.toLowerCase(), t));
}

function ndcg(ranked: ToolEntry[], query: string, k: number): number {
  const relevant = ranked.slice(0, k);
  const ideal = [...relevant].sort((a, b) => {
    const ra = isRelevant(a, query) ? 1 : 0;
    const rb = isRelevant(b, query) ? 1 : 0;
    return rb - ra;
  });

  const dcg = relevant.reduce((sum, item, i) => {
    const rel = isRelevant(item, query) ? 1 : 0;
    return sum + rel / Math.log2(i + 2);
  }, 0);

  const idcg = ideal.reduce((sum, item, i) => {
    const rel = isRelevant(item, query) ? 1 : 0;
    return sum + rel / Math.log2(i + 2);
  }, 0);

  return idcg === 0 ? 0 : dcg / idcg;
}

function bootstrapCI(values: number[], samples: number): [number, number] {
  const means: number[] = [];
  const n = values.length;
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += values[Math.floor(Math.random() * n)];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(samples * 0.025)];
  const hi = means[Math.floor(samples * 0.975)];
  return [lo, hi];
}

/* ------------------------------------------------------------------ */
/*  Grid search                                                        */
/* ------------------------------------------------------------------ */

const K1_VALUES = [0.5, 0.75, 1.0, 1.25, 1.5];
const B_VALUES = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const CATEGORIES = ['git', 'figma', 'aws', 'database', 'vscode'];
const BOOTSTRAP_SAMPLES = 1000;

function evaluate(k1: number, b: number): ComboResult {
  /* ---- global evaluation ---- */
  const engine = new RankEngine<ToolEntry>(k1, b);
  engine.feed(TOOLS, (t) => [t.id, t.description]);

  const perQueryNDCG5: number[] = [];
  const perQueryNDCG10: number[] = [];

  for (const q of QUERIES) {
    const hits = engine.query(q, 10);
    const ranked = hits.map((h) => h.item);
    perQueryNDCG5.push(ndcg(ranked, q, 5));
    perQueryNDCG10.push(ndcg(ranked, q, 10));
  }

  const avgNDCG5 = perQueryNDCG5.reduce((a, b) => a + b, 0) / perQueryNDCG5.length;
  const avgNDCG10 = perQueryNDCG10.reduce((a, b) => a + b, 0) / perQueryNDCG10.length;
  const [ciLow, ciHigh] = bootstrapCI(perQueryNDCG5, BOOTSTRAP_SAMPLES);

  /* ---- per-category NDCG@5 ---- */
  const catNDCG: Record<string, number> = {};
  const catWarnings: string[] = [];

  for (const cat of CATEGORIES) {
    const catTools = TOOLS.filter((t) => t.category === cat);
    const catEngine = new RankEngine<ToolEntry>(k1, b);
    catEngine.feed(catTools, (t) => [t.id, t.description]);

    const catScores: number[] = [];
    for (const q of QUERIES) {
      const hits = catEngine.query(q, 5);
      const ranked = hits.map((h) => h.item);
      catScores.push(ndcg(ranked, q, 5));
    }
    catNDCG[cat] = catScores.reduce((a, b) => a + b, 0) / catScores.length;
  }

  return { k1, b, ndcg5: avgNDCG5, ndcg10: avgNDCG10, ciLow, ciHigh, catNDCG, catWarnings };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('BM25 Grid Search', () => {
  /* ---- CJK tokenizer-awareness test ---- */
  it('tokenizes CJK descriptions via breakWords (\\p{L} aware)', () => {
    // Use a focused set of CJK entries — no cross-contamination from other tools
    const cjkTools: ToolEntry[] = [
      { id: 'git_커밋',         description: 'git 저장소에 변경 사항을 커밋합니다',          category: 'git' },
      { id: 'figma_図形_作成',  description: 'フィグマで新しい図形を作成する',               category: 'figma' },
      { id: 'vscode_検索',      description: 'VSCodeでファイル内容を検索する',              category: 'vscode' },
      { id: 'db_데이터_검색',     description: '데이터베이스에서 레코드를 검색합니다',             category: 'database' },
    ];

    const engine = new RankEngine<ToolEntry>(1.0, 0.4);
    engine.feed(cjkTools, (t) => [t.id, t.description]);

    // Korean: '커밋' token matches id 'git_커밋' → 'git', '커밋'
    const krResults = engine.query('커밋', 10);
    console.log('[CJK] query "커밋":', krResults.map(r => ({ id: r.item.id, score: r.score })));
    expect(krResults.length).toBeGreaterThanOrEqual(1);
    expect(krResults.map(r => r.item.id)).toContain('git_커밋');

    // Japanese: '図形' token matches id 'figma_図形_作成' → 'figma', '図形', '作成'
    const jpResults = engine.query('図形', 10);
    console.log('[CJK] query "図形":', jpResults.map(r => ({ id: r.item.id, score: r.score })));
    expect(jpResults.length).toBeGreaterThanOrEqual(1);
    expect(jpResults.map(r => r.item.id)).toContain('figma_図形_作成');

    // Korean '검색': token from id 'db_데이터_검색' → 'db', '데이터', '검색'
    const searchResults = engine.query('검색', 10);
    console.log('[CJK] query "검색":', searchResults.map(r => ({ id: r.item.id, score: r.score })));
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults.map(r => r.item.id)).toContain('db_데이터_검색');
  });

  /* ---- Grid search / results ---- */
  it('evaluates all (k1, b) combinations and prints results', () => {
    const results: ComboResult[] = [];

    for (const k1 of K1_VALUES) {
      for (const b of B_VALUES) {
        const r = evaluate(k1, b);
        results.push(r);
      }
    }

    /* ---- Fairness: compute best per-category across all combos ---- */
    const bestPerCat: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      bestPerCat[cat] = Math.max(...results.map((r) => r.catNDCG[cat]));
    }

    for (const r of results) {
      for (const cat of CATEGORIES) {
        const loss = bestPerCat[cat] - r.catNDCG[cat];
        if (loss > 0.05) {
          r.catWarnings.push(`${cat} -${(loss * 100).toFixed(1)}%`);
        }
      }
    }

    /* ---- Print markdown table ---- */
    const header = `| k1 | b | NDCG@5 | NDCG@10 | CI(95%) low | CI(95%) high | Warnings |`;
    const sep = `|---|---|---|---|---|---|---|`;
    const rows = results.map((r) => {
      const catWarn = r.catWarnings.length > 0 ? r.catWarnings.join(', ') : '—';
      return `| ${r.k1.toFixed(2)} | ${r.b.toFixed(1)} | ${r.ndcg5.toFixed(4)} | ${r.ndcg10.toFixed(4)} | ${r.ciLow.toFixed(4)} | ${r.ciHigh.toFixed(4)} | ${catWarn} |`;
    });

    console.log('\n### BM25 Grid Search Results\n');
    console.log(header);
    console.log(sep);
    for (const row of rows) console.log(row);
    console.log();

    /* ---- Per-category breakdown ---- */
    const catHeader = `| k1 | b | git | figma | aws | database | vscode |`;
    const catSep = `|---|---|---|---|---|---|---|`;
    console.log('### Per-Category NDCG@5\n');
    console.log(catHeader);
    console.log(catSep);
    for (const r of results) {
      const vals = CATEGORIES.map((c) => r.catNDCG[c].toFixed(4));
      console.log(`| ${r.k1.toFixed(2)} | ${r.b.toFixed(1)} | ${vals.join(' | ')} |`);
    }
    console.log();

    /* ---- console.table for raw data ---- */
    const tableData = results.map((r) => ({
      k1: r.k1,
      b: r.b,
      ndcg5: +r.ndcg5.toFixed(4),
      ndcg10: +r.ndcg10.toFixed(4),
      ciLow: +r.ciLow.toFixed(4),
      ciHigh: +r.ciHigh.toFixed(4),
      warnings: r.catWarnings.length,
    }));
    console.table(tableData);

    /* ---- Verify we got 35 results ---- */
    expect(results.length).toBe(35);

    /* ---- Sanity checks ---- */
    for (const r of results) {
      expect(r.ndcg5).toBeGreaterThanOrEqual(0);
      expect(r.ndcg5).toBeLessThanOrEqual(1);
      expect(r.ndcg10).toBeGreaterThanOrEqual(0);
      expect(r.ndcg10).toBeLessThanOrEqual(1);
      expect(r.ciLow).toBeLessThanOrEqual(r.ciHigh);
    }

    /* ---- Store results for the optimal-params test ---- */
    (describe as unknown as Record<string, unknown>).__gridResults = results;
    (describe as unknown as Record<string, unknown>).__bestPerCat = bestPerCat;
  });
});

/* ---- Optimal params test (skipped by default) ---- */
it.skip('optimal params', () => {
  const results = (describe as unknown as Record<string, unknown>).__gridResults as ComboResult[] | undefined;
  const bestPerCat = (describe as unknown as Record<string, unknown>).__bestPerCat as Record<string, number> | undefined;

  if (!results || !bestPerCat) {
    console.log('No grid results available. Run the grid search test first.');
    return;
  }

  /* Find best combo: highest NDCG@5 with no category >5% loss */
  const viable = results.filter((r) => r.catWarnings.length === 0);
  viable.sort((a, b) => b.ndcg5 - a.ndcg5);

  if (viable.length === 0) {
    console.log('No parameter combo satisfies all fairness constraints.');
    console.log('Closest (minimal warnings):');
    const sorted = [...results].sort((a, b) => a.catWarnings.length - b.catWarnings.length || b.ndcg5 - a.ndcg5);
    const best = sorted[0];
    console.log(`  k1=${best.k1} b=${best.b} NDCG@5=${(best.ndcg5 * 100).toFixed(2)}% NDCG@10=${(best.ndcg10 * 100).toFixed(2)}%`);
    console.log(`  CI: [${(best.ciLow * 100).toFixed(2)}%, ${(best.ciHigh * 100).toFixed(2)}%]`);
    console.log(`  Warnings: ${best.catWarnings.join(', ')}`);
    return;
  }

  const best = viable[0];
  console.log('=== Optimal BM25 Parameters ===');
  console.log(`  k1 = ${best.k1}`);
  console.log(`  b  = ${best.b}`);
  console.log(`  NDCG@5  = ${(best.ndcg5 * 100).toFixed(2)}%`);
  console.log(`  NDCG@10 = ${(best.ndcg10 * 100).toFixed(2)}%`);
  console.log(`  95% CI  = [${(best.ciLow * 100).toFixed(2)}%, ${(best.ciHigh * 100).toFixed(2)}%]`);
  console.log();
  console.log('Per-category NDCG@5:');
  for (const cat of CATEGORIES) {
    const score = best.catNDCG[cat];
    const bestScore = bestPerCat[cat];
    const loss = ((bestScore - score) * 100).toFixed(2);
    console.log(`  ${cat.padEnd(10)} ${(score * 100).toFixed(2)}% (best: ${(bestScore * 100).toFixed(2)}%, delta: ${loss}%)`);
  }
});
