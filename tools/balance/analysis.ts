/**
 * Controlled experiments beyond the plain sweep: degenerate strategies, the
 * sycophancy stall test, and what context management is worth. Every arm runs
 * over the same seed list, so the only difference between arms is the policy
 * or the content it may buy.
 */
import type { MetaState } from '@sim/types.ts';
import {
  BALANCE,
  CARD_BY_ID,
  META_BY_ID,
  UPGRADE_BY_ID,
  baseAggregate,
  createSim,
  metaCurve,
  META_CURVES,
  promptPatienceMs,
  sycophancyPowerOf,
} from '@sim/index.ts';
import type { Job, LiteResult } from './parallel.ts';
import { byKey, runJobs } from './parallel.ts';
import type { ClickModel, PolicyId, PolicyOptions } from './policy.ts';
import { SLOW_CLICKS } from './policy.ts';
import type { BuiltMeta, MetaStateName } from './meta.ts';
import { META_STATE_NAMES, metaForBudget } from './meta.ts';
import { mean, median, promptsPlayed, quantile, seeds } from './sweep.ts';

// ---------------------------------------------------------------------------
// Arm statistics
// ---------------------------------------------------------------------------

export interface ArmStats {
  readonly label: string;
  readonly runs: number;
  readonly winRate: number;
  readonly meanReached: number;
  readonly medianReached: number;
  /** Prompts completed plus progress on the last one: a continuous strength score. */
  readonly score: number;
  readonly scoreSe: number;
  readonly medianWinMinutes: number;
  /** Standard error of that median (≈ 1.25 σ / √wins); NaN below two wins. */
  readonly winMinutesSe: number;
  readonly forcedPerPrompt: number;
  readonly manualPerPrompt: number;
  /** Forced plus manual compactions per prompt, averaged per run, with its standard error. */
  readonly compactionsPerPrompt: number;
  readonly compactionsSe: number;
  readonly meanThumbs: number;
  readonly thumbsSe: number;
  readonly claimsPerRun: number;
  readonly caughtPerRun: number;
  readonly caughtSe: number;
  readonly longestPromptRatio: number;
}

function meanSe(xs: readonly number[]): { m: number; se: number } {
  const n = xs.length;
  if (n === 0) return { m: 0, se: 0 };
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
  return { m, se: n > 1 ? sd / Math.sqrt(n) : 0 };
}

export function strength(r: Pick<LiteResult, 'reported' | 'won' | 'endProgress'>): number {
  return r.reported + (r.won ? 1 : Math.min(1, Math.max(0, r.endProgress)));
}

export function armStats(label: string, rs: readonly LiteResult[]): ArmStats {
  const n = rs.length;
  const score = meanSe(rs.map(strength));
  const played = rs.reduce((s, r) => s + promptsPlayed(r), 0);
  const wins = rs.filter((r) => r.won).map((r) => r.elapsedS / 60);
  const winSd = meanSe(wins);
  const compactions = meanSe(rs.map((r) => (r.forcedCompactions + r.manualCompactions) / Math.max(1, promptsPlayed(r))));
  const thumbs = meanSe(rs.map((r) => r.thumbs));
  const caught = meanSe(rs.map((r) => r.caught));
  return {
    label,
    runs: n,
    winRate: n ? rs.filter((r) => r.won).length / n : 0,
    meanReached: mean(rs.map((r) => r.reachedPrompt)),
    medianReached: median(rs.map((r) => r.reachedPrompt)),
    score: score.m,
    scoreSe: score.se,
    medianWinMinutes: wins.length ? median(wins) : Number.NaN,
    winMinutesSe: wins.length > 1 ? 1.25 * winSd.se : Number.NaN,
    forcedPerPrompt: played ? rs.reduce((s, r) => s + r.forcedCompactions, 0) / played : 0,
    manualPerPrompt: played ? rs.reduce((s, r) => s + r.manualCompactions, 0) / played : 0,
    compactionsPerPrompt: compactions.m,
    compactionsSe: compactions.se,
    meanThumbs: thumbs.m,
    thumbsSe: thumbs.se,
    claimsPerRun: mean(rs.map((r) => r.claimsPassed + r.caught)),
    caughtPerRun: caught.m,
    caughtSe: caught.se,
    longestPromptRatio: Math.max(0, ...rs.map((r) => r.longestPromptRatio)),
  };
}

export interface ArmSpec {
  readonly label: string;
  readonly policy: PolicyId;
  readonly meta: MetaState;
  readonly metaName: string;
  readonly clicks?: ClickModel;
  readonly policyOptions?: PolicyOptions;
}

