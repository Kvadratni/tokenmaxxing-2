import { describe, expect, it } from 'vitest';

import { ceilingCurve } from '@audio/context.ts';
import {
  MockAudioContext,
  stripFeatures,
  type MockGain,
  type MockOscillator,
} from '@audio/mock-context.ts';
import {
  applyADSR,
  cosineWave,
  createRng,
  crushCurve,
  DEFAULT_ADSR,
  envTimes,
  FM,
  hash01,
  mtof,
  noiseBuffer,
  playFM,
  playTone,
  reverbImpulse,
  startDrone,
  VoicePool,
} from '@audio/synth.ts';

function ctxOf(mock: MockAudioContext): BaseAudioContext {
  return mock as unknown as BaseAudioContext;
}

function outOf(gain: MockGain): AudioNode {
  return gain as unknown as AudioNode;
}

function setup(): { mock: MockAudioContext; ctx: BaseAudioContext; out: AudioNode; bus: MockGain } {
  const mock = new MockAudioContext();
  const bus = mock.createGain();
  return { mock, ctx: ctxOf(mock), out: outOf(bus), bus };
}

describe('mtof', () => {
  it('anchors A4 at 440 Hz', () => {
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(81)).toBeCloseTo(880, 6);
    expect(mtof(57)).toBeCloseTo(220, 6);
  });
});

describe('deterministic variation', () => {
  it('createRng repeats for a seed and stays in [0, 1)', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hash01 is a pure function of its inputs', () => {
    expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
    expect(hash01(3, 4, 5)).not.toBe(hash01(3, 4, 6));
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(Math.floor(hash01(i, 1, 2) * 10));
    expect(seen.size).toBe(10);
  });
});

describe('envTimes / applyADSR', () => {
  it('lays out attack, decay, sustain and release in order', () => {
    const t = envTimes(10, 0.2, { a: 0.01, d: 0.05, s: 0.5, r: 0.1 });
    expect(t.attackEnd).toBeCloseTo(10.01, 6);
    expect(t.decayEnd).toBeCloseTo(10.06, 6);
    expect(t.sustainEnd).toBeCloseTo(10.26, 6);
    expect(t.end).toBeCloseTo(10.36 + 0.004, 6);
  });

  it('writes a 0 -> peak -> sustain -> 0 contour and never ramps exponentially to zero', () => {
    const mock = new MockAudioContext();
    const gain = mock.createGain();
    const end = applyADSR(gain.gain as unknown as AudioParam, 0, 0.5, 0.1, DEFAULT_ADSR);

    const targets = gain.gain.targets();
    expect(targets[0]).toBe(0);
    expect(Math.max(...targets)).toBeCloseTo(0.5, 6);
    expect(targets[targets.length - 1]).toBe(0);
    expect(gain.gain.value).toBe(0);
    expect(end).toBeGreaterThan(0);

    for (const call of gain.gain.calls) {
      if (call.method === 'exponentialRampToValueAtTime') {
        expect(call.args[0]).toBeGreaterThan(0);
      }
    }
  });
});

describe('noiseBuffer', () => {
  it('generates one buffer per context and reuses it', () => {
    const { mock, ctx } = setup();
    const a = noiseBuffer(ctx);
    const b = noiseBuffer(ctx);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(mock.created.buffers).toHaveLength(1);
  });

  it('is not regenerated per noise shot', () => {
    const { mock, ctx, out } = setup();
    for (let i = 0; i < 25; i++) {
      playTone(ctx, out, { wave: 'noise', gain: 0.2, hold: 0.01 });
    }
    expect(mock.created.bufferSources).toHaveLength(25);
    expect(mock.created.buffers).toHaveLength(1);
  });

  it('is bounded, non-silent, and carries no DC', () => {
    const { mock, ctx } = setup();
    noiseBuffer(ctx);
    const data = mock.created.buffers[0]!.getChannelData(0);
    let energy = 0;
    let peak = 0;
    let sum = 0;
    for (const v of data) {
      energy += v * v;
      peak = Math.max(peak, Math.abs(v));
      sum += v;
    }
    expect(energy).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(1.01);
    expect(Math.abs(sum / data.length)).toBeLessThan(1e-6);
  });
});

