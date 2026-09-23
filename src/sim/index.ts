/**
 * Public surface of the simulation package. UI, STAGE and the integrator import
 * from here (plus types.ts and content.ts), never from a module directly.
 */

// Frozen contract + static content.
export * from './types.ts';
export * from './content.ts';

// Simulation
export { createSim, DEFAULT_SEED, AUTO_CLICK_POINT } from './sim.ts';
export type { Sim, SimOptions, SimDebug } from './sim.ts';

// Effect folding and Training
export {
  STAT,
  aggregate,
  applyEffect,
  emptyAggregate,
  endlessUnlocked,
  hasFeature,
  isLegacyCheater,
  metaEffects,
  metaLevel,
  metaRequirementsMet,
  unlockedContent,
} from './effects.ts';
export type { Aggregate, UnlockedContent } from './effects.ts';

// Derivation and the shop
export {
  MAX_BULK_BUY,
  availableUpgradeList,
  baseAggregate,
  bulkToolCost,
  bulkToolQuote,
  cappedCount,
  claimThresholdOf,
  clickPowerOf,
  compactKeepOf,
  computeDerived,
  contextFloorOf,
  contextMaxOf,
  effectSources,
  liveAggregate,
  lockedToolList,
  nextToolCost,
  patienceMaxOf,
  summarySlotsOf,
  sycophancyPowerOf,
  toolCostAt,
  totalTools,
  unlockHint,
  upgradeUnlocked,
  verifyChanceOf,
  visibleToolList,
} from './derive.ts';
export type { DeriveContext } from './derive.ts';

// Incidents
export {
  incidentCandidates,
  incidentEligible,
  incidentName,
  incidentTone,
  incidentWeight,
  isClickClearable,
  makeActiveIncident,
  outageIsFair,
} from './incidents.ts';
export type { IncidentPoolContext } from './incidents.ts';

// Draft
export { RARITY_WEIGHT, draftPool, generateOffer } from './draft.ts';

// Deterministic RNG
export { createRng, hash32, normalizeSeed, standaloneRng } from './rng.ts';
export type { Rng, RngHolder } from './rng.ts';

// Persistence
export {
  SAVE_KEY,
  SAVE_VERSION,
  auditSave,
  clearMeta,
  defaultMeta,
  defaultSettings,
  defaultStorage,
  loadMeta,
  memoryStorage,
  metaNextCost,
  migrateMeta,
  saveMeta,
} from './save.ts';
export type { StorageLike } from './save.ts';

// Achievements tracker (names and blurbs are in content.ts)
export { createAchievementTracker } from './achievements.ts';
export type { AchievementTracker } from './achievements.ts';

// Formatting
export {
  TOKEN_UNITS,
  formatContext,
  formatEta,
  formatInt,
  formatMult,
  formatPercent,
  formatRate,
  formatTime,
  formatTokens,
} from './format.ts';
