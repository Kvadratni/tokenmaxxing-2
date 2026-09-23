import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SceneKey } from '@sim/types.ts';
import { MockAudioContext, type MockGain } from '@audio/mock-context.ts';
import {
  arrange,
  contextFillFor,
  createMusic,
  CYCLE_BARS,
  densityCount,
  HARMONY,
  LOOP_BARS,
  MUSIC_VOICE_CAP,
  PAD_CUTOFF_EMPTY,
  PAD_CUTOFF_FULL,
  padCutoffFor,
  passFor,
  PRESSURE_FROM,
  pressureFor,
  SCENES,
  STEPS_PER_BAR,
  tensionFor,
  THEME,
  toneShelfFor,
  XFADE_BARS,
  type MusicController,
  type MusicNote,
  type MusicOptions,
  type PartName,
} from '@audio/music.ts';

const SCENE_KEYS: readonly SceneKey[] = ['bedroom', 'coworking', 'openplan', 'datacenter', 'orbital'];
/** D Dorian's pitch classes: D E F G A B C. */
const DORIAN = new Set([2, 4, 5, 7, 9, 11, 0]);

interface Played {
  readonly scene: SceneKey;
  readonly note: MusicNote;
  readonly when: number;
}

interface Rig {
  mock: MockAudioContext;
  out: MockGain;
  music: MusicController;
  notes: Played[];
  /** Advance the audio clock and the scheduler together. */
  run(ms: number): void;
  of(part: PartName, scene?: SceneKey): Played[];
}

function rig(opts: MusicOptions = {}): Rig {
  const mock = new MockAudioContext();
  const out = mock.createGain();
  const notes: Played[] = [];
  const music = createMusic(mock as unknown as BaseAudioContext, out as unknown as AudioNode, {
    ...opts,
    onNote: (scene, note, when) => notes.push({ scene, note, when }),
  });
  return {
    mock,
    out,
    music,
    notes,
    run(ms: number) {
      const ticks = Math.round(ms / 25);
      for (let i = 0; i < ticks; i++) {
        mock.advance(0.025);
        vi.advanceTimersByTime(25);
      }
    },
    of(part, scene) {
      return notes.filter((n) => n.note.part === part && (scene === undefined || n.scene === scene));
    },
  };
}

/** The score's output gain (the one wired to `out`). */
function master(r: Rig): MockGain {
  const g = r.mock.created.gains.find((x) => x !== r.out && x.outputs.includes(r.out));
  if (!g) throw new Error('no music master');
  return g;
}

function barSeconds(scene: SceneKey): number {
  return (4 * 60) / SCENES[scene].bpm;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('the theme', () => {
  it('is four bars in D Dorian, every bar with something in it', () => {
    const bars = new Set(THEME.map(([bar]) => bar));
    expect([...bars].sort()).toEqual([0, 1, 2, 3]);
    for (const [, , midi] of THEME) expect(DORIAN.has(midi % 12), `MIDI ${midi}`).toBe(true);
  });

  it('opens with the climb of tokens, D F G A, on straight eighths', () => {
    const opening = THEME.filter(([bar, step]) => bar === 0 && step <= 6);
    expect(opening.map(([, step]) => step)).toEqual([0, 2, 4, 6]);
    expect(opening.map(([, , midi]) => midi)).toEqual([74, 77, 79, 81]);
    // ...and bar 2 climbs the same way, reaching higher.
    const again = THEME.filter(([bar, step]) => bar === 2 && step <= 6).map(([, , midi]) => midi);
    expect(again).toEqual([74, 77, 79, 81]);
    expect(Math.max(...THEME.filter(([bar]) => bar === 2).map(([, , m]) => m))).toBeGreaterThan(81);
  });

  it('is one line: no two notes overlap, and the last one ends on the loop seam', () => {
    const abs = THEME.map(([bar, step, , len]) => [bar * STEPS_PER_BAR + step, len] as const).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < abs.length; i++) {
      expect(abs[i - 1]![0] + abs[i - 1]![1]).toBeLessThanOrEqual(abs[i]![0]);
    }
    const [lastStart, lastLen] = abs[abs.length - 1]!;
    expect(lastStart + lastLen).toBe(LOOP_BARS * STEPS_PER_BAR);
  });

  it('sits over four chords that every harmony voices in four notes', () => {
    for (const [name, chords] of Object.entries(HARMONY)) {
      expect(chords, name).toHaveLength(LOOP_BARS);
      for (const c of chords) {
        expect(c.voicing, `${name} ${c.name}`).toHaveLength(4);
        expect(c.arp.length).toBeGreaterThanOrEqual(5);
      }
    }
    // Same roots under all three: one song, three moods.
    const roots = (h: keyof typeof HARMONY): number[] => HARMONY[h].map((c) => c.bass);
    expect(roots('dark')).toEqual(roots('dorian'));
    expect(roots('bright')).toEqual(roots('dorian'));
  });
});

