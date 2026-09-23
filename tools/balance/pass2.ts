/**
 * The second balance pass: the measurements behind its four problems, taken
 * the same way before (the content the first pass committed, frozen in
 * `pass1.json`) and after (live), so the report can show both.
 *
 *  1. Ralph Loop and Recursive Self-Improvement: payback when first
 *     affordable, and their unlocks' node weight.
 *  2. Pickups: how much of the win rate they carry, and the weight of Lucky
 *     Tokens and Serendipity.
 *  3. Auto Mode: what a permission prompt costs next to the other bad
 *     incidents, and Auto Mode's node weight.
 *  4. Better Summaries and Plausible Deniability, judged for the careless
 *     policy (the player who makes the mistakes they insure against).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INCIDENT_BY_ID } from '@sim/index.ts';
import type { ArmSpec, ArmStats } from './analysis.ts';
import { runArms } from './analysis.ts';
import type { CostRun, CostSummary, DiagJob, TierRun, TierSummary } from './diag.ts';
import { summarizeCosts, summarizeTiers } from './diag.ts';
import type { MetaStateName } from './meta.ts';
import { metaForBudget } from './meta.ts';
import type { NodeReport } from './nodeweight.ts';
import { deltas, nodeWeights } from './nodeweight.ts';
import { runDiagJobs } from './parallel.ts';
import type { Snapshot, StateSnapshot } from './report.ts';
import { seeds } from './sweep.ts';

export const FOCUS_NODES = ['unlock_ralph', 'unlock_rsi', 'auto_mode', 'lucky_tokens', 'serendipity'] as const;
export const INSURANCE_NODES = ['better_summaries', 'deniability'] as const;
export const PICKUP_STATES: readonly MetaStateName[] = ['mid', 'deep', 'maxed'];
export const TIER_STATES: readonly MetaStateName[] = ['mid', 'maxed'];

export interface PickupLoad {
  readonly state: MetaStateName;
  readonly with: ArmStats;
  readonly without: ArmStats;
}

export interface PermissionCosts {
  readonly state: MetaStateName;
  /** Permission prompts per run, and their mean cost per firing. */
  readonly perRun: number;
  readonly lostS: number;
  readonly activeS: number;
  /** Every other bad incident: firings per run, mean production cost per firing. */
  readonly otherPerRun: number;
  readonly otherLostS: number;
  readonly rows: readonly CostSummary[];
}

export interface Pass2Data {
  readonly label: string;
  readonly seedCount: number;
  readonly nodeSeeds: number;
  readonly snapshot: Snapshot;
  readonly tiers: Readonly<Record<string, readonly TierSummary[]>>;
  readonly pickups: readonly PickupLoad[];
  readonly nodes: readonly NodeReport[];
  readonly careless: readonly NodeReport[];
  /**
   * The same two nodes for the exact mistakes they insure: a competent player
   * who never /compacts (Better Summaries) and one who claims the moment the
   * button lights (Plausible Deniability).
   */
  readonly mistakes?: readonly NodeReport[];
  readonly permissions: readonly PermissionCosts[];
}

export interface Pass2Options {
  readonly label: string;
  /** Seeds per state for the snapshot, tier traces and incident costs. */
  readonly seedCount?: number;
  /** Seeds per arm for the pickup A/B and the focused node weights (follow-ups use 3×). */
  readonly nodeSeeds?: number;
  readonly careers?: number;
  readonly workers?: number;
}

