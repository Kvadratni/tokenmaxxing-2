/**
 * The two crit tracks: click crits (human) and agent one-shots (idle).
 *
 * Both are pure RNG, so these tests drive the real sim with a fixed seed and
 * assert on distributions over many samples rather than on single rolls.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/sim/content.ts';
import { aggregate } from '../../src/sim/effects.ts';
import * as Sim from '../../src/sim/index.ts';
import type { Effect, GameEvent } from '../../src/sim/types.ts';

function sim(): ReturnType<typeof Sim.createSim> {
  return Sim.createSim({ seed: 1234, storage: null, persist: false });
}

/**
 * A funded run with One-Shot bought.
 *
 * Two gates to clear: the tree has to have granted the upgrade at all (it rides
 * along with `unlock_ralph`), and the run has to have climbed the agent ladder
 * to CLI Agent, since tiers reveal in order.
 */
function oneShotRun(seed: number): ReturnType<typeof Sim.createSim> {
  const s = sim();
  (s.meta as unknown as { levels: Record<string, number> }).levels['unlock_ralph'] = 1;
  s.startRun(seed);
  s.run.slop = 1e12;
  s.buyAgent('tab_autocomplete', 20);
  s.buyAgent('copy_paste_chatbot', 10);
  s.buyAgent('agentic_ide', 5);
  s.buyAgent('cli_agent', 5);
  expect(s.buyUpgrade('one_shot'), 'One-Shot should be purchasable here').toBe(true);
  expect(s.derived().oneShotChance).toBeGreaterThan(0);
  return s;
}

describe('click crits', () => {
  it('default to the base rate and multiplier', () => {
    const s = sim();
    s.startRun(7);
    const d = s.derived();
    expect(d.critChance).toBe(BALANCE.CRIT_CHANCE);
    expect(d.critMult).toBe(BALANCE.CRIT_MULT);
  });

  it('critChance effects stack additively, not multiplicatively', () => {
    const five: Effect[] = Array.from({ length: 5 }, () => ({ t: 'critChance', v: 0.05 }));
    expect(aggregate([five]).critChance).toBeCloseTo(BALANCE.CRIT_CHANCE + 0.25, 6);
  });

  it('cannot be stacked past the cap', () => {
    const lots: Effect[] = Array.from({ length: 40 }, () => ({ t: 'critChance', v: 0.1 }));
    expect(aggregate([lots]).critChance).toBe(BALANCE.CRIT_CHANCE_CAP);
    // A crit is meant to stay a gamble even for a maxed build.
    expect(BALANCE.CRIT_CHANCE_CAP).toBeLessThan(1);
  });

  it('a negative effect cannot push the chance below zero', () => {
    expect(aggregate([[{ t: 'critChance', v: -5 }]]).critChance).toBe(0);
  });

  it('crits actually pay out the multiplier', () => {
    const s = sim();
    s.startRun(99);
    let crits = 0;
    let critSum = 0;
    let normals = 0;
    let normalSum = 0;
    s.subscribe((e: GameEvent) => {
      if (e.t !== 'click') return;
      if (e.crit) {
        crits += 1;
        critSum += e.amount;
      } else {
        normals += 1;
        normalSum += e.amount;
      }
    });
    for (let i = 0; i < 4000; i++) s.click(0, 0);

    expect(crits, 'no crit landed in 4000 clicks').toBeGreaterThan(0);
    // ~4% of 4000. Wide bounds: this is asserting the rate is roughly right,
    // not pinning the seed's exact draw.
    expect(crits / (crits + normals)).toBeGreaterThan(0.02);
    expect(crits / (crits + normals)).toBeLessThan(0.07);
    expect(critSum / crits).toBeCloseTo((normalSum / normals) * BALANCE.CRIT_MULT, 4);
  });
});

