/**
 * Synthesis primitives for the "inside the machine" palette. Zero audio
 * assets: every sound in the game is built here at runtime.
 *
 * The core voice is two-operator FM (`playFM`): a sine modulator drives a sine
 * carrier's frequency, with its own index envelope. A handful of presets
 * (`FM`) cover the palette:
 *   - non-integer ratios ring like glass bells,
 *   - ratio 1 with a decaying index is a soft e-piano,
 *   - ratio 1 with a low index is a round bass,
 *   - inharmonic ratios with a hot index make metallic hits.
 * Filtered noise (`playTone` with `wave: 'noise'`) supplies the data
 * textures, and a staircase WaveShaper (`crush`) adds digital grit where a
 * sound wants it.
 *
 * Every voice:
 *   - allocates one slot from a `VoicePool` (a hard cap on concurrent voices;
 *     an FM voice is one slot however many oscillators it runs),
 *   - builds `source(s) -> [crush] -> [filter] -> amp -> [panner] -> out`, with
 *     an optional send tap after the amp,
 *   - applies an ADSR to the amp,
 *   - always schedules an explicit `stop()` and disconnects on `ended`.
 *
 * Long-running beds (vinyl hiss, the machine-room hum, the context "pressure"
 * drone) are `Drone`s instead: they run on a renewable stop lease, so a drone
 * whose owner stops renewing it still switches itself off.
 */

import { setParam } from './context.ts';

export type Wave = 'sine' | 'triangle' | 'saw' | 'noise';

export interface ADSR {
  /** Attack, seconds. */
  readonly a: number;
  /** Decay, seconds. */
  readonly d: number;
  /** Sustain level, 0..1 of peak. */
  readonly s: number;
  /** Release, seconds. */
  readonly r: number;
}

export const DEFAULT_ADSR: ADSR = { a: 0.004, d: 0.06, s: 0.5, r: 0.12 };

/** Length of the cached white-noise buffer, in seconds. */
const NOISE_SECONDS = 1.7;
/** Extra time after the envelope ends before the sources are stopped. */
const STOP_SLACK = 0.012;

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Clamp an amount into 0..1 where both ends mean something: NaN reads as 0,
 * but an infinite reading sits at the end it points to. (`clamp` sends every
 * non-finite value to `lo`, which is right for volumes, wrong for "how full".)
 */
export function saturate(v: number): number {
  return v >= 1 ? 1 : v > 0 ? v : 0;
}

/** MIDI note number -> Hz. */
export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A small deterministic PRNG (mulberry32). Audio variation never touches the
 * sim's seeded RNG, but it stays reproducible so tests can fingerprint sounds.
 */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stateless hash of a few integers into [0, 1): repeatable "randomness" for the score. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Voice budget
// ---------------------------------------------------------------------------

/** Voices at or below this priority can be stolen when the pool is full. */
export const LOW_PRIORITY = 0;
/** Voices at or above this priority are allowed to steal a low-priority slot. */
export const STEAL_PRIORITY = 2;

export interface VoiceSlot {
  /** Context time (seconds) at which this voice frees itself. */
  end: number;
  priority: number;
  /** Fade + stop this voice early. Replaced by the voice builder. */
  kill: (at: number) => void;
}

/**
 * Hard cap on simultaneous voices.
 *
 * Policy when full: reject the *incoming* sound if it is low priority, so a
 * mashed click can never cut off a report. High-priority sounds may steal a
 * single low-priority slot; they never exceed the cap.
 */
export class VoicePool {
  readonly cap: number;
  /** Voices refused because the pool was full (diagnostics). */
  rejected = 0;
  /** Voices killed early to make room (diagnostics). */
  stolen = 0;
  private readonly voices: VoiceSlot[] = [];

  constructor(cap: number) {
    this.cap = Math.max(1, Math.floor(cap));
  }

  get active(): number {
    return this.voices.length;
  }

