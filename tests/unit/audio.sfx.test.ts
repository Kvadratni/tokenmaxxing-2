import { describe, expect, it } from 'vitest';

import type { SfxName } from '@sim/types.ts';
import {
  MockAudioContext,
  type MockGain,
  type MockOscillator,
  type MockScheduledSource,
} from '@audio/mock-context.ts';
import { SFX_VOICE_CAP } from '@audio/engine.ts';
import { THEME } from '@audio/music.ts';
import {
  CLICK_SCALE,
  createSfxPlayer,
  critDyad,
  SFX_PRIORITY,
  SFX_TRIM,
  STREAK_IDLE_S,
  STREAK_MAX_STEPS,
  streakNote,
  type AnySfxName,
  type ExtraSfxName,
  type SfxParams,
  type SfxPlayer,
} from '@audio/sfx.ts';
import { mtof, STEAL_PRIORITY, VoicePool } from '@audio/synth.ts';

/** Every member of the frozen `SfxName` union. The Record type rejects a missing or a stray name. */
const SFX_SET: Record<SfxName, true> = {
  click: true,
  clickCrit: true,
  oneShot: true,
  buy: true,
  denied: true,
  report: true,
  claim: true,
  caught: true,
  compact: true,
  compactForced: true,
  sycophancy: true,
  draftOpen: true,
  draftPick: true,
  reroll: true,
  incidentBad: true,
  incidentGood: true,
  incidentClear: true,
  interrupt: true,
  permission: true,
  warn: true,
  contextWarn: true,
  lose: true,
  win: true,
  uiHover: true,
  metaBuy: true,
  achievement: true,
};
/** The engine's internal sounds, for events `SfxName` has no member for. */
const EXTRA_SET: Record<ExtraSfxName, true> = {
  toolLost: true,
};
const ALL_SFX = [...Object.keys(SFX_SET), ...Object.keys(EXTRA_SET)] as AnySfxName[];

/** The run-end stings, the jingle and the forced compaction's tail may take their time; everything else is short. */
const LONG_SFX: ReadonlySet<AnySfxName> = new Set<AnySfxName>(['win', 'lose', 'achievement', 'report', 'compactForced']);
const SHORT_S = 1.2;

interface Rig {
  mock: MockAudioContext;
  out: MockGain;
  player: SfxPlayer;
  pool: VoicePool;
}

function setup(cap = 64): Rig {
  const mock = new MockAudioContext();
  const out = mock.createGain();
  const pool = new VoicePool(cap);
  const player = createSfxPlayer({
    ctx: mock as unknown as BaseAudioContext,
    out: out as unknown as AudioNode,
    pool,
  });
  return { mock, out, player, pool };
}

/** One sound on a fresh rig. */
function render(name: AnySfxName, params?: SfxParams): Rig {
  const r = setup();
  r.player.play(name, undefined, params);
  return r;
}

function startFreq(o: MockOscillator): number {
  return o.frequency.calls[0]?.args[0] ?? 0;
}

function endFreq(o: MockOscillator): number {
  return o.frequency.calls[o.frequency.calls.length - 1]?.args[0] ?? 0;
}

function startAt(s: MockScheduledSource): number {
  return s.startCalls[0] ?? 0;
}

function semitones(a: number, b: number): number {
  return 12 * Math.log2(b / a);
}

/** When the last voice stops. */
function tail(r: Rig): number {
  return Math.max(...r.mock.sources().map((s) => s.stopCalls[0] ?? 0));
}

/** The voices' amps: gains wired to the output bus (directly or through a panner). */
function amps(r: Rig): MockGain[] {
  return r.mock.created.gains.filter(
    (g) => g !== r.out && g.outputs.some((o) => o === r.out || (o.kind === 'panner' && o.outputs.includes(r.out))),
  );
}

/** Peak gain of every voice amp, in creation order. */
function peaks(r: Rig): number[] {
  return amps(r).map((g) => Math.max(0, ...g.gain.targets()));
}

/** A crude loudness proxy: the voices' peak gains, summed. */
function loudness(r: Rig): number {
  return peaks(r).reduce((a, b) => a + b, 0);
}

/** A cheap fingerprint of a sound: which voices fired, at what pitch, when. */
function fingerprint(mock: MockAudioContext): string {
  const parts: string[] = [];
  for (const osc of mock.carriers()) parts.push(`fm:${startFreq(osc).toFixed(1)}@${startAt(osc).toFixed(3)}`);
  for (const osc of mock.created.oscillators) {
    if (osc.frequency.inputs.length === 0 && osc.type !== 'custom') parts.push(`osc:${osc.type}:${startFreq(osc).toFixed(1)}@${startAt(osc).toFixed(3)}`);
  }
  for (const bs of mock.created.bufferSources) {
    const rate = bs.playbackRate.calls[0]?.args[0] ?? 0;
    parts.push(`noise:${rate.toFixed(2)}@${startAt(bs).toFixed(3)}`);
  }
  return parts.sort().join('|');
}

