/**
 * Public surface of the simulation package.
 * Import from `@sim/index.ts` (or `./sim/index.ts`) — never reach into a module.
 */

// Frozen contract + static content, re-exported for convenience.
export * from './types.ts';
export * from './content.ts';

// Simulation
export { createSim, DEFAULT_SEED, incidentName, nextAgentCost } from './sim.ts';
export type { Sim, SimOptions } from './sim.ts';

// Deterministic RNG
export { createRng, hash32, normalizeSeed, standaloneRng } from './rng.ts';
export type { Rng, RngHolder } from './rng.ts';

// Effect folding
export {
  aggregate,
  applyEffect,
  emptyAggregate,
  endlessUnlocked,
  metaEffects,
  metaLevel,
  metaRequirementsMet,
  unlockedContent,
} from './effects.ts';
export type { Aggregate, UnlockedContent } from './effects.ts';

// Derivation
export {
  MAX_BULK_BUY,
  agentCostAt,
  availableUpgradeList,
  baseAggregate,
  bulkAgentCost,
  computeDerived,
  deadlineForProject,
  effectSources,
  liveAggregate,
  totalAgents,
  upgradeUnlocked,
  visibleTierList,
} from './derive.ts';
export type { DeriveContext } from './derive.ts';

// Incidents
export {
  incidentCandidates,
  incidentTone,
  isClickClearable,
  makeActiveIncident,
  outageIsFair,
  outageWeight,
  rollFirstIncidentDelayMs,
  rollIncidentDelayMs,
  selectIncident,
} from './incidents.ts';

// Draft
export { RARITY_WEIGHT, claimedGroups, draftPool, generateOffer } from './draft.ts';

// Persistence
export {
  SAVE_KEY,
  SAVE_VERSION,
  clearMeta,
  defaultMeta,
  defaultSettings,
  defaultStorage,
  loadMeta,
  metaNextCost,
  migrateMeta,
  saveMeta,
} from './save.ts';
export type { StorageLike } from './save.ts';

// Formatting
export {
  SLOP_UNITS,
  formatEta,
  formatInt,
  formatMult,
  formatPercent,
  formatRate,
  formatSlop,
  formatTime,
} from './format.ts';
