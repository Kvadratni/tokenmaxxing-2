/**
 * One seeded headless game under one policy.
 *
 * Drives the real sim: fixed simulation steps, a duty-cycled click stream, and
 * a purchase/ship decision on a slower cadence (humans do not re-plan 20×/s).
 */
import type {
  AgentTierId,
  CardId,
  GameEvent,
  IncidentId,
  MetaState,
  UpgradeId,
} from '@sim/types.ts';
import {
  AGENT_TIER_IDS,
  BALANCE,
  FINAL_PROJECT_INDEX,
  INCIDENT_BY_ID,
  createSim,
  projectAt,
} from '@sim/index.ts';
import type { ClickModel, Policy, PolicyId, PolicyOptions } from './policy.ts';
import { HUMAN_CLICKS, averageCps, instantCps, makePolicy } from './policy.ts';

export type DeathCause = 'deadline' | 'demo-day' | 'step-cap';

/** State captured the instant a project ships (or the run dies). */
export interface ProjectSnapshot {
  readonly projectNumber: number;
  readonly seconds: number;
  readonly requirement: number;
  readonly slop: number;
  readonly idleRate: number;
  readonly clickPower: number;
  readonly agents: string;
  readonly upgrades: number;
  readonly cards: number;
}

export interface RunResult {
  readonly seed: number;
  readonly policy: PolicyId;
  readonly metaName: string;
  /** Projects successfully shipped. */
  readonly shipped: number;
  /** 1-based number of the project the run was sitting on when it ended. */
  readonly reachedProject: number;
  /** Reached Demo Day (shipped all 10). */
  readonly won: boolean;
  readonly cause: DeathCause;
  /** slop / requirement at the moment of death, 0..1+. */
  readonly deathProgress: number;
  /** Wall seconds spent on each shipped project, in order. */
  readonly secondsPerProject: readonly number[];
  readonly demos: number;
  readonly peakIdleRate: number;
  readonly peakClickPower: number;
  readonly purchases: number;
  readonly agentsBought: Readonly<Record<AgentTierId, number>>;
  readonly upgrades: readonly UpgradeId[];
  readonly cards: readonly CardId[];
  /** Every card the drafter was shown, across all offers and rerolls. */
  readonly offered: readonly CardId[];
  readonly incidentsBad: number;
  readonly incidentsGood: number;
  readonly incidentIds: readonly IncidentId[];
  readonly elapsedS: number;
  readonly steps: number;
  readonly clicks: number;
  // --- tension instrumentation ---
  readonly decisions: number;
  /** Decisions where the wallet was already over the bar. */
  readonly shipReadyDecisions: number;
  /** Decisions where shipping *and* a worthwhile purchase were both available. */
  readonly tensionDecisions: number;
  /** Decisions where it bought while able to ship. */
  readonly buyOverShipDecisions: number;
  /** Decisions where a worthwhile purchase existed but was unaffordable. */
  readonly bankedDecisions: number;
  /** Best affordable tier by rate-per-slop, per project index (modal). */
  readonly bestTierByProject: readonly (AgentTierId | null)[];
  readonly bestTierCounts: Readonly<Record<AgentTierId, number>>;
  /** True if any state value went NaN / Infinite / negative. */
  readonly invalid: boolean;
  /** Only populated when `trace` is set. */
  readonly snapshots: readonly ProjectSnapshot[];
}

export interface RunConfig {
  readonly seed: number;
  readonly policy: PolicyId | Policy;
  readonly meta: MetaState;
  readonly metaName?: string;
  readonly clicks?: ClickModel;
  /** Simulation step. Keep <= BALANCE.MAX_STEP_MS so a tick is one integration. */
  readonly stepMs?: number;
  /** How often the bot re-plans purchases / shipping. */
  readonly decisionEveryMs?: number;
  /** Soft-lock guard. */
  readonly maxSteps?: number;
  /** Stop (and bank) once this many projects have shipped. */
  readonly stopAfterShipped?: number;
  /** Force these cards whenever offered — used by the card-health experiment. */
  readonly forceCards?: readonly CardId[];
  /** Never take these cards — the control arm of the same experiment. */
  readonly banCards?: readonly CardId[];
  /** Force/ban shop entries — used by the risk-upgrade experiment. */
  readonly policyOptions?: PolicyOptions;
  /** Capture a per-project snapshot (diagnostics only — costs a little time). */
  readonly trace?: boolean;
}

export const DEFAULT_STEP_MS = 200;
export const DEFAULT_DECISION_MS = 1_000;
/** 40 minutes of simulated play at the default step: far past any real run. */
export const DEFAULT_MAX_STEPS = 12_000;

