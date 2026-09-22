import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/sim/types.ts';
import { BALANCE, INCIDENTS, INCIDENT_BY_ID } from '../../src/sim/content.ts';
import {
  incidentCandidates,
  incidentTone,
  isClickClearable,
  makeActiveIncident,
  rollFirstIncidentDelayMs,
  rollIncidentDelayMs,
  selectIncident,
} from '../../src/sim/incidents.ts';
import { standaloneRng } from '../../src/sim/rng.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: Partial<Parameters<typeof createSim>[0]> = {}): Sim {
  return createSim({ seed: 777, storage: null, persist: false, ...over });
}

function record(sim: Sim): GameEvent[] {
  const log: GameEvent[] = [];
  sim.subscribe((e) => log.push(e));
  return log;
}

describe('incident scheduling', () => {
  it('rolls uniformly inside [INCIDENT_MIN_MS, INCIDENT_MAX_MS] at rate 1', () => {
    const rng = standaloneRng(5);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const d = rollIncidentDelayMs(rng, 1);
      expect(d).toBeGreaterThanOrEqual(BALANCE.INCIDENT_MIN_MS);
      expect(d).toBeLessThanOrEqual(BALANCE.INCIDENT_MAX_MS);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    // With 5000 samples the range should be nearly saturated.
    expect(min).toBeLessThan(BALANCE.INCIDENT_MIN_MS + 200);
    expect(max).toBeGreaterThan(BALANCE.INCIDENT_MAX_MS - 200);
  });

  it('divides the delay by incidentRateMult', () => {
    const a = standaloneRng(11);
    const b = standaloneRng(11);
    expect(rollIncidentDelayMs(a, 2)).toBeCloseTo(rollIncidentDelayMs(b, 1) / 2, 9);
  });

  it('falls back to a sane delay for a degenerate rate multiplier', () => {
    const rng = standaloneRng(3);
    expect(rollIncidentDelayMs(rng, 0)).toBeGreaterThanOrEqual(BALANCE.INCIDENT_MIN_MS);
    expect(rollIncidentDelayMs(rng, Number.NaN)).toBeGreaterThanOrEqual(BALANCE.INCIDENT_MIN_MS);
  });

  it('never schedules the first incident inside the grace window', () => {
    const rng = standaloneRng(1);
    for (let i = 0; i < 500; i++) {
      expect(rollFirstIncidentDelayMs(rng, 8)).toBeGreaterThanOrEqual(BALANCE.INCIDENT_GRACE_MS);
    }
  });
});

describe('incident selection', () => {
  it('filters by minProjectIndex', () => {
    expect(incidentCandidates('bad', 0, []).map((d) => d.id)).not.toContain('prod_outage');
    expect(incidentCandidates('bad', 3, []).map((d) => d.id)).toContain('prod_outage');
    expect(incidentCandidates('bad', 4, []).map((d) => d.id)).not.toContain('compliance_audit');
    expect(incidentCandidates('bad', 5, []).map((d) => d.id)).toContain('compliance_audit');
  });

  it('excludes incidents already active — no duplicate stacking', () => {
    const active = INCIDENTS.filter((i) => i.tone === 'bad').map((i) => i.id);
    expect(incidentCandidates('bad', 9, active)).toHaveLength(0);
    expect(incidentCandidates('bad', 9, ['rate_limited']).map((d) => d.id)).not.toContain(
      'rate_limited',
    );
  });

  it('only ever returns an incident from the requested project range', () => {
    const rng = standaloneRng(42);
    for (let i = 0; i < 2000; i++) {
      const def = selectIncident(rng, 0, []);
      expect(def).toBeDefined();
      expect(def?.minProjectIndex ?? 0).toBeLessThanOrEqual(0);
    }
  });

  it('honours GOOD_INCIDENT_CHANCE as the bucket split', () => {
    const rng = standaloneRng(88);
    let good = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      if (selectIncident(rng, 9, [])?.tone === 'good') good += 1;
    }
    expect(good / n).toBeCloseTo(BALANCE.GOOD_INCIDENT_CHANCE, 1);
  });

  it('returns undefined rather than throwing when every candidate is active', () => {
    const rng = standaloneRng(4);
    const all = INCIDENTS.map((i) => i.id);
    expect(selectIncident(rng, 9, all)).toBeUndefined();
  });

  it('makeActiveIncident seeds duration and click budget from the definition', () => {
    const def = INCIDENT_BY_ID['merge_conflict'];
    expect(def).toBeDefined();
    const active = makeActiveIncident(def!, 1234);
    expect(active).toEqual({
      id: 'merge_conflict',
      remainingMs: def?.durationMs,
      clicksRemaining: def?.clearWithClicks,
      startedAtMs: 1234,
    });
    expect(isClickClearable(active)).toBe(true);
    expect(incidentTone('merge_conflict')).toBe('bad');
    expect(incidentTone('viral_tweet')).toBe('good');
  });
});

