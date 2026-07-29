import { build } from 'esbuild';

const shared = {
  bundle: true,
  allowOverwrite: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['@opencode-ai/plugin', 'zod', 'effect', '@xenova/transformers'],
};

await build({
  ...shared,
  entryPoints: ['dist/index.js'],
  outfile: 'dist/index.js',
});

await build({
  ...shared,
  entryPoints: ['dist/src/matcher.worker.js'],
  outfile: 'dist/matcher.worker.js',
});
