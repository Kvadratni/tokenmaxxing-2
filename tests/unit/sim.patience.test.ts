import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { BALANCE, promptPatienceMs } from '../../src/sim/content.ts';
import { STAT } from '../../src/sim/effects.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 11, storage: null, persist: false, ...over });
  s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
  s.run.nextPickupInMs = Number.POSITIVE_INFINITY;
  return s;
}

function record(s: Sim): GameEvent[] {
  const log: GameEvent[] = [];
  s.subscribe((e) => log.push(e));
  return log;
}

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

function tickFor(s: Sim, ms: number): void {
  for (let left = ms; left > 0; left -= 100) s.tick(Math.min(100, left));
}

describe('patience', () => {
  it('max = promptPatienceMs(index) x patienceMult, full at the start', () => {
    const s = mkSim({ meta: metaWith({ helpful: 2 }) }); // x1.12
    expect(s.patienceMaxMs).toBeCloseTo(promptPatienceMs(0) * 1.12, 6);
    expect(s.run.patienceMs).toBeCloseTo(s.patienceMaxMs, 6);
    expect(s.derived().patienceMaxMs).toBeCloseTo(s.patienceMaxMs, 6);
    expect(s.derived().patienceProgress).toBeCloseTo(1, 10);
  });

  it('is recomputed live and clamped when the max shrinks', () => {
    const s = mkSim();
    s.run.cards.push('grandma'); // x1.25: max grows, patience does not
    expect(s.patienceMaxMs).toBeCloseTo(promptPatienceMs(0) * 1.25, 6);
    expect(s.run.patienceMs).toBeCloseTo(promptPatienceMs(0), 6);
    s.run.cards.length = 0;
    s.run.cards.push('fix_it_now'); // x0.85
    s.tick(1);
    expect(s.run.patienceMs).toBeLessThanOrEqual(promptPatienceMs(0) * 0.85);
  });

  it('drains 1:1 with sim time while running', () => {
    const s = mkSim();
    const start = s.run.patienceMs;
    tickFor(s, 5000);
    expect(s.run.patienceMs).toBeCloseTo(start - 5000, 6);
  });

  it('does not drain while the human is at lunch', () => {
    const s = mkSim();
    s.debug.forceIncident('lunch');
    const start = s.run.patienceMs;
    expect(s.derived().patienceFrozen).toBe(true);
    tickFor(s, 5000);
    expect(s.run.patienceMs).toBe(start);
  });

  it('does not drain in the report beat or the draft', () => {
    const s = mkSim();
    s.run.tokens = 100;
    s.report();
    const p = s.run.patienceMs;
    tickFor(s, BALANCE.REPORT_BEAT_MS - 100);
    expect(s.run.patienceMs).toBe(p);
    tickFor(s, 200);
    expect(s.run.phase).toBe('drafting');
    tickFor(s, 10_000);
    expect(s.run.phase).toBe('drafting');
  });

  it('warns once at WARN_AT_SECONDS left', () => {
    const s = mkSim();
    const log = record(s);
    s.run.patienceMs = (BALANCE.WARN_AT_SECONDS + 1) * 1000;
    tickFor(s, 5000);
    const warns = log.filter((e) => e.t === 'patienceWarn');
    expect(warns).toEqual([{ t: 'patienceWarn', secondsLeft: BALANCE.WARN_AT_SECONDS }]);
  });

  it('loses the run at zero and banks the pending thumbs', () => {
    const s = mkSim();
    const log = record(s);
    s.run.pendingThumbs = 3;
    s.run.patienceMs = 500;
    tickFor(s, 1000);
    expect(s.run.phase).toBe('lost');
    expect(s.run.patienceMs).toBe(0);
    expect(s.meta.thumbs).toBe(3);
    expect(s.meta.runs).toBe(1);
    expect(log.find((e) => e.t === 'runOver')).toEqual({ t: 'runOver', won: false, thumbs: 3, reported: 0 });
  });

  it('can be restored as a fraction of the max by an instant action', () => {
    const s = mkSim();
    const max = s.patienceMaxMs;
    s.run.patienceMs = max * 0.5;
    s.debug.forceIncident('thanks'); // +25%
    expect(s.run.patienceMs).toBeCloseTo(max * 0.75, 6);
    s.run.incidents.length = 0;
    s.debug.forceIncident('thanks');
    expect(s.run.patienceMs).toBeCloseTo(max, 6); // clamped
  });
});

