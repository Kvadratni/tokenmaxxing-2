/**
 * Driver for the balance simulator (run via `tools/balance/run-balance.mjs`).
 *
 *   node tools/balance/run-balance.mjs sweep    [seeds] [workers]   per-state table
 *   node tools/balance/run-balance.mjs policies [seeds] [workers]   degenerate strategies
 *   node tools/balance/run-balance.mjs career   [careers] [workers] fresh save to maxed tree
 *   node tools/balance/run-balance.mjs nodes    [seeds] [workers]   Training node weights
 *   node tools/balance/run-balance.mjs context  [seeds] [workers]   context management A/B
 *   node tools/balance/run-balance.mjs checks                       sycophancy, ceiling, order
 *   node tools/balance/run-balance.mjs meta                         the named meta states
 *   node tools/balance/run-balance.mjs snapshot [seeds] [workers] [careers] [out.json]
 *   node tools/balance/run-balance.mjs report   [seeds] [workers] [nodeSeeds] [careers]
 *
 * `workers` defaults to most of the machine's cores; each worker is a child
 * vite-node process (the `shard` / `career-shard` modes below).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { META_UPGRADES } from '@sim/index.ts';
import { DEGENERATE_POLICIES, contextExperiment, policyGrid, sycophancyCases } from './analysis.ts';
import { ceilingTable } from './ceiling.ts';
import { META_STATE_NAMES, budgetFor, maxedCost, metaForBudget, orderProblems } from './meta.ts';
import { deltas, nodeWeights } from './nodeweight.ts';
import { runCareerShard, runCareers, runShard } from './parallel.ts';
import { buildReport, careerSnapshot, snapshot } from './report.ts';
import { seeds } from './sweep.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const mode = (args[0] ?? 'report').toLowerCase();
const intArg = (i: number, fallback: number): number => {
  const n = Number.parseInt(args[i] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};
const defaultWorkers = Math.max(1, Math.min(12, cpus().length - 2));

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function write(path: string, text: string): void {
  const out = resolve(process.cwd(), path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, 'utf8');
  log(`wrote ${out} (${text.length} bytes)`);
}

async function main(): Promise<void> {
  switch (mode) {
    case 'shard':
      runShard(args[1] ?? '', intArg(2, 0), intArg(3, 1), args[4] ?? '');
      return;
    case 'career-shard':
      runCareerShard(args[1] ?? '', intArg(2, 0), intArg(3, 1), args[4] ?? '');
      return;
    case 'sweep': {
      const s = await snapshot('now', intArg(1, 96), intArg(2, defaultWorkers), 0);
      for (const x of s.states) {
        log(
          `${x.state.padEnd(6)} spent=${String(x.spent).padStart(4)} win=${(x.winRate * 100).toFixed(0)}% ` +
            `reach=${x.medianReached}/${x.meanReached.toFixed(2)} min=${x.medianMinutes.toFixed(1)} win-min=${x.medianWinMinutes.toFixed(1)} ` +
            `forced/p=${x.forcedPerPrompt.toFixed(2)} manual/p=${x.manualPerPrompt.toFixed(2)} anyForced=${(x.anyForced * 100).toFixed(0)}% ` +
            `claims=${x.claimsPerRun.toFixed(2)} caught=${x.caughtPerRun.toFixed(2)} thumbs=${x.meanThumbs.toFixed(1)}`,
        );
      }
      return;
    }
    case 'snapshot': {
      const s = await snapshot(args[4] ?? 'snapshot', intArg(1, 96), intArg(2, defaultWorkers), intArg(3, 12));
      write(args[4] ?? 'artifacts/balance/snapshot.json', JSON.stringify(s, null, 2));
      return;
    }
    case 'policies': {
      const grid = await policyGrid(['competent', ...DEGENERATE_POLICIES], intArg(1, 48), intArg(2, defaultWorkers));
      for (const p of grid.policies) {
        const row = grid.states.map((n) => {
          const c = grid.cells.get(`${p}/${n}`);
          return c ? `${n} ${(c.winRate * 100).toFixed(0)}%/${c.meanReached.toFixed(2)}` : `${n} —`;
        });
        log(`${p.padEnd(12)} ${row.join('  ')}`);
      }
      return;
    }
    case 'career': {
      const cs = await runCareers(seeds(intArg(1, 12), 7001), intArg(2, defaultWorkers));
      for (const c of cs) log(`seed ${c.seed}: ${c.runs} runs, ${c.hours.toFixed(1)} h, first win run ${c.firstWin}, ${c.wins} wins`);
      const s = careerSnapshot(cs);
      log(`median ${s.medianRuns} runs (${s.minRuns}-${s.maxRuns}), ${s.medianHours.toFixed(1)} h`);
      return;
    }
    case 'nodes': {
      const nodes = await nodeWeights({ seedCount: intArg(1, 64), workers: intArg(2, defaultWorkers) });
      for (const n of nodes) {
        const p = deltas(n.purchase);
        const m = deltas(n.mid);
        const x = deltas(n.maxed);
        log(
          `${n.id.padEnd(22)} ${n.verdict.padEnd(11)} buy:${p.score.toFixed(2)}/${(p.thumbs * 100).toFixed(0)}% ` +
            `mid:${(m.win * 100).toFixed(0)}%/${m.score.toFixed(2)} max:${(x.win * 100).toFixed(0)}%/${x.minutes.toFixed(1)}m  ${n.why}`,
        );
      }
      return;
    }
    case 'context': {
      const ctx = await contextExperiment(['fresh', 'early', 'mid'], intArg(1, 48), intArg(2, defaultWorkers));
      for (const c of ctx) {
        const f = (a: typeof c.competent): string =>
          `${(a.winRate * 100).toFixed(0)}%/${a.meanReached.toFixed(2)}/F${a.forcedPerPrompt.toFixed(2)}`;
        log(`${c.state.padEnd(6)} competent ${f(c.competent)}  no-ctx-upgrades ${f(c.noContextUpgrades)}  no-ctx-training ${f(c.noContextTraining)}  careless ${f(c.careless)}`);
      }
      return;
    }
    case 'checks': {
      log(`order problems: ${JSON.stringify(orderProblems())}`);
      log(`tree cost (maxed): ${maxedCost()}`);
      for (const c of sycophancyCases()) {
        log(`syco ${c.label}: sustained ${(c.sustainRatio * 100).toFixed(0)}%, bar x${c.stretch.toFixed(2)} (measured x${c.measuredStretch.toFixed(2)})`);
      }
      log(ceilingTable());
      return;
    }
    case 'meta': {
      for (const name of META_STATE_NAMES) {
        const b = metaForBudget(name);
        const levels = META_UPGRADES.filter((d) => (b.meta.levels[d.id] ?? 0) > 0)
          .map((d) => `${d.id}:${b.meta.levels[d.id]}`)
          .join(' ');
        log(`${name.padEnd(6)} budget=${budgetFor(name)} spent=${b.spent}  ${levels}`);
      }
      return;
    }
    case 'report':
    default: {
      const text = await buildReport({
        seedCount: intArg(1, 120),
        workers: intArg(2, defaultWorkers),
        nodeSeeds: intArg(3, 64),
        careers: intArg(4, 12),
      });
      write('artifacts/balance/report.md', text);
    }
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
