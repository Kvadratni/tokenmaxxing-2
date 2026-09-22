/**
 * Effect folding — the single place every modifier in the game is combined.
 *
 * Sources are: owned upgrades, drafted cards, active incidents and meta levels.
 * `aggregate()` is pure: same input arrays -> same Aggregate, no state read.
 */
import type { AgentTierId, Effect, MetaState, MetaUpgradeId } from './types.ts';
import {
  AGENT_TIER_IDS,
  BALANCE,
  META_CURVES,
  metaCurve,
  META_BY_ID,
  META_UPGRADES,
  STARTING_CARDS,
  STARTING_TIERS,
  STARTING_UPGRADES,
} from './content.ts';

export interface Aggregate {
  /** Multiplicative. */
  clickMult: number;
  idleMult: number;
  allMult: number;
  agentCostMult: number;
  incidentRateMult: number;
  deadlineMult: number;
  demoMult: number;
  /** Multiplicative, per agent tier. */
  tierMult: Record<AgentTierId, number>;
  /** Additive. */
  clickAdd: number;
  clickPerAgent: number;
  /** Automatic clicks per second, summed across sources. */
  autoClick: number;
  startingSlop: number;
  /** Additive, per agent tier. */
  startingAgents: Record<AgentTierId, number>;
  /** True while any source halts idle production. */
  idleHalt: boolean;
  /** Largest requested draft size (defaults to BALANCE.DEFAULT_DRAFT_SIZE). */
  draftSize: number;
  /** Largest requested reroll allowance. */
  draftRerolls: number;
  /** Additive crit dials. Clamped in `finalize`, not here. */
  critChance: number;
  critMult: number;
  oneShotChance: number;
  oneShotPayout: number;
}

function zeroTierRecord(fill: number): Record<AgentTierId, number> {
  const out = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) out[id] = fill;
  return out;
}

export function emptyAggregate(): Aggregate {
  return {
    clickMult: 1,
    idleMult: 1,
    allMult: 1,
    agentCostMult: 1,
    incidentRateMult: 1,
    deadlineMult: 1,
    demoMult: 1,
    tierMult: zeroTierRecord(1),
    clickAdd: 0,
    clickPerAgent: 0,
    autoClick: 0,
    startingSlop: 0,
    startingAgents: zeroTierRecord(0),
    idleHalt: false,
    draftSize: BALANCE.DEFAULT_DRAFT_SIZE,
    draftRerolls: 0,
    critChance: BALANCE.CRIT_CHANCE,
    critMult: BALANCE.CRIT_MULT,
    oneShotChance: 0,
    oneShotPayout: BALANCE.ONE_SHOT_BASE_PAYOUT_S,
  };
}

/** Reject NaN/Infinity/negative inputs before they poison a multiplier. */
function mult(current: number, v: number): number {
  if (!Number.isFinite(v) || v < 0) return current;
  return current * v;
}

function add(current: number, v: number): number {
  if (!Number.isFinite(v)) return current;
  return current + v;
}

export function applyEffect(agg: Aggregate, e: Effect): void {
  switch (e.t) {
    case 'clickMult':
      agg.clickMult = mult(agg.clickMult, e.v);
      break;
    case 'clickAdd':
      agg.clickAdd = add(agg.clickAdd, e.v);
      break;
    case 'idleMult':
      agg.idleMult = mult(agg.idleMult, e.v);
      break;
    case 'tierMult':
      agg.tierMult[e.id] = mult(agg.tierMult[e.id], e.v);
      break;
    case 'allMult':
      agg.allMult = mult(agg.allMult, e.v);
      break;
    case 'agentCostMult':
      agg.agentCostMult = mult(agg.agentCostMult, e.v);
      break;
    case 'incidentRateMult':
      agg.incidentRateMult = mult(agg.incidentRateMult, e.v);
      break;
    case 'deadlineMult':
      agg.deadlineMult = mult(agg.deadlineMult, e.v);
      break;
    case 'clickPerAgent':
      agg.clickPerAgent = add(agg.clickPerAgent, e.v);
      break;
    case 'autoClick':
      agg.autoClick = add(agg.autoClick, e.v);
      break;
    case 'idleHalt':
      agg.idleHalt = true;
      break;
    case 'demoMult':
      agg.demoMult = mult(agg.demoMult, e.v);
      break;
    case 'startingSlop':
      agg.startingSlop = add(agg.startingSlop, e.v);
      break;
    case 'startingAgent':
      agg.startingAgents[e.id] = add(agg.startingAgents[e.id], e.n);
      break;
    case 'draftSize':
      if (Number.isFinite(e.v)) agg.draftSize = Math.max(agg.draftSize, e.v);
      break;
    case 'draftRerolls':
      if (Number.isFinite(e.v)) agg.draftRerolls = Math.max(agg.draftRerolls, e.v);
      break;
    case 'critChance':
      if (Number.isFinite(e.v)) agg.critChance += e.v;
      break;
    case 'critMult':
      if (Number.isFinite(e.v)) agg.critMult += e.v;
      break;
    case 'oneShotChance':
      if (Number.isFinite(e.v)) agg.oneShotChance += e.v;
      break;
    case 'oneShotPayout':
      if (Number.isFinite(e.v)) agg.oneShotPayout += e.v;
      break;
  }
}