  /** Drop voices whose scheduled end has already passed. */
  prune(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v && v.end <= now) this.voices.splice(i, 1);
    }
  }

  alloc(now: number, end: number, priority: number): VoiceSlot | null {
    this.prune(now);
    const slot: VoiceSlot = { end, priority, kill: noopKill };
    if (this.voices.length < this.cap) {
      this.voices.push(slot);
      return slot;
    }
    if (priority >= STEAL_PRIORITY) {
      let victimIdx = -1;
      let victimEnd = -Infinity;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (!v || v.priority > LOW_PRIORITY) continue;
        // Steal the newest low-priority voice (longest remaining tail).
        if (v.end > victimEnd) {
          victimEnd = v.end;
          victimIdx = i;
        }
      }
      if (victimIdx >= 0) {
        const victim = this.voices[victimIdx];
        this.voices.splice(victimIdx, 1);
        this.stolen++;
        if (victim) {
          try {
            victim.kill(now);
          } catch {
            /* ignore */
          }
        }
        this.voices.push(slot);
        return slot;
      }
    }
    this.rejected++;
    return null;
  }

  release(slot: VoiceSlot): void {
    const i = this.voices.indexOf(slot);
    if (i >= 0) this.voices.splice(i, 1);
  }

  killAll(now: number): void {
    const all = this.voices.splice(0, this.voices.length);
    for (const v of all) {
      try {
        v.kill(now);
      } catch {
        /* ignore */
      }
    }
  }
}

function noopKill(): void {
  /* replaced once the voice owns real nodes */
}

// ---------------------------------------------------------------------------
// Cached sources and curves
// ---------------------------------------------------------------------------

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/**
 * White noise, generated once per context and reused by every noise voice.
 * Deterministic LCG so the texture is identical run to run.
 */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer | null {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  if (typeof ctx.createBuffer !== 'function') return null;
  try {
    const sampleRate = ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
    const length = Math.max(1, Math.floor(sampleRate * NOISE_SECONDS));
    const buf = ctx.createBuffer(1, length, sampleRate);
    const data = buf.getChannelData(0);
    let s = 0x9e3779b9;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const v = (s / 0xffffffff) * 2 - 1;
      data[i] = v;
      sum += v;
    }
    // Remove the (tiny) mean so a long noise bed carries no DC.
    const mean = sum / length;
    for (let i = 0; i < length; i++) data[i] = (data[i] ?? 0) - mean;
    noiseCache.set(ctx, buf);
    return buf;
  } catch {
    return null;
  }
}

const crushCache = new Map<number, Float32Array<ArrayBuffer>>();
const CURVE_POINTS = 4096;

/**
 * A staircase transfer curve for a `WaveShaperNode`: bit-depth reduction.
 * Symmetric (mid-tread), so it adds grit but no DC. Fed a full-scale source
 * (the voice builder puts it ahead of the amp), so the grit is the same at
 * every playback level.
 */
export function crushCurve(bits: number): Float32Array<ArrayBuffer> {
  const b = Math.round(clamp(bits, 2, 12));
  const hit = crushCache.get(b);
  if (hit) return hit;
  const levels = 2 ** (b - 1);
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i / (CURVE_POINTS - 1)) * 2 - 1;
    curve[i] = (Math.sign(x) * Math.round(Math.abs(x) * levels)) / levels;
  }
  crushCache.set(b, curve);
  return curve;
}

const cosineCache = new WeakMap<BaseAudioContext, PeriodicWave>();

/**
 * A cosine, as a `PeriodicWave`. FM modulators run in cosine phase: driving a
 * carrier's frequency with a sine integrates to a phase offset, which puts a
 * DC component on every sideband that lands at 0 Hz (any ratio of 1/n, the
 * e-piano's 1:1 included). In cosine phase those components vanish.
 * `null` when the platform has no `createPeriodicWave` (a plain sine then).
 */
export function cosineWave(ctx: BaseAudioContext): PeriodicWave | null {
  const hit = cosineCache.get(ctx);
  if (hit) return hit;
  if (typeof ctx.createPeriodicWave !== 'function') return null;
  try {
    const wave = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), {
      disableNormalization: true,
    });
    cosineCache.set(ctx, wave);
    return wave;
  } catch {
    return null;
  }
}

