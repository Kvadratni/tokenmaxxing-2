/**
 * One seeded headless game under one policy.
 *
 * Drives the real sim: fixed simulation steps, a duty-cycled click stream, a
 * reflex layer every step (pickups, overflow, flattery, claims) and a shopping
 * decision on a slower cadence, because humans do not re-plan 20 times a second.
 */
import type { CardId, GameEvent, IncidentId, MetaState, ToolId, UpgradeId } from '@sim/types.ts';
import { FINAL_PROMPT_INDEX, INCIDENT_BY_ID, TOOL_IDS, createSim } from '@sim/index.ts';
import type { Sim } from '@sim/index.ts';
import type { Bot, ClickModel, PolicyConfig, PolicyId, PolicyOptions } from './policy.ts';
import { CLICK_AT, HUMAN_CLICKS, instantCps, makeBot } from './policy.ts';

export type EndCause = 'won' | 'patience' | 'caught' | 'compaction' | 'step-cap';

export interface RunResult {
  readonly seed: number;
  readonly policy: string;
  readonly metaName: string;
  readonly won: boolean;
  /** Prompts completed (honestly or by a claim that passed). */
  readonly reported: number;
  /** 1-based prompt the run ended on (10 for a win). */
  readonly reachedPrompt: number;
  readonly cause: EndCause;
  /** Wallet / requirement when the run ended, 0..1+. */
  readonly endProgress: number;
  /** Sim seconds, report beats included, paused pickers excluded. */
  readonly elapsedS: number;
  /** Sim seconds spent on each completed prompt, in order. */
  readonly promptSeconds: readonly number[];
  /** Max patience of each completed prompt when it was completed, in seconds. */
  readonly promptMaxS: readonly number[];
  readonly forcedCompactions: number;
  readonly manualCompactions: number;
  /** Forced compactions per prompt index (0-based). */
  readonly forcedByPrompt: readonly number[];
  readonly manualByPrompt: readonly number[];
  readonly claimsPassed: number;
  readonly caught: number;
  readonly sycophancy: number;
  /** 👍 banked at run end. */
  readonly thumbs: number;
  readonly clicks: number;
  readonly purchases: number;
  readonly tools: Readonly<Record<ToolId, number>>;
  readonly upgrades: readonly UpgradeId[];
  /** Cards held at the end. */
  readonly cards: readonly CardId[];
  /** Every card drafted this run, compacted-away ones included. */
  readonly drafted: readonly CardId[];
  readonly offered: readonly CardId[];
  readonly incidentIds: readonly IncidentId[];
  readonly pickups: number;
  readonly decisions: number;
  readonly reportReadyDecisions: number;
  readonly tensionDecisions: number;
  readonly boughtOverReportDecisions: number;
  /** Longest single prompt, as a multiple of its base patience. */
  readonly longestPromptRatio: number;
  /** True if any state value went NaN / Infinite / negative. */
  readonly invalid: boolean;
  /** The meta after banking this run's 👍 (a copy). */
  readonly metaAfter: MetaState;
}

export interface RunConfig {
  readonly seed: number;
  readonly policy: PolicyId | PolicyConfig;
  readonly meta: MetaState;
  readonly metaName?: string;
  readonly clicks?: ClickModel;
  /** Simulation step. Keep <= BALANCE.MAX_STEP_MS so a tick is one integration. */
  readonly stepMs?: number;
  /** How often the bot re-plans purchases and reporting. */
  readonly decisionEveryMs?: number;
  /** Hard cap on simulated time, in ms. */
  readonly maxMs?: number;
  readonly policyOptions?: PolicyOptions;
  /** Diagnostics: every sim event, with the sim that emitted it. */
  readonly onEvent?: (e: GameEvent, sim: Sim) => void;
  /** Diagnostics: after every simulation step, with the step length in ms. */
  readonly onStep?: (sim: Sim, stepMs: number) => void;
}

export const DEFAULT_STEP_MS = 200;
export const DEFAULT_DECISION_MS = 1_000;
/** 90 minutes: far past any real session. */
export const DEFAULT_MAX_MS = 90 * 60 * 1000;