describe('curves', () => {
  it('crushCurve is a symmetric staircase with 2^(bits-1) steps a side', () => {
    const c = crushCurve(4);
    expect(c).toBe(crushCurve(4)); // cached
    const levels = new Set(Array.from(c, (v) => Math.round(v * 1000)));
    expect(levels.size).toBe(2 * 8 + 1);
    for (let i = 0; i < c.length; i++) expect(c[i]!).toBeCloseTo(-c[c.length - 1 - i]!, 6);
    expect(c[c.length - 1]).toBe(1);
  });

  it('ceilingCurve is linear below the knee and never passes the ceiling', () => {
    const c = ceilingCurve(0.89, 0.7);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      const y = c[i]!;
      expect(Math.abs(y)).toBeLessThanOrEqual(0.89);
      if (Math.abs(x) <= 0.7) expect(y).toBeCloseTo(x, 6);
      if (i > 0) expect(y).toBeGreaterThanOrEqual(c[i - 1]!);
    }
  });

  it('cosineWave is one cached PeriodicWave per context, and absent on lean platforms', () => {
    const { mock, ctx } = setup();
    expect(cosineWave(ctx)).toBe(cosineWave(ctx));
    expect(mock.created.periodicWaves).toHaveLength(1);
    const lean = stripFeatures(new MockAudioContext(), 'createPeriodicWave');
    expect(cosineWave(ctxOf(lean))).toBeNull();
  });

  it('reverbImpulse is a cached, decaying stereo tail with a silent pre-delay', () => {
    const { mock, ctx } = setup();
    const spec = { seconds: 0.5, damp: 0.5, preDelay: 0.01, seed: 3 };
    const ir = reverbImpulse(ctx, spec);
    expect(ir).not.toBeNull();
    expect(reverbImpulse(ctx, spec)).toBe(ir);
    const buf = mock.created.buffers[mock.created.buffers.length - 1]!;
    expect(buf.numberOfChannels).toBe(2);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    expect(l[0]).toBe(0);
    const early = l.slice(441, 441 + 2000).reduce((a, v) => a + v * v, 0);
    const late = l.slice(l.length - 2000).reduce((a, v) => a + v * v, 0);
    expect(early).toBeGreaterThan(late * 100);
    // Independent channels (mono-safe decorrelation), not a copy.
    expect(Array.from(l.slice(1000, 1010))).not.toEqual(Array.from(r.slice(1000, 1010)));
  });
});

describe('VoicePool', () => {
  it('caps concurrent voices and rejects new low-priority voices when full', () => {
    const pool = new VoicePool(3);
    expect(pool.alloc(0, 1, 0)).not.toBeNull();
    expect(pool.alloc(0, 1, 0)).not.toBeNull();
    expect(pool.alloc(0, 1, 0)).not.toBeNull();
    expect(pool.alloc(0, 1, 0)).toBeNull();
    expect(pool.active).toBe(3);
    expect(pool.rejected).toBe(1);
  });

  it('lets a high-priority voice steal a low-priority slot, never exceeding the cap', () => {
    const pool = new VoicePool(2);
    let killed = 0;
    const a = pool.alloc(0, 1, 0);
    const b = pool.alloc(0, 2, 0);
    expect(a && b).toBeTruthy();
    a!.kill = () => void killed++;
    b!.kill = () => void killed++;

    const fanfare = pool.alloc(0, 3, 3);
    expect(fanfare).not.toBeNull();
    expect(pool.active).toBe(2);
    // The newest low-priority voice (longest tail) is the victim.
    expect(killed).toBe(1);
    expect(pool.stolen).toBe(1);
  });

  it('never steals from a high-priority voice', () => {
    const pool = new VoicePool(2);
    pool.alloc(0, 5, 3);
    pool.alloc(0, 5, 3);
    expect(pool.alloc(0, 5, 3)).toBeNull();
    expect(pool.alloc(0, 5, 0)).toBeNull();
  });

  it('prunes voices whose scheduled end has passed', () => {
    const pool = new VoicePool(2);
    pool.alloc(0, 0.5, 0);
    pool.alloc(0, 0.5, 0);
    expect(pool.alloc(0, 1, 0)).toBeNull();
    expect(pool.alloc(0.6, 1, 0)).not.toBeNull();
    expect(pool.active).toBe(1);
  });

  it('killAll empties the pool', () => {
    const pool = new VoicePool(4);
    let killed = 0;
    for (let i = 0; i < 4; i++) {
      const v = pool.alloc(0, 1, 0);
      if (v) v.kill = () => void killed++;
    }
    pool.killAll(0);
    expect(killed).toBe(4);
    expect(pool.active).toBe(0);
  });
});