function setModulatorWave(ctx: BaseAudioContext, mod: OscillatorNode): void {
  const cos = cosineWave(ctx);
  if (cos && typeof mod.setPeriodicWave === 'function') mod.setPeriodicWave(cos);
  else mod.type = 'sine';
}

const irCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

export interface ReverbSpec {
  /** Seconds to -60 dB. */
  readonly seconds: number;
  /** 0..1: how much faster the highs die than the lows. */
  readonly damp: number;
  /** Silence before the tail starts, seconds. */
  readonly preDelay: number;
  readonly seed: number;
}

/**
 * A synthetic stereo impulse response: exponentially decaying noise that
 * darkens as it fades, like a small digital room. The two channels are
 * independent noise, which stays mono-safe (their sum is just a mono tail).
 */
export function reverbImpulse(ctx: BaseAudioContext, spec: ReverbSpec): AudioBuffer | null {
  if (typeof ctx.createBuffer !== 'function') return null;
  const key = `${spec.seconds}:${spec.damp}:${spec.preDelay}:${spec.seed}`;
  let byKey = irCache.get(ctx);
  if (!byKey) {
    byKey = new Map<string, AudioBuffer>();
    irCache.set(ctx, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;
  try {
    const sr = ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
    const pre = Math.floor(clamp(spec.preDelay, 0, 0.1) * sr);
    const len = pre + Math.max(1, Math.floor(clamp(spec.seconds, 0.05, 6) * sr));
    const buf = ctx.createBuffer(2, len, sr);
    const damp = clamp(spec.damp, 0, 0.98);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let s = (spec.seed + ch * 0x51ed27) >>> 0 || 1;
      let lp = 0;
      for (let i = pre; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const white = (s / 0xffffffff) * 2 - 1;
        const t = (i - pre) / (len - pre);
        // One-pole lowpass whose cutoff falls as the tail ages.
        const k = 1 - damp * Math.min(1, t * 1.6);
        lp += k * (white - lp);
        const env = Math.exp(-6.9 * t) * Math.min(1, (i - pre) / (sr * 0.003));
        data[i] = lp * env;
      }
    }
    byKey.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface EnvTimes {
  readonly attackEnd: number;
  readonly decayEnd: number;
  readonly sustainEnd: number;
  readonly end: number;
}

export function envTimes(t0: number, hold: number, env: ADSR): EnvTimes {
  const a = Math.max(0.0005, env.a);
  const d = Math.max(0.0005, env.d);
  const r = Math.max(0.005, env.r);
  const attackEnd = t0 + a;
  const decayEnd = attackEnd + d;
  const sustainEnd = decayEnd + Math.max(0, hold);
  return { attackEnd, decayEnd, sustainEnd, end: sustainEnd + r + 0.004 };
}

/**
 * Write a full ADSR onto a gain param. Returns the absolute time at which the
 * envelope reaches silence. The decay and the release are exponential, the
 * way struck and plucked things die away.
 */
export function applyADSR(p: AudioParam, t0: number, peak: number, hold: number, env: ADSR): number {
  const t = envTimes(t0, hold, env);
  const level = Math.max(peak, 1e-4);
  const sustain = Math.max(level * clamp(env.s, 0, 1), 1e-4);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(level, t.attackEnd);
  p.exponentialRampToValueAtTime(sustain, t.decayEnd);
  p.setValueAtTime(sustain, t.sustainEnd);
  // Finish on a hard zero so the param never idles at a non-zero floor.
  p.exponentialRampToValueAtTime(Math.max(sustain * 0.001, 1e-5), t.end - 0.004);
  p.linearRampToValueAtTime(0, t.end);
  return t.end;
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export interface FilterSpec {
  readonly type: BiquadFilterType;
  readonly freq: number;
  /** Sweep target, reached at `sweep` seconds (default: the end of the sustain). */
  readonly freqEnd?: number;
  readonly sweep?: number;
  readonly q?: number;
}

/** What every voice shares, FM or not. */
export interface VoiceOpts {
  /** Absolute context time. Defaults to now. */
  readonly when?: number;
  /** Sustain length, seconds (on top of A + D + R). */
  readonly hold?: number;
  /** Peak linear gain. */
  readonly gain?: number;
  readonly env?: Partial<ADSR>;
  /** Cents, applied to every oscillator in the voice (keeps FM ratios intact). */
  readonly detune?: number;
  /** -1..1. Skipped when the platform has no StereoPanner. */
  readonly pan?: number;
  readonly filter?: FilterSpec;
  /** Bit depth of a staircase WaveShaper ahead of the filter: digital grit. */
  readonly crush?: number;
  /** Level of a tap after the amp into `sendTo` (a reverb), 0..1. */
  readonly send?: number;
  readonly sendTo?: AudioNode | null;
  readonly priority?: number;
  readonly pool?: VoicePool | null;
}

/**
 * Pitch breakpoints after the note starts: at `dt` seconds the pitch has
 * reached `hz`. `step` jumps there instead of ramping.
 */
export type PitchPoint = readonly [dt: number, hz: number, curve?: 'exp' | 'lin' | 'step'];

export interface ToneOpts extends VoiceOpts {
  readonly wave?: Wave;
  /** Hz. Ignored for noise. */
  readonly freq?: number;
  /** Glide target, reached at the end of the sustain phase. */
  readonly freqEnd?: number;
  readonly glide?: 'lin' | 'exp';
  /** Noise playback rate (a crude brightness control). */
  readonly rate?: number;
  readonly rateEnd?: number;
}

export interface FMOpts extends VoiceOpts {
  /** Carrier frequency, Hz. */
  readonly freq: number;
  /** Modulator / carrier frequency ratio. Default 1. */
  readonly ratio?: number;
  /** Hz added to the modulator: slow beating, or an inharmonic edge. */
  readonly modOffset?: number;
  /** Modulation index at the end of the attack. Default 1. */
  readonly index?: number;
  /** Index at the note's start, ramping to `index` over the attack (brass). Default `index`. */
  readonly indexStart?: number;
  /** Where the index settles after the attack. Default `index` * 0.25. */
  readonly indexEnd?: number;
  /** Roughly how long it takes to settle, seconds. Default 0.15. */
  readonly indexTime?: number;
  readonly carrier?: 'sine' | 'triangle';
  /** Glide target for the carrier (the modulator follows the ratio). */
  readonly freqEnd?: number;
  readonly glide?: 'lin' | 'exp';
  /** Seconds the glide takes. Default: to the end of the sustain. */
  readonly glideTime?: number;
  /** Pitch breakpoints, instead of a single glide. */
  readonly pitch?: readonly PitchPoint[];
}

/**
 * Ready-made FM characters. Spread them into `playFM` options and override
 * what differs.
 */
export const FM = {
  /** Soft e-piano: ratio 1, a bright strike mellowing out. */
  epiano: { ratio: 1, index: 1.7, indexEnd: 0.28, indexTime: 0.45 },
  /** Glassy bell: a non-integer ratio rings inharmonic partials. */
  glass: { ratio: 3.5, index: 1.6, indexEnd: 0.2, indexTime: 0.5 },
  /** Chowning's bell ratio: darker, gong-ish. */
  bell: { ratio: 1.4, index: 2.2, indexEnd: 0.3, indexTime: 0.6 },
  /** Round bass: ratio 1, gentle index. */
  bass: { ratio: 1, index: 1.1, indexEnd: 0.4, indexTime: 0.2 },
  /** Hollow: 1:2 gives odd harmonics only, a soft reedy tone. */
  hollow: { ratio: 2, index: 1.2, indexEnd: 0.6, indexTime: 0.3 },
  /** Metallic hit: inharmonic ratio, hot index, fast collapse. */
  metal: { ratio: 1.414, index: 4.5, indexEnd: 0.4, indexTime: 0.07 },
  /** Wood: a quick index spike on a near-integer ratio. */
  wood: { ratio: 2.01, index: 2.4, indexEnd: 0.05, indexTime: 0.025 },
} as const;

type SourceBuilder = (head: AudioNode, t0: number, times: EnvTimes, nodes: AudioNode[]) => AudioScheduledSourceNode[];

function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * The shared voice plumbing. `build` creates the sources, wires them into
 * `head`, pushes any helper nodes into `nodes` and returns the sources; this
 * starts, stops and cleans them up. The first source's `ended` frees the voice.
 */
function voice(ctx: BaseAudioContext, out: AudioNode, o: VoiceOpts, build: SourceBuilder): number | null {
  const peak = Math.max(0, o.gain ?? 0.2);
  if (!(peak > 0.0005)) return null;

  const env: ADSR = { ...DEFAULT_ADSR, ...(o.env ?? {}) };
  const now = ctx.currentTime;
  const t0 = Math.max(o.when ?? now, now);
  const hold = Math.max(0, o.hold ?? 0.05);
  const times = envTimes(t0, hold, env);
  const stopAt = times.end + STOP_SLACK;
  const pool = o.pool ?? null;

  let slot: VoiceSlot | null = null;
  if (pool) {
    slot = pool.alloc(now, stopAt, o.priority ?? 1);
    if (!slot) return null;
  }

  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  try {
    const amp = ctx.createGain();
    nodes.push(amp);
    // Silent from the moment it exists, not just from t0: a GainNode idles at
    // 1 until its first automation event, and a source started between two
    // sample frames emits its first (sub-sample) frame just ahead of the
    // envelope's t0 — for a noise source, a full-scale spike.
    setParam(amp.gain, 0);
    applyADSR(amp.gain, t0, peak, hold, env);

    // amp -> [panner] -> out
    let sink: AudioNode = out;
    if (o.pan !== undefined && o.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      nodes.push(panner);
      setParam(panner.pan, clamp(o.pan, -1, 1));
      panner.connect(out);
      sink = panner;
    }
    amp.connect(sink);

    // amp -> send (a reverb tap), post-envelope.
    if (o.sendTo && o.send !== undefined && o.send > 0.001) {
      const tap = ctx.createGain();
      nodes.push(tap);
      setParam(tap.gain, clamp(o.send, 0, 1));
      amp.connect(tap);
      tap.connect(o.sendTo);
    }

    // [filter] -> amp
    let head: AudioNode = amp;
    if (o.filter && typeof ctx.createBiquadFilter === 'function') {
      const filter = ctx.createBiquadFilter();
      nodes.push(filter);
      filter.type = o.filter.type;
      const f0 = clamp(o.filter.freq, 20, 20000);
      setParam(filter.frequency, f0);
      filter.frequency.setValueAtTime(f0, t0);
      if (o.filter.freqEnd !== undefined) {
        const at = o.filter.sweep !== undefined ? t0 + Math.max(0.001, o.filter.sweep) : times.sustainEnd;
        filter.frequency.exponentialRampToValueAtTime(clamp(o.filter.freqEnd, 20, 20000), at);
      }
      setParam(filter.Q, o.filter.q ?? 0.7);
      filter.connect(head);
      head = filter;
    }

    // [crush] -> filter
    if (o.crush !== undefined && o.crush > 0 && typeof ctx.createWaveShaper === 'function') {
      const shaper = ctx.createWaveShaper();
      nodes.push(shaper);
      shaper.curve = crushCurve(o.crush);
      shaper.connect(head);
      head = shaper;
    }

    sources.push(...build(head, t0, times, nodes));
    const first = sources[0];
    if (!first) throw new Error('voice has no source');
    for (const s of sources) {
      nodes.push(s);
      const detune = (s as { detune?: AudioParam }).detune;
      if (o.detune && detune) setDetune(detune, o.detune, t0);
      s.start(t0);
      s.stop(stopAt);
    }

    let finished = false;
    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      disconnectAll(nodes);
      if (pool && slot) pool.release(slot);
    };
    first.onended = cleanup;

    if (slot) {
      slot.kill = (at: number): void => {
        // Fade before stopping so stealing a voice never pops.
        try {
          amp.gain.cancelScheduledValues(at);
          amp.gain.setValueAtTime(Math.max(amp.gain.value, 1e-4), at);
          amp.gain.linearRampToValueAtTime(0, at + 0.012);
        } catch {
          /* ignore */
        }
        for (const s of sources) {
          try {
            s.stop(at + 0.02);
          } catch {
            /* already stopped */
          }
        }
      };
    }
    return stopAt;
  } catch {
    disconnectAll(nodes);
    if (pool && slot) pool.release(slot);
    return null;
  }
}

function setDetune(detune: AudioParam, cents: number, t0: number): void {
  try {
    detune.setValueAtTime(cents, t0);
  } catch {
    /* lean platform */
  }
}

/** Write pitch breakpoints onto a frequency param, scaled by `mul` and offset by `add`. */
function writePitch(p: AudioParam, t0: number, f0: number, points: readonly PitchPoint[], mul: number, add: number): void {
  p.setValueAtTime(Math.max(1, f0 * mul + add), t0);
  let prevAt = t0;
  let prevHz = f0;
  for (const [dt, hz, curve] of points) {
    const at = t0 + Math.max(0.0005, dt);
    if (at <= prevAt) continue;
    const target = Math.max(1, hz * mul + add);
    if (curve === 'step') {
      p.setValueAtTime(Math.max(1, prevHz * mul + add), at - 0.0005);
      p.setValueAtTime(target, at);
    } else if (curve === 'lin') {
      p.linearRampToValueAtTime(target, at);
    } else {
      p.exponentialRampToValueAtTime(target, at);
    }
    prevAt = at;
    prevHz = hz;
  }
}

/**
 * Fire one plain voice: an oscillator or a noise source. Returns the context
 * time it finishes, or `null` when the voice was dropped (budget) or the
 * platform refused to build the graph.
 */
export function playTone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts): number | null {
  const wave: Wave = o.wave ?? 'sine';
  return voice(ctx, out, o, (head, t0, times) => {
    if (wave === 'noise') {
      const bs = ctx.createBufferSource();
      const buf = noiseBuffer(ctx);
      if (buf) bs.buffer = buf;
      bs.loop = true;
      const rate = Math.max(0.02, o.rate ?? 1);
      bs.playbackRate.setValueAtTime(rate, t0);
      if (o.rateEnd !== undefined) {
        bs.playbackRate.exponentialRampToValueAtTime(Math.max(0.02, o.rateEnd), times.sustainEnd);
      }
      bs.connect(head);
      return [bs];
    }
    const osc = ctx.createOscillator();
    osc.type = wave === 'saw' ? 'sawtooth' : wave;
    const f0 = Math.max(1, o.freq ?? 440);
    osc.frequency.setValueAtTime(f0, t0);
    if (o.freqEnd !== undefined) {
      const f1 = Math.max(1, o.freqEnd);
      if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(f1, times.sustainEnd);
      else osc.frequency.exponentialRampToValueAtTime(f1, times.sustainEnd);
    }
    osc.connect(head);
    return [osc];
  });
}

/**
 * Fire one two-operator FM voice:
 *
 *   modulator (cosine, freq * ratio + offset) -> depth (index * modulator Hz)
 *     -> carrier.frequency;  carrier -> [crush] -> [filter] -> amp -> out
 *
 * The depth param carries the index envelope, so a bright strike can mellow
 * out (e-piano), bloom (brass) or collapse (metal) independently of the amp.
 */
export function playFM(ctx: BaseAudioContext, out: AudioNode, o: FMOpts): number | null {
  return voice(ctx, out, o, (head, t0, times, nodes) => {
    const ratio = Math.max(0.01, o.ratio ?? 1);
    const offset = o.modOffset ?? 0;
    const f0 = Math.max(1, o.freq);
    const points: PitchPoint[] = o.pitch
      ? [...o.pitch]
      : o.freqEnd !== undefined
        ? [[o.glideTime ?? times.sustainEnd - t0, o.freqEnd, o.glide ?? 'exp']]
        : [];
    const last = points[points.length - 1];
    const fEnd = last ? Math.max(1, last[1]) : f0;

    const car = ctx.createOscillator();
    car.type = o.carrier ?? 'sine';
    writePitch(car.frequency, t0, f0, points, 1, 0);

    const mod = ctx.createOscillator();
    setModulatorWave(ctx, mod);
    writePitch(mod.frequency, t0, f0, points, ratio, offset);

    const depth = ctx.createGain();
    nodes.push(depth);
    const index = Math.max(0, o.index ?? 1);
    const indexStart = Math.max(0, o.indexStart ?? index);
    const indexEnd = Math.max(0, o.indexEnd ?? index * 0.25);
    const modHz0 = f0 * ratio + offset;
    const modHzEnd = fEnd * ratio + offset;
    const tau = Math.max(0.002, (o.indexTime ?? 0.15) / 3);
    setParam(depth.gain, indexStart * Math.abs(modHz0));
    depth.gain.setValueAtTime(indexStart * Math.abs(modHz0), t0);
    if (indexStart !== index) depth.gain.linearRampToValueAtTime(index * Math.abs(modHz0), times.attackEnd);
    depth.gain.setTargetAtTime(indexEnd * Math.abs(modHzEnd), times.attackEnd, tau);

    mod.connect(depth);
    depth.connect(car.frequency);
    car.connect(head);
    // The carrier comes first: its `ended` frees the voice.
    return [car, mod];
  });
}

// ---------------------------------------------------------------------------
// Drones: long-running beds on a renewable lease
// ---------------------------------------------------------------------------

export type DroneLayer =
  | {
      readonly kind: 'fm';
      readonly freq: number;
      readonly ratio: number;
      readonly index: number;
      readonly modOffset?: number;
      readonly detune?: number;
      readonly level: number;
    }
  | { readonly kind: 'sine'; readonly freq: number; readonly detune?: number; readonly level: number }
  | { readonly kind: 'noise'; readonly rate?: number; readonly filter?: FilterSpec; readonly level: number };

export interface DroneSpec {
  readonly layers: readonly DroneLayer[];
  /** Shared filter after the layers are summed. */
  readonly filter?: FilterSpec;
  /** Peak level once faded in. */
  readonly gain: number;
  readonly fadeIn: number;
  /** Seconds the drone runs unless `extend()`ed. */
  readonly lease: number;
}

export interface Drone {
  /** Push the stop lease out to `until` (context seconds). */
  extend(until: number): void;
  /** Scale the drone's level (0..1 of its spec gain), ramped. */
  setTrim(v: number, at: number, rampS: number): void;
  /** Fade out from `at` over `fadeS` and stop. Idempotent. */
  release(at: number, fadeS: number): void;
  readonly released: boolean;
  /** Context time the current lease runs out. */
  readonly until: number;
}

/**
 * Start a drone at `when`. It stops by itself when its lease runs out, so a
 * scheduler that goes away (a hidden tab, a crash) cannot leave it droning.
 * Returns `null` when the platform refuses to build it.
 */
export function startDrone(ctx: BaseAudioContext, out: AudioNode, spec: DroneSpec, when: number): Drone | null {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const t0 = Math.max(when, ctx.currentTime);
  let until = t0 + Math.max(0.1, spec.lease);
  try {
    const amp = ctx.createGain();
    nodes.push(amp);
    setParam(amp.gain, 0);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(Math.max(0, spec.gain), t0 + Math.max(0.01, spec.fadeIn));
    amp.connect(out);

    const trim = ctx.createGain();
    nodes.push(trim);
    setParam(trim.gain, 1);
    trim.connect(amp);

    let head: AudioNode = trim;
    if (spec.filter && typeof ctx.createBiquadFilter === 'function') {
      const f = ctx.createBiquadFilter();
      nodes.push(f);
      f.type = spec.filter.type;
      setParam(f.frequency, clamp(spec.filter.freq, 20, 20000));
      setParam(f.Q, spec.filter.q ?? 0.7);
      f.connect(head);
      head = f;
    }

    for (const layer of spec.layers) {
      const lg = ctx.createGain();
      nodes.push(lg);
      setParam(lg.gain, Math.max(0, layer.level));
      lg.connect(head);
      if (layer.kind === 'noise') {
        const bs = ctx.createBufferSource();
        const buf = noiseBuffer(ctx);
        if (buf) bs.buffer = buf;
        bs.loop = true;
        setParam(bs.playbackRate, Math.max(0.02, layer.rate ?? 1));
        let src: AudioNode = bs;
        if (layer.filter && typeof ctx.createBiquadFilter === 'function') {
          const f = ctx.createBiquadFilter();
          nodes.push(f);
          f.type = layer.filter.type;
          setParam(f.frequency, clamp(layer.filter.freq, 20, 20000));
          setParam(f.Q, layer.filter.q ?? 0.7);
          bs.connect(f);
          src = f;
        }
        src.connect(lg);
        sources.push(bs);
      } else if (layer.kind === 'sine') {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        setParam(osc.frequency, Math.max(1, layer.freq));
        if (layer.detune) setParam(osc.detune, layer.detune);
        osc.connect(lg);
        sources.push(osc);
      } else {
        const car = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const depth = ctx.createGain();
        nodes.push(depth);
        car.type = 'sine';
        setModulatorWave(ctx, mod);
        const modHz = Math.max(0.01, layer.freq * layer.ratio + (layer.modOffset ?? 0));
        setParam(car.frequency, Math.max(1, layer.freq));
        setParam(mod.frequency, modHz);
        if (layer.detune) {
          setParam(car.detune, layer.detune);
          setParam(mod.detune, layer.detune);
        }
        setParam(depth.gain, Math.max(0, layer.index) * modHz);
        mod.connect(depth);
        depth.connect(car.frequency);
        car.connect(lg);
        sources.push(car, mod);
      }
    }
    if (sources.length === 0) throw new Error('drone has no layers');
    for (const s of sources) {
      nodes.push(s);
      s.start(t0);
      s.stop(until);
    }
    let released = false;
    let finished = false;
    const first = sources[0];
    if (first) {
      first.onended = () => {
        if (finished) return;
        finished = true;
        disconnectAll(nodes);
      };
    }
    return {
      extend(next: number): void {
        if (released || finished || !(next > until)) return;
        until = next;
        for (const s of sources) {
          try {
            s.stop(until);
          } catch {
            /* already stopped */
          }
        }
      },
      setTrim(v: number, at: number, rampS: number): void {
        if (released) return;
        try {
          trim.gain.cancelScheduledValues(at);
          trim.gain.setValueAtTime(trim.gain.value, at);
          trim.gain.linearRampToValueAtTime(Math.max(0, v), at + Math.max(0.005, rampS));
        } catch {
          setParam(trim.gain, Math.max(0, v));
        }
      },
      release(at: number, fadeS: number): void {
        if (released) return;
        released = true;
        const t = Math.max(at, ctx.currentTime);
        const end = t + Math.max(0.01, fadeS);
        try {
          amp.gain.cancelScheduledValues(t);
          amp.gain.setValueAtTime(amp.gain.value, t);
          amp.gain.linearRampToValueAtTime(0, end);
        } catch {
          setParam(amp.gain, 0);
        }
        if (end + 0.02 < until) {
          until = end + 0.02;
          for (const s of sources) {
            try {
              s.stop(until);
            } catch {
              /* already stopped */
            }
          }
        }
      },
      get released() {
        return released;
      },
      get until() {
        return until;
      },
    };
  } catch {
    disconnectAll(nodes);
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* never started */
      }
    }
    return null;
  }
}
