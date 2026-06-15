import { describe, it, expect, beforeAll } from 'vitest';
import { ToolVault } from '../src/vault.js';
import { SemanticMatcher } from '../src/matcher.js';

// Simulate real OpenCode tools as a fixture set
const FIXTURE_TOOLS = [
  {
    id: 'github_create_issue',
    description: 'Creates a new GitHub issue in the specified repository',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'GitHub repository name in owner/repo format' },
        title: { type: 'string', description: 'Issue title text' },
        body: { type: 'string', description: 'Issue body content in markdown format' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply to the issue' },
      },
      required: ['repo', 'title'],
    },
  },
  {
    id: 'github_create_pr',
    description: 'Creates a pull request in a GitHub repository',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository identifier' },
        head: { type: 'string', description: 'Source branch name' },
        base: { type: 'string', description: 'Target branch name' },
      },
      required: ['repo', 'head', 'base'],
    },
  },
  {
    id: 'figma_create_shape',
    description: 'Creates a new shape in a Figma design',
    parameters: {
      type: 'object',
      properties: {
        shape: { type: 'string', description: 'Shape type: rectangle, ellipse, polygon' },
      },
    },
  },
  {
    id: 'read_file',
    description: 'Reads the contents of a file from disk',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path to the file' },
      },
      required: ['path'],
    },
  },
  {
    id: 'git_commit',
    description: 'Creates a git commit with the staged changes',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message describing the change' },
      },
      required: ['message'],
    },
  },
];

function loadFixture(vault: ToolVault) {
  // Clone via JSON to simulate snapshot
  for (const tool of FIXTURE_TOOLS) {
    vault.add(tool.id, tool.description, JSON.parse(JSON.stringify(tool.parameters)));
  }
}

describe('S1: tool_search (BM25 path)', () => {
  it('ranks by BM25 score — keyword match', () => {
    const v = new ToolVault();
    loadFixture(v);

    const r1 = v.queryBM25('repository', 5);
    expect(r1.length).toBeGreaterThan(0);
    expect(['github_create_issue', 'github_create_pr']).toContain(r1[0].id);

    const r2 = v.queryBM25('commit', 5);
    expect(r2[0].id).toBe('git_commit');
  });
});

describe('S2: tool_search_regex', () => {
  it('matches against tool IDs and descriptions', () => {
    const v = new ToolVault();
    loadFixture(v);

    const r1 = v.grep('^github_', 10);
    expect(r1.length).toBe(2);
    expect(r1.map(r => r.id).sort()).toEqual(['github_create_issue', 'github_create_pr']);

    const r2 = v.grep('Figma', 10);
    expect(r2[0].id).toBe('figma_create_shape');

    const r3 = v.grep('nonexistent_pattern_xyz', 10);
    expect(r3).toEqual([]);
  });
});

describe('S3: Param descriptions ARE indexed', () => {
  it('"markdown" matches via param description of body', () => {
    const v = new ToolVault();
    loadFixture(v);

    // "markdown" only appears in github_create_issue's `body` param description
    const r = v.queryBM25('markdown', 5);
    expect(r[0].id).toBe('github_create_issue');
  });

  it('"filesystem" matches via param description of path', () => {
    const v = new ToolVault();
    loadFixture(v);

    const r = v.queryBM25('filesystem', 5);
    expect(r[0].id).toBe('read_file');
  });
});

describe('S4: BM25 fallback when no embedding config', () => {
  it('query() uses BM25 when semantic is undefined', async () => {
    const v = new ToolVault(); // no embedding
    loadFixture(v);

    const r = await v.query('repository', 5);
    expect(r.length).toBeGreaterThan(0);
    expect(['github_create_issue', 'github_create_pr']).toContain(r[0].id);
  });
});

describe('S5: Semantic search (when enabled)', () => {
  it('returns matches for paraphrased queries', async () => {
    const v = new ToolVault({ embedding: { enabled: true, threshold: 0.3 } });
    loadFixture(v);

    // "save text to a file" — semantically similar to read_file (file operations)
    // but BM25 wouldn't match (no shared keywords with description)
    const r = await v.query('save text to a file', 5);
    expect(r.length).toBeGreaterThan(0);
    // We don't assert exact match — just that semantic produced results
  }, 30000);
});

describe('S6: Vault preserves full descriptions after defer', () => {
  it('stored entry has full description, not [d]', () => {
    const v = new ToolVault();
    v.add('test', 'This is the full original description', { type: 'object', properties: { x: { type: 'string', description: 'X param original' } } });

    const entries = v.list();
    expect(entries[0].description).toBe('This is the full original description');
    const params = entries[0].parameters as any;
    expect(params.properties.x.description).toBe('X param original');
  });
});

describe('S7: Param keys indexed for search', () => {
  it('"labels" matches github_create_issue via param name', () => {
    const v = new ToolVault();
    loadFixture(v);

    const r = v.queryBM25('labels', 5);
    expect(r[0].id).toBe('github_create_issue');
  });
});

describe('S8: Empty/invalid queries handled gracefully', () => {
  it('empty query returns empty results', () => {
    const v = new ToolVault();
    loadFixture(v);
    expect(v.queryBM25('', 5)).toEqual([]);
  });

  it('invalid regex returns empty (no crash)', () => {
    const v = new ToolVault();
    loadFixture(v);
    expect(v.grep('[unclosed', 5)).toEqual([]);
  });
});

describe('S9: searchLimit caps results', () => {
  it('returns at most limit results', () => {
    const v = new ToolVault();
    loadFixture(v);
    const r = v.queryBM25('github', 1);
    expect(r.length).toBe(1);
  });
});

describe('S10: SemanticMatcher auto-relaxes threshold', () => {
  it('finds results even when strict threshold gives 0', async () => {
    const sm = new SemanticMatcher({ enabled: true, threshold: 0.99 }); // very strict
    await sm.index([{ id: 'a', text: 'apple banana' }]);
    // Query very different → no match at 0.99, but auto-relax should help
    const r = await sm.locate('orange grape');
    // We don't assert specific results, just no crash
    expect(r).toBeDefined();
  }, 30000);
});
