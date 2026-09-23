/**
 * The `AudioEngine` implementation (see `src/sim/types.ts`).
 *
 * Contract guarantees:
 *  - No `AudioContext` is constructed until `unlock()` runs, and `unlock()` is
 *    idempotent under concurrent calls.
 *  - In an environment with no WebAudio at all, `createAudioEngine()` still
 *    returns a fully usable object: every method is a silent no-op and
 *    `unlocked` stays `false`. Nothing throws, ever.
 *  - SFX are voice-budgeted and rate-limited, and automated clicks are gated
 *    harder still. The music scheduler pauses on `document.hidden` and stops
 *    entirely at music volume 0.
 *
 * `handle()` is the game-to-audio mapping: it decides which sound an event
 * gets, and turns game values (sycophancy heat, context fill) into the 0..1
 * amounts `sfx.ts` synthesises from. Every sound it picks goes through the
 * public `play()`, so one set of gates covers them all.
 */

import { BALANCE, INCIDENT_BY_ID } from '../sim/content.ts';
import type { AudioEngine, GameEvent, IncidentId, SceneKey, SfxName } from '../sim/types.ts';
import {
  clamp01,
  createAudioBus,
  detectAudioContextFactory,
  type AudioBus,
  type AudioContextFactory,
} from './context.ts';
import { createMusic, type MusicController } from './music.ts';
import {
  createSfxPlayer,
  isStreakDriven,
  type AnySfxName,
  type SfxParams,
  type SfxPlayer,
} from './sfx.ts';
import { saturate, VoicePool } from './synth.ts';

/** Hard cap on simultaneous SFX voices. */
export const SFX_VOICE_CAP = 24;
/** Identical SFX fired inside this window are coalesced (clicks excepted). */
export const COALESCE_MS = 30;
/**
 * Automation fires real clicks, as many as dozens a second. Past about ten a
 * second they stop being feedback and become a drill, so an automated click
 * is silent when another one sounded inside this window.
 */
export const AUTO_CLICK_GAP_MS = 90;
/**
 * Automated crits keep their sting, but a crit-stacked idle build rolls
 * several a second, so each one after the first waits this long.
 */
export const AUTO_CRIT_GAP_MS = 400;

/** Incidents with a sound of their own, checked before the permission and tone rules. */
export const INCIDENT_SFX: ReadonlyMap<IncidentId, SfxName> = new Map<IncidentId, SfxName>([
  // "wait stop": the human breaks in mid-call. Glass, shattering.
  ['wait_stop', 'interrupt'],
]);

/** Which sound an incident opens with. */
export function incidentSfx(id: IncidentId, tone: 'bad' | 'good'): SfxName {
  const own = INCIDENT_SFX.get(id);
  if (own) return own;
  // Every permission prompt dings, whichever tool it stalls. Content flags them.
  if (INCIDENT_BY_ID[id]?.permission === true) return 'permission';
  return tone === 'good' ? 'incidentGood' : 'incidentBad';
}

/**
 * Sycophancy heat is roughly one point per recent press, draining one point
 * every `BALANCE.SYCOPHANCY_HEAT_DECAY_MS`. At or under this it still sounds
 * sincere, whichever side of its own press the sim reports heat from...
 */
const SYCOPHANCY_SINCERE_HEAT = 1;
/** ...and by this much it is as hollow as it gets: each press is worth ~1/16. */
const SYCOPHANCY_HOLLOW_HEAT = 5;

/** 0 for a sincere "You're absolutely right!", 1 once it has been spammed hollow. */
export function sycophancyThinness(heat: number): number {
  return saturate((heat - SYCOPHANCY_SINCERE_HEAT) / (SYCOPHANCY_HOLLOW_HEAT - SYCOPHANCY_SINCERE_HEAT));
}

/** 0 at the first context warning, 1 at the last one before an overflow. */
export function contextUrgency(fill: number): number {
  const fills = BALANCE.CONTEXT_WARN_FILLS;
  const first = fills[0] ?? 0.8;
  const last = fills[fills.length - 1] ?? first;
  if (last <= first) return fill >= last ? 1 : 0;
  return saturate((fill - first) / (last - first));
}

export interface AudioEngineOptions {
  /**
   * Injectable `AudioContext` factory. Pass `null` to force the silent path.
   * Omit to feature-detect WebAudio on `globalThis`.
   */
  readonly contextFactory?: AudioContextFactory | null;
  /** Initial music volume, 0..1. Default 0.6. */
  readonly music?: number;
  /** Initial SFX volume, 0..1. Default 0.8. */
  readonly sfx?: number;
  /** Attach a `visibilitychange` listener. Default true. */
  readonly handleVisibility?: boolean;
  /** Scene to start the score on. Default 'bedroom'. */
  readonly scene?: SceneKey;
}

