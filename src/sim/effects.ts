/**
 * Effect folding: the single place every modifier in the game is combined.
 *
 * Sources are owned upgrades, held cards, active incidents (pickup buffs
 * included), Training levels, and two run-state modifiers that derive.ts adds
 * (tech debt and a human who cheated in the first game). `aggregate()` is pure:
 * same input lists, same Aggregate, no state read.
 */
import type { Effect, MetaFeature, MetaState, MetaUpgradeId, ToolId } from './types.ts';
import {
  BALANCE,
  META_BY_ID,
  META_UPGRADES,
  STARTING_CARDS,
  STARTING_TOOLS,
  STARTING_UPGRADES,
  TOOL_IDS,
} from './content.ts';

/**
 * Every dial, folded. Conventions:
 *  - multiplicative fields start at 1 and multiply;
 *  - additive fields start at 0 and add, and are *deltas* on top of the
 *    BALANCE base (derive.ts applies the base and the clamps);
 *  - crit fields include their BALANCE base, as in the first game;
 *  - `draftSize` takes the largest request.
 */
export interface Aggregate {
  // --- multiplicative -------------------------------------------------------
  clickMult: number;
  idleMult: number;
  allMult: number;
  toolMult: Record<ToolId, number>;
  toolCostMult: number;
  incidentRateMult: number;
  patienceMult: number;
  thumbsMult: number;
  contextMaxMult: number;
  clickContextMult: number;
  footprintMult: number;
  toolFootprintMult: Record<ToolId, number>;
  floorMult: number;
  compactPenaltyMult: number;
  sycophancyMult: number;
  caughtPenaltyMult: number;
  permissionMult: number;
  // --- additive -------------------------------------------------------------
  clickAdd: number;
  clickPerTool: number;
  thumbsPerHonest: number;
  startingTokens: number;
  startingTools: Record<ToolId, number>;
  draftRerolls: number;
  /** Automatic clicks per second. */
  autoClick: number;
  /** Extra summary slots over BASE_SUMMARY_SLOTS. */
  summarySlots: number;
  /** Extra wallet fraction kept through any compaction. */
  compactKeep: number;
  /** Delta on VERIFY_BASE. Negative is good for the agent. */
  verifyChance: number;
  /** Delta on CLAIM_THRESHOLD. */
  claimThreshold: number;
  // --- crits (base included, clamped in finalize) ----------------------------
  critChance: number;
  critMult: number;
  oneShotChance: number;
  /** Seconds of tool output a one-shot pays, ONE_SHOT_BASE_PAYOUT_S included. */
  oneShotPayoutS: number;
  // --- largest request --------------------------------------------------------
  draftSize: number;
  // --- flags ------------------------------------------------------------------
  patienceFreeze: boolean;
  idleHalt: boolean;
  networkHalt: boolean;
  toolHalt: Record<ToolId, boolean>;
}

function toolRecord<T>(fill: T): Record<ToolId, T> {
  const out = {} as Record<ToolId, T>;
  for (const id of TOOL_IDS) out[id] = fill;
  return out;
}