describe('playTone', () => {
  it('builds source -> filter -> gain -> panner -> out and always schedules stop()', () => {
    const { mock, ctx, out } = setup();
    const end = playTone(ctx, out, {
      wave: 'sine',
      freq: 440,
      gain: 0.3,
      hold: 0.1,
      pan: -0.5,
      filter: { type: 'lowpass', freq: 2000, q: 1.2 },
    });
    expect(end).not.toBeNull();
    expect(mock.created.oscillators).toHaveLength(1);
    expect(mock.created.filters).toHaveLength(1);
    expect(mock.created.panners).toHaveLength(1);

    const osc = mock.created.oscillators[0]!;
    expect(osc.startCalls).toHaveLength(1);
    expect(osc.stopCalls).toHaveLength(1);
    expect(osc.stopCalls[0]!).toBeGreaterThan(osc.startCalls[0]!);
    expect(end!).toBeCloseTo(osc.stopCalls[0]!, 6);
  });

  it('is silent from the moment it exists, not just from its start time', () => {
    // A GainNode idles at 1 until its first automation event; a source started
    // between two sample frames leaks its first frame through that. Regression
    // for a full-scale spike on late-starting noise voices.
    const { mock, ctx, out } = setup();
    mock.advance(1);
    playTone(ctx, out, { wave: 'noise', gain: 0.1, when: 1.0503, filter: { type: 'highpass', freq: 6000 } });
    const amp = mock.created.gains[mock.created.gains.length - 1]!;
    expect(amp.gain.directSets[0]).toBe(0);
    // And the filter sits at its cutoff before the voice starts, too.
    expect(mock.created.filters[0]!.frequency.directSets[0]).toBe(6000);
  });

  it('disconnects every node once the source ends', () => {
    const { mock, ctx, out } = setup();
    playTone(ctx, out, { wave: 'triangle', freq: 220, gain: 0.2, filter: { type: 'lowpass', freq: 900 } });
    const osc = mock.created.oscillators[0]!;
    const filter = mock.created.filters[0]!;
    // gains[0] is `out`; gains[1] is the voice amp.
    const amp = mock.created.gains[1]!;
    expect(amp.disconnectCount).toBe(0);
    osc.fireEnded();
    expect(osc.disconnectCount).toBe(1);
    expect(filter.disconnectCount).toBe(1);
    expect(amp.disconnectCount).toBe(1);
    // Idempotent.
    osc.fireEnded();
    expect(osc.disconnectCount).toBe(1);
  });

  it('frees its pool slot when the voice ends', () => {
    const { mock, ctx, out } = setup();
    const pool = new VoicePool(2);
    playTone(ctx, out, { freq: 440, gain: 0.2, pool });
    expect(pool.active).toBe(1);
    mock.created.oscillators[0]!.fireEnded();
    expect(pool.active).toBe(0);
  });

  it('creates no nodes at all when the voice budget rejects it', () => {
    const { mock, ctx, out } = setup();
    const pool = new VoicePool(1);
    expect(playTone(ctx, out, { freq: 440, gain: 0.2, hold: 5, pool })).not.toBeNull();
    expect(playTone(ctx, out, { freq: 440, gain: 0.2, hold: 5, pool })).toBeNull();
    expect(mock.created.oscillators).toHaveLength(1);
  });

  it('maps wave names onto oscillator types, with no chiptune pulse or square', () => {
    const { mock, ctx, out } = setup();
    playTone(ctx, out, { wave: 'saw', freq: 100, gain: 0.2 });
    playTone(ctx, out, { wave: 'triangle', freq: 100, gain: 0.2 });
    playTone(ctx, out, { wave: 'sine', freq: 100, gain: 0.2 });
    const types = mock.created.oscillators.map((o: MockOscillator) => o.type);
    expect(types).toEqual(['sawtooth', 'triangle', 'sine']);
  });

  it('glides frequency toward freqEnd and sweeps the filter', () => {
    const { mock, ctx, out } = setup();
    playTone(ctx, out, {
      wave: 'saw',
      freq: 800,
      freqEnd: 100,
      glide: 'exp',
      gain: 0.2,
      filter: { type: 'lowpass', freq: 4000, freqEnd: 300 },
    });
    const osc = mock.created.oscillators[0]!;
    expect(osc.frequency.calls.map((c) => c.method)).toEqual(['setValueAtTime', 'exponentialRampToValueAtTime']);
    expect(osc.frequency.calls[1]!.args[0]).toBe(100);
    expect(mock.created.filters[0]!.frequency.calls[1]!.args[0]).toBe(300);
  });

  it('adds a crush shaper ahead of the filter, and a post-envelope send tap', () => {
    const { mock, ctx, out } = setup();
    const reverb = mock.createGain();
    playTone(ctx, out, {
      wave: 'sine',
      freq: 200,
      gain: 0.2,
      crush: 5,
      filter: { type: 'lowpass', freq: 1000 },
      send: 0.3,
      sendTo: reverb as unknown as AudioNode,
    });
    const shaper = mock.created.shapers[0]!;
    expect(shaper.curve).toBe(crushCurve(5));
    expect(mock.created.oscillators[0]!.outputs).toContain(shaper);
    expect(shaper.outputs).toContain(mock.created.filters[0]);
    const tap = mock.created.gains.find((g) => g.outputs.includes(reverb));
    expect(tap?.gain.value).toBeCloseTo(0.3, 6);
  });

  it('skips silent voices without touching the pool', () => {
    const { mock, ctx, out } = setup();
    const pool = new VoicePool(4);
    expect(playTone(ctx, out, { freq: 440, gain: 0, pool })).toBeNull();
    expect(pool.active).toBe(0);
    expect(mock.created.oscillators).toHaveLength(0);
  });

  it('never schedules a start earlier than the current clock', () => {
    const { mock, ctx, out } = setup();
    mock.advance(5);
    playTone(ctx, out, { freq: 440, gain: 0.2, when: 1 });
    expect(mock.created.oscillators[0]!.startCalls[0]).toBe(5);
  });

  it('survives a context missing optional node factories', () => {
    const mock = new MockAudioContext();
    const out = mock.createGain();
    stripFeatures(mock, 'createBiquadFilter', 'createStereoPanner', 'createWaveShaper');
    const end = playTone(ctxOf(mock), outOf(out), {
      freq: 440,
      gain: 0.2,
      pan: 0.8,
      crush: 4,
      filter: { type: 'lowpass', freq: 1000 },
    });
    expect(end).not.toBeNull();
    expect(mock.created.filters).toHaveLength(0);
    expect(mock.created.panners).toHaveLength(0);
    expect(mock.created.shapers).toHaveLength(0);
    expect(mock.created.oscillators[0]!.stopCalls).toHaveLength(1);
  });
});

