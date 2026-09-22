/**
 * Procedural chiptune score.
 *
 * Classic lookahead scheduling: a 25 ms `setInterval` walks a 16th-note grid
 * and schedules every note ~100 ms ahead against `ctx.currentTime`, so timing
 * is sample-accurate even when the main thread stutters.
 *
 * Three independent layers on their own gains:
 *   bass  — root movement, one note per chord hit
 *   lead  — arpeggio over the current chord
 *   hat   — filtered noise percussion, faded in by tension
 *
 * `setScene()` cross-fades between five variations (bedroom sparse + lo-fi ->
 * orbital dense + wide). Numeric parameters (tempo, gains, filter cutoffs,
 * stereo width) interpolate over `XFADE_S`; note content (chord progression,
 * waveforms, patterns) swaps on the next bar line so the switch is musical.
 *
 * `setTension()` is smoothed every tick rather than applied stepwise: tempo
 * lifts modestly, the hat layer fades in, and a minor-2nd shadow voice appears
 * at the tail of each bar as t -> 1.
 */

import type { SceneKey } from '../sim/types.ts';
import { rampParam } from './context.ts';
import { clamp, mtof, playTone, VoicePool, type Wave } from './synth.ts';

/** Scheduler wakeups. */
const LOOKAHEAD_MS = 25;
/** How far ahead of the clock notes are queued. */
const SCHEDULE_AHEAD_S = 0.1;
/** 16th-note grid. */
const STEPS_PER_BAR = 16;
/** Scene cross-fade length. */
const XFADE_S = 1.4;
/** Independent budget so the score can never starve the SFX pool. */
const MUSIC_VOICE_CAP = 20;
/** Tension smoothing per tick (~0.35 s to settle). */
const TENSION_LERP = 0.07;
/** Tension above this starts introducing dissonance. */
const DISSONANCE_KNEE = 0.55;

export interface SceneCfg {
  readonly bpm: number;
  /** Bass root, MIDI. */
  readonly root: number;
  /** Semitone offset per bar — the chord progression. */
  readonly prog: readonly number[];
  readonly bassWave: Wave;
  readonly bassSteps: readonly number[];
  readonly bassGain: number;
  readonly bassCut: number;
  readonly leadDuty: number;
  /** Octaves above the bass root. */
  readonly leadOct: number;
  /** Arp fires on every Nth 16th. */
  readonly arpEvery: number;
  readonly arpShape: readonly number[];
  /** Grid steps the arp deliberately sits out, for air. */
  readonly leadSkip: readonly number[];
  readonly leadGain: number;
  readonly leadCut: number;
  /** Stereo spread + detune amount, 0..1. */
  readonly width: number;
  /** Hat fires on every Nth 16th. 0 disables. */
  readonly hatEvery: number;
  readonly hatGain: number;
  /** Delay applied to odd steps, as a fraction of a step. */
  readonly swing: number;
}

/** Minor-7 arpeggio shapes. Sparse scenes use fewer, wider notes. */
const SHAPE_SPARSE = [0, 7, 3, 10] as const;
const SHAPE_ROLL = [0, 3, 7, 10, 12, 10, 7, 3] as const;
const SHAPE_DENSE = [0, 3, 7, 10, 12, 15, 12, 7, 10, 3, 7, 0] as const;

