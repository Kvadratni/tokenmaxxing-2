/**
 * The score: one 4-bar theme in D Dorian, arranged five ways, one for each of
 * the human's rooms behind the glass (`SceneKey`), escalating as the session
 * does:
 *
 *   bedroom     84 BPM  lo-fi e-piano, vinyl hiss and crackle, sparse
 *   coworking   88 BPM  + round FM bass and a soft beat (FM kick, noise hat, rim)
 *   openplan    92 BPM  busier drums, a plucked FM arpeggio
 *   datacenter  94 BPM  darker harmony, an industrial hum, a crushed gritty bass
 *   orbital     96 BPM  wide pads, glass bells on the theme, a wide echoing arp
 *
 * The theme (`THEME`) is a climb of tokens, D F G A, that hangs and steps back,
 * answered by a fall to the Dorian sixth (B); then the climb again, reaching C,
 * falling home through E, with a pickup A back to the top. Every arrangement
 * plays it over the same four chords (`HARMONY`), so a scene change is a blend
 * of two mixes of one song. Across a 16-bar cycle the melody rests now and then
 * (`passes`), so twenty minutes of it does not wear a groove in the listener.
 *
 * Scheduling is the classic lookahead pattern: a 25 ms interval walks a
 * 16th-note grid and queues notes ~120 ms ahead on the audio clock, so timing
 * is sample-accurate even when the main thread stutters. The interval is
 * injectable (`MusicOptions.timers`), which is how the offline renderer drives
 * the real scheduler faster than real time.
 *
 * Two decks share one transport. `setScene()` loads the new arrangement on the
 * idle deck at the next bar line and equal-power crossfades over two bars,
 * gliding the tempo between the two scenes; the theme stays in phase.
 *
 * `setTension(t)` adds hat and arpeggio density and lifts a gentle low-pass
 * over the whole score; it never changes the tempo. `setContextFill(f)` opens
 * the pad's own low-pass as the context window fills (muffled when empty,
 * bright near full) and fades a low "pressure" drone in above 80%.
 */

import type { DerivedStats, SceneKey } from '../sim/types.ts';
import { rampParam, setParam } from './context.ts';
import {
  clamp,
  FM,
  hash01,
  mtof,
  playFM,
  playTone,
  reverbImpulse,
  saturate,
  startDrone,
  VoicePool,
  type Drone,
  type DroneSpec,
} from './synth.ts';

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const STEPS_PER_BAR = 16;
/** The theme is four bars long... */
export const LOOP_BARS = 4;
/** ...and four passes of it, with the melody resting in some, make one cycle. */
export const CYCLE_BARS = 16;
/** Scheduler wakeups. */
export const LOOKAHEAD_MS = 25;
/** How far ahead of the clock notes are queued. */
export const SCHEDULE_AHEAD_S = 0.12;
/** A scene change crossfades over this many bars, starting on a bar line. */
export const XFADE_BARS = 2;
/** Independent budget so the score can never starve the SFX pool. */
export const MUSIC_VOICE_CAP = 48;
/** Tension and context fill are smoothed per tick (~0.4 s to settle). */
const TENSION_LERP = 0.06;
const FILL_LERP = 0.05;
/** Texture drones renew a lease of this length every bar. */
const DRONE_LEASE_S = 20;

// ---------------------------------------------------------------------------
// The theme and its harmony
// ---------------------------------------------------------------------------

/** A theme note: [bar 0..3, 16th step, MIDI, length in 16ths]. */
export type ThemeNote = readonly [bar: number, step: number, midi: number, len: number];

/** THE theme, in D Dorian. See the module comment. */
export const THEME: readonly ThemeNote[] = [
  // Dm9: the climb (D F G A), a held A, and a step back down.
  [0, 0, 74, 2],
  [0, 2, 77, 2],
  [0, 4, 79, 2],
  [0, 6, 81, 6],
  [0, 12, 79, 2],
  [0, 14, 77, 2],
  // G13: the answer falls to the Dorian sixth.
  [1, 0, 76, 6],
  [1, 6, 74, 2],
  [1, 8, 71, 8],
  // Bbmaj9: the climb again, reaching further.
  [2, 0, 74, 2],
  [2, 2, 77, 2],
  [2, 4, 79, 2],
  [2, 6, 81, 4],
  [2, 10, 84, 2],
  [2, 12, 81, 4],
  // A7sus4: home through E, and a pickup back to the top.
  [3, 0, 79, 4],
  [3, 4, 77, 2],
  [3, 6, 76, 6],
  [3, 14, 69, 2],
];

export interface Chord {
  readonly name: string;
  /** Bass root, MIDI. */
  readonly bass: number;
  /** Pad and keys voicing, four notes. */
  readonly voicing: readonly number[];
  /** Arpeggio tones, low to high. */
  readonly arp: readonly number[];
}

export type Harmony = 'dorian' | 'dark' | 'bright';

/** The four chords under the theme, voiced three ways. */
export const HARMONY: Readonly<Record<Harmony, readonly Chord[]>> = {
  dorian: [
    { name: 'Dm9', bass: 38, voicing: [53, 57, 60, 64], arp: [62, 65, 69, 72, 76] },
    { name: 'G13', bass: 43, voicing: [53, 59, 64, 69], arp: [62, 67, 71, 74, 76] },
    { name: 'Bbmaj9', bass: 46, voicing: [50, 57, 60, 65], arp: [58, 62, 65, 69, 72] },
    { name: 'A7sus4', bass: 45, voicing: [50, 55, 59, 64], arp: [57, 62, 64, 67, 71] },
  ],
  // The machine room: the Dorian sixth goes flat (Aeolian), voicings sink.
  dark: [
    { name: 'Dm(add9)', bass: 38, voicing: [50, 53, 57, 64], arp: [50, 53, 57, 62, 64] },
    { name: 'Gm9', bass: 43, voicing: [53, 58, 62, 69], arp: [55, 58, 62, 65, 69] },
    { name: 'Bbmaj7', bass: 46, voicing: [53, 57, 62, 65], arp: [58, 62, 65, 69, 74] },
    { name: 'Asus4', bass: 45, voicing: [50, 57, 62, 64], arp: [57, 62, 64, 69, 74] },
  ],
  // Orbit: open, lifted voicings with a Lydian sparkle on the Bb.
  bright: [
    { name: 'Dm9', bass: 38, voicing: [57, 64, 65, 72], arp: [62, 69, 72, 76, 81] },
    { name: 'G6/9', bass: 43, voicing: [55, 59, 64, 69], arp: [67, 71, 74, 76, 81] },
    { name: 'Bbmaj7#11', bass: 46, voicing: [58, 62, 64, 69], arp: [62, 65, 69, 74, 76] },
    { name: 'A7sus4', bass: 45, voicing: [55, 62, 64, 71], arp: [64, 67, 69, 74, 76] },
  ],
};

// ---------------------------------------------------------------------------
// Arrangements
// ---------------------------------------------------------------------------

export type PartName = 'pad' | 'keys' | 'lead' | 'bass' | 'kick' | 'snare' | 'rim' | 'hat' | 'arp' | 'crackle';

export const PARTS: readonly PartName[] = ['pad', 'keys', 'lead', 'bass', 'kick', 'snare', 'rim', 'hat', 'arp', 'crackle'];

