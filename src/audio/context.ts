/**
 * Audio graph plumbing.
 *
 * HARD RULE: nothing in this module constructs an `AudioContext` at import
 * time. The context is built lazily inside `createAudioBus()`, which the engine
 * only calls from `unlock()` (i.e. from a real user gesture). Every WebAudio
 * feature is detected before use so the whole stack degrades to a silent no-op
 * in headless environments.
 *
 * Signal flow:
 *
 *   music ─┐
 *          ├─> master ─> dc block ─> limiter ─> ceiling ─> destination
 *   sfx   ─┘
 *
 * The DC block is a 15 Hz high-pass, so nothing sub-sonic reaches the
 * limiter's detector. The limiter is a gentle compressor; the ceiling is a
 * WaveShaper that is exactly linear below about -3 dBFS and can never pass
 * about -1 dBFS, which catches anything the compressor lets through during
 * its attack.
 */

/** Factory that mints a fresh `AudioContext`. Injectable for tests. */
export type AudioContextFactory = () => AudioContext | null;

export interface AudioBus {
  readonly ctx: AudioContext;
  /** Post-mix trim, pre-limiter. */
  readonly master: GainNode;
  /** Sub-sonic high-pass ahead of the limiter. `null` if the platform lacks biquads. */
  readonly dcBlock: BiquadFilterNode | null;
  /** Gentle master limiter. `null` if the platform lacks compressors. */
  readonly limiter: DynamicsCompressorNode | null;
  /** Hard safety ceiling after the limiter. `null` if the platform lacks WaveShapers. */
  readonly ceiling: WaveShaperNode | null;
  /** Music layers connect here. */
  readonly music: GainNode;
  /** One-shot SFX connect here. */
  readonly sfx: GainNode;
  /** Context clock, in seconds. */
  now(): number;
  setMusicVolume(v: number, rampS?: number): void;
  setSfxVolume(v: number, rampS?: number): void;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** Master trim, leaves headroom under the limiter. */
const MASTER_TRIM = 0.9;
/** The ceiling's hard limit (about -1 dBFS) and where its shoulder starts (about -3 dBFS). */
const CEILING = 0.89;
const CEILING_KNEE = 0.7;
/** Music sits well under SFX so it never masks feedback. */
const MUSIC_HEADROOM = 0.6;
const SFX_HEADROOM = 0.85;
/** Default gain ramp — long enough to kill zipper noise, short enough to feel instant. */
export const DEFAULT_RAMP_S = 0.08;

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const CURVE_POINTS = 4096;

/**
 * The master ceiling's transfer curve: exactly linear up to `knee`, then a
 * tanh shoulder that never passes `ceiling` (0.89 is about -1 dBFS). A
 * WaveShaper clamps anything beyond +-1 to the curve's ends, so the output can
 * never exceed the curve's last point.
 */
export function ceilingCurve(ceiling = CEILING, knee = CEILING_KNEE): Float32Array<ArrayBuffer> {
  const c = Math.min(1, Math.max(0.1, Number.isFinite(ceiling) ? ceiling : CEILING));
  const k = Math.min(c * 0.98, Math.max(0.05, Number.isFinite(knee) ? knee : CEILING_KNEE));
  const span = c - k;
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i / (CURVE_POINTS - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= k ? ax : k + span * Math.tanh((ax - k) / span);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** Perceptual-ish volume curve. Exactly 0 at 0, exactly 1 at 1. */
function taper(v: number): number {
  const c = clamp01(v);
  return c * c * (3 - 2 * c) * 0.35 + c * c * 0.65;
}

/**
 * Ramp an `AudioParam` without clicks. Safe against partial/lean param
 * implementations (some mocks, some old browsers).
 */
export function rampParam(p: AudioParam | undefined, target: number, at: number, rampS: number): void {
  if (!p) return;
  try {
    if (typeof p.cancelScheduledValues === 'function') p.cancelScheduledValues(at);
    if (rampS > 0 && typeof p.linearRampToValueAtTime === 'function') {
      if (typeof p.setValueAtTime === 'function') p.setValueAtTime(p.value, at);
      p.linearRampToValueAtTime(target, at + rampS);
    } else if (typeof p.setValueAtTime === 'function') {
      p.setValueAtTime(target, at);
    } else {
      p.value = target;
    }
  } catch {
    try {
      p.value = target;
    } catch {
      /* nothing else we can do */
    }
  }
}

/** Set a param immediately, tolerating lean implementations. */
export function setParam(p: AudioParam | undefined, value: number): void {
  if (!p) return;
  try {
    p.value = value;
  } catch {
    /* ignore */
  }
}

/**
 * Feature-detect WebAudio. Returns `null` when the platform has none — never
 * throws, never touches a constructor.
 */
export function detectAudioContextFactory(): AudioContextFactory | null {
  const g = globalThis as unknown as {
    AudioContext?: new (o?: AudioContextOptions) => AudioContext;
    webkitAudioContext?: new (o?: AudioContextOptions) => AudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  return () => new Ctor({ latencyHint: 'interactive' });
}

export function hasWebAudio(): boolean {
  return detectAudioContextFactory() !== null;
}

/**
 * Build the whole graph. Returns `null` if anything at all goes wrong so the
 * caller can stay silent rather than crash the game.
 */
export function createAudioBus(factory: AudioContextFactory): AudioBus | null {
  let ctx: AudioContext | null = null;
  try {
    ctx = factory();
  } catch {
    return null;
  }
  if (!ctx || typeof ctx.createGain !== 'function' || typeof ctx.createOscillator !== 'function') {
    return null;
  }
  const context = ctx;

  try {
    const master = context.createGain();
    setParam(master.gain, MASTER_TRIM);

    let dcBlock: BiquadFilterNode | null = null;
    if (typeof context.createBiquadFilter === 'function') {
      dcBlock = context.createBiquadFilter();
      dcBlock.type = 'highpass';
      setParam(dcBlock.frequency, 15);
      setParam(dcBlock.Q, 0.5);
    }

    let limiter: DynamicsCompressorNode | null = null;
    if (typeof context.createDynamicsCompressor === 'function') {
      limiter = context.createDynamicsCompressor();
      // Gentle: a wide knee and a high ratio catches stacked SFX transients
      // without audibly pumping the music bed.
      setParam(limiter.threshold, -12);
      setParam(limiter.knee, 14);
      setParam(limiter.ratio, 12);
      setParam(limiter.attack, 0.003);
      setParam(limiter.release, 0.2);
    }

    let ceiling: WaveShaperNode | null = null;
    if (typeof context.createWaveShaper === 'function') {
      ceiling = context.createWaveShaper();
      ceiling.curve = ceilingCurve(CEILING, CEILING_KNEE);
      ceiling.oversample = 'none';
    }

    const music = context.createGain();
    const sfx = context.createGain();
    setParam(music.gain, 0);
    setParam(sfx.gain, 0);

    music.connect(master);
    sfx.connect(master);
    // master -> [dc block] -> [limiter] -> [ceiling] -> destination
    let tail: AudioNode = master;
    if (dcBlock) {
      tail.connect(dcBlock);
      tail = dcBlock;
    }
    if (limiter) {
      tail.connect(limiter);
      tail = limiter;
    }
    if (ceiling) {
      tail.connect(ceiling);
      tail = ceiling;
    }
    tail.connect(context.destination);

    const bus: AudioBus = {
      ctx: context,
      master,
      dcBlock,
      limiter,
      ceiling,
      music,
      sfx,
      now() {
        return context.currentTime;
      },
      setMusicVolume(v, rampS = DEFAULT_RAMP_S) {
        rampParam(music.gain, taper(v) * MUSIC_HEADROOM, context.currentTime, rampS);
      },
      setSfxVolume(v, rampS = DEFAULT_RAMP_S) {
        rampParam(sfx.gain, taper(v) * SFX_HEADROOM, context.currentTime, rampS);
      },
      async resume() {
        try {
          if (typeof context.resume === 'function' && context.state !== 'running') {
            await context.resume();
          }
        } catch {
          /* autoplay policy may still block; we stay silent */
        }
      },
      async close() {
        try {
          music.disconnect();
          sfx.disconnect();
          master.disconnect();
          dcBlock?.disconnect();
          limiter?.disconnect();
          ceiling?.disconnect();
        } catch {
          /* ignore */
        }
        try {
          if (typeof context.close === 'function' && context.state !== 'closed') {
            await context.close();
          }
        } catch {
          /* ignore */
        }
      },
    };
    return bus;
  } catch {
    try {
      if (typeof context.close === 'function') void context.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}
