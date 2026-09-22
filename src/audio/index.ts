/**
 * Tokenmaxxing audio — fully synthesised chiptune, zero audio assets.
 *
 * Typical wiring:
 *
 * ```ts
 * import { attachUnlockOnFirstGesture, createAudioEngine } from './audio/index.ts';
 *
 * const audio = createAudioEngine();
 * attachUnlockOnFirstGesture(audio);          // autoplay policy
 * sim.subscribe((e) => audio.handle(e));      // events -> sfx
 *
 * // per frame:
 * audio.setScene(PROJECTS[run.projectIndex].scene);
 * audio.setTension(1 - derived.deadlineProgress);
 * ```
 *
 * `mock-context.ts` is deliberately NOT re-exported here so it stays out of the
 * app bundle; tests import it directly.
 */

export { attachUnlockOnFirstGesture, createAudioEngine, COALESCE_MS, SFX_VOICE_CAP } from './engine.ts';
export type { AudioEngineOptions } from './engine.ts';

export {
  clamp01,
  createAudioBus,
  detectAudioContextFactory,
  hasWebAudio,
  rampParam,
  setParam,
  DEFAULT_RAMP_S,
} from './context.ts';
export type { AudioBus, AudioContextFactory } from './context.ts';

export {
  applyADSR,
  clamp,
  envTimes,
  mtof,
  noiseBuffer,
  playTone,
  pulseWave,
  VoicePool,
  DEFAULT_ADSR,
  LOW_PRIORITY,
  STEAL_PRIORITY,
} from './synth.ts';
export type { ADSR, EnvTimes, FilterSpec, ToneOpts, VoiceSlot, Wave } from './synth.ts';

export { createSfxPlayer, isStreakDriven, SFX_PRIORITY, STREAK_IDLE_S, STREAK_MAX_STEPS } from './sfx.ts';
export type { SfxDeps, SfxPlayer } from './sfx.ts';

export { createMusic, SCENES } from './music.ts';
export type { MusicController, SceneCfg } from './music.ts';
