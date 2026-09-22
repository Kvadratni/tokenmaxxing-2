/**
 * The simulation. Deterministic, DOM-free, no wall clock.
 *
 * Every source of randomness runs through the seeded RNG whose cursor lives in
 * `RunState.rngState`; every source of time arrives via `tick(dtMs)`. Replaying
 * the same seed with the same input sequence reproduces state exactly.
 */
import type {
  AgentTierDef,
  AgentTierId,
  CardId,
  DerivedStats,
  EventSink,
  GameEvent,
  AchievementId,
  MetaState,
  MetaUpgradeId,
  RunState,
  SaveVerdict,
  Settings,
  SimApi,
  UpgradeDef,
  UpgradeId,
} from './types.ts';
import type { PickupDef } from './content.ts';
import {
  AGENT_BY_ID,
  AGENT_TIERS,
  AGENT_TIER_IDS,
  BALANCE,
  CARD_BY_ID,
  FINAL_PROJECT_INDEX,
  INCIDENT_BY_ID,
  PICKUP_BY_ID,
  pickupWeight,
  PICKUP_TUNING,
  currentScene,
  pickupsForScene,
  META_BY_ID,
  UPGRADE_BY_ID,
  projectAt,
} from './content.ts';
import { endlessUnlocked, metaRequirementsMet, unlockedContent } from './effects.ts';
import type { Aggregate } from './effects.ts';
import {
  agentCostAt,
  cappedCount,
  availableUpgradeList,
  baseAggregate,
  bulkAgentCost,
  computeDerived,
  deadlineForProject,
  liveAggregate,
  upgradeUnlocked,
  visibleTierList,
} from './derive.ts';
import { generateOffer } from './draft.ts';
import {
  makeActiveIncident,
  rollFirstIncidentDelayMs,
  rollIncidentDelayMs,
  selectIncident,
} from './incidents.ts';
import type { Rng } from './rng.ts';
import { createRng, hash32, normalizeSeed } from './rng.ts';
import type { StorageLike } from './save.ts';
import {
  defaultMeta,
  defaultStorage,
  loadMetaAudited,
  metaNextCost,
  saveMeta,
} from './save.ts';
import { createAchievementTracker } from './achievements.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableRun = Mutable<RunState>;

/** Fallback seed when the host does not supply one — keeps the sim pure. */
/** Scene-space point automation "clicks". Matches the laptop hit box centre. */
const LAPTOP_CENTER = { x: 160, y: 118 } as const;
/** Ceiling on automated clicks resolved in a single sim step. */
const MAX_AUTO_CLICKS_PER_STEP = 24;
/** Same guard for one-shot rolls: a throttled tab must not dump a jackpot. */
const MAX_ONE_SHOT_ROLLS = 8;
const TAU = Math.PI * 2;

export const DEFAULT_SEED = 0x5eed_1337;

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
   * Skip the save-tampering check entirely.
   *
   * The QA harness injects raw saves into storage by design, so every e2e run
   * and every screenshot script would otherwise earn Script Kiddie. Hosts set
   * this whenever the test hooks are live.
   */
  trustSave?: boolean;
}

/** Public surface: `SimApi` plus a few conveniences for the shell. */
export interface Sim extends SimApi {
  /** Deadline length of the current project, after deadlineMult. */
  readonly deadlineMs: number;
  /** Demo cost of the next level of a meta upgrade; Infinity when maxed. */
  metaCost(id: MetaUpgradeId): number;
  /** Patch settings and persist. */
  setSettings(patch: Partial<Settings>): void;
  /** Force a persist of the current meta. */
  save(): boolean;
  /**
   * The host reporting that a player-visible debug hook was invoked.
   *
   * `window.__TOKENMAXXING__` is reachable in production behind `?testhooks=1`,
   * because the verification scripts drive the *deployed* build through it. A
   * player found that, read the API out of the README, and wrote an autoclicker
   * on top of it — so using it is now an achievement rather than a hole. Only
   * the mutating hooks count; reading a snapshot is not playing.
   *
   * Lives here rather than in the host because the sim is the sole owner of
   * `meta.achievements`.
   */
  noteDebugHookUsed(): void;
}

