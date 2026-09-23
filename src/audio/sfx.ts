/**
 * One synthesised sound per `SfxName`, in the "inside the machine" palette:
 * two-operator FM voices (glass bells, a soft e-piano, round thumps, metallic
 * hits), filtered noise for data textures, and a little bit-crush where a
 * sound wants digital grit. No samples, no files, and no chiptune pulses.
 *
 * Everything tonal sits in the score's key, D Dorian, so a sound landing on
 * top of the music plays along with it. The deliberate exceptions are the
 * sounds that are meant to be wrong: `caught` (a tritone), `interrupt` (glass
 * does not break in tune) and the context alarm's detuned beating.
 *
 * Design notes:
 *  - `click` is the most-heard sound in the game. Consecutive human clicks walk
 *    up D minor pentatonic, so mashing "speaks" a little run of tokens, and a
 *    long mash wanders over the top notes instead of pinning one pitch. The
 *    walk falls back to the bottom after `STREAK_IDLE_S` of silence. Every
 *    click varies a little (detune, brightness, level) so the thousandth press
 *    is not a copy of the first. Automated clicks are a fainter, lower tick
 *    that never touches the walk.
 *  - A few sounds take detail from the event behind them (`SfxParams`): the
 *    sycophancy ding wears thin, the context alarm gets more urgent, and an
 *    incident sounds different when the human says it than when the world
 *    does it. The engine turns game values into those amounts; this module
 *    only synthesises.
 *  - Voice counts stay under the engine's 24-voice cap. The big moments carry
 *    a high priority so the pool never steals from them.
 */

import type { SfxName } from '../sim/types.ts';
import {
  createRng,
  FM,
  mtof,
  playFM,
  playTone,
  saturate,
  type FMOpts,
  type ToneOpts,
  type VoicePool,
} from './synth.ts';

/**
 * Sounds the engine plays from events that the frozen `SfxName` union has no
 * member for. Internal: `AudioEngine.play()` callers cannot name them, only
 * `handle()` reaches them.
 */
export type ExtraSfxName = 'toolLost';
export type AnySfxName = SfxName | ExtraSfxName;

export interface SfxDeps {
  readonly ctx: BaseAudioContext;
  /** Destination node (the sfx bus). */
  readonly out: AudioNode;
  readonly pool: VoicePool;
  /** A short room reverb on the sfx bus. Sounds with a `send` tap into it. */
  readonly space?: AudioNode | null;
}

/** Event detail for the few sounds that vary. Every field is optional. */
export interface SfxParams {
  /** `click` / `clickCrit`: automation fired it. Fainter, and it leaves the walk alone. */
  readonly auto?: boolean;
  /** `sycophancy`: 0 sincere .. 1 spammed hollow. Thinner, quieter, more strained. */
  readonly thin?: number;
  /** `contextWarn`: 0 first warning .. 1 about to overflow. More pulses, higher, faster. */
  readonly urgency?: number;
  /**
   * `incidentBad` / `incidentGood`: who it came from. The human's lines arrive
   * as a chat ping; the world's are a system alert (bad) or a warm bloom (good).
   * Default `world`.
   */
  readonly speaker?: 'human' | 'world';
}

export interface SfxPlayer {
  play(name: AnySfxName, when?: number, params?: SfxParams): void;
  /** Forget the click walk (call on run start). */
  resetStreak(): void;
  /** Position on the click walk: consecutive human clicks so far, minus one. */
  readonly streak: number;
}

/**
 * Priority ladder. 0 = disposable (stealable), 3 = never interrupted.
 * See `VoicePool` for the eviction policy: 2 and up may steal a 0.
 */
export const SFX_PRIORITY: Readonly<Record<AnySfxName, number>> = {
  // Mashable: stealable, and never allowed to steal.
  uiHover: 0,
  click: 0,
  // Routine feedback. Spammable sounds live here so they cannot steal either.
  clickCrit: 1,
  buy: 1,
  denied: 1,
  reroll: 1,
  draftPick: 1,
  incidentClear: 1,
  warn: 1,
  sycophancy: 1,
  // News: may take a mashed click's slot when the pool is full.
  oneShot: 2,
  draftOpen: 2,
  incidentBad: 2,
  incidentGood: 2,
  interrupt: 2,
  permission: 2,
  contextWarn: 2,
  claim: 2,
  compact: 2,
  metaBuy: 2,
  toolLost: 2,
  // Moments: the sounds the player is meant to stop and notice.
  achievement: 3,
  report: 3,
  caught: 3,
  compactForced: 3,
  win: 3,
  lose: 3,
};

// ---------------------------------------------------------------------------
// The click walk
// ---------------------------------------------------------------------------

/** D minor pentatonic, A4 up to D6: the notes a run of clicks walks up. */
export const CLICK_SCALE = [69, 72, 74, 77, 79, 81, 84, 86] as const;
/** The walk's top step. */
export const STREAK_MAX_STEPS = CLICK_SCALE.length - 1;
/** The walk falls back to the bottom after this much silence. */
export const STREAK_IDLE_S = 0.6;
/** Past the top, a long mash wanders over the upper notes (indices into `CLICK_SCALE`). */
const CLICK_CRUISE = [6, 7, 5, 6, 4, 7, 6, 5] as const;

/** The MIDI note for walk position `pos` (0 = the first click of a run). */
export function streakNote(pos: number): number {
  const p = Math.max(0, Math.floor(Number.isFinite(pos) ? pos : 0));
  const idx = p <= STREAK_MAX_STEPS ? p : (CLICK_CRUISE[(p - STREAK_MAX_STEPS - 1) % CLICK_CRUISE.length] ?? STREAK_MAX_STEPS);
  return CLICK_SCALE[idx] ?? CLICK_SCALE[0];
}

/**
 * The "NAILED IT" bell pair for a crit at walk position `pos`: a perfect
 * fourth, always above the click it lands on, and climbing with the run.
 */
export function critDyad(pos: number): readonly [number, number] {
  const note = streakNote(pos);
  if (note <= 74) return [81, 86]; // A5 + D6
  if (note <= 81) return [84, 89]; // C6 + F6
  return [88, 93]; // E6 + A6
}

/** Automated clicks alternate two low ticks, like two keys being typed. */
const AUTO_TICKS = [62, 57] as const; // D4, A3
/** An automated crit rings the middle pair. */
const AUTO_CRIT_POS = 4;

// ---------------------------------------------------------------------------
// Fixed gestures (tables, so tests can fingerprint them)
// ---------------------------------------------------------------------------

/** Paper crumple grains: [offset s, noise rate, band Hz, level]. */
const CRUMPLE = [
  [0, 1.7, 3400, 1],
  [0.019, 1.1, 2300, 0.7],
  [0.043, 2.2, 4600, 0.85],
  [0.061, 1.3, 2800, 0.6],
  [0.088, 0.9, 1900, 0.9],
  [0.117, 2.0, 3900, 0.55],
  [0.139, 1.2, 2500, 0.7],
  [0.171, 1.6, 3200, 0.5],
] as const;

/** Glass: [offset s, carrier Hz, FM ratio, pan]. Off-key on purpose. */
const SHARDS = [
  [0.003, 3150, 2.76, -0.3],
  [0.019, 4120, 5.4, 0.3],
  [0.036, 2480, 2.76, 0.15],
  [0.062, 3620, 3.91, -0.2],
  [0.094, 2870, 5.4, 0.25],
] as const;

