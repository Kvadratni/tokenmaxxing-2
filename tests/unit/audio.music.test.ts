import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SceneKey } from '@sim/types.ts';
import { MockAudioContext, type MockGain } from '@audio/mock-context.ts';
import { createMusic, SCENES, tensionFor, type MusicController } from '@audio/music.ts';

const SCENE_KEYS: readonly SceneKey[] = ['bedroom', 'coworking', 'openplan', 'datacenter', 'orbital'];

interface Rig {
  mock: MockAudioContext;
  out: MockGain;
  music: MusicController;
  /** Advance the audio clock and the scheduler together. */
  run(ms: number): void;
  layers(): { bass: MockGain; lead: MockGain; hat: MockGain };
}

function rig(): Rig {
  const mock = new MockAudioContext();
  const out = mock.createGain();
  const music = createMusic(mock as unknown as BaseAudioContext, out as unknown as AudioNode);
  return {
    mock,
    out,
    music,
    run(ms: number) {
      const ticks = Math.round(ms / 25);
      for (let i = 0; i < ticks; i++) {
        mock.advance(0.025);
        vi.advanceTimersByTime(25);
      }
    },
    layers() {
      const found = mock.created.gains.filter((g) => g.outputs.includes(out));
      const [bass, lead, hat] = found;
      if (!bass || !lead || !hat) throw new Error('music layers missing');
      return { bass, lead, hat };
    },
  };
}

function rampTargets(g: MockGain): number[] {
  return g.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime').map((c) => c.args[0] ?? 0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('scene table', () => {
  it('defines all five SceneKey variations', () => {
    expect(Object.keys(SCENES).sort()).toEqual([...SCENE_KEYS].sort());
  });

  it('escalates from sparse lo-fi bedroom to dense wide orbital', () => {
    const bedroom = SCENES.bedroom;
    const orbital = SCENES.orbital;
    expect(orbital.bpm).toBeGreaterThan(bedroom.bpm);
    expect(orbital.width).toBeGreaterThan(bedroom.width);
    expect(orbital.leadCut).toBeGreaterThan(bedroom.leadCut);
    expect(orbital.bassSteps.length).toBeGreaterThan(bedroom.bassSteps.length);
    expect(orbital.arpEvery).toBeLessThan(bedroom.arpEvery);
  });

  it('gives every scene its own progression or tempo', () => {
    const seen = new Set<string>();
    for (const key of SCENE_KEYS) {
      const s = SCENES[key];
      seen.add(`${s.bpm}:${s.root}:${s.prog.join(',')}`);
    }
    expect(seen.size).toBe(SCENE_KEYS.length);
  });
});

describe('lookahead scheduler', () => {
  it('does not schedule anything before start()', () => {
    const r = rig();
    r.run(500);
    expect(r.mock.sources()).toHaveLength(0);
    expect(r.music.running).toBe(false);
  });

  it('creates exactly one interval and schedules notes ahead of the clock', () => {
    const r = rig();
    r.music.start();
    expect(r.music.running).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    r.music.start(); // idempotent
    expect(vi.getTimerCount()).toBe(1);

    r.run(2000);
    const sources = r.mock.sources();
    expect(sources.length).toBeGreaterThan(4);
    for (const s of sources) {
      // Everything is queued in the future relative to when it was scheduled.
      expect(s.startCalls).toHaveLength(1);
      expect(s.stopCalls).toHaveLength(1);
      expect(s.stopCalls[0]!).toBeGreaterThan(s.startCalls[0]!);
    }
    // Nothing is scheduled more than the lookahead window past the clock.
    const furthest = Math.max(...sources.map((s) => s.startCalls[0] ?? 0));
    expect(furthest).toBeLessThanOrEqual(r.mock.currentTime + 0.35);
  });

  it('drives bass, lead and hat layers on independent gains', () => {
    const r = rig();
    r.music.setScene('orbital');
    r.music.setTension(1);
    r.music.start();
    r.run(1500);

    const { bass, lead, hat } = r.layers();
    expect(bass).not.toBe(lead);
    expect(lead).not.toBe(hat);
    expect(bass.gain.value).toBeGreaterThan(0);
    expect(lead.gain.value).toBeGreaterThan(0);
    expect(hat.gain.value).toBeGreaterThan(0);
    // The hat layer is noise; bass/lead are oscillators.
    expect(r.mock.created.bufferSources.length).toBeGreaterThan(0);
    expect(r.mock.created.oscillators.length).toBeGreaterThan(0);
  });

  it('never leaves an unbounded node behind', () => {
    const r = rig();
    r.music.setScene('datacenter');
    r.music.setTension(0.9);
    r.music.start();
    r.run(4000);
    expect(r.mock.sources().length).toBeGreaterThan(20);
    for (const s of r.mock.sources()) {
      expect(s.stopCalls).toHaveLength(1);
      expect(Number.isFinite(s.stopCalls[0]!)).toBe(true);
    }
  });

  it('caps the voices in flight even at the densest scene and highest tension', () => {
    const r = rig();
    r.music.setScene('orbital');
    r.music.setTension(1);
    r.music.start();
    r.run(3000);
    // Every source that has ended releases its slot; nothing runs away.
    r.mock.flushEnded();
    const live = r.mock.sources().filter((s) => (s.stopCalls[0] ?? 0) > r.mock.currentTime);
    expect(live.length).toBeLessThanOrEqual(20);
  });

  it('resyncs instead of catching up after a long clock jump', () => {
    const r = rig();
    r.music.start();
    r.run(200);
    const before = r.mock.sources().length;
    r.mock.advance(30); // tab was frozen for 30 s
    vi.advanceTimersByTime(25);
    const added = r.mock.sources().length - before;
    expect(added).toBeLessThan(6);
  });
});

