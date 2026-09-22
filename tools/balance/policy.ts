/**
 * Bot play policies for the headless balance simulator.
 *
 * Every policy drives the real `SimApi` — it clicks, buys and ships through the
 * public surface only, and values purchases with the sim's own pure derivation
 * (`computeDerived`) applied to hypothetical copies of `RunState`.
 *
 * Click realism: a human sustains ~6 clicks/second while actively clicking and
 * cannot click during every second of a run, so clicking runs on a duty cycle
 * (`uptime` of every `dutyPeriodMs`). Both knobs are parameters.
 */
import type {
  AgentTierId,
  CardId,
  DerivedStats,
  MetaState,
  RunState,
  UpgradeDef,
} from '@sim/types.ts';
import type { Sim } from '@sim/index.ts';
import {
  AGENT_TIERS,
  BALANCE,
  CARD_BY_ID,
  availableUpgradeList,
  baseAggregate,
  computeDerived,
  deadlineForProject,
  projectAt,
  visibleTierList,
} from '@sim/index.ts';

// ---------------------------------------------------------------------------
// Click model
// ---------------------------------------------------------------------------

/** Expected click multiplier once crits are averaged in. */
/**
 * Expected click payout multiplier at the *base* crit rate. Kept for reference
 * only — live scoring reads the run's actual crit dials via `totalRate`, since
 * crit chance is now something the player buys.
 */
export const CRIT_EV = 1 + BALANCE.CRIT_CHANCE * (BALANCE.CRIT_MULT - 1);

export interface ClickModel {
  /** Clicks per second *while actively clicking*. */
  readonly cps: number;
  /** Fraction of the run spent actively clicking, 0..1. */
  readonly uptime: number;
  /** Length of one click/rest cycle in ms. 0 smooths the rate instead. */
  readonly dutyPeriodMs: number;
}

/** Engaged human play: 6 cps bursts, clicking ~70% of the time. */
export const HUMAN_CLICKS: ClickModel = { cps: 6, uptime: 0.7, dutyPeriodMs: 10_000 };

/** Time-averaged clicks per second — what purchase valuation should assume. */
export function averageCps(m: ClickModel): number {
  return m.cps * Math.max(0, Math.min(1, m.uptime));
}

/** Instantaneous click rate at a point in the duty cycle. */
export function instantCps(m: ClickModel, elapsedMs: number, phaseMs = 0): number {
  const up = Math.max(0, Math.min(1, m.uptime));
  if (!(m.dutyPeriodMs > 0)) return m.cps * up;
  const t = (((elapsedMs + phaseMs) % m.dutyPeriodMs) + m.dutyPeriodMs) % m.dutyPeriodMs;
  return t < m.dutyPeriodMs * up ? m.cps : 0;
}

// ---------------------------------------------------------------------------
// Hypothetical states + valuation
// ---------------------------------------------------------------------------

function withAgent(run: RunState, id: AgentTierId, n: number): RunState {
  return { ...run, agents: { ...run.agents, [id]: run.agents[id] + n } };
}
function withUpgrade(run: RunState, id: string): RunState {
  return { ...run, owned: [...run.owned, id] };
}
function withCard(run: RunState, id: CardId): RunState {
  return { ...run, cards: [...run.cards, id] };
}

/** Total slop/second: idle plus the click stream a human actually sustains. */
/**
 * Slop per second a build is really worth, as the bot sees it.
 *
 * Three things here were previously invisible to the policy, so every card and
 * upgrade that touched them scored as worthless no matter how strong it was:
 *
 *  - `autoClickHz`. Automation fires *real* clicks, so it belongs in the click
 *    term. `avgCps` is the human clicking model only, so there is no double
 *    count. (This is why AFK Farming has always graded "weak".)
 *  - crit chance and multiplier, which used to be pinned to the base constant.
 *  - one-shots, which pay `oneShotPayoutS` seconds of idle output per hit.
 */
export function totalRate(d: DerivedStats, avgCps: number): number {
  const cps = avgCps + d.autoClickHz;
  const critEv = 1 + d.critChance * (d.critMult - 1);
  const rollsPerSecond = 1000 / BALANCE.ONE_SHOT_ROLL_MS;
  const oneShotEv = 1 + d.oneShotChance * d.oneShotPayoutS * rollsPerSecond;
  const r = d.idleRate * oneShotEv + d.clickPower * cps * critEv;
  return Number.isFinite(r) ? r : 0;
}

