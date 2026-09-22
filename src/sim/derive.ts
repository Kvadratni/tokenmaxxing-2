/**
 * Pure derivation of everything the renderer and UI read.
 *
 * `computeDerived` never mutates its inputs and never touches the clock or the
 * RNG, so it is safe to call once per frame (or a hundred times in a test).
 */
import type {
  AgentTierDef,
  AgentTierId,
  DerivedStats,
  Effect,
  MetaState,
  RunState,
  UpgradeDef,
} from './types.ts';
import {
  AGENT_BY_ID,
  BALANCE,
  AGENT_TIERS,
  AGENT_TIER_IDS,
  CARD_BY_ID,
  INCIDENT_BY_ID,
  UPGRADES,
  UPGRADE_BY_ID,
  projectAt,
  projectDeadlineMs,
} from './content.ts';
import type { Aggregate } from './effects.ts';
import { unlockedContent } from './effects.ts';
import { aggregate, metaEffects } from './effects.ts';

export interface DeriveContext {
  /** Deadline length of the *current* project, after deadlineMult. */
  deadlineMs?: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
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
    for (const inc of run.incidents) {
      const def = INCIDENT_BY_ID[inc.id];
      if (def) sources.push(def.effects);
    }
  }
  return sources;
}

/** Aggregate including active incidents — the live modifier picture. */
export function liveAggregate(run: RunState, meta: MetaState): Aggregate {
  return aggregate(effectSources(run, meta, true));
}

/** Aggregate excluding incidents — used for deadlines, drafts and run setup. */
export function baseAggregate(run: RunState, meta: MetaState): Aggregate {
  return aggregate(effectSources(run, meta, false));
}

export function totalAgents(run: RunState): number {
  let n = 0;
  for (const id of AGENT_TIER_IDS) n += finite(run.agents[id]);
  return n;
}

/** cost(id, owned) = round(baseCost * costGrowth^owned * agentCostMult), floored at 1. */
export function agentCostAt(def: AgentTierDef, owned: number, agentCostMult: number): number {
  const o = Math.max(0, Math.floor(finite(owned)));
  const raw = def.baseCost * Math.pow(def.costGrowth, o) * finite(agentCostMult, 1);
  if (!Number.isFinite(raw)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(raw));
}

/** Hard cap on a single "buy max" so a degenerate cost curve can't hang. */
export const MAX_BULK_BUY = 100_000;

/**
 * Total price of buying `count` more units, summing the *rounded* per-unit
 * costs so a bulk buy always matches N sequential single buys exactly.
 * `count` may be Infinity, in which case `budget` decides how many fit.
 */
export function cappedCount(def: AgentTierDef, owned: number, want: number): number {
  const room = Math.max(0, def.maxOwned - Math.max(0, Math.floor(owned)));
  if (!Number.isFinite(want)) return room;
  return Math.max(0, Math.min(Math.floor(want), room));
}

export function bulkAgentCost(
  def: AgentTierDef,
  owned: number,
  count: number,
  agentCostMult: number,
  budget = Number.POSITIVE_INFINITY,
): { count: number; total: number } {
  if (!(count > 0)) return { count: 0, total: 0 };
  const limit = Number.isFinite(count) ? Math.min(Math.floor(count), MAX_BULK_BUY) : MAX_BULK_BUY;
  let total = 0;
  let bought = 0;
  for (let i = 0; i < limit; i++) {
    const price = agentCostAt(def, owned + i, agentCostMult);
    if (!Number.isFinite(price)) break;
    if (total + price > budget) break;
    total += price;
    bought += 1;
  }
  return { count: bought, total };
}

/** A tier is visible once the previous tier's reveal threshold is met. */
export function visibleTierList(run: RunState, meta: MetaState): AgentTierDef[] {
  const unlocked = unlockedContent(meta).tiers;
  const out: AgentTierDef[] = [];
  for (let i = 0; i < AGENT_TIERS.length; i++) {
    const def = AGENT_TIERS[i];
    if (!def) break;
    // Two gates: the save must have unlocked the tier at all, and the run must
    // have climbed to it.
    if (!unlocked.has(def.id)) continue;
    if (i === 0) {
      out.push(def);
      continue;
    }
    const prev = AGENT_TIERS[i - 1];
    if (!prev) break;
    const prevOwned = finite(run.agents[prev.id]);
    if (prevOwned >= def.revealAfterPrevOwned && def.revealAfterPrevOwned >= 0) {
      out.push(def);
    } else {
      break;
    }
  }
  return out;
}

export function upgradeUnlocked(run: RunState, def: UpgradeDef): boolean {
  const req = def.requires;
  if (!req) return true;
  if (typeof req.minProject === 'number' && run.projectIndex < req.minProject) return false;
  if (req.agent && finite(run.agents[req.agent.id]) < req.agent.owned) return false;
  if (req.upgrade && !run.owned.includes(req.upgrade)) return false;
  return true;
}

export function availableUpgradeList(run: RunState, meta: MetaState): UpgradeDef[] {
  const unlocked = unlockedContent(meta).upgrades;
  return UPGRADES.filter(
    (u) => !run.owned.includes(u.id) && unlocked.has(u.id) && upgradeUnlocked(run, u),
  );
}

