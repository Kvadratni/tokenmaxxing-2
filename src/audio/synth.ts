/**
 * Chiptune synthesis primitives. Zero audio assets — every sound in the game is
 * generated here at runtime.
 *
 * Everything funnels through `playTone()`, which:
 *   - allocates a slot from a `VoicePool` (hard cap on concurrent voices),
 *   - builds `source -> [filter] -> gain -> [panner] -> out`,
 *   - applies an ADSR to the gain,
 *   - always schedules an explicit `stop()` and disconnects on `ended`.
 *
 * No node is ever created without a matching `stop()`.
 */

import { setParam } from './context.ts';

export type Wave = 'square' | 'pulse' | 'triangle' | 'saw' | 'sine' | 'noise';

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

export const DEFAULT_ADSR: ADSR = { a: 0.004, d: 0.045, s: 0.55, r: 0.09 };

/** Length of the cached white-noise buffer, in seconds. */
const NOISE_SECONDS = 1.2;
/** Extra time after the envelope ends before the source is stopped. */
const STOP_SLACK = 0.012;

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** MIDI note number -> Hz. */
export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
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
  /** Fade + stop this voice early. Replaced by `playTone`. */
  kill: (at: number) => void;
}

/**
 * Hard cap on simultaneous voices.
 *
 * Policy when full: reject the *incoming* sound if it is low priority, so a
 * mashed click can never cut off a ship fanfare. High-priority sounds may steal
 * a single low-priority slot; they never exceed the cap.
 */
export class VoicePool {
  readonly cap: number;
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
// Cached sources
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
    for (let i = 0; i < length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      data[i] = (s / 0xffffffff) * 2 - 1;
    }
    noiseCache.set(ctx, buf);
    return buf;
  } catch {
    return null;
  }
}

const pulseCache = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();
const PULSE_HARMONICS = 28;

/**
 * A true variable-duty pulse wave via Fourier coefficients. Cached per
 * (context, duty). Falls back to `null` when `createPeriodicWave` is missing,
 * in which case callers use a plain square.
 */