function clamp01(v: number, cap: number): number {
  return Math.min(cap, Math.max(0, v));
}

/** Final clamp so a pathological content edit can never emit NaN downstream. */
function finalize(agg: Aggregate): Aggregate {
  const safeMult = (n: number): number => (Number.isFinite(n) && n >= 0 ? n : 1);
  const safeAdd = (n: number): number => (Number.isFinite(n) ? n : 0);
  agg.clickMult = safeMult(agg.clickMult);
  agg.idleMult = safeMult(agg.idleMult);
  agg.allMult = safeMult(agg.allMult);
  agg.agentCostMult = safeMult(agg.agentCostMult);
  agg.incidentRateMult = safeMult(agg.incidentRateMult);
  agg.deadlineMult = safeMult(agg.deadlineMult);
  agg.demoMult = safeMult(agg.demoMult);
  agg.clickAdd = safeAdd(agg.clickAdd);
  agg.clickPerAgent = safeAdd(agg.clickPerAgent);
  agg.startingSlop = Math.max(0, safeAdd(agg.startingSlop));
  for (const id of AGENT_TIER_IDS) {
    agg.tierMult[id] = safeMult(agg.tierMult[id]);
    agg.startingAgents[id] = Math.max(0, Math.floor(safeAdd(agg.startingAgents[id])));
  }
  agg.draftSize = Math.max(1, Math.floor(safeAdd(agg.draftSize) || BALANCE.DEFAULT_DRAFT_SIZE));
  agg.draftRerolls = Math.max(0, Math.floor(safeAdd(agg.draftRerolls)));
  // Crit dials are additive across sources, so they need a ceiling: without one
  // a deep build reaches guaranteed crits and the mechanic stops being a gamble.
  agg.critChance = clamp01(safeAdd(agg.critChance), BALANCE.CRIT_CHANCE_CAP);
  agg.critMult = Math.max(1, safeAdd(agg.critMult) || BALANCE.CRIT_MULT);
  agg.oneShotChance = clamp01(safeAdd(agg.oneShotChance), BALANCE.ONE_SHOT_CHANCE_CAP);
  agg.oneShotPayout = Math.max(0, safeAdd(agg.oneShotPayout));
  // incidentRateMult of 0 would mean "never roll again"; keep it strictly positive.
  if (agg.incidentRateMult <= 0) agg.incidentRateMult = 1;
  return agg;
}

/** Fold every effect list into one aggregate. Pure. */
export function aggregate(sources: readonly (readonly Effect[] | undefined)[]): Aggregate {
  const agg = emptyAggregate();
  for (const list of sources) {
    if (!list) continue;
    for (const e of list) applyEffect(agg, e);
  }
  return finalize(agg);
}

// ---------------------------------------------------------------------------
// Meta progression -> effects
// ---------------------------------------------------------------------------

/** Level of a meta upgrade, clamped to its declared maxLevel. */
export function metaLevel(meta: MetaState, id: MetaUpgradeId): number {
  const raw = meta.levels[id];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  const def = META_BY_ID[id];
  const max = def ? def.maxLevel : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(max, Math.floor(raw)));
}

