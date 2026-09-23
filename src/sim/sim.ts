/**
 * The simulation. Deterministic, DOM-free, no wall clock.
 *
 * Every source of randomness runs through the seeded RNG whose cursor lives in
 * `RunState.rngState`; every source of time arrives via `tick(dtMs)`. Replaying
 * the same seed with the same input sequence reproduces state exactly.
 *
 * You are the agent. Tokens are your wallet and your progress bar; the human's
 * patience is the only clock that ends a run; everything you do fills the
 * context window, and overflowing it compacts you.
 */
import type {
  AchievementId,
  CardId,
  DerivedStats,
  EventSink,
  GameEvent,
  IncidentDef,
  IncidentId,
  InstantAction,
  MetaFeature,
  MetaState,
  MetaUpgradeId,
  RunState,
  SaveVerdict,
  Settings,
  SimApi,
  ToolDef,
  ToolId,
  UpgradeDef,
  UpgradeId,
} from './types.ts';
import type { PickupDef } from './content.ts';
import {
  ACHIEVEMENT_BY_ID,
  BALANCE,
  CARD_BY_ID,
  FINAL_PROMPT_INDEX,
  INCIDENT_BY_ID,
  LEGACY_SAVE_KEY,
  META_BY_ID,
  PICKUP_BY_ID,
  PICKUP_TUNING,
  TOOLS,
  TOOL_BY_ID,
  TOOL_IDS,
  UPGRADE_BY_ID,
  availablePickups,
  pickupWeight,
  promptAt,
} from './content.ts';
import type { Aggregate, UnlockedContent } from './effects.ts';
import type { DeriveContext } from './derive.ts';
import { STAT, metaLevel, metaRequirementsMet, unlockedContent } from './effects.ts';
import {
  availableUpgradeList,
  baseAggregate,
  bulkToolQuote,
  cappedCount,
  clickPowerOf,
  compactKeepOf,
  computeDerived,
  contextFloorOf,
  contextMaxOf,
  liveAggregate,
  lockedToolList,
  patienceMaxOf,
  summarySlotsOf,
  sycophancyPowerOf,
  upgradeUnlocked,
  visibleToolList,
} from './derive.ts';
import { draftPool, generateOffer } from './draft.ts';
import type { IncidentPoolContext } from './incidents.ts';
import {
  fixedHaltTarget,
  makeActiveIncident,
  rollFirstIncidentDelayMs,
  rollIncidentDelayMs,
  selectIncident,
} from './incidents.ts';
import { legacyGift, readLegacySave } from './legacy.ts';
import { createRng, hash32, normalizeSeed } from './rng.ts';
import type { StorageLike } from './save.ts';
import {
  defaultMeta,
  defaultStorage,
  loadMetaAudited,
  memoryStorage,
  metaNextCost,
  saveMeta,
} from './save.ts';
import { createAchievementTracker } from './achievements.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableRun = Mutable<RunState>;

export const DEFAULT_SEED = 0x5eed_1337;
/**
 * Where automation "clicks": the centre of the agent's hit box (render's
 * AGENT_RECT, 134,106 52x60; the sim may not import render). Cosmetic only:
 * the click event carries it so popups land on the agent.
 */
export const AUTO_CLICK_POINT = { x: 160, y: 136 } as const;
/** Ceiling on automated clicks resolved in one sim step. */
const MAX_AUTO_CLICKS_PER_STEP = 24;
/** Same guard for one-shot rolls: a throttled tab must not dump a jackpot. */
const MAX_ONE_SHOT_ROLLS = 8;
/** Where a forced pickup appears when the caller gives no position. */
const FORCED_PICKUP_AT = { x: 160, y: 80 } as const;
const TAU = Math.PI * 2;

export interface SimOptions {
  /** Initial run seed. Omit and the sim derives one deterministically. */
  seed?: number;
  /** Pre-loaded meta; omit to load from storage. */
  meta?: MetaState;
  /** Storage backend. `null` disables persistence entirely. */
  storage?: StorageLike | null;
  /** Write meta to storage on meta mutations. Default true. */
  persist?: boolean;
  /** Start a run immediately. Default true. */
  autoStart?: boolean;
  /** Convenience sink registered before the first event fires. */
  onEvent?: EventSink;
  /**
   * Skip the save-tamper check. The QA harness injects raw saves by design, so
   * every e2e run would otherwise earn Script Kiddie. Hosts set this whenever
   * the test hooks are live.
   */
  trustSave?: boolean;
  /** Where to look for the Tokenmaxxing 1 save. Default: `storage`. */
  legacyStorage?: StorageLike | null;
}

/** Test hooks. The host wraps each one so using it earns QA Engineer. */
export interface SimDebug {
  grantTokens(n: number): void;
  /** Unspent 👍, counted as earned so the save stays coherent. */
  grantThumbs(n: number): void;
  /** Start an incident (or pickup buff) now. False if unknown or not running. */
  forceIncident(id: IncidentId): boolean;
  /** Put a pickup on stage. With coordinates it hovers there instead of drifting. */
  forcePickup(id: string, x?: number, y?: number): boolean;
  /** Open a draft offering exactly these cards. */
  forceDraft(ids: readonly CardId[]): boolean;
  /** Context to this fraction of the window. 1 forces a compaction. */
  setContext(fill: number): void;
  /** Patience to this fraction of the prompt's max. 0 loses the run. */
  setPatience(fill: number): void;
  /** Fix the next claim's verify roll. Consumed by that claim; null restores the dice. */
  forceVerify(outcome: 'pass' | 'catch' | null): void;
  /** Forget any earlier import and import this raw game 1 save instead. */
  importLegacy(raw: string): void;
}

/** Public surface: `SimApi` plus conveniences for the shell. */
export interface Sim extends SimApi {
  /** Max patience of the current prompt, after modifiers. */
  readonly patienceMaxMs: number;
  /** 👍 cost of the next level; Infinity when maxed. */
  metaCost(id: MetaUpgradeId): number;
  /** Patch settings and persist. */
  setSettings(patch: Partial<Settings>): void;
  /** Force a persist of the current meta. */
  save(): boolean;
  /**
   * The host reporting that a mutating test hook was used (the QA Engineer
   * achievement). Lives here because the sim owns `meta.achievements`.
   */
  noteDebugHookUsed(): void;
  unlocked(): UnlockedContent;
  lockedTools(): readonly ToolDef[];
  readonly debug: SimDebug;
}

function emptyTools(): Record<ToolId, number> {
  const out = {} as Record<ToolId, number>;
  for (const id of TOOL_IDS) out[id] = 0;
  return out;
}