describe('the five arrangements', () => {
  it('defines one per SceneKey, downtempo, escalating from 84 to 96 BPM', () => {
    expect(Object.keys(SCENES).sort()).toEqual([...SCENE_KEYS].sort());
    let prev = 0;
    for (const key of SCENE_KEYS) {
      const bpm = SCENES[key].bpm;
      expect(bpm).toBeGreaterThanOrEqual(84);
      expect(bpm).toBeLessThanOrEqual(96);
      expect(bpm).toBeGreaterThan(prev);
      prev = bpm;
    }
  });

  it('bedroom: lo-fi e-piano and vinyl, sparse, no band', () => {
    const s = SCENES.bedroom;
    expect(s.lead).toBe('epiano');
    expect(s.keys.length).toBeGreaterThan(0);
    expect(s.texture).toBe('vinyl');
    expect(s.crackle).toBeGreaterThan(0);
    expect(s.bass).toHaveLength(0);
    expect([...s.kick, ...s.snare, ...s.rim]).toHaveLength(0);
    expect(densityCount(s.hat, 0)).toBe(0);
    expect(densityCount(s.arp, 0)).toBe(0);
  });

  it('coworking: adds a round FM bass and a soft beat (kick, hat, rim)', () => {
    const s = SCENES.coworking;
    expect(s.bass.length).toBeGreaterThan(0);
    expect(s.bassVoice).toBe('round');
    expect(s.kick.length).toBeGreaterThan(0);
    expect(s.rim.length).toBeGreaterThan(0);
    expect(densityCount(s.hat, 0)).toBeGreaterThan(0);
  });

  it('openplan: busier drums and an arpeggio', () => {
    const co = SCENES.coworking;
    const op = SCENES.openplan;
    const hits = (s: typeof co): number => s.kick.length + s.snare.length + s.rim.length + densityCount(s.hat, 0);
    expect(hits(op)).toBeGreaterThan(hits(co));
    expect(densityCount(op.arp, 0)).toBeGreaterThanOrEqual(8);
    expect(densityCount(co.arp, 0)).toBe(0);
  });

  it('datacenter: darker harmony, an industrial hum, a gritty bass', () => {
    const s = SCENES.datacenter;
    expect(s.harmony).toBe('dark');
    expect(s.texture).toBe('hum');
    expect(s.bassVoice).toBe('grit');
    expect(s.shelf).toBeLessThan(SCENES.openplan.shelf);
    expect(s.leadOct).toBeLessThan(0);
  });

  it('orbital: spacey wide pads, glass bells on the theme, the widest, most echoing arp', () => {
    const s = SCENES.orbital;
    expect(s.pad).toBe('wide');
    expect(s.lead).toBe('glass');
    expect(s.harmony).toBe('bright');
    for (const other of SCENE_KEYS.filter((k) => k !== 'orbital')) {
      expect(s.arpWidth, other).toBeGreaterThan(SCENES[other].arpWidth);
      expect(s.echo, other).toBeGreaterThan(SCENES[other].echo);
      expect(s.reverb, other).toBeGreaterThan(SCENES[other].reverb);
    }
  });

  it('every scene keeps a pad (the context filter needs something to open)', () => {
    for (const key of SCENE_KEYS) expect(SCENES[key].mix.pad, key).toBeGreaterThan(0);
  });
});