describe('incident lifecycle in a live run', () => {
  it('idleHalt zeroes idle production while active and restores it after', () => {
    const s = mkSim();
    s.run.slop = 1e9;
    s.buyAgent('tab_autocomplete', 10);
    const healthy = s.derived().idleRate;
    expect(healthy).toBeGreaterThan(0);

    s.run.incidents.push({ id: 'rate_limited', remainingMs: 1000, clicksRemaining: 0, startedAtMs: 0 });
    expect(s.derived().idleRate).toBe(0);

    const before = s.run.slop;
    s.tick(1000);
    expect(s.run.slop).toBe(before); // nothing produced while halted
    expect(s.run.incidents.some((i) => i.id === 'rate_limited')).toBe(false);

    const mid = s.run.slop;
    s.tick(1000);
    expect(s.run.slop).toBeGreaterThan(mid);
  });

  it('never pauses the deadline', () => {
    const s = mkSim();
    s.run.incidents.push({ id: 'rate_limited', remainingMs: 60_000, clicksRemaining: 0, startedAtMs: 0 });
    const before = s.run.timeLeftMs;
    s.tick(1000);
    expect(before - s.run.timeLeftMs).toBeCloseTo(1000, 9);
    expect(s.run.incidents).toHaveLength(1);

    const mid = s.run.timeLeftMs;
    s.tick(1000);
    expect(mid - s.run.timeLeftMs).toBeCloseTo(1000, 9);
  });

  it('click-clearing incidents end early and emit progress then end', () => {
    const s = mkSim();
    const def = INCIDENT_BY_ID['merge_conflict'];
    expect(def?.clearWithClicks).toBe(8);
    s.run.incidents.push(makeActiveIncident(def!, 0));
    const log = record(s);

    for (let i = 0; i < 7; i++) s.click(1, 1);
    expect(s.run.incidents).toHaveLength(1);
    expect(s.run.incidents[0]?.clicksRemaining).toBe(1);
    expect(log.some((e) => e.t === 'incidentEnd')).toBe(false);

    s.click(1, 1);
    expect(s.run.incidents).toHaveLength(0);
    const progress = log.filter((e) => e.t === 'incidentProgress');
    expect(progress).toHaveLength(8);
    expect(progress.at(-1)).toEqual({ t: 'incidentProgress', id: 'merge_conflict', clicksRemaining: 0 });
    expect(log.filter((e) => e.t === 'incidentEnd')).toEqual([
      { t: 'incidentEnd', id: 'merge_conflict' },
    ]);
  });

  it('clicks do not touch incidents without a click budget', () => {
    const s = mkSim();
    s.run.incidents.push({ id: 'rate_limited', remainingMs: 8000, clicksRemaining: 0, startedAtMs: 0 });
    const log = record(s);
    for (let i = 0; i < 20; i++) s.click(1, 1);
    expect(s.run.incidents).toHaveLength(1);
    expect(log.some((e) => e.t === 'incidentProgress')).toBe(false);
  });

  it('expires on its timer and emits incidentEnd once', () => {
    const s = mkSim();
    s.run.incidents.push({ id: 'context_overflow', remainingMs: 1500, clicksRemaining: 0, startedAtMs: 0 });
    const log = record(s);
    s.tick(1000);
    expect(s.run.incidents).toHaveLength(1);
    s.tick(600);
    expect(s.run.incidents).toHaveLength(0);
    expect(log.filter((e) => e.t === 'incidentEnd' && e.id === 'context_overflow')).toHaveLength(1);
    s.tick(1000);
    expect(log.filter((e) => e.t === 'incidentEnd' && e.id === 'context_overflow')).toHaveLength(1);
  });

  it('fires incidents over a long run and never stacks duplicates', () => {
    const s = mkSim({ seed: 31337 });
    const log = record(s);
    let started = 0;
    s.subscribe((e) => {
      if (e.t === 'incidentStart') started += 1;
    });
    for (let i = 0; i < 400; i++) {
      s.tick(250);
      s.run.timeLeftMs = 90_000; // keep the run alive
      const ids = s.run.incidents.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(started).toBeGreaterThan(0);
    expect(log.filter((e) => e.t === 'incidentStart').length).toBe(started);
    for (const e of log) {
      if (e.t === 'incidentStart') expect(INCIDENT_BY_ID[e.id]?.tone).toBe(e.tone);
    }
  });

  it('incidentRateMult from a card shortens the gap between incidents', () => {
    const calm = mkSim({ seed: 5150 });
    const chaos = mkSim({ seed: 5150 });
    chaos.run.cards.push('open_weights'); // incidentRateMult 1.5
    chaos.run.owned.push('yolo_mode'); // incidentRateMult 1.6

    let calmStarts = 0;
    let chaosStarts = 0;
    calm.subscribe((e) => {
      if (e.t === 'incidentStart') calmStarts += 1;
    });
    chaos.subscribe((e) => {
      if (e.t === 'incidentStart') chaosStarts += 1;
    });
    for (let i = 0; i < 600; i++) {
      calm.tick(250);
      chaos.tick(250);
      calm.run.timeLeftMs = 90_000;
      chaos.run.timeLeftMs = 90_000;
    }
    expect(chaos.derived().incidentRateMult).toBeCloseTo(1.5 * 1.6, 9);
    expect(chaosStarts).toBeGreaterThan(calmStarts);
  });
});