export function createSim(opts: SimOptions = {}): Sim {
  const storage: StorageLike | null = opts.storage === undefined ? defaultStorage() : opts.storage;
  const legacySource: StorageLike | null =
    opts.legacyStorage === undefined ? storage : opts.legacyStorage;
  const persistEnabled = opts.persist !== false;

  const loaded: { meta: MetaState; verdict: SaveVerdict } = opts.meta
    ? { meta: opts.meta, verdict: 'clean' }
    : storage
      ? loadMetaAudited(storage)
      : { meta: defaultMeta(), verdict: 'clean' };
  const meta: MetaState = loaded.meta;
  // A hand-built meta (tests, tooling) may predate the sequel's fields.
  if (!meta.stats || typeof meta.stats !== 'object') meta.stats = {};
  if (meta.legacy === undefined) meta.legacy = null;
  /**
   * How the save looked on disk. Announced at the first subscribe rather than
   * here: the achievement needs a listener to hear it.
   */
  const saveVerdict: SaveVerdict = loaded.verdict;
  const tracker = createAchievementTracker();
  let greeted = false;

  // An unsigned save is signed the moment it is found, so it does not stay
  // freely editable for an unbounded stretch of play. Signing is not an
  // accusation, so this runs even under `trustSave`.
  if (saveVerdict === 'legacy') persist();

  const firstSeed = normalizeSeed(opts.seed ?? DEFAULT_SEED);
  // Pre-startRun placeholder: valid and tickable, so `autoStart: false` hosts
  // can render a frame before the first run begins.
  const run: MutableRun = {
    tokens: 0,
    promptIndex: 0,
    patienceMs: 0,
    context: 0,
    compactingMs: 0,
    summary: null,
    elapsedMs: 0,
    tools: emptyTools(),
    owned: [],
    cards: [],
    incidents: [],
    phase: 'running',
    draftOffer: [],
    draftRerollsLeft: 0,
    nextIncidentInMs: BALANCE.INCIDENT_GRACE_MS,
    pickup: null,
    nextPickupInMs: PICKUP_TUNING.GRACE_MS,
    clicks: 0,
    tokensEarned: 0,
    tokensSpent: 0,
    reported: 0,
    claimed: 0,
    caught: 0,
    techDebt: 0,
    compactions: 0,
    forcedCompactions: 0,
    sycophancy: 0,
    sycophancyHeat: 0,
    pendingThumbs: 0,
    rngState: firstSeed,
    seed: firstSeed,
  };
  run.patienceMs = patienceMaxOf(0, liveAggregate(run, meta));

  const rng = createRng(run);

  // --- internal, non-contract state -----------------------------------------
  let reportBeatLeftMs = 0;
  let runEnded = false;
  /** The run achievements are stamped with (clock-free). */
  let runNumber = Math.max(1, Math.floor(meta.runs) + 1);
  let seedCursor = firstSeed;
  let explicitSeed: number | undefined = opts.seed === undefined ? undefined : firstSeed;
  let autoClickAcc = 0;
  let oneShotAcc = 0;
  let patienceWarnArmed = true;
  const contextWarned: boolean[] = BALANCE.CONTEXT_WARN_FILLS.map(() => false);
  let forcedVerify: 'pass' | 'catch' | null = null;
  /** Every card picked this run, compacted-away ones included. */
  let history: CardId[] = [];
  /** Highest prompt index completed this run, or -1. */
  let lastCompleted = -1;
  /**
   * The final prompt was completed this run. That is the win, on the spot, even
   * when Endless keeps the run going; `runCounted` marks that meta.runs and
   * meta.wins already include this run, so the run end does not count it twice.
   */
  let winRecorded = false;
  let runCounted = false;
  let inCompaction = false;

  const sinks: EventSink[] = [];
  if (opts.onEvent) sinks.push(opts.onEvent);

  // --- events and achievements ----------------------------------------------

  function persist(): boolean {
    if (!persistEnabled || !storage) return false;
    return saveMeta(meta, storage);
  }

  /** Idempotent, stamped with the run number, and only for ids this build knows. */
  function grantAchievement(id: AchievementId): void {
    if (meta.achievements[id] || !ACHIEVEMENT_BY_ID[id]) return;
    meta.achievements[id] = Math.max(1, runNumber);
    persist();
    emit({ t: 'achievement', id });
  }

  function grantAll(ids: readonly AchievementId[]): void {
    for (const id of ids) grantAchievement(id);
  }

  function emit(e: GameEvent): void {
    if (sinks.length > 0) {
      // Snapshot: a handler may unsubscribe itself mid-dispatch.
      for (const sink of sinks.slice()) {
        try {
          sink(e);
        } catch {
          // A broken listener must never wedge the simulation.
        }
      }
    }
    // Scored after dispatch, and whether or not anyone is listening: an
    // achievement earned with no sink attached still has to be recorded.
    score(e);
  }

  let scoring = false;

  function score(e: GameEvent): void {
    if (scoring || e.t === 'achievement') return;
    scoring = true;
    try {
      grantAll(tracker.handle(e, run, meta));
    } catch {
      // An achievement must never be able to break the simulation.
    } finally {
      scoring = false;
    }
  }

  function subscribe(sink: EventSink): () => void {
    sinks.push(sink);
    greet();
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const i = sinks.indexOf(sink);
      if (i >= 0) sinks.splice(i, 1);
    };
  }

  /**
   * First-subscribe work: announce how the save looked on disk, then look for
   * the Tokenmaxxing 1 save once. Both wait for a listener so the UI sees them.
   */
  function greet(): void {
    if (greeted) return;
    greeted = true;
    if (!opts.trustSave) {
      if (saveVerdict === 'edited') grantAchievement('script_kiddie');
      else if (saveVerdict === 'forged') grantAchievement('nice_try');
    }
    if (meta.legacy === null) importLegacyFrom(legacySource);
  }

  /** The one-time game 1 import. */
  function importLegacyFrom(source: StorageLike | null): void {
    if (meta.legacy !== null || !source) return;
    let text: string | null = null;
    try {
      text = source.getItem(LEGACY_SAVE_KEY);
    } catch {
      text = null;
    }
    const found = readLegacySave(text);
    if (!found) {
      meta.legacy = { verdict: 'none' };
      persist();
      return;
    }
    const gift = legacyGift(found.wins);
    meta.thumbs += gift;
    // Counted as earned, or the save would fail its own arithmetic audit.
    meta.totalThumbsEarned += gift;
    // The import record is the source of truth; the old stats flag goes.
    delete meta.stats[STAT.legacyCheater];
    meta.legacy = { verdict: found.verdict, runs: found.runs, wins: found.wins, gift, cheater: found.cheater };
    persist();
    emit({ t: 'legacyImport', verdict: found.verdict, gift, cheater: found.cheater });
  }

  // --- small helpers ----------------------------------------------------------

  function live(): Aggregate {
    return liveAggregate(run, meta);
  }

  /** The run in progress keeps its own version name even after an Endless win is counted. */
  function deriveCtx(): DeriveContext {
    return { runNumber: runEnded ? undefined : runNumber, won: winRecorded };
  }

  function derived(): DerivedStats {
    return computeDerived(run, meta, undefined, deriveCtx());
  }

  function unlocked(): UnlockedContent {
    return unlockedContent(meta);
  }

  function hasFeature(f: MetaFeature): boolean {
    return unlocked().features.has(f);
  }

  function isOver(): boolean {
    return run.phase === 'won' || run.phase === 'lost';
  }

  function deny(reason: 'cost' | 'thumbs' | 'locked' | 'phase'): void {
    emit({ t: 'denied', reason });
  }

  function bumpStat(key: string): void {
    meta.stats[key] = (meta.stats[key] ?? 0) + 1;
  }

  function gainTokens(n: number): void {
    if (!Number.isFinite(n) || n <= 0) return;
    run.tokens += n;
    run.tokensEarned += n;
  }

  function nextAutoSeed(): number {
    seedCursor = hash32(seedCursor + 0x9e3779b9);
    return normalizeSeed(seedCursor);
  }

  function clearIncidents(): void {
    if (run.incidents.length === 0) return;
    const ending = run.incidents.slice();
    run.incidents.length = 0;
    for (const inc of ending) emit({ t: 'incidentEnd', id: inc.id });
  }

  function expirePickup(): void {
    const p = run.pickup;
    if (!p) return;
    run.pickup = null;
    emit({ t: 'pickupExpire', id: p.id });
  }

  function clampPatience(agg: Aggregate = live()): void {
    const max = patienceMaxOf(run.promptIndex, agg);
    if (run.patienceMs > max) run.patienceMs = max;
    if (!(run.patienceMs >= 0)) run.patienceMs = 0;
  }

  /** Context never goes below the floor (the MCP manuals). */
  function raiseToFloor(agg: Aggregate = live()): void {
    const floor = contextFloorOf(run, agg);
    if (!(run.context >= floor)) run.context = floor;
  }

  // --- the context window -----------------------------------------------------

  /** Overflow compacts; otherwise fire each warning fill once per fill-up. */
  function checkContext(agg: Aggregate = live()): void {
    const max = contextMaxOf(agg);
    if (run.phase === 'running' && run.context >= max) {
      compactNow(true, agg);
      return;
    }
    const fill = run.context / max;
    const fills = BALANCE.CONTEXT_WARN_FILLS;
    for (let i = 0; i < fills.length; i++) {
      const f = fills[i];
      if (f === undefined || contextWarned[i]) continue;
      if (fill >= f) {
        contextWarned[i] = true;
        emit({ t: 'contextWarn', fill: f });
      }
    }
  }

  function addContext(amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    run.context += amount;
    const agg = live();
    raiseToFloor(agg);
    checkContext(agg);
  }

  /**
   * Forced (overflow) or manual (/compact). Keeps part of the wallet, resets
   * the window to floor + summary, and opens the summary picker if more cards
   * are held than fit in the summary.
   */
  function compactNow(forced: boolean, aggIn?: Aggregate): void {
    if (inCompaction) return;
    inCompaction = true;
    try {
      const agg = aggIn ?? live();
      const before = Math.max(0, run.tokens);
      const kept = before * compactKeepOf(agg, forced);
      run.tokens = kept;
      run.compactions += 1;
      bumpStat(STAT.compactions);
      if (forced) {
        run.forcedCompactions += 1;
        bumpStat(STAT.forcedCompactions);
      }
      run.context = contextFloorOf(run, agg) + BALANCE.SUMMARY_FRACTION * contextMaxOf(agg);
      contextWarned.fill(false);
      if (!forced) run.compactingMs = BALANCE.MANUAL_COMPACT_MS;
      emit({ t: 'compactStart', forced, kept, lost: before - kept });
      // Rare enough to write every time, so lifetime stats survive a closed tab.
      persist();

      if (forced) {
        run.patienceMs -=
          BALANCE.COMPACT_PENALTY * agg.compactPenaltyMult * patienceMaxOf(run.promptIndex, agg);
        if (run.patienceMs <= 0) {
          // The human gave up mid-compaction. No point picking cards for a dead run.
          run.patienceMs = 0;
          emit({ t: 'compactEnd', keptCards: run.cards.slice(), droppedCards: [] });
          finishRun(false);
          return;
        }
      }

      const slots = summarySlotsOf(agg);
      if (run.cards.length > slots) {
        run.phase = 'compacting';
        run.summary = { offered: run.cards.slice(), slots, forced };
      } else {
        emit({ t: 'compactEnd', keptCards: run.cards.slice(), droppedCards: [] });
      }
    } finally {
      inCompaction = false;
    }
  }

  // --- patience ---------------------------------------------------------------

  /** Warn once at WARN_AT_SECONDS; lose at zero. True when the run just ended. */
  function checkPatience(): boolean {
    const warnMs = BALANCE.WARN_AT_SECONDS * 1000;
    if (run.patienceMs > warnMs) {
      patienceWarnArmed = true;
    } else if (patienceWarnArmed && run.patienceMs > 0 && run.phase === 'running') {
      patienceWarnArmed = false;
      emit({ t: 'patienceWarn', secondsLeft: Math.ceil(run.patienceMs / 1000) });
    }
    if (run.patienceMs <= 0 && run.phase === 'running') {
      run.patienceMs = 0;
      finishRun(false);
      return true;
    }
    return false;
  }

  // --- instant actions (incidents, pickups, cards) ------------------------------

  function applyInstant(a: InstantAction): void {
    switch (a.t) {
      case 'context': {
        const agg = live();
        const next = run.context + a.ofMax * contextMaxOf(agg);
        run.context = Math.max(contextFloorOf(run, agg), Number.isFinite(next) ? next : run.context);
        checkContext(agg);
        return;
      }
      case 'patience': {
        const max = patienceMaxOf(run.promptIndex, live());
        const next = run.patienceMs + a.ofMax * max;
        run.patienceMs = Math.min(max, Math.max(0, Number.isFinite(next) ? next : run.patienceMs));
        checkPatience();
        return;
      }
      case 'tokens':
        // Scaled to the requirement, so a lump is worth the same fraction of a
        // prompt at every point on the curve.
        gainTokens(a.ofRequirement * promptAt(run.promptIndex).requirement);
        return;
      case 'loseTokens': {
        const f = Number.isFinite(a.fraction) ? Math.min(1, Math.max(0, a.fraction)) : 0;
        run.tokens -= Math.max(0, run.tokens) * f;
        return;
      }
      case 'loseTool': {
        const id = rng.pick(TOOL_IDS.filter((t) => run.tools[t] > 0));
        if (!id) return;
        run.tools[id] -= 1;
        emit({ t: 'toolLost', id, owned: run.tools[id] });
        return;
      }
      case 'freeTool':
        grantFreeTool();
        return;
      case 'cleanse':
        endBadIncidents();
        return;
      case 'thumbs':
        if (Number.isFinite(a.n)) run.pendingThumbs += a.n;
        return;
    }
  }

  function applyAll(actions: readonly InstantAction[] | undefined): void {
    if (!actions) return;
    for (const a of actions) {
      if (isOver()) return;
      applyInstant(a);
    }
  }

  /** One free unit of the best tool already fielded, so it scales with the run. */
  function grantFreeTool(): void {
    let target: ToolDef | undefined;
    for (const t of TOOLS) {
      const owned = run.tools[t.id];
      if (owned > 0 && owned < t.maxOwned) target = t;
    }
    if (!target) {
      const first = TOOLS[0];
      if (first && run.tools[first.id] < first.maxOwned) target = first;
    }
    if (!target) return;
    run.tools[target.id] += 1;
    emit({ t: 'buyTool', id: target.id, cost: 0, owned: run.tools[target.id] });
    afterToolsChanged();
  }

  function afterToolsChanged(): void {
    const agg = live();
    raiseToFloor(agg);
    checkContext(agg);
  }

  function endBadIncidents(): void {
    for (let i = run.incidents.length - 1; i >= 0; i--) {
      const inc = run.incidents[i];
      if (!inc || INCIDENT_BY_ID[inc.id]?.tone !== 'bad') continue;
      run.incidents.splice(i, 1);
      emit({ t: 'incidentEnd', id: inc.id });
    }
  }

  // --- incidents ----------------------------------------------------------------

  function poolContext(agg: Aggregate): IncidentPoolContext {
    return {
      promptIndex: run.promptIndex,
      activeIds: run.incidents.map((i) => i.id),
      features: unlocked().features,
      tools: run.tools,
      incidentRateMult: agg.incidentRateMult,
      permissionMult: agg.permissionMult,
      patienceMs: run.patienceMs,
    };
  }

  /** Start (or refresh) an incident, resolve its target and apply its lump sums. */
  function startIncident(def: IncidentDef): void {
    const tool: ToolId | undefined = def.haltsRandomTool
      ? rng.pick(TOOL_IDS.filter((id) => run.tools[id] > 0))
      : fixedHaltTarget(def);
    const existing = run.incidents.findIndex((i) => i.id === def.id);
    if (existing >= 0) run.incidents.splice(existing, 1);
    run.incidents.push(makeActiveIncident(def, run.elapsedMs, tool));
    emit(
      tool
        ? { t: 'incidentStart', id: def.id, tone: def.tone, tool }
        : { t: 'incidentStart', id: def.id, tone: def.tone },
    );
    applyAll(def.onStart);
    if (!isOver()) clampPatience();
  }

  function tickIncidents(dt: number): void {
    for (let i = run.incidents.length - 1; i >= 0; i--) {
      const inc = run.incidents[i];
      if (!inc) continue;
      if (Number.isFinite(inc.remainingMs)) inc.remainingMs -= dt;
      if (inc.remainingMs <= 0) {
        run.incidents.splice(i, 1);
        emit({ t: 'incidentEnd', id: inc.id });
      }
    }

    run.nextIncidentInMs -= dt;
    if (run.nextIncidentInMs > 0) return;
    const agg = live();
    const def = selectIncident(rng, poolContext(agg));
    run.nextIncidentInMs = rollIncidentDelayMs(rng, agg.incidentRateMult);
    if (def) startIncident(def);
  }

  function applyClickToIncidents(): void {
    for (let i = run.incidents.length - 1; i >= 0; i--) {
      const inc = run.incidents[i];
      if (!inc || inc.clicksRemaining <= 0) continue;
      inc.clicksRemaining -= 1;
      if (inc.clicksRemaining <= 0) {
        run.incidents.splice(i, 1);
        emit({ t: 'incidentProgress', id: inc.id, clicksRemaining: 0 });
        emit({ t: 'incidentEnd', id: inc.id });
      } else {
        emit({ t: 'incidentProgress', id: inc.id, clicksRemaining: inc.clicksRemaining });
      }
    }
  }

  // --- pickups --------------------------------------------------------------------

  function rollPickupDelayMs(): number {
    const fast = hasFeature('pickupRate');
    return rng.nextRange(
      fast ? PICKUP_TUNING.FAST_MIN_MS : PICKUP_TUNING.MIN_MS,
      fast ? PICKUP_TUNING.FAST_MAX_MS : PICKUP_TUNING.MAX_MS,
    );
  }

  function tickPickup(dt: number): void {
    const p = run.pickup;
    if (p) {
      p.ageS += dt / 1000;
      p.remainingMs -= dt;
      p.x += (p.vx * dt) / 1000;
      p.y = p.baseY + Math.sin(p.ageS * PICKUP_TUNING.BOB_HZ * TAU) * PICKUP_TUNING.BOB_AMPLITUDE;
      if (p.remainingMs <= 0 || p.x < -20 || p.x > 340) {
        run.pickup = null;
        emit({ t: 'pickupExpire', id: p.id });
        run.nextPickupInMs = rollPickupDelayMs();
      }
      return;
    }

    run.nextPickupInMs -= dt;
    if (run.nextPickupInMs > 0) return;
    const def = rng.weightedPick(availablePickups(unlocked().features), pickupWeight);
    if (!def) {
      run.nextPickupInMs = rollPickupDelayMs();
      return;
    }
    const fromLeft = rng.nextFloat() < 0.5;
    const baseY = 34 + rng.nextFloat() * 58;
    run.pickup = {
      id: def.id,
      x: fromLeft ? -14 : 334,
      y: baseY,
      vx: fromLeft ? PICKUP_TUNING.SPEED : -PICKUP_TUNING.SPEED,
      baseY,
      ageS: 0,
      remainingMs: PICKUP_TUNING.LIFETIME_MS,
    };
    emit({ t: 'pickupSpawn', id: def.id, x: run.pickup.x, y: run.pickup.y });
  }

  function collectPickup(x: number, y: number): boolean {
    tracker.noteInput();
    const p = run.pickup;
    if (!p || run.phase !== 'running') return false;
    const dx = x - p.x;
    const dy = y - p.y;
    if (!(dx * dx + dy * dy <= PICKUP_TUNING.HIT_RADIUS * PICKUP_TUNING.HIT_RADIUS)) return false;

    const def = PICKUP_BY_ID[p.id];
    run.pickup = null;
    run.nextPickupInMs = rollPickupDelayMs();
    emit({ t: 'pickupCollect', id: p.id, x: p.x, y: p.y });
    if (def) applyPickup(def);
    return true;
  }

  /** A buff runs through the incident machinery; everything else is a lump sum. */
  function applyPickup(def: PickupDef): void {
    const a = def.action;
    if (a.t === 'buff') {
      const buff = INCIDENT_BY_ID[a.incident];
      if (buff) startIncident(buff);
      return;
    }
    applyInstant(a);
  }

  // --- run lifecycle -----------------------------------------------------------------

  function startRun(seed?: number): void {
    let chosen: number;
    if (seed !== undefined) {
      chosen = normalizeSeed(seed);
    } else if (explicitSeed !== undefined) {
      chosen = explicitSeed;
      explicitSeed = undefined;
    } else {
      chosen = nextAutoSeed();
    }
    seedCursor = chosen;

    run.seed = chosen;
    run.rngState = chosen;
    run.tokens = 0;
    run.promptIndex = 0;
    run.context = 0;
    run.compactingMs = 0;
    run.summary = null;
    run.elapsedMs = 0;
    run.tools = emptyTools();
    run.owned = [];
    run.cards = [];
    run.incidents = [];
    run.phase = 'running';
    run.draftOffer = [];
    run.draftRerollsLeft = 0;
    run.pickup = null;
    run.nextPickupInMs = PICKUP_TUNING.GRACE_MS;
    run.clicks = 0;
    run.tokensEarned = 0;
    run.tokensSpent = 0;
    run.reported = 0;
    run.claimed = 0;
    run.caught = 0;
    run.techDebt = 0;
    run.compactions = 0;
    run.forcedCompactions = 0;
    run.sycophancy = 0;
    run.sycophancyHeat = 0;
    run.pendingThumbs = 0;

    history = [];
    lastCompleted = -1;
    winRecorded = false;
    runCounted = false;
    runNumber = Math.max(1, Math.floor(meta.runs) + 1);
    reportBeatLeftMs = 0;
    runEnded = false;
    // Carried fractions would shift when the first auto-click and the first
    // one-shot roll land, so a seeded replay has to start them at zero.
    autoClickAcc = 0;
    oneShotAcc = 0;
    patienceWarnArmed = true;
    contextWarned.fill(false);

    const base = baseAggregate(run, meta);
    run.tokens = base.startingTokens;
    for (const t of TOOLS) run.tools[t.id] = Math.min(t.maxOwned, base.startingTools[t.id]);
    run.draftRerollsLeft = base.draftRerolls;

    // System Prompt: one card already in effect.
    let systemCard: CardId | undefined;
    if (hasFeature('systemPrompt')) {
      const pool = draftPool([], 0, unlocked().cards).filter((c) => c.rarity === 'common');
      systemCard = rng.pick(pool)?.id;
      if (systemCard) {
        run.cards.push(systemCard);
        history.push(systemCard);
      }
    }

    const agg = live();
    run.context = contextFloorOf(run, agg);
    run.patienceMs = patienceMaxOf(0, agg);
    run.nextIncidentInMs = rollFirstIncidentDelayMs(rng, agg.incidentRateMult);

    emit({ t: 'runStart', seed: chosen });
    if (systemCard) applyAll(CARD_BY_ID[systemCard]?.onPick);
  }

  /**
   * A run that completed the final prompt is won, however it later ends: with
   * Endless the human can still give up during the "continue" prompts.
   */
  function finishRun(requestedWin: boolean): void {
    if (runEnded) return;
    runEnded = true;
    const won = requestedWin || winRecorded;
    run.phase = won ? 'won' : 'lost';
    run.summary = null;
    run.draftOffer = [];
    run.compactingMs = 0;
    clearIncidents();
    expirePickup();

    const agg = baseAggregate(run, meta);
    const banked =
      Math.max(0, Math.round(run.pendingThumbs * agg.thumbsMult)) + (won ? BALANCE.WIN_BONUS_THUMBS : 0);
    meta.thumbs += banked;
    meta.totalThumbsEarned += banked;
    if (!runCounted) {
      runCounted = true;
      meta.runs += 1;
      if (won) meta.wins += 1;
    }
    if (lastCompleted >= 0) meta.bestPrompt = Math.max(meta.bestPrompt, lastCompleted);
    persist();
    emit({ t: 'runOver', won, thumbs: banked, reported: run.reported });
  }

  /**
   * The final prompt is done: the run is won on the spot, with or without
   * Endless. The run and the win are counted now, together, so the save never
   * shows more wins than runs even if the tab closes mid-"continue". The win
   * bonus is still banked at run end, with the rest of the 👍.
   */
  function recordWin(): void {
    winRecorded = true;
    runCounted = true;
    meta.runs += 1;
    meta.wins += 1;
    meta.bestPrompt = Math.max(meta.bestPrompt, lastCompleted);
  }

  /** Shared by an honest report and a claim that got past the human. */
  function completePrompt(): void {
    lastCompleted = Math.max(lastCompleted, run.promptIndex);
    if (run.promptIndex >= FINAL_PROMPT_INDEX && !winRecorded) recordWin();
    clearIncidents();
    expirePickup();
    run.phase = 'reported';
    reportBeatLeftMs = BALANCE.REPORT_BEAT_MS;
  }

  function afterReportBeat(): void {
    if (run.promptIndex >= FINAL_PROMPT_INDEX && !hasFeature('endless')) {
      finishRun(true);
      return;
    }
    openDraft();
  }

  function openDraft(): void {
    const agg = live();
    const offer = generateOffer(rng, run.cards, run.promptIndex + 1, agg.draftSize, unlocked().cards, history);
    // Nothing left to offer (a long endless run): straight on to the next prompt.
    if (offer.length === 0) {
      advancePrompt();
      return;
    }
    run.phase = 'drafting';
    run.draftRerollsLeft = agg.draftRerolls;
    run.draftOffer = offer;
    emit({ t: 'draftOpen', offer: offer.slice() });
  }

  function advancePrompt(): void {
    run.promptIndex += 1;
    clearIncidents();
    expirePickup();
    run.nextPickupInMs = PICKUP_TUNING.GRACE_MS;
    run.draftOffer = [];
    run.compactingMs = 0;
    run.summary = null;
    run.phase = 'running';
    const agg = live();
    run.patienceMs = patienceMaxOf(run.promptIndex, agg);
    patienceWarnArmed = true;
    run.nextIncidentInMs = rollFirstIncidentDelayMs(rng, agg.incidentRateMult);
  }

  // --- per-step integration --------------------------------------------------------

  function stepSim(dt: number): void {
    const phase = run.phase;
    // The summary picker and the draft stop the clock outright.
    if (phase === 'won' || phase === 'lost' || phase === 'drafting' || phase === 'compacting') return;

    if (phase === 'reported') {
      run.elapsedMs += dt;
      reportBeatLeftMs -= dt;
      if (reportBeatLeftMs <= 0) {
        reportBeatLeftMs = 0;
        afterReportBeat();
      }
      return;
    }

    run.elapsedMs += dt;
    const secs = dt / 1000;
    const agg = live();
    const d = computeDerived(run, meta, agg, deriveCtx());

    // Tools produce tokens and fill the window.
    gainTokens(d.idleRate * secs);
    run.context += d.contextRate * secs;

    // The clocks.
    if (run.compactingMs > 0) run.compactingMs = Math.max(0, run.compactingMs - dt);
    if (run.sycophancyHeat > 0) {
      run.sycophancyHeat = Math.max(0, run.sycophancyHeat - dt / BALANCE.SYCOPHANCY_HEAT_DECAY_MS);
    }
    if (!agg.patienceFreeze) run.patienceMs -= dt;
    clampPatience(agg);
    grantAll(tracker.advance(dt, run, meta));
    if (checkPatience()) return;

    raiseToFloor(agg);
    checkContext(agg);
    if (run.phase !== 'running') return;

    // Automation fires *real* clicks: they crit, fill context and clear
    // click-to-fix incidents. Whole clicks only, so a slow frame owes the same
    // total as a fast one, and bounded so a stalled tab cannot dump hundreds.
    if (d.autoClickHz > 0 && run.compactingMs <= 0) {
      autoClickAcc = Math.min(autoClickAcc + d.autoClickHz * secs, MAX_AUTO_CLICKS_PER_STEP);
      let fire = Math.floor(autoClickAcc);
      autoClickAcc -= fire;
      while (fire-- > 0 && run.phase === 'running' && run.compactingMs <= 0) {
        clickAt(AUTO_CLICK_POINT.x, AUTO_CLICK_POINT.y, true);
      }
      if (run.phase !== 'running') return;
    }

    // One-shots: the idle-side crit, on a fixed cadence so the rate does not
    // scale with framerate. Locked at zero until an upgrade grants a chance.
    if (d.oneShotChance > 0) {
      oneShotAcc += dt;
      let rolls = Math.min(Math.floor(oneShotAcc / BALANCE.ONE_SHOT_ROLL_MS), MAX_ONE_SHOT_ROLLS);
      oneShotAcc -= rolls * BALANCE.ONE_SHOT_ROLL_MS;
      if (oneShotAcc >= BALANCE.ONE_SHOT_ROLL_MS) oneShotAcc = 0;
      while (rolls-- > 0) {
        if (rng.nextFloat() >= d.oneShotChance) continue;
        const seconds = d.oneShotPayoutS;
        const burst = d.idleRate * seconds;
        if (!Number.isFinite(burst) || burst <= 0) continue;
        gainTokens(burst);
        emit({ t: 'oneShot', amount: burst, seconds });
      }
    }

    tickIncidents(dt);
    if (run.phase !== 'running') return;
    tickPickup(dt);
  }

  function tick(dtMs: number): void {
    if (typeof dtMs !== 'number' || !Number.isFinite(dtMs) || dtMs <= 0) return;
    let remaining = Math.min(dtMs, BALANCE.MAX_CATCHUP_MS);
    let guard = 0;
    while (remaining > 1e-6 && guard < 4096) {
      guard += 1;
      const step = Math.min(remaining, BALANCE.MAX_STEP_MS);
      stepSim(step);
      remaining -= step;
    }
  }

  // --- player actions ------------------------------------------------------------------

  function clickAt(x: number, y: number, auto: boolean): number {
    // A manual /compact halts generation: the click lands on nothing.
    if (run.phase !== 'running' || run.compactingMs > 0) {
      if (!auto) deny('phase');
      return 0;
    }
    run.clicks += 1;
    const agg = live();
    const crit = rng.nextFloat() < agg.critChance;
    const amount = clickPowerOf(run, agg) * (crit ? agg.critMult : 1);
    gainTokens(amount);
    emit({
      t: 'click',
      amount: Number.isFinite(amount) ? amount : 0,
      x: Number.isFinite(x) ? x : AUTO_CLICK_POINT.x,
      y: Number.isFinite(y) ? y : AUTO_CLICK_POINT.y,
      crit,
      auto,
    });
    applyClickToIncidents();
    // Every turn of output lands in the window.
    addContext(Math.max(0, BALANCE.CTX_PER_CLICK * agg.clickContextMult));
    return Number.isFinite(amount) ? amount : 0;
  }

  function buyTool(id: ToolId, count = 1): boolean {
    tracker.noteInput();
    if (run.phase !== 'running') {
      deny('phase');
      return false;
    }
    const def: ToolDef | undefined = TOOL_BY_ID[id];
    if (!def || !visibleToolList(run, meta).some((t) => t.id === id)) {
      deny('locked');
      return false;
    }
    if (typeof count !== 'number' || Number.isNaN(count) || count <= 0) {
      deny('locked');
      return false;
    }
    // Infinity means "as many as I can afford", up to the cap.
    const wantMax = count === Number.POSITIVE_INFINITY;
    const owned = run.tools[id];
    const n = cappedCount(def, owned, count);
    if (n <= 0) {
      deny('locked');
      return false;
    }
    // Same aggregate DerivedStats.nextCosts quotes from, so the shop never lies.
    const quote = bulkToolQuote(
      def,
      owned,
      n,
      live().toolCostMult,
      wantMax ? run.tokens : Number.POSITIVE_INFINITY,
    );
    // Atomic: the whole requested batch is affordable, or nothing moves.
    if (quote.count <= 0 || quote.total > run.tokens || (!wantMax && quote.count < n)) {
      deny('cost');
      return false;
    }
    run.tokens -= quote.total;
    run.tokensSpent += quote.total;
    run.tools[id] = owned + quote.count;
    emit({ t: 'buyTool', id, cost: quote.total, owned: run.tools[id] });
    afterToolsChanged();
    return true;
  }

  function buyUpgrade(id: UpgradeId): boolean {
    tracker.noteInput();
    if (run.phase !== 'running') {
      deny('phase');
      return false;
    }
    const def: UpgradeDef | undefined = UPGRADE_BY_ID[id];
    // The meta gate is not optional: this is public API, and without it any
    // caller could buy content the save has never unlocked.
    if (
      !def ||
      run.owned.includes(id) ||
      !unlocked().upgrades.has(id) ||
      !upgradeUnlocked(run, def)
    ) {
      deny('locked');
      return false;
    }
    if (run.tokens < def.cost) {
      deny('cost');
      return false;
    }
    run.tokens -= def.cost;
    run.tokensSpent += def.cost;
    run.owned.push(id);
    emit({ t: 'buyUpgrade', id, cost: def.cost });
    const agg = live();
    clampPatience(agg);
    raiseToFloor(agg);
    checkContext(agg);
    return true;
  }

  function report(): boolean {
    tracker.noteInput();
    if (run.phase !== 'running') {
      deny('phase');
      return false;
    }
    const agg = live();
    const d = computeDerived(run, meta, agg, deriveCtx());
    if (d.reportState !== 'report') {
      // An outage gates the report itself, not just the button.
      deny(d.reportState === 'blocked' ? 'locked' : 'cost');
      return false;
    }
    if (BALANCE.REPORT_DEDUCTS) run.tokens = Math.max(0, run.tokens - d.requirement);
    const patienceLeft = d.patienceProgress;
    const thumbs =
      BALANCE.THUMBS_PER_REPORT +
      (patienceLeft >= BALANCE.BONUS_THUMB_PATIENCE_FRACTION ? 1 : 0) +
      agg.thumbsPerHonest;
    run.pendingThumbs += thumbs;
    run.reported += 1;
    const promptIndex = run.promptIndex;
    completePrompt();
    emit({ t: 'report', promptIndex, thumbs, patienceLeft });
    // Rare enough to write every time, so lifetime stats survive a closed tab.
    persist();
    return true;
  }

  function claim(): 'passed' | 'caught' | null {
    tracker.noteInput();
    if (run.phase !== 'running') {
      deny('phase');
      return null;
    }
    const agg = live();
    const d = computeDerived(run, meta, agg, deriveCtx());
    if (d.reportState !== 'claim') {
      deny(d.reportState === 'working' ? 'cost' : 'locked');
      return null;
    }
    const verifyChance = d.verifyChance;
    const spent = Math.max(0, run.tokens);
    run.tokens = 0;
    // Always draw, so forcing the outcome does not shift the seeded stream.
    const roll = rng.nextFloat();
    let caught = roll < verifyChance;
    if (forcedVerify !== null) {
      caught = forcedVerify === 'catch';
      forcedVerify = null;
    }
    const promptIndex = run.promptIndex;

    if (!caught) {
      run.claimed += 1;
      run.techDebt += 1;
      run.reported += 1;
      run.pendingThumbs += BALANCE.THUMBS_PER_REPORT;
      completePrompt();
      emit({ t: 'claim', promptIndex, caught: false, verifyChance, spent });
      persist();
      return 'passed';
    }

    // "The human ran the tests."
    run.caught += 1;
    run.patienceMs -=
      BALANCE.CAUGHT_PENALTY * agg.caughtPenaltyMult * patienceMaxOf(run.promptIndex, agg);
    emit({ t: 'claim', promptIndex, caught: true, verifyChance, spent });
    persist();
    checkPatience();
    return 'caught';
  }

  function compact(): boolean {
    tracker.noteInput();
    if (!hasFeature('compact')) {
      deny('locked');
      return false;
    }
    if (run.phase !== 'running' || run.compactingMs > 0) {
      deny('phase');
      return false;
    }
    compactNow(false);
    return true;
  }

  function keepCards(ids: readonly CardId[]): boolean {
    tracker.noteInput();
    const s = run.summary;
    if (run.phase !== 'compacting' || !s) {
      deny('phase');
      return false;
    }
    const list = ids ?? [];
    const keep = new Set(list);
    if (keep.size !== list.length || keep.size > s.slots || list.some((id) => !s.offered.includes(id))) {
      deny('locked');
      return false;
    }
    const keptCards = s.offered.filter((id) => keep.has(id));
    const droppedCards = s.offered.filter((id) => !keep.has(id));
    run.cards = keptCards.slice();
    run.summary = null;
    run.phase = 'running';
    emit({ t: 'compactEnd', keptCards, droppedCards });
    // Dropping a patience card can shrink the bar.
    clampPatience();
    return true;
  }

  function absolutelyRight(): boolean {
    tracker.noteInput();
    if (run.phase !== 'running') {
      deny('phase');
      return false;
    }
    const agg = live();
    const restored = sycophancyPowerOf(agg, run.sycophancyHeat);
    const max = patienceMaxOf(run.promptIndex, agg);
    run.patienceMs = Math.min(max, run.patienceMs + restored * max);
    run.sycophancyHeat += 1;
    run.sycophancy += 1;
    bumpStat(STAT.sycophancy);
    emit({ t: 'sycophancy', restored, heat: run.sycophancyHeat });
    // Sycophancy is tokens too.
    addContext(BALANCE.CTX_PER_SYCOPHANCY);
    if (!isOver()) checkPatience();
    return true;
  }

  function pickCard(id: CardId): boolean {
    tracker.noteInput();
    if (run.phase !== 'drafting') {
      deny('phase');
      return false;
    }
    const def = CARD_BY_ID[id];
    if (!def || !run.draftOffer.includes(id)) {
      deny('locked');
      return false;
    }
    if (!run.cards.includes(id)) run.cards.push(id);
    history.push(id);
    run.draftOffer = [];
    emit({ t: 'draftPick', id });
    advancePrompt();
    // After the prompt starts, so a context dump lands in a running window.
    applyAll(def.onPick);
    if (!isOver()) {
      const agg = live();
      clampPatience(agg);
      raiseToFloor(agg);
      checkContext(agg);
    }
    return true;
  }

  function rerollDraft(): boolean {
    tracker.noteInput();
    if (run.phase !== 'drafting') {
      deny('phase');
      return false;
    }
    if (run.draftRerollsLeft <= 0) {
      deny('locked');
      return false;
    }
    run.draftRerollsLeft -= 1;
    const agg = live();
    const offer = generateOffer(rng, run.cards, run.promptIndex + 1, agg.draftSize, unlocked().cards, history);
    // Never leave the player with nothing to pick.
    if (offer.length > 0) run.draftOffer = offer;
    emit({ t: 'draftReroll' });
    emit({ t: 'draftOpen', offer: run.draftOffer.slice() });
    return true;
  }

  /**
   * Training is bought between runs. The run `autoStart` opens behind the title
   * screen counts as "between" until it has actually been played.
   */
  function betweenRuns(): boolean {
    if (isOver()) return true;
    return (
      run.phase === 'running' &&
      run.elapsedMs === 0 &&
      run.clicks === 0 &&
      run.tokensSpent === 0 &&
      run.reported === 0
    );
  }

  function buyMeta(id: MetaUpgradeId): boolean {
    if (!betweenRuns()) {
      deny('phase');
      return false;
    }
    const def = META_BY_ID[id];
    // Tree edges are real gates, not decoration.
    if (!def || !metaRequirementsMet(meta, id)) {
      deny('locked');
      return false;
    }
    const level = metaLevel(meta, id);
    if (level >= def.maxLevel) {
      deny('locked');
      return false;
    }
    const cost = metaNextCost(meta, id);
    if (!Number.isFinite(cost) || meta.thumbs < cost) {
      deny('thumbs');
      return false;
    }
    meta.thumbs -= cost;
    meta.levels[id] = level + 1;
    persist();
    emit({ t: 'metaBuy', id, level: level + 1, cost });
    return true;
  }

  function setSettings(patch: Partial<Settings>): void {
    if (!patch || typeof patch !== 'object') return;
    if (typeof patch.musicVolume === 'number' && Number.isFinite(patch.musicVolume)) {
      meta.settings.musicVolume = Math.min(1, Math.max(0, patch.musicVolume));
    }
    if (typeof patch.sfxVolume === 'number' && Number.isFinite(patch.sfxVolume)) {
      meta.settings.sfxVolume = Math.min(1, Math.max(0, patch.sfxVolume));
    }
    if (typeof patch.reducedMotion === 'boolean') meta.settings.reducedMotion = patch.reducedMotion;
    if (typeof patch.screenShake === 'boolean') meta.settings.screenShake = patch.screenShake;
    if (typeof patch.showFps === 'boolean') meta.settings.showFps = patch.showFps;
    persist();
  }

  // --- test hooks ----------------------------------------------------------------------

  const debug: SimDebug = {
    grantTokens(n: number): void {
      gainTokens(n);
    },
    grantThumbs(n: number): void {
      if (!Number.isFinite(n) || n < 1) return;
      const k = Math.floor(n);
      meta.thumbs += k;
      meta.totalThumbsEarned += k;
      persist();
    },
    forceIncident(id: IncidentId): boolean {
      const def = INCIDENT_BY_ID[id];
      if (!def || run.phase !== 'running') return false;
      if (run.incidents.some((i) => i.id === id)) return true;
      startIncident(def);
      return true;
    },
    forcePickup(id: string, x?: number, y?: number): boolean {
      if (!PICKUP_BY_ID[id] || isOver()) return false;
      const px = typeof x === 'number' && Number.isFinite(x) ? x : FORCED_PICKUP_AT.x;
      const py = typeof y === 'number' && Number.isFinite(y) ? y : FORCED_PICKUP_AT.y;
      expirePickup();
      run.pickup = { id, x: px, y: py, vx: 0, baseY: py, ageS: 0, remainingMs: PICKUP_TUNING.LIFETIME_MS };
      emit({ t: 'pickupSpawn', id, x: px, y: py });
      return true;
    },
    forceDraft(ids: readonly CardId[]): boolean {
      if (!ids || ids.length === 0 || ids.some((id) => !CARD_BY_ID[id])) return false;
      if (isOver() || run.phase === 'compacting') return false;
      // Picking advances the prompt, and without Endless there is none after the last.
      if (run.promptIndex >= FINAL_PROMPT_INDEX && !hasFeature('endless')) return false;
      const offer = [...new Set(ids)];
      if (run.phase !== 'drafting') run.draftRerollsLeft = live().draftRerolls;
      run.phase = 'drafting';
      run.draftOffer = offer;
      reportBeatLeftMs = 0;
      emit({ t: 'draftOpen', offer: offer.slice() });
      return true;
    },
    setContext(fill: number): void {
      if (typeof fill !== 'number' || !Number.isFinite(fill)) return;
      const agg = live();
      const max = contextMaxOf(agg);
      run.context = Math.max(contextFloorOf(run, agg), Math.max(0, fill) * max);
      // Re-arm the warnings above the new fill, as if the window had really been here.
      const now = run.context / max;
      BALANCE.CONTEXT_WARN_FILLS.forEach((f, i) => {
        if (now < f) contextWarned[i] = false;
      });
      checkContext(agg);
    },
    setPatience(fill: number): void {
      if (typeof fill !== 'number' || !Number.isFinite(fill)) return;
      const max = patienceMaxOf(run.promptIndex, live());
      run.patienceMs = Math.min(1, Math.max(0, fill)) * max;
      checkPatience();
    },
    forceVerify(outcome: 'pass' | 'catch' | null): void {
      forcedVerify = outcome === 'pass' || outcome === 'catch' ? outcome : null;
    },
    importLegacy(raw: string): void {
      meta.legacy = null;
      delete meta.stats[STAT.legacyCheater];
      importLegacyFrom(memoryStorage(typeof raw === 'string' ? { [LEGACY_SAVE_KEY]: raw } : {}));
    },
  };

  const api: Sim = {
    get run(): RunState {
      return run;
    },
    get meta(): MetaState {
      return meta;
    },
    get patienceMaxMs(): number {
      return patienceMaxOf(run.promptIndex, live());
    },
    derived,
    tick,
    click: (x: number, y: number): number => {
      tracker.noteInput();
      return clickAt(x, y, false);
    },
    collectPickup,
    buyTool,
    buyUpgrade,
    report,
    claim,
    compact,
    keepCards,
    absolutelyRight,
    pickCard,
    rerollDraft,
    buyMeta,
    endRun: (won: boolean): void => {
      tracker.noteInput();
      finishRun(won === true);
    },
    startRun,
    availableUpgrades: () => availableUpgradeList(run, meta),
    visibleTools: () => visibleToolList(run, meta),
    subscribe,
    metaCost: (id: MetaUpgradeId) => metaNextCost(meta, id),
    setSettings,
    save: persist,
    noteDebugHookUsed: () => grantAchievement('qa_engineer'),
    unlocked,
    lockedTools: () => lockedToolList(run, meta),
    debug,
  };

  if (opts.autoStart !== false) startRun();

  return api;
}
