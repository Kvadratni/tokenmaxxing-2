/**
 * Measurements for rendered audio. Pure functions over Float32Array channels,
 * shared by the offline renderer (render-entry.ts runs them in the page).
 *
 * We cannot listen, so we measure: level (peak, RMS, short-term loudness),
 * length, brightness (spectral centroid), DC offset, mono compatibility, and
 * for the score the continuity of the loop seam.
 */

export const SILENCE_DB = -60;

export interface Metrics {
  /** Render length, seconds. */
  readonly seconds: number;
  /** First and last sample above -60 dBFS, seconds. */
  readonly onset: number;
  readonly end: number;
  /** end - onset. */
  readonly active: number;
  readonly peakDb: number;
  /** RMS over the active region (both channels). */
  readonly rmsDb: number;
  /** Loudest 50 ms window, RMS: a proxy for perceived loudness. */
  readonly stRmsDb: number;
  /** Power-weighted spectral centroid over the active region, Hz. */
  readonly centroidHz: number;
  /** Mean sample value over the active region (both channels). */
  readonly dc: number;
  /** Mono fold-down level against the stereo average, dB (0 is perfect, -3 is a hard pan). */
  readonly monoLossDb: number;
  /** Samples at or above full scale. */
  readonly clipped: number;
  /**
   * Single-sample discontinuities: a sample far from the average of its
   * neighbours, relative to the local level. Real signals at these levels do
   * not do that; a click does.
   */
  readonly spikes: number;
}

export interface SeamMetrics {
  /** Loop length and the seam's position, seconds. */
  readonly loopS: number;
  readonly seamS: number;
  /** Largest sample step within 3 ms of the seam, against the file's 99.9th percentile step. */
  readonly seamJump: number;
  /** The same, median over every other bar line (the seam should look like any of them). */
  readonly barJump: number;
  /** Quietest 10 ms around the seam (+-60 ms) against the median 10 ms level, dB. A dropout reads very negative. */
  readonly seamDipDb: number;
  /** The same at the other bar lines (median). */
  readonly barDipDb: number;
}

export function db(v: number): number {
  return v > 0 ? 20 * Math.log10(v) : -Infinity;
}

function mono(channels: readonly Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  const k = 1 / Math.max(1, channels.length);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) + (ch[i] ?? 0) * k;
  return out;
}

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const xi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Power-weighted spectral centroid of `x[from, to)`, Hz. */
export function spectralCentroid(x: Float32Array, sampleRate: number, from = 0, to = x.length): number {
  const N = 2048;
  const hop = 1024;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let num = 0;
  let den = 0;
  const minBin = Math.ceil((20 * N) / sampleRate);
  const start = Math.max(0, from);
  const stop = Math.min(x.length, to);
  for (let off = start; off < stop; off += hop) {
    for (let i = 0; i < N; i++) {
      const idx = off + i;
      re[i] = idx < stop ? (x[idx] ?? 0) * (win[i] ?? 0) : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = minBin; k < N / 2; k++) {
      const p = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
      num += ((k * sampleRate) / N) * p;
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

export function analyze(channels: readonly Float32Array[], sampleRate: number): Metrics {
  const n = channels[0]?.length ?? 0;
  const floor = Math.pow(10, SILENCE_DB / 20);
  let peak = 0;
  let clipped = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) m = Math.max(m, Math.abs(ch[i] ?? 0));
    if (m > peak) peak = m;
    if (m >= 0.999) clipped++;
    if (m > floor) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const from = first < 0 ? 0 : first;
  const to = last < 0 ? 0 : last + 1;

  let sumSq = 0;
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = from; i < to; i++) {
      const v = ch[i] ?? 0;
      sumSq += v * v;
      sum += v;
      count++;
    }
  }
  const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
  const dc = count > 0 ? sum / count : 0;

  // Short-term loudness: loudest 50 ms window, 10 ms hop.
  const win = Math.max(1, Math.round(sampleRate * 0.05));
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  let st = 0;
  for (let off = from; off + 1 < to; off += hop) {
    let s = 0;
    let c = 0;
    const end = Math.min(to, off + win);
    for (const ch of channels) {
      for (let i = off; i < end; i++) {
        const v = ch[i] ?? 0;
        s += v * v;
        c++;
      }
    }
    if (c > 0) st = Math.max(st, Math.sqrt(s / c));
  }

  const m = mono(channels);
  let midSq = 0;
  for (let i = from; i < to; i++) midSq += (m[i] ?? 0) ** 2;
  const midRms = to > from ? Math.sqrt(midSq / (to - from)) : 0;
  const monoLossDb = rms > 0 && midRms > 0 ? db(midRms) - db(rms) : 0;

  return {
    spikes: countSpikes(channels),
    seconds: n / sampleRate,
    onset: from / sampleRate,
    end: to / sampleRate,
    active: (to - from) / sampleRate,
    peakDb: db(peak),
    rmsDb: db(rms),
    stRmsDb: db(st),
    centroidHz: spectralCentroid(m, sampleRate, from, to),
    dc,
    monoLossDb,
    clipped,
  };
}

