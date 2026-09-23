/**
 * Training (the meta tree): the order a sensible player buys it in, the named
 * meta states the sweep measures, and a whole career from a fresh save.
 *
 * Every meta state is a *prefix* of one purchase order, so "mid" is literally
 * what the "early" player becomes after a few more runs. Levels are bought
 * through `Sim.buyMeta`, the same gate the Training screen uses, so the tree
 * edges are enforced by the sim rather than trusted.
 */
import type { MetaState, MetaUpgradeId } from '@sim/types.ts';
import { META_BY_ID, META_UPGRADES, createSim, defaultMeta, metaNextCost } from '@sim/index.ts';
import type { ClickModel, PolicyId } from './policy.ts';
import { HUMAN_CLICKS } from './policy.ts';
import type { RunResult } from './run.ts';
import { cloneMeta, runOne } from './run.ts';

/**
 * One entry per level. The shape a player follows: /compact and the first
 * multipliers, then the tool ladder interleaved with the window sizes that
 * make it survivable, the alignment ladder for patience, and the long tail
 * (claims, cards, 👍 multipliers) last.
 */
export const TRAINING_ORDER: readonly MetaUpgradeId[] = [
  // --- runs 1-3: the obvious buys --------------------------------------------
  'unlock_compact',
  'tool_use',
  'helpful',
  'unlock_web',
  // Honest is the steady 👍 income: a thrifty player takes it early.
  'rlhf',
  'harmless',
  'honest',
  'context_window', // 32K
  'pretraining',
  'tool_use',
  'unlock_subagent',
  'prompt_library',
  'pretraining',
  'helpful',
  // --- the ladder, with room to run it ---------------------------------------
  'context_window', // 128K
  'unlock_mcp',
  'tool_use',
  'inference_budget',
  'spec_gaming',
  'pretraining',
  'unlock_team',
  'longer_summaries',
  'tool_use',
  'temperature',
  'helpful',
  'context_window', // 200K
  'inference_budget',
  'pretraining',
  'unlock_ralph',
  'unlock_mocks',
  'harmless',
  'distillation',
  'better_summaries',
  'rlhf',
  'few_shot',
  'tool_use',
  'confident',
  'distillation',
  'quantization',
  'unlock_rsi',
  'pretraining',
  'helpful',
  'unlock_scratchpad',
  'inference_budget',
  'spec_gaming',
  'unlock_viral',
  'constitution',
  'longer_summaries',
  'kv_cache',
  'unlock_orchestration',
  'quantization',
  'distillation',
  'better_summaries',
  'confident',
  'unlock_jailbreak',
  'system_prompt',
  'character',
  // --- mid-career: finishing ladders -------------------------------------------
  'tool_use',
  'rlhf',
  'harmless',
  'temperature',
  'kv_cache',
  'pretraining',
  'context_window', // 1M
  'deniability',
  'inference_budget',
  'unlock_sampling',
  'character',
  'better_summaries',
  'few_shot',
  'spec_gaming',
  'unlock_initiative',
  'quantization',
  'auto_mode',
  'kv_cache',
  'longer_summaries',
  // --- the long tail -----------------------------------------------------------
  'context_window', // 10M
  'unlock_pruning',
  'confident',
  'serendipity',
  'goodhart',
  'deniability',
  'character',
  'lucky_tokens',
  'goodhart',
  'goodhart',
];

/** Endless removes the win state, so "maxed" stops short of it. */
export const EXCLUDED_FROM_MAXED: readonly MetaUpgradeId[] = ['endless_mode'];

/** 👍 cost of the whole tree except Endless: what "maxed" spends. */
export function maxedCost(): number {
  let total = 0;
  for (const def of META_UPGRADES) {
    if (EXCLUDED_FROM_MAXED.includes(def.id)) continue;
    total += def.costs.slice(0, def.maxLevel).reduce((a, b) => a + b, 0);
  }
  return total;
}

/**
 * Sanity of the order itself: every level of every node but Endless appears
 * exactly once, and never before its prerequisites. Empty when it is sound.
 */
export function orderProblems(order: readonly MetaUpgradeId[] = TRAINING_ORDER): string[] {
  const problems: string[] = [];
  const levels: Record<string, number> = {};
  for (const id of order) {
    const def = META_BY_ID[id];
    if (!def) {
      problems.push(`unknown node ${id}`);
      continue;
    }
    for (const req of def.requires) {
      if ((levels[req] ?? 0) < 1) problems.push(`${id} listed before its prerequisite ${req}`);
    }
    levels[id] = (levels[id] ?? 0) + 1;
    if ((levels[id] ?? 0) > def.maxLevel) problems.push(`${id} listed past its max level`);
  }
  for (const def of META_UPGRADES) {
    if (EXCLUDED_FROM_MAXED.includes(def.id)) continue;
    if ((levels[def.id] ?? 0) !== def.maxLevel) {
      problems.push(`${def.id} listed ${levels[def.id] ?? 0}/${def.maxLevel} times`);
    }
  }
  return problems;
}

/**
 * Buy Training in order through the sim's own gate, stopping at the first
 * level the 👍 cannot cover (a player saves up for the next thing on the
 * list rather than skipping ahead). Returns the 👍 spent.
 */