describe('playFM', () => {
  it('wires modulator -> depth -> carrier.frequency, and the carrier into the voice', () => {
    const { mock, ctx, out } = setup();
    const end = playFM(ctx, out, { freq: 440, ratio: 3.5, index: 2, gain: 0.2 });
    expect(end).not.toBeNull();
    const [carrier] = mock.carriers();
    const [modulator] = mock.modulators();
    expect(carrier).toBeDefined();
    expect(modulator).toBeDefined();
    expect(carrier).not.toBe(modulator);
    // The modulator runs at freq * ratio, in cosine phase (a PeriodicWave).
    expect(modulator!.frequency.calls[0]!.args[0]).toBeCloseTo(440 * 3.5, 6);
    expect(modulator!.type).toBe('custom');
    // Its depth gain feeds the carrier's frequency param.
    const depth = modulator!.outputs[0] as MockGain;
    expect(depth.paramOutputs).toContain(carrier!.frequency);
    // Deviation = index * modulator Hz at the attack.
    expect(depth.gain.calls[0]!.args[0]).toBeCloseTo(2 * 440 * 3.5, 6);
    // One voice: the carrier's `ended` frees it; both oscillators start and stop together.
    expect(mock.voices()).toEqual([carrier]);
    expect(carrier!.startCalls).toEqual(modulator!.startCalls);
    expect(carrier!.stopCalls).toEqual(modulator!.stopCalls);
  });

  it('decays the index toward indexEnd, and blooms it from indexStart', () => {
    const { mock, ctx, out } = setup();
    playFM(ctx, out, { freq: 200, ratio: 1, indexStart: 0.2, index: 2, indexEnd: 0.5, gain: 0.2 });
    const depth = mock.modulators()[0]!.outputs[0] as MockGain;
    const methods = depth.gain.calls.map((c) => c.method);
    expect(methods).toEqual(['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime']);
    const [start, peak, settle] = depth.gain.calls.map((c) => c.args[0]!);
    expect(start).toBeCloseTo(0.2 * 200, 6);
    expect(peak).toBeCloseTo(2 * 200, 6);
    expect(settle).toBeCloseTo(0.5 * 200, 6);
  });

  it('glides both oscillators together, keeping the ratio', () => {
    const { mock, ctx, out } = setup();
    playFM(ctx, out, { freq: 400, freqEnd: 100, glideTime: 0.2, ratio: 2, gain: 0.2 });
    const car = mock.carriers()[0]!;
    const mod = mock.modulators()[0]!;
    const last = (o: MockOscillator): number => o.frequency.calls[o.frequency.calls.length - 1]!.args[0]!;
    expect(last(car)).toBeCloseTo(100, 6);
    expect(last(mod)).toBeCloseTo(200, 6);
  });

  it('follows pitch breakpoints (a held note, then a slide)', () => {
    const { mock, ctx, out } = setup();
    playFM(ctx, out, {
      freq: 300,
      pitch: [
        [0.1, 300, 'lin'],
        [0.2, 320, 'exp'],
      ],
      gain: 0.2,
    });
    const calls = mock.carriers()[0]!.frequency.calls;
    expect(calls.map((c) => c.args[0])).toEqual([300, 300, 320]);
    expect(calls.map((c) => c.args[1])).toEqual([0, 0.1, 0.2]);
  });

  it('detunes every oscillator in the voice alike', () => {
    const { mock, ctx, out } = setup();
    playFM(ctx, out, { freq: 300, gain: 0.2, detune: -7 });
    for (const o of mock.created.oscillators) expect(o.detune.value).toBe(-7);
  });

  it('disconnects the whole voice, depth gain included, when the carrier ends', () => {
    const { mock, ctx, out } = setup();
    const pool = new VoicePool(4);
    playFM(ctx, out, { freq: 300, gain: 0.2, pool });
    expect(pool.active).toBe(1);
    const car = mock.carriers()[0]!;
    const depth = mock.modulators()[0]!.outputs[0] as MockGain;
    car.fireEnded();
    expect(depth.disconnectCount).toBe(1);
    expect(car.frequency.inputs).toHaveLength(0);
    expect(pool.active).toBe(0);
  });

  it('fades and stops both oscillators when the pool steals it', () => {
    const { mock, ctx, out } = setup();
    const pool = new VoicePool(1);
    playFM(ctx, out, { freq: 300, gain: 0.2, hold: 5, pool, priority: 0 });
    playFM(ctx, out, { freq: 600, gain: 0.2, pool, priority: 3 });
    const first = mock.created.oscillators.slice(0, 2);
    for (const o of first) expect(o.stopCalls.length).toBe(2);
  });

  it('ships presets for the palette: glass, e-piano, bass, metal', () => {
    expect(Number.isInteger(FM.glass.ratio)).toBe(false);
    expect(FM.epiano.ratio).toBe(1);
    expect(FM.epiano.indexEnd).toBeLessThan(FM.epiano.index);
    expect(FM.bass.ratio).toBe(1);
    expect(Number.isInteger(FM.metal.ratio)).toBe(false);
    expect(FM.metal.index).toBeGreaterThan(FM.glass.index);
  });
});

