/**
 * Cartesian sweep: {policies} × {meta-tree states} × {N seeds}, aggregated.
 */
import type { AgentTierId, CardId, MetaState, MetaUpgradeId } from '@sim/types.ts';
import {
  metaRequirementsMet,
  AGENT_TIER_IDS,
  CARDS,
  FINAL_PROJECT_INDEX,
  META_UPGRADES,
  TOTAL_META_COST,
  defaultMeta,
  metaNextCost,
} from '@sim/index.ts';
import type { ClickModel, PolicyId } from './policy.ts';
import { POLICY_IDS } from './policy.ts';
import type { RunResult } from './run.ts';
import { runOne } from './run.ts';

// ---------------------------------------------------------------------------
// Meta-tree states
// ---------------------------------------------------------------------------

export type MetaStateName = 'fresh' | 'early' | 'mid' | 'deep' | 'maxed';

export const META_STATE_NAMES: readonly MetaStateName[] = ['fresh', 'early', 'mid', 'deep', 'maxed'];

/** Demo budget each named state represents. `maxed` buys the whole tree. */
export const META_BUDGETS: Readonly<Record<MetaStateName, number>> = {
  // Re-derived for the tree: unlocks cost more than the old +% ladder did, so
  // the same budget buys fewer nodes. These now track "runs played" more
  // honestly — fresh is run 1, early is a couple of runs in.
  fresh: 0,
  early: 12,
  mid: 80,
  deep: 260,
  maxed: Number.POSITIVE_INFINITY,
};

/**
 * The order a reasonable player spends Demos in. Repeated ids mean "buy the
 * next level when you come back around"; the builder walks the list in passes.
 * Endless Mode sits last — it removes the win state, so only `maxed` takes it.
 */
export const META_PRIORITY: readonly MetaUpgradeId[] = [
  // Content unlocks first — a raised ceiling beats a raised percentage, and
  // the agent ladder is the only thing that lifts the production cap at all.
  'unlock_swarm',
  'cracked',
  'unlock_model_cards',
  'seed_funding',
  'unlock_ralph',
  'unlock_autoclicker',
  'unlock_yolo',
  'technical_cofounder',
  'unlock_harness',
  'idle_hands',
  'prompt_library',
  'incubator',
  'unlock_fleet',
  'reroll_token',
  'unlock_skip',
  'founder_mode',
  'unlock_headless',
  'unlock_rare_cards',
  'unlock_farm',
  'hype_machine',
  'snack_drawer',
  'scope_negotiator',
  'unlock_agi',
];

/**
 * Endless Mode is a completionist buy, not a power buy — it removes the win
 * state, so the builder only takes it once the rest of the tree is maxed.
 */
export const META_LAST: readonly MetaUpgradeId[] = ['endless_mode'];

export interface BuiltMeta {
  readonly name: MetaStateName;
  readonly meta: MetaState;
  readonly spent: number;
  readonly levels: Readonly<Record<MetaUpgradeId, number>>;
}

/** Spend a Demo budget down the priority list, one level per pass. */
export function metaForBudget(name: MetaStateName, budget = META_BUDGETS[name]): BuiltMeta {
  const meta = defaultMeta();
  let spent = 0;
  if (!Number.isFinite(budget)) {
    for (const def of META_UPGRADES) meta.levels[def.id] = def.maxLevel;
    return { name, meta, spent: TOTAL_META_COST, levels: { ...meta.levels } };
  }
  meta.demos = budget;
  const buy = (id: MetaUpgradeId): boolean => {
    // Tree edges are gates: a node whose parents are unowned cannot be bought
    // at any budget, so the builder has to walk the same order a player does.
    if (!metaRequirementsMet(meta, id)) return false;
    const cost = metaNextCost(meta, id);
    if (!Number.isFinite(cost) || cost > meta.demos) return false;
    meta.demos -= cost;
    meta.levels[id] = (meta.levels[id] ?? 0) + 1;
    spent += cost;
    return true;
  };
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of META_PRIORITY) if (buy(id)) progressed = true;
  }
  // Only once nothing else can be bought does the completionist tail open up.
  const stalled = META_PRIORITY.every((id) => !Number.isFinite(metaNextCost(meta, id)));
  if (stalled) for (const id of META_LAST) buy(id);
  meta.demos = 0;
  return { name, meta, spent, levels: { ...meta.levels } };
}

export function allMetaStates(): BuiltMeta[] {
  return META_STATE_NAMES.map((n) => metaForBudget(n));
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** Deterministic, well-spread seed list. */
export function seeds(n: number, offset = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((i + offset) * 0x9e3779b1 + 0x2545f491) | 0 || 1);
  return out;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (i - lo);
}

