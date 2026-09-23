#!/usr/bin/env node
/**
 * Entry point for the balance simulator.
 *
 *   node tools/balance/run-balance.mjs report          write artifacts/balance/report.md
 *   node tools/balance/run-balance.mjs sweep 200       per-state table, 200 seeds
 *   node tools/balance/run-balance.mjs nodes 96        Training node weights
 *
 * See cli.ts for every mode. It shells out to the vite-node bundled with
 * vitest so the TypeScript sources and the `@sim` alias resolve exactly as
 * they do in the test run.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const viteNode = resolve(root, 'node_modules/.bin/vite-node');
const entry = resolve(here, 'cli.ts');

const res = spawnSync(viteNode, [entry, '--', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
