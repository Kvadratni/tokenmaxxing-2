import { describe, expect, it } from 'vitest';

import type { SfxName } from '@sim/types.ts';
import { MockAudioContext, type MockGain, type MockScheduledSource } from '@audio/mock-context.ts';
import { createSfxPlayer, SFX_PRIORITY, STREAK_IDLE_S, STREAK_MAX_STEPS } from '@audio/sfx.ts';
import { mtof, VoicePool } from '@audio/synth.ts';

/** Every member of the frozen `SfxName` union. */
const ALL_SFX: readonly SfxName[] = [
  'click',
  'clickCrit',
  'oneShot',
  'buy',
  'denied',
  'ship',
  'draftOpen',
  'draftPick',
  'reroll',
  'incidentBad',
  'incidentGood',
  'incidentClear',
  'warn',
  'lose',
  'win',
  'uiHover',
  'metaBuy',
  'achievement',
];

function setup(cap = 64): {
  mock: MockAudioContext;
  player: ReturnType<typeof createSfxPlayer>;
  pool: VoicePool;
} {
  const mock = new MockAudioContext();
  const out = mock.createGain() as MockGain;
  const pool = new VoicePool(cap);
  const player = createSfxPlayer({
    ctx: mock as unknown as BaseAudioContext,
    out: out as unknown as AudioNode,
    pool,
  });
  return { mock, player, pool };
}

/** A cheap fingerprint of a sound: which sources fired, at what pitch, when. */
function fingerprint(mock: MockAudioContext): string {
  const parts: string[] = [];
  for (const osc of mock.created.oscillators) {
    const f = osc.frequency.calls[0]?.args[0] ?? 0;
    const start = osc.startCalls[0] ?? 0;
    parts.push(`osc:${osc.type}:${f.toFixed(1)}@${start.toFixed(3)}`);
  }
  for (const bs of mock.created.bufferSources) {
    const rate = bs.playbackRate.calls[0]?.args[0] ?? 0;
    parts.push(`noise:${rate.toFixed(2)}@${(bs.startCalls[0] ?? 0).toFixed(3)}`);
  }
  return parts.sort().join('|');
}

describe('SFX coverage', () => {
  it('covers every member of the SfxName union', () => {
    expect(ALL_SFX).toHaveLength(18);
    expect(Object.keys(SFX_PRIORITY).sort()).toEqual([...ALL_SFX].sort());
  });

  it('produces at least one scheduled source for every sound', () => {
    for (const name of ALL_SFX) {
      const { mock, player } = setup();
      player.play(name);
      const sources: MockScheduledSource[] = mock.sources();
      expect(sources.length, `${name} produced no voices`).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.startCalls.length, `${name} source never started`).toBe(1);
        expect(s.stopCalls.length, `${name} source never stopped`).toBe(1);
      }
    }
  });

  it('gives every sound a distinct fingerprint', () => {
    const seen = new Map<string, SfxName>();
    for (const name of ALL_SFX) {
      const { mock, player } = setup();
      player.play(name);
      const fp = fingerprint(mock);
      const clash = seen.get(fp);
      expect(clash, `${name} sounds identical to ${String(clash)}`).toBeUndefined();
      seen.set(fp, name);
    }
    expect(seen.size).toBe(ALL_SFX.length);
  });

  it('keeps the fanfares above the mashable sounds in priority', () => {
    expect(SFX_PRIORITY.ship).toBeGreaterThan(SFX_PRIORITY.click);
    expect(SFX_PRIORITY.win).toBeGreaterThan(SFX_PRIORITY.click);
    expect(SFX_PRIORITY.lose).toBeGreaterThan(SFX_PRIORITY.click);
    expect(SFX_PRIORITY.click).toBe(0);
    expect(SFX_PRIORITY.uiHover).toBe(0);
  });

  it('spends exactly one voice on a click and one on a hover', () => {
    for (const name of ['click', 'uiHover'] as const) {
      const { mock, player } = setup();
      player.play(name);
      expect(mock.sources(), name).toHaveLength(1);
    }
  });

  it('uses noise for the sounds that need grit', () => {
    for (const name of ['ship', 'win', 'lose', 'incidentBad', 'draftOpen', 'reroll'] as const) {
      const { mock, player } = setup();
      player.play(name);
      expect(mock.created.bufferSources.length, `${name} has no noise layer`).toBeGreaterThan(0);
    }
  });

  it('makes clickCrit brighter than click', () => {
    const a = setup();
    a.player.play('click');
    const b = setup();
    b.player.play('clickCrit');
    const clickTop = Math.max(...a.mock.created.oscillators.map((o) => o.frequency.calls[0]?.args[0] ?? 0));
    const critLow = Math.min(...b.mock.created.oscillators.map((o) => o.frequency.calls[0]?.args[0] ?? 0));
    expect(critLow).toBeGreaterThan(clickTop);
  });

  it('makes win longer and larger than ship', () => {
    const s = setup();
    s.player.play('ship');
    const w = setup();
    w.player.play('win');
    const tail = (m: MockAudioContext): number =>
      Math.max(...m.sources().map((x) => x.stopCalls[0] ?? 0));
    expect(w.mock.sources().length).toBeGreaterThan(s.mock.sources().length);
    expect(tail(w.mock)).toBeGreaterThan(tail(s.mock));
  });

  it('slides lose downward', () => {
    const { mock, player } = setup();
    player.play('lose');
    const osc = mock.created.oscillators[0]!;
    const from = osc.frequency.calls[0]!.args[0]!;
    const to = osc.frequency.calls[1]!.args[0]!;
    expect(to).toBeLessThan(from / 2);
  });

  it('varies warn pitch between consecutive beeps so it does not grate', () => {
    const { mock, player } = setup();
    const bases: number[] = [];
    for (let i = 0; i < 4; i++) {
      mock.advance(1);
      const before = mock.created.oscillators.length;
      player.play('warn');
      bases.push(mock.created.oscillators[before]!.frequency.calls[0]!.args[0]!);
    }
    expect(new Set(bases).size).toBe(4);
    // ...but the wobble stays sub-semitone, so it still reads as the same alarm.
    for (const f of bases) {
      expect(Math.abs(1200 * Math.log2(f / bases[0]!))).toBeLessThan(100);
    }
  });
});

describe('click streak', () => {
  function clickFreqs(mock: MockAudioContext): number[] {
    return mock.created.oscillators.map((o) => o.frequency.calls[0]?.args[0] ?? 0);
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
});

describe('voice budget under load', () => {
  it('drops mashed clicks rather than cutting a fanfare short', () => {
    const { mock, player, pool } = setup(24);
    player.play('win');
    const fanfareVoices = mock.sources().length;
    expect(fanfareVoices).toBeGreaterThan(4);

    for (let i = 0; i < 200; i++) player.play('click');

    expect(pool.active).toBeLessThanOrEqual(24);
    expect(mock.sources().length).toBeLessThanOrEqual(24);
    // Every fanfare voice is still scheduled for its full length.
    for (let i = 0; i < fanfareVoices; i++) {
      const s = mock.sources()[i]!;
      expect(s.stopCalls).toHaveLength(1);
    }
  });

  it('lets a fanfare steal a slot from mashed clicks when the pool is full', () => {
    const { mock, player, pool } = setup(24);
    for (let i = 0; i < 200; i++) player.play('click');
    expect(pool.active).toBe(24);
    const beforeSources = mock.sources().length;

    player.play('ship');
    expect(pool.active).toBeLessThanOrEqual(24);
    expect(mock.sources().length).toBeGreaterThan(beforeSources);
  });
});