describe('SFX coverage', () => {
  it('covers every member of the SfxName union, plus the internal sounds, in every table', () => {
    expect(Object.keys(SFX_SET)).toHaveLength(26);
    expect(ALL_SFX).toHaveLength(27);
    expect(Object.keys(SFX_PRIORITY).sort()).toEqual([...ALL_SFX].sort());
    expect(Object.keys(SFX_TRIM).sort()).toEqual([...ALL_SFX].sort());
  });

  it('produces voices for every sound, each started and stopped exactly once', () => {
    for (const name of ALL_SFX) {
      const { mock } = render(name);
      expect(mock.voices().length, `${name} produced no voices`).toBeGreaterThan(0);
      for (const s of mock.sources()) {
        expect(s.startCalls.length, `${name} source never started`).toBe(1);
        expect(s.stopCalls.length, `${name} source never stopped`).toBe(1);
      }
    }
  });

  it('builds every sound on FM, and never on a chiptune pulse, square or saw', () => {
    for (const name of ALL_SFX) {
      const { mock } = render(name);
      expect(mock.carriers().length, `${name} has no FM voice`).toBeGreaterThan(0);
      for (const o of mock.created.oscillators) {
        expect(['sine', 'custom', 'triangle'], `${name} uses ${o.type}`).toContain(o.type);
      }
      expect(mock.created.periodicWaves.length, `${name}`).toBeLessThanOrEqual(1);
    }
  });

  it('fits every sound inside the engine voice cap', () => {
    for (const name of ALL_SFX) {
      expect(render(name).mock.voices().length, name).toBeLessThanOrEqual(SFX_VOICE_CAP);
    }
  });

  it('gives every sound a distinct fingerprint', () => {
    const seen = new Map<string, AnySfxName>();
    for (const name of ALL_SFX) {
      const fp = fingerprint(render(name).mock);
      const clash = seen.get(fp);
      expect(clash, `${name} sounds identical to ${String(clash)}`).toBeUndefined();
      seen.set(fp, name);
    }
    expect(seen.size).toBe(ALL_SFX.length);
  });

  it('keeps every sound short, apart from the moments', () => {
    for (const name of ALL_SFX) {
      const limit = LONG_SFX.has(name) ? 2.5 : SHORT_S;
      expect(tail(render(name)), name).toBeLessThan(limit);
    }
  });

  it('keeps the moments above the mashable sounds in priority', () => {
    for (const name of ['report', 'caught', 'compactForced', 'win', 'lose', 'achievement'] as const) {
      expect(SFX_PRIORITY[name], name).toBeGreaterThan(SFX_PRIORITY.click);
      expect(SFX_PRIORITY[name], name).toBeGreaterThanOrEqual(STEAL_PRIORITY);
    }
    expect(SFX_PRIORITY.click).toBe(0);
    expect(SFX_PRIORITY.uiHover).toBe(0);
    // Mashing Y must never cost another sound its slot.
    expect(SFX_PRIORITY.sycophancy).toBeLessThan(STEAL_PRIORITY);
  });

  it('spends exactly one voice on a click, an automated click and a hover', () => {
    const cases: ReadonlyArray<readonly [AnySfxName, SfxParams | undefined]> = [
      ['click', undefined],
      ['click', { auto: true }],
      ['uiHover', undefined],
    ];
    for (const [name, params] of cases) {
      expect(render(name, params).mock.voices(), name).toHaveLength(1);
    }
  });

  it('puts the loudness tiers in order: hover < click < UI < the big moments', () => {
    const loud = (name: AnySfxName): number => Math.max(...peaks(render(name)));
    expect(loud('uiHover')).toBeLessThan(loud('click'));
    for (const ui of ['buy', 'draftPick', 'permission', 'denied'] as const) {
      expect(loud(ui), ui).toBeGreaterThan(loud('click'));
    }
    const moments = ['report', 'caught', 'compactForced', 'win', 'lose'] as const;
    for (const m of moments) expect(loudness(render(m)), m).toBeGreaterThan(loudness(render('buy')));
  });

  it('uses noise for the sounds that need texture', () => {
    const textured = [
      'buy',
      'report',
      'compact',
      'compactForced',
      'interrupt',
      'toolLost',
      'win',
      'lose',
      'draftOpen',
      'reroll',
      'metaBuy',
      'oneShot',
    ] as const;
    for (const name of textured) {
      expect(render(name).mock.created.bufferSources.length, `${name} has no noise layer`).toBeGreaterThan(0);
    }
  });

  it('crushes only where digital grit is the point', () => {
    const gritty = new Set<AnySfxName>(['caught', 'compactForced', 'toolLost']);
    for (const name of ALL_SFX) {
      const crushed = render(name).mock.created.shapers.length > 0;
      expect(crushed, name).toBe(gritty.has(name));
    }
  });
});