export async function measurePass2(opts: Pass2Options): Promise<Pass2Data> {
  const seedCount = opts.seedCount ?? 120;
  const nodeSeeds = opts.nodeSeeds ?? 200;
  const workers = opts.workers ?? 1;

  // Lazy: report.ts imports this module for the renderer.
  const { snapshot } = await import('./report.ts');
  const snap = await snapshot(opts.label, seedCount, workers, opts.careers ?? 12);

  // Tier traces and incident costs: instrumented runs.
  const jobs: DiagJob[] = [];
  for (const st of TIER_STATES) {
    const b = metaForBudget(st);
    for (const seed of seeds(seedCount)) jobs.push({ key: `tiers/${st}`, kind: 'tiers', seed, policy: 'competent', meta: b.meta, metaName: st });
  }
  const permStates: MetaStateName[] = ['early', 'mid'];
  for (const st of permStates) {
    const b = metaForBudget(st);
    for (const seed of seeds(seedCount)) jobs.push({ key: `costs/${st}`, kind: 'incidents', seed, policy: 'competent', meta: b.meta, metaName: st });
  }
  const diag = await runDiagJobs(jobs, workers);
  const tiers: Record<string, TierSummary[]> = {};
  for (const st of TIER_STATES) tiers[st] = summarizeTiers((diag.get(`tiers/${st}`) ?? []) as TierRun[]);
  const permissions = permStates.map((st) => permissionCosts(st, (diag.get(`costs/${st}`) ?? []) as CostRun[]));

  // Pickups on and off, same seeds.
  const arms: ArmSpec[] = [];
  for (const st of PICKUP_STATES) {
    const meta = metaForBudget(st).meta;
    arms.push({ label: `${st}/with`, policy: 'competent', meta, metaName: st });
    arms.push({ label: `${st}/without`, policy: 'competent', meta, metaName: st, policyOptions: { pickupChance: 0 } });
  }
  const pk = new Map((await runArms(arms, nodeSeeds, workers)).map((a) => [a.label, a]));
  const pickups = PICKUP_STATES.map((st) => {
    const w = pk.get(`${st}/with`);
    const wo = pk.get(`${st}/without`);
    if (!w || !wo) throw new Error(`missing pickup arm ${st}`);
    return { state: st, with: w, without: wo };
  });

  const nodes = await nodeWeights({ seedCount: nodeSeeds, workers, followUpSeeds: nodeSeeds * 3, only: FOCUS_NODES });
  const careless = await nodeWeights({
    seedCount: nodeSeeds,
    workers,
    followUpSeeds: nodeSeeds * 3,
    only: INSURANCE_NODES,
    policy: 'careless',
  });
  const overflow = await nodeWeights({
    seedCount: nodeSeeds,
    workers,
    followUpSeeds: nodeSeeds * 3,
    only: ['better_summaries'],
    policyOptions: { override: { manualCompact: false, dumpBeforeOverflow: false } },
  });
  const liar = await nodeWeights({
    seedCount: nodeSeeds,
    workers,
    followUpSeeds: nodeSeeds * 3,
    only: ['deniability'],
    policy: 'always-claim',
  });
  const mistakes = [...overflow, ...liar];
  return { label: opts.label, seedCount, nodeSeeds, snapshot: snap, tiers, pickups, nodes, careless, mistakes, permissions };
}

function permissionCosts(state: MetaStateName, runs: readonly CostRun[]): PermissionCosts {
  const rows = summarizeCosts(runs);
  const bad = rows.filter((r) => INCIDENT_BY_ID[r.id]?.tone === 'bad');
  const perm = bad.filter((r) => INCIDENT_BY_ID[r.id]?.permission);
  const other = bad.filter((r) => !INCIDENT_BY_ID[r.id]?.permission);
  const weighted = (xs: readonly CostSummary[], f: (c: CostSummary) => number): number => {
    const n = xs.reduce((s, c) => s + c.perRun, 0);
    return n > 0 ? xs.reduce((s, c) => s + c.perRun * f(c), 0) / n : 0;
  };
  return {
    state,
    perRun: perm.reduce((s, c) => s + c.perRun, 0),
    lostS: weighted(perm, (c) => c.lostS),
    activeS: weighted(perm, (c) => c.activeS),
    otherPerRun: other.reduce((s, c) => s + c.perRun, 0),
    otherLostS: weighted(other, (c) => c.lostS),
    rows,
  };
}

const here = dirname(fileURLToPath(import.meta.url));
/** The first pass's committed content, measured by this pass's bot. */
export const PASS1_FILE = resolve(here, 'pass1.json');

