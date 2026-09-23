/**
 * The balance report: every measurement the targets are written in, as
 * markdown, plus the reasoning behind the numbers in content.ts.
 *
 * `snapshot()` is the compact per-state summary; the "before" column of the
 * report is a snapshot taken by this same bot against the pre-tuning
 * content.ts, frozen in `before.json`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE, META_UPGRADES, formatTokens } from '@sim/index.ts';
import type { ArmStats, ContextExperiment, PolicyGrid, SycophancyCase } from './analysis.ts';
import {
  DEGENERATE_POLICIES,
  contextExperiment,
  policyGrid,
  promptCurve,
  slowClickGrid,
  sycophancyCases,
} from './analysis.ts';
import { ceilingTable } from './ceiling.ts';
import type { CareerResult, MetaStateName } from './meta.ts';
import { META_STATE_NAMES, TRAINING_ORDER, budgetFor, maxedCost, metaForBudget } from './meta.ts';
import type { NodeReport } from './nodeweight.ts';
import { deltas, nodeWeights } from './nodeweight.ts';
import { runCareers } from './parallel.ts';
import { HUMAN_CLICKS, SLOW_CLICKS, averageCps } from './policy.ts';
import { median, seeds } from './sweep.ts';

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface StateSnapshot {
  readonly state: MetaStateName;
  readonly spent: number;
  readonly winRate: number;
  readonly medianReached: number;
  readonly meanReached: number;
  readonly medianMinutes: number;
  readonly medianWinMinutes: number;
  readonly forcedPerPrompt: number;
  readonly manualPerPrompt: number;
  readonly anyForced: number;
  readonly claimsPerRun: number;
  readonly caughtPerRun: number;
  readonly meanThumbs: number;
  readonly longestPromptRatio: number;
}

export interface CareerSnapshot {
  readonly careers: number;
  readonly medianRuns: number;
  readonly minRuns: number;
  readonly maxRuns: number;
  readonly medianHours: number;
  readonly medianFirstWin: number;
  /** Median length of every winning run across the careers: the typical win a player sees. */
  readonly medianWinMinutes?: number;
  readonly allMaxed: boolean;
}

export interface Snapshot {
  readonly label: string;
  readonly seedCount: number;
  readonly treeCost: number;
  readonly states: readonly StateSnapshot[];
  readonly career: CareerSnapshot | null;
}

function stateFromArm(state: MetaStateName, spent: number, a: ArmStats, anyForced: number, minutes: number): StateSnapshot {
  return {
    state,
    spent,
    winRate: a.winRate,
    medianReached: a.medianReached,
    meanReached: a.meanReached,
    medianMinutes: minutes,
    medianWinMinutes: a.medianWinMinutes,
    forcedPerPrompt: a.forcedPerPrompt,
    manualPerPrompt: a.manualPerPrompt,
    anyForced,
    claimsPerRun: a.claimsPerRun,
    caughtPerRun: a.caughtPerRun,
    meanThumbs: a.meanThumbs,
    longestPromptRatio: a.longestPromptRatio,
  };
}

export function careerSnapshot(cs: readonly CareerResult[]): CareerSnapshot {
  const runs = cs.map((c) => c.runs);
  return {
    careers: cs.length,
    medianRuns: median(runs),
    minRuns: Math.min(...runs),
    maxRuns: Math.max(...runs),
    medianHours: median(cs.map((c) => c.hours)),
    medianFirstWin: median(cs.map((c) => c.firstWin)),
    medianWinMinutes: median(cs.flatMap((c) => c.log.filter((l) => l.won).map((l) => l.minutes))),
    allMaxed: cs.every((c) => c.maxed),
  };
}