function emptyAgents(): Record<AgentTierId, number> {
  const out = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) out[id] = 0;
  return out;
}

export function createSim(opts: SimOptions = {}): Sim {
  const storage: StorageLike | null =
    opts.storage === undefined ? defaultStorage() : opts.storage;
  const persistEnabled = opts.persist !== false;

  const loaded = opts.meta
    ? { meta: opts.meta, verdict: 'clean' as SaveVerdict }
    : storage
      ? loadMetaAudited(storage)
      : { meta: defaultMeta(), verdict: 'clean' as SaveVerdict };
  const meta: MetaState = loaded.meta;
  /**
   * How the save looked on disk. Held rather than acted on immediately: the
   * achievement can only be granted once a sink exists to hear the event, which
   * is after construction.
   */
  const saveVerdict: SaveVerdict = loaded.verdict;
  const achievements = createAchievementTracker();
  let cheatChecked = false;

  // An unsigned save is signed the moment it is found, not whenever the next
  // write happens to come along. Otherwise a legacy save stays unsigned — and
  // therefore freely editable without detection — for an unbounded stretch of
  // play. Signing is not an accusation, so this runs even under `trustSave`.
  if (saveVerdict === 'legacy') persist();

  // Pre-startRun placeholder: valid and tickable so `autoStart: false` hosts
  // can render a frame before the first run begins.
  const run: MutableRun = {
    slop: 0,
    projectIndex: 0,
    timeLeftMs: deadlineForProject(0, 1),
    elapsedMs: 0,
    agents: emptyAgents(),
    owned: [],
    cards: [],
    incidents: [],
    phase: 'running',
    draftOffer: [],
    draftRerollsLeft: 0,
    pickup: null,
    nextPickupInMs: PICKUP_TUNING.GRACE_MS,
    nextIncidentInMs: BALANCE.INCIDENT_GRACE_MS,
    clicks: 0,
    slopEarned: 0,
    slopSpent: 0,
    shipped: 0,
    pendingDemos: 0,
    rngState: normalizeSeed(opts.seed ?? DEFAULT_SEED),
    seed: normalizeSeed(opts.seed ?? DEFAULT_SEED),
  };

  const rng: Rng = createRng(run);

  // --- internal, non-contract state -----------------------------------------
  let currentDeadlineMs = deadlineForProject(0, 1);
  let shipBeatLeftMs = 0;
  let lastWarnSecond = Number.POSITIVE_INFINITY;
  let runEnded = false;
  let seedCursor = normalizeSeed(opts.seed ?? DEFAULT_SEED);
  let explicitSeed: number | undefined =
    opts.seed === undefined ? undefined : normalizeSeed(opts.seed);

  const sinks: EventSink[] = [];
  if (opts.onEvent) sinks.push(opts.onEvent);

  // --- events ---------------------------------------------------------------

  /**
   * Commit an achievement. Idempotent, and stamped with the run number rather
   * than a timestamp so the sim stays clock-free and deterministic.
   */
  function grantAchievement(id: AchievementId): void {
    if (meta.achievements[id]) return;
    meta.achievements[id] = Math.max(1, Math.floor(meta.runs) + 1);
    persist();
    emit({ t: 'achievement', id });
  }

  /**
   * Award the save-editing achievements, once, on the first event after the
   * sinks are attached.
   *
   * Inert under the test hooks: the e2e suite and the screenshot scripts all
   * write raw saves into storage, and every one of them would otherwise earn
   * Script Kiddie and make the achievement assertions meaningless.
   */
  function checkSaveVerdict(): void {
    if (cheatChecked) return;
    cheatChecked = true;
    if (opts.trustSave) return;
    if (saveVerdict === 'edited') grantAchievement('script_kiddie');
    else if (saveVerdict === 'forged') grantAchievement('nice_try');
  }

  function emit(e: GameEvent): void {
    if (sinks.length > 0) {
      // Snapshot: a handler may unsubscribe itself mid-dispatch.
      const snapshot = sinks.slice();
      for (const sink of snapshot) {
        try {
          sink(e);
        } catch {
          // A broken listener must never wedge the simulation.
        }
      }
    }
    // Scored after dispatch, and regardless of whether anyone is listening:
    // an achievement earned with no sink attached still has to be recorded.
    score(e);
  }

  let scoring = false;

  /** Score an event for achievements after its sinks have seen it. */
  function score(e: GameEvent): void {
    if (scoring || e.t === 'achievement') return;
    scoring = true;
    try {
      for (const id of achievements.handle(e, run, meta, derived())) grantAchievement(id);
    } catch {
      // An achievement must never be able to break the simulation.
    } finally {
      scoring = false;
    }
  }

  function subscribe(sink: EventSink): () => void {
    sinks.push(sink);
    // The save verdict is decided at construction but announced here, once
    // somebody is listening for the toast.
    checkSaveVerdict();
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const i = sinks.indexOf(sink);
      if (i >= 0) sinks.splice(i, 1);
    };
  }

  function persist(): boolean {
    if (!persistEnabled || !storage) return false;
    return saveMeta(meta, storage);
  }

  // --- helpers --------------------------------------------------------------

  function base(): Aggregate {
    return baseAggregate(run, meta);
  }

  function derived(): DerivedStats {
    return computeDerived(run, meta, { deadlineMs: currentDeadlineMs });
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

  // --- run lifecycle --------------------------------------------------------

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
    run.projectIndex = 0;
    run.elapsedMs = 0;
    run.agents = emptyAgents();
    run.owned = [];
    run.cards = [];
    run.incidents = [];
    run.draftOffer = [];
    run.clicks = 0;
    run.slopEarned = 0;
    run.slopSpent = 0;
    run.shipped = 0;
    run.pendingDemos = 0;
    run.pickup = null;
    run.nextPickupInMs = PICKUP_TUNING.GRACE_MS;
    run.phase = 'running';

    const agg = base();
    run.slop = agg.startingSlop;
    for (const id of AGENT_TIER_IDS) run.agents[id] = agg.startingAgents[id];
    run.draftRerollsLeft = agg.draftRerolls;

    currentDeadlineMs = deadlineForProject(0, agg.deadlineMult);
    run.timeLeftMs = currentDeadlineMs;
    run.nextIncidentInMs = rollFirstIncidentDelayMs(rng, agg.incidentRateMult);

    shipBeatLeftMs = 0;
    lastWarnSecond = Number.POSITIVE_INFINITY;
    runEnded = false;
    // Carried fractions would shift when the first auto-click and the first
    // one-shot roll land, so a seeded replay has to start them at zero.
    autoClickAcc = 0;
    oneShotAcc = 0;

    emit({ t: 'runStart', seed: chosen });
  }

  function finishRun(won: boolean): void {
    if (runEnded) return;
    runEnded = true;
    run.phase = won ? 'won' : 'lost';
    clearIncidents();

    const banked = Math.max(0, Math.floor(run.pendingDemos));
    meta.demos += banked;
    meta.totalDemosEarned += banked;
    meta.runs += 1;
    if (won) meta.wins += 1;
    if (run.shipped > 0) {
      meta.bestProject = Math.max(meta.bestProject, run.shipped - 1);
    }
    persist();
    emit({ t: 'runOver', won, demos: banked, shipped: run.shipped });
  }

  function advanceProject(): void {
    run.projectIndex += 1;
    const agg = base();
    currentDeadlineMs = deadlineForProject(run.projectIndex, agg.deadlineMult);
    run.timeLeftMs = currentDeadlineMs;
    run.incidents.length = 0;
    run.nextIncidentInMs = rollFirstIncidentDelayMs(rng, agg.incidentRateMult);
    run.draftOffer = [];
    lastWarnSecond = Number.POSITIVE_INFINITY;
    run.phase = 'running';
  }

  function openDraft(): void {
    const agg = base();
    run.phase = 'drafting';
    run.draftRerollsLeft = agg.draftRerolls;
    run.draftOffer = generateOffer(
      rng,
      run.cards,
      run.projectIndex + 1,
      agg.draftSize,
      unlockedContent(meta).cards,
    );
    emit({ t: 'draftOpen', offer: run.draftOffer.slice() });
  }

  function afterShipBeat(): void {
    if (run.projectIndex >= FINAL_PROJECT_INDEX && !endlessUnlocked(meta)) {
      finishRun(true);
      return;
    }
    openDraft();
  }

  // --- per-step integration -------------------------------------------------

  function rollPickupDelayMs(): number {
    const span = PICKUP_TUNING.MAX_MS - PICKUP_TUNING.MIN_MS;
    const base = PICKUP_TUNING.MIN_MS + rng.nextFloat() * span;
    // Snack Drawer shortens the gap rather than stacking more on screen.
    return unlockedContent(meta).features.has('pickupRate') ? base * 0.6 : base;
  }

  /**
   * Collectibles drift across the room on a timer. Which ones can appear is a
   * function of the location the player bought, so upgrading the room changes
   * what turns up.
   */
  function tickPickup(dt: number): void {
    const p = run.pickup;
    if (p) {
      p.ageS += dt / 1000;
      p.remainingMs -= dt;
      p.x += (p.vx * dt) / 1000;
      p.y =
        p.baseY +
        Math.sin(p.ageS * PICKUP_TUNING.BOB_HZ * TAU) * PICKUP_TUNING.BOB_AMPLITUDE;
      const gone = p.remainingMs <= 0 || p.x < -20 || p.x > 340;
      if (gone) {
        run.pickup = null;
        emit({ t: 'pickupExpire', id: p.id });
        run.nextPickupInMs = rollPickupDelayMs();
      }
      return;
    }

    run.nextPickupInMs -= dt;
    if (run.nextPickupInMs > 0) return;

    const pool = pickupsForScene(currentScene(run.owned), unlockedContent(meta).features);
    const def = rng.weightedPick(pool, pickupWeight);
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
    const p = run.pickup;
    if (!p || run.phase !== 'running') return false;
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy > PICKUP_TUNING.HIT_RADIUS * PICKUP_TUNING.HIT_RADIUS) return false;

    const def = PICKUP_BY_ID[p.id];
    run.pickup = null;
    run.nextPickupInMs = rollPickupDelayMs();
    emit({ t: 'pickupCollect', id: p.id, x: p.x, y: p.y });
    if (def) applyPickup(def);
    return true;
  }

  /** Grant a collected pickup. Each action is a different verb, on purpose. */
  function applyPickup(def: PickupDef): void {
    switch (def.action.t) {
      case 'buff': {
        const buff = INCIDENT_BY_ID[def.action.incident];
        if (!buff) return;
        // Re-collecting refreshes rather than stacking.
        const existing = run.incidents.findIndex((i) => i.id === buff.id);
        if (existing >= 0) run.incidents.splice(existing, 1);
        run.incidents.push(makeActiveIncident(buff, run.elapsedMs));
        emit({ t: 'incidentStart', id: buff.id, tone: 'good' });
        return;
      }
      case 'slop': {
        // Scaled to the current requirement so a lump is worth the same
        // *fraction of a project* at every point on the curve.
        const gain = projectAt(run.projectIndex).requirement * def.action.ofRequirement;
        if (!Number.isFinite(gain) || gain <= 0) return;
        run.slop += gain;
        run.slopEarned += gain;
        return;
      }
      case 'time': {
        run.timeLeftMs += def.action.ms;
        return;
      }
      case 'cleanse': {
        // The answer to an outage. Clears every bad incident at once.
        for (let i = run.incidents.length - 1; i >= 0; i--) {
          const inc = run.incidents[i];
          if (!inc) continue;
          if (INCIDENT_BY_ID[inc.id]?.tone !== 'bad') continue;
          run.incidents.splice(i, 1);
          emit({ t: 'incidentEnd', id: inc.id });
        }
        return;
      }
      case 'agent': {
        // One free unit of the best tier already fielded, so it scales with
        // the run instead of always being a tier-1 handout.
        let target: AgentTierDef | undefined;
        for (const t of AGENT_TIERS) {
          const owned = run.agents[t.id] ?? 0;
          if (owned > 0 && owned < t.maxOwned) target = t;
        }
        target ??= AGENT_TIERS[0];
        if (!target) return;
        if ((run.agents[target.id] ?? 0) >= target.maxOwned) return;
        run.agents[target.id] = (run.agents[target.id] ?? 0) + 1;
        emit({
          t: 'buyAgent',
          id: target.id,
          cost: 0,
          owned: run.agents[target.id] ?? 0,
        });
        return;
      }
      default:
        return;
    }
  }

  function tickIncidents(dt: number, incidentRateMult: number): void {
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

    const activeIds = run.incidents.map((i) => i.id);
    const def = selectIncident(
      rng,
      run.projectIndex,
      activeIds,
      BALANCE.GOOD_INCIDENT_CHANCE,
      incidentRateMult,
      run.timeLeftMs,
    );
    if (def) {
      run.incidents.push(makeActiveIncident(def, run.elapsedMs));
      emit({ t: 'incidentStart', id: def.id, tone: def.tone });
    }
    run.nextIncidentInMs = rollIncidentDelayMs(rng, incidentRateMult);
  }

  function emitDeadlineWarning(): void {
    const secs = Math.ceil(run.timeLeftMs / 1000);
    if (secs > BALANCE.WARN_AT_SECONDS || secs < 1) return;
    if (secs >= lastWarnSecond) return;
    lastWarnSecond = secs;
    emit({ t: 'deadlineWarn', secondsLeft: secs });
  }

  let autoClickAcc = 0;
  let oneShotAcc = 0;

  function stepSim(dt: number): void {
    const phase = run.phase;
    if (phase === 'won' || phase === 'lost' || phase === 'drafting') return;

    if (phase === 'shipped') {
      run.elapsedMs += dt;
      shipBeatLeftMs -= dt;
      if (shipBeatLeftMs <= 0) {
        shipBeatLeftMs = 0;
        afterShipBeat();
      }
      return;
    }

    run.elapsedMs += dt;

    const d = derived();
    const gain = d.idleRate * (dt / 1000);
    if (Number.isFinite(gain) && gain > 0) {
      run.slop += gain;
      run.slopEarned += gain;
    }

    // Automation fires *real* clicks, so an idle build still crits and still
    // clears click-to-fix incidents. Accumulated in whole clicks so a slow
    // frame owes the same total as a fast one.
    if (d.autoClickHz > 0) {
      autoClickAcc += d.autoClickHz * (dt / 1000);
      // Bounded per step: a stalled tab must not dump hundreds of clicks (and
      // hundreds of particles) into one frame.
      let fire = Math.min(Math.floor(autoClickAcc), MAX_AUTO_CLICKS_PER_STEP);
      autoClickAcc -= fire;
      while (fire-- > 0) click(LAPTOP_CENTER.x, LAPTOP_CENTER.y, true);
    }

    // One-shots: the idle-side crit. Rolled on a fixed cadence rather than per
    // frame, so the rate does not quietly scale with framerate. The roll is
    // taken even at zero chance so the RNG stream stays identical across
    // builds — a seeded run must replay the same way with or without the perk.
    if (d.idleRate > 0 || d.oneShotChance > 0) {
      oneShotAcc += dt;
      let rolls = Math.min(Math.floor(oneShotAcc / BALANCE.ONE_SHOT_ROLL_MS), MAX_ONE_SHOT_ROLLS);
      oneShotAcc -= rolls * BALANCE.ONE_SHOT_ROLL_MS;
      while (rolls-- > 0) {
        if (rng.nextFloat() >= d.oneShotChance) continue;
        const seconds = d.oneShotPayoutS;
        const burst = d.idleRate * seconds;
        if (!Number.isFinite(burst) || burst <= 0) continue;
        run.slop += burst;
        run.slopEarned += burst;
        emit({ t: 'oneShot', amount: burst, seconds });
      }
    }

    tickIncidents(dt, d.incidentRateMult);
    tickPickup(dt);

    // Incidents never pause the deadline. That is the whole point.
    run.timeLeftMs -= dt;
    emitDeadlineWarning();

    if (run.timeLeftMs <= 0) {
      run.timeLeftMs = 0;
      finishRun(false);
    }
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

  // --- player actions -------------------------------------------------------

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

  function click(x: number, y: number, auto = false): number {
    if (run.phase !== 'running') {
      emit({ t: 'denied', reason: 'phase' });
      return 0;
    }
    run.clicks += 1;

    const d = derived();
    const crit = rng.nextFloat() < d.critChance;
    const power = d.clickPower;
    const amount = Number.isFinite(power) ? power * (crit ? d.critMult : 1) : 0;

    if (Number.isFinite(amount) && amount > 0) {
      run.slop += amount;
      run.slopEarned += amount;
    }
    emit({ t: 'click', amount, x, y, crit, auto });
    applyClickToIncidents();
    return amount;
  }

  function buyAgent(id: AgentTierId, count = 1): boolean {
    // `Infinity` means "as many as I can afford". That sentinel has to survive
    // the cap clamp below, or MAX turns into a literal batch of `maxOwned` and
    // fails the atomic affordability check.
    const wantMax = typeof count === 'number' && !Number.isFinite(count) && count > 0;
    {
      const capDef = AGENT_BY_ID[id];
      const ownedNow = run.agents[id] ?? 0;
      if (capDef) {
        if (ownedNow >= capDef.maxOwned) {
          emit({ t: 'denied', reason: 'locked' });
          return false;
        }
        // Clamps an overshooting bulk buy down to the ceiling rather than
        // rejecting it, and turns MAX into "up to the remaining headroom".
        count = cappedCount(capDef, ownedNow, count);
        if (count <= 0) {
          emit({ t: 'denied', reason: 'locked' });
          return false;
        }
      }
    }
    if (run.phase !== 'running') {
      emit({ t: 'denied', reason: 'phase' });
      return false;
    }
    const def: AgentTierDef | undefined = AGENT_BY_ID[id];
    if (!def) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    if (!visibleTierList(run, meta).some((t) => t.id === id)) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    if (typeof count !== 'number' || Number.isNaN(count) || count <= 0) return false;

    // Same aggregate DerivedStats.nextCosts quotes from, so the shop never lies.
    const costMult = liveAggregate(run, meta).agentCostMult;
    const owned = run.agents[id];
    const budget = wantMax ? run.slop : Number.POSITIVE_INFINITY;
    const quote = bulkAgentCost(def, owned, count, costMult, budget);

    // Atomic: either the whole requested batch is affordable, or nothing moves.
    if (quote.count <= 0 || quote.total > run.slop) {
      emit({ t: 'denied', reason: 'cost' });
      return false;
    }
    if (!wantMax && quote.count < Math.floor(count)) {
      emit({ t: 'denied', reason: 'cost' });
      return false;
    }

    run.slop -= quote.total;
    run.slopSpent += quote.total;
    run.agents[id] = owned + quote.count;
    emit({ t: 'buyAgent', id, cost: quote.total, owned: run.agents[id] });
    return true;
  }

  function buyUpgrade(id: UpgradeId): boolean {
    if (run.phase !== 'running') {
      emit({ t: 'denied', reason: 'phase' });
      return false;
    }
    const def: UpgradeDef | undefined = UPGRADE_BY_ID[id];
    // Three gates, and the meta one is not optional. The shop only *offers*
    // unlocked upgrades, but this is public API: without the check here, any
    // caller (the balance bot, the test hooks, a console poke) could buy content
    // the save has never unlocked. Same shape as the outage bypass in `ship()`.
    if (
      !def ||
      run.owned.includes(id) ||
      !unlockedContent(meta).upgrades.has(id) ||
      !upgradeUnlocked(run, def)
    ) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    if (run.slop < def.cost) {
      emit({ t: 'denied', reason: 'cost' });
      return false;
    }
    run.slop -= def.cost;
    run.slopSpent += def.cost;
    run.owned.push(id);
    emit({ t: 'buyUpgrade', id, cost: def.cost });
    return true;
  }

  function ship(): boolean {
    if (run.phase !== 'running') {
      emit({ t: 'denied', reason: 'phase' });
      return false;
    }
    const requirement = projectAt(run.projectIndex).requirement;
    if (run.slop < requirement) {
      emit({ t: 'denied', reason: 'cost' });
      return false;
    }
    // An outage gates the deploy itself. Checking this only in `derived()`
    // would leave the hotkey and the public API able to ship straight through
    // a blocked pipeline while the button sat disabled.
    if (run.incidents.some((i) => INCIDENT_BY_ID[i.id]?.blocksShip)) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }

    if (BALANCE.SHIP_DEDUCTS) run.slop -= requirement;
    run.shipped += 1;

    const timeLeftMs = run.timeLeftMs;
    const fractionLeft = currentDeadlineMs > 0 ? timeLeftMs / currentDeadlineMs : 0;
    let demos = run.projectIndex + 1;
    if (fractionLeft >= BALANCE.BONUS_DEMO_TIME_FRACTION) demos += 1;
    demos = Math.max(0, Math.round(demos * base().demoMult));
    run.pendingDemos += demos;

    clearIncidents();
    run.phase = 'shipped';
    shipBeatLeftMs = BALANCE.SHIP_BEAT_MS;
    lastWarnSecond = Number.POSITIVE_INFINITY;

    emit({ t: 'ship', projectIndex: run.projectIndex, demos, timeLeftMs });
    return true;
  }

  function pickCard(id: CardId): boolean {
    if (run.phase !== 'drafting') {
      emit({ t: 'denied', reason: 'phase' });
      return false;
    }
    if (!run.draftOffer.includes(id) || !CARD_BY_ID[id]) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    run.cards.push(id);
    run.draftOffer = [];
    emit({ t: 'draftPick', id });
    advanceProject();
    return true;
  }

  function rerollDraft(): boolean {
    if (run.phase !== 'drafting') {
      emit({ t: 'denied', reason: 'phase' });
      return false;
    }
    if (run.draftRerollsLeft <= 0) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    run.draftRerollsLeft -= 1;
    const agg = base();
    run.draftOffer = generateOffer(
      rng,
      run.cards,
      run.projectIndex + 1,
      agg.draftSize,
      unlockedContent(meta).cards,
    );
    emit({ t: 'draftReroll' });
    emit({ t: 'draftOpen', offer: run.draftOffer.slice() });
    return true;
  }

  function buyMeta(id: MetaUpgradeId): boolean {
    // Tree edges are real gates, not decoration.
    if (!metaRequirementsMet(meta, id)) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    const def = META_BY_ID[id];
    if (!def) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    const level = Math.max(0, Math.floor(meta.levels[id] ?? 0));
    if (level >= def.maxLevel) {
      emit({ t: 'denied', reason: 'locked' });
      return false;
    }
    const cost = metaNextCost(meta, id);
    if (!Number.isFinite(cost) || meta.demos < cost) {
      emit({ t: 'denied', reason: 'demos' });
      return false;
    }
    meta.demos -= cost;
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

  const api: Sim = {
    get run(): RunState {
      return run;
    },
    get meta(): MetaState {
      return meta;
    },
    get deadlineMs(): number {
      return currentDeadlineMs;
    },
    derived,
    tick,
    click,
    collectPickup,
    buyAgent,
    buyUpgrade,
    ship,
    pickCard,
    rerollDraft,
    buyMeta,
    endRun: finishRun,
    startRun,
    availableUpgrades: () => availableUpgradeList(run, meta),
    visibleTiers: () => visibleTierList(run, meta),
    subscribe,
    metaCost: (id: MetaUpgradeId) => metaNextCost(meta, id),
    setSettings,
    save: persist,
    noteDebugHookUsed: () => grantAchievement('qa_engineer'),
  };

  if (opts.autoStart !== false) startRun();

  return api;
}

/** Cost of the next unit of a tier given the current run — handy for tooling. */
export function nextAgentCost(run: RunState, meta: MetaState, id: AgentTierId): number {
  const def = AGENT_BY_ID[id];
  return agentCostAt(def, run.agents[id], baseAggregate(run, meta).agentCostMult);
}

/** Human-readable name of an incident id, or the id itself when unknown. */
export function incidentName(id: string): string {
  return INCIDENT_BY_ID[id]?.name ?? id;
}