export function cloneMeta(meta: MetaState): MetaState {
  return {
    ...meta,
    levels: { ...meta.levels },
    achievements: { ...meta.achievements },
    stats: { ...meta.stats },
    settings: { ...meta.settings },
  };
}

function emptyToolRecord(): Record<ToolId, number> {
  const out = {} as Record<ToolId, number>;
  for (const id of TOOL_IDS) out[id] = 0;
  return out;
}

export function runOne(cfg: RunConfig): RunResult {
  const clicks = cfg.clicks ?? HUMAN_CLICKS;
  const stepMs = cfg.stepMs ?? DEFAULT_STEP_MS;
  const decisionMs = cfg.decisionEveryMs ?? DEFAULT_DECISION_MS;
  const maxMs = cfg.maxMs ?? DEFAULT_MAX_MS;
  const meta = cloneMeta(cfg.meta);
  // Settle the one-time game-1 import up front: there is no game-1 save here.
  if (meta.legacy === null) meta.legacy = { verdict: 'none' };

  const promptSeconds: number[] = [];
  const promptMaxS: number[] = [];
  const forcedByPrompt: number[] = [];
  const manualByPrompt: number[] = [];
  const offered: CardId[] = [];
  const drafted: CardId[] = [];
  const incidentIds: IncidentId[] = [];
  let purchases = 0;
  let thumbs = 0;
  let pickups = 0;
  let promptStartMs = 0;
  let caughtAtMs = -1;
  let forcedAtMs = -1;
  let longestRatio = 0;
  let bot: Bot | null = null;
  let sim: Sim | null = null;

  const bump = (arr: number[], i: number): void => {
    while (arr.length <= i) arr.push(0);
    arr[i] = (arr[i] ?? 0) + 1;
  };

  const onEvent = (e: GameEvent): void => {
    if (!sim) return;
    cfg.onEvent?.(e, sim);
    switch (e.t) {
      case 'buyTool':
        if (e.cost > 0) purchases += 1;
        break;
      case 'buyUpgrade':
        purchases += 1;
        break;
      case 'report':
      case 'claim': {
        if (e.t === 'claim' && e.caught) {
          caughtAtMs = sim.run.elapsedMs;
          break;
        }
        const s = (sim.run.elapsedMs - promptStartMs) / 1000;
        promptSeconds.push(s);
        const base = sim.patienceMaxMs / 1000;
        promptMaxS.push(base);
        if (base > 0) longestRatio = Math.max(longestRatio, s / base);
        break;
      }
      case 'compactStart':
        if (e.forced) forcedAtMs = sim.run.elapsedMs;
        bump(e.forced ? forcedByPrompt : manualByPrompt, sim.run.promptIndex);
        break;
      case 'draftOpen':
        for (const c of e.offer) offered.push(c);
        break;
      case 'draftPick':
        drafted.push(e.id);
        break;
      case 'incidentStart':
        incidentIds.push(e.id);
        break;
      case 'pickupCollect':
        pickups += 1;
        break;
      case 'runOver':
        thumbs = e.thumbs;
        break;
      default:
        break;
    }
  };

  sim = createSim({
    seed: cfg.seed,
    meta,
    storage: null,
    persist: false,
    autoStart: false,
    trustSave: true,
    legacyStorage: null,
    onEvent,
  });
  bot = makeBot(cfg.policy, clicks, cfg.seed, cfg.policyOptions ?? {});
  sim.startRun(cfg.seed);

  // Per-seed offset so every bot does not rest in lockstep.
  const phaseMs = (Math.abs(cfg.seed) % Math.max(1, clicks.dutyPeriodMs || 1)) | 0;

  let sinceDecision = decisionMs;
  let clickCredit = 0;
  let decisions = 0;
  let reportReady = 0;
  let tension = 0;
  let boughtOverReport = 0;
  let invalid = false;
  let promptIndex = 0;
  let guard = 0;

  while (sim.run.elapsedMs < maxMs && guard < 2_000_000) {
    guard += 1;
    const run = sim.run;
    if (run.phase === 'won' || run.phase === 'lost') break;

    if (run.promptIndex !== promptIndex) {
      promptIndex = run.promptIndex;
      promptStartMs = run.elapsedMs;
      bot.notePrompt(sim);
    }

    if (run.phase === 'drafting') {
      const choice = bot.draft(sim);
      if (choice === 'reroll') {
        if (!sim.rerollDraft()) {
          const first = sim.run.draftOffer[0];
          if (!first || !sim.pickCard(first)) break;
        }
        continue;
      }
      if (choice === null || !sim.pickCard(choice)) {
        const first = sim.run.draftOffer[0];
        if (!first || !sim.pickCard(first)) break;
      }
      continue;
    }

    if (run.phase === 'compacting') {
      if (!sim.keepCards(bot.keep(sim))) sim.keepCards([]);
      continue;
    }

    if (run.phase === 'running') {
      const cpsNow = instantCps(clicks, run.elapsedMs, phaseMs);
      bot.reflex(sim, cpsNow);
      if (sim.run.phase !== 'running') continue;

      sinceDecision += stepMs;
      if (sinceDecision >= decisionMs) {
        sinceDecision = 0;
        const log = bot.decide(sim);
        decisions += 1;
        if (log.canReport) reportReady += 1;
        if (log.tension) tension += 1;
        if (log.boughtOverReport) boughtOverReport += 1;
        if (sim.run.phase !== 'running') continue;
      }

      clickCredit += (cpsNow * stepMs) / 1000;
      let n = 0;
      while (clickCredit >= 1 && n < 64 && sim.run.phase === 'running') {
        clickCredit -= 1;
        n += 1;
        sim.click(CLICK_AT.x, CLICK_AT.y);
      }
    }

    sim.tick(stepMs);
    cfg.onStep?.(sim, stepMs);
    const r = sim.run;
    if (!Number.isFinite(r.tokens) || r.tokens < -1e-6) invalid = true;
    if (!Number.isFinite(r.patienceMs) || !Number.isFinite(r.context)) invalid = true;
  }

  const run = sim.run;
  const capped = run.phase !== 'won' && run.phase !== 'lost';
  if (capped) sim.endRun(false);
  const won = run.phase === 'won';
  let cause: EndCause;
  if (won) cause = 'won';
  else if (capped) cause = 'step-cap';
  else if (caughtAtMs === run.elapsedMs) cause = 'caught';
  else if (forcedAtMs === run.elapsedMs) cause = 'compaction';
  else cause = 'patience';

  const req = sim.derived().requirement;
  const tools = emptyToolRecord();
  for (const id of TOOL_IDS) tools[id] = run.tools[id];

  return {
    seed: cfg.seed,
    policy: bot.cfg.id,
    metaName: cfg.metaName ?? 'custom',
    won,
    reported: run.reported,
    reachedPrompt: won ? FINAL_PROMPT_INDEX + 1 : Math.min(run.promptIndex + 1, FINAL_PROMPT_INDEX + 1),
    cause,
    endProgress: req > 0 ? Math.max(0, run.tokens) / req : 0,
    elapsedS: run.elapsedMs / 1000,
    promptSeconds,
    promptMaxS,
    forcedCompactions: run.forcedCompactions,
    manualCompactions: run.compactions - run.forcedCompactions,
    forcedByPrompt,
    manualByPrompt,
    claimsPassed: run.claimed,
    caught: run.caught,
    sycophancy: run.sycophancy,
    thumbs,
    clicks: run.clicks,
    purchases,
    tools,
    upgrades: run.owned.slice(),
    cards: run.cards.slice(),
    drafted,
    offered,
    incidentIds,
    pickups,
    decisions,
    reportReadyDecisions: reportReady,
    tensionDecisions: tension,
    boughtOverReportDecisions: boughtOverReport,
    longestPromptRatio: longestRatio,
    invalid,
    metaAfter: cloneMeta(sim.meta),
  };
}

/** Human-readable incident name, tolerant of unknown ids. */
export function incidentLabel(id: IncidentId): string {
  return INCIDENT_BY_ID[id]?.name ?? id;
}
