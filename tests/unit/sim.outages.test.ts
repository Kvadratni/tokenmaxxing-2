/**
 * Outages: the deploy is blocked but the clock keeps running. This is the
 * nastiest thing the game does, so its edges are worth pinning down.
 */
import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  INCIDENTS,
  INCIDENT_BY_ID,
  createSim,
  defaultMeta,
  makeActiveIncident,
  outageIsFair,
  outageWeight,
} from '../../src/sim/index.ts';

const OUTAGES = INCIDENTS.filter((i) => i.blocksShip === true);

function sim() {
  return createSim({ seed: 31, meta: defaultMeta(), storage: null, autoStart: true });
}

/** Put the wallet comfortably over the bar so only the outage can block. */
function fundToShip(s: ReturnType<typeof sim>) {
  s.run.slop = s.derived().requirement * 2;
}

describe('outage content', () => {
  it('there is a real set of them and every one is a bad-tone incident', () => {
    expect(OUTAGES.length).toBeGreaterThanOrEqual(4);
    for (const o of OUTAGES) {
      expect(o.tone).toBe('bad');
      expect(o.durationMs).toBeGreaterThan(0);
    }
  });
});

describe('an outage blocks the deploy', () => {
  it('canShip goes false even with the bar full, and names the blocker', () => {
    const s = sim();
    fundToShip(s);
    expect(s.derived().canShip).toBe(true);
    expect(s.derived().shipBlockedBy).toBeNull();

    const def = INCIDENT_BY_ID['github_down']!;
    s.run.incidents.push(makeActiveIncident(def, s.run.elapsedMs));

    const d = s.derived();
    expect(d.canShip).toBe(false);
    expect(d.shipBlockedBy).toBe(def.name);
    // The bar itself is still full — this is a gate, not a loss of progress.
    expect(d.shipProgress).toBe(1);
  });

  it('ship() actually refuses while the outage is up, then works after', () => {
    const s = sim();
    fundToShip(s);
    const def = INCIDENT_BY_ID['github_down']!;
    s.run.incidents.push(makeActiveIncident(def, s.run.elapsedMs));

    expect(s.ship()).toBe(false);
    expect(s.run.shipped).toBe(0);

    s.run.incidents.length = 0;
    expect(s.ship()).toBe(true);
    expect(s.run.shipped).toBe(1);
  });

  it('the deadline keeps burning while shipping is blocked', () => {
    const s = sim();
    fundToShip(s);
    s.run.incidents.push(makeActiveIncident(INCIDENT_BY_ID['github_down']!, s.run.elapsedMs));
    const before = s.run.timeLeftMs;
    for (let i = 0; i < 20; i++) s.tick(200);
    expect(before - s.run.timeLeftMs).toBeGreaterThan(3_500);
  });

  it('an outage can end a run that would otherwise have shipped', () => {
    const s = sim();
    fundToShip(s);
    // Five seconds on the clock, and a nine-second outage.
    s.run.timeLeftMs = 5_000;
    s.run.incidents.push(makeActiveIncident(INCIDENT_BY_ID['github_down']!, s.run.elapsedMs));
    for (let i = 0; i < 40 && s.run.phase === 'running'; i++) s.tick(200);
    expect(s.run.phase).toBe('lost');
    expect(s.run.shipped).toBe(0);
  });

  it('clears on its own and shipping becomes possible again', () => {
    const s = sim();
    fundToShip(s);
    const def = INCIDENT_BY_ID['github_down']!;
    s.run.incidents.push(makeActiveIncident(def, s.run.elapsedMs));
    // Keep the clock well ahead of the outage so the run survives it.
    s.run.timeLeftMs = def.durationMs * 4;
    while (s.derived().shipBlockedBy !== null && s.run.phase === 'running') s.tick(200);
    expect(s.derived().shipBlockedBy).toBeNull();
    expect(s.derived().canShip).toBe(true);
  });

  it('a click-clearable outage can be worked off by hand', () => {
    const s = sim();
    fundToShip(s);
    const def = INCIDENT_BY_ID['cert_expired']!;
    expect(def.clearWithClicks).toBeGreaterThan(0);
    s.run.incidents.push(makeActiveIncident(def, s.run.elapsedMs));
    expect(s.derived().canShip).toBe(false);
    for (let i = 0; i < (def.clearWithClicks ?? 0); i++) s.click(160, 118);
    expect(s.derived().shipBlockedBy).toBeNull();
  });
});

describe('outages never steal a run at the buzzer', () => {
  it('an outage that cannot clear before the deadline is not eligible', () => {
    for (const o of OUTAGES) {
      // Comfortably more time than the outage needs: fair game.
      expect(outageIsFair(o, o.durationMs + BALANCE.OUTAGE_FAIRNESS_MARGIN_MS + 1)).toBe(true);
      // Not enough time to survive it: must not fire.
      expect(outageIsFair(o, o.durationMs)).toBe(false);
      expect(outageIsFair(o, 500)).toBe(false);
    }
  });

  it('ordinary incidents are unaffected by the deadline guard', () => {
    const ordinary = INCIDENTS.find((i) => !i.blocksShip)!;
    expect(outageIsFair(ordinary, 1)).toBe(true);
  });

  it('a full-length project never rolls an unsurvivable outage', () => {
    const s = sim();
    // Drive a whole project and assert the invariant every time one starts.
    for (let i = 0; i < 900 && s.run.phase === 'running'; i++) {
      const before = s.run.timeLeftMs;
      s.tick(120);
      for (const inc of s.run.incidents) {
        const def = INCIDENT_BY_ID[inc.id];
        if (!def?.blocksShip) continue;
        if (inc.remainingMs !== def.durationMs) continue; // only the frame it spawned
        expect(
          def.durationMs + BALANCE.OUTAGE_FAIRNESS_MARGIN_MS,
          `${def.id} fired with only ${Math.round(before)}ms left`,
        ).toBeLessThanOrEqual(before);
      }
    }
  });
});

describe('outage frequency tracks the risk dial', () => {
  it('outages are rare at baseline risk and common when it is cranked', () => {
    const def = OUTAGES[0]!;
    const calm = outageWeight(def, 1);
    const risky = outageWeight(def, 2);
    expect(risky).toBeGreaterThan(calm);
    // A non-outage incident is unaffected by the dial.
    const ordinary = INCIDENTS.find((i) => !i.blocksShip)!;
    expect(outageWeight(ordinary, 2)).toBe(outageWeight(ordinary, 1));
  });

  it('the bias constant is what actually drives the scaling', () => {
    const def = OUTAGES[0]!;
    const at2 = outageWeight(def, 2);
    expect(at2).toBeCloseTo(def.weight * (0.45 + BALANCE.OUTAGE_BIAS), 10);
  });
});