/** See `Metrics.spikes`. The local level is the mean |x| over the surrounding 64 samples. */
export function countSpikes(channels: readonly Float32Array[]): number {
  const HALF = 32;
  let spikes = 0;
  for (const x of channels) {
    const n = x.length;
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] ?? 0) + Math.abs(x[i] ?? 0);
    for (let i = 1; i < n - 1; i++) {
      const lo = Math.max(0, i - HALF);
      const hi = Math.min(n, i + HALF);
      const local = ((prefix[hi] ?? 0) - (prefix[lo] ?? 0)) / (hi - lo) + 1e-4;
      const err = Math.abs((x[i] ?? 0) - ((x[i - 1] ?? 0) + (x[i + 1] ?? 0)) / 2);
      if (err > 0.02 && err > 12 * local) spikes++;
    }
  }
  return spikes;
}

function rmsAt(x: Float32Array, from: number, len: number): number {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, from); i < Math.min(x.length, from + len); i++) {
    const v = x[i] ?? 0;
    s += v * v;
    c++;
  }
  return c > 0 ? Math.sqrt(s / c) : 0;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Loop seam continuity. `startS` is when bar 0 begins, `barS` one bar's
 * length, `loopBars` bars per loop. Compares the first loop boundary with
 * every other bar line in the render: a seam that clicks, or drops out, shows
 * up as a bigger sample jump or a deeper dip than an ordinary bar line.
 */
export function seam(channels: readonly Float32Array[], sampleRate: number, startS: number, barS: number, loopBars: number): SeamMetrics {
  const x = mono(channels);
  const n = x.length;
  // The 99.9th percentile sample step, from a histogram of |dx|.
  const steps: number[] = [];
  const stride = Math.max(1, Math.floor(n / 200000));
  for (let i = 1; i < n; i += stride) steps.push(Math.abs((x[i] ?? 0) - (x[i - 1] ?? 0)));
  steps.sort((a, b) => a - b);
  const p999 = steps[Math.floor(steps.length * 0.999)] ?? 1e-9;

  const jumpAt = (t: number): number => {
    const c = Math.round(t * sampleRate);
    const r = Math.round(0.003 * sampleRate);
    let m = 0;
    for (let i = Math.max(1, c - r); i < Math.min(n, c + r); i++) m = Math.max(m, Math.abs((x[i] ?? 0) - (x[i - 1] ?? 0)));
    return m / Math.max(p999, 1e-9);
  };
  const w10 = Math.round(0.01 * sampleRate);
  const levels: number[] = [];
  for (let i = Math.round(sampleRate * 0.5); i + w10 < n; i += w10) levels.push(rmsAt(x, i, w10));
  const typical = Math.max(median(levels), 1e-9);
  const dipAt = (t: number): number => {
    const c = Math.round(t * sampleRate);
    const r = Math.round(0.06 * sampleRate);
    let lo = Infinity;
    for (let i = c - r; i + w10 <= c + r; i += Math.max(1, Math.round(w10 / 2))) lo = Math.min(lo, rmsAt(x, i, w10));
    return db(Math.max(lo, 1e-9) / typical);
  };

  const seamS = startS + barS * loopBars;
  const bars: number[] = [];
  for (let t = startS + barS; t < n / sampleRate - 0.1; t += barS) {
    if (Math.abs(t - seamS) > barS * 0.5) bars.push(t);
  }
  return {
    loopS: barS * loopBars,
    seamS,
    seamJump: jumpAt(seamS),
    barJump: median(bars.map(jumpAt)),
    seamDipDb: dipAt(seamS),
    barDipDb: median(bars.map(dipAt)),
  };
}

/** 16-bit PCM WAV, interleaved. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const chs = Math.max(1, channels.length);
  const n = channels[0]?.length ?? 0;
  const bytes = 44 + n * chs * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, chs, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * chs * 2, true);
  v.setUint16(32, chs * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * chs * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(off, Math.round(s * 32767), true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