describe('setScene', () => {
  it('is safe before start and adopts the scene immediately', () => {
    const r = rig();
    expect(() => r.music.setScene('orbital')).not.toThrow();
    expect(r.music.scene).toBe('orbital');
    r.music.start();
    r.run(1000);
    // Orbital bass is a saw.
    expect(r.mock.created.oscillators.some((o) => o.type === 'sawtooth')).toBe(true);
  });

  it('swaps note content on a bar line and cross-fades the layer gains', () => {
    const r = rig();
    r.music.setScene('bedroom');
    r.music.start();
    r.run(1000);
    expect(r.mock.created.oscillators.every((o) => o.type !== 'sawtooth')).toBe(true);

    const { lead } = r.layers();
    const before = rampTargets(lead).length;
    r.music.setScene('datacenter');
    r.run(6000);

    expect(r.mock.created.oscillators.some((o) => o.type === 'sawtooth')).toBe(true);
    const targets = rampTargets(lead).slice(before);
    // Many small steps, not one jump: the cross-fade is ramped every tick.
    expect(targets.length).toBeGreaterThan(20);
  });

  it('runs faster on later scenes', () => {
    const density = (scene: SceneKey): number => {
      const r = rig();
      r.music.setScene(scene);
      r.music.start();
      r.run(3000);
      const n = r.mock.sources().length;
      r.music.destroy();
      return n;
    };
    expect(density('orbital')).toBeGreaterThan(density('bedroom'));
  });

  it('ignores a repeat of the current scene', () => {
    const r = rig();
    r.music.start();
    r.run(500);
    expect(() => r.music.setScene('bedroom')).not.toThrow();
    expect(r.music.scene).toBe('bedroom');
  });
});

describe('setTension', () => {
  it('is safe before start and is applied once playing', () => {
    const r = rig();
    expect(() => r.music.setTension(0.8)).not.toThrow();
    expect(r.music.tension).toBeCloseTo(0.8, 6);
    r.music.start();
    r.run(500);
    expect(r.layers().hat.gain.value).toBeGreaterThan(0);
  });

  it('clamps out-of-range input', () => {
    const r = rig();
    r.music.setTension(9);
    expect(r.music.tension).toBe(1);
    r.music.setTension(-4);
    expect(r.music.tension).toBe(0);
    r.music.setTension(Number.NaN);
    expect(r.music.tension).toBe(0);
  });

  it('ramps smoothly rather than stepping', () => {
    const r = rig();
    r.music.start();
    r.run(200);
    const { hat } = r.layers();
    const baseline = rampTargets(hat).length;

    r.music.setTension(1);
    r.run(2000);

    const targets = rampTargets(hat).slice(baseline);
    expect(targets.length).toBeGreaterThan(40);
    const distinct = new Set(targets.map((t) => t.toFixed(6)));
    expect(distinct.size).toBeGreaterThan(20);

    // Monotonic climb with no single jump dominating the range.
    const span = targets[targets.length - 1]! - targets[0]!;
    expect(span).toBeGreaterThan(0);
    let maxStep = 0;
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]!).toBeGreaterThanOrEqual(targets[i - 1]! - 1e-9);
      maxStep = Math.max(maxStep, targets[i]! - targets[i - 1]!);
    }
    expect(maxStep).toBeLessThan(span * 0.25);
  });

  it('brings in the hat layer and lifts the tempo as tension rises', () => {
    const calm = rig();
    calm.music.setScene('openplan');
    calm.music.setTension(0);
    calm.music.start();
    calm.run(3000);
    const calmHat = calm.layers().hat.gain.value;
    const calmNotes = calm.mock.sources().length;

    const panic = rig();
    panic.music.setScene('openplan');
    panic.music.setTension(1);
    panic.music.start();
    panic.run(3000);
    const panicHat = panic.layers().hat.gain.value;
    const panicNotes = panic.mock.sources().length;

    expect(panicHat).toBeGreaterThan(calmHat * 3);
    // Faster tempo => more grid steps in the same wall time.
    expect(panicNotes).toBeGreaterThan(calmNotes);
  });

  it('adds a dissonant tail only at high tension', () => {
    const pitches = (t: number): Set<string> => {
      const r = rig();
      r.music.setScene('bedroom');
      r.music.setTension(t);
      r.music.start();
      r.run(8000);
      const s = new Set(
        r.mock.created.oscillators.map((o) => (o.frequency.calls[0]?.args[0] ?? 0).toFixed(2)),
      );
      r.music.destroy();
      return s;
    };
    expect(pitches(1).size).toBeGreaterThan(pitches(0).size);
  });
});

