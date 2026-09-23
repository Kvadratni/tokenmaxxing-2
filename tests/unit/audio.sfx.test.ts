import { describe, expect, it } from 'vitest';

import type { SfxName } from '@sim/types.ts';
import {
  MockAudioContext,
  type MockGain,
  type MockOscillator,
  type MockScheduledSource,
} from '@audio/mock-context.ts';
import {
  createSfxPlayer,
  SFX_PRIORITY,
  STREAK_IDLE_S,
  STREAK_MAX_STEPS,
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

/** The run-end stings may take their time; everything else is short. */
const LONG_SFX: ReadonlySet<AnySfxName> = new Set<AnySfxName>(['win', 'lose']);
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

/** When the last voice stops. */
function tail(r: Rig): number {
  return Math.max(...r.mock.sources().map((s) => s.stopCalls[0] ?? 0));
}

/** Peak gain of every voice, in creation order (the rig's own output bus excluded). */
function peaks(r: Rig): number[] {
  return r.mock.created.gains.filter((g) => g !== r.out).map((g) => Math.max(0, ...g.gain.targets()));
}

/** A crude loudness proxy: the voices' peak gains, summed. */
function loudness(r: Rig): number {
  return peaks(r).reduce((a, b) => a + b, 0);
}

/** A cheap fingerprint of a sound: which sources fired, at what pitch, when. */
function fingerprint(mock: MockAudioContext): string {
  const parts: string[] = [];
  for (const osc of mock.created.oscillators) {
    parts.push(`osc:${osc.type}:${startFreq(osc).toFixed(1)}@${startAt(osc).toFixed(3)}`);
  }
  for (const bs of mock.created.bufferSources) {
    const rate = bs.playbackRate.calls[0]?.args[0] ?? 0;
    parts.push(`noise:${rate.toFixed(2)}@${startAt(bs).toFixed(3)}`);
  }
  return parts.sort().join('|');
}

describe('SFX coverage', () => {
  it('covers every member of the SfxName union, plus the internal sounds', () => {
    expect(Object.keys(SFX_SET)).toHaveLength(26);
    expect(ALL_SFX).toHaveLength(27);
    expect(Object.keys(SFX_PRIORITY).sort()).toEqual([...ALL_SFX].sort());
  });

  it('produces at least one scheduled source for every sound', () => {
    for (const name of ALL_SFX) {
      const { mock } = render(name);
      const sources = mock.sources();
      expect(sources.length, `${name} produced no voices`).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.startCalls.length, `${name} source never started`).toBe(1);
        expect(s.stopCalls.length, `${name} source never stopped`).toBe(1);
      }
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

  it('keeps every sound short, apart from the run-end stings', () => {
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
      expect(render(name, params).mock.sources(), name).toHaveLength(1);
    }
  });

  it('uses noise for the sounds that need grit', () => {
    const gritty = [
      'report',
      'claim',
      'caught',
      'compact',
      'compactForced',
      'interrupt',
      'toolLost',
      'win',
      'lose',
      'incidentBad',
      'draftOpen',
      'reroll',
    ] as const;
    for (const name of gritty) {
      expect(render(name).mock.created.bufferSources.length, `${name} has no noise layer`).toBeGreaterThan(0);
    }
  });

  it('makes clickCrit brighter than click', () => {
    const click = render('click');
    const crit = render('clickCrit');
    const clickTop = Math.max(...click.mock.created.oscillators.map(startFreq));
    const critLow = Math.min(...crit.mock.created.oscillators.map(startFreq));
    expect(critLow).toBeGreaterThan(clickTop);
  });

  it('makes win longer and larger than report', () => {
    const report = render('report');
    const win = render('win');
    expect(win.mock.sources().length).toBeGreaterThan(report.mock.sources().length);
    expect(tail(win)).toBeGreaterThan(tail(report));
  });

  it('slides lose downward', () => {
    const { mock } = render('lose');
    const osc = mock.created.oscillators[0]!;
    expect(endFreq(osc)).toBeLessThan(startFreq(osc) / 2);
  });

  it('varies warn pitch between consecutive beeps so it does not grate', () => {
    const { mock, player } = setup();
    const bases: number[] = [];
    for (let i = 0; i < 4; i++) {
      mock.advance(1);
      const before = mock.created.oscillators.length;
      player.play('warn');
      bases.push(startFreq(mock.created.oscillators[before]!));
    }
    expect(new Set(bases).size).toBe(4);
    // ...but the wobble stays sub-semitone, so it still reads as the same alarm.
    for (const f of bases) {
      expect(Math.abs(1200 * Math.log2(f / bases[0]!))).toBeLessThan(100);
    }
  });
});

describe('the report button', () => {
  it('report: commits with a low thunk, then rings out on a high chime', () => {
    const { mock } = render('report');
    const oscs = mock.created.oscillators;
    const atOnce = oscs.filter((o) => startAt(o) === 0);
    expect(Math.min(...atOnce.map(startFreq))).toBeLessThan(mtof(48));
    const last = Math.max(...oscs.map(startAt));
    const chime = oscs.filter((o) => startAt(o) === last);
    expect(chime.length).toBeGreaterThanOrEqual(2);
    for (const o of chime) expect(startFreq(o)).toBeGreaterThanOrEqual(mtof(84) - 0.01);
  });

  it('claim: whooshes band-passed noise across the stereo field, then winks', () => {
    const { mock } = render('claim');
    expect(mock.created.bufferSources.length).toBeGreaterThanOrEqual(2);
    const bands = mock.created.filters.filter((f) => f.type === 'bandpass');
    expect(bands.length).toBeGreaterThanOrEqual(2);
    // Each band sweeps: the air moves.
    for (const f of bands) expect(f.frequency.calls.length).toBeGreaterThan(1);
    const pans = mock.created.panners.map((p) => p.pan.value);
    expect(Math.min(...pans)).toBeLessThan(0);
    expect(Math.max(...pans)).toBeGreaterThan(0);
    // The wink comes last, up high.
    const wink = mock.created.oscillators.reduce((a, b) => (startAt(b) > startAt(a) ? b : a));
    expect(startFreq(wink)).toBeGreaterThan(mtof(80));
  });

  it('caught: buzzes low, then says "wrong" in a falling line', () => {
    const { mock } = render('caught');
    const oscs = [...mock.created.oscillators].sort((a, b) => startAt(a) - startAt(b));
    const buzzer = oscs.filter((o) => startAt(o) === 0);
    expect(buzzer.length).toBeGreaterThanOrEqual(2);
    for (const o of buzzer) expect(startFreq(o)).toBeLessThan(130);
    const wrong = oscs.filter((o) => startAt(o) > 0);
    expect(wrong.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < wrong.length; i++) {
      expect(startFreq(wrong[i]!)).toBeLessThan(startFreq(wrong[i - 1]!));
    }
    const sag = wrong[wrong.length - 1]!;
    expect(endFreq(sag)).toBeLessThan(startFreq(sag));
  });
});

describe('context', () => {
  it('compact: a hydraulic squish that sinks, then a crumple of paper', () => {
    const { mock } = render('compact');
    // The press: a body gliding down more than an octave.
    const press = mock.created.oscillators.find((o) => endFreq(o) < startFreq(o) / 2);
    expect(press).toBeDefined();
    // Hydraulic hiss under the press...
    expect(mock.created.bufferSources.some((b) => startAt(b) === startAt(press!))).toBe(true);
    // ...then a scatter of short paper grains once it has closed.
    const grains = mock.created.bufferSources.filter((b) => startAt(b) > startAt(press!) + 0.2);
    expect(grains.length).toBeGreaterThanOrEqual(5);
    expect(new Set(grains.map(startAt)).size).toBe(grains.length);
  });

  it('compactForced: the same squish, harsher and louder', () => {
    const manual = render('compact');
    const forced = render('compactForced');
    expect(forced.mock.sources().length).toBeGreaterThan(manual.mock.sources().length);
    expect(loudness(forced)).toBeGreaterThan(loudness(manual) * 1.3);
    // Harsher: a saw where the manual press is all triangle.
    const waves = (r: Rig): Set<string> => new Set(r.mock.created.oscillators.map((o) => o.type));
    expect([...waves(manual)]).toEqual(['triangle']);
    expect(waves(forced).has('sawtooth')).toBe(true);
    // The same gesture: it crumples paper too, and more of it.
    const crumple = (r: Rig): number =>
      r.mock.created.filters.filter((f) => f.type === 'highpass').length;
    expect(crumple(forced)).toBeGreaterThan(crumple(manual));
    // And it hits first: something starts at once, before the press.
    expect(forced.mock.sources().filter((s) => startAt(s) === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('contextWarn: blips that rise, more of them and higher when the window is nearly gone', () => {
    const first = render('contextWarn', { urgency: 0 });
    const last = render('contextWarn', { urgency: 1 });
    for (const r of [first, last]) {
      expect(r.mock.created.oscillators.length).toBeGreaterThanOrEqual(2);
      for (const o of r.mock.created.oscillators) expect(endFreq(o)).toBeGreaterThan(startFreq(o));
    }
    expect(last.mock.sources().length).toBeGreaterThan(first.mock.sources().length);
    expect(startFreq(last.mock.created.oscillators[0]!)).toBeGreaterThan(
      startFreq(first.mock.created.oscillators[0]!),
    );
  });

  it('toolLost: a short destructive crunch, a dropping thud, a collapsing body, then rubble', () => {
    const r = render('toolLost');
    const { mock } = r;
    expect(tail(r)).toBeLessThan(0.5);
    const oscs = mock.created.oscillators;
    // Everything tonal falls: something was taken away, not added.
    expect(oscs.length).toBeGreaterThanOrEqual(2);
    for (const o of oscs) expect(endFreq(o)).toBeLessThan(startFreq(o));
    // A low thud at once.
    expect(oscs.some((o) => startAt(o) === 0 && startFreq(o) < 100)).toBe(true);
    // A noise body at once, darkening as it crumbles.
    const body = mock.created.bufferSources.filter((b) => startAt(b) === 0);
    expect(body).toHaveLength(1);
    const lows = mock.created.filters.filter((f) => f.type === 'lowpass' && f.frequency.calls.length > 1);
    expect(lows.some((f) => (f.frequency.calls[1]?.args[0] ?? 0) < (f.frequency.calls[0]?.args[0] ?? 0))).toBe(true);
    // Rubble afterwards.
    expect(mock.created.bufferSources.filter((b) => startAt(b) > 0.1).length).toBeGreaterThanOrEqual(3);
  });

  it('toolLost is not a compaction: no triangle press, and over sooner', () => {
    const lost = render('toolLost');
    const squish = render('compact');
    expect(lost.mock.created.oscillators.some((o) => o.type === 'triangle')).toBe(false);
    expect(tail(lost)).toBeLessThan(tail(squish));
  });

  it('warn (patience) holds its pitch, so it never reads as the rising context alarm', () => {
    const { mock } = render('warn');
    for (const o of mock.created.oscillators) expect(o.frequency.calls).toHaveLength(1);
  });
});

describe('the human', () => {
  it('sycophancy: bright when sincere, thinner with every notch of spam', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1];
    const rigs = levels.map((thin) => render('sycophancy', { thin }));
    const voices = rigs.map((r) => r.mock.sources().length);
    const loud = rigs.map(loudness);
    // The highpass on the ding itself: the body is filtered away as it thins.
    const air = rigs.map((r) =>
      Math.min(...r.mock.created.filters.filter((f) => f.type === 'highpass').map((f) => f.frequency.value)),
    );
    // The first note: eager, then squeaky.
    const pitch = rigs.map((r) => startFreq(r.mock.created.oscillators[0]!));
    for (let i = 1; i < levels.length; i++) {
      expect(voices[i]!, `voices at ${levels[i]}`).toBeLessThanOrEqual(voices[i - 1]!);
      expect(loud[i]!, `loudness at ${levels[i]}`).toBeLessThan(loud[i - 1]!);
      expect(air[i]!, `air at ${levels[i]}`).toBeGreaterThan(air[i - 1]!);
      expect(pitch[i]!, `pitch at ${levels[i]}`).toBeGreaterThan(pitch[i - 1]!);
    }
    expect(voices[0]!).toBeGreaterThan(voices[voices.length - 1]!);
    // Sincere means bright: something up at E6 or above.
    expect(Math.max(...rigs[0]!.mock.created.oscillators.map(startFreq))).toBeGreaterThanOrEqual(mtof(88) - 0.01);
  });

  it('sycophancy with no params is the sincere version', () => {
    expect(fingerprint(render('sycophancy').mock)).toBe(fingerprint(render('sycophancy', { thin: 0 }).mock));
  });

  it('interrupt: a crack, then a spray of high, scattered, off-key shards', () => {
    const { mock } = render('interrupt');
    expect(mock.created.bufferSources.some((b) => startAt(b) === 0)).toBe(true);
    const shards = mock.created.oscillators.filter((o) => startFreq(o) > 2000);
    expect(shards.length).toBeGreaterThanOrEqual(5);
    expect(new Set(shards.map(startAt)).size).toBe(shards.length);
    expect(new Set(shards.map((o) => startFreq(o).toFixed(1))).size).toBe(shards.length);
    // Glass does not break in tune: at least some shards sit between semitones.
    const offKey = shards.filter((o) => {
      const midi = 69 + 12 * Math.log2(startFreq(o) / 440);
      return Math.abs(midi - Math.round(midi)) > 0.1;
    });
    expect(offKey.length).toBeGreaterThanOrEqual(3);
    const pans = mock.created.panners.map((p) => p.pan.value);
    expect(Math.min(...pans)).toBeLessThan(0);
    expect(Math.max(...pans)).toBeGreaterThan(0);
  });

  it('permission: a polite ding, then the same ding again', () => {
    const r = render('permission');
    const oscs = r.mock.created.oscillators;
    const level = peaks(r);
    // Oscillators only, so voice amps line up with oscillators one to one.
    expect(r.mock.created.bufferSources).toHaveLength(0);
    expect(level).toHaveLength(oscs.length);
    // The ding at each onset is its loudest voice.
    const onsets = [...new Set(oscs.map(startAt))].sort((a, b) => a - b);
    expect(onsets.length).toBeGreaterThanOrEqual(2);
    const dings = onsets.map((at) => {
      let best = -1;
      oscs.forEach((o, i) => {
        if (startAt(o) === at && (best < 0 || (level[i] ?? 0) > (level[best] ?? 0))) best = i;
      });
      return { at, f: startFreq(oscs[best]!), peak: level[best] ?? 0 };
    });
    // The same pitch each time, well spaced, and the repeat no louder.
    expect(new Set(dings.map((d) => d.f.toFixed(2))).size).toBe(1);
    expect(dings[1]!.at - dings[0]!.at).toBeGreaterThan(0.3);
    expect(dings[1]!.peak).toBeLessThanOrEqual(dings[0]!.peak);
    // Polite: soft triangles only, and never at the level of the big thunks.
    expect(new Set(oscs.map((o) => o.type))).toEqual(new Set(['triangle']));
    expect(Math.max(...level)).toBeLessThanOrEqual(0.2);
  });
});

describe('click streak', () => {
  function clickFreqs(mock: MockAudioContext): number[] {
    return mock.created.oscillators.map(startFreq);
  }

  it('raises the pitch on each of 5 rapid clicks', () => {
    const { mock, player } = setup();
    for (let i = 0; i < 5; i++) player.play('click');

    const freqs = clickFreqs(mock);
    expect(freqs).toHaveLength(5);
    expect(new Set(freqs.map((f) => f.toFixed(4))).size).toBe(5);
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]!).toBeGreaterThan(freqs[i - 1]!);
    }
    // Semitone steps up from the base note.
    expect(freqs[0]!).toBeCloseTo(mtof(76), 4);
    expect(freqs[4]!).toBeCloseTo(mtof(80), 4);
  });

  it('resets to the base note after the idle window', () => {
    const { mock, player } = setup();
    for (let i = 0; i < 5; i++) player.play('click');
    mock.advance(STREAK_IDLE_S + 0.05);
    player.play('click');

    const freqs = clickFreqs(mock);
    expect(freqs).toHaveLength(6);
    expect(freqs[5]!).toBeCloseTo(mtof(76), 4);
    expect(player.streak).toBe(0);
  });

  it('does not reset while clicks stay inside the idle window', () => {
    const { mock, player } = setup();
    player.play('click');
    mock.advance(STREAK_IDLE_S - 0.05);
    player.play('click');
    const freqs = clickFreqs(mock);
    expect(freqs[1]!).toBeGreaterThan(freqs[0]!);
  });

  it('caps the rise at an octave no matter how long the mash runs', () => {
    const { mock, player } = setup(512);
    for (let i = 0; i < 60; i++) player.play('click');
    const freqs = clickFreqs(mock);
    const top = Math.max(...freqs);
    expect(top).toBeCloseTo(mtof(76 + STREAK_MAX_STEPS), 4);
    expect(freqs[59]!).toBeCloseTo(top, 4);
    expect(player.streak).toBe(STREAK_MAX_STEPS);
  });

  it('forgets the streak on resetStreak()', () => {
    const { mock, player } = setup();
    for (let i = 0; i < 4; i++) player.play('click');
    player.resetStreak();
    player.play('click');
    const freqs = clickFreqs(mock);
    expect(freqs[4]!).toBeCloseTo(mtof(76), 4);
  });

  it('plays automated clicks as a softer tick under the human band', () => {
    const human = render('click');
    const auto = render('click', { auto: true });
    expect(Math.max(...peaks(auto))).toBeLessThan(Math.max(...peaks(human)));
    expect(startFreq(auto.mock.created.oscillators[0]!)).toBeLessThan(mtof(76));
  });

  it('neither climbs nor resets the streak on automated clicks', () => {
    const { mock, player } = setup();
    for (let i = 0; i < 3; i++) player.play('click');
    expect(player.streak).toBe(2);
    for (let i = 0; i < 10; i++) {
      mock.advance(0.05);
      player.play('click', undefined, { auto: true });
    }
    expect(player.streak).toBe(2);
    // Half a second since the last human click: inside the window, so the run continues.
    player.play('click');
    expect(player.streak).toBe(3);
    const oscs = mock.created.oscillators;
    expect(startFreq(oscs[oscs.length - 1]!)).toBeCloseTo(mtof(79), 4);
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
    expect(mock.sources().length).toBeLessThanOrEqual(24);
    for (const s of fanfare) expect(stolen(s)).toBe(false);
  });

  it('keeps a forced compaction whole while the player mashes', () => {
    const { mock, player, pool } = setup(24);
    player.play('compactForced');
    const squish = mock.sources();
    expect(squish.length).toBeGreaterThan(8);

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