/**
 * The engine as its own handlers see it: `play()` also carries event detail,
 * and reaches the internal sounds `SfxName` has no member for.
 */
interface EngineInternals extends AudioEngine {
  play(sfx: AnySfxName, params?: SfxParams): void;
}

type AutoGate = 'autoClick' | 'autoCrit';

const AUTO_TICK: SfxParams = { auto: true };

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

export function createAudioEngine(opts: AudioEngineOptions = {}): AudioEngine {
  let bus: AudioBus | null = null;
  let sfxPlayer: SfxPlayer | null = null;
  let music: MusicController | null = null;
  let pool: VoicePool | null = null;

  let unlockedFlag = false;
  let destroyed = false;
  let unlocking: Promise<void> | null = null;

  const volumes = {
    music: clamp01(opts.music ?? 0.6),
    sfx: clamp01(opts.sfx ?? 0.8),
  };
  let scene: SceneKey = opts.scene ?? 'bedroom';
  let tension = 0;

  /** Last fire time per SFX, in ms on the context clock. */
  const lastFired = new Map<AnySfxName, number>();
  /** Last time each automation gate let a sound through, in ms on the context clock. */
  const autoGates = new Map<AutoGate, number>();

  function resolveFactory(): AudioContextFactory | null {
    // `undefined` means "detect"; explicit `null` means "no audio".
    if (opts.contextFactory !== undefined) return opts.contextFactory;
    return detectAudioContextFactory();
  }

  /** The context clock in ms; frozen at 0 until there is a context (all silent anyway). */
  function nowMs(): number {
    return bus ? bus.now() * 1000 : 0;
  }

  function autoGateOpen(gate: AutoGate, now: number, gapMs: number): boolean {
    const prev = autoGates.get(gate);
    // A clock that reads earlier than the last pass (a fresh context) never blocks.
    return prev === undefined || now < prev || now - prev >= gapMs;
  }

  /**
   * Automated clicks are real clicks and still sound, up to a point: a crit
   * keeps its sting at a capped rate, and the rest become a soft tick at a
   * capped rate, so an idle build hums along instead of drilling.
   */
  function autoClick(crit: boolean): void {
    const now = nowMs();
    if (crit && autoGateOpen('autoCrit', now, AUTO_CRIT_GAP_MS)) {
      autoGates.set('autoCrit', now);
      // No tick on top of the sting.
      autoGates.set('autoClick', now);
      api.play('clickCrit');
      return;
    }
    if (!autoGateOpen('autoClick', now, AUTO_CLICK_GAP_MS)) return;
    autoGates.set('autoClick', now);
    api.play('click', AUTO_TICK);
  }

  async function boot(): Promise<void> {
    const factory = resolveFactory();
    if (!factory) return;
    const created = createAudioBus(factory);
    if (!created) return;
    if (destroyed) {
      void created.close();
      return;
    }

    bus = created;
    pool = new VoicePool(SFX_VOICE_CAP);
    sfxPlayer = createSfxPlayer({ ctx: created.ctx, out: created.sfx, pool });
    music = createMusic(created.ctx, created.music);

    // Apply state captured before unlock, instantly (nothing is audible yet).
    created.setMusicVolume(volumes.music, 0);
    created.setSfxVolume(volumes.sfx, 0);
    music.setScene(scene);
    music.setTension(tension);
    music.setEnabled(volumes.music > 0);

    await created.resume();
    if (destroyed) return;

    unlockedFlag = true;
    if (documentHidden()) music.suspend();
    else if (volumes.music > 0) music.start();
  }

  const onVisibility = (): void => {
    if (destroyed || !music) return;
    if (documentHidden()) music.suspend();
    else if (unlockedFlag && volumes.music > 0) music.resume();
  };

  const visibilityWired =
    opts.handleVisibility !== false &&
    typeof document !== 'undefined' &&
    typeof document.addEventListener === 'function';
  if (visibilityWired) {
    document.addEventListener('visibilitychange', onVisibility);
  }

  const api: EngineInternals = {
    async unlock(): Promise<void> {
      if (destroyed || unlockedFlag) return;
      if (unlocking) return unlocking;
      unlocking = boot()
        .catch(() => undefined)
        .then(() => {
          // If the platform refused, forget the attempt so a later gesture can
          // retry. On success the `unlockedFlag` guard above short-circuits.
          if (!unlockedFlag) unlocking = null;
        });
      return unlocking;
    },

    get unlocked(): boolean {
      return unlockedFlag;
    },

    play(name: AnySfxName, params?: SfxParams): void {
      if (destroyed || !bus || !sfxPlayer) return;
      if (volumes.sfx <= 0) return;
      if (!isStreakDriven(name)) {
        const now = bus.now() * 1000;
        const prev = lastFired.get(name);
        if (prev !== undefined && now - prev < COALESCE_MS) return;
        lastFired.set(name, now);
      }
      sfxPlayer.play(name, undefined, params);
    },

    handle(e: GameEvent): void {
      if (destroyed) return;
      switch (e.t) {
        // -- the agent at work ----------------------------------------------
        case 'click':
          if (e.auto) autoClick(e.crit);
          else api.play(e.crit ? 'clickCrit' : 'click');
          return;
        case 'oneShot':
          api.play('oneShot');
          return;
        case 'sycophancy':
          api.play('sycophancy', { thin: sycophancyThinness(e.heat) });
          return;

        // -- economy ----------------------------------------------------------
        case 'buyTool':
        case 'buyUpgrade':
          api.play('buy');
          return;
        case 'denied':
          api.play('denied');
          return;
        case 'metaBuy':
          api.play('metaBuy');
          return;
        case 'toolLost':
          // rm -rf ate a tool. Its incident plays its own sting at the same
          // moment; the crunch is a different sound, so both land.
          api.play('toolLost');
          return;

        // -- the report button ----------------------------------------------
        case 'report':
          api.play('report');
          return;
        case 'claim':
          api.play(e.caught ? 'caught' : 'claim');
          return;

        // -- the two clocks -------------------------------------------------
        case 'compactStart':
          api.play(e.forced ? 'compactForced' : 'compact');
          return;
        case 'contextWarn':
          api.play('contextWarn', { urgency: contextUrgency(e.fill) });
          return;
        case 'patienceWarn':
          api.play('warn');
          return;

        // -- draft ----------------------------------------------------------
        case 'draftOpen':
          api.play('draftOpen');
          return;
        case 'draftPick':
          api.play('draftPick');
          return;
        case 'draftReroll':
          api.play('reroll');
          return;

        // -- incidents and pickups ------------------------------------------
        case 'incidentStart':
          api.play(incidentSfx(e.id, e.tone));
          return;
        case 'incidentEnd':
          api.play('incidentClear');
          return;
        case 'pickupCollect':
          api.play('incidentGood');
          return;

        // -- milestones -----------------------------------------------------
        // The game-1 save turning up is an occasion too. It tends to arrive
        // with its own hidden achievement; the coalescer folds a same-moment
        // pair into one fanfare.
        case 'achievement':
        case 'legacyImport':
          api.play('achievement');
          return;
        case 'runOver':
          api.play(e.won ? 'win' : 'lose');
          return;
        case 'runStart':
          // Fresh run: drop the click streak and relax the score.
          sfxPlayer?.resetStreak();
          tension = 0;
          music?.setTension(0);
          return;

        // Informational: the stage and the UI show these; the ear does not need them.
        case 'compactEnd':
        case 'incidentProgress':
        case 'pickupSpawn':
        case 'pickupExpire':
          return;
        default:
          return;
      }
    },

    setScene(next: SceneKey): void {
      if (destroyed) return;
      scene = next;
      music?.setScene(next);
    },

    setTension(t: number): void {
      if (destroyed) return;
      tension = clamp01(t);
      music?.setTension(tension);
    },

    setVolumes(v: { music: number; sfx: number }): void {
      if (destroyed) return;
      volumes.music = clamp01(v.music);
      volumes.sfx = clamp01(v.sfx);
      bus?.setMusicVolume(volumes.music);
      bus?.setSfxVolume(volumes.sfx);
      if (!music) return;
      // Volume 0 halts the scheduler outright so we burn no CPU while muted.
      music.setEnabled(volumes.music > 0);
      if (volumes.music > 0 && unlockedFlag && !documentHidden()) music.start();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (visibilityWired) {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      music?.destroy();
      pool?.killAll(bus ? bus.now() : 0);
      const closing = bus;
      music = null;
      sfxPlayer = null;
      pool = null;
      bus = null;
      unlockedFlag = false;
      unlocking = null;
      lastFired.clear();
      autoGates.clear();
      if (closing) void closing.close();
    },
  };

  return api;
}

/** Events that count as a "first gesture" for the autoplay policy. */
const GESTURES = ['pointerdown', 'touchstart', 'keydown'] as const;

/**
 * Wire `unlock()` to the first user gesture. Returns a disposer.
 *
 * ```ts
 * const audio = createAudioEngine();
 * const detach = attachUnlockOnFirstGesture(audio);
 * ```
 */
export function attachUnlockOnFirstGesture(
  engine: AudioEngine,
  target: EventTarget | null = typeof window !== 'undefined' ? window : null,
): () => void {
  if (!target || typeof target.addEventListener !== 'function') return () => undefined;
  let done = false;
  const detach = (): void => {
    if (done) return;
    done = true;
    for (const type of GESTURES) target.removeEventListener(type, handler);
  };
  const handler = (): void => {
    void engine.unlock();
    detach();
  };
  for (const type of GESTURES) {
    target.addEventListener(type, handler, { passive: true });
  }
  return detach;
}