export type CandidateKind = 'agent' | 'upgrade';

export interface Candidate {
  readonly kind: CandidateKind;
  readonly id: string;
  readonly tier?: AgentTierId;
  readonly cost: number;
  /** Direct slop/s added right now. */
  readonly directRate: number;
  /** Direct rate plus the amortised value of cheaper/stronger future agents. */
  readonly gainRate: number;
  readonly paybackS: number;
  readonly affordable: boolean;
}

/** Fraction of production a reinvesting player pushes back into agents. */
const REINVEST_FRACTION = 0.5;
/** Candidates priced beyond this multiple of the wallet are not even scored. */
const REACH_MULTIPLE = 3;

export interface CandidateSet {
  readonly derived: DerivedStats;
  readonly rateNow: number;
  readonly all: readonly Candidate[];
  /** Best affordable agent purchase by rate-per-slop; null when none. */
  readonly bestAgent: Candidate | null;
  /** Best rate-per-slop currently purchasable (agents only). */
  readonly rps: number;
}

/** Experiment hooks: force or forbid specific shop entries. */
export interface PolicyOptions {
  /** Never considered, however good the payback looks. */
  readonly banUpgrades?: readonly string[];
  /** Bought the moment they are affordable, payback test skipped. */
  readonly forceUpgrades?: readonly string[];
}

/**
 * Score every purchase reachable right now.
 *
 * `horizonS` is the window the buyer expects to keep the purchase for; it sets
 * how much of a cost reduction's compounding benefit is credited.
 */
export function enumerateCandidates(
  run: RunState,
  meta: MetaState,
  avgCps: number,
  horizonS: number,
  ban?: ReadonlySet<string> | null,
): CandidateSet {
  const d = computeDerived(run, meta);
  const rateNow = totalRate(d, avgCps);
  const slop = run.slop;
  const budget = Math.max(slop, 0);
  const reach = Math.max(budget * REACH_MULTIPLE, 1);

  const agents: Candidate[] = [];
  for (const tier of visibleTierList(run, meta)) {
    const cost = d.nextCosts[tier.id];
    if (!Number.isFinite(cost) || cost <= 0 || cost > reach) continue;
    const after = computeDerived(withAgent(run, tier.id, 1), meta);
    const directRate = totalRate(after, avgCps) - rateNow;
    if (!(directRate > 0)) continue;
    agents.push({
      kind: 'agent',
      id: tier.id,
      tier: tier.id,
      cost,
      directRate,
      gainRate: directRate,
      paybackS: cost / directRate,
      affordable: cost <= slop,
    });
  }

  // Best rate-per-slop available today; the yardstick a cost cut improves.
  let rps = 0;
  let bestAgent: Candidate | null = null;
  for (const c of agents) {
    const eff = c.directRate / c.cost;
    if (eff > rps) rps = eff;
    if (c.affordable && (bestAgent === null || eff > bestAgent.directRate / bestAgent.cost)) {
      bestAgent = c;
    }
  }
  const refTier: AgentTierId = bestAgent?.tier ?? agents[0]?.tier ?? 'tab_autocomplete';

  const upgrades: Candidate[] = [];
  const reinvestBudget = Math.max(0, rateNow) * horizonS * REINVEST_FRACTION;
  for (const def of availableUpgradeList(run, meta)) {
    if (def.cost > reach) continue;
    if (ban?.has(def.id)) continue;
    const after = computeDerived(withUpgrade(run, def.id), meta);
    const directRate = totalRate(after, avgCps) - rateNow;
    const gainRate = directRate + reinvestGain(d, after, refTier, rps, reinvestBudget, horizonS);
    if (!(gainRate > 0)) continue;
    upgrades.push({
      kind: 'upgrade',
      id: def.id,
      cost: def.cost,
      directRate,
      gainRate,
      paybackS: def.cost / gainRate,
      affordable: def.cost <= slop,
    });
  }

  const all = [...agents, ...upgrades];
  return { derived: d, rateNow, all, bestAgent, rps };
}

/**
 * Amortised slop/s credited to a purchase for making *future* agents cheaper or
 * stronger. Extra rate bought = budget * Δ(rate per slop); it lands on average
 * halfway through the horizon, so only half of it is credited.
 */