describe('the click walk', () => {
  function clickFreqs(mock: MockAudioContext): number[] {
    return mock.carriers().map(startFreq);
  }

  it('walks up D minor pentatonic, one scale step per rapid click', () => {
    const { mock, player } = setup();
    for (let i = 0; i < CLICK_SCALE.length; i++) player.play('click');
    const freqs = clickFreqs(mock);
    expect(freqs.map((f) => Math.round(69 + 12 * Math.log2(f / 440)))).toEqual([...CLICK_SCALE]);
    for (const midi of CLICK_SCALE) expect([0, 3, 5, 7, 10]).toContain((midi - 62 + 120) % 12);
  });

  it('falls back to the bottom after a pause', () => {
    const { mock, player } = setup();
    for (let i = 0; i < 5; i++) player.play('click');
    mock.advance(STREAK_IDLE_S + 0.05);
    player.play('click');
    const freqs = clickFreqs(mock);
    expect(freqs[5]!).toBeCloseTo(mtof(CLICK_SCALE[0]), 4);
    expect(player.streak).toBe(0);
  });

  it('keeps walking while the clicks stay inside the idle window', () => {
    const { mock, player } = setup();
    player.play('click');
    mock.advance(STREAK_IDLE_S - 0.05);
    player.play('click');
    const freqs = clickFreqs(mock);
    expect(freqs[1]!).toBeGreaterThan(freqs[0]!);
  });

  it('wanders over the top notes on a long mash, never above D6 and never stuck on one pitch', () => {
    const { mock, player } = setup(512);
    for (let i = 0; i < 200; i++) player.play('click');
    const notes = clickFreqs(mock).map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
    const top = CLICK_SCALE[STREAK_MAX_STEPS];
    expect(Math.max(...notes)).toBe(top);
    const cruise = notes.slice(STREAK_MAX_STEPS + 1);
    expect(new Set(cruise).size).toBeGreaterThanOrEqual(3);
    for (let i = 2; i < cruise.length; i++) {
      expect(cruise[i] === cruise[i - 1] && cruise[i] === cruise[i - 2]).toBe(false);
    }
  });

  it('streakNote is the walk, as a pure function', () => {
    for (let i = 0; i <= STREAK_MAX_STEPS; i++) expect(streakNote(i)).toBe(CLICK_SCALE[i]);
    expect(streakNote(-3)).toBe(CLICK_SCALE[0]);
    expect(streakNote(Number.NaN)).toBe(CLICK_SCALE[0]);
    for (let i = 0; i < 100; i++) expect(CLICK_SCALE).toContain(streakNote(i) as (typeof CLICK_SCALE)[number]);
  });

  it('varies every click a little, so the thousandth is not a copy of the first', () => {
    const { mock, player } = setup(512);
    for (let i = 0; i < 40; i++) {
      mock.advance(1); // every click the first of its run: same pitch each time
      player.play('click');
    }
    const cars = mock.carriers();
    expect(new Set(cars.map(startFreq)).size).toBe(1);
    const detunes = new Set(cars.map((o) => o.detune.value.toFixed(3)));
    expect(detunes.size).toBeGreaterThan(30);
    for (const o of cars) expect(Math.abs(o.detune.value)).toBeLessThanOrEqual(6);
    const levels = peaks({ mock, out: mock.created.gains[0]!, player, pool: new VoicePool(1) });
    expect(new Set(levels.map((l) => l.toFixed(4))).size).toBeGreaterThan(30);
  });

  it('is short and soft: a blip, not a beep', () => {
    const r = render('click');
    expect(tail(r)).toBeLessThan(0.15);
    expect(Math.max(...peaks(r))).toBeLessThan(0.12);
    // Lowpassed well under the harsh range.
    expect(r.mock.created.filters[0]!.frequency.value).toBeLessThanOrEqual(4000);
  });

  it('forgets the walk on resetStreak()', () => {
    const { mock, player } = setup();
    for (let i = 0; i < 4; i++) player.play('click');
    player.resetStreak();
    player.play('click');
    expect(clickFreqs(mock)[4]!).toBeCloseTo(mtof(CLICK_SCALE[0]), 4);
  });

  it('plays automated clicks as a fainter tick, lower than the walk', () => {
    const human = render('click');
    const auto = render('click', { auto: true });
    expect(Math.max(...peaks(auto))).toBeLessThan(Math.max(...peaks(human)));
    expect(startFreq(auto.mock.carriers()[0]!)).toBeLessThan(mtof(CLICK_SCALE[0]));
  });

  it('neither climbs nor resets the walk on automated clicks', () => {
    const { mock, player } = setup();
    for (let i = 0; i < 3; i++) player.play('click');
    expect(player.streak).toBe(2);
    for (let i = 0; i < 10; i++) {
      mock.advance(0.05);
      player.play('click', undefined, { auto: true });
    }
    expect(player.streak).toBe(2);
    player.play('click');
    expect(player.streak).toBe(3);
    const cars = mock.carriers();
    expect(startFreq(cars[cars.length - 1]!)).toBeCloseTo(mtof(CLICK_SCALE[3]), 4);
  });
});