export function loadPass1(): Pass2Data | null {
  if (!existsSync(PASS1_FILE)) return null;
  return JSON.parse(readFileSync(PASS1_FILE, 'utf8')) as Pass2Data;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const pct = (n: number | null | undefined): string => (n !== null && n !== undefined && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—');
const num = (n: number | null | undefined, d = 1): string => (n !== null && n !== undefined && Number.isFinite(n) ? n.toFixed(d) : '—');
const sgn = (n: number, d = 2): string => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
/** JSON turns Infinity into null; a median of "never" reads as ∞. */
const inf = (n: number | null | undefined, d = 2): string =>
  n === null || n === undefined || n === Number.POSITIVE_INFINITY ? 'never' : Number.isFinite(n) ? n.toFixed(d) : '—';

function pair<T>(b: T | undefined, a: T, f: (x: T) => string): string {
  return b === undefined ? `**${f(a)}**` : `${f(b)} → **${f(a)}**`;
}

function statesTable(before: Pass2Data | null, after: Pass2Data): string {
  const lines = [
    '| state | win | median prompt reached | median win minutes | forced / prompt | manual / prompt | claims (caught) / run | 👍 / run |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const a of after.snapshot.states) {
    const b: StateSnapshot | undefined = before?.snapshot.states.find((s) => s.state === a.state);
    lines.push(
      `| ${a.state} | ${pair(b, a, (s) => pct(s.winRate))} | ${pair(b, a, (s) => num(s.medianReached, 1))} | ${pair(b, a, (s) => num(s.medianWinMinutes, 1))} | ` +
        `${pair(b, a, (s) => num(s.forcedPerPrompt, 2))} | ${pair(b, a, (s) => num(s.manualPerPrompt, 2))} | ` +
        `${pair(b, a, (s) => `${num(s.claimsPerRun, 2)} (${num(s.caughtPerRun, 2)})`)} | ${pair(b, a, (s) => num(s.meanThumbs, 1))} |`,
    );
  }
  const ca = after.snapshot.career;
  const cb = before?.snapshot.career;
  if (ca) {
    lines.push('');
    lines.push(
      `Career to a maxed tree (${ca.careers} careers): ` +
        (cb ? `${cb.medianRuns} runs (${cb.minRuns}–${cb.maxRuns}), ${num(cb.medianHours)} h → ` : '') +
        `**${ca.medianRuns} runs (${ca.minRuns}–${ca.maxRuns}), ${num(ca.medianHours)} h**; first win around run ` +
        (cb ? `${cb.medianFirstWin} → ` : '') +
        `**${ca.medianFirstWin}**.`,
    );
  }
  return lines.join('\n');
}

function tiersTable(before: Pass2Data | null, after: Pass2Data): string {
  const lines = [
    '| save | tier | first affordable at prompt | payback of one unit then | … ÷ that prompt\'s length | repaid before the run ended | prompts to repay (median) | bought | share of output at the last report |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const st of TIER_STATES) {
    for (const a of after.tiers[st] ?? []) {
      if (a.tier < 8) continue;
      const b = before?.tiers[st]?.find((t) => t.id === a.id);
      lines.push(
        `| ${st} | ${a.tier}. ${a.id} | ${pair(b, a, (t) => num(t.medianFirstPos + 1, 2))} | ${pair(b, a, (t) => `${num(t.medianInstPaybackS, 0)} s`)} | ` +
          `${pair(b, a, (t) => num(t.medianInstPrompts, 2))} | ${pair(b, a, (t) => pct(t.paidRate))} | ${pair(b, a, (t) => inf(t.medianPaidPrompts))} | ` +
          `${pair(b, a, (t) => pct(t.boughtRate))} | ${pair(b, a, (t) => pct(t.medianEndShare))} |`,
      );
    }
  }
  return lines.join('\n');
}

function pickupTable(before: Pass2Data | null, after: Pass2Data): string {
  const lines = [
    '| save | win, pickups clicked | win, pickups ignored | cost of ignoring them | Δ score |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const a of after.pickups) {
    const b = before?.pickups.find((p) => p.state === a.state);
    const d = (p: PickupLoad): string => `${sgn((p.without.winRate - p.with.winRate) * 100, 0)} pts`;
    const ds = (p: PickupLoad): string => sgn(p.without.score - p.with.score);
    lines.push(
      `| ${a.state} | ${pair(b, a, (p) => pct(p.with.winRate))} | ${pair(b, a, (p) => pct(p.without.winRate))} | ${pair(b, a, d)} | ${pair(b, a, ds)} |`,
    );
  }
  return lines.join('\n');
}

function permissionTable(before: Pass2Data | null, after: Pass2Data): string {
  const lines = [
    '| save | permission prompts / run | production lost per prompt | seconds each stalls a tool | other bad incidents / run | production lost per other incident |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const a of after.permissions) {
    const b = before?.permissions.find((p) => p.state === a.state);
    lines.push(
      `| ${a.state} | ${pair(b, a, (p) => num(p.perRun, 2))} | ${pair(b, a, (p) => `${num(p.lostS, 1)} s`)} | ${pair(b, a, (p) => `${num(p.activeS, 1)} s`)} | ` +
        `${pair(b, a, (p) => num(p.otherPerRun, 1))} | ${pair(b, a, (p) => `${num(p.otherLostS, 1)} s`)} |`,
    );
  }
  return lines.join('\n');
}

function focusTable(before: readonly NodeReport[] | undefined, after: readonly NodeReport[]): string {
  const lines = [
    '| node | verdict | purchase point: Δ score / Δ👍 | mid toggle: Δ win / Δ score | maxed knock-out: Δ win / min saved / Δ👍 |',
    '|---|---|---:|---:|---:|',
  ];
  const cells = (n: NodeReport): [string, string, string] => {
    const p = deltas(n.purchase);
    const m = deltas(n.mid);
    const x = deltas(n.maxed);
    return [
      `${sgn(p.score)} / ${sgn(p.thumbs * 100, 0)}%`,
      `${sgn(m.win * 100, 0)}% / ${sgn(m.score)}`,
      `${sgn(x.win * 100, 0)}% / ${sgn(x.minutes, 1)} / ${sgn(x.thumbs * 100, 0)}%`,
    ];
  };
  for (const a of after) {
    const b = before?.find((n) => n.id === a.id);
    const ca = cells(a);
    const cb = b ? cells(b) : null;
    const join = (i: number): string => (cb ? `${cb[i]} → **${ca[i]}**` : `**${ca[i]}**`);
    lines.push(`| ${a.name} | ${b ? `${b.verdict} → ` : ''}**${a.verdict}** | ${join(0)} | ${join(1)} | ${join(2)} |`);
  }
  lines.push('');
  for (const a of after) lines.push(`- **${a.name}** (${a.verdict}): ${a.why}.`);
  return lines.join('\n');
}

/** The second pass's own before/after section of the report. */
export function pass2Section(before: Pass2Data | null, after: Pass2Data): string {
  const out: string[] = [];
  out.push('## Second pass: before and after');
  out.push('');
  out.push(
    before
      ? `"Before" is the content the first pass committed, measured by this pass's bot (\`tools/balance/pass1.json\`); "after" is this pass. ` +
          `Same seeds for both: ${after.seedCount} per state for the tables and traces, ${after.nodeSeeds} per arm (and ${after.nodeSeeds * 3} for re-runs) for the A/B tests and node weights.`
      : 'No first-pass measurement found (tools/balance/pass1.json).',
  );
  out.push('');
  out.push(statesTable(before, after));
  out.push('');
  out.push('### 1. The top of the ladder pays back');
  out.push('');
  out.push(
    'For every tier, the moment its first unit became affordable in a competent run: what one unit would pay back at that moment, ' +
      'and whether one unit\'s actual output (at the run\'s real, growing multipliers) repaid its price before the run ended. ' +
      '"Prompts to repay" is measured in prompts of the run (1.5 = one and a half prompts later); runs that never repaid count as never.',
  );
  out.push('');
  out.push(tiersTable(before, after));
  out.push('');
  out.push('### 2. Pickups are a bonus');
  out.push('');
  out.push('The competent bot with pickups (it clicks 85% of them) and ignoring every one, same seeds.');
  out.push('');
  out.push(pickupTable(before, after));
  out.push('');
  out.push('### 3. Permission prompts are worth removing');
  out.push('');
  out.push(
    'Auto Mode does not make bad incidents rarer: the scheduler rolls "bad" first and then picks among the bad incidents that can fire, ' +
      'so removing the permission prompts hands their share to the others (and adds rm -rf). It pays only if a permission prompt costs more ' +
      'than the incident that replaces it. Production lost is in seconds of the run\'s clean output (tools plus sustained clicking).',
  );
  out.push('');
  out.push(permissionTable(before, after));
  out.push('');
  out.push('### Node weights for the nodes this pass targeted (competent policy)');
  out.push('');
  out.push(focusTable(before?.nodes, after.nodes));
  out.push('');
  out.push('### 4. The insurance nodes, for the player who makes the mistakes (careless policy)');
  out.push('');
  out.push(
    'Better Summaries keeps wallet through forced compactions and Plausible Deniability softens a caught claim; the competent bot rarely ' +
      'does either. Here every arm is played by the `careless` policy, which never /compacts and claims in a last-second panic.',
  );
  out.push('');
  out.push(focusTable(before?.careless, after.careless));
  if (after.mistakes?.length) {
    out.push('');
    out.push(
      'The same two nodes for the exact mistake each insures, played by the competent bot with one skill removed: ' +
        'Better Summaries for a player who never /compacts (so every overflow is forced, with the wallet full), ' +
        'Plausible Deniability for `always-claim` (claims the moment the amber button lights, so it gets caught).',
    );
    out.push('');
    out.push(focusTable(before?.mistakes, after.mistakes));
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// The reasoning, with the measured numbers filled in
// ---------------------------------------------------------------------------

function tier(d: Pass2Data | null, state: MetaStateName, id: string): TierSummary | undefined {
  return d?.tiers[state]?.find((t) => t.id === id);
}
function node(list: readonly NodeReport[] | undefined, id: string): NodeReport | undefined {
  return list?.find((n) => n.id === id);
}
function pk(d: Pass2Data | null, state: MetaStateName): PickupLoad | undefined {
  return d?.pickups.find((p) => p.state === state);
}
/** Win points a node is worth in the mid toggle (positive: owning it helps). */
function midPts(n: NodeReport | undefined): string {
  return n ? `${sgn(deltas(n.mid).win * 100, 0)} points` : '—';
}
function verdict(n: NodeReport | undefined): string {
  return n ? n.verdict : '—';
}

/** "What changed, and why" for the second pass. Mechanisms by hand, numbers measured. */
export function reasoning2(before: Pass2Data | null, after: Pass2Data): string {
  const r10b = tier(before, 'maxed', 'rsi');
  const r10a = tier(after, 'maxed', 'rsi');
  const r10bm = tier(before, 'mid', 'rsi');
  const r10am = tier(after, 'mid', 'rsi');
  const r9a = tier(after, 'maxed', 'ralph_loop');
  const pkb = pk(before, 'mid');
  const pka = pk(after, 'mid');
  const pkxa = pk(after, 'maxed');
  const permB = before?.permissions.find((p) => p.state === 'mid');
  const permA = after.permissions.find((p) => p.state === 'mid');
  const lost = (p: PickupLoad | undefined): string => (p ? `${Math.round((p.with.winRate - p.without.winRate) * 100)} points` : '—');
  const bs = node(after.careless, 'better_summaries');
  const dn = node(after.careless, 'deniability');
  const bsm = node(after.mistakes, 'better_summaries');
  const dnm = node(after.mistakes, 'deniability');
  const midCareless = bs ? deltas(bs.mid) : null;
  const am = node(after.nodes, 'auto_mode');
  return `## Second pass: what changed, and why

All edits are numeric literals in \`src/sim/content.ts\`. The tooling gained instrumented runs (\`tools/balance/diag.ts\`: tier payback, per-incident and per-pickup cost), \`ab\`, \`tiers\`, \`costs\` and \`prompts\` modes, this before/after (\`pass2.ts\`, \`pass1.json\`), and one fix to the bot: it no longer buys Allowlist and Always Allow once Auto Mode has removed the prompts they reduce (it used to, in every deep and maxed run).

**1. The top of the ladder.** \`TIER_RATE_GROWTH\` 10 → 8 and \`TIER_PAYBACK_GROWTH\` 1.5 → 1.41, so a tier makes about 8× the last and costs about 11.3×, not 10× and 15×. Ralph Loop's upgrades An Exit Condition ×2 → ×1.3 and Nested Ralph ×3 → ×1.6; Recursive Self-Improvement's Its Own Benchmarks ×2 → ×4.
Tier 10 used to cost half of prompt 10's requirement, so its first unit became affordable halfway through the last prompt (at prompt ${num((r10b?.medianFirstPos ?? NaN) + 1, 1)} on a maxed save), when it could no longer bring the report closer: the bot bought it in ${pct(r10b?.boughtRate)} of maxed runs and ${pct(r10bm?.boughtRate)} of mid ones. Tier 9 did pay back, in under half a prompt, but it was a substitute rather than a step: by the time a tier arrives the one below has a dozen or more units with both upgrades (×6), and its next unit is about as token-efficient as the new tier's first. Knocking the new tier out only meant a few more units of the old one, so neither unlock moved a win. Costs now grow slower than the requirement, so tiers 9 and 10 arrive about a prompt earlier (prompts ${num((r9a?.medianFirstPos ?? NaN) + 1, 1)} and ${num((r10a?.medianFirstPos ?? NaN) + 1, 1)} on a maxed save) and one unit repays itself in ${num(r10a?.medianPaidPrompts, 2)} prompts; the bot buys RSI in ${pct(r10a?.boughtRate)} of maxed runs and ${pct(r10am?.boughtRate)} of mid ones. Softer Ralph upgrades keep RSI's first units well ahead of Ralph's marginal one, which is what makes RSI worth unlocking on its own: at mid, owning Ralph Loop (and with it RSI) is worth ${midPts(node(after.nodes, 'unlock_ralph'))} and owning RSI ${midPts(node(after.nodes, 'unlock_rsi'))}.

**2. Pickups.** Golden Token 20% → 3% of the requirement, A Bug 10% → 1.5%, "thanks!" 20% → 5% of the bar; Documentation 12 → 8 s, Accepted Answer 8 → 6 s, ✨ 10 → 20 s; the spawn gap 20–34 s → 28–44 s (with Serendipity 13–22 → 18–30 s).
With the first pass's numbers, ignoring every pickup cost a mid save ${lost(pkb)} of win rate: Golden Token and A Bug alone carried about 40 and "thanks!" about 25. Lucky Tokens' rare pickups are worth almost nothing for winning (a free top-tier unit, a crit buff, a 👍), yet each one displaces a common spawn, and one spawn in eight used to be worth a fifth of a prompt. Now ignoring pickups costs mid ${lost(pka)} and maxed ${lost(pkxa)}, Lucky Tokens is ${midPts(node(after.nodes, 'lucky_tokens'))} at mid (${verdict(node(after.nodes, 'lucky_tokens'))}, on its 👍) and Serendipity ${midPts(node(after.nodes, 'serendipity'))}, in line with the other nodes of its price. Cache Hit is the one pickup left with real weight: its blurb pins it at "a fifth" of the window, so only its spawn rate could move.

**3. Permission prompts and Auto Mode.** MCP Needs Auth weight 2 → 24, 20 → 150 s, 10 → 1 200 clicks; Web Search Wants Permission weight 2 → 3, 20 → 45 s, 8 → 250 clicks; Bash Wants Permission 20 → 30 s, 8 → 100 clicks. rm -rf weight 0.25 → 0.1. OAuth, Finally: MCP ×3 → ×5, permission prompts ×0.5 → ×0.8; Tool Search: MCP ×1.5 → ×2. Allowlist ×0.6 → ×0.7.
Auto Mode does not make bad incidents rarer. The scheduler rolls "bad" first and then picks among the bad incidents that can fire, so a removed permission prompt hands its slot to another incident, and rm -rf joins the pool. Auto Mode pays only if a permission prompt costs more than its replacement *in the prompts that decide a run*. Bash and Web Search are idle by prompt 7, so late in a run their prompts are free slots, and early production losses wash out (each prompt's output is dominated by the tier bought during it). Making all three prompts twenty times as costly moved neither mid's win rate nor Auto Mode's effect, with or without rm -rf. What works is MCP: stronger OAuth and Tool Search keep MCP Servers a real share of mid's output to the end, and MCP Needs Auth now waits out its 150 s unless the player has auto-clickers, so it is a common, costly prompt in the prompts that matter. A mid permission prompt now costs ${num(permA?.lostS, 1)} s of production (it was ${num(permB?.lostS, 1)} s), against ${num(permA?.otherLostS, 1)} s for the other bad incidents plus their wallet, patience and context lumps. Auto Mode at mid: ${midPts(node(after.nodes, 'auto_mode'))} (${verdict(node(after.nodes, 'auto_mode'))}). Bash and Web Search stay mild, and fresh and early saves own no MCP Servers, so the first runs are untouched.

**4. Better Summaries and Plausible Deniability.** No change. For the \`careless\` policy both are exactly zero (${verdict(bs)} and ${verdict(dn)}, every delta ${midCareless ? sgn(midCareless.score) : '—'}): careless spends its whole wallet every second, so a forced compaction never has a wallet to keep, and it never holds the half-requirement a claim needs. They are not positive for the careless policy and cannot be: it never makes the mistakes they insure. Played by the competent bot with one skill removed, Plausible Deniability for \`always-claim\` ${verdict(dnm)} (${dnm ? sgn(deltas(dnm.mid).score) : '—'} score at mid). Better Summaries for a player who never /compacts was worth ${midPts(node(before?.mistakes, 'better_summaries'))} at mid before this pass and ${midPts(bsm)} now (${verdict(bsm)} on the re-run), so ${!bsm || bsm.verdict === 'dead' || bsm.verdict === 'harmful' || bsm.verdict === 'mixed' ? 'this pass cannot confirm it for that player either' : 'it still pays for that player'}.

**Rebalancing.** \`PATIENCE_DECAY\` 0.95 → 0.96 and \`PATIENCE_BASE_MS\` 120 → 119 s (the last prompts get about 9% more time, the first about the same); Inference Budget level 3 10 000 → 25 000 tokens; Character ×1.05/×1.1/×1.2 → ×1.08/×1.12/×1.2.
Weaker pickups and costlier MCP prompts took mid down to about a third; the flatter ladder gives most of that back, but a stronger ladder also shortens maxed runs (below 15 minutes at a payback growth of 1.40). Late patience wins mid back without that cost: mid is patience-bound (it uses 90–100% of each late bar) while maxed uses a quarter to two thirds, so late patience lengthens mid's wins more than maxed's. The two mid-only levers are nodes mid owns below their top level. Inference Budget level 3 is why mid used to spend about 70 s on prompt 2 (it started with 10 000 tokens to deep and maxed's 60 000); a bigger start there and Character level 1 bring mid's winning runs back under 24 minutes.

## Design concerns for the integrator (second pass)

- **Auto Mode replaces permission prompts; it does not remove them.** That is why it was dead, and why only MCP Needs Auth could make it pay. A structural fix would let Auto Mode skip the roll (or roll the tone again) when it removes a prompt, or give the late tools \`needsPermission\`. Even now it is slightly negative at its purchase point (${am ? sgn(deltas(am.purchase).score) : '—'} score) and on a maxed save (winning runs ${am ? num(-deltas(am.maxed).minutes, 1) : '—'} min longer), neither significant: those saves hold wallets several times the requirement, so the incidents that replace the prompts (Revert That, Lost In The Middle) cost more than the MCP stalls it removes.
- **MCP Needs Auth is now the most common bad incident once MCP Servers are owned** (about a third of them before Always Allow) and waits out 150 s. That is the tax Auto Mode, Allowlist, Always Allow and OAuth, Finally remove, but the HUD should show its countdown rather than 1 200 clicks.
- **rm -rf is 2.5× rarer**, so its hidden achievement is harder to find.
- **Stale text outside the numbers:** content.ts's tool-ladder comment and DESIGN.md ("Each tier costs about 15× the last … a new tier arrives roughly once per prompt") now read 8× and 11.3×, with tiers 9–10 about a prompt early.
- **Cache Hit** keeps the most weight of any pickup because its blurb pins its size; "a tenth" would let it shrink too.
- **Small nodes sit at the noise floor.** At the node table's 96 seeds (288 on the re-run) Temperature, System Prompt and Initiative read dead. A 600-seed check at mid (\`node tools/balance/run-balance.mjs ab mid 600 14 base -temperature -system_prompt +unlock_initiative\`) found Temperature and System Prompt still pay (removing them cost 0.18 and 0.21 score, 2.1σ and 2.3σ), while Initiative is slightly negative at mid, as it was in the first pass: its auto-clicks fill a 200K window (manual compactions 0.21 → 0.26 per prompt).
- **Still open from the first pass:** sycophancy restores a share of the *max* bar, so every patience multiplier multiplies flattery (now with 9% more patience late, the worst sustained case is still under the drain); holding for the bonus 👍 still pays (see "Holding pays" below).
`;
}