function reinvestGain(
  before: DerivedStats,
  after: DerivedStats,
  refTier: AgentTierId,
  rpsBefore: number,
  reinvestBudget: number,
  horizonS: number,
): number {
  if (!(rpsBefore > 0) || !(reinvestBudget > 0) || !(horizonS > 0)) return 0;
  const costFactor = after.nextCosts[refTier] / before.nextCosts[refTier];
  const idleFactor =
    (after.multipliers.idle * after.multipliers.all) /
    (before.multipliers.idle * before.multipliers.all);
  if (!Number.isFinite(costFactor) || !Number.isFinite(idleFactor) || costFactor <= 0) return 0;
  const rpsAfter = (rpsBefore * idleFactor) / costFactor;
  const extraRate = reinvestBudget * (rpsAfter - rpsBefore);
  if (!Number.isFinite(extraRate)) return 0;
  return extraRate / 2;
}

// ---------------------------------------------------------------------------
// Draft valuation
// ---------------------------------------------------------------------------

/** Weight applied to a card's effect on agent prices (cheaper -> more agents). */
const CARD_COST_WEIGHT = 0.85;
/** Score penalty per unit of extra incident rate. Calibrated by the sweep. */
const CARD_INCIDENT_WEIGHT = 0.1;
/** Demos are meta currency, not run strength — only lightly rewarded. */
const CARD_DEMO_WEIGHT = 0.15;
/** Units of the "next" tier a drafter assumes it will own during the project. */
const CARD_LOOKAHEAD_UNITS = 3;

/** The run state a drafter should evaluate against: current plus what's next. */
function projectedRun(run: RunState, buysAgents: boolean): RunState {
  if (!buysAgents) return run;
  const nextIndex = run.projectIndex + 1;
  const tier = AGENT_TIERS[Math.min(Math.max(nextIndex, 0), AGENT_TIERS.length - 1)];
  if (!tier) return run;
  return withAgent(run, tier.id, CARD_LOOKAHEAD_UNITS);
}

/**
 * Multiplicative strength score for a card, >1 meaning "better than nothing".
 * Combines production, agent price, deadline length and incident exposure.
 */
