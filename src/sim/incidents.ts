/**
 * Incident scheduling and lifecycle.
 *
 * The scheduler is the first game's: a roll every 25-40 s (scaled by the
 * incident-rate dial), a grace window at the start of each prompt, a good/bad
 * bucket split, and a bias toward outages as the dial climbs. The same id never
 * stacks: a duplicate is filtered out of the pool before the weighted pick.
 *
 * New for the sequel: the pool is filtered by Training features (Auto Mode
 * removes permission prompts and adds rm -rf), by what the player owns, and
 * permission prompts are weighted by `permissionMult`.
 */
import type { ActiveIncident, IncidentDef, IncidentId, MetaFeature, ToolId } from './types.ts';
import { BALANCE, INCIDENTS, INCIDENT_BY_ID, TOOL_IDS } from './content.ts';
import type { Rng } from './rng.ts';

/** Uniform in [INCIDENT_MIN_MS, INCIDENT_MAX_MS], divided by the rate multiplier. */
export function rollIncidentDelayMs(rng: Rng, incidentRateMult: number): number {
  const raw = rng.nextRange(BALANCE.INCIDENT_MIN_MS, BALANCE.INCIDENT_MAX_MS);
  const rate = Number.isFinite(incidentRateMult) && incidentRateMult > 0 ? incidentRateMult : 1;
  const delay = raw / rate;
  return Number.isFinite(delay) && delay > 0 ? delay : BALANCE.INCIDENT_MIN_MS;
}

/** Delay for the first incident of a prompt: never inside the grace window. */
export function rollFirstIncidentDelayMs(rng: Rng, incidentRateMult: number): number {
  return Math.max(BALANCE.INCIDENT_GRACE_MS, rollIncidentDelayMs(rng, incidentRateMult));
}

/** Everything the pool filter and the weights need to know about the run. */
export interface IncidentPoolContext {
  readonly promptIndex: number;
  readonly activeIds: readonly IncidentId[];
  readonly features: ReadonlySet<MetaFeature>;
  readonly tools: Readonly<Record<ToolId, number>>;
  readonly incidentRateMult: number;
  readonly permissionMult: number;
  /** Patience left on the prompt, for the outage fairness rule. */
  readonly patienceMs: number;
}

function ownsAnyTool(tools: Readonly<Record<ToolId, number>>): boolean {
  return TOOL_IDS.some((id) => (tools[id] ?? 0) >= 1);
}

/**
 * An outage that cannot clear before the human gives up is not tension, it is
 * a coin flip the player cannot answer: the bar is full, reporting is gated and
 * there is nothing to do. So an outage only starts if it can be survived.
 */
export function outageIsFair(def: IncidentDef, patienceMs: number): boolean {
  if (!def.blocksReport) return true;
  if (!Number.isFinite(patienceMs)) return true;
  return def.durationMs + BALANCE.OUTAGE_FAIRNESS_MARGIN_MS <= patienceMs;
}

/** Could this incident fire at all right now? Tone is checked separately. */
export function incidentEligible(def: IncidentDef, ctx: IncidentPoolContext): boolean {
  if ((def.minPromptIndex ?? 0) > ctx.promptIndex) return false;
  if (ctx.activeIds.includes(def.id)) return false;
  if (def.requiresFeature && !ctx.features.has(def.requiresFeature)) return false;
  if (def.requiresTool && (ctx.tools[def.requiresTool] ?? 0) < 1) return false;
  // Auto Mode never asks. That is the whole feature.
  if (def.permission && ctx.features.has('autoMode')) return false;
  // Nothing to stall.
  if (def.haltsRandomTool && !ownsAnyTool(ctx.tools)) return false;
  return outageIsFair(def, ctx.patienceMs);
}

export function incidentCandidates(tone: 'bad' | 'good', ctx: IncidentPoolContext): IncidentDef[] {
  return INCIDENTS.filter((def) => def.tone === tone && incidentEligible(def, ctx));
}

/**
 * Weight within the tone bucket. At rate 1 outages are rare; crank the risk
 * dials (tech debt included) and they dominate. Permission prompts scale with
 * `permissionMult` (allowlists make them rarer).
 */
export function incidentWeight(def: IncidentDef, ctx: Pick<IncidentPoolContext, 'incidentRateMult' | 'permissionMult'>): number {
  let w = def.weight;
  if (def.blocksReport) {
    const bias = Math.max(0, ctx.incidentRateMult - 1) * BALANCE.OUTAGE_BIAS;
    w *= 0.45 + bias;
  }
  if (def.permission) w *= ctx.permissionMult;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/**
 * Pick the tone bucket, then a weighted incident inside it. Consumes exactly
 * one RNG draw for the tone and at most one for the pick.
 */
export function selectIncident(
  rng: Rng,
  ctx: IncidentPoolContext,
  goodChance: number = BALANCE.GOOD_INCIDENT_CHANCE,
): IncidentDef | undefined {
  const tone: 'bad' | 'good' = rng.nextFloat() < goodChance ? 'good' : 'bad';
  return rng.weightedPick(incidentCandidates(tone, ctx), (d) => incidentWeight(d, ctx));
}

/**
 * The tool an incident stalls when it names one: permission prompts halt a
 * fixed tool. `haltsRandomTool` incidents are resolved by the sim instead.
 */
export function fixedHaltTarget(def: IncidentDef): ToolId | undefined {
  for (const e of def.effects) if (e.t === 'toolHalt') return e.id;
  return undefined;
}

export function makeActiveIncident(def: IncidentDef, elapsedMs: number, tool?: ToolId): ActiveIncident {
  const duration =
    Number.isFinite(def.durationMs) && def.durationMs > 0 ? def.durationMs : Number.POSITIVE_INFINITY;
  const base = {
    id: def.id,
    remainingMs: duration,
    clicksRemaining: Math.max(0, Math.floor(def.clearWithClicks ?? 0)),
    startedAtMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
  };
  return tool ? { ...base, tool } : base;
}

export function isClickClearable(inc: ActiveIncident): boolean {
  const def = INCIDENT_BY_ID[inc.id];
  return !!def && typeof def.clearWithClicks === 'number' && def.clearWithClicks > 0;
}

export function incidentTone(id: IncidentId): 'bad' | 'good' {
  return INCIDENT_BY_ID[id]?.tone ?? 'bad';
}

/** Human-readable name of an incident id, or the id itself when unknown. */
export function incidentName(id: string): string {
  return INCIDENT_BY_ID[id]?.name ?? id;
}