/** Play every arm over the same seeds and summarise each. */
export async function runArms(
  arms: readonly ArmSpec[],
  seedCount: number,
  workers: number,
  seedOffset = 0,
): Promise<ArmStats[]> {
  const seedList = seeds(seedCount, seedOffset);
  const jobs: Job[] = [];
  for (const a of arms) {
    for (const seed of seedList) {
      jobs.push({
        key: a.label,
        seed,
        policy: a.policy,
        meta: a.meta,
        metaName: a.metaName,
        ...(a.clicks ? { clicks: a.clicks } : {}),
        ...(a.policyOptions ? { policyOptions: a.policyOptions } : {}),
      });
    }
  }
  const grouped = byKey(await runJobs(jobs, workers));
  return arms.map((a) => armStats(a.label, grouped.get(a.label) ?? []));
}

// ---------------------------------------------------------------------------
// Degenerate strategies
// ---------------------------------------------------------------------------

export const DEGENERATE_POLICIES: readonly PolicyId[] = ['always-claim', 'no-tools', 'clicker', 'syco-spam', 'careless'];

export interface PolicyGrid {
  readonly states: readonly MetaStateName[];
  readonly policies: readonly PolicyId[];
  readonly cells: ReadonlyMap<string, ArmStats>;
}

export async function policyGrid(
  policies: readonly PolicyId[],
  seedCount: number,
  workers: number,
  states: readonly MetaStateName[] = META_STATE_NAMES,
  clicks?: ClickModel,
): Promise<PolicyGrid> {
  const metas = states.map((s) => metaForBudget(s));
  const arms: ArmSpec[] = [];
  for (const policy of policies) {
    for (const b of metas) {
      arms.push({ label: `${policy}/${b.name}`, policy, meta: b.meta, metaName: b.name, ...(clicks ? { clicks } : {}) });
    }
  }
  const stats = await runArms(arms, seedCount, workers);
  return { states, policies, cells: new Map(stats.map((s) => [s.label, s])) };
}

// ---------------------------------------------------------------------------
// Sycophancy: can "You're absolutely right!" hold the bar up forever?
// ---------------------------------------------------------------------------

export interface SycophancyCase {
  readonly label: string;
  /** Patience restored per second at the best cadence, over patience drained per second. */
  readonly sustainRatio: number;
  /** How long the bar lasts with perfect pressing and no other help, as a multiple of the bar. */
  readonly stretch: number;
  /** Empirical: seconds an idle agent pressing at the best cadence survived, over the bar. */
  readonly measuredStretch: number;
}

/**
 * The sustained ratio is the whole story: pressing once per decay period
 * restores `power x max` for `decay` seconds of drain, so
 * `ratio = power x maxS / decayS`. Below 1, patience always runs out; the
 * bar lasts `1 / (1 - ratio)` times as long. Checked analytically for a fresh
 * save and for the strongest stack in the game, and then empirically by an
 * agent that does nothing but flatter.
 */