describe('arrange()', () => {
  it('is pure', () => {
    for (const key of SCENE_KEYS) {
      expect(arrange(key, 5, 3, 0.4)).toEqual(arrange(key, 5, 3, 0.4));
    }
  });

  it('loops: everything repeats every cycle, and the harmony every four bars', () => {
    for (const key of SCENE_KEYS) {
      for (let bar = 0; bar < CYCLE_BARS; bar++) {
        for (let step = 0; step < STEPS_PER_BAR; step++) {
          expect(arrange(key, bar + CYCLE_BARS, step, 0.5)).toEqual(arrange(key, bar, step, 0.5));
        }
        const pads = (b: number): number[] => arrange(key, b, 0, 0).filter((n) => n.part === 'pad').map((n) => n.midi);
        expect(pads(bar + LOOP_BARS)).toEqual(pads(bar));
      }
    }
  });

  it('plays the theme itself as the lead, pass by pass', () => {
    const lead = (key: SceneKey, bar: number): number[] => {
      const out: number[] = [];
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        for (const n of arrange(key, bar, step, 0)) if (n.part === 'lead') out.push(n.midi);
      }
      return out;
    };
    // Bedroom: pass 0 is the whole theme...
    expect(passFor('bedroom', 0)).toBe('theme');
    const expected = THEME.filter(([b]) => b === 0).map(([, , m]) => m);
    expect(lead('bedroom', 0)).toEqual(expected);
    // ...pass 1 rests...
    expect(passFor('bedroom', 4)).toBe('rest');
    for (let b = 4; b < 8; b++) expect(lead('bedroom', b)).toEqual([]);
    // ...and a call pass keeps only the call bars.
    expect(passFor('bedroom', 12)).toBe('call');
    expect(lead('bedroom', 12).length).toBeGreaterThan(0);
    expect(lead('bedroom', 13)).toEqual([]);
    // Orbit plays it an octave up; the machine room an octave down, with the sixth flattened.
    expect(lead('orbital', 0)).toEqual(expected.map((m) => m + 12));
    const dark = [0, 1, 2, 3].flatMap((b) => lead('datacenter', b));
    expect(dark.some((m) => m % 12 === 10)).toBe(true);
    expect(dark.some((m) => m % 12 === 11)).toBe(false);
  });

  it('adds hat and arp density as tension rises, in every scene', () => {
    for (const key of SCENE_KEYS) {
      const s = SCENES[key];
      let prevHat = -1;
      let prevArp = -1;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const hat = densityCount(s.hat, t);
        const arp = densityCount(s.arp, t);
        expect(hat, `${key} hat at ${t}`).toBeGreaterThanOrEqual(prevHat);
        expect(arp, `${key} arp at ${t}`).toBeGreaterThanOrEqual(prevArp);
        prevHat = hat;
        prevArp = arp;
      }
      expect(densityCount(s.hat, 1), key).toBeGreaterThan(densityCount(s.hat, 0));
      expect(densityCount(s.arp, 1), key).toBeGreaterThan(densityCount(s.arp, 0));
      // The same through arrange() itself.
      const count = (part: PartName, t: number): number => {
        let n = 0;
        for (let step = 0; step < STEPS_PER_BAR; step++) n += arrange(key, 0, step, t).filter((x) => x.part === part).length;
        return n;
      };
      expect(count('hat', 1)).toBeGreaterThan(count('hat', 0));
      expect(count('arp', 1)).toBeGreaterThan(count('arp', 0));
    }
  });

  it('never schedules early: every nudge is late or on time', () => {
    for (const key of SCENE_KEYS) {
      for (let bar = 0; bar < CYCLE_BARS; bar++) {
        for (let step = 0; step < STEPS_PER_BAR; step++) {
          for (const n of arrange(key, bar, step, 1)) expect(n.nudge).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------

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

    r.run(3000);
    const voices = r.mock.voices();
    expect(voices.length).toBeGreaterThan(4);
    for (const s of voices) {
      expect(s.startCalls).toHaveLength(1);
      expect(s.stopCalls[s.stopCalls.length - 1]!).toBeGreaterThan(s.startCalls[0]!);
    }
    const furthest = Math.max(...r.mock.sources().map((s) => s.startCalls[0] ?? 0));
    expect(furthest).toBeLessThanOrEqual(r.mock.currentTime + 0.35);
  });

  it('loops seamlessly: the grid runs straight through the loop seam, bar after bar', () => {
    const r = rig();
    r.music.setScene('coworking');
    r.music.start();
    const start = r.mock.currentTime + 0.06;
    r.run(barSeconds('coworking') * 1000 * (LOOP_BARS + 2));
    const step = barSeconds('coworking') / STEPS_PER_BAR;
    const kicks = r.of('kick');
    expect(kicks.length).toBeGreaterThanOrEqual(SCENES.coworking.kick.length * (LOOP_BARS + 1));
    const swing = SCENES.coworking.swing * step;
    for (const k of kicks) {
      const grid = (k.when - start) / step;
      const idx = Math.round(grid);
      const expected = start + idx * step + (idx % 2 === 1 ? swing : 0);
      expect(k.when).toBeCloseTo(expected, 6);
      expect(SCENES.coworking.kick).toContain(idx % STEPS_PER_BAR);
    }
    // The Dm9 downbeat comes round again exactly one loop later.
    const chords = new Map<number, number[]>();
    for (const p of r.of('pad')) chords.set(p.when, [...(chords.get(p.when) ?? []), p.note.midi]);
    const dm9 = HARMONY.dorian[0]!.voicing.join(',');
    const downbeats = [...chords.entries()].filter(([, ms]) => [...ms].sort((a, b) => a - b).join(',') === dm9).map(([t]) => t);
    expect(downbeats.length).toBeGreaterThanOrEqual(2);
    expect(downbeats[1]! - downbeats[0]!).toBeCloseTo(barSeconds('coworking') * LOOP_BARS, 6);
  });

  it('never leaves an unbounded node behind', () => {
    const r = rig();
    r.music.setScene('datacenter');
    r.music.setTension(0.9);
    r.music.setContextFill(0.95);
    r.music.start();
    r.run(4000);
    expect(r.mock.sources().length).toBeGreaterThan(20);
    for (const s of r.mock.sources()) {
      expect(s.stopCalls.length).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(s.stopCalls[s.stopCalls.length - 1]!)).toBe(true);
    }
  });

  it('caps the voices in flight even at the densest scene and highest tension', () => {
    const r = rig();
    r.music.setScene('orbital');
    r.music.setTension(1);
    r.music.start();
    r.run(6000);
    r.mock.flushEnded();
    const live = r.mock.voices().filter((s) => (s.stopCalls[s.stopCalls.length - 1] ?? 0) > r.mock.currentTime);
    // Drones sit outside the note budget: a texture bed and the pressure drone at most.
    expect(live.length).toBeLessThanOrEqual(MUSIC_VOICE_CAP + 2);
    expect(r.music.inspect().voices).toBeLessThanOrEqual(MUSIC_VOICE_CAP);
  });

  it('resyncs instead of catching up after a long clock jump', () => {
    const r = rig();
    r.music.start();
    r.run(200);
    const before = r.notes.length;
    r.mock.advance(30); // tab was frozen for 30 s
    vi.advanceTimersByTime(25);
    expect(r.notes.length - before).toBeLessThan(12);
  });

  it('keeps the tempo when tension changes', () => {
    const r = rig();
    r.music.setScene('openplan');
    r.music.start();
    r.run(500);
    const calm = r.music.inspect().bpm;
    r.music.setTension(1);
    r.run(2000);
    expect(r.music.inspect().bpm).toBe(calm);
    expect(calm).toBe(SCENES.openplan.bpm);
  });

  it('runs a texture bed where the room has one, on a renewable lease', () => {
    const r = rig();
    r.music.setScene('datacenter');
    r.music.start();
    r.run(200);
    // The hum: long-running sources whose stop sits a lease away, not a note away.
    const beds = r.mock.sources().filter((s) => (s.stopCalls[s.stopCalls.length - 1] ?? 0) > r.mock.currentTime + 10);
    expect(beds.length).toBeGreaterThan(0);
    r.music.stop();
    for (const s of beds) expect(s.stopCalls[s.stopCalls.length - 1]!).toBeLessThan(r.mock.currentTime + 0.5);
  });
});

