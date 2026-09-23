/**
 * Driver for the balance simulator (run via `tools/balance/run-balance.mjs`).
 *
 *   node tools/balance/run-balance.mjs sweep    [seeds] [workers]   per-state table
 *   node tools/balance/run-balance.mjs policies [seeds] [workers]   degenerate strategies
 *   node tools/balance/run-balance.mjs career   [careers] [workers] fresh save to maxed tree
 *   node tools/balance/run-balance.mjs nodes    [seeds] [workers] [followUp] [policy] [ids,...]
 *                                                                   Training node weights
 *   node tools/balance/run-balance.mjs tiers    [seeds] [workers] [saves]  tool payback when first affordable
 *   node tools/balance/run-balance.mjs costs    [seeds] [workers] [saves]  what each incident / pickup cost
 *        saves are `;`-separated: `mid;maxed:-auto_mode;pre:auto_mode` (see saveFor)
 *   node tools/balance/run-balance.mjs prompts  [seeds] [workers] [states,...]  seconds per prompt and share of its bar
 *   node tools/balance/run-balance.mjs ab <save> [seeds] [workers] <arm> [arm...]
 *        paired A/B arms on one save; an arm is comma-joined modifiers:
 *        base | +node (max level) | -node (level 0) | node=2 | p=<policy> | pk=<pickup chance>
 *        | skip=<pickup>|<pickup> (never click those)
 *   node tools/balance/run-balance.mjs context  [seeds] [workers]   context management A/B
 *   node tools/balance/run-balance.mjs checks                       sycophancy, ceiling, order
 *   node tools/balance/run-balance.mjs meta                         the named meta states
 *   node tools/balance/run-balance.mjs snapshot [seeds] [workers] [careers] [out.json]
 *   node tools/balance/run-balance.mjs report   [seeds] [workers] [nodeSeeds] [careers] [focusSeeds]
 *   node tools/balance/run-balance.mjs pass1    [seeds] [workers] [nodeSeeds] [careers]  freeze the first pass's
 *                                                                   numbers in pass1.json (run on its content.ts)
 *   node tools/balance/run-balance.mjs pass2    [seeds] [workers] [nodeSeeds] [careers]  print the second-pass section
 *
 * `workers` defaults to most of the machine's cores; each worker is a child
 * vite-node process (the `shard` / `career-shard` modes below).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { META_BY_ID, META_UPGRADES } from '@sim/index.ts';
import type { MetaState } from '@sim/types.ts';
import type { ArmSpec } from './analysis.ts';
import { DEGENERATE_POLICIES, contextExperiment, policyGrid, runArms, sycophancyCases } from './analysis.ts';
import { ceilingTable } from './ceiling.ts';
import type { CostRun, DiagJob, DiagKind, TierRun } from './diag.ts';
import { summarizeCosts, summarizeTiers } from './diag.ts';
import type { MetaStateName } from './meta.ts';
import { META_STATE_NAMES, budgetFor, maxedCost, metaForBudget, orderProblems } from './meta.ts';
import { deltas, nodeWeights, prefixBefore } from './nodeweight.ts';
import { runCareerShard, runCareers, runDiagJobs, runDiagShard, runShard } from './parallel.ts';
import type { PolicyId, PolicyOptions } from './policy.ts';
import { PASS1_FILE, loadPass1, measurePass2, pass2Section } from './pass2.ts';
import { buildReport, careerSnapshot, snapshot } from './report.ts';
import { median, seeds } from './sweep.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const mode = (args[0] ?? 'report').toLowerCase();
const intArg = (i: number, fallback: number): number => {
  const n = Number.parseInt(args[i] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};
const defaultWorkers = Math.max(1, Math.min(12, cpus().length - 2));

/** A save by name: `mid`, or `pre:<node>` (just before that node in the Training order), then optional `:+node,-node,node=2`. */
function saveFor(where: string): { name: MetaStateName; meta: MetaState } {
  const pre = where.startsWith('pre:');
  const body = pre ? where.slice(4) : where;
  const cut = body.indexOf(':');
  const head = cut < 0 ? body : body.slice(0, cut);
  const mods = cut < 0 ? '' : body.slice(cut + 1);
  const name = (pre ? 'mid' : head) as MetaStateName;
  const meta = pre ? prefixBefore(head) : structuredClone(metaForBudget(name).meta);
  for (const m of mods.split(',')) {
    if (!m) continue;
    const id = m.replace(/^[+-]/, '').split('=')[0] ?? '';
    const def = META_BY_ID[id];
    if (!def) throw new Error(`unknown node ${id}`);
    meta.levels[id] = m.startsWith('+') ? def.maxLevel : m.startsWith('-') ? 0 : Number(m.split('=')[1]);
  }
  return { name, meta };
}

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
    case 'diag-shard':
      runDiagShard(args[1] ?? '', intArg(2, 0), intArg(3, 1), args[4] ?? '');
      return;
    case 'tiers':
    case 'costs': {
      const kind: DiagKind = mode === 'tiers' ? 'tiers' : 'incidents';
      const n = intArg(1, 60);
      // Saves are `;`-separated so each can carry `:mods` (see saveFor).
      const states = (args[3] ?? 'mid;deep;maxed').split(/[;]/).flatMap((x) => (x.includes(':') ? [x] : x.split(',')));
      const jobs: DiagJob[] = [];
      for (const st of states) {
        const b = saveFor(st);
        for (const seed of seeds(n)) jobs.push({ key: st, kind, seed, policy: 'competent', meta: b.meta, metaName: b.name });
      }
      const res = await runDiagJobs(jobs, intArg(2, defaultWorkers));
      for (const st of states) {
        const runs = res.get(st) ?? [];
        log(`--- ${st} (${runs.length} runs)`);
        if (kind === 'tiers') {
          log('tier id           afford  firstPos  instPayS  inst/prompt  paid  paidPrompts  bought  endOwned  endShare');
          for (const t of summarizeTiers(runs as TierRun[])) {
            log(
              `${String(t.tier).padStart(4)} ${t.id.padEnd(12)} ${(t.affordableRate * 100).toFixed(0).padStart(5)}%  ${t.medianFirstPos.toFixed(2).padStart(8)}  ` +
                `${t.medianInstPaybackS.toFixed(0).padStart(8)}  ${t.medianInstPrompts.toFixed(2).padStart(11)}  ${(t.paidRate * 100).toFixed(0).padStart(3)}%  ` +
                `${t.medianPaidPrompts.toFixed(2).padStart(11)}  ${(t.boughtRate * 100).toFixed(0).padStart(5)}%  ${t.medianEndOwned.toFixed(0).padStart(8)}  ${(t.medianEndShare * 100).toFixed(1).padStart(7)}%`,
            );
          }
        } else {
          const cr = runs as CostRun[];
          const wins = cr.filter((r) => r.won).length;
          log(`win ${((wins / Math.max(1, cr.length)) * 100).toFixed(0)}%  median min ${median(cr.map((r) => r.elapsedS / 60)).toFixed(1)}`);
          log('id                       perRun   lostS  wallet%req  patienceS  context%  activeS');
          for (const c of summarizeCosts(cr)) {
            log(
              `${c.id.padEnd(24)} ${c.perRun.toFixed(2).padStart(6)}  ${c.lostS.toFixed(2).padStart(6)}  ${(c.walletFrac * 100).toFixed(1).padStart(10)}  ` +
                `${c.patienceS.toFixed(1).padStart(9)}  ${(c.contextFrac * 100).toFixed(1).padStart(8)}  ${c.activeS.toFixed(1).padStart(7)}`,
            );
          }
        }
      }
      return;
    }
    case 'ab': {
      // `pre:<node>` is the save just before that node in the Training order (its purchase point).
      const saved = saveFor(args[1] ?? 'mid');
      const st = saved.name;
      const n = intArg(2, 120);
      const workers = intArg(3, defaultWorkers);
      const specs = args.slice(4);
      const base = saved.meta;
      const arms: ArmSpec[] = specs.map((spec) => {
        const meta = structuredClone(base);
        let policy: PolicyId = 'competent';
        let opts: PolicyOptions = {};
        for (const m of spec.split(',')) {
          if (m === 'base' || m === '') continue;
          if (m.startsWith('p=')) policy = m.slice(2) as PolicyId;
          else if (m.startsWith('pk=')) opts = { ...opts, pickupChance: Number(m.slice(3)) };
          else if (m.startsWith('skip=')) opts = { ...opts, skipPickups: m.slice(5).split('|') };
          else if (m.startsWith('+') || m.startsWith('-')) {
            const def = META_BY_ID[m.slice(1)];
            if (!def) throw new Error(`unknown node ${m.slice(1)}`);
            meta.levels[def.id] = m.startsWith('+') ? def.maxLevel : 0;
          } else if (m.includes('=')) {
            const [id, lv] = m.split('=');
            if (!id || !META_BY_ID[id]) throw new Error(`unknown node ${id}`);
            meta.levels[id] = Number(lv);
          } else throw new Error(`bad modifier ${m}`);
        }
        return { label: spec, policy, meta, metaName: st, policyOptions: opts };
      });
      const stats = await runArms(arms, n, workers);
      const b0 = stats[0];
      for (const a of stats) {
        const winSe = Math.sqrt((a.winRate * (1 - a.winRate)) / Math.max(1, a.runs));
        const dWin = b0 ? a.winRate - b0.winRate : 0;
        const dScore = b0 ? a.score - b0.score : 0;
        const dSe = b0 ? Math.hypot(a.scoreSe, b0.scoreSe) : 0;
        log(
          `${a.label.padEnd(34)} win ${(a.winRate * 100).toFixed(1).padStart(5)}% ±${(winSe * 100).toFixed(1)}  score ${a.score.toFixed(2)} ±${a.scoreSe.toFixed(2)}  ` +
            `Δwin ${(dWin * 100).toFixed(1).padStart(5)}  Δscore ${dScore.toFixed(2).padStart(5)} (${dSe > 0 ? (dScore / dSe).toFixed(1) : '0.0'}σ)  ` +
            `reach ${a.meanReached.toFixed(2)}  winMin ${Number.isFinite(a.medianWinMinutes) ? a.medianWinMinutes.toFixed(1) : '—'}  ` +
            `F/p ${a.forcedPerPrompt.toFixed(2)} M/p ${a.manualPerPrompt.toFixed(2)}  👍 ${a.meanThumbs.toFixed(1)}  caught ${a.caughtPerRun.toFixed(2)}`,
        );
      }
      return;
    }
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
    case 'prompts': {
      // Seconds per completed prompt and its share of the bar, per state (competent).
      const { runJobs, byKey } = await import('./parallel.ts');
      const states = (args[3] ?? 'mid,deep,maxed').split(',') as MetaStateName[];
      const jobs = states.flatMap((st) => {
        const b = metaForBudget(st);
        return seeds(intArg(1, 60)).map((seed) => ({ key: st, seed, policy: 'competent' as const, meta: b.meta, metaName: st }));
      });
      const g = byKey(await runJobs(jobs, intArg(2, defaultWorkers)));
      for (const st of states) {
        const rs = g.get(st) ?? [];
        const cells: string[] = [];
        for (let i = 0; i < 10; i++) {
          const xs = rs.filter((r) => r.promptSeconds.length > i);
          if (!xs.length) break;
          const sec = xs.reduce((a, r) => a + (r.promptSeconds[i] ?? 0), 0) / xs.length;
          const share = xs.reduce((a, r) => a + (r.promptSeconds[i] ?? 0) / Math.max(1, r.promptMaxS[i] ?? 1), 0) / xs.length;
          cells.push(`${sec.toFixed(0)}s/${(share * 100).toFixed(0)}%`);
        }
        log(`${st.padEnd(6)} ${cells.join('  ')}`);
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
      const only = args[5] ? args[5].split(',') : undefined;
      const nodes = await nodeWeights({
        seedCount: intArg(1, 64),
        workers: intArg(2, defaultWorkers),
        followUpSeeds: intArg(3, 0),
        ...(args[4] ? { policy: args[4] as PolicyId } : {}),
        ...(only ? { only } : {}),
      });
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
    case 'pass1':
    case 'pass2': {
      const data = await measurePass2({
        label: mode === 'pass1' ? 'first pass (committed)' : 'second pass',
        seedCount: intArg(1, 120),
        workers: intArg(2, defaultWorkers),
        nodeSeeds: intArg(3, 200),
        careers: intArg(4, 12),
      });
      if (mode === 'pass1') write(PASS1_FILE, JSON.stringify(data, null, 1));
      else log(pass2Section(loadPass1(), data));
      return;
    }
    case 'report':
    default: {
      const text = await buildReport({
        seedCount: intArg(1, 120),
        workers: intArg(2, defaultWorkers),
        nodeSeeds: intArg(3, 96),
        careers: intArg(4, 12),
        focusSeeds: intArg(5, 200),
      });
      write('artifacts/balance/report.md', text);
    }
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
