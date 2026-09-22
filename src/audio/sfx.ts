/**
 * One synthesised sound per `SfxName`. No samples, no files.
 *
 * Design notes:
 *  - `click` is pitched by a streak counter so mashing plays a rising run
 *    instead of a flat machine-gun. The streak resets after `STREAK_IDLE_S`.
 *  - Voice counts are deliberately small; the ship/win fanfares are the only
 *    sounds that spend more than ~4 voices, and they carry a high priority so
 *    the pool never steals from them.
 */

import type { SfxName } from '../sim/types.ts';
import { mtof, playTone, type ToneOpts, type VoicePool } from './synth.ts';

export interface SfxDeps {
  readonly ctx: BaseAudioContext;
  /** Destination node (the sfx bus). */
  readonly out: AudioNode;
  readonly pool: VoicePool;
}

export interface SfxPlayer {
  play(name: SfxName, when?: number): void;
  /** Forget the click streak (call on run start). */
  resetStreak(): void;
  /** Current streak step, exposed for tests/debug. */
  readonly streak: number;
}

/**
 * Priority ladder. 0 = disposable (stealable), 3 = never interrupted.
 * See `VoicePool` for the eviction policy.
 */
export const SFX_PRIORITY: Readonly<Record<SfxName, number>> = {
  uiHover: 0,
  click: 0,
  clickCrit: 1,
  oneShot: 2,
  buy: 1,
  denied: 1,
  reroll: 1,
  draftPick: 1,
  incidentClear: 1,
  warn: 1,
  draftOpen: 2,
  incidentBad: 2,
  incidentGood: 2,
  metaBuy: 2,
  achievement: 3,
  ship: 3,
  win: 3,
  lose: 3,
};

/** Streak resets after this much silence. */
export const STREAK_IDLE_S = 0.6;
/** Click pitch never rises more than an octave. */
export const STREAK_MAX_STEPS = 12;
/** Base note for `click` (E5). */
const CLICK_BASE_MIDI = 76;

/** Sub-semitone wobble applied to `warn` so a per-second beep stays bearable. */
const WARN_VARIANCE = [0, 0.34, -0.28, 0.16, -0.12, 0.42] as const;

export function createSfxPlayer(deps: SfxDeps): SfxPlayer {
  const { ctx, out, pool } = deps;

  let streak = 0;
  let lastClickAt = -Infinity;
  let warnIndex = 0;

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

  const impl: Record<SfxName, (t0: number) => void> = {
    // -- clicking -----------------------------------------------------------
    click(t0) {
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
      // The agent-side crit. Deliberately unlike `clickCrit`: a rising fifth
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

    // -- shipping -----------------------------------------------------------
    ship(t0) {
      // Noise swell riser into a 4-note major fanfare.
      tone(SFX_PRIORITY.ship, {
        wave: 'noise',
        when: t0,
        hold: 0.26,
        gain: 0.075,
        rate: 0.45,
        rateEnd: 2.4,
        env: { a: 0.2, d: 0.05, s: 0.9, r: 0.09 },
        filter: { type: 'highpass', freq: 500, freqEnd: 5200, q: 0.8 },
      });
      seq(SFX_PRIORITY.ship, t0 + 0.3, [72, 76, 79, 84], 0.085, {
        wave: 'pulse',
        duty: 0.35,
        hold: 0.07,
        gain: 0.17,
        env: { a: 0.002, d: 0.03, s: 0.7, r: 0.1 },
      });
      tone(SFX_PRIORITY.ship, {
        wave: 'triangle',
        freq: mtof(48),
        when: t0 + 0.3,
        hold: 0.42,
        gain: 0.14,
        env: { a: 0.004, d: 0.08, s: 0.6, r: 0.2 },
        filter: { type: 'lowpass', freq: 1400 },
      });
    },

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
      // Classic power-down: long exponential slide plus a collapsing noise tail.
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
      // Fast bright major arpeggio — no riser, so it never reads as a ship.
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

    // -- feedback -----------------------------------------------------------
    warn(t0) {
      // Two clipped beeps with a sub-semitone wobble so a once-per-second
      // repeat stays urgent without turning into a smoke alarm.
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
  };

  return {
    play(name, when) {
      const fn = impl[name];
      if (!fn) return;
      const t0 = Math.max(when ?? ctx.currentTime, ctx.currentTime);
      fn(t0);
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
 * limiter skips it.
 */
export function isStreakDriven(name: SfxName): boolean {
  return name === 'click';
}