/** Deadline of the current project derived from content + modifiers. */
export function deadlineForProject(index: number, deadlineMult: number): number {
  const raw = projectDeadlineMs(index) * finite(deadlineMult, 1);
  return Number.isFinite(raw) && raw > 0 ? raw : projectDeadlineMs(index);
}

export function computeDerived(
  run: RunState,
  meta: MetaState,
  ctx: DeriveContext = {},
): DerivedStats {
  const agg = liveAggregate(run, meta);

  const clickPerAgentTotal = agg.clickPerAgent * totalAgents(run);
  const clickPower = finite(
    (BALANCE.BASE_CLICK + agg.clickAdd + clickPerAgentTotal) * agg.clickMult * agg.allMult,
    0,
  );
  const autoClickHz = finite(Math.max(0, agg.autoClick), 0);

  const tierRates = {} as Record<AgentTierId, number>;
  const headroom = {} as Record<AgentTierId, number>;
  const nextCosts = {} as Record<AgentTierId, number>;
  let idleRate = 0;
  for (const id of AGENT_TIER_IDS) {
    const def = AGENT_BY_ID[id];
    const owned = Math.max(0, Math.floor(finite(run.agents[id])));
    const raw = agg.idleHalt ? 0 : def.baseRate * owned * agg.tierMult[id] * agg.idleMult * agg.allMult;
    const rate = finite(raw, 0);
    tierRates[id] = rate;
    idleRate += rate;
    nextCosts[id] = agentCostAt(def, owned, agg.agentCostMult);
    headroom[id] = Math.max(0, def.maxOwned - owned);
  }
  idleRate = finite(idleRate, 0);

  const requirement = projectAt(Math.max(0, run.projectIndex)).requirement;
  const slop = finite(run.slop, 0);
  const deadlineMs =
    ctx.deadlineMs && Number.isFinite(ctx.deadlineMs) && ctx.deadlineMs > 0
      ? ctx.deadlineMs
      : deadlineForProject(Math.max(0, run.projectIndex), agg.deadlineMult);

  // An outage blocks the deploy outright. The clock does not stop for it.
  let shipBlockedBy: string | null = null;
  for (const inc of run.incidents) {
    const def = INCIDENT_BY_ID[inc.id];
    if (def?.blocksShip) {
      shipBlockedBy = def.name;
      break;
    }
  }

  const need = requirement - slop;
  // Auto-clicks are hands-off income, so the ETA must include them or an
  // idle build reads as "never finishes".
  const passiveRate = idleRate + autoClickHz * clickPower;
  const etaSeconds =
    need <= 0 ? 0 : passiveRate > 0 ? need / passiveRate : Number.POSITIVE_INFINITY;

  return {
    clickPower,
    idleRate,
    autoClickHz,
    tierRates,
    nextCosts,
    requirement,
    shipProgress: clamp01(slop / requirement),
    deadlineProgress: clamp01(finite(run.timeLeftMs, 0) / deadlineMs),
    canShip: slop >= requirement && shipBlockedBy === null,
    shipBlockedBy,
    headroom,
    etaSeconds,
    demosIfEndedNow: Math.max(0, Math.floor(finite(run.pendingDemos, 0))),
    incidentRateMult: agg.incidentRateMult,
    critChance: agg.critChance,
    critMult: agg.critMult,
    oneShotChance: agg.oneShotChance,
    oneShotPayoutS: agg.oneShotPayout,
    multipliers: { click: agg.clickMult, idle: agg.idleMult, all: agg.allMult },
  };
}

/**
 * Tiers the save has unlocked but the run has not yet climbed to — rendered as
 * inert preview rows under the live ones.
 *
 * `lookahead` defaults to "all of them" on purpose. It used to be a window of 3,
 * which meant a tier you had just spent Demos unlocking could sit queued behind
 * three ladder rungs and not appear in the shop at all. The unlock gate is the
 * limiter here; anything you have paid for is always on screen.
 */
export function lockedTierList(
  run: RunState,
  meta: MetaState,
  lookahead = AGENT_TIERS.length,
): AgentTierDef[] {
  const visible = new Set(visibleTierList(run, meta).map((t) => t.id));
  const unlocked = unlockedContent(meta).tiers;
  const out: AgentTierDef[] = [];
  for (const def of AGENT_TIERS) {
    if (visible.has(def.id)) continue;
    // A tier the save has never unlocked is not "coming next" — it is not in
    // the game yet, and the meta tree is where you learn about it.
    if (!unlocked.has(def.id)) continue;
    out.push(def);
    if (out.length >= lookahead) break;
  }
  return out;
}

/** What the player must own for `def` to unlock. Null when already unlocked. */
export function unlockHint(run: RunState, def: AgentTierDef): string | null {
  const idx = AGENT_TIERS.findIndex((t) => t.id === def.id);
  if (idx <= 0) return null;
  const prev = AGENT_TIERS[idx - 1];
  if (!prev) return null;
  const owned = Math.max(0, Math.floor(finite(run.agents[prev.id])));
  const need = Math.max(1, def.revealAfterPrevOwned);
  if (owned >= need) return null;
  return `Needs ${need} \u00d7 ${prev.name}`;
}