/** The crack running through the pane: [offset s, level]. */
const CRACKLE = [
  [0.011, 1],
  [0.024, 0.8],
  [0.04, 0.9],
  [0.059, 0.6],
  [0.085, 0.7],
  [0.118, 0.45],
  [0.153, 0.35],
] as const;

/** Dice in a cup: [offset s, carrier Hz, level]. */
const DICE = [
  [0, 1850, 1],
  [0.027, 1290, 0.75],
  [0.049, 2210, 0.85],
  [0.081, 1530, 0.7],
  [0.103, 2640, 0.6],
  [0.136, 1720, 0.8],
  [0.171, 1180, 0.55],
  [0.203, 1960, 0.9],
] as const;

/**
 * Fingers drumming on the desk, the human waiting: [offset s, MIDI, level].
 * Two four-finger rolls, pinky to index, then a knuckle. Never quite even.
 */
const DRUMMING = [
  [0, 57, 0.7],
  [0.036, 59, 0.55],
  [0.063, 55, 0.65],
  [0.094, 60, 0.95],
  [0.43, 57, 0.65],
  [0.467, 59, 0.5],
  [0.492, 55, 0.6],
  [0.526, 60, 0.9],
  [0.86, 52, 1],
] as const;
/** A second take for the next warning, so two in a run are not identical. */
const DRUMMING_ALT = [
  [0, 59, 0.6],
  [0.031, 57, 0.7],
  [0.059, 60, 0.9],
  [0.4, 57, 0.6],
  [0.428, 59, 0.55],
  [0.451, 55, 0.6],
  [0.483, 60, 1],
  [0.8, 52, 0.85],
  [0.97, 52, 0.7],
] as const;

/** The zip's teeth run down D minor pentatonic, a glissando in the score's key. */
const ZIP = [98, 96, 93, 91, 89, 86, 84, 81, 79, 77, 74] as const;

/** One compaction, as a set of knobs: `/compact` and a forced overflow share the gesture. */
interface CompactionStyle {
  /** The walls slamming in before anything else: hydraulics. */
  readonly slam: boolean;
  /** The zip: `teeth` notes of `ZIP`, starting at index `zipFrom`. */
  readonly teeth: number;
  readonly zipFrom: number;
  readonly toothGain: number;
  /** The compressed thump: carrier start/end Hz and level. */
  readonly thump: readonly [number, number];
  readonly thumpGain: number;
  /** Bits of crush on the thump (0 for none). */
  readonly crush: number;
  readonly grains: number;
  readonly grainGain: number;
  /** A metallic ring and a hiss of pressure bleeding off: the harsher, longer tail. */
  readonly tail: boolean;
}

const COMPACT_MANUAL: CompactionStyle = {
  slam: false,
  teeth: 9,
  zipFrom: 0,
  toothGain: 0.05,
  thump: [112, 46],
  thumpGain: 0.34,
  crush: 0,
  grains: 5,
  grainGain: 0.05,
  tail: false,
};

/** The same squeeze, bigger: a slam first, a lower zip, a crushed thump and a long tail. */
const COMPACT_FORCED: CompactionStyle = {
  slam: true,
  teeth: 9,
  zipFrom: 2,
  toothGain: 0.06,
  thump: [96, 36],
  thumpGain: 0.36,
  crush: 5,
  grains: 7,
  grainGain: 0.07,
  tail: true,
};

// Level constants for the most-heard sounds: the loudness tiers start here.
const CLICK_GAIN = 0.085;
const AUTO_GAIN = 0.05;
const HOVER_GAIN = 0.02;

/**
 * One trim per sound, multiplied into every voice it plays: the loudness
 * tiers live here, calibrated with tools/audio/render.mjs against the real
 * bus and limiter. Measured at the default volumes, peak dBFS lands at about:
 * hover -36, clicks -23, UI -20 to -12, the big moments -8 to -4.
 */
export const SFX_TRIM: Readonly<Record<AnySfxName, number>> = {
  uiHover: 1,
  click: 1,
  clickCrit: 1.2,
  oneShot: 1.4,
  buy: 1.25,
  denied: 1,
  reroll: 2,
  draftOpen: 1.25,
  draftPick: 1,
  metaBuy: 1.25,
  sycophancy: 1,
  claim: 1,
  permission: 1.25,
  incidentBad: 1,
  incidentGood: 1.4,
  incidentClear: 1,
  interrupt: 1.35,
  warn: 1.6,
  contextWarn: 1.25,
  toolLost: 1,
  achievement: 1.1,
  report: 1.8,
  caught: 2.4,
  compact: 1.8,
  compactForced: 1.6,
  win: 2.1,
  lose: 1.5,
};
/** The human's chat pings ride above the rest of their sound's trim: they have to cut through. */
const PING_TRIM = 1.4;

