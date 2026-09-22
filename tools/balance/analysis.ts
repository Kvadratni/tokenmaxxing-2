/**
 * Health checks that need controlled experiments rather than plain sweeps:
 * per-card marginal contribution, the Opus/Haiku synergy, the risk upgrades,
 * and the agent-tier leapfrog.
 *
 * Every experiment is a paired A/B over the *same* seed list, so the only
 * difference between arms is the forced or forbidden content.
 */
import type { AgentTierId, CardId, UpgradeId } from '@sim/types.ts';
import { AGENT_BY_ID, AGENT_TIERS, AGENT_TIER_IDS, CARDS, CARD_BY_ID } from '@sim/index.ts';
import type { PolicyId, PolicyOptions } from './policy.ts';
import type { RunResult } from './run.ts';
import { runOne } from './run.ts';
import type { MetaStateName } from './sweep.ts';
import { mean, metaForBudget, quantile, seeds, stdev } from './sweep.ts';

export interface ExperimentOptions {
  readonly seedCount?: number;
  readonly seedOffset?: number;
  readonly metaState?: MetaStateName;
  readonly policy?: PolicyId;
}

export interface ArmStats {
  readonly label: string;
  readonly runs: number;
  readonly meanShipped: number;
  readonly medianShipped: number;
  readonly p10Shipped: number;
  readonly p90Shipped: number;
  readonly sdShipped: number;
  readonly winRate: number;
  readonly meanDemos: number;
}

function armStats(label: string, results: readonly RunResult[]): ArmStats {
  const shipped = results.map((r) => r.shipped);
  const sorted = [...shipped].sort((a, b) => a - b);
  return {
    label,
    runs: results.length,
    meanShipped: mean(shipped),
    medianShipped: quantile(sorted, 0.5),
    p10Shipped: quantile(sorted, 0.1),
    p90Shipped: quantile(sorted, 0.9),
    sdShipped: stdev(shipped),
    winRate: results.length ? results.filter((r) => r.won).length / results.length : 0,
    meanDemos: mean(results.map((r) => r.demos)),
  };
}

interface ArmConfig {
  readonly forceCards?: readonly CardId[];
  readonly banCards?: readonly CardId[];
  readonly policyOptions?: PolicyOptions;
}

function runArm(
  label: string,
  arm: ArmConfig,
  seedList: readonly number[],
  opts: ExperimentOptions,
): { stats: ArmStats; results: RunResult[] } {
  const built = metaForBudget(opts.metaState ?? 'deep');
  const policy = opts.policy ?? 'balanced';
  const results = seedList.map((seed) =>
    runOne({
      seed,
      policy,
      meta: built.meta,
      metaName: built.name,
      ...(arm.forceCards ? { forceCards: arm.forceCards } : {}),
      ...(arm.banCards ? { banCards: arm.banCards } : {}),
      ...(arm.policyOptions ? { policyOptions: arm.policyOptions } : {}),
    }),
  );
  return { stats: armStats(label, results), results };
}

// ---------------------------------------------------------------------------
// Card health
// ---------------------------------------------------------------------------

export interface CardHealth {
  readonly id: CardId;
  readonly name: string;
  readonly rarity: string;
  /** Fraction of offers containing this card in which the drafter took it. */
  readonly pickRate: number;
  readonly offers: number;
  /** Fraction of the forced arm that actually managed to acquire it. */
  readonly acquiredRate: number;
  readonly withShipped: number;
  readonly withoutShipped: number;
  /** Mean projects added by taking it, conditioned on acquiring it. */
  readonly deltaShipped: number;
  readonly withWinRate: number;
  readonly withoutWinRate: number;
  readonly deltaWinRate: number;
  readonly verdict: 'mandatory' | 'strong' | 'fine' | 'weak' | 'dead';
}

export interface CardHealthReport {
  readonly cards: readonly CardHealth[];
  readonly metaState: MetaStateName;
  readonly seedCount: number;
  readonly baseline: ArmStats;
}

/** Near-mandatory / never-take thresholds, in projects shipped. */
export const MANDATORY_DELTA = 0.9;
export const STRONG_DELTA = 0.4;
export const WEAK_DELTA = 0.08;