describe('startDrone', () => {
  const spec = {
    layers: [
      { kind: 'fm' as const, freq: 73, ratio: 2, index: 0.7, level: 0.5 },
      { kind: 'sine' as const, freq: 146, level: 0.2 },
      { kind: 'noise' as const, rate: 0.5, filter: { type: 'bandpass' as BiquadFilterType, freq: 400 }, level: 0.4 },
    ],
    gain: 0.1,
    fadeIn: 1,
    lease: 5,
  };

  it('runs every layer on a finite lease and fades in', () => {
    const { mock, ctx, out } = setup();
    const drone = startDrone(ctx, out, spec, 0);
    expect(drone).not.toBeNull();
    expect(drone!.until).toBe(5);
    for (const s of mock.sources()) {
      expect(s.startCalls).toEqual([0]);
      expect(s.stopCalls).toEqual([5]);
    }
    const amp = mock.created.gains.find((g) => g.outputs.length > 0 && g.outputs[0]?.kind === 'gain' && g.gain.calls.length > 0)!;
    expect(amp.gain.calls[0]!.args[0]).toBe(0);
  });

  it('extends its lease, and never shortens it that way', () => {
    const { mock, ctx, out } = setup();
    const drone = startDrone(ctx, out, spec, 0)!;
    drone.extend(12);
    drone.extend(8);
    expect(drone.until).toBe(12);
    for (const s of mock.sources()) expect(s.stopCalls[s.stopCalls.length - 1]).toBe(12);
  });

  it('releases with a fade and stops soon after, idempotently', () => {
    const { mock, ctx, out } = setup();
    const drone = startDrone(ctx, out, spec, 0)!;
    mock.advance(1);
    drone.release(1, 0.5);
    drone.release(2, 0.5);
    expect(drone.released).toBe(true);
    for (const s of mock.sources()) {
      const last = s.stopCalls[s.stopCalls.length - 1]!;
      expect(last).toBeGreaterThan(1.5);
      expect(last).toBeLessThan(1.6);
    }
    // Released drones ignore further extensions.
    drone.extend(100);
    expect(drone.until).toBeLessThan(2);
  });
});