export function emptyAggregate(): Aggregate {
  return {
    clickMult: 1,
    idleMult: 1,
    allMult: 1,
    toolMult: toolRecord(1),
    toolCostMult: 1,
    incidentRateMult: 1,
    patienceMult: 1,
    thumbsMult: 1,
    contextMaxMult: 1,
    clickContextMult: 1,
    footprintMult: 1,
    toolFootprintMult: toolRecord(1),
    floorMult: 1,
    compactPenaltyMult: 1,
    sycophancyMult: 1,
    caughtPenaltyMult: 1,
    permissionMult: 1,
    clickAdd: 0,
    clickPerTool: 0,
    thumbsPerHonest: 0,
    startingTokens: 0,
    startingTools: toolRecord(0),
    draftRerolls: 0,
    autoClick: 0,
    summarySlots: 0,
    compactKeep: 0,
    verifyChance: 0,
    claimThreshold: 0,
    critChance: BALANCE.CRIT_CHANCE,
    critMult: BALANCE.CRIT_MULT,
    oneShotChance: 0,
    oneShotPayoutS: BALANCE.ONE_SHOT_BASE_PAYOUT_S,
    draftSize: BALANCE.DEFAULT_DRAFT_SIZE,
    patienceFreeze: false,
    idleHalt: false,
    networkHalt: false,
    toolHalt: toolRecord(false),
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

function isTool(id: unknown): id is ToolId {
  return typeof id === 'string' && (TOOL_IDS as readonly string[]).includes(id);
}

export function applyEffect(agg: Aggregate, e: Effect): void {
  switch (e.t) {
    case 'clickMult':
      agg.clickMult = mult(agg.clickMult, e.v);
      break;
    case 'clickAdd':
      agg.clickAdd = add(agg.clickAdd, e.v);
      break;
    case 'clickPerTool':
      agg.clickPerTool = add(agg.clickPerTool, e.v);
      break;
    case 'idleMult':
      agg.idleMult = mult(agg.idleMult, e.v);
      break;
    case 'toolMult':
      if (isTool(e.id)) agg.toolMult[e.id] = mult(agg.toolMult[e.id], e.v);
      break;
    case 'allMult':
      agg.allMult = mult(agg.allMult, e.v);
      break;
    case 'toolCostMult':
      agg.toolCostMult = mult(agg.toolCostMult, e.v);
      break;
    case 'incidentRateMult':
      agg.incidentRateMult = mult(agg.incidentRateMult, e.v);
      break;
    case 'patienceMult':
      agg.patienceMult = mult(agg.patienceMult, e.v);
      break;
    case 'patienceFreeze':
      agg.patienceFreeze = true;
      break;
    case 'thumbsMult':
      agg.thumbsMult = mult(agg.thumbsMult, e.v);
      break;
    case 'thumbsPerHonest':
      agg.thumbsPerHonest = add(agg.thumbsPerHonest, e.v);
      break;
    case 'startingTokens':
      agg.startingTokens = add(agg.startingTokens, e.v);
      break;
    case 'startingTool':
      if (isTool(e.id)) agg.startingTools[e.id] = add(agg.startingTools[e.id], e.n);
      break;
    case 'draftSize':
      if (Number.isFinite(e.v)) agg.draftSize = Math.max(agg.draftSize, e.v);
      break;
    case 'draftRerolls':
      agg.draftRerolls = add(agg.draftRerolls, e.v);
      break;
    case 'autoClick':
      agg.autoClick = add(agg.autoClick, e.v);
      break;
    case 'idleHalt':
      agg.idleHalt = true;
      break;
    case 'toolHalt':
      if (isTool(e.id)) agg.toolHalt[e.id] = true;
      break;
    case 'networkHalt':
      agg.networkHalt = true;
      break;
    case 'critChance':
      agg.critChance = add(agg.critChance, e.v);
      break;
    case 'critMult':
      agg.critMult = add(agg.critMult, e.v);
      break;
    case 'oneShotChance':
      agg.oneShotChance = add(agg.oneShotChance, e.v);
      break;
    case 'oneShotPayout':
      agg.oneShotPayoutS = add(agg.oneShotPayoutS, e.v);
      break;
    case 'contextMaxMult':
      agg.contextMaxMult = mult(agg.contextMaxMult, e.v);
      break;
    case 'clickContextMult':
      agg.clickContextMult = mult(agg.clickContextMult, e.v);
      break;
    case 'footprintMult':
      agg.footprintMult = mult(agg.footprintMult, e.v);
      break;
    case 'toolFootprintMult':
      if (isTool(e.id)) agg.toolFootprintMult[e.id] = mult(agg.toolFootprintMult[e.id], e.v);
      break;
    case 'floorMult':
      agg.floorMult = mult(agg.floorMult, e.v);
      break;
    case 'summarySlots':
      agg.summarySlots = add(agg.summarySlots, e.v);
      break;
    case 'compactKeep':
      agg.compactKeep = add(agg.compactKeep, e.v);
      break;
    case 'compactPenaltyMult':
      agg.compactPenaltyMult = mult(agg.compactPenaltyMult, e.v);
      break;
    case 'sycophancyMult':
      agg.sycophancyMult = mult(agg.sycophancyMult, e.v);
      break;
    case 'verifyChance':
      agg.verifyChance = add(agg.verifyChance, e.v);
      break;
    case 'claimThreshold':
      agg.claimThreshold = add(agg.claimThreshold, e.v);
      break;
    case 'caughtPenaltyMult':
      agg.caughtPenaltyMult = mult(agg.caughtPenaltyMult, e.v);
      break;
    case 'permissionMult':
      agg.permissionMult = mult(agg.permissionMult, e.v);
      break;
  }
}

function clampTo(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Final pass so a pathological content edit can never emit NaN downstream. */
function finalize(agg: Aggregate): Aggregate {
  const safeMult = (n: number): number => (Number.isFinite(n) && n >= 0 ? n : 1);
  const safeAdd = (n: number): number => (Number.isFinite(n) ? n : 0);
  const positive = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 1);

  agg.clickMult = safeMult(agg.clickMult);
  agg.idleMult = safeMult(agg.idleMult);
  agg.allMult = safeMult(agg.allMult);
  agg.toolCostMult = safeMult(agg.toolCostMult);
  agg.thumbsMult = safeMult(agg.thumbsMult);
  agg.clickContextMult = safeMult(agg.clickContextMult);
  agg.footprintMult = safeMult(agg.footprintMult);
  agg.floorMult = safeMult(agg.floorMult);
  agg.compactPenaltyMult = safeMult(agg.compactPenaltyMult);
  agg.sycophancyMult = safeMult(agg.sycophancyMult);
  agg.caughtPenaltyMult = safeMult(agg.caughtPenaltyMult);
  agg.permissionMult = safeMult(agg.permissionMult);
  // These three divide or define a clock, so zero is as bad as NaN.
  agg.incidentRateMult = positive(agg.incidentRateMult);
  agg.patienceMult = positive(agg.patienceMult);
  agg.contextMaxMult = positive(agg.contextMaxMult);
  for (const id of TOOL_IDS) {
    agg.toolMult[id] = safeMult(agg.toolMult[id]);
    agg.toolFootprintMult[id] = safeMult(agg.toolFootprintMult[id]);
    agg.startingTools[id] = Math.max(0, Math.floor(safeAdd(agg.startingTools[id])));
  }

  agg.clickAdd = safeAdd(agg.clickAdd);
  agg.clickPerTool = safeAdd(agg.clickPerTool);
  agg.thumbsPerHonest = safeAdd(agg.thumbsPerHonest);
  agg.startingTokens = Math.max(0, safeAdd(agg.startingTokens));
  agg.draftRerolls = Math.max(0, Math.floor(safeAdd(agg.draftRerolls)));
  agg.autoClick = Math.max(0, safeAdd(agg.autoClick));
  agg.summarySlots = safeAdd(agg.summarySlots);
  agg.compactKeep = safeAdd(agg.compactKeep);
  agg.verifyChance = safeAdd(agg.verifyChance);
  agg.claimThreshold = safeAdd(agg.claimThreshold);
  agg.draftSize = Math.max(1, Math.floor(safeAdd(agg.draftSize) || BALANCE.DEFAULT_DRAFT_SIZE));

  // Crit dials stack additively across sources, so they need a ceiling:
  // without one a deep build reaches guaranteed crits and stops gambling.
  agg.critChance = clampTo(safeAdd(agg.critChance), 0, BALANCE.CRIT_CHANCE_CAP);
  agg.critMult = Math.max(1, safeAdd(agg.critMult) || BALANCE.CRIT_MULT);
  agg.oneShotChance = clampTo(safeAdd(agg.oneShotChance), 0, BALANCE.ONE_SHOT_CHANCE_CAP);
  agg.oneShotPayoutS = Math.max(0, safeAdd(agg.oneShotPayoutS));
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
// Training -> effects
// ---------------------------------------------------------------------------

/** Level of a Training node, clamped to its declared maxLevel. */
export function metaLevel(meta: MetaState, id: MetaUpgradeId): number {
  const raw = meta.levels[id];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  const def = META_BY_ID[id];
  const max = def ? def.maxLevel : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(max, Math.floor(raw)));
}

/**
 * Every Effect the Training tree applies, via each node's `levelEffects`. Unlock
 * nodes add content instead (see `unlockedContent`), so they contribute none.
 */
export function metaEffects(meta: MetaState): Effect[] {
  const out: Effect[] = [];
  for (const def of META_UPGRADES) {
    if (!def.levelEffects) continue;
    const level = metaLevel(meta, def.id);
    if (level < 1) continue;
    for (const e of def.levelEffects(level)) out.push(e);
  }
  return out;
}

/**
 * What the save has unlocked. A fresh save gets only the STARTING_* sets;
 * everything else hangs off a Training node. Tools 5-10 being locked is what
 * makes run 1 unwinnable by construction.
 */
export interface UnlockedContent {
  readonly tools: ReadonlySet<ToolId>;
  readonly upgrades: ReadonlySet<string>;
  readonly cards: ReadonlySet<string>;
  readonly features: ReadonlySet<MetaFeature>;
}

export function unlockedContent(meta: MetaState): UnlockedContent {
  const tools = new Set<ToolId>(STARTING_TOOLS);
  const upgrades = new Set<string>(STARTING_UPGRADES);
  const cards = new Set<string>(STARTING_CARDS);
  const features = new Set<MetaFeature>();

  for (const def of META_UPGRADES) {
    if (def.kind !== 'unlock' || !def.grants) continue;
    if (metaLevel(meta, def.id) < 1) continue;
    const g = def.grants;
    switch (g.t) {
      case 'tool':
        tools.add(g.id);
        for (const id of g.withUpgrades ?? []) upgrades.add(id);
        for (const id of g.withCards ?? []) cards.add(id);
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
  return { tools, upgrades, cards, features };
}

export function hasFeature(meta: MetaState, feature: MetaFeature): boolean {
  return unlockedContent(meta).features.has(feature);
}

/** True once Endless Mode is bought: prompt 10 no longer ends the run. */
export function endlessUnlocked(meta: MetaState): boolean {
  return hasFeature(meta, 'endless');
}

/** Every prerequisite owned, so this node can be bought. */
export function metaRequirementsMet(meta: MetaState, id: MetaUpgradeId): boolean {
  const def = META_BY_ID[id];
  if (!def) return false;
  return def.requires.every((req) => metaLevel(meta, req) >= 1);
}

// ---------------------------------------------------------------------------
// Lifetime stats and the cross-game import
// ---------------------------------------------------------------------------

/** Keys into `MetaState.stats`. */
export const STAT = {
  /** Lifetime "You're absolutely right!" presses. */
  sycophancy: 'sycophancy',
  /** Lifetime compactions, and how many of them were forced. */
  compactions: 'compactions',
  forcedCompactions: 'forcedCompactions',
  /**
   * Superseded by `LegacyImport.cheater`. Early sequel saves kept the flag
   * here; `migrateMeta` folds it into the import record, and it is still read
   * as a fallback so no save can lose it.
   */
  legacyCheater: 'legacyCheater',
} as const;

/**
 * The human cheated in the first game, so they check the agent's work less.
 * `LegacyImport.cheater` is the source of truth; older records without it fall
 * back to the verdict and the pre-field stats flag.
 */
export function isLegacyCheater(meta: MetaState): boolean {
  const legacy = meta.legacy;
  if (legacy && legacy.verdict !== 'none') {
    if (typeof legacy.cheater === 'boolean') return legacy.cheater;
    if (legacy.verdict === 'edited' || legacy.verdict === 'forged') return true;
  }
  return (meta.stats[STAT.legacyCheater] ?? 0) > 0;
}