export function cardHealth(opts: ExperimentOptions = {}): CardHealthReport {
  const seedList = seeds(opts.seedCount ?? 40, opts.seedOffset ?? 0);
  const metaState = opts.metaState ?? 'deep';
  const o: ExperimentOptions = { ...opts, metaState };
  const base = runArm('baseline', {}, seedList, o);

  // Observed pick rate: how often the drafter chose a card it was shown.
  const offers: Record<CardId, number> = {};
  const picks: Record<CardId, number> = {};
  for (const c of CARDS) {
    offers[c.id] = 0;
    picks[c.id] = 0;
  }
  for (const r of base.results) {
    for (const c of r.offered) offers[c] = (offers[c] ?? 0) + 1;
    for (const c of r.cards) picks[c] = (picks[c] ?? 0) + 1;
  }

  const out: CardHealth[] = [];
  for (const def of CARDS) {
    const withArm = runArm(`+${def.id}`, { forceCards: [def.id] }, seedList, o);
    const withoutArm = runArm(`-${def.id}`, { banCards: [def.id] }, seedList, o);
    const acquired = withArm.results.filter((r) => r.cards.includes(def.id)).length;
    const acquiredRate = withArm.results.length ? acquired / withArm.results.length : 0;
    const rawDelta = withArm.stats.meanShipped - withoutArm.stats.meanShipped;
    const rawWin = withArm.stats.winRate - withoutArm.stats.winRate;
    const deltaShipped = acquiredRate > 0 ? rawDelta / acquiredRate : 0;
    const deltaWinRate = acquiredRate > 0 ? rawWin / acquiredRate : 0;
    const offered = offers[def.id] ?? 0;
    const taken = picks[def.id] ?? 0;

    let verdict: CardHealth['verdict'];
    if (deltaShipped >= MANDATORY_DELTA) verdict = 'mandatory';
    else if (deltaShipped >= STRONG_DELTA) verdict = 'strong';
    else if (deltaShipped >= WEAK_DELTA) verdict = 'fine';
    else if (deltaShipped > -WEAK_DELTA) verdict = 'weak';
    else verdict = 'dead';

    out.push({
      id: def.id,
      name: def.name,
      rarity: def.rarity,
      pickRate: offered > 0 ? taken / offered : 0,
      offers: offered,
      acquiredRate,
      withShipped: withArm.stats.meanShipped,
      withoutShipped: withoutArm.stats.meanShipped,
      deltaShipped,
      withWinRate: withArm.stats.winRate,
      withoutWinRate: withoutArm.stats.winRate,
      deltaWinRate,
      verdict,
    });
  }
  out.sort((a, b) => b.deltaShipped - a.deltaShipped);
  return { cards: out, metaState, seedCount: seedList.length, baseline: base.stats };
}

// ---------------------------------------------------------------------------
// Opus / Haiku synergy
// ---------------------------------------------------------------------------

export interface SynergyReport {
  readonly arms: readonly ArmStats[];
  readonly bothAcquiredRate: number;
  readonly text: string;
}

export function synergyAnalysis(opts: ExperimentOptions = {}): SynergyReport {
  const seedList = seeds(opts.seedCount ?? 40, opts.seedOffset ?? 0);
  const o: ExperimentOptions = { ...opts, metaState: opts.metaState ?? 'deep' };
  const combos: Array<{ label: string; force?: readonly CardId[]; ban?: readonly CardId[] }> = [
    { label: 'baseline (free draft)' },
    { label: 'no Opus, no Haiku', ban: ['opus', 'haiku'] },
    { label: 'Opus only', force: ['opus'], ban: ['haiku'] },
    { label: 'Haiku only', force: ['haiku'], ban: ['opus'] },
    { label: 'Opus + Haiku', force: ['opus', 'haiku'] },
    { label: 'Sonnet only', force: ['sonnet'], ban: ['opus', 'haiku'] },
  ];
  const arms: ArmStats[] = [];
  let bothAcquiredRate = 0;
  for (const c of combos) {
    const arm = runArm(
      c.label,
      { ...(c.force ? { forceCards: c.force } : {}), ...(c.ban ? { banCards: c.ban } : {}) },
      seedList,
      o,
    );
    arms.push(arm.stats);
    if (c.label === 'Opus + Haiku') {
      const both = arm.results.filter(
        (r) => r.cards.includes('opus') && r.cards.includes('haiku'),
      ).length;
      bothAcquiredRate = arm.results.length ? both / arm.results.length : 0;
    }
  }

  const rows = arms
    .map(
      (a) =>
        `| ${a.label} | ${a.meanShipped.toFixed(2)} | ${(a.winRate * 100).toFixed(0)}% | ${a.sdShipped.toFixed(2)} |`,
    )
    .join('\n');
  const text = [
    '| arm | mean shipped | win rate | sd |',
    '|---|---:|---:|---:|',
    rows,
    '',
    `Both cards actually acquired in ${(bothAcquiredRate * 100).toFixed(0)}% of the forced runs.`,
  ].join('\n');
  return { arms, bothAcquiredRate, text };
}