export const SCENES: Readonly<Record<SceneKey, SceneCfg>> = {
  // Cozy, lo-fi, lots of air.
  bedroom: {
    bpm: 88,
    root: 36,
    prog: [0, 8, 3, 10],
    bassWave: 'triangle',
    bassSteps: [0, 8],
    bassGain: 0.55,
    bassCut: 900,
    leadDuty: 0.5,
    leadOct: 2,
    arpEvery: 4,
    arpShape: SHAPE_SPARSE,
    leadSkip: [12],
    leadGain: 0.24,
    leadCut: 1900,
    width: 0.15,
    hatEvery: 8,
    hatGain: 0.14,
    swing: 0.18,
  },
  // A little more forward motion, brighter lead.
  coworking: {
    bpm: 100,
    root: 38,
    prog: [0, 5, 8, 3],
    bassWave: 'triangle',
    bassSteps: [0, 6, 8],
    bassGain: 0.55,
    bassCut: 1300,
    leadDuty: 0.35,
    leadOct: 2,
    arpEvery: 2,
    arpShape: SHAPE_SPARSE,
    leadSkip: [14],
    leadGain: 0.26,
    leadCut: 2800,
    width: 0.3,
    hatEvery: 4,
    hatGain: 0.2,
    swing: 0.12,
  },
  // Busy office: steady 8ths, rolling arp.
  openplan: {
    bpm: 112,
    root: 41,
    prog: [0, 7, 3, 10],
    bassWave: 'square',
    bassSteps: [0, 3, 6, 8, 11],
    bassGain: 0.5,
    bassCut: 1700,
    leadDuty: 0.3,
    leadOct: 2,
    arpEvery: 2,
    arpShape: SHAPE_ROLL,
    leadSkip: [],
    leadGain: 0.27,
    leadCut: 3600,
    width: 0.45,
    hatEvery: 2,
    hatGain: 0.24,
    swing: 0.06,
  },
  // Machine room: saw bass, driving 16ths.
  datacenter: {
    bpm: 124,
    root: 33,
    prog: [0, 10, 8, 7],
    bassWave: 'saw',
    bassSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    bassGain: 0.46,
    bassCut: 2200,
    leadDuty: 0.25,
    leadOct: 3,
    arpEvery: 1,
    arpShape: SHAPE_ROLL,
    leadSkip: [],
    leadGain: 0.24,
    leadCut: 4600,
    width: 0.6,
    hatEvery: 2,
    hatGain: 0.28,
    swing: 0,
  },
  // Orbital: widest, densest, most euphoric.
  orbital: {
    bpm: 136,
    root: 36,
    prog: [0, 3, 8, 5],
    bassWave: 'saw',
    bassSteps: [0, 2, 3, 6, 8, 10, 11, 14],
    bassGain: 0.44,
    bassCut: 2600,
    leadDuty: 0.2,
    leadOct: 3,
    arpEvery: 1,
    arpShape: SHAPE_DENSE,
    leadSkip: [],
    leadGain: 0.26,
    leadCut: 6200,
    width: 0.9,
    hatEvery: 1,
    hatGain: 0.3,
    swing: 0,
  },
};