export function scoreCard(
  run: RunState,
  meta: MetaState,
  id: CardId,
  avgCps: number,
  buysAgents: boolean,
): number {
  const def = CARD_BY_ID[id];
  if (!def) return 0;
  const base = projectedRun(run, buysAgents);
  const before = computeDerived(base, meta);
  const after = computeDerived(withCard(base, id), meta);
  const rateBefore = totalRate(before, avgCps);
  const rateAfter = totalRate(after, avgCps);
  let score = rateBefore > 0 ? rateAfter / rateBefore : 1;

  if (buysAgents) {
    const refTier = AGENT_TIERS[Math.min(run.projectIndex + 1, AGENT_TIERS.length - 1)];
    if (refTier) {
      const costFactor = after.nextCosts[refTier.id] / before.nextCosts[refTier.id];
      if (Number.isFinite(costFactor) && costFactor > 0) {
        score *= Math.pow(costFactor, -CARD_COST_WEIGHT);
      }
    }
  }

  const aggBefore = baseAggregate(base, meta);
  const aggAfter = baseAggregate(withCard(base, id), meta);
  if (aggBefore.deadlineMult > 0) score *= aggAfter.deadlineMult / aggBefore.deadlineMult;
  score *= 1 - CARD_INCIDENT_WEIGHT * (aggAfter.incidentRateMult - aggBefore.incidentRateMult);
  if (aggBefore.demoMult > 0) {
    score *= 1 + CARD_DEMO_WEIGHT * (aggAfter.demoMult / aggBefore.demoMult - 1);
  }
  return Number.isFinite(score) ? score : 0;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export type PolicyId = 'miser' | 'greedy' | 'balanced' | 'optimal-ish';

export const POLICY_IDS: readonly PolicyId[] = ['miser', 'greedy', 'balanced', 'optimal-ish'];

export interface DecisionLog {
  /** The wallet was already at or above the requirement. */
  canShip: boolean;
  /** Purchases executed in this decision. */
  bought: number;
  shipped: boolean;
  /** Able to ship *and* holding a purchase that passes its own payback test. */
  tension: boolean;
  /** Bought instead of shipping while able to ship. */
  boughtOverShip: boolean;
  /** A purchase passed the payback test but could not be afforded. */
  banked: boolean;
  /** Best affordable agent tier by rate-per-slop at this instant. */
  bestTier: AgentTierId | null;
}

const EMPTY_DECISION: DecisionLog = {
  canShip: false,
  bought: 0,
  shipped: false,
  tension: false,
  boughtOverShip: false,
  banked: false,
  bestTier: null,
};

export interface Policy {
  readonly id: PolicyId;
  /** Runs on the decision cadence while `phase === 'running'`. */
  decide(sim: Sim, avgCps: number): DecisionLog;
  /** Runs whenever `phase === 'drafting'`. */
  draft(sim: Sim, offer: readonly CardId[], avgCps: number): CardId | null;
}

/** Safety factor on "can I still make the deadline after this purchase?". */
const FEASIBILITY_SAFETY = 0.95;
/** Purchases per decision tick — a human can spam the buy button, but not forever. */
const MAX_BUYS_PER_DECISION = 12;
const MAX_GREEDY_BUYS_PER_DECISION = 40;

function secondsLeft(sim: Sim): number {
  return Math.max(0, sim.run.timeLeftMs / 1000);
}

function requirementOf(sim: Sim): number {
  return projectAt(sim.run.projectIndex).requirement;
}

function execute(sim: Sim, c: Candidate): boolean {
  return c.kind === 'agent' ? sim.buyAgent(c.tier as AgentTierId, 1) : sim.buyUpgrade(c.id);
}

function toSet(ids: readonly string[] | undefined): ReadonlySet<string> | null {
  return ids && ids.length > 0 ? new Set(ids) : null;
}

/** Buy any forced upgrade that is unlocked and affordable. Returns how many. */
function buyForced(sim: Sim, forced: readonly string[] | undefined): number {
  if (!forced || forced.length === 0) return 0;
  let n = 0;
  for (const def of availableUpgradeList(sim.run, sim.meta)) {
    if (!forced.includes(def.id)) continue;
    if (def.cost > sim.run.slop) continue;
    if (sim.buyUpgrade(def.id)) n += 1;
  }
  return n;
}

function draftBest(sim: Sim, offer: readonly CardId[], avgCps: number, buysAgents: boolean): CardId | null {
  let best: CardId | null = null;
  let bestScore = -Infinity;
  for (const id of offer) {
    const s = scoreCard(sim.run, sim.meta, id, avgCps, buysAgents);
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return best;
}

/** Never buys. Clicks, and ships the instant the bar allows. */
export function miserPolicy(): Policy {
  return {
    id: 'miser',
    decide(sim) {
      const canShip = sim.run.slop >= requirementOf(sim);
      if (!canShip) return { ...EMPTY_DECISION };
      const shipped = sim.ship();
      return { ...EMPTY_DECISION, canShip, shipped };
    },
    draft(sim, offer, avgCps) {
      return draftBest(sim, offer, avgCps, false);
    },
  };
}

/** Spends down to zero on the best rate-per-slop purchase it can afford. */
export function greedyPolicy(opts: PolicyOptions = {}): Policy {
  const ban = toSet(opts.banUpgrades);
  return {
    id: 'greedy',
    decide(sim, avgCps) {
      const log: DecisionLog = { ...EMPTY_DECISION };
      const req = requirementOf(sim);
      log.canShip = sim.run.slop >= req;
      if (log.canShip) {
        log.shipped = sim.ship();
        if (log.shipped) return log;
      }
      log.bought += buyForced(sim, opts.forceUpgrades);
      for (let i = 0; i < MAX_GREEDY_BUYS_PER_DECISION; i++) {
        const set = enumerateCandidates(sim.run, sim.meta, avgCps, secondsLeft(sim), ban);
        if (i === 0) log.bestTier = set.bestAgent?.tier ?? null;
        let pick: Candidate | null = null;
        for (const c of set.all) {
          if (!c.affordable) continue;
          if (pick === null || c.gainRate / c.cost > pick.gainRate / pick.cost) pick = c;
        }
        if (!pick || !execute(sim, pick)) break;
        log.bought += 1;
      }
      return log;
    },
    draft(sim, offer, avgCps) {
      return draftBest(sim, offer, avgCps, true);
    },
  };
}

interface InvestorOptions {
  readonly id: PolicyId;
  /** Extra horizon credited beyond the current deadline, in seconds. */
  horizon(sim: Sim): number;
  /**
   * Ship gate: return true to ship now, given the wallet is over the bar and
   * nothing worth buying is left.
   */
  shipNow(sim: Sim): boolean;
}

/**
 * The shared "invest while it pays back" body used by `balanced` and
 * `optimal-ish`. It buys whatever repays itself inside its horizon and still
 * leaves the deadline reachable; otherwise it banks toward the ship bar.
 */
function investorPolicy(opts: InvestorOptions, po: PolicyOptions = {}): Policy {
  const ban = toSet(po.banUpgrades);
  return {
    id: opts.id,
    decide(sim, avgCps) {
      const log: DecisionLog = { ...EMPTY_DECISION };
      const req = requirementOf(sim);
      const horizon = opts.horizon(sim);
      log.bought += buyForced(sim, po.forceUpgrades);

      for (let i = 0; i < MAX_BUYS_PER_DECISION; i++) {
        const R = secondsLeft(sim);
        const set = enumerateCandidates(sim.run, sim.meta, avgCps, horizon, ban);
        const slop = sim.run.slop;
        const canShip = slop >= req;
        if (i === 0) {
          log.canShip = canShip;
          log.bestTier = set.bestAgent?.tier ?? null;
        }
        const preEta = slop >= req ? 0 : set.rateNow > 0 ? (req - slop) / set.rateNow : Infinity;
        const doomed = preEta > R;

        let pick: Candidate | null = null;
        let bankable = false;
        for (const c of set.all) {
          if (c.paybackS > horizon) continue;
          if (!c.affordable) {
            bankable = true;
            continue;
          }
          const after = req - (slop - c.cost);
          const postEta = after <= 0 ? 0 : (after / (set.rateNow + c.directRate));
          if (!doomed && postEta > R * FEASIBILITY_SAFETY) continue;
          if (pick === null || c.paybackS < pick.paybackS) pick = c;
        }
        if (i === 0) {
          log.banked = bankable && pick === null;
          log.tension = canShip && pick !== null;
        }
        if (!pick) break;
        if (canShip) log.boughtOverShip = true;
        if (!execute(sim, pick)) break;
        log.bought += 1;
      }

      if (sim.run.slop >= req && opts.shipNow(sim)) {
        log.shipped = sim.ship();
      }
      return log;
    },
    draft(sim, offer, avgCps) {
      return draftBest(sim, offer, avgCps, true);
    },
  };
}

/** The "good human" reference: pays-for-itself-before-the-deadline, else bank. */
export function balancedPolicy(po: PolicyOptions = {}): Policy {
  return investorPolicy(
    {
      id: 'balanced',
      horizon: (sim) => secondsLeft(sim),
      shipNow: () => true,
    },
    po,
  );
}

/** How much of the *next* deadline a lookahead buyer counts as usable horizon. */
const LOOKAHEAD_WEIGHT = 0.7;
/**
 * Fraction of the deadline `optimal-ish` still wants left when it ships — just
 * above `BONUS_DEMO_TIME_FRACTION`, so it banks surplus without losing the
 * bonus Demo.
 */
const HOLD_UNTIL_FRACTION = BALANCE.BONUS_DEMO_TIME_FRACTION + 0.03;

/** Short lookahead: weighs the next project's requirement, not just this one. */
export function optimalishPolicy(po: PolicyOptions = {}): Policy {
  return investorPolicy(
    {
      id: 'optimal-ish',
      horizon: (sim) => {
        const R = secondsLeft(sim);
        const next = sim.run.projectIndex + 1;
        const mult = baseAggregate(sim.run, sim.meta).deadlineMult;
        return R + LOOKAHEAD_WEIGHT * (deadlineForProject(next, mult) / 1000);
      },
      shipNow: (sim) => {
        const deadline = sim.deadlineMs;
        if (!(deadline > 0)) return true;
        const fractionLeft = sim.run.timeLeftMs / deadline;
        if (fractionLeft <= HOLD_UNTIL_FRACTION) return true;
        // Already sitting on the *next* project's requirement: nothing left to bank.
        const nextReq = projectAt(sim.run.projectIndex + 1).requirement;
        return sim.run.slop - projectAt(sim.run.projectIndex).requirement >= nextReq;
      },
    },
    po,
  );
}

export function makePolicy(id: PolicyId, po: PolicyOptions = {}): Policy {
  switch (id) {
    case 'miser':
      return miserPolicy();
    case 'greedy':
      return greedyPolicy(po);
    case 'balanced':
      return balancedPolicy(po);
    case 'optimal-ish':
      return optimalishPolicy(po);
  }
}

/** Exposed for the report: which upgrades a policy can even see right now. */
export function visibleUpgrades(run: RunState, meta: MetaState): readonly UpgradeDef[] {
  return availableUpgradeList(run, meta);
}