// ---------------------------------------------------------------------------
// Risk upgrades
// ---------------------------------------------------------------------------

export interface RiskPair {
  readonly id: UpgradeId;
  readonly on: ArmStats;
  readonly off: ArmStats;
  readonly deltaMean: number;
  readonly deltaSd: number;
  readonly deltaP10: number;
  readonly deltaP90: number;
  readonly verdict: string;
}

export interface RiskReport {
  readonly pairs: readonly RiskPair[];
  readonly metaState: MetaStateName;
  readonly seedCount: number;
}

function verdictFor(deltaMean: number, deltaSd: number, deltaP10: number): string {
  const upside = deltaMean > 0.05;
  const riskier = deltaSd > 0.02 || deltaP10 < -0.05;
  if (upside && riskier) return 'genuine trade (EV up, variance up)';
  if (upside && !riskier) return 'STRICTLY BETTER — no downside';
  if (!upside && riskier) return 'STRICTLY WORSE — pure downside';
  return 'inert — barely moves anything';
}

export function riskAnalysis(opts: ExperimentOptions = {}): RiskReport {
  const seedList = seeds(opts.seedCount ?? 120, opts.seedOffset ?? 0);
  const metaState = opts.metaState ?? 'deep';
  const o: ExperimentOptions = { ...opts, metaState };

  const specs: Array<{ id: UpgradeId; on: PolicyOptions; off: PolicyOptions }> = [
    {
      id: 'yolo_mode',
      on: { forceUpgrades: ['yolo_mode'], banUpgrades: ['skip_permissions'] },
      off: { banUpgrades: ['yolo_mode', 'skip_permissions'] },
    },
    {
      id: 'skip_permissions',
      on: { forceUpgrades: ['yolo_mode', 'skip_permissions'] },
      off: { forceUpgrades: ['yolo_mode'], banUpgrades: ['skip_permissions'] },
    },
    {
      id: 'ci_gate',
      on: { forceUpgrades: ['ci_gate'] },
      off: { banUpgrades: ['ci_gate'] },
    },
  ];

  const pairs: RiskPair[] = [];
  for (const s of specs) {
    const on = runArm(`${s.id} on`, { policyOptions: s.on }, seedList, o).stats;
    const off = runArm(`${s.id} off`, { policyOptions: s.off }, seedList, o).stats;
    const deltaMean = on.meanShipped - off.meanShipped;
    const deltaSd = on.sdShipped - off.sdShipped;
    pairs.push({
      id: s.id,
      on,
      off,
      deltaMean,
      deltaSd,
      deltaP10: on.p10Shipped - off.p10Shipped,
      deltaP90: on.p90Shipped - off.p90Shipped,
      verdict: verdictFor(deltaMean, deltaSd, on.p10Shipped - off.p10Shipped),
    });
  }
  return { pairs, metaState, seedCount: seedList.length };
}

/** Are incidents net-negative at all? `test_coverage` is a pure incident card. */
export function incidentEv(opts: ExperimentOptions = {}): { on: ArmStats; off: ArmStats } {
  const seedList = seeds(opts.seedCount ?? 120, opts.seedOffset ?? 0);
  const o: ExperimentOptions = { ...opts, metaState: opts.metaState ?? 'deep' };
  return {
    on: runArm('incidents halved', { forceCards: ['test_coverage'] }, seedList, o).stats,
    off: runArm('incidents normal', { banCards: ['test_coverage'] }, seedList, o).stats,
  };
}