describe('tensionFor', () => {
  const at = (patienceProgress: number, contextFill: number): number =>
    tensionFor({ patienceProgress, contextFill });

  it('is calm with a patient human and an empty window', () => {
    expect(at(1, 0)).toBe(0);
  });

  it('rises linearly as patience runs out', () => {
    expect(at(0.75, 0)).toBeCloseTo(0.25, 9);
    expect(at(0.25, 0)).toBeCloseTo(0.75, 9);
    expect(at(0, 0)).toBe(1);
  });

  it('rises with the square of context fill, so a half-full window stays calm', () => {
    expect(at(1, 0.5)).toBeCloseTo(0.25, 9);
    expect(at(1, 0.9)).toBeCloseTo(0.81, 9);
    expect(at(1, 1)).toBe(1);
  });

  it('follows whichever clock is closer to ending the run', () => {
    expect(at(0.5, 0.9)).toBeCloseTo(0.81, 9);
    expect(at(0.1, 0.9)).toBeCloseTo(0.9, 9);
    expect(at(0.3, 0.3)).toBeCloseTo(0.7, 9);
  });

  it('stays inside 0..1 for out-of-range readings', () => {
    expect(at(-1, 0)).toBe(1);
    expect(at(2, 0)).toBe(0);
    expect(at(1, 3)).toBe(1);
    expect(at(1, -2)).toBe(0);
    for (const p of [-5, -0.5, 0, 0.4, 1, 7]) {
      for (const c of [-3, 0, 0.6, 1, 9]) {
        const t = at(p, c);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });

  it('treats a non-finite reading as calm on its own axis only', () => {
    expect(at(Number.NaN, 0.5)).toBeCloseTo(0.25, 9);
    expect(at(0.2, Number.NaN)).toBeCloseTo(0.8, 9);
    expect(at(Number.NaN, Number.NaN)).toBe(0);
    expect(at(Number.POSITIVE_INFINITY, 0)).toBe(0);
    expect(at(1, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('never goes down as either clock runs out', () => {
    let prev = -1;
    for (let p = 1; p >= 0; p -= 0.05) {
      const t = at(p, 0.4);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    prev = -1;
    for (let c = 0; c <= 1; c += 0.05) {
      const t = at(0.9, c);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('drives the score: a nearly full window brings the hats in', () => {
    const r = rig();
    r.music.setTension(tensionFor({ patienceProgress: 1, contextFill: 0.97 }));
    r.music.start();
    r.run(1500);
    const calm = rig();
    calm.music.setTension(tensionFor({ patienceProgress: 1, contextFill: 0.2 }));
    calm.music.start();
    calm.run(1500);
    expect(r.layers().hat.gain.value).toBeGreaterThan(calm.layers().hat.gain.value * 3);
  });
});

describe('lifecycle', () => {
  it('suspends and resumes cleanly without leaking intervals', () => {
    const r = rig();
    r.music.start();
    expect(vi.getTimerCount()).toBe(1);

    r.music.suspend();
    expect(r.music.running).toBe(false);
    expect(r.music.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const frozen = r.mock.sources().length;
    r.run(2000);
    expect(r.mock.sources()).toHaveLength(frozen);

    r.music.resume();
    expect(r.music.running).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    r.run(1000);
    expect(r.mock.sources().length).toBeGreaterThan(frozen);
  });

  it('will not start while suspended', () => {
    const r = rig();
    r.music.suspend();
    r.music.start();
    expect(r.music.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('setEnabled(false) halts the scheduler and silences the layers', () => {
    const r = rig();
    r.music.setTension(1);
    r.music.start();
    r.run(1000);
    expect(r.layers().lead.gain.value).toBeGreaterThan(0);

    r.music.setEnabled(false);
    expect(r.music.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const { bass, lead, hat } = r.layers();
    expect(bass.gain.value).toBe(0);
    expect(lead.gain.value).toBe(0);
    expect(hat.gain.value).toBe(0);

    r.music.setEnabled(true);
    expect(r.music.running).toBe(true);
  });

  it('destroy() clears the interval and disconnects the layers', () => {
    const r = rig();
    r.music.start();
    r.run(500);
    const { bass, lead, hat } = r.layers();

    r.music.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.music.running).toBe(false);
    expect(bass.disconnectCount).toBe(1);
    expect(lead.disconnectCount).toBe(1);
    expect(hat.disconnectCount).toBe(1);

    // Post-destroy calls are inert.
    expect(() => {
      r.music.start();
      r.music.setScene('orbital');
      r.music.setTension(1);
      r.music.destroy();
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
