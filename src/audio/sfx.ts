/**
 * One synthesised sound per `SfxName`. No samples, no files.
 *
 * Design notes:
 *  - `click` is pitched by a streak counter so mashing plays a rising run
 *    instead of a flat machine-gun. The streak resets after `STREAK_IDLE_S`.
 *    Automated clicks play a soft tick under that band and never touch the
 *    streak, so an autoclicker cannot pin a human's mashing at the top octave.
 *  - A few sounds take detail from the event behind them (`SfxParams`): the
 *    sycophancy chime wears thin, the context alarm gets more urgent. The
 *    engine turns game values into those 0..1 amounts; this module only
 *    synthesises.
 *  - Voice counts are deliberately small. The report and win fanfares and the
 *    forced compaction are the only sounds that spend more than ~6 voices, and
 *    they carry a high priority so the pool never steals from them.
 */

import type { SfxName } from '../sim/types.ts';
import { mtof, playTone, saturate, type FilterSpec, type ToneOpts, type VoicePool, type Wave } from './synth.ts';

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
}

/** Event detail for the few sounds that vary. Every field is optional. */
export interface SfxParams {
  /** `click`: automation fired it. A soft tick that leaves the streak alone. */
  readonly auto?: boolean;
  /** `sycophancy`: 0 sincere .. 1 spammed hollow. Thinner, quieter, squeakier. */
  readonly thin?: number;
  /** `contextWarn`: 0 first warning .. 1 about to overflow. More blips, higher. */
  readonly urgency?: number;
}