describe('crits and one-shots', () => {
  it('rings a bright glass dyad a fourth apart, above the click it lands on', () => {
    for (let pos = 0; pos < 20; pos++) {
      const [lo, hi] = critDyad(pos);
      expect(hi - lo).toBe(5);
      expect(lo).toBeGreaterThan(streakNote(pos));
    }
    // ...and it climbs with the run.
    expect(critDyad(STREAK_MAX_STEPS)[0]).toBeGreaterThan(critDyad(0)[0]);
  });

  it('clickCrit: the click blip plus the bell pair, on inharmonic glass', () => {
    const { mock } = render('clickCrit');
    const cars = mock.carriers();
    expect(cars).toHaveLength(3);
    const bells = cars.filter((o) => startFreq(o) > mtof(80));
    expect(bells).toHaveLength(2);
    for (const b of bells) {
      const mod = mock.modulators().find((m) => (m.outputs[0] as MockGain).paramOutputs.includes(b.frequency))!;
      const ratio = startFreq(mod) / startFreq(b);
      expect(Number.isInteger(Math.round(ratio * 1000) / 1000)).toBe(false);
    }
  });

  it('a human crit steps the walk; an automated one does not, and skips the blip', () => {
    const { mock, player } = setup();
    player.play('click');
    player.play('clickCrit');
    expect(player.streak).toBe(1);
    player.play('clickCrit', undefined, { auto: true });
    expect(player.streak).toBe(1);
    const autoCrit = render('clickCrit', { auto: true });
    expect(autoCrit.mock.carriers()).toHaveLength(2);
    expect(mock.carriers().length).toBe(1 + 3 + 2);
  });

  it('oneShot: a quick spray that only ever climbs', () => {
    const { mock } = render('oneShot');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    expect(cars.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < cars.length; i++) {
      expect(startFreq(cars[i]!)).toBeGreaterThan(startFreq(cars[i - 1]!));
      expect(startAt(cars[i]!) - startAt(cars[i - 1]!)).toBeLessThan(0.06);
    }
  });
});