export function spendInOrder(meta: MetaState, order: readonly MetaUpgradeId[] = TRAINING_ORDER): number {
  const sim = createSim({ meta, storage: null, persist: false, autoStart: false, trustSave: true, legacyStorage: null });
  let spent = 0;
  const bought: Record<string, number> = {};
  for (const id of order) {
    // Entries already covered by the save's levels are skipped.
    const want = (bought[id] ?? 0) + 1;
    bought[id] = want;
    if ((meta.levels[id] ?? 0) >= want) continue;
    const cost = metaNextCost(meta, id);
    if (!Number.isFinite(cost) || cost > meta.thumbs) break;
    if (!sim.buyMeta(id)) break;
    spent += cost;
  }
  return spent;
}

/** True once every node except Endless is at its max level. */
export function treeMaxed(meta: MetaState): boolean {
  return META_UPGRADES.every(
    (def) => EXCLUDED_FROM_MAXED.includes(def.id) || (meta.levels[def.id] ?? 0) >= def.maxLevel,
  );
}

export function thumbsSpent(meta: MetaState): number {
  let s = 0;
  for (const def of META_UPGRADES) {
    const l = Math.max(0, Math.min(def.maxLevel, meta.levels[def.id] ?? 0));
    s += def.costs.slice(0, l).reduce((a, b) => a + b, 0);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Named meta states
// ---------------------------------------------------------------------------

export type MetaStateName = 'fresh' | 'early' | 'mid' | 'deep' | 'maxed';

export const META_STATE_NAMES: readonly MetaStateName[] = ['fresh', 'early', 'mid', 'deep', 'maxed'];

/** Share of the maxed cost each state has spent (early is an absolute 25 👍). */
export const META_SHARES: Readonly<Record<Exclude<MetaStateName, 'early'>, number>> = {
  fresh: 0,
  mid: 0.5,
  deep: 0.8,
  maxed: 1,
};
export const EARLY_BUDGET = 25;

export interface BuiltMeta {
  readonly name: MetaStateName;
  readonly meta: MetaState;
  readonly spent: number;
  readonly budget: number;
}

export function budgetFor(name: MetaStateName): number {
  if (name === 'early') return EARLY_BUDGET;
  return Math.round(META_SHARES[name] * maxedCost());
}

/** The save a player has after spending `budget` 👍 down the order. */
export function metaForBudget(name: MetaStateName, budget = budgetFor(name)): BuiltMeta {
  const meta = defaultMeta();
  meta.legacy = { verdict: 'none' };
  meta.thumbs = budget;
  meta.totalThumbsEarned = budget;
  const spent = spendInOrder(meta);
  // Leftover 👍 would otherwise leak into the run; bank it as unspent.
  return { name, meta, spent, budget };
}

export function allMetaStates(): BuiltMeta[] {
  return META_STATE_NAMES.map((n) => metaForBudget(n));
}

// ---------------------------------------------------------------------------
// A career: fresh save to a maxed tree
// ---------------------------------------------------------------------------

export interface CareerRun {
  readonly run: number;
  readonly won: boolean;
  readonly reachedPrompt: number;
  readonly thumbs: number;
  readonly minutes: number;
  /** 👍 spent on Training after this run, and the running total. */
  readonly spentAfter: number;
  readonly treeSpent: number;
}

export interface CareerResult {
  readonly seed: number;
  readonly runs: number;
  readonly hours: number;
  readonly maxed: boolean;
  /** First run number that won, or 0. */
  readonly firstWin: number;
  readonly wins: number;
  readonly log: readonly CareerRun[];
}

export interface CareerOptions {
  readonly seed: number;
  readonly policy?: PolicyId;
  readonly clicks?: ClickModel;
  /** Give up after this many runs. */
  readonly maxRuns?: number;
  readonly stepMs?: number;
}

/** Deterministic per-run seed inside a career. */
function careerSeed(seed: number, run: number): number {
  return (Math.imul(seed ^ 0x51ed_270b, 0x9e3779b1) + run * 0x632b_e5ab) | 0 || 1;
}

export function career(opts: CareerOptions): CareerResult {
  const maxRuns = opts.maxRuns ?? 80;
  let meta = defaultMeta();
  meta.legacy = { verdict: 'none' };
  const log: CareerRun[] = [];
  let seconds = 0;
  let firstWin = 0;
  let wins = 0;
  for (let n = 1; n <= maxRuns && !treeMaxed(meta); n++) {
    const r: RunResult = runOne({
      seed: careerSeed(opts.seed, n),
      policy: opts.policy ?? 'competent',
      meta,
      metaName: `career#${n}`,
      clicks: opts.clicks ?? HUMAN_CLICKS,
      ...(opts.stepMs ? { stepMs: opts.stepMs } : {}),
    });
    meta = cloneMeta(r.metaAfter);
    seconds += r.elapsedS;
    if (r.won) {
      wins += 1;
      if (firstWin === 0) firstWin = n;
    }
    const spentAfter = spendInOrder(meta);
    log.push({
      run: n,
      won: r.won,
      reachedPrompt: r.reachedPrompt,
      thumbs: r.thumbs,
      minutes: r.elapsedS / 60,
      spentAfter,
      treeSpent: thumbsSpent(meta),
    });
  }
  return { seed: opts.seed, runs: log.length, hours: seconds / 3600, maxed: treeMaxed(meta), firstWin, wins, log };
}
