/**
 * Pure derivation of everything the renderer and UI read, plus the formulas
 * the sim itself shares with them (so the HUD can never disagree with a tick).
 *
 * Nothing here mutates its inputs, reads a clock or draws from the RNG, so it
 * is safe to call once per frame, or a hundred times in a test.
 */
import type {
  DerivedStats,
  Effect,
  MetaState,
  ReportState,
  RunState,
  ToolDef,
  ToolId,
  UpgradeDef,
} from './types.ts';
import {
  BALANCE,
  CARD_BY_ID,
  INCIDENT_BY_ID,
  META_UPGRADES,
  TOOLS,
  TOOL_BY_ID,
  TOOL_IDS,
  UPGRADES,
  UPGRADE_BY_ID,
  modelVersion,
  promptAt,
  promptPatienceMs,
} from './content.ts';
import type { Aggregate } from './effects.ts';
import { aggregate, isLegacyCheater, metaEffects, unlockedContent } from './effects.ts';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function clampTo(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

function ownedOf(run: RunState, id: ToolId): number {
  return Math.max(0, Math.floor(finite(run.tools[id])));
}

// ---------------------------------------------------------------------------
// Effect sources
// ---------------------------------------------------------------------------

/**
 * Modifiers that come from run state rather than from content: tech debt makes
 * incidents more frequent, and a human who cheated in the first game checks
 * claims less.
 */
export function runModifiers(run: RunState, meta: MetaState): Effect[] {
  const out: Effect[] = [];
  const debt = Math.max(0, finite(run.techDebt));
  if (debt > 0) out.push({ t: 'incidentRateMult', v: 1 + BALANCE.TECH_DEBT_INCIDENT * debt });
  if (isLegacyCheater(meta)) out.push({ t: 'verifyChance', v: BALANCE.LEGACY_CHEATER_VERIFY });
  return out;
}

/** Every effect list currently in force, in a stable order. */
export function effectSources(
  run: RunState,
  meta: MetaState,
  includeIncidents = true,
): (readonly Effect[])[] {
  const sources: (readonly Effect[])[] = [metaEffects(meta)];
  for (const id of run.owned) {
    const def = UPGRADE_BY_ID[id];
    if (def) sources.push(def.effects);
  }
  for (const id of run.cards) {
    const def = CARD_BY_ID[id];
    if (def) sources.push(def.effects);
  }
  if (includeIncidents) {
    // INCIDENT_BY_ID covers PICKUP_BUFFS too: buffs are incidents.
    for (const inc of run.incidents) {
      const def = INCIDENT_BY_ID[inc.id];
      if (def) sources.push(def.effects);
    }
  }
  sources.push(runModifiers(run, meta));
  return sources;
}

/** The live modifier picture, active incidents included. */
export function liveAggregate(run: RunState, meta: MetaState): Aggregate {
  return aggregate(effectSources(run, meta, true));
}

/** Everything except incidents: run setup and run-end banking use this. */
export function baseAggregate(run: RunState, meta: MetaState): Aggregate {
  return aggregate(effectSources(run, meta, false));
}

// ---------------------------------------------------------------------------
// Shared formulas
// ---------------------------------------------------------------------------

export function totalTools(run: RunState): number {
  let n = 0;
  for (const id of TOOL_IDS) n += ownedOf(run, id);
  return n;
}

/** BASE_CONTEXT x contextMaxMult. */
export function contextMaxOf(agg: Aggregate): number {
  const max = BALANCE.BASE_CONTEXT * agg.contextMaxMult;
  return Number.isFinite(max) && max > 0 ? max : BALANCE.BASE_CONTEXT;
}

/**
 * The MCP manuals that never leave: sum of owned x floor x floorMult, capped at
 * FLOOR_CAP_FRACTION of the window. Without the cap, enough servers in a small
 * window would leave no room after a compaction and compact every tick.
 */
export function contextFloorOf(run: RunState, agg: Aggregate): number {
  let floor = 0;
  for (const def of TOOLS) {
    if (def.floor <= 0) continue;
    floor += ownedOf(run, def.id) * def.floor * agg.floorMult;
  }
  return finite(Math.min(floor, BALANCE.FLOOR_CAP_FRACTION * contextMaxOf(agg)), 0);
}

/** promptPatienceMs(index) x patienceMult, recomputed live. */
export function patienceMaxOf(promptIndex: number, agg: Aggregate): number {
  const base = promptPatienceMs(Math.max(0, promptIndex));
  const max = base * agg.patienceMult;
  return Number.isFinite(max) && max > 0 ? max : base;
}

/** Wallet fraction of the requirement at which Claim Done unlocks. */
export function claimThresholdOf(agg: Aggregate): number {
  return clampTo(BALANCE.CLAIM_THRESHOLD + agg.claimThreshold, BALANCE.CLAIM_THRESHOLD_MIN, 1);
}

/** Chance the human verifies (and rejects) a claim right now. */
export function verifyChanceOf(agg: Aggregate, run: RunState): number {
  const raw =
    BALANCE.VERIFY_BASE +
    agg.verifyChance +
    BALANCE.VERIFY_PER_PASS * Math.max(0, finite(run.claimed)) +
    BALANCE.VERIFY_PER_CAUGHT * Math.max(0, finite(run.caught));
  return clampTo(finite(raw, BALANCE.VERIFY_BASE), BALANCE.VERIFY_MIN, BALANCE.VERIFY_MAX);
}

/** Cards that survive a compaction. */
export function summarySlotsOf(agg: Aggregate): number {
  return Math.max(0, Math.floor(BALANCE.BASE_SUMMARY_SLOTS + agg.summarySlots));
}

/** Wallet fraction a forced or manual compaction keeps. */
export function compactKeepOf(agg: Aggregate, forced: boolean): number {
  const base = forced ? BALANCE.COMPACT_KEEP_FORCED : BALANCE.COMPACT_KEEP_MANUAL;
  return clampTo(base + agg.compactKeep, 0, BALANCE.COMPACT_KEEP_CAP);
}

/** Patience fraction the next "You're absolutely right!" restores. */
export function sycophancyPowerOf(agg: Aggregate, heat: number): number {
  const h = Math.max(0, finite(heat));
  return clamp01(BALANCE.SYCOPHANCY_BASE * agg.sycophancyMult * Math.pow(0.5, h));
}

/** Tokens per click: (BASE + clickAdd) x clickMult x (1 + clickPerTool x tools) x allMult. */
export function clickPowerOf(run: RunState, agg: Aggregate): number {
  const perTool = 1 + agg.clickPerTool * totalTools(run);
  const power = (BALANCE.BASE_CLICK + agg.clickAdd) * agg.clickMult * perTool * agg.allMult;
  return Math.max(0, finite(power, 0));
}

/** Which tools are stalled right now, whether or not any are owned. */
export function haltedTools(run: RunState, agg: Aggregate): Record<ToolId, boolean> {
  const out = {} as Record<ToolId, boolean>;
  const pausedForCompact = finite(run.compactingMs) > 0;
  for (const def of TOOLS) {
    out[def.id] =
      pausedForCompact ||
      agg.idleHalt ||
      agg.toolHalt[def.id] ||
      (agg.networkHalt && def.network);
  }
  // "A Hook Blocked Your Tool Call" resolves its target when it fires.
  for (const inc of run.incidents) {
    if (inc.tool && inc.tool in out) out[inc.tool] = true;
  }
  return out;
}

export function reportBlockerOf(run: RunState): string | null {
  for (const inc of run.incidents) {
    const def = INCIDENT_BY_ID[inc.id];
    if (def?.blocksReport) return def.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool costs
// ---------------------------------------------------------------------------

/** round(baseCost x costGrowth^owned x toolCostMult), floored at 1. */
export function toolCostAt(def: ToolDef, owned: number, toolCostMult: number): number {
  const o = Math.max(0, Math.floor(finite(owned)));
  const raw = def.baseCost * Math.pow(def.costGrowth, o) * finite(toolCostMult, 1);
  if (!Number.isFinite(raw)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(raw));
}

/** Hard cap on a single bulk quote so a degenerate cost curve cannot hang. */
export const MAX_BULK_BUY = 100_000;

/** Units of `want` that fit under the tool's cap. `want` may be Infinity ("max"). */
export function cappedCount(def: ToolDef, owned: number, want: number): number {
  const room = Math.max(0, def.maxOwned - Math.max(0, Math.floor(finite(owned))));
  if (want === Number.POSITIVE_INFINITY) return room;
  if (!Number.isFinite(want)) return 0;
  return Math.max(0, Math.min(Math.floor(want), room));
}

/**
 * Price of `count` more units, summing the *rounded* unit prices so a bulk buy
 * always costs exactly what N single buys would.
 */
export function bulkToolCost(def: ToolDef, owned: number, count: number, toolCostMult: number): number {
  return bulkToolQuote(def, owned, count, toolCostMult).total;
}

/**
 * How many of `count` units fit in `budget`, and what they cost. The sim's
 * "buy max" uses this; a plain bulk buy passes an infinite budget.
 */
export function bulkToolQuote(
  def: ToolDef,
  owned: number,
  count: number,
  toolCostMult: number,
  budget = Number.POSITIVE_INFINITY,
): { count: number; total: number } {
  if (!(count > 0)) return { count: 0, total: 0 };
  const limit = Number.isFinite(count) ? Math.min(Math.floor(count), MAX_BULK_BUY) : MAX_BULK_BUY;
  let total = 0;
  let bought = 0;
  for (let i = 0; i < limit; i++) {
    const price = toolCostAt(def, owned + i, toolCostMult);
    if (!Number.isFinite(price)) break;
    if (total + price > budget) break;
    total += price;
    bought += 1;
  }
  return { count: bought, total };
}

// ---------------------------------------------------------------------------
// Shop visibility
// ---------------------------------------------------------------------------

/**
 * Tools on sale right now. Two gates: the save must have unlocked the tool at
 * all, and the run must have climbed to it (the previous tier owned at least
 * `revealAfterPrevOwned` times). A tool the run already owns always stays on
 * screen: rm -rf can take the last unit of the tier below it.
 */
export function visibleToolList(run: RunState, meta: MetaState): ToolDef[] {
  const unlocked = unlockedContent(meta).tools;
  const out: ToolDef[] = [];
  for (let i = 0; i < TOOLS.length; i++) {
    const def = TOOLS[i];
    if (!def) break;
    if (!unlocked.has(def.id)) continue;
    if (i === 0 || ownedOf(run, def.id) > 0) {
      out.push(def);
      continue;
    }
    const prev = TOOLS[i - 1];
    if (!prev) break;
    if (ownedOf(run, prev.id) >= def.revealAfterPrevOwned) out.push(def);
    else break;
  }
  return out;
}

/**
 * Tools the save has unlocked that the run has not climbed to yet: inert
 * preview rows under the live ones. `lookahead` defaults to all of them, so
 * anything paid for in Training is always on screen.
 */
export function lockedToolList(run: RunState, meta: MetaState, lookahead = TOOLS.length): ToolDef[] {
  const visible = new Set(visibleToolList(run, meta).map((t) => t.id));
  const unlocked = unlockedContent(meta).tools;
  const out: ToolDef[] = [];
  for (const def of TOOLS) {
    if (visible.has(def.id) || !unlocked.has(def.id)) continue;
    out.push(def);
    if (out.length >= lookahead) break;
  }
  return out;
}

/** Why `def` is not on sale, or null when it is. */
export function unlockHint(run: RunState, meta: MetaState, def: ToolDef): string | null {
  if (!unlockedContent(meta).tools.has(def.id)) {
    const node = META_UPGRADES.find((m) => m.grants?.t === 'tool' && m.grants.id === def.id);
    return node ? `Unlock in Training: ${node.name}` : 'Locked';
  }
  const idx = TOOLS.findIndex((t) => t.id === def.id);
  if (idx <= 0 || ownedOf(run, def.id) > 0) return null;
  const prev = TOOLS[idx - 1];
  if (!prev) return null;
  const need = Math.max(1, def.revealAfterPrevOwned);
  if (ownedOf(run, prev.id) >= need) return null;
  return `Needs ${need} × ${prev.name}`;
}

/** The upgrade's own requirement (prompt reached, tool owned, upgrade owned). */
export function upgradeUnlocked(run: RunState, def: UpgradeDef): boolean {
  const req = def.requires;
  if (!req) return true;
  if (typeof req.minPrompt === 'number' && run.promptIndex < req.minPrompt) return false;
  if (req.tool && ownedOf(run, req.tool.id) < req.tool.owned) return false;
  if (req.upgrade && !run.owned.includes(req.upgrade)) return false;
  return true;
}

/** Unlocked in Training, requirement met, not owned yet. */
export function availableUpgradeList(run: RunState, meta: MetaState): UpgradeDef[] {
  const unlocked = unlockedContent(meta).upgrades;
  return UPGRADES.filter(
    (u) => !run.owned.includes(u.id) && unlocked.has(u.id) && upgradeUnlocked(run, u),
  );
}

// ---------------------------------------------------------------------------
// DerivedStats
// ---------------------------------------------------------------------------

/** What only the sim knows about the run in progress. */
export interface DeriveContext {
  /** Run number being played; `modelVersion` names it. Default: meta.runs + 1. */
  runNumber?: number;
  /** The final prompt was completed this run (Endless keeps going after the win). */
  won?: boolean;
}

/**
 * Everything the HUD and the stage read. Pass `agg` when the caller already
 * folded the live aggregate this step.
 */
export function computeDerived(
  run: RunState,
  meta: MetaState,
  agg?: Aggregate,
  ctx: DeriveContext = {},
): DerivedStats {
  const a = agg ?? liveAggregate(run, meta);
  const pausedForCompact = finite(run.compactingMs) > 0;

  // A manual /compact halts generation: clicks yield nothing until it is done.
  const clickPower = pausedForCompact ? 0 : clickPowerOf(run, a);
  const clickContext = pausedForCompact ? 0 : Math.max(0, BALANCE.CTX_PER_CLICK * a.clickContextMult);
  const autoClickHz = Math.max(0, finite(a.autoClick));

  const toolHalted = haltedTools(run, a);
  const toolRates = {} as Record<ToolId, number>;
  const toolFootprint = {} as Record<ToolId, number>;
  const nextCosts = {} as Record<ToolId, number>;
  const headroom = {} as Record<ToolId, number>;
  let idleRate = 0;
  let contextRate = 0;
  for (const def of TOOLS) {
    const id = def.id;
    const owned = ownedOf(run, id);
    const working = !toolHalted[id];
    const rate = working ? finite(def.baseRate * owned * a.toolMult[id] * a.idleMult * a.allMult) : 0;
    toolRates[id] = rate;
    idleRate += rate;
    // The shop's price tag: one unit's footprint, halted or not.
    toolFootprint[id] = Math.max(0, finite(def.footprint * a.toolFootprintMult[id] * a.footprintMult));
    if (working) contextRate += owned * toolFootprint[id];
    nextCosts[id] = toolCostAt(def, owned, a.toolCostMult);
    headroom[id] = Math.max(0, def.maxOwned - owned);
  }
  idleRate = finite(idleRate);
  contextRate = finite(contextRate);

  const prompt = promptAt(Math.max(0, run.promptIndex));
  const requirement = prompt.requirement;
  const tokens = finite(run.tokens);
  const claimThreshold = claimThresholdOf(a);
  const reportBlockedBy = reportBlockerOf(run);
  let reportState: ReportState = 'working';
  if (reportBlockedBy !== null && tokens >= claimThreshold * requirement) reportState = 'blocked';
  else if (tokens >= requirement) reportState = 'report';
  else if (tokens >= claimThreshold * requirement) reportState = 'claim';

  const patienceMaxMs = patienceMaxOf(run.promptIndex, a);
  const contextMax = contextMaxOf(a);
  const contextFloor = contextFloorOf(run, a);
  const context = finite(run.context);
  const secondsToCompaction =
    context >= contextMax ? 0 : contextRate > 0 ? (contextMax - context) / contextRate : Number.POSITIVE_INFINITY;

  // Auto-clicks are hands-off income, so the ETA counts them.
  const need = requirement - tokens;
  const passiveRate = idleRate + autoClickHz * clickPower;
  const etaSeconds = need <= 0 ? 0 : passiveRate > 0 ? need / passiveRate : Number.POSITIVE_INFINITY;

  const won = run.phase === 'won' || ctx.won === true;
  const thumbsIfEndedNow =
    Math.max(0, Math.round(finite(run.pendingThumbs) * a.thumbsMult)) + (won ? BALANCE.WIN_BONUS_THUMBS : 0);

  const compactFeature = unlockedContent(meta).features.has('compact');

  return {
    clickPower,
    idleRate,
    autoClickHz,
    toolRates,
    toolHalted,
    nextCosts,
    headroom,
    toolFootprint,
    toolCostMult: a.toolCostMult,
    requirement,
    reportProgress: clamp01(tokens / requirement),
    reportState,
    reportBlockedBy,
    claimThreshold,
    verifyChance: verifyChanceOf(a, run),
    patienceProgress: clamp01(finite(run.patienceMs) / patienceMaxMs),
    patienceMaxMs,
    patienceFrozen: a.patienceFreeze,
    sycophancyPower: sycophancyPowerOf(a, run.sycophancyHeat),
    contextMax,
    contextFloor,
    contextFill: clamp01(context / contextMax),
    contextRate,
    clickContext,
    secondsToCompaction,
    summarySlots: summarySlotsOf(a),
    compactKeepForced: compactKeepOf(a, true),
    compactKeepManual: compactKeepOf(a, false),
    canCompact: compactFeature && run.phase === 'running' && !pausedForCompact,
    etaSeconds,
    thumbsIfEndedNow,
    incidentRateMult: a.incidentRateMult,
    critChance: a.critChance,
    critMult: a.critMult,
    oneShotChance: a.oneShotChance,
    oneShotPayoutS: a.oneShotPayoutS,
    scene: prompt.scene,
    modelVersion: modelVersion(
      ctx.runNumber !== undefined && Number.isFinite(ctx.runNumber)
        ? ctx.runNumber
        : Math.max(0, Math.floor(finite(meta.runs))) + 1,
    ),
    multipliers: { click: a.clickMult, idle: a.idleMult, all: a.allMult },
  };
}

/** Cost of the next unit of a tool given the current run: handy for tooling. */
export function nextToolCost(run: RunState, meta: MetaState, id: ToolId): number {
  const def = TOOL_BY_ID[id];
  return toolCostAt(def, ownedOf(run, id), liveAggregate(run, meta).toolCostMult);
}