export function median(values: readonly number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

export interface CellStats {
  readonly policy: PolicyId;
  readonly metaName: MetaStateName;
  readonly runs: number;
  readonly medianShipped: number;
  readonly meanShipped: number;
  readonly p05Shipped: number;
  readonly p95Shipped: number;
  readonly winRate: number;
  /** Fraction of runs that died on each project number (1-based, index 0 unused). */
  readonly deathHistogram: readonly number[];
  readonly meanDemos: number;
  readonly medianDemos: number;
  readonly meanSecondsPerProject: readonly number[];
  readonly meanRunSeconds: number;
  readonly meanPurchases: number;
  readonly meanIncidents: number;
  readonly peakIdleRate: number;
  /** Share of decisions where the wallet was already over the ship bar. */
  readonly shipReadyRate: number;
  /** Share of decisions in which buying and shipping actually competed. */
  readonly tensionRate: number;
  readonly buyOverShipRate: number;
  readonly bankedRate: number;
  readonly anyInvalid: boolean;
  readonly stepCapped: number;
  readonly bestTierCounts: Readonly<Record<AgentTierId, number>>;
  readonly cardPickCounts: Readonly<Record<CardId, number>>;
}

export function summarize(
  policy: PolicyId,
  metaName: MetaStateName,
  results: readonly RunResult[],
): CellStats {
  const shipped = results.map((r) => r.shipped);
  const sortedShipped = [...shipped].sort((a, b) => a - b);
  const demos = results.map((r) => r.demos);
  const deathHistogram = new Array<number>(FINAL_PROJECT_INDEX + 3).fill(0);
  for (const r of results) {
    const bucket = Math.min(r.shipped + 1, deathHistogram.length - 1);
    deathHistogram[bucket] = (deathHistogram[bucket] ?? 0) + 1;
  }

  const perProject: number[][] = [];
  for (const r of results) {
    r.secondsPerProject.forEach((s, i) => {
      const bucket = perProject[i] ?? (perProject[i] = []);
      bucket.push(s);
    });
  }

  const bestTierCounts = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) bestTierCounts[id] = 0;
  const cardPickCounts: Record<CardId, number> = {};
  for (const c of CARDS) cardPickCounts[c.id] = 0;
  let decisions = 0;
  let shipReady = 0;
  let tension = 0;
  let buyOverShip = 0;
  let banked = 0;
  for (const r of results) {
    decisions += r.decisions;
    shipReady += r.shipReadyDecisions;
    tension += r.tensionDecisions;
    buyOverShip += r.buyOverShipDecisions;
    banked += r.bankedDecisions;
    for (const id of AGENT_TIER_IDS) bestTierCounts[id] += r.bestTierCounts[id];
    for (const c of r.cards) cardPickCounts[c] = (cardPickCounts[c] ?? 0) + 1;
  }

  return {
    policy,
    metaName,
    runs: results.length,
    medianShipped: quantile(sortedShipped, 0.5),
    meanShipped: mean(shipped),
    p05Shipped: quantile(sortedShipped, 0.05),
    p95Shipped: quantile(sortedShipped, 0.95),
    winRate: results.length ? results.filter((r) => r.won).length / results.length : 0,
    deathHistogram,
    meanDemos: mean(demos),
    medianDemos: median(demos),
    meanSecondsPerProject: perProject.map((b) => mean(b)),
    meanRunSeconds: mean(results.map((r) => r.elapsedS)),
    meanPurchases: mean(results.map((r) => r.purchases)),
    meanIncidents: mean(results.map((r) => r.incidentsBad + r.incidentsGood)),
    peakIdleRate: Math.max(0, ...results.map((r) => r.peakIdleRate)),
    shipReadyRate: decisions ? shipReady / decisions : 0,
    tensionRate: decisions ? tension / decisions : 0,
    buyOverShipRate: decisions ? buyOverShip / decisions : 0,
    bankedRate: decisions ? banked / decisions : 0,
    anyInvalid: results.some((r) => r.invalid),
    stepCapped: results.filter((r) => r.cause === 'step-cap').length,
    bestTierCounts,
    cardPickCounts,
  };
}

// ---------------------------------------------------------------------------
// The sweep itself
// ---------------------------------------------------------------------------

export interface SweepOptions {
  readonly policies?: readonly PolicyId[];
  readonly metaStates?: readonly MetaStateName[];
  readonly seedCount?: number;
  readonly seedOffset?: number;
  readonly clicks?: ClickModel;
  readonly stepMs?: number;
  readonly decisionEveryMs?: number;
  /** Keep every RunResult, not just the aggregate. Off by default (memory). */
  readonly keepRuns?: boolean;
}

export interface SweepReport {
  readonly cells: readonly CellStats[];
  readonly metas: readonly BuiltMeta[];
  readonly seedCount: number;
  readonly runsByKey: Readonly<Record<string, readonly RunResult[]>>;
  readonly wallMs: number;
}

export function cellKey(policy: PolicyId, metaName: MetaStateName): string {
  return `${policy}/${metaName}`;
}

export function runCell(
  policy: PolicyId,
  built: BuiltMeta,
  seedList: readonly number[],
  opts: SweepOptions = {},
): RunResult[] {
  const out: RunResult[] = [];
  for (const seed of seedList) {
    out.push(
      runOne({
        seed,
        policy,
        meta: built.meta,
        metaName: built.name,
        ...(opts.clicks ? { clicks: opts.clicks } : {}),
        ...(opts.stepMs ? { stepMs: opts.stepMs } : {}),
        ...(opts.decisionEveryMs ? { decisionEveryMs: opts.decisionEveryMs } : {}),
      }),
    );
  }
  return out;
}

export function sweep(opts: SweepOptions = {}): SweepReport {
  const started = Date.now();
  const policies = opts.policies ?? POLICY_IDS;
  const stateNames = opts.metaStates ?? META_STATE_NAMES;
  const seedList = seeds(opts.seedCount ?? 120, opts.seedOffset ?? 0);
  const metas = stateNames.map((n) => metaForBudget(n));

  const cells: CellStats[] = [];
  const runsByKey: Record<string, readonly RunResult[]> = {};
  for (const policy of policies) {
    for (const built of metas) {
      const results = runCell(policy, built, seedList, opts);
      cells.push(summarize(policy, built.name, results));
      if (opts.keepRuns) runsByKey[cellKey(policy, built.name)] = results;
    }
  }

  return {
    cells,
    metas,
    seedCount: seedList.length,
    runsByKey,
    wallMs: Date.now() - started,
  };
}