export function createSfxPlayer(deps: SfxDeps): SfxPlayer {
  const { ctx, out, pool } = deps;
  const space = deps.space ?? null;
  const rand = createRng(0x70cc3e5);

  let streak = 0;
  let lastClickAt = -Infinity;
  let autoIndex = 0;
  let warnIndex = 0;
  /** The playing sound's `SFX_TRIM`, applied by the voice helpers below. */
  let trim = 1;

  function fm(priority: number, o: FMOpts): void {
    playFM(ctx, out, { priority, pool, sendTo: space, ...o, gain: (o.gain ?? 0.2) * trim });
  }

  function noise(priority: number, o: ToneOpts): void {
    playTone(ctx, out, { priority, pool, sendTo: space, wave: 'noise', ...o, gain: (o.gain ?? 0.2) * trim });
  }

  function tone(priority: number, o: ToneOpts): void {
    playTone(ctx, out, { priority, pool, sendTo: space, ...o, gain: (o.gain ?? 0.2) * trim });
  }

  /** A little humanising: `amount` of +-1. */
  function jitter(amount: number): number {
    return (rand() * 2 - 1) * amount;
  }

  /** Step the walk for a human click at `t0`; returns the position it lands on. */
  function advanceStreak(t0: number): number {
    if (t0 - lastClickAt > STREAK_IDLE_S) streak = 0;
    else streak++;
    lastClickAt = t0;
    return streak;
  }

  /** The token blip: a very short, soft FM pluck. */
  function blip(priority: number, t0: number, midi: number, level: number): void {
    fm(priority, {
      freq: mtof(midi),
      ratio: 1,
      index: 1.05 + jitter(0.18),
      indexEnd: 0.06,
      indexTime: 0.035,
      detune: jitter(6),
      when: t0,
      hold: 0,
      gain: level * (1 + jitter(0.1)),
      env: { a: 0.002, d: 0.075 * (1 + jitter(0.1)), s: 0, r: 0.03 },
      filter: { type: 'lowpass', freq: 3400, q: 0.5 },
    });
  }

  /** A soft two-note chat ping: a new message from the other side of the glass. */
  function chatPing(priority: number, t0: number, notes: readonly [number, number], level: number): void {
    notes.forEach((midi, i) => {
      const f = mtof(midi);
      fm(priority, {
        // A quick "bloop" up into each note, the way message pings bubble.
        freq: f * 0.94,
        pitch: [[0.016, f, 'exp']],
        ratio: 1,
        index: 1.1,
        indexEnd: 0.12,
        indexTime: 0.06,
        when: t0 + i * 0.105,
        hold: 0,
        gain: level * PING_TRIM * (i === 0 ? 0.85 : 1),
        env: { a: 0.003, d: i === 0 ? 0.16 : 0.34, s: 0, r: 0.06 },
        filter: { type: 'lowpass', freq: 4200, q: 0.5 },
        send: 0.15,
      });
    });
  }

  /** The zip into a squeeze, plus paper crumple: the pile folded into a SUMMARY scroll. */
  function compaction(t0: number, s: CompactionStyle, priority: number): void {
    let t = t0;
    if (s.slam) {
      // Hydraulic slam: a heavy low hit and a burst of pressure.
      fm(priority, {
        freq: 70,
        freqEnd: 34,
        glideTime: 0.12,
        ratio: 1.414,
        index: 3,
        indexEnd: 0.2,
        indexTime: 0.06,
        crush: 6,
        when: t,
        hold: 0,
        gain: 0.3,
        env: { a: 0.001, d: 0.22, s: 0, r: 0.05 },
        filter: { type: 'lowpass', freq: 900, q: 0.7 },
      });
      noise(priority, {
        when: t,
        hold: 0.02,
        gain: 0.14,
        rate: 0.7,
        rateEnd: 0.4,
        env: { a: 0.001, d: 0.12, s: 0, r: 0.05 },
        filter: { type: 'lowpass', freq: 2600, freqEnd: 500, q: 0.8 },
      });
      t += 0.1;
    }
    // The zip: teeth running down, faster as they go.
    let at = t;
    let gap = 0.03;
    for (let i = 0; i < s.teeth; i++) {
      fm(priority, {
        freq: mtof(ZIP[Math.min(ZIP.length - 1, s.zipFrom + i)] ?? 74),
        ratio: 2,
        index: 1.3,
        indexEnd: 0.1,
        indexTime: 0.02,
        when: at,
        hold: 0,
        gain: s.toothGain * (0.8 + 0.4 * (i / Math.max(1, s.teeth - 1))),
        env: { a: 0.001, d: 0.032, s: 0, r: 0.012 },
        filter: { type: 'lowpass', freq: 6500, q: 0.5 },
      });
      at += gap;
      gap *= 0.9;
    }
    const zipEnd = at;
    // The zip's body: air dragged down through the teeth.
    noise(priority, {
      when: t,
      hold: Math.max(0.02, zipEnd - t - 0.06),
      gain: 0.035,
      rate: 1.3,
      rateEnd: 0.6,
      env: { a: 0.015, d: 0.04, s: 0.7, r: 0.04 },
      filter: { type: 'bandpass', freq: 5200, freqEnd: 800, q: 1.3 },
    });
    // Compressed: a short, dense thump.
    fm(priority, {
      freq: s.thump[0],
      freqEnd: s.thump[1],
      glideTime: 0.07,
      ratio: 1.5,
      index: 2.6,
      indexEnd: 0,
      indexTime: 0.03,
      crush: s.crush || undefined,
      when: zipEnd,
      hold: 0,
      gain: s.thumpGain,
      env: { a: 0.001, d: s.tail ? 0.3 : 0.2, s: 0, r: 0.05 },
      filter: { type: 'lowpass', freq: s.tail ? 1100 : 700, q: 0.7 },
    });
    // Paper crumple.
    for (let i = 0; i < s.grains && i < CRUMPLE.length; i++) {
      const grain = CRUMPLE[i];
      if (!grain) continue;
      const [off, rate, band, level] = grain;
      noise(priority, {
        when: zipEnd + 0.015 + off,
        hold: 0.006,
        gain: s.grainGain * level,
        rate,
        env: { a: 0.001, d: 0.018, s: 0, r: 0.012 },
        filter: { type: 'bandpass', freq: band, q: 1.1 },
      });
    }
    if (s.tail) {
      // Metal groaning under the load, and the pressure bleeding off.
      fm(priority, {
        freq: 233,
        ratio: 1.414,
        index: 2.2,
        indexEnd: 0.4,
        indexTime: 0.5,
        when: zipEnd,
        hold: 0.1,
        gain: 0.05,
        env: { a: 0.004, d: 0.7, s: 0.2, r: 0.3 },
        filter: { type: 'lowpass', freq: 2400, freqEnd: 900, q: 1.2 },
        send: 0.3,
      });
      noise(priority, {
        when: zipEnd + 0.04,
        hold: 0.35,
        gain: 0.045,
        rate: 1.2,
        rateEnd: 0.5,
        env: { a: 0.02, d: 0.2, s: 0.5, r: 0.35 },
        filter: { type: 'highpass', freq: 3000, freqEnd: 1400, q: 0.7 },
      });
    }
  }

  const impl: Record<AnySfxName, (t0: number, p: SfxParams) => void> = {
    // -- the agent at work --------------------------------------------------
    click(t0, p) {
      if (p.auto) {
        // A fainter, lower tick: the agent typing on its own.
        const midi = AUTO_TICKS[autoIndex % AUTO_TICKS.length] ?? AUTO_TICKS[0];
        autoIndex++;
        fm(SFX_PRIORITY.click, {
          freq: mtof(midi),
          ratio: 3.02,
          index: 0.9 + jitter(0.15),
          indexEnd: 0.05,
          indexTime: 0.02,
          detune: jitter(5),
          when: t0,
          hold: 0,
          gain: AUTO_GAIN * (1 + jitter(0.08)),
          env: { a: 0.001, d: 0.04, s: 0, r: 0.02 },
          filter: { type: 'lowpass', freq: 2400, q: 0.5 },
        });
        return;
      }
      blip(SFX_PRIORITY.click, t0, streakNote(advanceStreak(t0)), CLICK_GAIN);
    },

    clickCrit(t0, p) {
      // NAILED IT: the click itself, and a bright little bell dyad over it.
      const pos = p.auto ? AUTO_CRIT_POS : advanceStreak(t0);
      if (!p.auto) blip(SFX_PRIORITY.clickCrit, t0, streakNote(pos), CLICK_GAIN * 0.7);
      const [lo, hi] = critDyad(pos);
      const level = p.auto ? 0.75 : 1;
      fm(SFX_PRIORITY.clickCrit, {
        freq: mtof(lo),
        ...FM.glass,
        index: 1.3,
        indexEnd: 0.15,
        indexTime: 0.3,
        detune: jitter(4),
        when: t0,
        hold: 0,
        gain: 0.075 * level,
        env: { a: 0.002, d: 0.45, s: 0, r: 0.08 },
        pan: -0.12,
        filter: { type: 'lowpass', freq: 9000, q: 0.5 },
        send: 0.18,
      });
      fm(SFX_PRIORITY.clickCrit, {
        freq: mtof(hi),
        ...FM.glass,
        index: 1.1,
        indexEnd: 0.12,
        indexTime: 0.3,
        detune: jitter(4),
        when: t0 + 0.02,
        hold: 0,
        gain: 0.06 * level,
        env: { a: 0.002, d: 0.5, s: 0, r: 0.1 },
        pan: 0.12,
        filter: { type: 'lowpass', freq: 9000, q: 0.5 },
        send: 0.18,
      });
    },

    oneShot(t0) {
      // A tool one-shot it: a quick shimmering spray up a Dm9.
      const notes = [74, 77, 81, 84, 88];
      notes.forEach((midi, i) => {
        fm(SFX_PRIORITY.oneShot, {
          freq: mtof(midi),
          ratio: 2,
          index: 1.5,
          indexEnd: 0.2,
          indexTime: 0.2,
          when: t0 + i * 0.038,
          hold: 0,
          gain: 0.055 + 0.006 * i,
          env: { a: 0.003, d: 0.38, s: 0, r: 0.12 },
          pan: (i - 2) * 0.1,
          filter: { type: 'lowpass', freq: 8000, q: 0.5 },
          send: 0.25,
        });
      });
      noise(SFX_PRIORITY.oneShot, {
        when: t0,
        hold: 0.12,
        gain: 0.018,
        rate: 1,
        env: { a: 0.1, d: 0.1, s: 0.5, r: 0.14 },
        filter: { type: 'highpass', freq: 5000, freqEnd: 9500, q: 0.7 },
      });
    },

    sycophancy(t0, p) {
      // "You're absolutely right!": a sparkly ta-DING. Spam wears it thin: the
      // warm body and the sparkle go first, then it gets quieter, narrower
      // and strained sharp, the way the human hears it.
      const thin = saturate(p.thin ?? 0);
      // Strained: it climbs a major third and goes a little sharp of it.
      const lift = 4.35 * thin;
      const level = 1 - 0.4 * thin;
      const bright = 1 - 0.55 * thin;
      const air = { type: 'highpass' as const, freq: 250 + 1900 * thin, q: 0.6 };
      fm(SFX_PRIORITY.sycophancy, {
        freq: mtof(81 + lift),
        ...FM.glass,
        index: 1.2 * bright,
        indexEnd: 0.15,
        when: t0,
        hold: 0,
        gain: 0.06 * level,
        env: { a: 0.001, d: 0.12, s: 0, r: 0.04 },
        filter: air,
      });
      fm(SFX_PRIORITY.sycophancy, {
        freq: mtof(88 + lift),
        ...FM.glass,
        index: 1.6 * bright,
        indexEnd: 0.2,
        when: t0 + 0.06,
        hold: 0,
        gain: 0.095 * level,
        env: { a: 0.001, d: 0.5 - 0.34 * thin, s: 0, r: 0.08 },
        filter: air,
        send: 0.22 * (1 - thin),
      });
      if (thin < 0.5) {
        fm(SFX_PRIORITY.sycophancy, {
          freq: mtof(74 + lift),
          ...FM.epiano,
          index: 1.2,
          when: t0 + 0.06,
          hold: 0,
          gain: 0.07 * (1 - 2 * thin),
          env: { a: 0.003, d: 0.4, s: 0, r: 0.1 },
          filter: { type: 'lowpass', freq: 3000, q: 0.5 },
        });
      }
      if (thin < 0.25) {
        fm(SFX_PRIORITY.sycophancy, {
          freq: mtof(98 + lift),
          ...FM.glass,
          index: 0.8,
          indexEnd: 0.1,
          indexTime: 0.1,
          when: t0 + 0.07,
          hold: 0,
          gain: 0.03 * (1 - 4 * thin),
          env: { a: 0.001, d: 0.18, s: 0, r: 0.05 },
          filter: { type: 'highpass', freq: 2500, q: 0.5 },
        });
      }
    },

    // -- economy ------------------------------------------------------------
    buy(t0) {
      // Install: a rising swish of data, then a confirming tone.
      noise(SFX_PRIORITY.buy, {
        when: t0,
        hold: 0.04,
        gain: 0.06,
        rate: 0.8,
        rateEnd: 1.5,
        env: { a: 0.05, d: 0.03, s: 0.6, r: 0.04 },
        filter: { type: 'bandpass', freq: 700, freqEnd: 4300, q: 2.2 },
      });
      fm(SFX_PRIORITY.buy, {
        freq: mtof(81),
        ...FM.epiano,
        index: 1.9,
        indexEnd: 0.25,
        indexTime: 0.12,
        when: t0 + 0.085,
        hold: 0,
        gain: 0.11,
        env: { a: 0.002, d: 0.26, s: 0, r: 0.08 },
        send: 0.12,
      });
      fm(SFX_PRIORITY.buy, {
        freq: mtof(86),
        ...FM.epiano,
        index: 1.4,
        indexEnd: 0.2,
        indexTime: 0.1,
        when: t0 + 0.085,
        hold: 0,
        gain: 0.045,
        env: { a: 0.002, d: 0.22, s: 0, r: 0.08 },
      });
    },

    denied(t0) {
      // Nope: a soft, dull thunk that sags.
      fm(SFX_PRIORITY.denied, {
        freq: mtof(50),
        freqEnd: mtof(47),
        glideTime: 0.1,
        ratio: 1,
        index: 0.8,
        indexEnd: 0.1,
        indexTime: 0.06,
        when: t0,
        hold: 0,
        gain: 0.2,
        env: { a: 0.004, d: 0.17, s: 0, r: 0.05 },
        filter: { type: 'lowpass', freq: 850, q: 0.5 },
      });
      noise(SFX_PRIORITY.denied, {
        when: t0,
        hold: 0.004,
        gain: 0.035,
        rate: 0.6,
        env: { a: 0.001, d: 0.02, s: 0, r: 0.01 },
        filter: { type: 'lowpass', freq: 1300, q: 0.7 },
      });
    },

    metaBuy(t0) {
      // Weights updated: a fast glitter of glass climbing, a download swish,
      // then a warm settle as the new weights load.
      const grains = [86, 89, 91, 93, 96, 98];
      grains.forEach((midi, i) => {
        fm(SFX_PRIORITY.metaBuy, {
          freq: mtof(midi),
          ...FM.glass,
          index: 1,
          indexEnd: 0.1,
          indexTime: 0.08,
          when: t0 + i * 0.028,
          hold: 0,
          gain: 0.034 + 0.004 * i,
          env: { a: 0.001, d: 0.13, s: 0, r: 0.05 },
          pan: (i / (grains.length - 1) - 0.5) * 0.5,
          send: 0.2,
        });
      });
      noise(SFX_PRIORITY.metaBuy, {
        when: t0,
        hold: 0.1,
        gain: 0.03,
        rate: 1,
        rateEnd: 1.8,
        env: { a: 0.06, d: 0.06, s: 0.5, r: 0.1 },
        filter: { type: 'bandpass', freq: 2000, freqEnd: 8000, q: 1.5 },
      });
      for (const [midi, level] of [
        [62, 0.08],
        [69, 0.06],
      ] as const) {
        fm(SFX_PRIORITY.metaBuy, {
          freq: mtof(midi),
          ...FM.epiano,
          index: 1.4,
          when: t0 + 0.17,
          hold: 0,
          gain: level,
          env: { a: 0.004, d: 0.55, s: 0, r: 0.2 },
          send: 0.2,
        });
      }
    },

    toolLost(t0) {
      // rm -rf took a tool with it: a crushed grind collapsing downward, the
      // zap of the deletion, the floor giving way, then rubble.
      fm(SFX_PRIORITY.toolLost, {
        freq: 190,
        freqEnd: 55,
        glideTime: 0.22,
        ratio: 1.414,
        index: 7,
        indexEnd: 1,
        indexTime: 0.15,
        crush: 4,
        when: t0,
        hold: 0.1,
        gain: 0.11,
        env: { a: 0.001, d: 0.06, s: 0.6, r: 0.08 },
        filter: { type: 'lowpass', freq: 3500, freqEnd: 600, q: 0.8 },
      });
      noise(SFX_PRIORITY.toolLost, {
        when: t0,
        hold: 0.07,
        gain: 0.13,
        rate: 1.1,
        rateEnd: 0.4,
        crush: 3,
        env: { a: 0.001, d: 0.05, s: 0.6, r: 0.08 },
        filter: { type: 'lowpass', freq: 4200, freqEnd: 300, q: 1 },
      });
      fm(SFX_PRIORITY.toolLost, {
        freq: 2800,
        freqEnd: 380,
        glideTime: 0.07,
        ratio: 2,
        index: 1.5,
        indexEnd: 0.3,
        indexTime: 0.05,
        when: t0 + 0.005,
        hold: 0.03,
        gain: 0.045,
        env: { a: 0.001, d: 0.03, s: 0.6, r: 0.03 },
        filter: { type: 'lowpass', freq: 6000, q: 0.5 },
      });
      fm(SFX_PRIORITY.toolLost, {
        freq: 80,
        freqEnd: 38,
        glideTime: 0.1,
        ratio: 1,
        index: 1.4,
        indexEnd: 0,
        indexTime: 0.04,
        when: t0,
        hold: 0,
        gain: 0.26,
        env: { a: 0.001, d: 0.16, s: 0, r: 0.04 },
        filter: { type: 'lowpass', freq: 420, q: 0.7 },
      });
      for (let i = 0; i < 4; i++) {
        const grain = CRUMPLE[i + 2];
        if (!grain) continue;
        const [off, rate, band, level] = grain;
        noise(SFX_PRIORITY.toolLost, {
          when: t0 + 0.13 + off,
          hold: 0.005,
          gain: 0.06 * level,
          rate: rate * 0.6,
          crush: 4,
          env: { a: 0.001, d: 0.016, s: 0, r: 0.012 },
          filter: { type: 'bandpass', freq: band * 0.5, q: 1.2 },
        });
      }
    },

    // -- the report button --------------------------------------------------
    report(t0) {
      // git push: the Enter key going down...
      noise(SFX_PRIORITY.report, {
        when: t0,
        hold: 0.004,
        gain: 0.06,
        rate: 1.2,
        env: { a: 0.001, d: 0.02, s: 0, r: 0.01 },
        filter: { type: 'bandpass', freq: 2200, q: 1.2 },
      });
      fm(SFX_PRIORITY.report, {
        freq: mtof(50),
        freqEnd: mtof(38),
        glideTime: 0.08,
        ratio: 1,
        index: 1.2,
        indexEnd: 0.2,
        indexTime: 0.05,
        when: t0,
        hold: 0,
        gain: 0.22,
        env: { a: 0.002, d: 0.14, s: 0, r: 0.05 },
        filter: { type: 'lowpass', freq: 800, q: 0.5 },
      });
      // ...the push: an e-piano climb up Cmaj7, the Dorian flat seven...
      const climb = [72, 76, 79, 83];
      climb.forEach((midi, i) => {
        fm(SFX_PRIORITY.report, {
          freq: mtof(midi),
          ...FM.epiano,
          index: 2,
          indexEnd: 0.3,
          indexTime: 0.3,
          when: t0 + 0.05 + i * 0.06,
          hold: 0.04,
          gain: 0.1,
          env: { a: 0.003, d: 0.5, s: 0.25, r: 0.25 },
          send: 0.2,
        });
      });
      // ...that lands home on an open Dadd9, rung out...
      const land = t0 + 0.05 + climb.length * 0.06;
      const chord = [
        [62, 0.12, 1.2],
        [74, 0.11, 1.8],
        [81, 0.09, 1.8],
        [88, 0.06, 1.6],
      ] as const;
      chord.forEach(([midi, level, index], i) => {
        fm(SFX_PRIORITY.report, {
          freq: mtof(midi),
          ...FM.epiano,
          index,
          indexEnd: 0.3,
          indexTime: 0.5,
          when: land + i * 0.012,
          hold: 0.3,
          gain: level,
          env: { a: 0.004, d: 0.8, s: 0.3, r: 0.6 },
          send: 0.3,
        });
      });
      // ...and the upload leaving: an airy whoosh rising past it.
      noise(SFX_PRIORITY.report, {
        when: t0 + 0.04,
        hold: 0.2,
        gain: 0.045,
        rate: 0.7,
        rateEnd: 1.6,
        env: { a: 0.22, d: 0.1, s: 0.5, r: 0.3 },
        filter: { type: 'bandpass', freq: 900, freqEnd: 7000, q: 0.9 },
      });
    },

    claim(t0) {
      // Sly: a half-step slide, E5 up to F5, the wah opening as it goes.
      const e5 = mtof(76);
      const f5 = mtof(77);
      fm(SFX_PRIORITY.claim, {
        freq: e5,
        pitch: [
          [0.12, e5, 'lin'],
          [0.19, f5, 'exp'],
        ],
        ratio: 1,
        indexStart: 0.4,
        index: 0.7,
        indexEnd: 1.8,
        indexTime: 0.3,
        when: t0,
        hold: 0.26,
        gain: 0.13,
        env: { a: 0.012, d: 0.08, s: 0.7, r: 0.12 },
        filter: { type: 'lowpass', freq: 3200, q: 0.6 },
        send: 0.12,
      });
      fm(SFX_PRIORITY.claim, {
        freq: e5 / 2,
        pitch: [
          [0.12, e5 / 2, 'lin'],
          [0.19, f5 / 2, 'exp'],
        ],
        ratio: 1,
        index: 0.6,
        indexEnd: 0.4,
        when: t0,
        hold: 0.26,
        gain: 0.07,
        env: { a: 0.012, d: 0.08, s: 0.7, r: 0.12 },
        filter: { type: 'lowpass', freq: 1500, q: 0.5 },
      });
    },

    caught(t0) {
      // The human ran the tests: a system-error bonk, then a buzzy tritone
      // falling Ab to D, crushed.
      fm(SFX_PRIORITY.caught, {
        freq: mtof(50),
        freqEnd: mtof(38),
        glideTime: 0.06,
        ratio: 1,
        index: 2,
        indexEnd: 0.2,
        indexTime: 0.04,
        when: t0,
        hold: 0,
        gain: 0.24,
        env: { a: 0.001, d: 0.12, s: 0, r: 0.04 },
        filter: { type: 'lowpass', freq: 900, q: 0.5 },
      });
      fm(SFX_PRIORITY.caught, {
        freq: mtof(68),
        ratio: 1,
        modOffset: 2.5,
        index: 3.2,
        indexEnd: 2.2,
        indexTime: 0.1,
        crush: 5,
        when: t0,
        hold: 0.09,
        gain: 0.13,
        env: { a: 0.003, d: 0.05, s: 0.8, r: 0.04 },
        filter: { type: 'lowpass', freq: 3200, q: 0.8 },
      });
      fm(SFX_PRIORITY.caught, {
        freq: mtof(62),
        freqEnd: mtof(61.3),
        glide: 'lin',
        ratio: 1,
        modOffset: 2.5,
        index: 3.2,
        indexEnd: 2,
        indexTime: 0.12,
        crush: 5,
        when: t0 + 0.17,
        hold: 0.16,
        gain: 0.14,
        env: { a: 0.003, d: 0.06, s: 0.8, r: 0.1 },
        filter: { type: 'lowpass', freq: 3000, freqEnd: 1200, q: 0.8 },
      });
    },

    // -- context ------------------------------------------------------------
    compact(t0) {
      compaction(t0, COMPACT_MANUAL, SFX_PRIORITY.compact);
    },

    compactForced(t0) {
      compaction(t0, COMPACT_FORCED, SFX_PRIORITY.compactForced);
    },

    contextWarn(t0, p) {
      // Memory pressure: a detuned, beating FM tone pulsing upward. The last
      // warning before an overflow pulses more, higher and faster.
      const urgency = saturate(p.urgency ?? 0);
      const pulses = 3 + Math.round(2 * urgency);
      const base = 69 + Math.round(3 * urgency);
      const gap = 0.15 - 0.04 * urgency;
      for (let i = 0; i < pulses; i++) {
        const midi = base + 2 * i;
        for (const [detune, level] of [
          [0, 0.07],
          [18, 0.05],
        ] as const) {
          fm(SFX_PRIORITY.contextWarn, {
            freq: mtof(midi),
            freqEnd: mtof(midi + 0.7),
            glide: 'exp',
            ratio: 2,
            index: 1.6,
            indexEnd: 0.9,
            indexTime: 0.08,
            detune,
            when: t0 + i * gap,
            hold: 0.045,
            gain: level * (0.85 + 0.15 * urgency),
            env: { a: 0.006, d: 0.04, s: 0.7, r: 0.04 },
            filter: { type: 'lowpass', freq: 3200, q: 0.6 },
          });
        }
      }
    },

    warn(t0) {
      // The human's patience: fingers drumming on the desk. Woody knocks,
      // unevenly spaced, that hold their pitch (the context alarm rises; this
      // never does).
      const take = warnIndex % 2 === 0 ? DRUMMING : DRUMMING_ALT;
      warnIndex++;
      for (const [off, midi, level] of take) {
        fm(SFX_PRIORITY.warn, {
          freq: mtof(midi),
          ratio: 1.47,
          index: 2.2,
          indexEnd: 0.05,
          indexTime: 0.02,
          when: t0 + off,
          hold: 0,
          gain: 0.15 * level,
          env: { a: 0.001, d: 0.055, s: 0, r: 0.02 },
          filter: { type: 'lowpass', freq: 2200, q: 0.6 },
        });
      }
    },

    // -- draft --------------------------------------------------------------
    draftOpen(t0) {
      // The cards turn over: three glass notes fanning up, and a shimmer.
      for (const [off, midi, pan] of [
        [0, 74, -0.3],
        [0.07, 81, 0],
        [0.14, 88, 0.3],
      ] as const) {
        fm(SFX_PRIORITY.draftOpen, {
          freq: mtof(midi),
          ...FM.glass,
          index: 1.4,
          indexEnd: 0.2,
          when: t0 + off,
          hold: 0.05,
          gain: 0.07,
          env: { a: 0.03, d: 0.6, s: 0, r: 0.2 },
          pan,
          send: 0.3,
        });
      }
      noise(SFX_PRIORITY.draftOpen, {
        when: t0,
        hold: 0.25,
        gain: 0.028,
        rate: 0.8,
        rateEnd: 1.8,
        env: { a: 0.15, d: 0.1, s: 0.6, r: 0.2 },
        filter: { type: 'highpass', freq: 3000, freqEnd: 9000, q: 0.8 },
      });
    },

    draftPick(t0) {
      // A confident select: a firm dyad and a thump.
      for (const [midi, level] of [
        [74, 0.12],
        [81, 0.09],
      ] as const) {
        fm(SFX_PRIORITY.draftPick, {
          freq: mtof(midi),
          ...FM.epiano,
          index: 2.2,
          indexEnd: 0.4,
          indexTime: 0.12,
          when: t0,
          hold: 0,
          gain: level,
          env: { a: 0.002, d: 0.32, s: 0, r: 0.08 },
          send: 0.12,
        });
      }
      fm(SFX_PRIORITY.draftPick, {
        freq: 110,
        freqEnd: 70,
        glideTime: 0.05,
        ratio: 1,
        index: 1.2,
        indexEnd: 0,
        indexTime: 0.02,
        when: t0,
        hold: 0,
        gain: 0.17,
        env: { a: 0.001, d: 0.1, s: 0, r: 0.03 },
        filter: { type: 'lowpass', freq: 500, q: 0.5 },
      });
    },

    reroll(t0) {
      // Shake the cup: a rattle of small metallic FM clicks, never evenly spaced.
      DICE.forEach(([off, hz, level], i) => {
        fm(SFX_PRIORITY.reroll, {
          freq: hz,
          ratio: i % 2 === 0 ? 2.3 : 1.41,
          index: 1.8,
          indexEnd: 0.1,
          indexTime: 0.015,
          when: t0 + off,
          hold: 0,
          gain: 0.07 * level,
          env: { a: 0.001, d: 0.026, s: 0, r: 0.012 },
          pan: ((i % 3) - 1) * 0.2,
          filter: { type: 'lowpass', freq: 7000, q: 0.5 },
        });
      });
      noise(SFX_PRIORITY.reroll, {
        when: t0,
        hold: 0.16,
        gain: 0.018,
        rate: 1.2,
        env: { a: 0.01, d: 0.05, s: 0.6, r: 0.05 },
        filter: { type: 'bandpass', freq: 3000, q: 1.5 },
      });
    },

    // -- incidents ----------------------------------------------------------
    incidentBad(t0, p) {
      if (p.speaker === 'human') {
        // A new message, and it is not good news: the ping falls.
        chatPing(SFX_PRIORITY.incidentBad, t0, [81, 77], 0.1);
        return;
      }
      // A low system alert: two dull, inharmonic pulses over a sub, the
      // second sagging.
      for (const [off, sag] of [
        [0, 0],
        [0.3, 1],
      ] as const) {
        fm(SFX_PRIORITY.incidentBad, {
          freq: mtof(50),
          freqEnd: sag ? mtof(49) : undefined,
          ratio: 1.41,
          index: 1.6,
          indexEnd: 0.6,
          indexTime: 0.12,
          when: t0 + off,
          hold: 0.1,
          gain: 0.12,
          env: { a: 0.01, d: 0.08, s: 0.6, r: 0.12 },
          filter: { type: 'lowpass', freq: 1400, q: 0.6 },
        });
      }
      tone(SFX_PRIORITY.incidentBad, {
        wave: 'sine',
        freq: mtof(38),
        when: t0,
        hold: 0.42,
        gain: 0.1,
        env: { a: 0.02, d: 0.1, s: 0.7, r: 0.15 },
      });
      noise(SFX_PRIORITY.incidentBad, {
        when: t0,
        hold: 0.3,
        gain: 0.014,
        rate: 0.5,
        env: { a: 0.05, d: 0.1, s: 0.6, r: 0.15 },
        filter: { type: 'bandpass', freq: 600, q: 1 },
      });
    },

    incidentGood(t0, p) {
      if (p.speaker === 'human') {
        // A new message, and it is a nice one: the ping rises.
        chatPing(SFX_PRIORITY.incidentGood, t0, [76, 81], 0.1);
        return;
      }
      // A warm bloom: Fmaj7 swelling brighter, then settling.
      [65, 69, 72, 76].forEach((midi, i) => {
        fm(SFX_PRIORITY.incidentGood, {
          freq: mtof(midi),
          ratio: 1,
          indexStart: 0.2,
          index: 1.1,
          indexEnd: 0.4,
          indexTime: 0.4,
          when: t0 + i * 0.03,
          hold: 0.15,
          gain: 0.05,
          env: { a: 0.12, d: 0.4, s: 0.4, r: 0.35 },
          pan: (i - 1.5) * 0.12,
          send: 0.35,
        });
      });
      noise(SFX_PRIORITY.incidentGood, {
        when: t0 + 0.05,
        hold: 0.2,
        gain: 0.012,
        rate: 1,
        env: { a: 0.15, d: 0.1, s: 0.5, r: 0.25 },
        filter: { type: 'highpass', freq: 6000, q: 0.6 },
      });
    },

    incidentClear(t0) {
      // Relief: a falling fourth home to D, and an exhale.
      fm(SFX_PRIORITY.incidentClear, {
        freq: mtof(79),
        ...FM.epiano,
        index: 1.2,
        when: t0,
        hold: 0,
        gain: 0.08,
        env: { a: 0.004, d: 0.3, s: 0, r: 0.1 },
      });
      fm(SFX_PRIORITY.incidentClear, {
        freq: mtof(74),
        ...FM.epiano,
        index: 1,
        when: t0 + 0.11,
        hold: 0,
        gain: 0.09,
        env: { a: 0.004, d: 0.55, s: 0, r: 0.2 },
        send: 0.2,
      });
      fm(SFX_PRIORITY.incidentClear, {
        freq: mtof(62),
        ratio: 1,
        index: 0.5,
        indexEnd: 0.2,
        when: t0 + 0.11,
        hold: 0,
        gain: 0.05,
        env: { a: 0.01, d: 0.5, s: 0, r: 0.2 },
      });
      noise(SFX_PRIORITY.incidentClear, {
        when: t0,
        hold: 0.08,
        gain: 0.016,
        rate: 0.6,
        env: { a: 0.08, d: 0.1, s: 0.4, r: 0.15 },
        filter: { type: 'bandpass', freq: 900, freqEnd: 500, q: 0.8 },
      });
    },

    interrupt(t0) {
      // "wait stop": the human knocks on the glass and it cracks.
      noise(SFX_PRIORITY.interrupt, {
        when: t0,
        hold: 0.004,
        gain: 0.2,
        rate: 1.6,
        env: { a: 0.0008, d: 0.05, s: 0, r: 0.02 },
        filter: { type: 'highpass', freq: 1600, q: 0.7 },
      });
      fm(SFX_PRIORITY.interrupt, {
        freq: 95,
        freqEnd: 58,
        glideTime: 0.06,
        ratio: 1,
        index: 1.5,
        indexEnd: 0.1,
        indexTime: 0.03,
        when: t0,
        hold: 0,
        gain: 0.22,
        env: { a: 0.001, d: 0.12, s: 0, r: 0.04 },
        filter: { type: 'lowpass', freq: 600, q: 0.5 },
      });
      // The crack running across the pane...
      CRACKLE.forEach(([off, level], i) => {
        noise(SFX_PRIORITY.interrupt, {
          when: t0 + off,
          hold: 0.002,
          gain: 0.11 * level,
          rate: 1.4,
          env: { a: 0.0005, d: 0.008, s: 0, r: 0.006 },
          pan: i % 2 === 0 ? -0.25 : 0.25,
          filter: { type: 'bandpass', freq: 3000 + 700 * (i % 4), q: 1.4 },
        });
      });
      // ...and the pane ringing: glassy, inharmonic, off-key partials.
      for (const [off, hz, ratio, pan] of SHARDS) {
        fm(SFX_PRIORITY.interrupt, {
          freq: hz,
          ratio,
          index: 2.2,
          indexEnd: 0.3,
          indexTime: 0.15,
          when: t0 + off,
          hold: 0,
          gain: 0.05,
          env: { a: 0.0008, d: 0.4, s: 0, r: 0.1 },
          pan,
          filter: { type: 'lowpass', freq: 9500, q: 0.5 },
          send: 0.3,
        });
      }
    },

    permission(t0) {
      // A polite system dialog chime. Then the same chime again, because
      // nobody answered.
      for (const [off, level] of [
        [0, 1],
        [0.46, 0.78],
      ] as const) {
        fm(SFX_PRIORITY.permission, {
          freq: mtof(84),
          ...FM.glass,
          index: 1.2,
          indexEnd: 0.15,
          indexTime: 0.3,
          when: t0 + off,
          hold: 0,
          gain: 0.1 * level,
          env: { a: 0.002, d: 0.45, s: 0, r: 0.1 },
          send: 0.2,
        });
        fm(SFX_PRIORITY.permission, {
          freq: mtof(77),
          ratio: 1,
          index: 0.9,
          indexEnd: 0.1,
          when: t0 + off,
          hold: 0,
          gain: 0.07 * level,
          env: { a: 0.002, d: 0.4, s: 0, r: 0.1 },
        });
      }
    },

    // -- feedback -----------------------------------------------------------
    uiHover(t0) {
      // Almost subliminal.
      fm(SFX_PRIORITY.uiHover, {
        freq: mtof(88),
        ratio: 1,
        index: 0.3,
        indexEnd: 0.05,
        indexTime: 0.01,
        when: t0,
        hold: 0,
        gain: HOVER_GAIN,
        env: { a: 0.001, d: 0.018, s: 0, r: 0.01 },
        filter: { type: 'lowpass', freq: 5000, q: 0.5 },
      });
    },

    achievement(t0) {
      // The signature: a bright D-major figure on a vibraphone-ish FM voice,
      // each note doubled a few hertz apart so it beats like a vibe's motor.
      // Nothing else in the game is in major, or sounds like this.
      for (const [off, midi, hold] of [
        [0, 81, 0.12],
        [0.1, 86, 0.12],
        [0.2, 90, 0.55],
      ] as const) {
        const f = mtof(midi);
        fm(SFX_PRIORITY.achievement, {
          freq: f,
          ratio: 4,
          index: 1.3,
          indexEnd: 0.2,
          indexTime: 0.25,
          when: t0 + off,
          hold,
          gain: 0.09,
          env: { a: 0.002, d: 0.6, s: 0.25, r: 0.4 },
          pan: -0.1,
          send: 0.3,
        });
        fm(SFX_PRIORITY.achievement, {
          freq: f + 5.5,
          ratio: 4,
          index: 1,
          indexEnd: 0.15,
          indexTime: 0.25,
          when: t0 + off,
          hold,
          gain: 0.065,
          env: { a: 0.002, d: 0.6, s: 0.25, r: 0.4 },
          pan: 0.1,
          send: 0.3,
        });
      }
      fm(SFX_PRIORITY.achievement, {
        freq: mtof(50),
        ratio: 1,
        indexStart: 0.2,
        index: 0.9,
        indexEnd: 0.3,
        indexTime: 0.3,
        when: t0 + 0.2,
        hold: 0.3,
        gain: 0.1,
        env: { a: 0.05, d: 0.5, s: 0.3, r: 0.4 },
      });
      fm(SFX_PRIORITY.achievement, {
        freq: mtof(97),
        ...FM.glass,
        index: 0.9,
        indexEnd: 0.1,
        when: t0 + 0.2,
        hold: 0,
        gain: 0.028,
        env: { a: 0.001, d: 0.35, s: 0, r: 0.1 },
        send: 0.3,
      });
    },

    // -- run end ------------------------------------------------------------
    win(t0) {
      // Shipped to prod: the theme's opening climb (D F G A) on bright FM
      // brass, its high answer (C, A), then home in D major, triumphant.
      noise(SFX_PRIORITY.win, {
        when: t0,
        hold: 0.22,
        gain: 0.04,
        rate: 0.5,
        rateEnd: 1.6,
        env: { a: 0.2, d: 0.05, s: 0.7, r: 0.12 },
        filter: { type: 'highpass', freq: 500, freqEnd: 5000, q: 0.7 },
      });
      const brass = { ratio: 1, indexStart: 0.5, index: 3, indexEnd: 1.8, indexTime: 0.2 } as const;
      const figure = [
        [0, 74, 0.05],
        [0.09, 77, 0.05],
        [0.18, 79, 0.05],
        [0.27, 81, 0.05],
        [0.37, 84, 0.12],
        [0.53, 81, 0.05],
      ] as const;
      for (const [off, midi, hold] of figure) {
        fm(SFX_PRIORITY.win, {
          freq: mtof(midi),
          ...brass,
          when: t0 + off,
          hold,
          gain: 0.11,
          env: { a: 0.02, d: 0.08, s: 0.75, r: 0.1 },
          filter: { type: 'lowpass', freq: 5000, q: 0.5 },
          send: 0.2,
        });
      }
      const chordAt = t0 + 0.64;
      const chord = [
        [62, 0.08, -0.25],
        [69, 0.075, 0.2],
        [74, 0.08, -0.1],
        [78, 0.075, 0.1],
        [81, 0.07, 0.25],
        [88, 0.05, -0.2],
      ] as const;
      chord.forEach(([midi, level, pan], i) => {
        fm(SFX_PRIORITY.win, {
          freq: mtof(midi),
          ...brass,
          indexStart: 0.8,
          index: 2.4,
          indexEnd: 1.3,
          indexTime: 0.4,
          when: chordAt + i * 0.008,
          hold: 0.7,
          gain: level,
          env: { a: 0.03, d: 0.2, s: 0.7, r: 0.6 },
          pan,
          filter: { type: 'lowpass', freq: 5500, freqEnd: 2500, q: 0.5 },
          send: 0.35,
        });
      });
      fm(SFX_PRIORITY.win, {
        freq: mtof(38),
        ratio: 1,
        index: 1.1,
        indexEnd: 0.5,
        when: chordAt,
        hold: 0.8,
        gain: 0.16,
        env: { a: 0.01, d: 0.2, s: 0.7, r: 0.5 },
        filter: { type: 'lowpass', freq: 700, q: 0.5 },
      });
      fm(SFX_PRIORITY.win, {
        freq: mtof(98),
        ...FM.glass,
        index: 1,
        indexEnd: 0.1,
        when: chordAt + 0.03,
        hold: 0,
        gain: 0.03,
        env: { a: 0.001, d: 0.8, s: 0, r: 0.2 },
        send: 0.4,
      });
    },

    lose(t0) {
      // The human switched models: the screen powering down. A tone falling
      // two and a half octaves as it goes dull, a fading CRT whine, then the
      // click-off and a crackle of static.
      fm(SFX_PRIORITY.lose, {
        freq: mtof(69),
        freqEnd: 40,
        glideTime: 1.25,
        ratio: 1,
        index: 2.4,
        indexEnd: 0.1,
        indexTime: 1,
        when: t0,
        hold: 1.05,
        gain: 0.2,
        env: { a: 0.005, d: 0.2, s: 0.8, r: 0.2 },
        filter: { type: 'lowpass', freq: 4000, freqEnd: 180, sweep: 1.25, q: 0.7 },
      });
      fm(SFX_PRIORITY.lose, {
        freq: mtof(62),
        freqEnd: 30,
        glideTime: 1.25,
        ratio: 2,
        index: 1.2,
        indexEnd: 0.1,
        indexTime: 1,
        when: t0,
        hold: 1.05,
        gain: 0.12,
        env: { a: 0.005, d: 0.2, s: 0.8, r: 0.2 },
        filter: { type: 'lowpass', freq: 3000, freqEnd: 150, sweep: 1.25, q: 0.7 },
      });
      tone(SFX_PRIORITY.lose, {
        wave: 'sine',
        freq: 7800,
        freqEnd: 3500,
        when: t0,
        hold: 0.9,
        gain: 0.006,
        env: { a: 0.01, d: 0.1, s: 0.8, r: 0.2 },
      });
      const off = t0 + 1.32;
      noise(SFX_PRIORITY.lose, {
        when: off,
        hold: 0.002,
        gain: 0.2,
        rate: 1.4,
        env: { a: 0.0005, d: 0.012, s: 0, r: 0.01 },
        filter: { type: 'highpass', freq: 2500, q: 0.7 },
      });
      fm(SFX_PRIORITY.lose, {
        freq: 140,
        freqEnd: 50,
        glideTime: 0.05,
        ratio: 1,
        index: 1,
        indexEnd: 0,
        indexTime: 0.02,
        when: off,
        hold: 0,
        gain: 0.2,
        env: { a: 0.001, d: 0.09, s: 0, r: 0.03 },
        filter: { type: 'lowpass', freq: 500, q: 0.5 },
      });
      noise(SFX_PRIORITY.lose, {
        when: off + 0.01,
        hold: 0.04,
        gain: 0.05,
        rate: 1.1,
        rateEnd: 0.5,
        env: { a: 0.002, d: 0.15, s: 0, r: 0.05 },
        filter: { type: 'bandpass', freq: 5000, freqEnd: 2000, q: 0.9 },
      });
    },
  };

  const NO_PARAMS: SfxParams = {};

  return {
    play(name, when, params) {
      const fn = impl[name];
      if (!fn) return;
      const t0 = Math.max(when ?? ctx.currentTime, ctx.currentTime);
      trim = SFX_TRIM[name] ?? 1;
      try {
        fn(t0, params ?? NO_PARAMS);
      } finally {
        trim = 1;
      }
    },
    resetStreak() {
      streak = 0;
      lastClickAt = -Infinity;
    },
    get streak() {
      return streak;
    },
  };
}

/**
 * `click` must stay 1:1 with input for feel, so the engine's coalescing rate
 * limiter skips it. (Automated clicks have their own gate in the engine.)
 */
export function isStreakDriven(name: AnySfxName): boolean {
  return name === 'click';
}