describe('"You\'re absolutely right!"', () => {
  it('restores SYCOPHANCY_BASE x mult x 0.5^heat of the max, halving each press', () => {
    const s = mkSim();
    const log = record(s);
    const max = s.patienceMaxMs;
    s.run.patienceMs = max * 0.2;
    expect(s.derived().sycophancyPower).toBeCloseTo(BALANCE.SYCOPHANCY_BASE, 10);

    expect(s.absolutelyRight()).toBe(true);
    expect(s.run.patienceMs).toBeCloseTo(max * (0.2 + BALANCE.SYCOPHANCY_BASE), 6);
    expect(s.run.sycophancyHeat).toBe(1);
    expect(s.derived().sycophancyPower).toBeCloseTo(BALANCE.SYCOPHANCY_BASE / 2, 10);

    s.absolutelyRight();
    expect(s.run.patienceMs).toBeCloseTo(max * (0.2 + BALANCE.SYCOPHANCY_BASE * 1.5), 6);
    const evs = log.filter((e) => e.t === 'sycophancy');
    expect(evs).toEqual([
      { t: 'sycophancy', restored: BALANCE.SYCOPHANCY_BASE, heat: 1 },
      { t: 'sycophancy', restored: BALANCE.SYCOPHANCY_BASE / 2, heat: 2 },
    ]);
    expect(s.run.sycophancy).toBe(2);
    expect(s.meta.stats[STAT.sycophancy]).toBe(2);
  });

  it('heat decays by one per SYCOPHANCY_HEAT_DECAY_MS, floored at zero', () => {
    const s = mkSim();
    s.absolutelyRight();
    s.absolutelyRight();
    tickFor(s, BALANCE.SYCOPHANCY_HEAT_DECAY_MS / 2);
    expect(s.run.sycophancyHeat).toBeCloseTo(1.5, 6);
    tickFor(s, BALANCE.SYCOPHANCY_HEAT_DECAY_MS);
    expect(s.run.sycophancyHeat).toBeCloseTo(0.5, 6);
    tickFor(s, BALANCE.SYCOPHANCY_HEAT_DECAY_MS);
    expect(s.run.sycophancyHeat).toBe(0);
    expect(s.derived().sycophancyPower).toBeCloseTo(BALANCE.SYCOPHANCY_BASE, 10);
  });

  it('is multiplied by RLHF and Apology Templates', () => {
    const s = mkSim({ meta: metaWith({ helpful: 1, rlhf: 3 }) });
    s.run.owned.push('apology_templates');
    expect(s.derived().sycophancyPower).toBeCloseTo(BALANCE.SYCOPHANCY_BASE * 2.3 * 1.5, 10);
  });

  it('costs context, which can compact you', () => {
    const s = mkSim();
    s.absolutelyRight();
    expect(s.run.context).toBe(BALANCE.CTX_PER_SYCOPHANCY);
    s.run.context = BALANCE.BASE_CONTEXT - 10;
    s.absolutelyRight();
    expect(s.run.forcedCompactions).toBe(1);
  });

  it('never overfills the bar and only works while running', () => {
    const s = mkSim();
    s.absolutelyRight();
    expect(s.run.patienceMs).toBeCloseTo(s.patienceMaxMs, 6);
    const log = record(s);
    s.run.phase = 'drafting';
    expect(s.absolutelyRight()).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'phase' });
  });
});