/** True once Endless Mode has been purchased (play continues past project 10). */
export function endlessUnlocked(meta: MetaState): boolean {
  return metaLevel(meta, 'endless_mode') >= 1;
}

/**
 * Translate `MetaState.levels` into the effect vocabulary. Endless Mode is
 * deliberately absent — it is a phase gate, not a modifier.
 */
export function metaEffects(meta: MetaState): Effect[] {
  const out: Effect[] = [];

  const seedFunding = metaLevel(meta, 'seed_funding');
  if (seedFunding > 0) out.push({ t: 'startingSlop', v: 60 * Math.pow(4, seedFunding - 1) });

  const cracked = metaLevel(meta, 'cracked');
  if (cracked > 0) out.push({ t: 'clickMult', v: 1 + cracked });

  const founder = metaLevel(meta, 'founder_mode');
  if (founder > 0) {
    out.push({ t: 'allMult', v: metaCurve(META_CURVES.FOUNDER_MODE, founder, 1) });
  }

  const scope = metaLevel(meta, 'scope_negotiator');
  if (scope > 0) {
    out.push({ t: 'deadlineMult', v: metaCurve(META_CURVES.SCOPE_NEGOTIATOR, scope, 1) });
  }

  const incubator = metaLevel(meta, 'incubator');
  if (incubator > 0) out.push({ t: 'startingAgent', id: 'tab_autocomplete', n: 3 * incubator });

  if (metaLevel(meta, 'prompt_library') >= 1) out.push({ t: 'draftSize', v: 4 });

  const rerolls = metaLevel(meta, 'reroll_token');
  if (rerolls > 0) out.push({ t: 'draftRerolls', v: rerolls });

  const cofounder = metaLevel(meta, 'technical_cofounder');
  if (cofounder > 0) {
    out.push({ t: 'agentCostMult', v: metaCurve(META_CURVES.TECHNICAL_COFOUNDER, cofounder, 1) });
  }

  const hype = metaLevel(meta, 'hype_machine');
  if (hype > 0) out.push({ t: 'demoMult', v: 1 + 0.2 * hype });

  const idleHands = metaLevel(meta, 'idle_hands');
  if (idleHands > 0) out.push({ t: 'autoClick', v: idleHands });

  return out;
}

/**
 * What the save has actually unlocked. A fresh meta gets only the starting
 * loadout; everything else is behind a tree node.
 *
 * This is the mechanism that makes run 1 unwinnable: with tiers 1-4 the raw
 * production ceiling is orders of magnitude under project 10's demand, so no
 * seed, draft or skill level can close the gap.
 */
export interface UnlockedContent {
  readonly tiers: ReadonlySet<AgentTierId>;
  readonly upgrades: ReadonlySet<string>;
  readonly cards: ReadonlySet<string>;
  readonly features: ReadonlySet<string>;
}

export function unlockedContent(meta: MetaState): UnlockedContent {
  const tiers = new Set<AgentTierId>(STARTING_TIERS);
  const upgrades = new Set<string>(STARTING_UPGRADES);
  const cards = new Set<string>(STARTING_CARDS);
  const features = new Set<string>();

  for (const def of META_UPGRADES) {
    if (def.kind !== 'unlock') continue;
    if (metaLevel(meta, def.id) < 1) continue;
    const g = def.grants;
    if (!g) continue;
    switch (g.t) {
      case 'agentTier':
        tiers.add(g.id);
        for (const id of g.withUpgrades ?? []) upgrades.add(id);
        break;
      case 'upgrades':
        for (const id of g.ids) upgrades.add(id);
        for (const id of g.withCards ?? []) cards.add(id);
        break;
      case 'cards':
        for (const id of g.ids) cards.add(id);
        break;
      case 'feature':
        features.add(g.id);
        break;
    }
  }
  return { tiers, upgrades, cards, features };
}

/** Every prerequisite owned, so this node can be bought. */
export function metaRequirementsMet(meta: MetaState, id: MetaUpgradeId): boolean {
  const def = META_BY_ID[id];
  if (!def) return false;
  return def.requires.every((req) => metaLevel(meta, req) >= 1);
}
