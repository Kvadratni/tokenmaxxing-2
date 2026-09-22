import { describe, expect, it } from 'vitest';

import {
  MockAudioContext,
  stripFeatures,
  type MockGain,
  type MockOscillator,
} from '@audio/mock-context.ts';
import {
  applyADSR,
  DEFAULT_ADSR,
  envTimes,
  mtof,
  noiseBuffer,
  playTone,
  pulseWave,
  VoicePool,
} from '@audio/synth.ts';

function ctxOf(mock: MockAudioContext): BaseAudioContext {
  return mock as unknown as BaseAudioContext;
}

function outOf(gain: MockGain): AudioNode {
  return gain as unknown as AudioNode;
}

function setup(): { mock: MockAudioContext; ctx: BaseAudioContext; out: AudioNode } {
  const mock = new MockAudioContext();
  const out = mock.createGain();
  return { mock, ctx: ctxOf(mock), out: outOf(out) };
}

describe('mtof', () => {
  it('anchors A4 at 440 Hz', () => {
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(81)).toBeCloseTo(880, 6);
    expect(mtof(57)).toBeCloseTo(220, 6);
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

  it('fills the buffer with non-silent, bounded samples', () => {
    const { mock, ctx } = setup();
    noiseBuffer(ctx);
    const buf = mock.created.buffers[0];
    expect(buf).toBeDefined();
    const data = buf!.getChannelData(0);
    let energy = 0;
    let peak = 0;
    for (let i = 0; i < 2000; i++) {
      const v = data[i] ?? 0;
      energy += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    expect(energy).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(1);
  });
});

describe('pulseWave', () => {
  it('caches one PeriodicWave per (context, duty)', () => {
    const { mock, ctx } = setup();
    const a = pulseWave(ctx, 0.25);
    const b = pulseWave(ctx, 0.25);
    const c = pulseWave(ctx, 0.5);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(mock.created.periodicWaves).toHaveLength(2);
  });

  it('falls back to a square wave when createPeriodicWave is missing', () => {
    const mock = new MockAudioContext();
    const out = mock.createGain();
    stripFeatures(mock, 'createPeriodicWave');
    playTone(ctxOf(mock), outOf(out), { wave: 'pulse', duty: 0.25, freq: 440, gain: 0.2 });
    const osc = mock.created.oscillators[0];
    expect(osc?.type).toBe('square');
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
      wave: 'pulse',
      duty: 0.3,
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

  it('maps wave names onto oscillator types', () => {
    const { mock, ctx, out } = setup();
    playTone(ctx, out, { wave: 'saw', freq: 100, gain: 0.2 });
    playTone(ctx, out, { wave: 'triangle', freq: 100, gain: 0.2 });
    playTone(ctx, out, { wave: 'square', freq: 100, gain: 0.2 });
    playTone(ctx, out, { wave: 'sine', freq: 100, gain: 0.2 });
    const types = mock.created.oscillators.map((o: MockOscillator) => o.type);
    expect(types).toEqual(['sawtooth', 'triangle', 'square', 'sine']);
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
    expect(osc.frequency.calls.map((c) => c.method)).toEqual([
      'setValueAtTime',
      'exponentialRampToValueAtTime',
    ]);
    expect(osc.frequency.calls[1]!.args[0]).toBe(100);
    expect(mock.created.filters[0]!.frequency.calls[1]!.args[0]).toBe(300);
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
    stripFeatures(mock, 'createBiquadFilter', 'createStereoPanner');
    const end = playTone(ctxOf(mock), outOf(out), {
      freq: 440,
      gain: 0.2,
      pan: 0.8,
      filter: { type: 'lowpass', freq: 1000 },
    });
    expect(end).not.toBeNull();
    expect(mock.created.filters).toHaveLength(0);
    expect(mock.created.panners).toHaveLength(0);
    expect(mock.created.oscillators[0]!.stopCalls).toHaveLength(1);
  });
});
