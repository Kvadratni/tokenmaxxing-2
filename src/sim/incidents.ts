/**
 * Incident scheduling and lifecycle.
 *
 * Incidents never pause the deadline (locked design decision) and never stack
 * two copies of the same id — the duplicate is filtered out of the candidate
 * pool before the weighted pick, which is the "reroll" branch of the rule.
 */
import type { ActiveIncident, IncidentDef, IncidentId } from './types.ts';
import { BALANCE, INCIDENTS, INCIDENT_BY_ID } from './content.ts';
import type { Rng } from './rng.ts';

/** Uniform in [INCIDENT_MIN_MS, INCIDENT_MAX_MS], divided by the rate multiplier. */
export function rollIncidentDelayMs(rng: Rng, incidentRateMult: number): number {
  const raw = rng.nextRange(BALANCE.INCIDENT_MIN_MS, BALANCE.INCIDENT_MAX_MS);
  const rate = Number.isFinite(incidentRateMult) && incidentRateMult > 0 ? incidentRateMult : 1;
  const delay = raw / rate;
  return Number.isFinite(delay) && delay > 0 ? delay : BALANCE.INCIDENT_MIN_MS;
}

/** Delay for the first incident of a project — never inside the grace window. */
export function rollFirstIncidentDelayMs(rng: Rng, incidentRateMult: number): number {
  return Math.max(BALANCE.INCIDENT_GRACE_MS, rollIncidentDelayMs(rng, incidentRateMult));
}

export function incidentCandidates(
  tone: 'bad' | 'good',
  projectIndex: number,
  activeIds: readonly IncidentId[],
): IncidentDef[] {
  return INCIDENTS.filter(
    (def) =>
      def.tone === tone &&
      (def.minProjectIndex ?? 0) <= projectIndex &&
      !activeIds.includes(def.id),
  );
}

/**
 * Pick the tone bucket then a weighted incident inside it. Consumes exactly one
 * RNG draw for the tone and at most one for the pick.
 */
export function outageWeight(def: IncidentDef, incidentRateMult = 1): number {
  if (!def.blocksShip) return def.weight;
  const bias = Math.max(0, incidentRateMult - 1) * BALANCE.OUTAGE_BIAS;
  return def.weight * (0.45 + bias);
}

/**
 * An outage that cannot clear before the deadline is not tension, it is a coin
 * flip the player cannot answer: the bar is full, the deploy is gated, and
 * there is no action available. Being blocked with 30s left is drama; being
 * blocked with 8s left by a 13s outage is just a stolen run. So an outage only
 * starts if it can actually be survived.
 */
export function outageIsFair(def: IncidentDef, timeLeftMs: number): boolean {
  if (!def.blocksShip) return true;
  if (!Number.isFinite(timeLeftMs)) return true;
  return def.durationMs + BALANCE.OUTAGE_FAIRNESS_MARGIN_MS <= timeLeftMs;
}

export function selectIncident(
  rng: Rng,
  projectIndex: number,
  activeIds: readonly IncidentId[],
  goodChance: number = BALANCE.GOOD_INCIDENT_CHANCE,
  incidentRateMult = 1,
  timeLeftMs = Number.POSITIVE_INFINITY,
): IncidentDef | undefined {
  const tone: 'bad' | 'good' = rng.nextFloat() < goodChance ? 'good' : 'bad';
  const pool = incidentCandidates(tone, projectIndex, activeIds).filter((d) =>
    outageIsFair(d, timeLeftMs),
  );
  return rng.weightedPick(pool, (d) => outageWeight(d, incidentRateMult));
}

export function makeActiveIncident(def: IncidentDef, elapsedMs: number): ActiveIncident {
  const duration = Number.isFinite(def.durationMs) && def.durationMs > 0
    ? def.durationMs
    : Number.POSITIVE_INFINITY;
  return {
    id: def.id,
    remainingMs: duration,
    clicksRemaining: Math.max(0, Math.floor(def.clearWithClicks ?? 0)),
    startedAtMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
  };
}

export function isClickClearable(inc: ActiveIncident): boolean {
  const def = INCIDENT_BY_ID[inc.id];
  return !!def && typeof def.clearWithClicks === 'number' && def.clearWithClicks > 0;
}

export function incidentTone(id: IncidentId): 'bad' | 'good' {
  return INCIDENT_BY_ID[id]?.tone ?? 'bad';
}
