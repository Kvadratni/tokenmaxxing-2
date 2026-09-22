#!/usr/bin/env node
/**
 * Ad-hoc entry point for the balance simulator.
 *
 * `npm run balance` writes the report from tests/unit/balance.report.test.ts;
 * this script is for deeper, slower sweeps while tuning:
 *
 *   node tools/balance/run-balance.mjs curve 400
 *   node tools/balance/run-balance.mjs cards 60
 *
 * It shells out to the vite-node bundled with vitest so the TypeScript sources
 * and the `@sim` alias resolve exactly as they do in the test run.
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