describe('agent one-shots', () => {
  it('are locked until something grants the chance', () => {
    const s = sim();
    s.startRun(7);
    expect(s.derived().oneShotChance).toBe(0);

    let fired = 0;
    s.subscribe((e: GameEvent) => {
      if (e.t === 'oneShot') fired += 1;
    });
    // Buy production so idleRate is non-zero, then run for a long while.
    s.run.slop = 1e9;
    s.buyAgent('tab_autocomplete', 10);
    expect(s.derived().idleRate).toBeGreaterThan(0);
    for (let i = 0; i < 4000; i++) s.tick(100);
    expect(fired, 'one-shots fired without being unlocked').toBe(0);
  });

  it('fire once unlocked, and pay out seconds of idle output', () => {
    const s = oneShotRun(11);
    const bursts: Array<{ amount: number; seconds: number }> = [];
    s.subscribe((e: GameEvent) => {
      if (e.t === 'oneShot') bursts.push({ amount: e.amount, seconds: e.seconds });
    });
    for (let i = 0; i < 2000; i++) s.tick(100);

    expect(bursts.length, 'no one-shot in ~200s at 8%/s').toBeGreaterThan(0);
    for (const b of bursts) {
      expect(b.seconds).toBe(BALANCE.ONE_SHOT_BASE_PAYOUT_S);
      expect(b.amount).toBeGreaterThan(0);
      expect(Number.isFinite(b.amount)).toBe(true);
    }
  });

  it('roll on a fixed cadence, so the rate does not scale with framerate', () => {
    const count = (stepMs: number): number => {
      const s = oneShotRun(11);
      let fired = 0;
      s.subscribe((e: GameEvent) => {
        if (e.t === 'oneShot') fired += 1;
      });
      const steps = Math.round(200_000 / stepMs);
      for (let i = 0; i < steps; i++) s.tick(stepMs);
      return fired;
    };
    // 200 seconds of sim at 8%/s is ~16 either way. A per-frame roll would
    // make the 16ms run ~60x the 200ms one.
    const fast = count(16);
    const slow = count(200);
    expect(fast).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(0);
    expect(Math.abs(fast - slow)).toBeLessThan(12);
  });

  it('cannot be stacked past the cap', () => {
    const lots: Effect[] = Array.from({ length: 40 }, () => ({ t: 'oneShotChance', v: 0.1 }));
    expect(aggregate([lots]).oneShotChance).toBe(BALANCE.ONE_SHOT_CHANCE_CAP);
  });

  it('a burst counts as earned slop, not free slop', () => {
    const s = oneShotRun(11);
    let bursted = 0;
    s.subscribe((e: GameEvent) => {
      if (e.t === 'oneShot') bursted += e.amount;
    });
    const before = { slop: s.run.slop, earned: s.run.slopEarned };
    for (let i = 0; i < 2000; i++) s.tick(100);
    expect(bursted).toBeGreaterThan(0);

    // Everything the bursts paid must show up in both totals. Compared
    // relatively: these are six-figure sums of per-frame floats, so an
    // absolute epsilon would be testing IEEE754, not the game.
    const gained = s.run.slop - before.slop;
    const earned = s.run.slopEarned - before.earned;
    expect(Math.abs(earned - gained) / gained).toBeLessThan(1e-6);
    expect(earned).toBeGreaterThan(bursted);
  });
});

describe('crit content', () => {
  it('offers several independent ways into each track', () => {
    const critSources = Sim.UPGRADES.filter((u) =>
      u.effects.some((e) => e.t === 'critChance' || e.t === 'critMult'),
    ).length;
    const critCards = Sim.CARDS.filter((c) =>
      c.effects.some((e) => e.t === 'critChance' || e.t === 'critMult'),
    ).length;
    const oneShotSources = Sim.UPGRADES.filter((u) =>
      u.effects.some((e) => e.t === 'oneShotChance' || e.t === 'oneShotPayout'),
    ).length;
    const oneShotCards = Sim.CARDS.filter((c) =>
      c.effects.some((e) => e.t === 'oneShotChance' || e.t === 'oneShotPayout'),
    ).length;

    expect(critSources + critCards, 'the human crit track needs several routes').toBeGreaterThanOrEqual(4);
    expect(
      oneShotSources + oneShotCards,
      'the agent one-shot track needs several routes',
    ).toBeGreaterThanOrEqual(4);
  });

  it('gives run one a crit path but not a one-shot path', () => {
    const s = sim();
    s.startRun(3);
    // Flow State ships in the starting pool, so a hand-clicker has something to
    // build toward before agents exist.
    expect(Sim.STARTING_UPGRADES).toContain('flow_state');
    // One-shots are a committed build, unlocked from the tree.
    expect(Sim.STARTING_UPGRADES).not.toContain('one_shot');
    expect(s.derived().oneShotChance).toBe(0);
  });

  it('stacking every source still lands under both caps', () => {
    const all: Effect[] = [
      ...Sim.UPGRADES.flatMap((u) => u.effects),
      ...Sim.CARDS.flatMap((c) => c.effects),
    ].filter(
      (e) =>
        e.t === 'critChance' ||
        e.t === 'critMult' ||
        e.t === 'oneShotChance' ||
        e.t === 'oneShotPayout',
    );
    const agg = aggregate([all]);
    expect(agg.critChance).toBeLessThanOrEqual(BALANCE.CRIT_CHANCE_CAP);
    expect(agg.oneShotChance).toBeLessThanOrEqual(BALANCE.ONE_SHOT_CHANCE_CAP);
    // A build that takes literally everything should be near the ceiling —
    // otherwise the caps are decoration and the content is under-tuned.
    expect(agg.critChance).toBeGreaterThan(0.2);
    expect(agg.oneShotChance).toBeGreaterThan(0.2);
  });
});