function emptyTierRecord(): Record<AgentTierId, number> {
  const out = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) out[id] = 0;
  return out;
}

function snapshot(sim: ReturnType<typeof createSim>, projectNumber: number, seconds: number): ProjectSnapshot {
  const d = sim.derived();
  const agents = AGENT_TIER_IDS.map((id) => sim.run.agents[id])
    .join('/')
    .replace(/(\/0)+$/, '');
  return {
    projectNumber,
    seconds,
    requirement: d.requirement,
    slop: sim.run.slop,
    idleRate: d.idleRate,
    clickPower: d.clickPower,
    agents,
    upgrades: sim.run.owned.length,
    cards: sim.run.cards.length,
  };
}

export function cloneMeta(meta: MetaState): MetaState {
  return {
    ...meta,
    levels: { ...meta.levels },
    settings: { ...meta.settings },
  };
}

export function runOne(cfg: RunConfig): RunResult {
  const clicks = cfg.clicks ?? HUMAN_CLICKS;
  const stepMs = cfg.stepMs ?? DEFAULT_STEP_MS;
  const decisionMs = cfg.decisionEveryMs ?? DEFAULT_DECISION_MS;
  const maxSteps = cfg.maxSteps ?? DEFAULT_MAX_STEPS;
  const stopAfter = cfg.stopAfterShipped ?? FINAL_PROJECT_INDEX + 1;
  const policy: Policy =
    typeof cfg.policy === 'string' ? makePolicy(cfg.policy, cfg.policyOptions ?? {}) : cfg.policy;
  const avgCps = averageCps(clicks);
  const forced = cfg.forceCards ? new Set(cfg.forceCards) : null;
  const banned = cfg.banCards ? new Set(cfg.banCards) : null;

  const meta = cloneMeta(cfg.meta);
  const secondsPerProject: number[] = [];
  let incidentsBad = 0;
  let incidentsGood = 0;
  const incidentIds: IncidentId[] = [];
  const offered: CardId[] = [];
  const snapshots: ProjectSnapshot[] = [];
  let purchases = 0;
  let bankedDemos = 0;

  const sim = createSim({
    seed: cfg.seed,
    meta,
    storage: null,
    persist: false,
    autoStart: false,
    onEvent: (e: GameEvent) => {
      switch (e.t) {
        case 'buyAgent':
        case 'buyUpgrade':
          purchases += 1;
          break;
        case 'incidentStart':
          if (e.tone === 'good') incidentsGood += 1;
          else incidentsBad += 1;
          incidentIds.push(e.id);
          break;
        case 'ship': {
          const seconds = (sim.deadlineMs - e.timeLeftMs) / 1000;
          secondsPerProject.push(seconds);
          if (cfg.trace) snapshots.push(snapshot(sim, e.projectIndex + 1, seconds));
          break;
        }
        case 'draftOpen':
          for (const c of e.offer) offered.push(c);
          break;
        case 'runOver':
          bankedDemos = e.demos;
          break;
        default:
          break;
      }
    },
  });
  sim.startRun(cfg.seed);

  // Deterministic per-seed offset so every bot does not rest in lockstep.
  const phaseMs = (Math.abs(cfg.seed) % Math.max(1, clicks.dutyPeriodMs || 1)) | 0;

  let steps = 0;
  let sinceDecision = decisionMs; // decide on the very first step
  let clickCredit = 0;
  let peakIdleRate = 0;
  let peakClickPower = 0;
  let decisions = 0;
  let shipReadyDecisions = 0;
  let tensionDecisions = 0;
  let buyOverShipDecisions = 0;
  let bankedDecisions = 0;
  let invalid = false;
  const bestTierCounts = emptyTierRecord();
  const perProjectTierCounts: Record<AgentTierId, number>[] = [];

  function noteInvalid(): void {
    const r = sim.run;
    if (!Number.isFinite(r.slop) || r.slop < 0) invalid = true;
    if (!Number.isFinite(r.timeLeftMs)) invalid = true;
    if (!Number.isFinite(r.pendingDemos) || r.pendingDemos < 0) invalid = true;
  }

  while (steps < maxSteps) {
    const phase = sim.run.phase;
    if (phase === 'won' || phase === 'lost') break;

    if (phase === 'drafting') {
      const offer = sim.run.draftOffer.slice();
      if (offer.length === 0) {
        sim.endRun(false);
        break;
      }
      let choice: CardId | null = null;
      if (forced) {
        choice = offer.find((c) => forced.has(c)) ?? null;
      }
      if (choice === null) {
        const allowed = banned ? offer.filter((c) => !banned.has(c)) : offer;
        choice = policy.draft(sim, allowed.length > 0 ? allowed : offer, avgCps);
      }
      if (choice === null || !sim.pickCard(choice)) {
        // Nothing legal to pick: bank and stop rather than spin.
        sim.endRun(false);
        break;
      }
      continue;
    }

    if (phase === 'running') {
      sinceDecision += stepMs;
      if (sinceDecision >= decisionMs) {
        sinceDecision = 0;
        const projectIndex = sim.run.projectIndex;
        const log = policy.decide(sim, avgCps);
        decisions += 1;
        if (log.canShip) shipReadyDecisions += 1;
        if (log.tension) tensionDecisions += 1;
        if (log.boughtOverShip) buyOverShipDecisions += 1;
        if (log.banked) bankedDecisions += 1;
        if (log.bestTier) {
          bestTierCounts[log.bestTier] += 1;
          let bucket = perProjectTierCounts[projectIndex];
          if (!bucket) {
            bucket = emptyTierRecord();
            perProjectTierCounts[projectIndex] = bucket;
          }
          bucket[log.bestTier] += 1;
        }
        if (sim.run.shipped >= stopAfter) break;
        if (sim.run.phase !== 'running') continue;
      }

      const d = sim.derived();
      if (d.idleRate > peakIdleRate) peakIdleRate = d.idleRate;
      if (d.clickPower > peakClickPower) peakClickPower = d.clickPower;

      clickCredit += (instantCps(clicks, sim.run.elapsedMs, phaseMs) * stepMs) / 1000;
      let guard = 0;
      while (clickCredit >= 1 && guard < 64 && sim.run.phase === 'running') {
        clickCredit -= 1;
        guard += 1;
        sim.click(160, 120);
      }
    }

    sim.tick(stepMs);
    steps += 1;
    noteInvalid();
  }

  const run = sim.run;
  const shipped = run.shipped;
  const reachedDemoDay = shipped >= FINAL_PROJECT_INDEX + 1;
  let cause: DeathCause;
  if (reachedDemoDay) cause = 'demo-day';
  else if (steps >= maxSteps) cause = 'step-cap';
  else cause = 'deadline';

  const requirement = projectAt(run.projectIndex).requirement;
  const deathProgress = requirement > 0 ? Math.max(0, run.slop) / requirement : 0;
  const agentsBought = emptyTierRecord();
  for (const id of AGENT_TIER_IDS) agentsBought[id] = run.agents[id];
  const upgrades = run.owned.slice();
  const cards = run.cards.slice();
  const elapsedS = run.elapsedMs / 1000;
  const clickCount = run.clicks;

  if (run.phase !== 'won' && run.phase !== 'lost') sim.endRun(reachedDemoDay);

  const bestTierByProject: (AgentTierId | null)[] = [];
  for (let i = 0; i <= Math.max(0, run.projectIndex); i++) {
    const bucket = perProjectTierCounts[i];
    if (!bucket) {
      bestTierByProject.push(null);
      continue;
    }
    let best: AgentTierId | null = null;
    let bestN = 0;
    for (const id of AGENT_TIER_IDS) {
      const n = bucket[id];
      if (n > bestN) {
        bestN = n;
        best = id;
      }
    }
    bestTierByProject.push(best);
  }

  return {
    seed: cfg.seed,
    policy: policy.id,
    metaName: cfg.metaName ?? 'custom',
    shipped,
    reachedProject: Math.min(run.projectIndex + 1, FINAL_PROJECT_INDEX + 1),
    won: reachedDemoDay,
    cause,
    deathProgress,
    secondsPerProject,
    demos: bankedDemos,
    peakIdleRate,
    peakClickPower,
    purchases,
    agentsBought,
    upgrades,
    cards,
    offered,
    incidentsBad,
    incidentsGood,
    incidentIds,
    elapsedS,
    steps,
    clicks: clickCount,
    decisions,
    shipReadyDecisions,
    tensionDecisions,
    buyOverShipDecisions,
    bankedDecisions,
    bestTierByProject,
    bestTierCounts,
    invalid,
    snapshots,
  };
}

/** Human-readable incident name, tolerant of unknown ids. */
export function incidentLabel(id: IncidentId): string {
  return INCIDENT_BY_ID[id]?.name ?? id;
}

/** The number of decision ticks a full-length run can hold, for sanity checks. */
export const MAX_RUN_SECONDS =
  (BALANCE.DEADLINE_BASE_MS / 1000) * (FINAL_PROJECT_INDEX + 1) * 2;