export interface SfxPlayer {
  play(name: AnySfxName, when?: number, params?: SfxParams): void;
  /** Forget the click streak (call on run start). */
  resetStreak(): void;
  /** Current streak step, exposed for tests/debug. */
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

/** Streak resets after this much silence. */
export const STREAK_IDLE_S = 0.6;
/** Click pitch never rises more than an octave. */
export const STREAK_MAX_STEPS = 12;
/** Base note for `click` (E5). */
const CLICK_BASE_MIDI = 76;
/** Automated clicks tick a fourth under the streak's floor (B4)... */
const AUTO_CLICK_MIDI = 71;
/** ...alternating with the note below, like two keys being typed. */
const AUTO_TICK_STEPS = [0, -2] as const;

/** Sub-semitone wobble applied to `warn` so a per-second beep stays bearable. */
const WARN_VARIANCE = [0, 0.34, -0.28, 0.16, -0.12, 0.42] as const;

/** Semitones the sycophancy chime climbs as it wears thin: eager, then squeaky. */
const SYCOPHANCY_MAX_LIFT = 4;

/**
 * Paper crumple grains: [offset s, noise rate, highpass Hz, level]. Fixed, so
 * every crumple is the same crumple and tests can fingerprint it.
 */
const CRUMPLE = [
  [0, 1.9, 3400, 1],
  [0.027, 1.1, 2300, 0.7],
  [0.061, 2.4, 4400, 0.85],
  [0.086, 1.4, 2800, 0.6],
  [0.122, 0.9, 1900, 0.9],
  [0.158, 2.1, 3800, 0.55],
  [0.181, 1.3, 2600, 0.75],
  [0.226, 1.7, 3100, 0.5],
] as const;

/** Glass shards: [offset s, MIDI, pan, level]. Off-key on purpose: glass does not break in tune. */
const SHARDS = [
  [0.004, 100.3, -0.5, 1],
  [0.021, 104.7, 0.35, 0.8],
  [0.039, 97.6, 0.6, 0.9],
  [0.062, 106.2, -0.25, 0.65],
  [0.088, 102.1, 0.1, 0.7],
  [0.121, 108.5, -0.6, 0.45],
  [0.157, 99.2, 0.45, 0.5],
] as const;

/** One compaction, as a set of knobs: `/compact` and a forced overflow share the gesture. */
interface CompactionStyle {
  /** An impact ahead of the press: the side walls slamming in. */
  readonly slam: boolean;
  /**
   * Body of the squish: one voice per semitone offset. Stacked in octaves
   * rather than detuned in unison, which would beat and cancel mid-press.
   */
  readonly pressWave: Wave;
  readonly pressVoices: readonly number[];
  readonly pressGain: number;
  /** How long the press holds before the walls meet. */
  readonly pressHold: number;
  /** The press's lowpass closes from the first cutoff to the second. Brighter is harsher. */
  readonly pressCut: readonly [number, number];
  /** Resonance on that filter. Higher is nastier. */
  readonly pressQ: number;
  readonly hissGain: number;
  readonly thunkGain: number;
  /** Paper crumple grains used, from `CRUMPLE`. */
  readonly grains: number;
  readonly grainGain: number;
}

const COMPACT_MANUAL: CompactionStyle = {
  slam: false,
  pressWave: 'triangle',
  pressVoices: [0],
  pressGain: 0.16,
  pressHold: 0.2,
  pressCut: [1200, 220],
  pressQ: 1.6,
  hissGain: 0.065,
  thunkGain: 0.17,
  grains: 5,
  grainGain: 0.055,
};

/** The same squish, harsher and louder: a slam, a bright saw press with a growl under it, more paper. */
const COMPACT_FORCED: CompactionStyle = {
  slam: true,
  pressWave: 'saw',
  pressVoices: [0, -12],
  pressGain: 0.16,
  pressHold: 0.27,
  pressCut: [2400, 480],
  pressQ: 4,
  hissGain: 0.12,
  thunkGain: 0.24,
  grains: 8,
  grainGain: 0.09,
};

export function createSfxPlayer(deps: SfxDeps): SfxPlayer {
  const { ctx, out, pool } = deps;

  let streak = 0;
  let lastClickAt = -Infinity;
  let warnIndex = 0;
  let autoIndex = 0;

  /** Fire one voice with the shared destination/pool wired in. */
  function tone(priority: number, o: ToneOpts): void {
    playTone(ctx, out, { priority, pool, ...o });
  }

  /** Schedule an ascending/descending run of notes. */
  function seq(
    priority: number,
    t0: number,
    notes: readonly number[],
    spacing: number,
    base: ToneOpts,
  ): void {
    for (let i = 0; i < notes.length; i++) {
      const midi = notes[i];
      if (midi === undefined) continue;
      const last = i === notes.length - 1;
      tone(priority, {
        ...base,
        freq: mtof(midi),
        when: t0 + i * spacing,
        hold: last ? (base.hold ?? 0.05) * 2.4 : base.hold,
        env: last ? { ...base.env, r: Math.max(base.env?.r ?? 0.09, 0.22) } : base.env,
      });
    }
  }

  /** Hydraulic squish plus paper crumple: the pile crushed into a SUMMARY scroll. */
  function compaction(t0: number, s: CompactionStyle, priority: number): void {
    let t = t0;
    if (s.slam) {
      tone(priority, {
        wave: 'noise',
        when: t,
        hold: 0.02,
        gain: 0.15,
        rate: 0.8,
        env: { a: 0.001, d: 0.05, s: 0.35, r: 0.08 },
        filter: { type: 'lowpass', freq: 3000, q: 0.8 },
      });
      tone(priority, {
        wave: 'square',
        freq: mtof(33),
        freqEnd: mtof(24),
        glide: 'exp',
        when: t,
        hold: 0.05,
        gain: 0.22,
        env: { a: 0.001, d: 0.04, s: 0.5, r: 0.08 },
        filter: { type: 'lowpass', freq: 360, q: 2 },
      });
      t += 0.07;
    }
    // Hydraulic hiss: pressure bleeding off as the press comes down.
    tone(priority, {
      wave: 'noise',
      when: t,
      hold: s.pressHold - 0.01,
      gain: s.hissGain,
      rate: 1.3,
      rateEnd: 0.5,
      env: { a: 0.012, d: 0.05, s: 0.8, r: 0.1 },
      filter: { type: 'bandpass', freq: 2600, freqEnd: 700, q: 1.1 },
    });
    // The squish: a heavy body sinking an octave and a half as it closes.
    for (const offset of s.pressVoices) {
      tone(priority, {
        wave: s.pressWave,
        freq: mtof(55 + offset),
        freqEnd: mtof(36 + offset),
        glide: 'exp',
        // A few cents of grit on anything stacked under the main voice.
        detune: offset === 0 ? 0 : 7,
        when: t,
        hold: s.pressHold,
        gain: s.pressGain,
        env: { a: 0.008, d: 0.05, s: 0.75, r: 0.07 },
        filter: { type: 'lowpass', freq: s.pressCut[0], freqEnd: s.pressCut[1], q: s.pressQ },
      });
    }
    // The walls meet.
    const shut = t + s.pressHold + 0.04;
    tone(priority, {
      wave: 'triangle',
      freq: mtof(38),
      freqEnd: mtof(29),
      glide: 'exp',
      when: shut,
      hold: 0.03,
      gain: s.thunkGain,
      env: { a: 0.001, d: 0.05, s: 0.4, r: 0.1 },
      filter: { type: 'lowpass', freq: 450 },
    });
    // Paper crumple: the pile folding into a scroll.
    for (let i = 0; i < s.grains && i < CRUMPLE.length; i++) {
      const grain = CRUMPLE[i];
      if (!grain) continue;
      const [off, rate, hp, level] = grain;
      tone(priority, {
        wave: 'noise',
        when: shut + 0.02 + off,
        hold: 0.008,
        gain: s.grainGain * level,
        rate,
        env: { a: 0.001, d: 0.012, s: 0.4, r: 0.02 },
        filter: { type: 'highpass', freq: hp, q: 0.9 },
      });
    }
  }

  const impl: Record<AnySfxName, (t0: number, p: SfxParams) => void> = {
    // -- clicking -----------------------------------------------------------
    click(t0, p) {
      if (p.auto) {
        const step = AUTO_TICK_STEPS[autoIndex % AUTO_TICK_STEPS.length] ?? 0;
        autoIndex++;
        tone(SFX_PRIORITY.click, {
          wave: 'pulse',
          duty: 0.35,
          freq: mtof(AUTO_CLICK_MIDI + step),
          when: t0,
          hold: 0.012,
          gain: 0.1,
          env: { a: 0.001, d: 0.012, s: 0.25, r: 0.025 },
          filter: { type: 'lowpass', freq: 3600, q: 0.7 },
        });
        return;
      }
      if (t0 - lastClickAt > STREAK_IDLE_S) streak = 0;
      else streak = Math.min(streak + 1, STREAK_MAX_STEPS);
      lastClickAt = t0;
      const f = mtof(CLICK_BASE_MIDI + streak);
      tone(SFX_PRIORITY.click, {
        wave: 'pulse',
        duty: 0.5,
        freq: f,
        freqEnd: f * 1.06,
        glide: 'exp',
        when: t0,
        hold: 0.018,
        gain: 0.15,
        env: { a: 0.001, d: 0.018, s: 0.32, r: 0.035 },
        filter: { type: 'lowpass', freq: 7000, q: 0.7 },
      });
    },

    clickCrit(t0) {
      // Bright arpeggio stab, an octave-plus above the click band.
      seq(SFX_PRIORITY.clickCrit, t0, [88, 92, 95, 100], 0.026, {
        wave: 'pulse',
        duty: 0.25,
        hold: 0.022,
        gain: 0.12,
        env: { a: 0.001, d: 0.02, s: 0.4, r: 0.06 },
        filter: { type: 'highpass', freq: 500, q: 0.6 },
      });
    },

    oneShot(t0) {
      // A tool one-shot it. Deliberately unlike `clickCrit`: a rising fifth
      // with a soft body rather than a bright stab, so a hands-off build does
      // not sound like someone is hammering the spacebar.
      seq(SFX_PRIORITY.oneShot, t0, [69, 76, 81], 0.052, {
        wave: 'triangle',
        hold: 0.07,
        gain: 0.13,
        env: { a: 0.004, d: 0.05, s: 0.5, r: 0.14 },
        filter: { type: 'lowpass', freq: 5200, q: 0.8 },
      });
    },

    sycophancy(t0, p) {
      // "You're absolutely right!": a bright ta-DING up a fifth. Spam wears it
      // thin. The warmth and the sparkle go first, then it gets quieter,
      // narrower and squeakier, the way the human hears it.
      const thin = saturate(p.thin ?? 0);
      const lift = Math.round(SYCOPHANCY_MAX_LIFT * thin);
      const level = 1 - 0.6 * thin;
      const duty = 0.5 - 0.375 * thin;
      const air: FilterSpec = { type: 'highpass', freq: 300 + 3200 * thin, q: 0.7 };
      tone(SFX_PRIORITY.sycophancy, {
        wave: 'pulse',
        duty,
        freq: mtof(81 + lift),
        when: t0,
        hold: 0.025,
        gain: 0.1 * level,
        env: { a: 0.001, d: 0.02, s: 0.5, r: 0.05 },
        filter: air,
      });
      tone(SFX_PRIORITY.sycophancy, {
        wave: 'pulse',
        duty,
        freq: mtof(88 + lift),
        when: t0 + 0.06,
        hold: 0.06,
        gain: 0.12 * level,
        env: { a: 0.001, d: 0.03, s: 0.55, r: 0.2 - 0.14 * thin },
        filter: air,
      });
      if (thin < 0.5) {
        tone(SFX_PRIORITY.sycophancy, {
          wave: 'triangle',
          freq: mtof(76 + lift),
          when: t0 + 0.06,
          hold: 0.08,
          gain: 0.09 * (1 - 2 * thin),
          env: { a: 0.002, d: 0.05, s: 0.5, r: 0.18 },
        });
      }
      if (thin < 0.25) {
        tone(SFX_PRIORITY.sycophancy, {
          wave: 'pulse',
          duty: 0.125,
          freq: mtof(100 + lift),
          when: t0 + 0.07,
          hold: 0.01,
          gain: 0.05 * (1 - 4 * thin),
          env: { a: 0.001, d: 0.02, s: 0.3, r: 0.08 },
          filter: { type: 'highpass', freq: 2000 },
        });
      }
    },

    achievement(t0) {
      // Four-note rising fanfare, wide and bright. Priority 3 so nothing steals
      // it: this is the one sound the player is meant to stop and notice.
      seq(SFX_PRIORITY.achievement, t0, [72, 76, 79, 84], 0.075, {
        wave: 'triangle',
        hold: 0.1,
        gain: 0.16,
        env: { a: 0.003, d: 0.06, s: 0.55, r: 0.26 },
        filter: { type: 'lowpass', freq: 6800, q: 0.9 },
      });
    },

    // -- economy ------------------------------------------------------------
    buy(t0) {
      // Two-note ascending confirm, C5 -> G5, over a short triangle body.
      seq(SFX_PRIORITY.buy, t0, [72, 79], 0.075, {
        wave: 'pulse',
        duty: 0.35,
        hold: 0.055,
        gain: 0.16,
        env: { a: 0.002, d: 0.03, s: 0.55, r: 0.1 },
      });
      tone(SFX_PRIORITY.buy, {
        wave: 'triangle',
        freq: mtof(48),
        when: t0,
        hold: 0.09,
        gain: 0.12,
        env: { a: 0.003, d: 0.05, s: 0.4, r: 0.12 },
        filter: { type: 'lowpass', freq: 1200 },
      });
    },

    denied(t0) {
      // Dull, detuned low buzz that sags slightly.
      for (const cents of [0, -14]) {
        tone(SFX_PRIORITY.denied, {
          wave: 'square',
          freq: mtof(41),
          freqEnd: mtof(41) * 0.93,
          glide: 'lin',
          detune: cents,
          when: t0,
          hold: 0.15,
          gain: 0.13,
          env: { a: 0.002, d: 0.04, s: 0.85, r: 0.08 },
          filter: { type: 'lowpass', freq: 780, q: 2 },
        });
      }
    },

    metaBuy(t0) {
      // Chunky thunk + detuned bell pair.
      tone(SFX_PRIORITY.metaBuy, {
        wave: 'triangle',
        freq: mtof(36),
        freqEnd: mtof(31),
        glide: 'exp',
        when: t0,
        hold: 0.05,
        gain: 0.22,
        env: { a: 0.002, d: 0.05, s: 0.5, r: 0.14 },
        filter: { type: 'lowpass', freq: 420 },
      });
      for (const [midi, cents] of [
        [84, 7],
        [91, -7],
      ] as const) {
        tone(SFX_PRIORITY.metaBuy, {
          wave: 'triangle',
          freq: mtof(midi),
          detune: cents,
          when: t0 + 0.02,
          hold: 0.22,
          gain: 0.085,
          env: { a: 0.004, d: 0.12, s: 0.35, r: 0.42 },
        });
      }
      tone(SFX_PRIORITY.metaBuy, {
        wave: 'pulse',
        duty: 0.2,
        freq: mtof(79),
        when: t0 + 0.02,
        hold: 0.04,
        gain: 0.09,
        env: { a: 0.001, d: 0.03, s: 0.3, r: 0.1 },
      });
    },

    // -- the report button --------------------------------------------------
    report(t0) {
      // Enter: the commit going in, a crisp key and a thunk...
      tone(SFX_PRIORITY.report, {
        wave: 'noise',
        when: t0,
        hold: 0.008,
        gain: 0.07,
        rate: 1.5,
        env: { a: 0.001, d: 0.015, s: 0.3, r: 0.03 },
        filter: { type: 'highpass', freq: 1800, q: 0.7 },
      });
      tone(SFX_PRIORITY.report, {
        wave: 'triangle',
        freq: mtof(43),
        freqEnd: mtof(36),
        glide: 'exp',
        when: t0,
        hold: 0.04,
        gain: 0.18,
        env: { a: 0.002, d: 0.04, s: 0.4, r: 0.08 },
        filter: { type: 'lowpass', freq: 900 },
      });
      // ...a quick pickup over a held root...
      const pickup = t0 + 0.05;
      seq(SFX_PRIORITY.report, pickup, [67, 72, 76, 79], 0.055, {
        wave: 'pulse',
        duty: 0.35,
        hold: 0.04,
        gain: 0.15,
        env: { a: 0.002, d: 0.03, s: 0.65, r: 0.08 },
      });
      tone(SFX_PRIORITY.report, {
        wave: 'triangle',
        freq: mtof(48),
        when: pickup,
        hold: 0.36,
        gain: 0.13,
        env: { a: 0.004, d: 0.08, s: 0.6, r: 0.2 },
        filter: { type: 'lowpass', freq: 1400 },
      });
      // ...and the chime: a bell pair an octave up, detuned into a shimmer.
      const ring = pickup + 4 * 0.055;
      for (const [midi, cents, pan] of [
        [84, 6, -0.3],
        [91, -6, 0.3],
      ] as const) {
        tone(SFX_PRIORITY.report, {
          wave: 'triangle',
          freq: mtof(midi),
          detune: cents,
          pan,
          when: ring,
          hold: 0.12,
          gain: 0.1,
          env: { a: 0.003, d: 0.1, s: 0.45, r: 0.45 },
        });
      }
    },

    claim(t0) {
      // Swish left, swoosh right: the claim slides past the human.
      tone(SFX_PRIORITY.claim, {
        wave: 'noise',
        pan: -0.45,
        when: t0,
        hold: 0.1,
        gain: 0.13,
        rate: 0.7,
        rateEnd: 1.8,
        env: { a: 0.09, d: 0.04, s: 0.8, r: 0.12 },
        filter: { type: 'bandpass', freq: 700, freqEnd: 3800, q: 1.6 },
      });
      tone(SFX_PRIORITY.claim, {
        wave: 'noise',
        pan: 0.45,
        when: t0 + 0.09,
        hold: 0.07,
        gain: 0.1,
        rate: 1.6,
        rateEnd: 0.8,
        env: { a: 0.04, d: 0.04, s: 0.7, r: 0.14 },
        filter: { type: 'bandpass', freq: 3400, freqEnd: 1100, q: 1.4 },
      });
      // A slide-whistle under the air...
      tone(SFX_PRIORITY.claim, {
        wave: 'triangle',
        freq: mtof(62),
        freqEnd: mtof(74),
        glide: 'exp',
        when: t0 + 0.01,
        hold: 0.14,
        gain: 0.08,
        env: { a: 0.05, d: 0.04, s: 0.7, r: 0.08 },
      });
      // ...and a wink: a chromatic slip up into the fifth.
      seq(SFX_PRIORITY.claim, t0 + 0.22, [77, 78, 85], 0.04, {
        wave: 'pulse',
        duty: 0.25,
        hold: 0.018,
        gain: 0.11,
        env: { a: 0.001, d: 0.02, s: 0.5, r: 0.05 },
      });
    },

    caught(t0) {
      // The buzzer: a low minor-second cluster. The human ran the tests.
      for (const [midi, wave] of [
        [45, 'square'],
        [46, 'saw'],
      ] as const) {
        tone(SFX_PRIORITY.caught, {
          wave,
          freq: mtof(midi),
          when: t0,
          hold: 0.28,
          gain: 0.12,
          env: { a: 0.003, d: 0.03, s: 0.9, r: 0.05 },
          filter: { type: 'lowpass', freq: 2200, q: 1.2 },
        });
      }
      tone(SFX_PRIORITY.caught, {
        wave: 'noise',
        when: t0,
        hold: 0.28,
        gain: 0.04,
        rate: 0.35,
        env: { a: 0.003, d: 0.03, s: 0.9, r: 0.05 },
        filter: { type: 'lowpass', freq: 1400, q: 1 },
      });
      // Then "wrong", in two notes going down, the second sagging.
      tone(SFX_PRIORITY.caught, {
        wave: 'square',
        freq: mtof(63),
        when: t0 + 0.38,
        hold: 0.09,
        gain: 0.11,
        env: { a: 0.003, d: 0.03, s: 0.8, r: 0.05 },
        filter: { type: 'lowpass', freq: 2600, q: 1 },
      });
      tone(SFX_PRIORITY.caught, {
        wave: 'square',
        freq: mtof(58),
        freqEnd: mtof(54),
        glide: 'lin',
        when: t0 + 0.54,
        hold: 0.24,
        gain: 0.11,
        env: { a: 0.003, d: 0.05, s: 0.8, r: 0.12 },
        filter: { type: 'lowpass', freq: 2400, freqEnd: 700, q: 1.4 },
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
      // A rising alarm blip: the window filling up. The last warning before an
      // overflow adds a third blip and starts a fourth higher.
      const urgency = saturate(p.urgency ?? 0);
      const blips = 2 + Math.round(urgency);
      const base = 72 + Math.round(5 * urgency);
      for (let i = 0; i < blips; i++) {
        const midi = base + 5 * i;
        tone(SFX_PRIORITY.contextWarn, {
          wave: 'pulse',
          duty: 0.25,
          freq: mtof(midi),
          freqEnd: mtof(midi + 12),
          glide: 'exp',
          when: t0 + i * 0.1,
          hold: 0.045,
          gain: 0.1,
          env: { a: 0.002, d: 0.02, s: 0.8, r: 0.035 },
          filter: { type: 'lowpass', freq: 5600, q: 0.8 },
        });
      }
    },

    toolLost(t0) {
      // rm -rf took a tool with it: a short destructive crunch. A thud that
      // drops out from under you, a noise body crumbling downward, a digital
      // zap for the deletion itself, then rubble.
      tone(SFX_PRIORITY.toolLost, {
        wave: 'square',
        freq: mtof(38),
        freqEnd: mtof(26),
        glide: 'exp',
        when: t0,
        hold: 0.04,
        gain: 0.2,
        env: { a: 0.001, d: 0.04, s: 0.5, r: 0.07 },
        filter: { type: 'lowpass', freq: 500, q: 2 },
      });
      tone(SFX_PRIORITY.toolLost, {
        wave: 'noise',
        when: t0,
        hold: 0.07,
        gain: 0.17,
        rate: 1.1,
        rateEnd: 0.4,
        env: { a: 0.001, d: 0.03, s: 0.6, r: 0.08 },
        filter: { type: 'lowpass', freq: 2600, freqEnd: 300, q: 1.4 },
      });
      tone(SFX_PRIORITY.toolLost, {
        wave: 'pulse',
        duty: 0.125,
        freq: mtof(62),
        freqEnd: mtof(43),
        glide: 'lin',
        when: t0 + 0.01,
        hold: 0.06,
        gain: 0.07,
        env: { a: 0.001, d: 0.02, s: 0.7, r: 0.04 },
        filter: { type: 'lowpass', freq: 3000, q: 1 },
      });
      for (let i = 0; i < 3; i++) {
        const grain = CRUMPLE[i];
        if (!grain) continue;
        const [off, rate, hp, level] = grain;
        tone(SFX_PRIORITY.toolLost, {
          wave: 'noise',
          when: t0 + 0.12 + off,
          hold: 0.006,
          gain: 0.07 * level,
          rate: rate * 0.6,
          env: { a: 0.001, d: 0.012, s: 0.4, r: 0.02 },
          filter: { type: 'bandpass', freq: hp * 0.5, q: 1.2 },
        });
      }
    },

    // -- draft --------------------------------------------------------------
    draftOpen(t0) {
      // Shimmering rise: three slow-attack triangles gliding up a fifth.
      const pans = [-0.5, 0, 0.5];
      const from = [64, 67, 71];
      const to = [76, 79, 83];
      for (let i = 0; i < 3; i++) {
        tone(SFX_PRIORITY.draftOpen, {
          wave: 'triangle',
          freq: mtof(from[i] ?? 64),
          freqEnd: mtof(to[i] ?? 76),
          glide: 'exp',
          pan: pans[i] ?? 0,
          detune: (i - 1) * 9,
          when: t0,
          hold: 0.34,
          gain: 0.075,
          env: { a: 0.11, d: 0.08, s: 0.85, r: 0.26 },
        });
      }
      tone(SFX_PRIORITY.draftOpen, {
        wave: 'noise',
        when: t0,
        hold: 0.3,
        gain: 0.035,
        rate: 0.9,
        rateEnd: 2.2,
        env: { a: 0.16, d: 0.06, s: 0.8, r: 0.2 },
        filter: { type: 'highpass', freq: 3000, freqEnd: 9000, q: 1.4 },
      });
    },

    draftPick(t0) {
      tone(SFX_PRIORITY.draftPick, {
        wave: 'pulse',
        duty: 0.25,
        freq: mtof(81),
        freqEnd: mtof(86),
        glide: 'exp',
        when: t0,
        hold: 0.05,
        gain: 0.16,
        env: { a: 0.001, d: 0.025, s: 0.6, r: 0.09 },
      });
      tone(SFX_PRIORITY.draftPick, {
        wave: 'triangle',
        freq: mtof(45),
        when: t0,
        hold: 0.04,
        gain: 0.15,
        env: { a: 0.001, d: 0.04, s: 0.25, r: 0.09 },
        filter: { type: 'lowpass', freq: 700 },
      });
    },

    reroll(t0) {
      tone(SFX_PRIORITY.reroll, {
        wave: 'saw',
        freq: mtof(81),
        freqEnd: mtof(62),
        glide: 'exp',
        when: t0,
        hold: 0.12,
        gain: 0.12,
        env: { a: 0.002, d: 0.03, s: 0.75, r: 0.06 },
        filter: { type: 'lowpass', freq: 2600, freqEnd: 900, q: 2 },
      });
      tone(SFX_PRIORITY.reroll, {
        wave: 'noise',
        when: t0,
        hold: 0.03,
        gain: 0.05,
        rate: 1.4,
        rateEnd: 0.6,
        env: { a: 0.001, d: 0.02, s: 0.4, r: 0.05 },
        filter: { type: 'highpass', freq: 2200 },
      });
    },

    // -- incidents ----------------------------------------------------------
    incidentBad(t0) {
      // Two descending minor thirds (A#4 -> G4), plus a dirty noise smear.
      for (const off of [0, 0.24]) {
        seq(SFX_PRIORITY.incidentBad, t0 + off, [70, 67], 0.11, {
          wave: 'square',
          hold: 0.075,
          gain: 0.13,
          env: { a: 0.002, d: 0.02, s: 0.8, r: 0.06 },
          filter: { type: 'lowpass', freq: 2200, q: 1.5 },
        });
      }
      tone(SFX_PRIORITY.incidentBad, {
        wave: 'noise',
        when: t0,
        hold: 0.1,
        gain: 0.055,
        rate: 0.8,
        rateEnd: 0.35,
        env: { a: 0.004, d: 0.06, s: 0.55, r: 0.12 },
        filter: { type: 'lowpass', freq: 1500, freqEnd: 500, q: 1.2 },
      });
    },

    incidentGood(t0) {
      // Fast bright major arpeggio. No commit thunk, so it never reads as a report.
      seq(SFX_PRIORITY.incidentGood, t0, [76, 80, 83, 88], 0.048, {
        wave: 'pulse',
        duty: 0.45,
        hold: 0.035,
        gain: 0.12,
        env: { a: 0.001, d: 0.02, s: 0.65, r: 0.08 },
        filter: { type: 'highpass', freq: 400 },
      });
    },

    incidentClear(t0) {
      // Short relieved lift, G4 -> D5.
      seq(SFX_PRIORITY.incidentClear, t0, [67, 74], 0.07, {
        wave: 'triangle',
        hold: 0.06,
        gain: 0.13,
        env: { a: 0.004, d: 0.04, s: 0.6, r: 0.13 },
      });
    },

    interrupt(t0) {
      // "wait stop": the human breaks in mid-call. The crack...
      tone(SFX_PRIORITY.interrupt, {
        wave: 'noise',
        when: t0,
        hold: 0.03,
        gain: 0.3,
        rate: 1.7,
        env: { a: 0.0008, d: 0.05, s: 0.5, r: 0.09 },
        filter: { type: 'highpass', freq: 900, q: 0.7 },
      });
      // ...the knock that caused it...
      tone(SFX_PRIORITY.interrupt, {
        wave: 'triangle',
        freq: mtof(45),
        freqEnd: mtof(36),
        glide: 'exp',
        when: t0,
        hold: 0.03,
        gain: 0.24,
        env: { a: 0.001, d: 0.04, s: 0.4, r: 0.08 },
        filter: { type: 'lowpass', freq: 600 },
      });
      // ...shards raining down...
      for (const [off, midi, pan, level] of SHARDS) {
        tone(SFX_PRIORITY.interrupt, {
          wave: 'triangle',
          freq: mtof(midi),
          pan,
          when: t0 + off,
          hold: 0.008,
          gain: 0.13 * level,
          env: { a: 0.0008, d: 0.03, s: 0.3, r: 0.1 },
        });
      }
      // ...and the tinkle of what is left settling.
      tone(SFX_PRIORITY.interrupt, {
        wave: 'noise',
        when: t0 + 0.03,
        hold: 0.24,
        gain: 0.1,
        rate: 2.2,
        rateEnd: 1.1,
        env: { a: 0.01, d: 0.05, s: 0.6, r: 0.14 },
        filter: { type: 'bandpass', freq: 7000, freqEnd: 3000, q: 1.2 },
      });
    },

    permission(t0) {
      // A polite system ding. Then the same ding again, because nobody answered.
      for (const [off, level] of [
        [0, 1],
        [0.44, 0.8],
      ] as const) {
        tone(SFX_PRIORITY.permission, {
          wave: 'triangle',
          freq: mtof(81),
          when: t0 + off,
          hold: 0.03,
          gain: 0.18 * level,
          env: { a: 0.002, d: 0.08, s: 0.4, r: 0.32 },
        });
        tone(SFX_PRIORITY.permission, {
          wave: 'triangle',
          freq: mtof(100),
          when: t0 + off,
          hold: 0.01,
          gain: 0.05 * level,
          env: { a: 0.001, d: 0.05, s: 0.2, r: 0.18 },
        });
      }
    },

    // -- feedback -----------------------------------------------------------
    warn(t0) {
      // The human's patience is running out. Two clipped beeps with a
      // sub-semitone wobble so a once-per-second repeat stays urgent without
      // turning into a smoke alarm.
      const wobble = WARN_VARIANCE[warnIndex % WARN_VARIANCE.length] ?? 0;
      warnIndex++;
      const base = mtof(83 + wobble);
      for (let i = 0; i < 2; i++) {
        tone(SFX_PRIORITY.warn, {
          wave: 'pulse',
          duty: i === 0 ? 0.5 : 0.42,
          freq: base * (i === 0 ? 1 : 0.945),
          when: t0 + i * 0.085,
          hold: 0.032,
          gain: 0.1,
          env: { a: 0.002, d: 0.018, s: 0.7, r: 0.045 },
          filter: { type: 'lowpass', freq: 4200, q: 0.8 },
        });
      }
    },

    uiHover(t0) {
      tone(SFX_PRIORITY.uiHover, {
        wave: 'pulse',
        duty: 0.125,
        freq: mtof(96),
        when: t0,
        hold: 0.004,
        gain: 0.03,
        env: { a: 0.0008, d: 0.008, s: 0.2, r: 0.02 },
        filter: { type: 'highpass', freq: 1200 },
      });
    },

    // -- run end ------------------------------------------------------------
    win(t0) {
      // Longer, wider, resolves onto a held chord.
      tone(SFX_PRIORITY.win, {
        wave: 'noise',
        when: t0,
        hold: 0.34,
        gain: 0.08,
        rate: 0.4,
        rateEnd: 2.8,
        env: { a: 0.28, d: 0.05, s: 0.9, r: 0.12 },
        filter: { type: 'highpass', freq: 400, freqEnd: 6000, q: 0.8 },
      });
      seq(SFX_PRIORITY.win, t0 + 0.36, [72, 76, 79, 84, 83, 86], 0.1, {
        wave: 'pulse',
        duty: 0.4,
        hold: 0.08,
        gain: 0.16,
        env: { a: 0.002, d: 0.035, s: 0.72, r: 0.11 },
      });
      const chordAt = t0 + 0.36 + 6 * 0.1;
      for (const [midi, pan] of [
        [72, -0.45],
        [76, 0],
        [79, 0.45],
        [88, 0.2],
      ] as const) {
        tone(SFX_PRIORITY.win, {
          wave: 'pulse',
          duty: 0.3,
          freq: mtof(midi),
          pan,
          when: chordAt,
          hold: 0.7,
          gain: 0.1,
          env: { a: 0.01, d: 0.1, s: 0.7, r: 0.5 },
        });
      }
      tone(SFX_PRIORITY.win, {
        wave: 'triangle',
        freq: mtof(36),
        when: chordAt,
        hold: 0.8,
        gain: 0.16,
        env: { a: 0.006, d: 0.1, s: 0.7, r: 0.45 },
        filter: { type: 'lowpass', freq: 900 },
      });
    },

    lose(t0) {
      // The human switched models. Classic power-down: a long exponential
      // slide plus a collapsing noise tail.
      for (const cents of [0, -9]) {
        tone(SFX_PRIORITY.lose, {
          wave: 'saw',
          freq: mtof(69),
          freqEnd: mtof(29),
          glide: 'exp',
          detune: cents,
          when: t0,
          hold: 1.0,
          gain: 0.16,
          env: { a: 0.006, d: 0.15, s: 0.85, r: 0.3 },
          filter: { type: 'lowpass', freq: 2600, freqEnd: 260, q: 3 },
        });
      }
      tone(SFX_PRIORITY.lose, {
        wave: 'noise',
        when: t0,
        hold: 1.05,
        gain: 0.07,
        rate: 1.7,
        rateEnd: 0.12,
        env: { a: 0.01, d: 0.2, s: 0.7, r: 0.35 },
        filter: { type: 'lowpass', freq: 3800, freqEnd: 300, q: 1.2 },
      });
    },
  };

  const NO_PARAMS: SfxParams = {};

  return {
    play(name, when, params) {
      const fn = impl[name];
      if (!fn) return;
      const t0 = Math.max(when ?? ctx.currentTime, ctx.currentTime);
      fn(t0, params ?? NO_PARAMS);
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