export function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave | null {
  if (typeof ctx.createPeriodicWave !== 'function') return null;
  const d = clamp(duty, 0.03, 0.97);
  const key = Math.round(d * 100);
  let byDuty = pulseCache.get(ctx);
  if (!byDuty) {
    byDuty = new Map<number, PeriodicWave>();
    pulseCache.set(ctx, byDuty);
  }
  const hit = byDuty.get(key);
  if (hit) return hit;
  try {
    const real = new Float32Array(PULSE_HARMONICS);
    const imag = new Float32Array(PULSE_HARMONICS);
    for (let n = 1; n < PULSE_HARMONICS; n++) {
      real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
    }
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    byDuty.set(key, wave);
    return wave;
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
 * envelope reaches silence.
 */
export function applyADSR(p: AudioParam, t0: number, peak: number, hold: number, env: ADSR): number {
  const t = envTimes(t0, hold, env);
  const level = Math.max(peak, 1e-4);
  const sustain = Math.max(level * clamp(env.s, 0, 1), 1e-4);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(level, t.attackEnd);
  p.linearRampToValueAtTime(sustain, t.decayEnd);
  p.setValueAtTime(sustain, t.sustainEnd);
  // Exponential release reads as a natural chip decay; finish on a hard zero so
  // the param never idles at a non-zero floor.
  p.exponentialRampToValueAtTime(Math.max(sustain * 0.001, 1e-5), t.end - 0.004);
  p.linearRampToValueAtTime(0, t.end);
  return t.end;
}

// ---------------------------------------------------------------------------
// playTone
// ---------------------------------------------------------------------------

export interface FilterSpec {
  readonly type: BiquadFilterType;
  readonly freq: number;
  /** Sweep target, reached at the end of the sustain phase. */
  readonly freqEnd?: number;
  readonly q?: number;
}

export interface ToneOpts {
  readonly wave?: Wave;
  /** Duty cycle for `wave: 'pulse'`, 0..1. */
  readonly duty?: number;
  /** Hz. Ignored for noise. */
  readonly freq?: number;
  /** Glide target, reached at the end of the sustain phase. */
  readonly freqEnd?: number;
  readonly glide?: 'lin' | 'exp';
  /** Absolute context time. Defaults to now. */
  readonly when?: number;
  /** Sustain length, seconds (on top of A + D + R). */
  readonly hold?: number;
  /** Peak linear gain. */
  readonly gain?: number;
  readonly env?: Partial<ADSR>;
  /** Cents. */
  readonly detune?: number;
  /** -1..1. Skipped when the platform has no StereoPanner. */
  readonly pan?: number;
  readonly filter?: FilterSpec;
  /** Noise playback rate (a crude pitch/brightness control). */
  readonly rate?: number;
  readonly rateEnd?: number;
  readonly priority?: number;
  readonly pool?: VoicePool | null;
}

/**
 * Fire one voice. Returns the context time it finishes, or `null` when the
 * voice was dropped (budget) or the platform refused to build the graph.
 */
export function playTone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts): number | null {
  const peak = Math.max(0, o.gain ?? 0.2);
  if (peak <= 0.0005) return null;

  const env: ADSR = { ...DEFAULT_ADSR, ...(o.env ?? {}) };
  const t0 = Math.max(o.when ?? ctx.currentTime, ctx.currentTime);
  const hold = Math.max(0, o.hold ?? 0.05);
  const times = envTimes(t0, hold, env);
  const priority = o.priority ?? 1;
  const pool = o.pool ?? null;

  let slot: VoiceSlot | null = null;
  if (pool) {
    slot = pool.alloc(ctx.currentTime, times.end + STOP_SLACK, priority);
    if (!slot) return null;
  }

  const wave: Wave = o.wave ?? 'square';
  const nodes: AudioNode[] = [];

  try {
    const amp = ctx.createGain();
    nodes.push(amp);
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

    // [filter] -> amp
    let head: AudioNode = amp;
    if (o.filter && typeof ctx.createBiquadFilter === 'function') {
      const filter = ctx.createBiquadFilter();
      nodes.push(filter);
      filter.type = o.filter.type;
      const f0 = Math.max(20, o.filter.freq);
      filter.frequency.setValueAtTime(f0, t0);
      if (o.filter.freqEnd !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.freqEnd), times.sustainEnd);
      }
      setParam(filter.Q, o.filter.q ?? 1);
      filter.connect(amp);
      head = filter;
    }

    // source -> head
    let src: AudioScheduledSourceNode;
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
      src = bs;
    } else {
      const osc = ctx.createOscillator();
      if (wave === 'pulse') {
        const pw = pulseWave(ctx, o.duty ?? 0.5);
        if (pw && typeof osc.setPeriodicWave === 'function') osc.setPeriodicWave(pw);
        else osc.type = 'square';
      } else {
        osc.type = wave === 'saw' ? 'sawtooth' : wave;
      }
      const f0 = Math.max(1, o.freq ?? 440);
      osc.frequency.setValueAtTime(f0, t0);
      if (o.freqEnd !== undefined) {
        const f1 = Math.max(1, o.freqEnd);
        if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(f1, times.sustainEnd);
        else osc.frequency.exponentialRampToValueAtTime(f1, times.sustainEnd);
      }
      if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
      src = osc;
    }
    nodes.push(src);
    src.connect(head);

    const stopAt = times.end + STOP_SLACK;
    src.start(t0);
    src.stop(stopAt);

    let finished = false;
    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
      if (pool && slot) pool.release(slot);
    };
    src.onended = cleanup;

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
        try {
          src.stop(at + 0.02);
        } catch {
          /* already stopped */
        }
      };
    }

    return stopAt;
  } catch {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (pool && slot) pool.release(slot);
    return null;
  }
}