describe('setScene', () => {
  it('is safe before start and adopts the scene immediately', () => {
    const r = rig();
    expect(() => r.music.setScene('orbital')).not.toThrow();
    expect(r.music.scene).toBe('orbital');
    expect(r.music.inspect().playing).toBe('orbital');
    r.music.start();
    r.run(1000);
    expect(r.notes.every((n) => n.scene === 'orbital')).toBe(true);
  });

  it('crossfades from the next bar line, over two bars, with the theme in phase', () => {
    const r = rig();
    r.music.setScene('bedroom');
    r.music.start();
    r.run(1000);
    expect(r.of('kick')).toHaveLength(0);

    const asked = r.mock.currentTime;
    r.music.setScene('coworking');
    expect(r.music.scene).toBe('coworking');
    r.run(barSeconds('bedroom') * 1000 + 200);
    const state = r.music.inspect();
    expect(state.crossfading).toBe(true);
    expect(state.playing).toBe('bedroom');

    // The new arrangement came in on a bar line, not the moment it was asked for.
    const firstKick = r.of('kick', 'coworking')[0]!;
    expect(firstKick.when).toBeGreaterThan(asked);
    expect(firstKick.note.part).toBe('kick');
    const bedroomPads = r.of('pad', 'bedroom').map((p) => p.when);
    const coworkPads = r.of('pad', 'coworking').map((p) => p.when);
    expect(coworkPads.length).toBeGreaterThan(0);
    // Both decks strike the same downbeat: one transport.
    expect(bedroomPads).toContain(coworkPads[0]);

    r.run(barSeconds('coworking') * 1000 * (XFADE_BARS + 1));
    const after = r.music.inspect();
    expect(after.crossfading).toBe(false);
    expect(after.playing).toBe('coworking');
    expect(after.bpm).toBe(SCENES.coworking.bpm);
    const late = r.notes.filter((n) => n.when > r.mock.currentTime - 0.5);
    expect(late.every((n) => n.scene === 'coworking')).toBe(true);
  });

  it('glides the tempo across the crossfade instead of jumping', () => {
    const r = rig();
    r.music.setScene('bedroom');
    r.music.start();
    r.run(500);
    r.music.setScene('orbital');
    const bpms: number[] = [];
    for (let i = 0; i < 400; i++) {
      r.run(25);
      bpms.push(r.music.inspect().bpm);
    }
    expect(bpms[0]).toBe(SCENES.bedroom.bpm);
    expect(bpms[bpms.length - 1]).toBe(SCENES.orbital.bpm);
    const between = bpms.filter((b) => b > SCENES.bedroom.bpm && b < SCENES.orbital.bpm);
    expect(new Set(between).size).toBeGreaterThan(10);
    for (let i = 1; i < bpms.length; i++) expect(bpms[i]!).toBeGreaterThanOrEqual(bpms[i - 1]!);
  });

  it('fades the decks along an equal-power curve', () => {
    const r = rig();
    r.music.start();
    r.run(300);
    const before = new Set(r.mock.created.gains.map((g) => g));
    r.music.setScene('openplan');
    r.run(barSeconds('bedroom') * 1000 + 100);
    // The deck level gains carry a scheduled curve of many ramps.
    const faded = r.mock.created.gains.filter(
      (g) => before.has(g) && g.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime').length >= 10,
    );
    expect(faded.length).toBeGreaterThanOrEqual(8);
    const rising = faded.find((g) => g.gain.calls.find((c) => c.method === 'setValueAtTime')?.args[0] === 0)!;
    const ramps = rising.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime');
    const mid = ramps[Math.floor(ramps.length / 2) - 1]!.args[0]!;
    expect(mid).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('ignores a repeat of the current scene, and queues a change asked for mid-fade', () => {
    const r = rig();
    r.music.start();
    r.run(500);
    r.music.setScene('bedroom');
    r.run(barSeconds('bedroom') * 1000 + 100);
    expect(r.music.inspect().crossfading).toBe(false);

    r.music.setScene('coworking');
    r.run(barSeconds('bedroom') * 1000 + 100);
    expect(r.music.inspect().crossfading).toBe(true);
    r.music.setScene('datacenter');
    r.run(barSeconds('coworking') * 1000 * (XFADE_BARS * 2 + 3));
    expect(r.music.inspect().playing).toBe('datacenter');
    expect(r.of('pad', 'coworking').length).toBeGreaterThan(0);
  });
});

describe('setTension', () => {
  it('is safe before start and is applied once playing', () => {
    const r = rig();
    expect(() => r.music.setTension(0.8)).not.toThrow();
    expect(r.music.tension).toBeCloseTo(0.8, 6);
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

  it('lifts a high shelf over the whole score, smoothly, by the same amount in every room', () => {
    for (const key of SCENE_KEYS) {
      expect(toneShelfFor(key, 1) - toneShelfFor(key, 0)).toBeCloseTo(toneShelfFor('bedroom', 1) - toneShelfFor('bedroom', 0), 6);
      expect(toneShelfFor(key, 1)).toBeGreaterThan(toneShelfFor(key, 0));
      // Subtle: never a boost of more than a couple of dB.
      expect(toneShelfFor(key, 1)).toBeLessThanOrEqual(2);
    }
    const r = rig();
    r.music.start();
    r.run(300);
    const calm = r.music.inspect().toneShelf;
    r.music.setTension(1);
    const trace: number[] = [];
    for (let i = 0; i < 80; i++) {
      r.run(25);
      trace.push(r.music.inspect().toneShelf);
    }
    expect(trace[trace.length - 1]!).toBeCloseTo(toneShelfFor('bedroom', 1), 1);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]!).toBeGreaterThanOrEqual(trace[i - 1]! - 1e-9);
      expect(trace[i]! - trace[i - 1]!).toBeLessThan((toneShelfFor('bedroom', 1) - calm) * 0.25);
    }
  });

  it('brings in more hats and more arp as the session gets tense', () => {
    const count = (t: number): { hat: number; arp: number } => {
      const r = rig();
      r.music.setScene('coworking');
      r.music.setTension(t);
      r.music.start();
      r.run(barSeconds('coworking') * 1000 * 2);
      const out = { hat: r.of('hat').length, arp: r.of('arp').length };
      r.music.destroy();
      return out;
    };
    const calm = count(0);
    const panic = count(1);
    expect(panic.hat).toBeGreaterThan(calm.hat);
    expect(panic.arp).toBeGreaterThan(calm.arp);
    expect(calm.arp).toBe(0);
  });
});

describe('setContextFill', () => {
  it('maps fill to the pad cutoff: muffled when empty, bright near full', () => {
    expect(padCutoffFor(0)).toBeCloseTo(PAD_CUTOFF_EMPTY, 6);
    expect(padCutoffFor(1)).toBeCloseTo(PAD_CUTOFF_FULL, 6);
    expect(PAD_CUTOFF_FULL / PAD_CUTOFF_EMPTY).toBeGreaterThan(16);
    let prev = 0;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const c = padCutoffFor(f);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
    expect(padCutoffFor(Number.NaN)).toBeCloseTo(PAD_CUTOFF_EMPTY, 6);
    expect(padCutoffFor(7)).toBeCloseTo(PAD_CUTOFF_FULL, 6);
  });

  it('fades the pressure drone in only above 80%', () => {
    expect(PRESSURE_FROM).toBe(0.8);
    for (const f of [0, 0.3, 0.6, 0.79, 0.8]) expect(pressureFor(f), `${f}`).toBe(0);
    expect(pressureFor(0.9)).toBeCloseTo(0.5, 6);
    expect(pressureFor(1)).toBe(1);
    let prev = 0;
    for (let f = 0.8; f <= 1.0001; f += 0.01) {
      expect(pressureFor(f)).toBeGreaterThanOrEqual(prev);
      prev = pressureFor(f);
    }
  });

  it('drives the pad filter and the drone in the running score', () => {
    const r = rig();
    r.music.start();
    r.run(300);
    expect(r.music.inspect().pressure).toBe(0);
    const existing = new Set(r.mock.sources());

    r.music.setContextFill(0.97);
    r.run(3000);
    const full = r.music.inspect();
    expect(full.contextFill).toBeCloseTo(0.97, 2);
    expect(Math.abs(full.padCutoff / padCutoffFor(0.97) - 1)).toBeLessThan(0.02);
    expect(full.pressure).toBeGreaterThan(0.85);
    // The pad's own low-pass follows, in small steps.
    const near = (v: number | undefined): boolean => Math.abs((v ?? 0) / padCutoffFor(0.97) - 1) < 0.02;
    const padLP = r.mock.created.filters.find(
      (f) => f.type === 'lowpass' && f.frequency.calls.some((c) => c.method === 'linearRampToValueAtTime' && near(c.args[0])),
    );
    expect(padLP).toBeDefined();
    const ramps = padLP!.frequency.calls.filter((c) => c.method === 'linearRampToValueAtTime').map((c) => c.args[0]!);
    expect(ramps.length).toBeGreaterThan(40);
    // A drone started: sources on a long lease.
    const drones = r.mock
      .sources()
      .filter((s) => !existing.has(s))
      .filter((s) => (s.stopCalls[s.stopCalls.length - 1] ?? 0) > r.mock.currentTime + 10);
    expect(drones.length).toBeGreaterThan(0);

    r.music.setContextFill(0.4);
    r.run(3000);
    expect(r.music.inspect().pressure).toBe(0);
    for (const d of drones) expect(d.stopCalls[d.stopCalls.length - 1]!).toBeLessThan(r.mock.currentTime + 2);
  });

  it('is safe before start, and clamps', () => {
    const r = rig();
    r.music.setContextFill(0.6);
    expect(r.music.contextFill).toBeCloseTo(0.6, 6);
    r.music.setContextFill(5);
    expect(r.music.contextFill).toBe(1);
    r.music.setContextFill(Number.NaN);
    expect(r.music.contextFill).toBe(0);
  });
});

describe('duck', () => {
  it('dips the score under a big moment, then lets it back up', () => {
    const r = rig();
    r.music.start();
    r.run(500);
    r.music.duck(0.8, 0.5);
    r.run(200);
    expect(r.music.inspect().duck).toBeLessThan(0.3);
    r.run(1000);
    const coming = r.music.inspect().duck;
    expect(coming).toBeGreaterThan(0.3);
    expect(coming).toBeLessThan(1);
    r.run(5000);
    expect(r.music.inspect().duck).toBe(1);
  });
});

describe('tensionFor', () => {
  const at = (patienceProgress: number, contextFill: number): number => tensionFor({ patienceProgress, contextFill });

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
});

describe('contextFillFor', () => {
  it('passes the fill through, clamped, NaN as empty and infinity as full', () => {
    expect(contextFillFor({ contextFill: 0 })).toBe(0);
    expect(contextFillFor({ contextFill: 0.42 })).toBeCloseTo(0.42, 9);
    expect(contextFillFor({ contextFill: 1 })).toBe(1);
    expect(contextFillFor({ contextFill: 1.7 })).toBe(1);
    expect(contextFillFor({ contextFill: -0.2 })).toBe(0);
    expect(contextFillFor({ contextFill: Number.NaN })).toBe(0);
    expect(contextFillFor({ contextFill: Number.POSITIVE_INFINITY })).toBe(1);
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

    const frozen = r.notes.length;
    r.run(2000);
    expect(r.notes).toHaveLength(frozen);

    r.music.resume();
    expect(r.music.running).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    r.run(1000);
    expect(r.notes.length).toBeGreaterThan(frozen);
  });

  it('will not start while suspended', () => {
    const r = rig();
    r.music.suspend();
    r.music.start();
    expect(r.music.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('setEnabled(false) halts the scheduler and silences the score', () => {
    const r = rig();
    r.music.start();
    r.run(1000);
    expect(master(r).gain.value).toBeGreaterThan(0);

    r.music.setEnabled(false);
    expect(r.music.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(master(r).gain.value).toBe(0);

    r.music.setEnabled(true);
    expect(r.music.running).toBe(true);
  });

  it('finishes a crossfade that was cut short by a stop', () => {
    const r = rig();
    r.music.start();
    r.run(300);
    r.music.setScene('coworking');
    r.run(barSeconds('bedroom') * 1000 + 100);
    expect(r.music.inspect().crossfading).toBe(true);
    r.music.stop();
    expect(r.music.inspect().crossfading).toBe(false);
    expect(r.music.inspect().playing).toBe('coworking');
  });

  it('destroy() clears the interval and disconnects the score', () => {
    const r = rig();
    r.music.start();
    r.run(500);
    const out = master(r);

    r.music.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.music.running).toBe(false);
    expect(out.disconnectCount).toBe(1);

    expect(() => {
      r.music.start();
      r.music.setScene('orbital');
      r.music.setTension(1);
      r.music.setContextFill(1);
      r.music.duck(1, 1);
      r.music.destroy();
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('solo mutes every other part (stems for the dev tools)', () => {
    const r = rig({ solo: ['bass'] });
    r.music.setScene('coworking');
    r.music.start();
    r.run(500);
    // Notes are still scheduled, but every part bus except the bass sits at zero.
    const partBuses = r.mock.created.gains.filter((g) => g.gain.directSets.length > 0 && g.outputs.length === 3);
    const open = partBuses.filter((g) => g.gain.value > 0);
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open.every((g) => Math.abs(g.gain.value - SCENES.coworking.mix.bass) < 1e-9)).toBe(true);
  });
});