export function sycophancyCases(): SycophancyCase[] {
  const decayS = BALANCE.SYCOPHANCY_HEAT_DECAY_MS / 1000;
  const out: SycophancyCase[] = [];
  const maxed = metaForBudget('maxed').meta;
  const patienceCards = ['grandma', 'be_helpful', 'make_no_mistakes', 'deep_breath', 'senior_dont_explain', 'human_agrees'];
  const upgrades = ['progress_updates', 'emoji_checkmarks', 'markdown_tables', 'apology_templates'];
  const cases: Array<{ label: string; meta: MetaState; owned: string[]; cards: string[] }> = [
    { label: 'fresh save, prompt 1', meta: metaForBudget('fresh').meta, owned: [], cards: [] },
    { label: 'maxed tree, all patience upgrades', meta: maxed, owned: upgrades, cards: [] },
    {
      label: 'maxed tree, every patience card too',
      meta: maxed,
      owned: upgrades,
      cards: patienceCards.filter((c) => CARD_BY_ID[c]),
    },
  ];
  for (const c of cases) {
    const sim = createSim({ seed: 7, meta: structuredClone(c.meta), storage: null, persist: false, trustSave: true, legacyStorage: null });
    for (const id of c.owned) if (UPGRADE_BY_ID[id]) sim.run.owned.push(id);
    for (const id of c.cards) sim.run.cards.push(id);
    const agg = baseAggregate(sim.run, sim.meta);
    const maxS = sim.patienceMaxMs / 1000;
    const power = sycophancyPowerOf(agg, 0);
    const ratio = (power * maxS) / decayS;
    const stretch = ratio < 1 ? 1 / (1 - ratio) : Number.POSITIVE_INFINITY;

    // Empirical: no tools, no clicks, no incidents or pickups; press once per decay.
    sim.run.patienceMs = sim.patienceMaxMs;
    sim.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
    sim.run.nextPickupInMs = Number.POSITIVE_INFINITY;
    sim.run.context = 0;
    let t = 0;
    const cap = maxS * 20 * 1000;
    while (sim.run.phase === 'running' && t < cap) {
      if (sim.run.sycophancyHeat <= 0 && sim.run.patienceMs < sim.patienceMaxMs * (1 - power)) sim.absolutelyRight();
      // Flattery context is never allowed to force a compaction in this test.
      sim.run.context = 0;
      sim.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
      sim.run.nextPickupInMs = Number.POSITIVE_INFINITY;
      sim.tick(250);
      t += 250;
    }
    out.push({ label: c.label, sustainRatio: ratio, stretch, measuredStretch: t / 1000 / maxS });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Context: does managing the window matter?
// ---------------------------------------------------------------------------

/** In-run upgrades whose job is context: footprint, click context, summaries. */
export const CONTEXT_UPGRADES: readonly string[] = [
  'concise_mode',
  'prompt_caching',
  'gitignore',
  'todo_md',
  'summary_template',
  'context_pruning',
];

/** Training nodes of the Context branch. */
export const CONTEXT_NODES: readonly string[] = [
  'unlock_compact',
  'context_window',
  'longer_summaries',
  'better_summaries',
  'unlock_scratchpad',
  'kv_cache',
  'unlock_pruning',
];

function withoutNodes(meta: MetaState, ids: readonly string[]): MetaState {
  const m = structuredClone(meta);
  for (const id of ids) if (META_BY_ID[id]) m.levels[id] = 0;
  return m;
}

export interface ContextExperiment {
  readonly state: MetaStateName;
  readonly competent: ArmStats;
  readonly noContextUpgrades: ArmStats;
  readonly noContextTraining: ArmStats;
  readonly careless: ArmStats;
}

/** Competent vs. the same player banned from context upgrades / Training, vs. careless. */
export async function contextExperiment(
  states: readonly MetaStateName[],
  seedCount: number,
  workers: number,
): Promise<ContextExperiment[]> {
  const built: BuiltMeta[] = states.map((s) => metaForBudget(s));
  const arms: ArmSpec[] = [];
  for (const b of built) {
    arms.push({ label: `${b.name}/competent`, policy: 'competent', meta: b.meta, metaName: b.name });
    arms.push({
      label: `${b.name}/no-context-upgrades`,
      policy: 'competent',
      meta: b.meta,
      metaName: b.name,
      policyOptions: { banUpgrades: CONTEXT_UPGRADES },
    });
    // The window itself stays: without it the run is a different game, not a
    // test of whether the rest of the branch pulls its weight.
    arms.push({
      label: `${b.name}/no-context-training`,
      policy: 'competent',
      meta: withoutNodes(b.meta, CONTEXT_NODES.filter((id) => id !== 'context_window')),
      metaName: b.name,
    });
    arms.push({ label: `${b.name}/careless`, policy: 'careless', meta: b.meta, metaName: b.name });
  }
  const stats = new Map((await runArms(arms, seedCount, workers)).map((s) => [s.label, s]));
  const get = (k: string): ArmStats => {
    const s = stats.get(k);
    if (!s) throw new Error(`missing arm ${k}`);
    return s;
  };
  return built.map((b) => ({
    state: b.name,
    competent: get(`${b.name}/competent`),
    noContextUpgrades: get(`${b.name}/no-context-upgrades`),
    noContextTraining: get(`${b.name}/no-context-training`),
    careless: get(`${b.name}/careless`),
  }));
}

// ---------------------------------------------------------------------------
// The slower clicker
// ---------------------------------------------------------------------------

export async function slowClickGrid(seedCount: number, workers: number): Promise<PolicyGrid> {
  return policyGrid(['competent'], seedCount, workers, META_STATE_NAMES, SLOW_CLICKS);
}

// ---------------------------------------------------------------------------
// Static facts for the report
// ---------------------------------------------------------------------------

export interface CurveRow {
  readonly prompt: number;
  readonly requirement: number;
  readonly patienceS: number;
}

export function promptCurve(): CurveRow[] {
  const rows: CurveRow[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ prompt: i + 1, requirement: BALANCE.REQ_BASE * Math.pow(BALANCE.REQ_GROWTH, i), patienceS: promptPatienceMs(i) / 1000 });
  }
  return rows;
}

/** A Training curve's value at a level, for the report's tables. */
export function curveAt(name: keyof typeof META_CURVES, level: number, unowned = 1): number {
  return metaCurve(META_CURVES[name], level, unowned);
}

export { quantile };
