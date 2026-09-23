/**
 * Tokenmaxxing 2 audio: "inside the machine". Two-operator FM, filtered noise
 * and a little bit-crush, fully synthesised, zero audio assets.
 *
 * Typical wiring:
 *
 * ```ts
 * import { attachUnlockOnFirstGesture, contextFillFor, createAudioEngine, tensionFor } from './audio/index.ts';
 *
 * const audio = createAudioEngine();
 * attachUnlockOnFirstGesture(audio);          // autoplay policy
 * sim.subscribe((e) => audio.handle(e));      // events -> sfx
 *
 * // per frame:
 * audio.setScene(derived.scene);              // the human's room behind the glass
 * audio.setTension(tensionFor(derived));      // patience running out, context filling up
 * audio.setContextFill?.(contextFillFor(derived)); // the pad opens up as the window fills
 * ```
 *
 * `mock-context.ts` is deliberately NOT re-exported here so it stays out of the
 * app bundle; tests import it directly.
 */

export {
  attachUnlockOnFirstGesture,
  contextUrgency,
  createAudioEngine,
  incidentSfx,
  incidentSpeaker,
  sycophancyThinness,
  AUTO_CLICK_GAP_MS,
  AUTO_CRIT_GAP_MS,
  COALESCE_MS,
  HUMAN_PICKUPS,
  INCIDENT_SFX,
  MUSIC_DUCK,
  SFX_VOICE_CAP,
} from './engine.ts';
export type { AudioEngineOptions, EngineState, GameAudioEngine } from './engine.ts';

export {
  ceilingCurve,
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
  createRng,
  crushCurve,
  envTimes,
  hash01,
  mtof,
  noiseBuffer,
  playFM,
  playTone,
  reverbImpulse,
  saturate,
  startDrone,
  VoicePool,
  DEFAULT_ADSR,
  FM,
  LOW_PRIORITY,
  STEAL_PRIORITY,
} from './synth.ts';
export type {
  ADSR,
  Drone,
  DroneLayer,
  DroneSpec,
  EnvTimes,
  FilterSpec,
  FMOpts,
  PitchPoint,
  ReverbSpec,
  ToneOpts,
  VoiceOpts,
  VoiceSlot,
  Wave,
} from './synth.ts';

export {
  createSfxPlayer,
  critDyad,
  isStreakDriven,
  streakNote,
  CLICK_SCALE,
  SFX_PRIORITY,
  STREAK_IDLE_S,
  STREAK_MAX_STEPS,
} from './sfx.ts';
export type { AnySfxName, ExtraSfxName, SfxDeps, SfxParams, SfxPlayer } from './sfx.ts';

export {
  arrange,
  contextFillFor,
  createMusic,
  denseAt,
  densityCount,
  padCutoffFor,
  passFor,
  pressureFor,
  tensionFor,
  toneShelfFor,
  CYCLE_BARS,
  HARMONY,
  LOOKAHEAD_MS,
  LOOP_BARS,
  MUSIC_VOICE_CAP,
  PAD_CUTOFF_EMPTY,
  PAD_CUTOFF_FULL,
  PARTS,
  PRESSURE_FROM,
  SCENES,
  SCHEDULE_AHEAD_S,
  SHELF_HZ,
  SHELF_LIFT_DB,
  STEPS_PER_BAR,
  THEME,
  XFADE_BARS,
} from './music.ts';
export type {
  Chord,
  Density,
  Harmony,
  MusicController,
  MusicNote,
  MusicOptions,
  MusicState,
  MusicTimers,
  PartName,
  PassKind,
  SceneCfg,
  SoloPart,
  ThemeNote,
} from './music.ts';