/** Per-state competent numbers plus the career, the unit of a before/after table. */
export async function snapshot(
  label: string,
  seedCount: number,
  workers: number,
  careers: number,
): Promise<Snapshot> {
  const { runJobs, byKey } = await import('./parallel.ts');
  const built = META_STATE_NAMES.map((n) => metaForBudget(n));
  const seedList = seeds(seedCount);
  const jobs = built.flatMap((b) =>
    seedList.map((seed) => ({ key: b.name, seed, policy: 'competent' as const, meta: b.meta, metaName: b.name })),
  );
  const grouped = byKey(await runJobs(jobs, workers));
  const { armStats } = await import('./analysis.ts');
  const states = built.map((b) => {
    const rs = grouped.get(b.name) ?? [];
    const anyForced = rs.length ? rs.filter((r) => r.forcedCompactions > 0).length / rs.length : 0;
    return stateFromArm(b.name, b.spent, armStats(b.name, rs), anyForced, median(rs.map((r) => r.elapsedS / 60)));
  });
  const cs = careers > 0 ? careerSnapshot(await runCareers(seeds(careers, 7001), workers)) : null;
  return { label, seedCount, treeCost: maxedCost(), states, career: cs };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pct = (n: number): string => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—');
const num = (n: number, d = 1): string => (Number.isFinite(n) ? n.toFixed(d) : '—');

function beforeAfter(before: Snapshot | null, after: Snapshot): string {
  const lines = [
    '| state | 👍 spent | win | median prompt reached | median win minutes | forced / prompt | manual / prompt | claims (caught) / run | 👍 / run |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const a of after.states) {
    const b = before?.states.find((s) => s.state === a.state);
    const pair = (f: (s: StateSnapshot) => string): string => (b ? `${f(b)} → **${f(a)}**` : `**${f(a)}**`);
    lines.push(
      `| ${a.state} | ${b ? `${b.spent} → ` : ''}${a.spent} | ${pair((s) => pct(s.winRate))} | ${pair((s) => num(s.medianReached, 1))} | ` +
        `${pair((s) => num(s.medianWinMinutes, 1))} | ${pair((s) => num(s.forcedPerPrompt, 2))} | ${pair((s) => num(s.manualPerPrompt, 2))} | ` +
        `${pair((s) => `${num(s.claimsPerRun, 2)} (${num(s.caughtPerRun, 2)})`)} | ${pair((s) => num(s.meanThumbs, 1))} |`,
    );
  }
  if (after.career) {
    const b = before?.career;
    const a = after.career;
    lines.push('');
    lines.push(
      `Career to a maxed tree (${a.careers} careers): ` +
        (b ? `${b.medianRuns} runs / ${num(b.medianHours)} h → ` : '') +
        `**${a.medianRuns} runs (${a.minRuns}–${a.maxRuns}), ${num(a.medianHours)} h of sim time**, first win around run ${a.medianFirstWin}` +
        (a.medianWinMinutes !== undefined ? `; the median winning run over whole careers lasts **${num(a.medianWinMinutes)} min**.` : '.'),
    );
  }
  return lines.join('\n');
}

function targetRow(target: string, wanted: string, measured: string, ok: boolean): string {
  return `| ${target} | ${wanted} | ${measured} | ${ok ? 'PASS' : 'MISS'} |`;
}

function targetsTable(s: Snapshot, grid: PolicyGrid, syco: readonly SycophancyCase[], ctx: readonly ContextExperiment[]): string {
  const st = (n: MetaStateName): StateSnapshot => {
    const x = s.states.find((y) => y.state === n);
    if (!x) throw new Error(n);
    return x;
  };
  const fresh = st('fresh');
  const mid = st('mid');
  const deep = st('deep');
  const maxed = st('maxed');
  const cell = (p: string, n: string): ArmStats | undefined => grid.cells.get(`${p}/${n}`);
  const beatsCompetent = DEGENERATE_POLICIES.filter((p) => p !== 'syco-spam').filter((p) =>
    (['mid', 'deep', 'maxed'] as const).some((n) => (cell(p, n)?.winRate ?? 0) > (cell('competent', n)?.winRate ?? 0) + 0.05),
  );
  const worstSyco = Math.max(...syco.map((c) => c.sustainRatio));
  const midCtx = ctx.find((c) => c.state === 'mid');
  const winMins = [mid, deep, maxed].map((x) => x.medianWinMinutes);
  const rows = [
    '| target | wanted | measured | |',
    '|---|---|---|:--:|',
    targetRow('a. fresh run', 'dies on prompt 3–5, compacted, never wins', `median prompt ${num(fresh.medianReached, 1)} (mean ${num(fresh.meanReached, 2)}), ${pct(fresh.anyForced)} of runs force-compacted, ${pct(fresh.winRate)} wins`, fresh.medianReached >= 3 && fresh.medianReached <= 5 && fresh.winRate === 0 && fresh.anyForced >= 0.9),
    targetRow('b. mid meta', '≈ 50% wins', pct(mid.winRate), mid.winRate >= 0.35 && mid.winRate <= 0.65),
    targetRow('b. maxed meta', '≥ 90% wins', pct(maxed.winRate), maxed.winRate >= 0.9),
    targetRow('c. winning run', '15–25 min', `mid ${num(mid.medianWinMinutes)}, deep ${num(deep.medianWinMinutes)}, maxed ${num(maxed.medianWinMinutes)} min (medians)`, winMins.every((m) => m >= 15 && m <= 25)),
    targetRow('d. compaction, fresh', '≈ 1 per 1–2 prompts', `${num(fresh.forcedPerPrompt, 2)} forced / prompt`, fresh.forcedPerPrompt >= 0.45 && fresh.forcedPerPrompt <= 1.05),
    targetRow('d. compaction, maxed', 'rare', `${num(maxed.forcedPerPrompt + maxed.manualPerPrompt, 2)} / prompt`, maxed.forcedPerPrompt + maxed.manualPerPrompt < 0.1),
    targetRow('d. careless is worse', 'visibly', midCtx ? `mid: careless ${pct(midCtx.careless.winRate)} vs ${pct(midCtx.competent.winRate)}` : '—', !!midCtx && midCtx.careless.winRate + 0.2 < midCtx.competent.winRate),
    targetRow('e. career', '20–35 runs', s.career ? `${s.career.medianRuns} runs (${s.career.minRuns}–${s.career.maxRuns})` : '—', !!s.career && s.career.medianRuns >= 20 && s.career.medianRuns <= 35),
    targetRow('f. degenerate strategies', 'none beats competent', beatsCompetent.length ? beatsCompetent.join(', ') : 'none does', beatsCompetent.length === 0),
    targetRow('f. sycophancy spam', 'no infinite patience', `sustained restore ≤ ${pct(worstSyco)} of the drain`, worstSyco < 1),
  ];
  return rows.join('\n');
}

function stateTable(s: Snapshot): string {
  const lines = [
    '| state | 👍 spent | runs | win | prompt reached (median / mean) | run min (median) | win min (median) | forced / prompt | manual / prompt | runs force-compacted | claims / run | caught / run | 👍 / run | longest prompt ÷ its bar |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const x of s.states) {
    lines.push(
      `| ${x.state} | ${x.spent} | ${s.seedCount} | ${pct(x.winRate)} | ${num(x.medianReached, 1)} / ${num(x.meanReached, 2)} | ${num(x.medianMinutes)} | ${num(x.medianWinMinutes)} | ` +
        `${num(x.forcedPerPrompt, 2)} | ${num(x.manualPerPrompt, 2)} | ${pct(x.anyForced)} | ${num(x.claimsPerRun, 2)} | ${num(x.caughtPerRun, 2)} | ${num(x.meanThumbs, 1)} | ${num(x.longestPromptRatio, 2)} |`,
    );
  }
  return lines.join('\n');
}

function gridTable(grid: PolicyGrid): string {
  const lines = [`| policy | ${grid.states.join(' | ')} |`, `|---|${grid.states.map(() => '---:').join('|')}|`];
  for (const p of grid.policies) {
    const cells = grid.states.map((n) => {
      const c = grid.cells.get(`${p}/${n}`);
      return c ? `${pct(c.winRate)} · ${num(c.meanReached, 2)}` : '—';
    });
    lines.push(`| ${p} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function sycoTable(cs: readonly SycophancyCase[]): string {
  const lines = [
    '| case | sustained restore ÷ drain | bar lasts (analytic) | bar lasts (measured, idle agent) |',
    '|---|---:|---:|---:|',
  ];
  for (const c of cs) {
    lines.push(`| ${c.label} | ${pct(c.sustainRatio)} | ${num(c.stretch, 2)}× | ${num(c.measuredStretch, 2)}× |`);
  }
  return lines.join('\n');
}

function contextTable(cs: readonly ContextExperiment[]): string {
  const lines = [
    '| state | competent | no context upgrades | no Context Training (window kept) | careless |',
    '|---|---:|---:|---:|---:|',
  ];
  const f = (a: ArmStats): string =>
    `${pct(a.winRate)} · reach ${num(a.meanReached, 2)} · forced ${num(a.forcedPerPrompt, 2)}/p`;
  for (const c of cs) {
    lines.push(`| ${c.state} | ${f(c.competent)} | ${f(c.noContextUpgrades)} | ${f(c.noContextTraining)} | ${f(c.careless)} |`);
  }
  return lines.join('\n');
}

function nodeTable(nodes: readonly NodeReport[]): string {
  const lines = [
    '| node | verdict | purchase point: Δ score / Δ👍 | mid toggle: Δ win / Δ score | maxed knock-out: Δ win / min saved / Δ👍 | why |',
    '|---|---|---:|---:|---:|---|',
  ];
  const sgn = (n: number, d = 2): string => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
  for (const n of nodes) {
    const p = deltas(n.purchase);
    const m = deltas(n.mid);
    const x = deltas(n.maxed);
    lines.push(
      `| ${n.name} | ${n.verdict} | ${sgn(p.score)} / ${sgn(p.thumbs * 100, 0)}% | ${sgn(m.win * 100, 0)}% / ${sgn(m.score)} | ` +
        `${sgn(x.win * 100, 0)}% / ${sgn(x.minutes, 1)} / ${sgn(x.thumbs * 100, 0)}% | ${n.why} |`,
    );
  }
  return lines.join('\n');
}

function metaStatesTable(): string {
  const lines = ['| state | budget | spent | levels |', '|---|---:|---:|---|'];
  for (const name of META_STATE_NAMES) {
    const b = metaForBudget(name);
    const levels = META_UPGRADES.filter((d) => (b.meta.levels[d.id] ?? 0) > 0)
      .map((d) => `${d.id} ${b.meta.levels[d.id]}`)
      .join(', ');
    lines.push(`| ${name} | ${budgetFor(name)} | ${b.spent} | ${levels || '—'} |`);
  }
  return lines.join('\n');
}

function curveTable(): string {
  const lines = ['| prompt | requirement | base patience |', '|---:|---:|---:|'];
  for (const r of promptCurve()) lines.push(`| ${r.prompt} | ${formatTokens(r.requirement)} | ${r.patienceS.toFixed(0)} s |`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface ReportOptions {
  readonly seedCount?: number;
  readonly policySeeds?: number;
  readonly nodeSeeds?: number;
  readonly careers?: number;
  readonly workers?: number;
  readonly before?: Snapshot | null;
}

const here = dirname(fileURLToPath(import.meta.url));
export const BEFORE_FILE = resolve(here, 'before.json');

export function loadBefore(): Snapshot | null {
  if (!existsSync(BEFORE_FILE)) return null;
  return JSON.parse(readFileSync(BEFORE_FILE, 'utf8')) as Snapshot;
}

export async function buildReport(opts: ReportOptions = {}): Promise<string> {
  const started = Date.now();
  const seedCount = opts.seedCount ?? 120;
  const policySeeds = opts.policySeeds ?? 48;
  const nodeSeeds = opts.nodeSeeds ?? 64;
  const workers = opts.workers ?? 1;
  const before = opts.before === undefined ? loadBefore() : opts.before;

  const after = await snapshot('after', seedCount, workers, opts.careers ?? 12);
  const grid = await policyGrid(['competent', ...DEGENERATE_POLICIES], policySeeds, workers);
  const slow = await slowClickGrid(policySeeds, workers);
  const ctx = await contextExperiment(['fresh', 'early', 'mid'], policySeeds, workers);
  const syco = sycophancyCases();
  const nodes = nodeSeeds > 0 ? await nodeWeights({ seedCount: nodeSeeds, workers, followUpSeeds: nodeSeeds * 3 }) : [];
  const wall = ((Date.now() - started) / 1000).toFixed(0);

  const dead = nodes.filter((n) => n.verdict === 'dead' || n.verdict === 'harmful');
  const out: string[] = [];
  out.push('# Tokenmaxxing 2: balance report');
  out.push('');
  out.push(
    `Generated by \`tools/balance\` (\`node tools/balance/run-balance.mjs report\`) in ${wall} s. ` +
      `${seedCount} seeds per meta state, ${policySeeds} per policy arm, ${nodeSeeds} per node-weight arm, ` +
      `${opts.careers ?? 12} whole careers.`,
  );
  out.push('');
  out.push(
    `Click model: ${HUMAN_CLICKS.cps} clicks/s while clicking, ${Math.round(HUMAN_CLICKS.uptime * 100)}% of the time ` +
      `(≈ ${averageCps(HUMAN_CLICKS).toFixed(1)} clicks/s); the slower variant is ${SLOW_CLICKS.cps}/s (≈ ${averageCps(SLOW_CLICKS).toFixed(1)}). ` +
      'The competent policy shops by payback against the rest of the run while keeping the report reachable ' +
      `with the bonus-👍 reserve, reports when nothing else pays, /compacts after a report or ahead of an overflow ` +
      '(dumping the wallet into tools first), claims only when honest work cannot land, flatters the human when ' +
      'the heat has cooled, and drafts and keeps cards by their value now and once the tools have grown.',
  );
  out.push('');
  out.push('## Targets');
  out.push('');
  out.push(targetsTable(after, grid, syco, ctx));
  out.push('');
  out.push('## Before and after');
  out.push('');
  out.push(
    before
      ? `"Before" is the same competent bot against the content.ts this pass started from (${before.seedCount} seeds per state).`
      : 'No before snapshot found (tools/balance/before.json).',
  );
  out.push('');
  out.push(beforeAfter(before, after));
  out.push('');
  out.push('## Every meta state (competent policy)');
  out.push('');
  out.push(stateTable(after));
  out.push('');
  out.push('"Longest prompt ÷ its bar" is the longest single prompt over its own max patience: how far flattery, pickups and lunches stretched it.');
  out.push('');
  out.push('## Degenerate strategies');
  out.push('');
  out.push('Win rate · mean prompt reached, same seeds for every policy.');
  out.push('');
  out.push(gridTable(grid));
  out.push('');
  out.push(
    '`always-claim` claims the moment the amber button lights; `no-tools` never buys a tool; `clicker` buys nothing at all; ' +
      '`syco-spam` presses "You\'re absolutely right!" every time the heat cools, needed or not; `careless` buys greedily, never /compacts and never plans around the window.',
  );
  out.push('');
  out.push('### Sycophancy cannot hold the bar up');
  out.push('');
  out.push(sycoTable(syco));
  out.push('');
  out.push(
    `A press restores ${pct(BALANCE.SYCOPHANCY_BASE)} × multipliers × 0.5^heat of the bar and heat drains one point per ${BALANCE.SYCOPHANCY_HEAT_DECAY_MS / 1000} s, ` +
      'so the best sustained cadence is one press per decay period. The ratio above is that cadence\'s restore over the drain; below 100% the bar always empties.',
  );
  out.push('');
  out.push('## Context management matters');
  out.push('');
  out.push(contextTable(ctx));
  out.push('');
  out.push('## The slower clicker');
  out.push('');
  out.push(gridTable(slow));
  out.push('');
  out.push('## Training: does every node contribute?');
  out.push('');
  if (nodes.length) {
    out.push(
      'Three paired experiments per node: the save just before the node in the Training order with and without it ("purchase point"), ' +
        'the mid save with the node toggled ("mid toggle"), and the maxed save without it ("maxed knock-out"). ' +
        'Δ score is the change in prompts completed plus progress on the last one; "min saved" is median winning minutes saved; ' +
        'Δ👍 is the change in 👍 per run. A node contributes when any effect (score, win rate, 👍, winning minutes, compactions per prompt, ' +
        'catches per run) clears two standard errors; four is "strong". Nodes that look weak or dead are re-run at mid on three times as many fresh seeds ' +
        'and judged again, because a 50% save hides small real effects in its noise. "Mixed" means it helps on one axis and costs score on another.',
    );
    out.push('');
    out.push(nodeTable(nodes));
    out.push('');
    out.push(dead.length ? `Dead or harmful even after the re-run: ${dead.map((n) => n.name).join(', ')}.` : 'No node is dead.');
    const mixed = nodes.filter((n) => n.verdict === 'mixed');
    if (mixed.length) out.push('', `Mixed: ${mixed.map((n) => n.name).join(', ')}.`);
  } else {
    out.push('Skipped (run with node seeds > 0).');
  }
  out.push('');
  out.push('## Meta states');
  out.push('');
  out.push(`Tree cost (everything but Endless): **${maxedCost()}** 👍. Each state is a prefix of one Training order (${TRAINING_ORDER.length} levels).`);
  out.push('');
  out.push(metaStatesTable());
  out.push('');
  out.push('## Requirement curve');
  out.push('');
  out.push(curveTable());
  out.push('');
  out.push('## Final prompt ceiling');
  out.push('');
  out.push(ceilingTable());
  out.push('');
  out.push(REASONING);
  return out.join('\n');
}

/** What changed in content.ts and why. Written by hand; the numbers above are measured. */
export const REASONING = `## What changed, and why

All edits are numeric literals in \`src/sim/content.ts\` (structure, ids, text and requirements untouched).

**Sycophancy.** \`SYCOPHANCY_BASE\` 0.06 → 0.02, \`SYCOPHANCY_HEAT_DECAY_MS\` 8 000 → 32 000, RLHF ×1.3/1.7/2.3 → ×1.1/1.2/1.3, Apology Templates ×1.5 → ×1.2, YOU'RE ABSOLUTELY RIGHT ×2 → ×1.2.
At the old numbers one press every 8 s restored 6% of a 120 s bar: 90% of the drain on a fresh save and over 400% on a maxed one. A player could stall a prompt forever, and the "before" early save stretched prompts to 30× their bar. The restore is a fraction of the *max* bar, so every patience multiplier also multiplies flattery; the only safe knob is the sustained rate. It is now 7% of the drain on a fresh save and at most 65% with every patience card in the game.

**The tool ladder.** Rate ×5.2 → ×10 per tier; payback 52 s ×1.17 → 62 s ×1.5 per tier.
The requirement grows ×15 per prompt, but the old ladder only grew ×6.1 per tier in cost. The gap had to come from about ×200 of stacked multipliers, which also made the early prompts trivial and the whole run a 1–2 minute sprint. Now a tier costs ×15 the last, like a prompt, so every prompt asks for roughly one new tier and the time profile is flat.

**Multiplier compression.**
- Training: Tool Use top levels ×3/×5 → ×1.6/×1.8, Character ×1.35 → ×1.2, Quantization ×0.75 → ×0.86, Inference Budget 2M → 60K.
- Orchestration upgrades: Distilled Weights ×2 → ×1.4, Model Router ×1.5 → ×1.25, AGENTS.md ×1.25 → ×1.15.
- One-shots: 10% for 10 s → 6% for 6 s.
- Stackable cards: I'LL TIP $200, USE BEST PRACTICES, IT'S MAY, READ THE DOCS, 10X ENGINEER, NO PLACEHOLDERS, AGI BY FRIDAY, JUST PUSH TO MAIN.

A maxed save used to be about five times stronger than a mid one, which cannot give "mid 50%, maxed 90%" at any difficulty. Most of the gap was Sampling's one-shots (a flat ×2 on idle output) and the top Tool Use level. Cards stack without limit once the window stops compacting, so their multipliers were cut hardest. The uncommon and rare ones stay a step above the commons, so Prompt Library and Viral Prompts still improve the pool.

**Training costs and 👍.** Every node is one Fibonacci step cheaper (3 → 2, 5 → 3, 8 → 5, 13 → 8, 21 → 13, 34 → 21, 55 → 34; tree 1 047 → 647 👍), and \`THUMBS_PER_REPORT\` goes 1 → 2.
A career took about 63 runs with an earlier bot. Cheaper nodes alone got it to 35; two 👍 per prompt (claims too) gets it to about 25, inside the 20–35 target. The Fibonacci ladder keeps its shape.

**Incidents.** \`GOOD_INCIDENT_CHANCE\` 0.28 → 0.15, rm -rf weight 1 → 0.25.
For a player who clicks, a bad incident mostly costs a few seconds of output. Lunch, "thanks!", Flow State and Free Credits gave about as much back, so incidents were net zero and Harmless was dead. They now cost something, and fewer good ones also trims the patience top-ups that let edge runs stall past 25 minutes. Auto Mode was a pure loss: permission prompts clear in 8 clicks, so removing them only made the other bad incidents more frequent, and rm -rf came on top. With rm -rf rarer it is roughly neutral.

**Nodes that measured dead.**
- Harmless ×0.9/0.8/0.7 → ×0.85/0.72/0.6.
- KV Cache ×0.9/0.8/0.65 → ×0.8/0.65/0.5.
- Specification Gaming −5/−10/−15% → −7/−14/−20%.
- Unearned Confidence −4/−8/−13% → −7/−14/−20%.
- Plausible Deniability ×0.7/×0.45 → ×0.5/×0.25.
- Keep Going 2 → 3 and Stop Hook 4 → 6 auto-clicks; STOP BEING LAZY 3 → 4; HERE ARE SOME EXAMPLES +3 → +4 crit.

## Design concerns for the integrator

- **Sycophancy scales with max patience.** A press restores a fraction of the *max* bar, so Helpful, the patience upgrades and the patience cards all multiply it. Holding the no-infinite-patience line needed a 32 s cool-down, not DESIGN.md's "about 8 s". A restore of a flat share of the prompt's *base* patience would allow a short cool-down again.
- **Auto Mode cannot be a good trade while permission prompts clear in 8 clicks.** An active clicker clears one in about 1.5 s, so removing them only reshuffles the bad-incident pool, and rm -rf is added on top. Raising \`clearWithClicks\` on the permission incidents (to 25–40) would make the trade real; that is structure, outside this pass.
- **Pickups are the biggest patience and token source nobody tunes.** "thanks!" restores 20% of the bar and a Golden Token pays 20% of the requirement about every 27 s, so Serendipity (pickups every ≈17 s) is one of the strongest nodes in the tree. \`PICKUP_TUNING\` and pickup payloads were outside this pass.
- **DESIGN.md is now out of date in three places:** 👍 are two per prompt, not one; the sycophancy cool-down is 32 s; the tool ladder is no longer "the first game's curves" (content.ts says so in a comment too).
- **The top of the ladder is thin.** Ralph Loop and Recursive Self-Improvement cost half a prompt's requirement for their first unit and pay back in about 60–150 s even on a maxed save, so they matter only on the last prompt or two.
- **Holding pays.** Leftover patience is worthless, so a competent player keeps buying until about 30% patience is left (the bonus-👍 line). A player who reports the moment the bar is green finishes faster and weaker. That is the wallet/report tension working, but the HUD could say more about it.
- **\`npm run balance\`** still points at game 1's \`tests/unit/balance.report.test.ts\`; it should run \`node tools/balance/run-balance.mjs report\` (or the new \`tests/unit/balance.targets.test.ts\`).
`;