describe('the report button', () => {
  it('report: a key press, an e-piano climb that resolves on D, and an airy whoosh', () => {
    const { mock } = render('report');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    // The press: a low thunk at once.
    expect(cars.some((o) => startAt(o) === 0 && startFreq(o) < mtof(55))).toBe(true);
    // The climb: four e-piano notes, rising.
    const climb = cars.filter((o) => startAt(o) > 0 && startAt(o) < 0.25);
    expect(climb).toHaveLength(4);
    for (let i = 1; i < climb.length; i++) expect(startFreq(climb[i]!)).toBeGreaterThan(startFreq(climb[i - 1]!));
    // The resolution: a chord after the climb, every note a D, an A or an E (Dadd9).
    const chord = cars.filter((o) => startAt(o) >= 0.28);
    expect(chord.length).toBeGreaterThanOrEqual(3);
    for (const o of chord) {
      const pc = Math.round(69 + 12 * Math.log2(startFreq(o) / 440)) % 12;
      expect([2, 9, 4]).toContain(pc);
    }
    // The whoosh: band-passed noise sweeping up.
    const air = mock.created.filters.find((f) => f.type === 'bandpass' && (f.frequency.calls[1]?.args[0] ?? 0) > 5000);
    expect(air).toBeDefined();
  });

  it('claim: a sly minor-second slide', () => {
    const { mock } = render('claim');
    const cars = mock.carriers();
    expect(cars.length).toBeGreaterThanOrEqual(1);
    for (const o of cars) {
      const moves = o.frequency.calls.map((c) => c.args[0]!);
      expect(semitones(moves[0]!, moves[moves.length - 1]!)).toBeCloseTo(1, 6);
      // It holds, then slides: more than a single ramp.
      expect(moves.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('caught: a bonk, then a buzzy descending tritone, crushed', () => {
    const { mock } = render('caught');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b) || startFreq(b) - startFreq(a));
    const bonk = cars.find((o) => startFreq(o) < 200);
    expect(bonk).toBeDefined();
    expect(endFreq(bonk!)).toBeLessThan(startFreq(bonk!));
    const error = cars.filter((o) => startFreq(o) >= 200);
    expect(error).toHaveLength(2);
    expect(startAt(error[1]!)).toBeGreaterThan(startAt(error[0]!));
    expect(semitones(startFreq(error[0]!), startFreq(error[1]!))).toBeCloseTo(-6, 6);
    // Buzzy: a hot index.
    const depth = (o: MockOscillator): number => o.frequency.inputs.length;
    for (const o of error) expect(depth(o)).toBe(1);
    expect(mock.created.shapers.length).toBeGreaterThanOrEqual(2);
    expect(tail({ mock } as Rig)).toBeLessThan(0.6);
  });
});

describe('context', () => {
  it('compact: a zip of teeth running down, into a thump, then crumpled paper', () => {
    const { mock } = render('compact');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    const thump = cars.find((o) => startFreq(o) < 150)!;
    expect(thump).toBeDefined();
    expect(endFreq(thump)).toBeLessThan(startFreq(thump) / 2);
    const teeth = cars.filter((o) => startAt(o) < startAt(thump) && startFreq(o) >= 150);
    expect(teeth.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < teeth.length; i++) {
      expect(startFreq(teeth[i]!)).toBeLessThan(startFreq(teeth[i - 1]!));
      // Faster as it goes.
      if (i > 1) {
        expect(startAt(teeth[i]!) - startAt(teeth[i - 1]!)).toBeLessThan(startAt(teeth[i - 1]!) - startAt(teeth[i - 2]!) + 1e-9);
      }
    }
    expect(semitones(startFreq(teeth[0]!), startFreq(teeth[teeth.length - 1]!))).toBeLessThan(-18);
    // A glissando in the score's key: every tooth on D minor pentatonic.
    for (const o of teeth) {
      const pc = (Math.round(69 + 12 * Math.log2(startFreq(o) / 440)) - 62 + 120) % 12;
      expect([0, 3, 5, 7, 10]).toContain(pc);
    }
    const grains = mock.created.bufferSources.filter((b) => startAt(b) > startAt(thump));
    expect(grains.length).toBeGreaterThanOrEqual(5);
    expect(new Set(grains.map(startAt)).size).toBe(grains.length);
  });

  it('compactForced: the same zip, bigger, with a hydraulic slam first and a longer, harsher tail', () => {
    const manual = render('compact');
    const forced = render('compactForced');
    expect(forced.mock.voices().length).toBeGreaterThan(manual.mock.voices().length);
    expect(loudness(forced)).toBeGreaterThan(loudness(manual));
    expect(tail(forced)).toBeGreaterThan(tail(manual) + 0.3);
    // The slam: a low hit and a burst of noise at once, before any tooth.
    const atOnce = forced.mock.sources().filter((s) => startAt(s) === 0);
    expect(atOnce.length).toBeGreaterThanOrEqual(2);
    // Harsher: the thump and the slam are crushed; the manual one is clean.
    expect(forced.mock.created.shapers.length).toBeGreaterThanOrEqual(2);
    expect(manual.mock.created.shapers).toHaveLength(0);
  });

  it('contextWarn: detuned pulses that climb, more of them and higher when the window is nearly gone', () => {
    const first = render('contextWarn', { urgency: 0 });
    const last = render('contextWarn', { urgency: 1 });
    for (const r of [first, last]) {
      const cars = r.mock.carriers();
      expect(cars.length).toBeGreaterThanOrEqual(6);
      for (const o of cars) expect(endFreq(o)).toBeGreaterThan(startFreq(o));
      // Pairs: the same note, detuned against itself.
      const byNote = new Map<string, number[]>();
      for (const o of cars) {
        const key = `${startFreq(o).toFixed(2)}@${startAt(o).toFixed(3)}`;
        byNote.set(key, [...(byNote.get(key) ?? []), o.detune.value]);
      }
      for (const detunes of byNote.values()) expect(new Set(detunes).size).toBe(2);
    }
    expect(last.mock.voices().length).toBeGreaterThan(first.mock.voices().length);
    expect(Math.min(...last.mock.carriers().map(startFreq))).toBeGreaterThan(Math.min(...first.mock.carriers().map(startFreq)));
  });

  it('warn: fingers drumming, unevenly, holding their pitch (the context alarm rises; this never does)', () => {
    const { mock } = render('warn');
    const taps = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    expect(taps.length).toBeGreaterThanOrEqual(8);
    for (const o of mock.created.oscillators) expect(o.frequency.calls).toHaveLength(1);
    const gaps = taps.slice(1).map((o, i) => +(startAt(o) - startAt(taps[i]!)).toFixed(4));
    expect(new Set(gaps).size).toBeGreaterThan(4);
    // Woody knocks, low: nothing beeps.
    for (const o of taps) expect(startFreq(o)).toBeLessThan(300);
  });

  it('warn: two warnings in a run are two different takes', () => {
    const { mock, player } = setup();
    player.play('warn');
    const first = fingerprint(mock);
    mock.advance(2);
    const before = mock.carriers().length;
    player.play('warn');
    const second = mock.carriers().slice(before).map((o) => `${startFreq(o).toFixed(1)}@${(startAt(o) - 2).toFixed(3)}`);
    expect(second.join('|')).not.toBe(first);
  });

  it('toolLost: a crushed crunch in which everything falls, then rubble; shorter than a compaction', () => {
    const r = render('toolLost');
    const { mock } = r;
    expect(tail(r)).toBeLessThan(0.5);
    expect(tail(r)).toBeLessThan(tail(render('compact')));
    const cars = mock.carriers();
    expect(cars.length).toBeGreaterThanOrEqual(3);
    for (const o of cars) expect(endFreq(o)).toBeLessThan(startFreq(o));
    expect(cars.some((o) => startAt(o) === 0 && startFreq(o) < 100)).toBe(true);
    expect(mock.created.shapers.length).toBeGreaterThan(0);
    expect(mock.created.bufferSources.filter((b) => startAt(b) === 0)).toHaveLength(1);
    expect(mock.created.bufferSources.filter((b) => startAt(b) > 0.1).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the human, and the world', () => {
  it('sycophancy: sparkly when sincere, thinner, quieter and more strained with every notch of spam', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1];
    const rigs = levels.map((thin) => render('sycophancy', { thin }));
    const voices = rigs.map((r) => r.mock.voices().length);
    const loud = rigs.map(loudness);
    const air = rigs.map((r) => Math.min(...r.mock.created.filters.filter((f) => f.type === 'highpass').map((f) => f.frequency.value)));
    const pitch = rigs.map((r) => startFreq(r.mock.carriers()[0]!));
    for (let i = 1; i < levels.length; i++) {
      expect(voices[i]!, `voices at ${levels[i]}`).toBeLessThanOrEqual(voices[i - 1]!);
      expect(loud[i]!, `loudness at ${levels[i]}`).toBeLessThan(loud[i - 1]!);
      expect(air[i]!, `air at ${levels[i]}`).toBeGreaterThan(air[i - 1]!);
      expect(pitch[i]!, `pitch at ${levels[i]}`).toBeGreaterThan(pitch[i - 1]!);
    }
    expect(voices[0]!).toBeGreaterThan(voices[voices.length - 1]!);
    // Sincere means sparkly: glass up at E6 or above.
    expect(Math.max(...rigs[0]!.mock.carriers().map(startFreq))).toBeGreaterThanOrEqual(mtof(88) - 0.01);
    // Strained: off the tempered grid once thin.
    const strained = 69 + 12 * Math.log2(pitch[2]! / 440);
    expect(Math.abs(strained - Math.round(strained))).toBeGreaterThan(0.1);
  });

  it('sycophancy with no params is the sincere version', () => {
    expect(fingerprint(render('sycophancy').mock)).toBe(fingerprint(render('sycophancy', { thin: 0 }).mock));
  });

  it("the human's lines arrive as a two-note chat ping that bubbles up into each note", () => {
    for (const name of ['incidentBad', 'incidentGood'] as const) {
      const { mock } = render(name, { speaker: 'human' });
      const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
      expect(cars, name).toHaveLength(2);
      expect(mock.created.bufferSources, name).toHaveLength(0);
      for (const o of cars) expect(endFreq(o)).toBeGreaterThan(startFreq(o));
      expect(startAt(cars[1]!) - startAt(cars[0]!)).toBeGreaterThan(0.05);
    }
    const bad = [...render('incidentBad', { speaker: 'human' }).mock.carriers()].map(endFreq);
    const good = [...render('incidentGood', { speaker: 'human' }).mock.carriers()].map(endFreq);
    expect(bad[1]!).toBeLessThan(bad[0]!);
    expect(good[1]!).toBeGreaterThan(good[0]!);
  });

  it('a bad world incident is a low system alert; a good one is a warm, slow bloom', () => {
    const alert = render('incidentBad');
    expect(fingerprint(alert.mock)).toBe(fingerprint(render('incidentBad', { speaker: 'world' }).mock));
    expect(Math.max(...alert.mock.carriers().map(startFreq))).toBeLessThan(200);
    expect(alert.mock.created.bufferSources.length).toBeGreaterThan(0);

    const bloom = render('incidentGood', { speaker: 'world' });
    const cars = bloom.mock.carriers();
    expect(cars.length).toBeGreaterThanOrEqual(4);
    // Slow attack: every bloom voice takes over 0.1 s to arrive.
    for (const g of amps(bloom).filter((a) => a.gain.calls.length > 0).slice(0, cars.length)) {
      const attackEnd = g.gain.calls[1]!.args[1]!;
      const start = g.gain.calls[0]!.args[1]!;
      expect(attackEnd - start).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('interrupt: a crack, a knock, sharp crackle, and glassy inharmonic partials, off-key', () => {
    const { mock } = render('interrupt');
    expect(mock.created.bufferSources.some((b) => startAt(b) === 0)).toBe(true);
    const crackle = mock.created.bufferSources.filter((b) => startAt(b) > 0);
    expect(crackle.length).toBeGreaterThanOrEqual(5);
    const glass = mock.carriers().filter((o) => startFreq(o) > 2000);
    expect(glass.length).toBeGreaterThanOrEqual(4);
    expect(new Set(glass.map(startAt)).size).toBe(glass.length);
    const offKey = glass.filter((o) => {
      const midi = 69 + 12 * Math.log2(startFreq(o) / 440);
      return Math.abs(midi - Math.round(midi)) > 0.1;
    });
    expect(offKey.length).toBeGreaterThanOrEqual(3);
    const pans = mock.created.panners.map((p) => p.pan.value);
    expect(Math.min(...pans)).toBeLessThan(0);
    expect(Math.max(...pans)).toBeGreaterThan(0);
  });

  it('permission: a polite chime, then the same chime again, softer', () => {
    const r = render('permission');
    expect(r.mock.created.bufferSources).toHaveLength(0);
    const cars = r.mock.carriers();
    const onsets = [...new Set(cars.map(startAt))].sort((a, b) => a - b);
    expect(onsets).toHaveLength(2);
    expect(onsets[1]! - onsets[0]!).toBeGreaterThan(0.3);
    const at = (t: number): string =>
      cars
        .filter((o) => startAt(o) === t)
        .map((o) => startFreq(o).toFixed(2))
        .sort()
        .join(',');
    expect(at(onsets[1]!)).toBe(at(onsets[0]!));
    const levels = peaks(r);
    const half = levels.length / 2;
    expect(Math.max(...levels.slice(half))).toBeLessThan(Math.max(...levels.slice(0, half)));
    expect(Math.max(...levels)).toBeLessThanOrEqual(0.2);
  });

  it('incidentClear: a relieved fall home to D', () => {
    const { mock } = render('incidentClear');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b) || startFreq(b) - startFreq(a));
    expect(startFreq(cars[1]!)).toBeLessThan(startFreq(cars[0]!));
    const pcs = cars.slice(1).map((o) => Math.round(69 + 12 * Math.log2(startFreq(o) / 440)) % 12);
    expect(pcs.every((pc) => pc === 2)).toBe(true);
  });
});

describe('draft, training and milestones', () => {
  it('draftOpen: a reveal shimmer: glass fanning up, with rising air', () => {
    const { mock } = render('draftOpen');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    expect(cars).toHaveLength(3);
    for (let i = 1; i < cars.length; i++) expect(startFreq(cars[i]!)).toBeGreaterThan(startFreq(cars[i - 1]!));
    const air = mock.created.filters.find((f) => f.type === 'highpass')!;
    expect(air.frequency.calls[1]!.args[0]!).toBeGreaterThan(air.frequency.calls[0]!.args[0]!);
  });

  it('draftPick: a confident select, a dyad and a thump struck together', () => {
    const { mock } = render('draftPick');
    const cars = mock.carriers();
    expect(cars.every((o) => startAt(o) === 0)).toBe(true);
    expect(cars.some((o) => startFreq(o) < 150)).toBe(true);
    expect(cars.filter((o) => startFreq(o) > 500)).toHaveLength(2);
    expect(tail(render('draftPick'))).toBeLessThan(0.5);
  });

  it('reroll: a rattle of small FM clicks, unevenly spaced, like dice in a cup', () => {
    const { mock } = render('reroll');
    const clicks = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    expect(clicks.length).toBeGreaterThanOrEqual(6);
    const gaps = clicks.slice(1).map((o, i) => +(startAt(o) - startAt(clicks[i]!)).toFixed(4));
    expect(new Set(gaps).size).toBeGreaterThan(3);
    expect(new Set(clicks.map((o) => startFreq(o).toFixed(0))).size).toBe(clicks.length);
  });

  it('metaBuy: weights updated, an ascending sparkle and a warm settle', () => {
    const { mock } = render('metaBuy');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    const sparkle = cars.filter((o) => startFreq(o) > 1000);
    expect(sparkle.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < sparkle.length; i++) expect(startFreq(sparkle[i]!)).toBeGreaterThan(startFreq(sparkle[i - 1]!));
    const settle = cars.filter((o) => startFreq(o) < 500);
    expect(Math.min(...settle.map(startAt))).toBeGreaterThan(Math.max(...sparkle.map(startAt)));
  });

  it('achievement: its own signature, in D major, on beating ratio-4 FM', () => {
    const { mock } = render('achievement');
    const cars = mock.carriers();
    // F#6 is in it: the only major third in the game's SFX.
    expect(cars.some((o) => Math.abs(startFreq(o) - mtof(90)) < 0.01)).toBe(true);
    // Doubled a few hertz apart: the beating of a vibraphone's motor.
    const pairs = cars.filter((a) => cars.some((b) => b !== a && Math.abs(startFreq(b) - startFreq(a) - 5.5) < 0.01));
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const name of ALL_SFX) {
      if (name === 'achievement') continue;
      const has = render(name).mock.carriers().some((o) => Math.abs(startFreq(o) - mtof(90)) < 0.01);
      expect(has, `${name} borrows the achievement's F#`).toBe(false);
    }
  });

  it("win: the theme's opening climb on brass, landing on a big chord; bigger and longer than report", () => {
    const { mock } = render('win');
    const cars = [...mock.carriers()].sort((a, b) => startAt(a) - startAt(b));
    const opening = THEME.filter(([bar, step]) => bar === 0 && step <= 6).map(([, , midi]) => midi);
    const figure = cars.slice(0, opening.length).map((o) => Math.round(69 + 12 * Math.log2(startFreq(o) / 440)));
    expect(figure).toEqual(opening);
    const last = Math.max(...cars.map(startAt));
    const chord = cars.filter((o) => startAt(o) >= last - 0.06);
    expect(chord.length).toBeGreaterThanOrEqual(5);
    const report = render('report');
    const win = render('win');
    expect(win.mock.voices().length).toBeGreaterThan(report.mock.voices().length);
    expect(tail(win)).toBeGreaterThan(tail(report));
  });

  it('lose: a power-down sweep, then the CRT clicks off', () => {
    const { mock } = render('lose');
    const sweep = mock.carriers()[0]!;
    expect(semitones(startFreq(sweep), endFreq(sweep))).toBeLessThan(-24);
    const clickOff = mock.created.bufferSources.filter((b) => startAt(b) > 1);
    expect(clickOff.length).toBeGreaterThanOrEqual(1);
    expect(mock.carriers().some((o) => startAt(o) > 1 && startFreq(o) < 200)).toBe(true);
  });
});

describe('voice budget under load', () => {
  /** True for a voice the pool killed early: it got a second stop(). */
  const stolen = (s: MockScheduledSource): boolean => s.stopCalls.length > 1;

  it('drops mashed clicks rather than cutting a fanfare short', () => {
    const { mock, player, pool } = setup(24);
    player.play('win');
    const fanfare = mock.sources();
    expect(fanfare.length).toBeGreaterThan(4);

    for (let i = 0; i < 200; i++) player.play('click');

    expect(pool.active).toBeLessThanOrEqual(24);
    expect(mock.voices().length).toBeLessThanOrEqual(24);
    for (const s of fanfare) expect(stolen(s)).toBe(false);
  });

  it('keeps a forced compaction whole while the player mashes', () => {
    const { mock, player, pool } = setup(24);
    player.play('compactForced');
    const squish = mock.sources();
    expect(mock.voices().length).toBeGreaterThan(8);

    for (let i = 0; i < 200; i++) player.play('click');

    expect(pool.active).toBeLessThanOrEqual(24);
    for (const s of squish) expect(stolen(s)).toBe(false);
  });

  it('lets a report steal a slot from mashed clicks when the pool is full', () => {
    const { mock, player, pool } = setup(24);
    for (let i = 0; i < 200; i++) player.play('click');
    expect(pool.active).toBe(24);
    const beforeSources = mock.sources().length;

    player.play('report');
    expect(pool.active).toBeLessThanOrEqual(24);
    expect(mock.sources().length).toBeGreaterThan(beforeSources);
  });

  it('never lets spammed sycophancy steal a slot', () => {
    const { mock, player, pool } = setup(24);
    for (let i = 0; i < 200; i++) player.play('click');
    expect(pool.active).toBe(24);
    const before = mock.sources().length;
    player.play('sycophancy');
    expect(mock.sources()).toHaveLength(before);
  });
});