/** How the melody sits in one 4-bar pass: all of it, the call bars, the answer bars, or none. */
export type PassKind = 'theme' | 'call' | 'answer' | 'rest';

export interface Density {
  /** Steps that always play. */
  readonly base: readonly number[];
  /** Steps that join as tension rises: [step, tension at which it joins]. */
  readonly extra: ReadonlyArray<readonly [step: number, at: number]>;
}

export interface SceneCfg {
  readonly bpm: number;
  /** Delay on odd 16ths, as a fraction of a 16th. */
  readonly swing: number;
  readonly harmony: Harmony;
  /** The melody across the 16-bar cycle, one pass per 4 bars. */
  readonly passes: readonly [PassKind, PassKind, PassKind, PassKind];
  readonly lead: 'epiano' | 'hollow' | 'glass';
  /** Octaves the theme is moved. */
  readonly leadOct: number;
  readonly pad: 'warm' | 'hollow' | 'wide';
  /** E-piano comping: the steps a chord is struck on. Empty: no keys. */
  readonly keys: readonly number[];
  /** Bass line: [step, 16ths, semitones over the root]. Empty: no bass. */
  readonly bass: ReadonlyArray<readonly [step: number, len: number, interval: number]>;
  readonly bassVoice: 'round' | 'grit' | 'sub';
  readonly kick: readonly number[];
  readonly snare: readonly number[];
  readonly rim: readonly number[];
  readonly hat: Density;
  readonly hatVoice: 'soft' | 'tick' | 'metal' | 'shaker';
  /** Tension at which the offbeat hat opens up. */
  readonly openHatAt: number;
  readonly arp: Density;
  readonly arpVoice: 'epiano' | 'pluck' | 'glass';
  readonly arpOct: number;
  /** Stereo spread of the arp, 0..1 (alternating sides; mono-safe, no delays). */
  readonly arpWidth: number;
  readonly texture: 'vinyl' | 'hum' | 'none';
  /** Vinyl crackles per bar. */
  readonly crackle: number;
  /** Part levels. */
  readonly mix: Readonly<Record<PartName, number>>;
  /** Reverb and echo send levels. */
  readonly reverb: number;
  readonly echo: number;
  /** The score's high shelf at tension 0, dB (negative: darker). Tension lifts it. */
  readonly shelf: number;
}

const ALL_EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14] as const;
const OFF_SIXTEENTHS = [1, 3, 5, 7, 9, 11, 13, 15] as const;

/** Every scene gets more hat and more arp as tension rises: the same ladder, scene by scene. */
function ladder(steps: readonly number[], at: number): Array<readonly [number, number]> {
  return steps.map((s) => [s, at] as const);
}

export const SCENES: Readonly<Record<SceneKey, SceneCfg>> = {
  // The bedroom: a lo-fi e-piano on its own, and the record's surface noise.
  bedroom: {
    bpm: 84,
    swing: 0.22,
    harmony: 'dorian',
    passes: ['theme', 'rest', 'theme', 'call'],
    lead: 'epiano',
    leadOct: 0,
    pad: 'warm',
    keys: [0, 10],
    bass: [],
    bassVoice: 'round',
    kick: [],
    snare: [],
    rim: [],
    hat: { base: [], extra: [...ladder([4, 12], 0.35), ...ladder([0, 8], 0.55), ...ladder([2, 6, 10, 14], 0.75)] },
    hatVoice: 'soft',
    openHatAt: 2,
    arp: { base: [], extra: [...ladder([0, 8], 0.4), ...ladder([4, 12], 0.6), ...ladder([2, 6, 10, 14], 0.8)] },
    arpVoice: 'epiano',
    arpOct: 1,
    arpWidth: 0.2,
    texture: 'vinyl',
    crackle: 5,
    mix: { pad: 0.9, keys: 1, lead: 1, bass: 0, kick: 0, snare: 0, rim: 0, hat: 0.8, arp: 0.7, crackle: 1 },
    reverb: 0.3,
    echo: 0,
    shelf: -5,
  },
  // Coworking: the same record with a bass player and a soft boom-bap under it.
  coworking: {
    bpm: 88,
    swing: 0.18,
    harmony: 'dorian',
    passes: ['theme', 'call', 'theme', 'rest'],
    lead: 'epiano',
    leadOct: 0,
    pad: 'warm',
    keys: [0, 7, 10],
    bass: [
      [0, 6, 0],
      [7, 2, 0],
      [10, 4, 7],
      [14, 2, 12],
    ],
    bassVoice: 'round',
    kick: [0, 7, 10],
    snare: [],
    rim: [4, 12],
    hat: { base: [...ALL_EIGHTHS], extra: [...ladder([3, 11], 0.5), ...ladder([7, 15], 0.7), ...ladder([1, 5, 9, 13], 0.85)] },
    hatVoice: 'soft',
    openHatAt: 0.6,
    arp: { base: [], extra: [...ladder([0, 8], 0.35), ...ladder([4, 12], 0.55), ...ladder([2, 6, 10, 14], 0.75)] },
    arpVoice: 'pluck',
    arpOct: 1,
    arpWidth: 0.25,
    texture: 'vinyl',
    crackle: 2,
    mix: { pad: 0.8, keys: 0.85, lead: 1, bass: 1, kick: 1, snare: 0, rim: 1, hat: 0.9, arp: 0.8, crackle: 0.7 },
    reverb: 0.25,
    echo: 0.08,
    shelf: -4,
  },
  // The open plan: busier drums, a plucked arpeggio running underneath.
  openplan: {
    bpm: 92,
    swing: 0.12,
    harmony: 'dorian',
    passes: ['theme', 'theme', 'call', 'rest'],
    lead: 'epiano',
    leadOct: 0,
    pad: 'warm',
    keys: [2, 10],
    bass: [
      [0, 3, 0],
      [3, 2, 0],
      [6, 2, 12],
      [8, 3, 0],
      [11, 2, 7],
      [14, 2, 12],
    ],
    bassVoice: 'round',
    kick: [0, 6, 8, 11],
    snare: [4, 12],
    rim: [7, 15],
    hat: { base: [...ALL_EIGHTHS, 3, 11], extra: [...ladder([7, 15], 0.4), ...ladder([1, 5, 9, 13], 0.65)] },
    hatVoice: 'tick',
    openHatAt: 0.5,
    arp: { base: [...ALL_EIGHTHS], extra: [...ladder([3, 11], 0.45), ...ladder([7, 15], 0.65), ...ladder([1, 5, 9, 13], 0.85)] },
    arpVoice: 'pluck',
    arpOct: 1,
    arpWidth: 0.35,
    texture: 'none',
    crackle: 0,
    mix: { pad: 0.7, keys: 0.7, lead: 0.95, bass: 1, kick: 1, snare: 0.9, rim: 0.8, hat: 0.9, arp: 0.85, crackle: 0 },
    reverb: 0.22,
    echo: 0.1,
    shelf: -3,
  },
  // The data centre: the sixth goes flat, the room hums, the bass grinds.
  datacenter: {
    bpm: 94,
    swing: 0.05,
    harmony: 'dark',
    passes: ['theme', 'rest', 'call', 'theme'],
    lead: 'hollow',
    leadOct: -1,
    pad: 'hollow',
    keys: [],
    bass: [
      [0, 2, 0],
      [2, 1, 0],
      [3, 2, 0],
      [6, 2, 0],
      [8, 2, 0],
      [10, 1, 0],
      [11, 2, 12],
      [14, 2, 0],
    ],
    bassVoice: 'grit',
    kick: [0, 3, 8, 10],
    snare: [4, 12],
    rim: [14],
    hat: { base: [...ALL_EIGHTHS], extra: [...ladder([1, 5, 9, 13], 0.4), ...ladder([3, 7, 11, 15], 0.6)] },
    hatVoice: 'metal',
    openHatAt: 2,
    arp: { base: [0, 4, 8, 12], extra: [...ladder([2, 6, 10, 14], 0.4), ...ladder([...OFF_SIXTEENTHS], 0.7)] },
    arpVoice: 'pluck',
    arpOct: 0,
    arpWidth: 0.3,
    texture: 'hum',
    crackle: 0,
    mix: { pad: 0.85, keys: 0, lead: 1, bass: 0.9, kick: 1, snare: 0.8, rim: 0.8, hat: 0.8, arp: 0.7, crackle: 0 },
    reverb: 0.2,
    echo: 0.12,
    shelf: -5,
  },
  // Orbit: wide pads, the theme on glass bells an octave up, a wide echoing arp.
  orbital: {
    bpm: 96,
    swing: 0.1,
    harmony: 'bright',
    passes: ['theme', 'call', 'theme', 'rest'],
    lead: 'glass',
    leadOct: 1,
    pad: 'wide',
    keys: [],
    bass: [
      [0, 12, 0],
      [12, 4, 12],
    ],
    bassVoice: 'sub',
    kick: [0, 10],
    snare: [8],
    rim: [],
    hat: { base: [2, 6, 10, 14], extra: [...ladder([4, 12], 0.35), ...ladder([0, 8], 0.55), ...ladder([...OFF_SIXTEENTHS], 0.8)] },
    hatVoice: 'shaker',
    openHatAt: 2,
    arp: { base: [0, 3, 6, 8, 11, 14], extra: [...ladder([2, 10], 0.4), ...ladder([4, 12], 0.6), ...ladder([1, 5, 9, 13], 0.8)] },
    arpVoice: 'glass',
    arpOct: 0,
    arpWidth: 0.6,
    texture: 'none',
    crackle: 0,
    mix: { pad: 1, keys: 0, lead: 0.9, bass: 1, kick: 0.85, snare: 0.7, rim: 0, hat: 0.7, arp: 0.8, crackle: 0 },
    reverb: 0.45,
    echo: 0.3,
    shelf: -2.5,
  },
};