export interface MusicController {
  /** Begin (or resume) the scheduler. No-op while suspended or disabled. */
  start(): void;
  /** Stop the scheduler and silence the layers. Already-queued notes finish. */
  stop(): void;
  /** Tab went to the background. Cheap pause; keeps the enabled/scene state. */
  suspend(): void;
  /** Tab is visible again. */
  resume(): void;
  setScene(scene: SceneKey): void;
  setTension(t: number): void;
  /** Volume gate — `false` stops the scheduler entirely to save CPU. */
  setEnabled(enabled: boolean): void;
  readonly running: boolean;
  readonly hidden: boolean;
  readonly enabled: boolean;
  readonly scene: SceneKey;
  readonly tension: number;
  destroy(): void;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/**
 * Grid steps until the next hit in `steps` (wrapping across the bar line), so
 * sparse patterns get long sustained notes instead of the same short pluck.
 */
function gapToNext(steps: readonly number[], step: number): number {
  for (const s of steps) {
    if (s > step) return s - step;
  }
  return STEPS_PER_BAR - step + (steps[0] ?? 0);
}

export function createMusic(ctx: BaseAudioContext, out: AudioNode): MusicController {
  const pool = new VoicePool(MUSIC_VOICE_CAP);

  const bassGain = ctx.createGain();
  const leadGain = ctx.createGain();
  const hatGain = ctx.createGain();
  for (const g of [bassGain, leadGain, hatGain]) {
    g.gain.value = 0;
    g.connect(out);
  }

  let sceneKey: SceneKey = 'bedroom';
  let active: SceneCfg = SCENES.bedroom;
  let previous: SceneCfg = SCENES.bedroom;
  let pendingScene: SceneKey | null = null;
  let xfade = 1;

  let tension = 0;
  let tensionTarget = 0;

  let timer: ReturnType<typeof setInterval> | null = null;
  let nextNoteTime = 0;
  let step = 0;
  let bar = 0;
  let arpCursor = 0;

  let enabled = true;
  let hidden = false;
  let destroyed = false;

  /** Interpolate one numeric scene field across the cross-fade. */
  function bl(sel: (s: SceneCfg) => number): number {
    if (xfade >= 1 || previous === active) return sel(active);
    return lerp(sel(previous), sel(active), xfade);
  }

  function dissonance(): number {
    return Math.max(0, (tension - DISSONANCE_KNEE) / (1 - DISSONANCE_KNEE));
  }

  function currentBpm(): number {
    return bl((s) => s.bpm) * (1 + 0.17 * tension);
  }

  function smooth(now: number): void {
    tension += (tensionTarget - tension) * TENSION_LERP;
    if (Math.abs(tensionTarget - tension) < 0.001) tension = tensionTarget;
    if (xfade < 1) xfade = Math.min(1, xfade + LOOKAHEAD_MS / 1000 / XFADE_S);

    // Ramps are slightly longer than the tick so the layers glide continuously.
    const ramp = (LOOKAHEAD_MS / 1000) * 2.2;
    rampParam(bassGain.gain, bl((s) => s.bassGain) * (0.9 + 0.12 * tension), now, ramp);
    rampParam(leadGain.gain, bl((s) => s.leadGain) * (0.82 + 0.34 * tension), now, ramp);
    rampParam(hatGain.gain, bl((s) => s.hatGain) * (0.08 + 0.95 * tension), now, ramp);
  }

  function silenceLayers(now: number): void {
    rampParam(bassGain.gain, 0, now, 0.12);
    rampParam(leadGain.gain, 0, now, 0.12);
    rampParam(hatGain.gain, 0, now, 0.12);
  }

  function scheduleStep(t: number, stepDur: number): void {
    const chord = active.prog[bar % active.prog.length] ?? 0;
    const swung = step % 2 === 1 ? t + stepDur * active.swing : t;
    const dis = dissonance();

    // --- bass -------------------------------------------------------------
    if (active.bassSteps.includes(step)) {
      const accent = step === 0 ? 1.15 : 0.85;
      const gap = gapToNext(active.bassSteps, step);
      playTone(ctx, bassGain, {
        wave: active.bassWave,
        freq: mtof(active.root + chord),
        when: swung,
        hold: stepDur * gap * 0.7,
        gain: 0.5 * accent,
        env: { a: 0.005, d: 0.06, s: 0.62, r: 0.08 },
        filter: { type: 'lowpass', freq: bl((s) => s.bassCut), q: 1.1 },
        priority: 1,
        pool,
      });
    }

    // --- arpeggio lead ----------------------------------------------------
    if (step % active.arpEvery === 0 && !active.leadSkip.includes(step)) {
      const shape = active.arpShape;
      const idx = arpCursor++;
      const semi = shape[idx % shape.length] ?? 0;
      const note = active.root + chord + semi + 12 * active.leadOct;
      const width = bl((s) => s.width);
      const side = idx % 2 === 0 ? -1 : 1;
      // Scale the note length with the arp subdivision so sparse scenes breathe
      // and dense ones stay tight.
      const leadHold = stepDur * active.arpEvery * 0.5;
      playTone(ctx, leadGain, {
        wave: 'pulse',
        duty: active.leadDuty,
        freq: mtof(note),
        when: swung,
        hold: leadHold,
        gain: 0.3,
        env: { a: 0.002, d: 0.03, s: 0.38, r: 0.06 },
        detune: side * width * 11,
        pan: side * width * 0.55,
        filter: { type: 'lowpass', freq: bl((s) => s.leadCut), q: 0.9 },
        priority: 1,
        pool,
      });

      // Dissonant tail: a detuned minor 2nd shadow near the bar line.
      if (dis > 0.02 && step >= STEPS_PER_BAR - 4) {
        playTone(ctx, leadGain, {
          wave: 'pulse',
          duty: 0.5,
          freq: mtof(note + 1),
          when: swung,
          hold: leadHold * 0.9,
          gain: 0.16 * dis,
          env: { a: 0.003, d: 0.04, s: 0.4, r: 0.09 },
          detune: -24,
          pan: -side * width * 0.55,
          filter: { type: 'lowpass', freq: bl((s) => s.leadCut) * 0.7, q: 1.4 },
          priority: 0,
          pool,
        });
      }
    }

    // --- hats -------------------------------------------------------------
    const hatLevel = bl((s) => s.hatGain) * (0.08 + 0.95 * tension);
    if (active.hatEvery > 0 && hatLevel > 0.006) {
      const phase = active.hatEvery > 1 ? 1 : 0;
      if (step % active.hatEvery === phase % active.hatEvery) {
        const accent = step % 8 === 4 ? 1.6 : 1;
        playTone(ctx, hatGain, {
          wave: 'noise',
          when: swung,
          hold: 0.006,
          gain: 0.22 * accent,
          rate: 1.35 + 0.35 * tension,
          env: { a: 0.001, d: 0.012, s: 0.05, r: 0.028 },
          filter: { type: 'highpass', freq: 5200 + 1800 * tension, q: 0.9 },
          priority: 0,
          pool,
        });
      }
    }

    // Low rumble under the bar line when the deadline is nearly up.
    if (dis > 0.5 && step === 0) {
      playTone(ctx, bassGain, {
        wave: 'saw',
        freq: mtof(active.root - 12),
        when: swung,
        hold: stepDur * 6,
        gain: 0.18 * dis,
        env: { a: 0.05, d: 0.1, s: 0.7, r: 0.25 },
        detune: 17,
        filter: { type: 'lowpass', freq: 220, q: 2 },
        priority: 0,
        pool,
      });
    }
  }

  function tick(): void {
    if (destroyed) return;
    const now = ctx.currentTime;
    smooth(now);

    // Resync after tab throttling / clock jumps.
    if (nextNoteTime < now) nextNoteTime = now + 0.02;

    let guard = 0;
    while (nextNoteTime < now + SCHEDULE_AHEAD_S && guard++ < 64) {
      const stepDur = 60 / Math.max(30, currentBpm()) / 4;
      scheduleStep(nextNoteTime, stepDur);
      nextNoteTime += stepDur;
      step++;
      if (step >= STEPS_PER_BAR) {
        step = 0;
        bar++;
        // Swap note content on the bar line; the gain/tempo cross-fade is
        // already under way.
        if (pendingScene !== null) {
          previous = active;
          active = SCENES[pendingScene];
          pendingScene = null;
          xfade = 0;
        }
      }
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  const api: MusicController = {
    start() {
      if (destroyed || timer !== null || !enabled || hidden) return;
      nextNoteTime = ctx.currentTime + 0.06;
      step = 0;
      timer = setInterval(tick, LOOKAHEAD_MS);
      smooth(ctx.currentTime);
    },
    stop() {
      clearTimer();
      if (!destroyed) silenceLayers(ctx.currentTime);
    },
    suspend() {
      if (hidden) return;
      hidden = true;
      clearTimer();
      if (!destroyed) silenceLayers(ctx.currentTime);
    },
    resume() {
      if (!hidden) return;
      hidden = false;
      api.start();
    },
    setScene(next) {
      if (destroyed) return;
      const cfg = SCENES[next];
      if (!cfg) return;
      sceneKey = next;
      if (timer === null) {
        // Not playing: adopt immediately, no cross-fade to hear.
        previous = cfg;
        active = cfg;
        pendingScene = null;
        xfade = 1;
        return;
      }
      if (active === cfg) {
        pendingScene = null;
        return;
      }
      pendingScene = next;
    },
    setTension(t) {
      tensionTarget = clamp(t, 0, 1);
      if (destroyed) return;
      if (timer === null) tension = tensionTarget;
    },
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled) api.stop();
      else api.start();
    },
    get running() {
      return timer !== null;
    },
    get hidden() {
      return hidden;
    },
    get enabled() {
      return enabled;
    },
    get scene() {
      return sceneKey;
    },
    get tension() {
      return tension;
    },
    destroy() {
      if (destroyed) return;
      clearTimer();
      destroyed = true;
      try {
        pool.killAll(ctx.currentTime);
      } catch {
        /* ignore */
      }
      for (const g of [bassGain, leadGain, hatGain]) {
        try {
          g.disconnect();
        } catch {
          /* ignore */
        }
      }
    },
  };

  return api;
}