// ---------------------------------------------------------------------------
// Agent tier leapfrog
// ---------------------------------------------------------------------------

export interface TierRow {
  readonly projectNumber: number;
  /** Modal "best affordable purchase" tier while playing this project. */
  readonly bestTier: AgentTierId | null;
  readonly share: number;
  readonly samples: number;
}

export interface TierReport {
  readonly rows: readonly TierRow[];
  /** Total decisions in which each tier was the best affordable buy. */
  readonly bestCounts: Readonly<Record<AgentTierId, number>>;
  /** Mean units of each tier owned at run end. */
  readonly meanOwned: Readonly<Record<AgentTierId, number>>;
  /** Fraction of runs that ever owned at least one of the tier. */
  readonly reachRate: Readonly<Record<AgentTierId, number>>;
  readonly deadTiers: readonly AgentTierId[];
  readonly seedCount: number;
}

export function tierLeapfrog(opts: ExperimentOptions = {}): TierReport {
  const seedList = seeds(opts.seedCount ?? 60, opts.seedOffset ?? 0);
  const states: MetaStateName[] = ['mid', 'deep', 'maxed'];
  const results: RunResult[] = [];
  for (const state of states) {
    const built = metaForBudget(state);
    for (const seed of seedList) {
      results.push({
        ...runOne({
          seed,
          policy: opts.policy ?? 'balanced',
          meta: built.meta,
          metaName: built.name,
        }),
      });
    }
  }

  const perProject: Array<Record<AgentTierId, number>> = [];
  const bestCounts = {} as Record<AgentTierId, number>;
  const owned = {} as Record<AgentTierId, number>;
  const reach = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) {
    bestCounts[id] = 0;
    owned[id] = 0;
    reach[id] = 0;
  }
  for (const r of results) {
    for (const id of AGENT_TIER_IDS) {
      bestCounts[id] += r.bestTierCounts[id];
      owned[id] += r.agentsBought[id];
      if (r.agentsBought[id] > 0) reach[id] += 1;
    }
    r.bestTierByProject.forEach((tier, i) => {
      if (!tier) return;
      const bucket = perProject[i] ?? (perProject[i] = blankTierRecord());
      bucket[tier] += 1;
    });
  }

  const rows: TierRow[] = [];
  for (let i = 0; i < perProject.length; i++) {
    const bucket = perProject[i];
    if (!bucket) {
      rows.push({ projectNumber: i + 1, bestTier: null, share: 0, samples: 0 });
      continue;
    }
    let best: AgentTierId | null = null;
    let bestN = 0;
    let total = 0;
    for (const id of AGENT_TIER_IDS) {
      total += bucket[id];
      if (bucket[id] > bestN) {
        bestN = bucket[id];
        best = id;
      }
    }
    rows.push({
      projectNumber: i + 1,
      bestTier: best,
      share: total > 0 ? bestN / total : 0,
      samples: total,
    });
  }

  const n = results.length || 1;
  const meanOwned = {} as Record<AgentTierId, number>;
  const reachRate = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) {
    meanOwned[id] = owned[id] / n;
    reachRate[id] = reach[id] / n;
  }
  const deadTiers = AGENT_TIER_IDS.filter((id) => bestCounts[id] === 0);

  return { rows, bestCounts, meanOwned, reachRate, deadTiers, seedCount: seedList.length };
}

function blankTierRecord(): Record<AgentTierId, number> {
  const out = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) out[id] = 0;
  return out;
}

/** Static ladder table: rate, cost and payback per tier, plus what each project needs. */
export function tierLadder(): string {
  const lines = ['| tier | agent | rate/s | cost | payback s |', '|---:|---|---:|---:|---:|'];
  for (const t of AGENT_TIERS) {
    lines.push(
      `| ${t.tier} | ${t.name} | ${fmt(t.baseRate)} | ${fmt(t.baseCost)} | ${(t.baseCost / t.baseRate).toFixed(1)} |`,
    );
  }
  return lines.join('\n');
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function cardName(id: CardId): string {
  return CARD_BY_ID[id]?.name ?? id;
}

export function tierName(id: AgentTierId): string {
  return AGENT_BY_ID[id]?.name ?? id;
}