/** How much of each part goes to the reverb and to the echo, before the scene's own amounts. */
const PART_VERB: Readonly<Record<PartName, number>> = {
  pad: 1,
  keys: 0.6,
  lead: 0.7,
  bass: 0,
  kick: 0.04,
  snare: 0.5,
  rim: 0.4,
  hat: 0.15,
  arp: 0.6,
  crackle: 0.3,
};
const PART_ECHO: Readonly<Record<PartName, number>> = {
  pad: 0,
  keys: 0,
  lead: 0.7,
  bass: 0,
  kick: 0,
  snare: 0,
  rim: 0.3,
  hat: 0,
  arp: 1,
  crackle: 0,
};

/** One note the arrangement asks for. */
export interface MusicNote {
  readonly part: PartName;
  /** MIDI note (drums ignore it). */
  readonly midi: number;
  /** Length in 16ths. */
  readonly steps: number;
  /** 0..1. */
  readonly vel: number;
  /** Late by this fraction of a 16th: a rolled chord, a lazy hand. Never early. */
  readonly nudge: number;
  readonly pan?: number;
  /** An open hat. */
  readonly open?: boolean;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** The pass kind for absolute bar `bar`. */
export function passFor(scene: SceneKey, bar: number): PassKind {
  const s = SCENES[scene];
  return s.passes[mod(Math.floor(bar / LOOP_BARS), 4)] ?? 'theme';
}

function leadPlays(kind: PassKind, phraseBar: number): boolean {
  if (kind === 'theme') return true;
  if (kind === 'call') return phraseBar % 2 === 0;
  if (kind === 'answer') return phraseBar % 2 === 1;
  return false;
}

/** True when `step` plays at this tension. */
export function denseAt(d: Density, step: number, tension: number): boolean {
  if (d.base.includes(step)) return true;
  for (const [s, at] of d.extra) if (s === step && tension >= at) return true;
  return false;
}

/** How many steps of a bar play at this tension. */
export function densityCount(d: Density, tension: number): number {
  let n = 0;
  for (let s = 0; s < STEPS_PER_BAR; s++) if (denseAt(d, s, tension)) n++;
  return n;
}

/** The arp walks up and down the chord. */
const ARP_WALK = [0, 1, 2, 3, 4, 3, 2, 1] as const;

/** Steps until the next hit in `steps` (wrapping into the next bar). */
function gapToNext(steps: readonly number[], step: number): number {
  let best = Infinity;
  for (const s of steps) {
    const gap = s > step ? s - step : s + STEPS_PER_BAR - step;
    if (gap < best) best = gap;
  }
  return Number.isFinite(best) ? best : STEPS_PER_BAR;
}

/**
 * What `scene` plays on 16th `step` of absolute bar `bar` at `tension`. Pure:
 * the scheduler turns these into voices. Bars repeat every `LOOP_BARS` in
 * harmony and every `CYCLE_BARS` in everything else.
 */
export function arrange(scene: SceneKey, bar: number, step: number, tension: number): MusicNote[] {
  const s = SCENES[scene];
  const t = saturate(tension);
  const phraseBar = mod(bar, LOOP_BARS);
  const cycleBar = mod(bar, CYCLE_BARS);
  const chord = HARMONY[s.harmony][phraseBar] ?? HARMONY.dorian[0]!;
  const pass = passFor(scene, bar);
  const h = (salt: number): number => hash01(cycleBar * 16 + step, salt, 0x5ce7);
  const notes: MusicNote[] = [];

  // Pad: the chord on the downbeat, held into the next one.
  if (step === 0) {
    chord.voicing.forEach((midi, i) => {
      notes.push({ part: 'pad', midi, steps: STEPS_PER_BAR, vel: 0.85 + 0.15 * h(i), nudge: 0 });
    });
  }

  // Keys: rolled like a lazy hand, lighter on the re-strikes.
  if (s.keys.includes(step)) {
    const first = step === s.keys[0];
    const len = gapToNext(s.keys, step);
    const voicing = first ? chord.voicing : chord.voicing.slice(1);
    voicing.forEach((midi, i) => {
      notes.push({
        part: 'keys',
        midi,
        steps: len,
        vel: (first ? 0.8 : 0.55) * (0.9 + 0.2 * h(10 + i)),
        nudge: i * 0.09,
      });
    });
    // No bass player in the bedroom: the left hand takes the root.
    if (first && s.bass.length === 0) {
      notes.push({ part: 'keys', midi: chord.bass + 12, steps: STEPS_PER_BAR, vel: 0.75, nudge: 0 });
    }
  }

  // Lead: the theme.
  if (leadPlays(pass, phraseBar)) {
    for (const [b, st, midi, len] of THEME) {
      if (b !== phraseBar || st !== step) continue;
      const pitch = s.harmony === 'dark' && midi === 71 ? 70 : midi;
      notes.push({
        part: 'lead',
        midi: pitch + 12 * s.leadOct,
        steps: len,
        vel: 0.85 + 0.15 * h(20),
        nudge: 0.12 * h(21),
      });
    }
  }

  // Bass.
  for (const [st, len, interval] of s.bass) {
    if (st !== step) continue;
    notes.push({ part: 'bass', midi: chord.bass + interval, steps: len, vel: st === 0 ? 1 : 0.8 + 0.1 * h(30), nudge: 0 });
  }

  // Drums.
  if (s.kick.includes(step)) notes.push({ part: 'kick', midi: 0, steps: 2, vel: step === 0 ? 1 : 0.8, nudge: 0 });
  if (s.snare.includes(step)) notes.push({ part: 'snare', midi: 0, steps: 2, vel: 0.9 + 0.1 * h(40), nudge: 0 });
  if (s.rim.includes(step)) notes.push({ part: 'rim', midi: 0, steps: 1, vel: 0.75 + 0.25 * h(41), nudge: 0.05 * h(42) });
  if (denseAt(s.hat, step, t)) {
    const offbeat = step % 4 === 2;
    const ghost = step % 2 === 1;
    notes.push({
      part: 'hat',
      midi: 0,
      steps: 1,
      vel: (offbeat ? 1 : ghost ? 0.45 : 0.7) * (0.85 + 0.15 * h(43)),
      nudge: 0,
      open: step === 14 && t >= s.openHatAt,
    });
  }

  // Arp: busier in the passes where the melody rests.
  const arpTension = pass === 'rest' ? Math.min(1, t + 0.25) : t;
  if (denseAt(s.arp, step, arpTension)) {
    const idx = ARP_WALK[step % ARP_WALK.length] ?? 0;
    const midi = (chord.arp[idx] ?? chord.arp[0] ?? 62) + 12 * s.arpOct;
    const side = step % 4 < 2 ? -1 : 1;
    notes.push({
      part: 'arp',
      midi,
      steps: 2,
      vel: (step % 2 === 0 ? 0.8 : 0.6) * (0.85 + 0.15 * h(50)),
      nudge: 0,
      pan: side * s.arpWidth,
    });
  }

  // Surface noise.
  for (let k = 0; k < s.crackle; k++) {
    if (Math.floor(hash01(cycleBar, k, 0xc4ac) * STEPS_PER_BAR) !== step) continue;
    notes.push({
      part: 'crackle',
      midi: 0,
      steps: 1,
      vel: 0.35 + 0.65 * hash01(cycleBar, k, 0xc4ad),
      nudge: 0.9 * hash01(cycleBar, k, 0xc4ae),
    });
  }

  return notes;
}

// ---------------------------------------------------------------------------
// The two clocks, as the score hears them
// ---------------------------------------------------------------------------

/**
 * The score's tension for one frame of a run: whichever of the two clocks is
 * closer to ending it. Patience counts linearly. Context counts as its square,
 * so a half-full window stays calm (0.25) and only a nearly full one
 * (0.9 -> 0.81) competes with a human who is about to switch models.
 *
 * Pure. A non-finite reading counts as calm on its own axis.
 */
export function tensionFor(d: Pick<DerivedStats, 'patienceProgress' | 'contextFill'>): number {
  const impatience = saturate(1 - d.patienceProgress);
  const fill = saturate(d.contextFill);
  return saturate(Math.max(impatience, fill * fill));
}

/**
 * How full the context window is, for the score (`setContextFill`). Pure.
 * NaN reads as empty, an infinite reading as full.
 */
export function contextFillFor(d: Pick<DerivedStats, 'contextFill'>): number {
  return saturate(d.contextFill);
}

/** The pad's low-pass when the window is empty, and when it is full. */
export const PAD_CUTOFF_EMPTY = 320;
export const PAD_CUTOFF_FULL = 7500;
/** The pressure drone starts fading in here. */
export const PRESSURE_FROM = 0.8;

/** The pad's cutoff for a context fill: muffled when empty, bright near full. */
export function padCutoffFor(fill: number): number {
  const f = saturate(fill);
  return PAD_CUTOFF_EMPTY * Math.pow(PAD_CUTOFF_FULL / PAD_CUTOFF_EMPTY, Math.pow(f, 1.3));
}

/** The pressure drone's level for a context fill: silent to 80%, then a smooth rise to 1. */
export function pressureFor(fill: number): number {
  const x = saturate((saturate(fill) - PRESSURE_FROM) / (1 - PRESSURE_FROM));
  return x * x * (3 - 2 * x);
}

/** Where the score's high shelf sits, Hz. */
export const SHELF_HZ = 2800;
/** How far tension lifts it, dB. */
export const SHELF_LIFT_DB = 4;

/**
 * The whole score's high-shelf gain for a scene at a tension, dB: a subtle
 * lift of the top end as the session gets tense, never a jump.
 */
export function toneShelfFor(scene: SceneKey, tension: number): number {
  return SCENES[scene].shelf + SHELF_LIFT_DB * saturate(tension);
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export interface MusicTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

/** Looked up at call time, so test fake timers installed later still apply. */
const DEFAULT_TIMERS: MusicTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/** What `MusicOptions.solo` can pick: a part, the scene's texture bed, or the pressure drone. */
export type SoloPart = PartName | 'texture' | 'pressure';

export interface MusicOptions {
  /** Injectable scheduler clock. The offline renderer drives ticks by hand. */
  readonly timers?: MusicTimers;
  /** Dev tooling (stems): mute everything but these. */
  readonly solo?: readonly SoloPart[];
  /** Observer for every note the scheduler plays: which deck's scene, the note, its start time. */
  readonly onNote?: (scene: SceneKey, note: MusicNote, when: number) => void;
}

/** A snapshot of the score, for tests and the soundboard. */
export interface MusicState {
  /** The arrangement you hear now (the requested one may still be fading in). */
  readonly playing: SceneKey;
  readonly crossfading: boolean;
  readonly bpm: number;
  readonly bar: number;
  readonly step: number;
  readonly tension: number;
  readonly contextFill: number;
  readonly padCutoff: number;
  readonly pressure: number;
  /** The high shelf's gain, dB. */
  readonly toneShelf: number;
  readonly duck: number;
  readonly voices: number;
  readonly rejected: number;
}

export interface MusicController {
  /** Begin (or resume) the scheduler. No-op while suspended or disabled. */
  start(): void;
  /** Stop the scheduler and silence the score. Already-queued notes finish. */
  stop(): void;
  /** Tab went to the background. Cheap pause; keeps the enabled/scene state. */
  suspend(): void;
  /** Tab is visible again. */
  resume(): void;
  setScene(scene: SceneKey): void;
  setTension(t: number): void;
  setContextFill(f: number): void;
  /** Volume gate: `false` stops the scheduler entirely to save CPU. */
  setEnabled(enabled: boolean): void;
  /** Dip the score under a big moment: `depth` 0..1 for `holdS` seconds. */
  duck(depth: number, holdS: number): void;
  readonly running: boolean;
  readonly hidden: boolean;
  readonly enabled: boolean;
  /** The most recently requested scene. */
  readonly scene: SceneKey;
  readonly tension: number;
  readonly contextFill: number;
  inspect(): MusicState;
  destroy(): void;
}

interface Deck {
  scene: SceneKey;
  active: boolean;
  /** Crossfaded levels: the dry parts, the pad (into the context filter), the sends. */
  readonly level: GainNode;
  readonly padLevel: GainNode;
  readonly verbLevel: GainNode;
  readonly echoLevel: GainNode;
  readonly parts: Record<PartName, GainNode>;
  readonly verb: Record<PartName, GainNode>;
  readonly echo: Record<PartName, GainNode>;
  texture: Drone | null;
}

interface Crossfade {
  readonly from: number;
  readonly to: number;
  readonly startBar: number;
  readonly endBar: number;
  readonly bpmFrom: number;
  readonly bpmTo: number;
}

const VINYL: DroneSpec = {
  layers: [
    { kind: 'noise', rate: 1, filter: { type: 'bandpass', freq: 3200, q: 0.5 }, level: 1 },
    { kind: 'noise', rate: 0.2, filter: { type: 'lowpass', freq: 140, q: 0.7 }, level: 0.6 },
  ],
  gain: 0.022,
  fadeIn: 1.2,
  lease: DRONE_LEASE_S,
};

const HUM: DroneSpec = {
  layers: [
    { kind: 'fm', freq: mtof(38), ratio: 2, index: 0.7, level: 0.55 },
    { kind: 'sine', freq: mtof(50), detune: 4, level: 0.2 },
    { kind: 'noise', rate: 0.45, filter: { type: 'bandpass', freq: 380, q: 0.6 }, level: 0.8 },
  ],
  filter: { type: 'lowpass', freq: 1200, q: 0.5 },
  gain: 0.045,
  fadeIn: 2,
  lease: DRONE_LEASE_S,
};

/** Memory pressure: two low FMs a fraction of a hertz apart, throbbing against each other. */
const PRESSURE: DroneSpec = {
  layers: [
    { kind: 'fm', freq: mtof(38), ratio: 1, index: 1.3, level: 0.5 },
    { kind: 'fm', freq: mtof(38) + 0.7, ratio: 1, index: 1.2, level: 0.45 },
    { kind: 'sine', freq: mtof(50), detune: -6, level: 0.25 },
  ],
  filter: { type: 'lowpass', freq: 700, q: 1.1 },
  gain: 0.075,
  fadeIn: 1.2,
  lease: DRONE_LEASE_S,
};

export function createMusic(ctx: BaseAudioContext, out: AudioNode, opts: MusicOptions = {}): MusicController {
  const timers = opts.timers ?? DEFAULT_TIMERS;
  const pool = new VoicePool(MUSIC_VOICE_CAP);
  const solo = opts.solo ?? null;
  const audible = (p: SoloPart): boolean => solo === null || solo.includes(p);

  // --- the graph -----------------------------------------------------------
  const master = ctx.createGain();
  setParam(master.gain, 0);
  master.connect(out);

  const duckGain = ctx.createGain();
  setParam(duckGain.gain, 1);
  duckGain.connect(master);

  const tone = ctx.createBiquadFilter();
  tone.type = 'highshelf';
  setParam(tone.frequency, SHELF_HZ);
  setParam(tone.gain, toneShelfFor('bedroom', 0));
  tone.connect(duckGain);

  const padLP = ctx.createBiquadFilter();
  padLP.type = 'lowpass';
  setParam(padLP.Q, 0.7);
  setParam(padLP.frequency, padCutoffFor(0));
  padLP.connect(tone);

  const verbIn = ctx.createGain();
  setParam(verbIn.gain, 1);
  let verb: ConvolverNode | null = null;
  if (typeof ctx.createConvolver === 'function') {
    const ir = reverbImpulse(ctx, { seconds: 2.4, damp: 0.6, preDelay: 0.018, seed: 0x5eed });
    if (ir) {
      verb = ctx.createConvolver();
      verb.buffer = ir;
      verbIn.connect(verb);
      verb.connect(tone);
    }
  }

  const echoIn = ctx.createGain();
  setParam(echoIn.gain, 1);
  let echoDelay: DelayNode | null = null;
  if (typeof ctx.createDelay === 'function') {
    echoDelay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    setParam(damp.frequency, 2600);
    setParam(feedback.gain, 0.36);
    setParam(echoDelay.delayTime, echoTime(SCENES.bedroom.bpm));
    echoIn.connect(echoDelay);
    echoDelay.connect(damp);
    damp.connect(feedback);
    feedback.connect(echoDelay);
    damp.connect(tone);
  }

  const pressureBus = ctx.createGain();
  setParam(pressureBus.gain, 1);
  pressureBus.connect(duckGain);

  function makeDeck(scene: SceneKey, on: boolean): Deck {
    const level = ctx.createGain();
    const padLevel = ctx.createGain();
    const verbLevel = ctx.createGain();
    const echoLevel = ctx.createGain();
    for (const g of [level, padLevel, verbLevel, echoLevel]) setParam(g.gain, on ? 1 : 0);
    level.connect(tone);
    padLevel.connect(padLP);
    verbLevel.connect(verbIn);
    echoLevel.connect(echoIn);
    const parts = {} as Record<PartName, GainNode>;
    const verbs = {} as Record<PartName, GainNode>;
    const echoes = {} as Record<PartName, GainNode>;
    for (const p of PARTS) {
      const g = ctx.createGain();
      g.connect(p === 'pad' ? padLevel : level);
      const v = ctx.createGain();
      g.connect(v);
      v.connect(verbLevel);
      const e = ctx.createGain();
      g.connect(e);
      e.connect(echoLevel);
      parts[p] = g;
      verbs[p] = v;
      echoes[p] = e;
    }
    const deck: Deck = { scene, active: on, level, padLevel, verbLevel, echoLevel, parts, verb: verbs, echo: echoes, texture: null };
    applyMix(deck);
    return deck;
  }

  function applyMix(deck: Deck): void {
    const s = SCENES[deck.scene];
    for (const p of PARTS) {
      setParam(deck.parts[p].gain, audible(p) ? s.mix[p] : 0);
      setParam(deck.verb[p].gain, s.reverb * PART_VERB[p]);
      setParam(deck.echo[p].gain, s.echo * PART_ECHO[p]);
    }
  }

  const decks: [Deck, Deck] = [makeDeck('bedroom', true), makeDeck('bedroom', false)];
  let primary = 0;

  // --- state ---------------------------------------------------------------
  let sceneKey: SceneKey = 'bedroom';
  let pendingScene: SceneKey | null = null;
  let xfade: Crossfade | null = null;

  let tension = 0;
  let tensionTarget = 0;
  let fill = 0;
  let fillTarget = 0;
  let duckLevel = 1;
  let duckDepth = 0;
  let duckUntil = -Infinity;
  let pressure: Drone | null = null;

  let timer: unknown = null;
  let nextStepTime = 0;
  let step = 0;
  let bar = 0;

  let enabled = true;
  let hidden = false;
  let destroyed = false;

  function current(): Deck {
    return decks[primary] ?? decks[0];
  }

  function echoTime(bpm: number): number {
    // A dotted eighth.
    return (60 / Math.max(30, bpm)) * 0.75;
  }

  function progress(): number {
    if (!xfade) return 1;
    const done = (bar - xfade.startBar) * STEPS_PER_BAR + step;
    return clamp(done / ((xfade.endBar - xfade.startBar) * STEPS_PER_BAR), 0, 1);
  }

  function bpmNow(): number {
    if (xfade) return xfade.bpmFrom + (xfade.bpmTo - xfade.bpmFrom) * progress();
    return SCENES[current().scene].bpm;
  }

  function toneNow(): number {
    if (!xfade) return toneShelfFor(current().scene, tension);
    const a = toneShelfFor(decks[xfade.from]?.scene ?? 'bedroom', tension);
    const b = toneShelfFor(decks[xfade.to]?.scene ?? 'bedroom', tension);
    return a + (b - a) * progress();
  }

  /** Move a deck to a level quickly but never instantly: notes may still be ringing on it. */
  function setDeckLevel(deck: Deck, v: number, at: number): void {
    for (const g of [deck.level, deck.padLevel, deck.verbLevel, deck.echoLevel]) rampParam(g.gain, v, at, 0.03);
  }

  /** Equal-power fade of one deck from `from` to `to` over `dur` seconds from `at`. */
  function fadeDeck(deck: Deck, rising: boolean, at: number, dur: number): void {
    const SEGMENTS = 10;
    for (const g of [deck.level, deck.padLevel, deck.verbLevel, deck.echoLevel]) {
      try {
        g.gain.cancelScheduledValues(at);
        g.gain.setValueAtTime(rising ? 0 : 1, at);
        for (let i = 1; i <= SEGMENTS; i++) {
          const x = i / SEGMENTS;
          const v = rising ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
          g.gain.linearRampToValueAtTime(v < 1e-4 ? 0 : v, at + x * dur);
        }
      } catch {
        setParam(g.gain, rising ? 1 : 0);
      }
    }
  }

  function releaseTexture(deck: Deck, at: number, fadeS: number): void {
    deck.texture?.release(at, fadeS);
    deck.texture = null;
  }

  function ensureTexture(deck: Deck, at: number): void {
    const kind = SCENES[deck.scene].texture;
    if (kind === 'none' || !audible('texture')) {
      releaseTexture(deck, at, 0.5);
      return;
    }
    if (deck.texture && !deck.texture.released) {
      deck.texture.extend(at + DRONE_LEASE_S);
      return;
    }
    // Beds go straight onto the deck's crossfaded level; the vinyl is as loud
    // as the scene's crackle, the hum is the room's own.
    deck.texture = startDrone(ctx, deck.level, kind === 'vinyl' ? VINYL : HUM, at);
    if (kind === 'vinyl') deck.texture?.setTrim(SCENES[deck.scene].mix.crackle, at, 0.01);
  }

  /** Jump straight to `next` with no crossfade (the score is not playing). */
  function adopt(next: SceneKey, at: number): void {
    xfade = null;
    pendingScene = null;
    const other = decks[1 - primary];
    if (other) {
      other.active = false;
      releaseTexture(other, at, 0.1);
      setDeckLevel(other, 0, at);
    }
    const deck = current();
    if (deck.scene !== next) releaseTexture(deck, at, 0.1);
    deck.scene = next;
    deck.active = true;
    applyMix(deck);
    setDeckLevel(deck, 1, at);
  }

  function startCrossfade(next: SceneKey, at: number): void {
    const from = primary;
    const to = 1 - primary;
    const incoming = decks[to];
    const outgoing = decks[from];
    if (!incoming || !outgoing) return;
    const bpmFrom = SCENES[outgoing.scene].bpm;
    const bpmTo = SCENES[next].bpm;
    releaseTexture(incoming, at, 0.05);
    incoming.scene = next;
    incoming.active = true;
    applyMix(incoming);
    const dur = (XFADE_BARS * STEPS_PER_BAR * 15) / ((bpmFrom + bpmTo) / 2);
    fadeDeck(incoming, true, at, dur);
    fadeDeck(outgoing, false, at, dur);
    xfade = { from, to, startBar: bar, endBar: bar + XFADE_BARS, bpmFrom, bpmTo };
  }

  function finishCrossfade(at: number): void {
    if (!xfade) return;
    const outgoing = decks[xfade.from];
    if (outgoing) {
      outgoing.active = false;
      releaseTexture(outgoing, at, 0.3);
    }
    primary = xfade.to;
    xfade = null;
  }

  function barLine(at: number): void {
    if (xfade && bar >= xfade.endBar) finishCrossfade(at);
    if (!xfade && pendingScene !== null) {
      if (pendingScene !== current().scene) startCrossfade(pendingScene, at);
      pendingScene = null;
    }
    for (const deck of decks) if (deck.active) ensureTexture(deck, at);
    pressure?.extend(at + DRONE_LEASE_S);
    if (echoDelay) rampParam(echoDelay.delayTime, echoTime(bpmNow()), at, 0.05);
  }

  function deckAudible(i: number): boolean {
    const deck = decks[i];
    if (!deck || !deck.active) return false;
    // The outgoing deck's last few steps are inaudible; skip their voices.
    if (xfade && xfade.from === i && progress() > 0.94) return false;
    return true;
  }

  // --- instruments -----------------------------------------------------------

  function epiano(out: AudioNode, midi: number, vel: number, t: number, dur: number, bright: number, gain: number, detune: number): void {
    playFM(ctx, out, {
      freq: mtof(midi),
      ...FM.epiano,
      index: FM.epiano.index * bright * (0.7 + 0.3 * vel),
      when: t,
      hold: Math.min(dur, 0.5),
      gain: gain * vel,
      detune,
      env: { a: 0.003, d: 1.1, s: 0.3, r: 0.35 },
      filter: { type: 'lowpass', freq: 2600 + 1400 * bright, q: 0.5 },
      priority: 1,
      pool,
    });
  }

  function playNote(deck: Deck, n: MusicNote, t: number, stepDur: number): void {
    const s = SCENES[deck.scene];
    const out = deck.parts[n.part];
    const dur = n.steps * stepDur;
    // Lo-fi wow: a few cents of drift, different on every note but repeatable.
    const wow = (hash01(bar * 16 + step, n.midi, 0x0f0) - 0.5) * (s.texture === 'vinyl' ? 14 : 5);
    switch (n.part) {
      case 'pad': {
        const hold = Math.max(0, dur - 1.1);
        if (s.pad === 'wide') {
          // Spread by alternating the chord tones left and right, a few cents
          // apart: wide, one voice a note, and it folds to mono cleanly.
          const side = n.midi % 2 === 0 ? -1 : 1;
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ratio: 1,
            indexStart: 0.8,
            index: 1.9,
            indexEnd: 1.5,
            indexTime: 1.8,
            detune: side * 5,
            pan: side * 0.4,
            when: t,
            hold,
            gain: 0.07 * n.vel,
            env: { a: 1.2, d: 0.5, s: 0.85, r: 1.7 },
            priority: 2,
            pool,
          });
        } else {
          const hollow = s.pad === 'hollow';
          // Rich on purpose: the context filter in front of the pad is what
          // keeps it muffled while the window is empty.
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ratio: hollow ? 2 : 1,
            modOffset: hollow ? 0.3 : 0,
            indexStart: 0.9,
            index: hollow ? 2 : 2.2,
            indexEnd: hollow ? 1.6 : 1.8,
            indexTime: 1.6,
            detune: wow,
            when: t,
            hold,
            gain: 0.06 * n.vel,
            env: { a: 0.9, d: 0.5, s: 0.85, r: 1.5 },
            priority: 2,
            pool,
          });
        }
        return;
      }
      case 'keys':
        epiano(out, n.midi, n.vel, t, dur, 0.9, 0.07, wow);
        return;
      case 'lead': {
        if (s.lead === 'glass') {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ...FM.glass,
            index: 1.3,
            indexEnd: 0.2,
            indexTime: 0.6,
            when: t,
            hold: 0,
            gain: 0.22 * n.vel,
            env: { a: 0.002, d: 1.4, s: 0, r: 0.3 },
            filter: { type: 'lowpass', freq: 8000, q: 0.5 },
            priority: 2,
            pool,
          });
        } else if (s.lead === 'hollow') {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ...FM.hollow,
            index: 1.1,
            indexEnd: 0.75,
            indexTime: 0.4,
            when: t,
            hold: Math.max(0, dur - 0.08),
            gain: 0.1 * n.vel,
            env: { a: 0.02, d: 0.1, s: 0.75, r: 0.18 },
            filter: { type: 'lowpass', freq: 1900, q: 0.6 },
            priority: 2,
            pool,
          });
        } else {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ...FM.epiano,
            index: 1.9 * (0.7 + 0.3 * n.vel),
            indexEnd: 0.3,
            indexTime: 0.4,
            when: t,
            hold: Math.min(dur, 0.6),
            gain: 0.1 * n.vel,
            detune: wow,
            env: { a: 0.003, d: 1.2, s: 0.35, r: 0.3 },
            filter: { type: 'lowpass', freq: 3600, q: 0.5 },
            priority: 2,
            pool,
          });
        }
        return;
      }
      case 'bass': {
        if (s.bassVoice === 'grit') {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ratio: 1,
            index: 2.6,
            indexEnd: 1.5,
            indexTime: 0.12,
            crush: 5,
            when: t,
            hold: Math.max(0, dur * 0.7 - 0.08),
            gain: 0.2 * n.vel,
            env: { a: 0.003, d: 0.12, s: 0.55, r: 0.05 },
            filter: { type: 'lowpass', freq: 1300, q: 0.9 },
            priority: 2,
            pool,
          });
        } else if (s.bassVoice === 'sub') {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ratio: 1,
            index: 0.8,
            indexEnd: 0.4,
            indexTime: 0.4,
            when: t,
            hold: Math.max(0, dur - 0.5),
            gain: 0.14 * n.vel,
            env: { a: 0.04, d: 0.4, s: 0.75, r: 0.45 },
            filter: { type: 'lowpass', freq: 420, q: 0.5 },
            priority: 2,
            pool,
          });
        } else {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ...FM.bass,
            when: t,
            hold: Math.max(0, dur * 0.8 - 0.1),
            gain: 0.2 * n.vel,
            env: { a: 0.005, d: 0.25, s: 0.55, r: 0.08 },
            filter: { type: 'lowpass', freq: 750, q: 0.6 },
            priority: 2,
            pool,
          });
        }
        return;
      }
      case 'kick': {
        const grit = deck.scene === 'datacenter';
        const soft = deck.scene === 'orbital';
        playFM(ctx, out, {
          freq: 130,
          freqEnd: 45,
          glideTime: 0.06,
          ratio: 1.5,
          index: soft ? 1 : 2,
          indexEnd: 0,
          indexTime: 0.012,
          crush: grit ? 7 : undefined,
          when: t,
          hold: 0,
          gain: 0.34 * n.vel,
          env: { a: 0.001, d: soft ? 0.38 : 0.28, s: 0, r: 0.05 },
          filter: { type: 'lowpass', freq: 1600, q: 0.5 },
          priority: 2,
          pool,
        });
        return;
      }
      case 'snare': {
        playTone(ctx, out, {
          wave: 'noise',
          when: t,
          hold: 0.004,
          gain: 0.24 * n.vel,
          rate: 0.9,
          env: { a: 0.001, d: 0.16, s: 0, r: 0.04 },
          filter: { type: 'bandpass', freq: 1900, q: 0.7 },
          priority: 1,
          pool,
        });
        playFM(ctx, out, {
          freq: 190,
          freqEnd: 150,
          glideTime: 0.05,
          ratio: 1,
          index: 1,
          indexEnd: 0,
          indexTime: 0.02,
          when: t,
          hold: 0,
          gain: 0.14 * n.vel,
          env: { a: 0.001, d: 0.08, s: 0, r: 0.03 },
          priority: 1,
          pool,
        });
        return;
      }
      case 'rim': {
        playFM(ctx, out, {
          freq: deck.scene === 'datacenter' ? 830 : 1150,
          ratio: deck.scene === 'datacenter' ? 1.414 : 1.6,
          index: deck.scene === 'datacenter' ? 3 : 1.4,
          indexEnd: 0,
          indexTime: 0.01,
          when: t,
          hold: 0,
          gain: 0.17 * n.vel,
          env: { a: 0.001, d: 0.04, s: 0, r: 0.015 },
          filter: { type: 'lowpass', freq: 5000, q: 0.5 },
          priority: 0,
          pool,
        });
        return;
      }
      case 'hat': {
        const decay = n.open ? 0.17 : 0.035;
        if (s.hatVoice === 'metal') {
          playFM(ctx, out, {
            freq: 3100,
            ...FM.metal,
            index: 3,
            indexEnd: 0.5,
            indexTime: 0.02,
            when: t,
            hold: 0,
            gain: 0.14 * n.vel,
            env: { a: 0.001, d: 0.035, s: 0, r: 0.012 },
            filter: { type: 'highpass', freq: 4500, q: 0.6 },
            priority: 0,
            pool,
          });
        } else {
          const shaker = s.hatVoice === 'shaker';
          playTone(ctx, out, {
            wave: 'noise',
            when: t,
            hold: 0,
            gain: (s.hatVoice === 'tick' ? 0.22 : 0.2) * n.vel,
            rate: 1,
            env: { a: shaker ? 0.008 : 0.001, d: shaker ? 0.05 : decay, s: 0, r: 0.02 },
            filter: shaker
              ? { type: 'bandpass', freq: 6000, q: 0.8 }
              : { type: 'highpass', freq: s.hatVoice === 'tick' ? 7000 : 6000, q: 0.6 },
            priority: 0,
            pool,
          });
        }
        return;
      }
      case 'arp': {
        if (s.arpVoice === 'glass') {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ...FM.glass,
            index: 1,
            indexEnd: 0.15,
            indexTime: 0.3,
            when: t,
            hold: 0,
            gain: 0.16 * n.vel,
            env: { a: 0.002, d: 0.5, s: 0, r: 0.12 },
            pan: n.pan,
            filter: { type: 'lowpass', freq: 7000, q: 0.5 },
            priority: 0,
            pool,
          });
        } else if (s.arpVoice === 'epiano') {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ...FM.epiano,
            index: 1.2,
            when: t,
            hold: 0,
            gain: 0.12 * n.vel,
            detune: wow,
            env: { a: 0.003, d: 0.5, s: 0, r: 0.15 },
            pan: n.pan,
            filter: { type: 'lowpass', freq: 3000, q: 0.5 },
            priority: 0,
            pool,
          });
        } else {
          playFM(ctx, out, {
            freq: mtof(n.midi),
            ratio: 3,
            index: 1.3,
            indexEnd: 0.15,
            indexTime: 0.06,
            when: t,
            hold: 0,
            gain: 0.2 * n.vel,
            env: { a: 0.002, d: 0.26, s: 0, r: 0.06 },
            pan: n.pan,
            filter: { type: 'lowpass', freq: deck.scene === 'datacenter' ? 1900 : 3800, q: 0.5 },
            priority: 0,
            pool,
          });
        }
        return;
      }
      case 'crackle': {
        playTone(ctx, out, {
          wave: 'noise',
          when: t,
          hold: 0,
          gain: 0.12 * n.vel,
          rate: 1.5,
          env: { a: 0.0005, d: 0.004, s: 0, r: 0.003 },
          filter: { type: 'highpass', freq: 2500, q: 0.6 },
          priority: 0,
          pool,
        });
        return;
      }
      default:
        return;
    }
  }

  // --- the scheduler -----------------------------------------------------------

  function smooth(now: number): void {
    tension += (tensionTarget - tension) * TENSION_LERP;
    if (Math.abs(tensionTarget - tension) < 0.001) tension = tensionTarget;
    fill += (fillTarget - fill) * FILL_LERP;
    if (Math.abs(fillTarget - fill) < 0.001) fill = fillTarget;

    const target = now < duckUntil ? 1 - duckDepth : 1;
    duckLevel += (target - duckLevel) * (target < duckLevel ? 0.45 : 0.035);
    if (Math.abs(target - duckLevel) < 0.002) duckLevel = target;

    // Ramps run slightly longer than a tick so the params glide continuously.
    const ramp = (LOOKAHEAD_MS / 1000) * 2.2;
    rampParam(tone.gain, toneNow(), now, ramp);
    rampParam(padLP.frequency, padCutoffFor(fill), now, ramp);
    const p = pressureFor(fill);
    rampParam(padLP.Q, 0.7 + 1.4 * p, now, ramp);
    rampParam(duckGain.gain, duckLevel, now, ramp);
    for (const deck of decks) {
      if (!deck.active) continue;
      const mix = SCENES[deck.scene].mix;
      if (audible('hat')) rampParam(deck.parts.hat.gain, mix.hat * (0.7 + 0.3 * tension), now, ramp);
      if (audible('arp')) rampParam(deck.parts.arp.gain, mix.arp * (0.8 + 0.2 * tension), now, ramp);
    }

    if (p > 0.001 && audible('pressure')) {
      if (!pressure || pressure.released) pressure = startDrone(ctx, pressureBus, PRESSURE, now);
      pressure?.setTrim(p, now, ramp);
    } else if (pressure) {
      pressure.release(now, 1.2);
      pressure = null;
    }
  }

  /** Parts a fading-out deck stops bothering with past the crossfade's midpoint. */
  const DISPOSABLE: ReadonlySet<PartName> = new Set<PartName>(['hat', 'arp', 'crackle', 'rim']);

  function scheduleStep(t: number, stepDur: number): void {
    for (let i = 0; i < decks.length; i++) {
      if (!deckAudible(i)) continue;
      const deck = decks[i];
      if (!deck) continue;
      const s = SCENES[deck.scene];
      const swing = step % 2 === 1 ? s.swing * stepDur : 0;
      const fadingOut = xfade !== null && xfade.from === i && progress() > 0.5;
      for (const n of arrange(deck.scene, bar, step, tension)) {
        if (fadingOut && DISPOSABLE.has(n.part)) continue;
        const when = t + swing + Math.max(0, n.nudge) * stepDur;
        opts.onNote?.(deck.scene, n, when);
        playNote(deck, n, when, stepDur);
      }
    }
  }

  function tick(): void {
    if (destroyed) return;
    const now = ctx.currentTime;
    smooth(now);

    // Resync after tab throttling / clock jumps: drop the missed notes.
    if (nextStepTime < now) nextStepTime = now + 0.02;

    let guard = 0;
    while (nextStepTime < now + SCHEDULE_AHEAD_S && guard++ < 64) {
      const stepDur = 60 / Math.max(30, bpmNow()) / 4;
      if (step === 0) barLine(nextStepTime);
      scheduleStep(nextStepTime, stepDur);
      nextStepTime += stepDur;
      step++;
      if (step >= STEPS_PER_BAR) {
        step = 0;
        bar++;
      }
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      timers.clearInterval(timer);
      timer = null;
    }
  }

  /** Silence and park everything that runs on its own: drones, the crossfade. */
  function park(): void {
    const now = ctx.currentTime;
    rampParam(master.gain, 0, now, 0.12);
    if (xfade) adopt(decks[xfade.to]?.scene ?? sceneKey, now);
    if (pendingScene !== null) adopt(pendingScene, now);
    for (const deck of decks) releaseTexture(deck, now, 0.12);
    pressure?.release(now, 0.12);
    pressure = null;
  }

  const api: MusicController = {
    start() {
      if (destroyed || timer !== null || !enabled || hidden) return;
      const now = ctx.currentTime;
      if (pendingScene !== null || xfade) adopt(pendingScene ?? decks[xfade?.to ?? primary]?.scene ?? sceneKey, now);
      nextStepTime = now + 0.06;
      step = 0;
      bar = 0;
      timer = timers.setInterval(tick, LOOKAHEAD_MS);
      rampParam(master.gain, 1, now, 0.3);
      smooth(now);
    },
    stop() {
      clearTimer();
      if (!destroyed) park();
    },
    suspend() {
      if (hidden) return;
      hidden = true;
      clearTimer();
      if (!destroyed) park();
    },
    resume() {
      if (!hidden) return;
      hidden = false;
      api.start();
    },
    setScene(next) {
      if (destroyed) return;
      if (!SCENES[next]) return;
      sceneKey = next;
      if (timer === null) {
        // Not playing: adopt immediately, there is no crossfade to hear.
        adopt(next, ctx.currentTime);
        return;
      }
      if (xfade) {
        pendingScene = next === decks[xfade.to]?.scene ? null : next;
        return;
      }
      pendingScene = next === current().scene ? null : next;
    },
    setTension(t) {
      tensionTarget = clamp(t, 0, 1);
      if (destroyed) return;
      if (timer === null) tension = tensionTarget;
    },
    setContextFill(f) {
      fillTarget = saturate(Number.isNaN(f) ? 0 : f);
      if (destroyed) return;
      if (timer === null) fill = fillTarget;
    },
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled) api.stop();
      else api.start();
    },
    duck(depth, holdS) {
      if (destroyed) return;
      const d = clamp(depth, 0, 1);
      const until = ctx.currentTime + Math.max(0, holdS);
      if (until > duckUntil || d > duckDepth) {
        duckDepth = Math.max(d, ctx.currentTime < duckUntil ? duckDepth : 0);
        duckUntil = Math.max(until, duckUntil);
      }
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
    get contextFill() {
      return fill;
    },
    inspect(): MusicState {
      return {
        playing: current().scene,
        crossfading: xfade !== null,
        bpm: bpmNow(),
        bar,
        step,
        tension,
        contextFill: fill,
        padCutoff: padCutoffFor(fill),
        pressure: pressureFor(fill),
        toneShelf: toneNow(),
        duck: duckLevel,
        voices: pool.active,
        rejected: pool.rejected,
      };
    },
    destroy() {
      if (destroyed) return;
      clearTimer();
      destroyed = true;
      const now = ctx.currentTime;
      try {
        pool.killAll(now);
      } catch {
        /* ignore */
      }
      for (const deck of decks) releaseTexture(deck, now, 0.02);
      pressure?.release(now, 0.02);
      pressure = null;
      try {
        master.disconnect();
      } catch {
        /* ignore */
      }
    },
  };

  return api;
}
