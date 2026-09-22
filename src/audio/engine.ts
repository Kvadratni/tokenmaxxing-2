/**
 * The `AudioEngine` implementation (see `src/sim/types.ts`).
 *
 * Contract guarantees:
 *  - No `AudioContext` is constructed until `unlock()` runs, and `unlock()` is
 *    idempotent under concurrent calls.
 *  - In an environment with no WebAudio at all, `createAudioEngine()` still
 *    returns a fully usable object: every method is a silent no-op and
 *    `unlocked` stays `false`. Nothing throws, ever.
 *  - SFX are voice-budgeted and rate-limited; the music scheduler pauses on
 *    `document.hidden` and stops entirely at music volume 0.
 */

import type { AudioEngine, GameEvent, SceneKey, SfxName } from '../sim/types.ts';
import {
  clamp01,
  createAudioBus,
  detectAudioContextFactory,
  type AudioBus,
  type AudioContextFactory,
} from './context.ts';
import { createMusic, type MusicController } from './music.ts';
import { createSfxPlayer, isStreakDriven, type SfxPlayer } from './sfx.ts';
import { VoicePool } from './synth.ts';

/** Hard cap on simultaneous SFX voices. */
export const SFX_VOICE_CAP = 24;
/** Identical SFX fired inside this window are coalesced (clicks excepted). */
export const COALESCE_MS = 30;

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
  const lastFired = new Map<SfxName, number>();

  function resolveFactory(): AudioContextFactory | null {
    // `undefined` means "detect"; explicit `null` means "no audio".
    if (opts.contextFactory !== undefined) return opts.contextFactory;
    return detectAudioContextFactory();
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

  const api: AudioEngine = {
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

    play(name: SfxName): void {
      if (destroyed || !bus || !sfxPlayer) return;
      if (volumes.sfx <= 0) return;
      if (!isStreakDriven(name)) {
        const now = bus.now() * 1000;
        const prev = lastFired.get(name);
        if (prev !== undefined && now - prev < COALESCE_MS) return;
        lastFired.set(name, now);
      }
      sfxPlayer.play(name);
    },

    handle(e: GameEvent): void {
      if (destroyed) return;
      switch (e.t) {
        case 'click':
          api.play(e.crit ? 'clickCrit' : 'click');
          return;
        case 'oneShot':
          api.play('oneShot');
          return;
        case 'buyAgent':
        case 'buyUpgrade':
          api.play('buy');
          return;
        case 'denied':
          api.play('denied');
          return;
        case 'metaBuy':
          api.play('metaBuy');
          return;
        case 'achievement':
          api.play('achievement');
          return;
        case 'ship':
          api.play('ship');
          return;
        case 'runOver':
          api.play(e.won ? 'win' : 'lose');
          return;
        case 'draftOpen':
          api.play('draftOpen');
          return;
        case 'draftPick':
          api.play('draftPick');
          return;
        case 'draftReroll':
          api.play('reroll');
          return;
        case 'incidentStart':
          api.play(e.tone === 'good' ? 'incidentGood' : 'incidentBad');
          return;
        case 'pickupCollect':
          api.play('incidentGood');
          return;
        case 'incidentEnd':
          api.play('incidentClear');
          return;
        case 'deadlineWarn':
          api.play('warn');
          return;
        case 'runStart':
          // Fresh run: drop the click streak and relax the score.
          sfxPlayer?.resetStreak();
          tension = 0;
          music?.setTension(0);
          return;
        case 'incidentProgress':
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
