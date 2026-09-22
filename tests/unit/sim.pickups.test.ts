/**
 * Pickups. The point of this content is *verb* variety — a lump sum, a chunk
 * of deadline and an outage cleanse are different things to want, not three
 * flavours of the same multiplier. These tests pin each verb.
 */
import { describe, expect, it } from 'vitest';
import {
  INCIDENT_BY_ID,
  PICKUPS,
  PICKUP_BY_ID,
  PICKUP_TUNING,
  createSim,
  defaultMeta,
  makeActiveIncident,
  pickupsForScene,
  projectRequirement,
} from '../../src/sim/index.ts';
import type { PickupDef } from '../../src/sim/content.ts';

function sim() {
  return createSim({ seed: 77, meta: defaultMeta(), storage: null, autoStart: true });
}

/** Drop `def` on screen exactly where the player is about to click. */
function place(s: ReturnType<typeof sim>, def: PickupDef) {
  s.run.pickup = {
    id: def.id,
    x: 160,
    y: 90,
    vx: 0,
    baseY: 90,
    ageS: 0,
    remainingMs: PICKUP_TUNING.LIFETIME_MS,
  };
}

const byAction = (t: string): PickupDef[] => PICKUPS.filter((p) => p.action.t === t);

describe('pickup content', () => {
  it('every room has at least three possibilities', () => {
    for (const scene of ['bedroom', 'coworking', 'openplan', 'datacenter', 'orbital'] as const) {
      expect(pickupsForScene(scene).length, scene).toBeGreaterThanOrEqual(3);
    }
  });

  it('covers every verb, not just timed multipliers', () => {
    for (const verb of ['buff', 'slop', 'time', 'cleanse', 'agent']) {
      expect(byAction(verb).length, `no pickup with action ${verb}`).toBeGreaterThan(0);
    }
  });

  it('every buff action points at a real good-tone incident', () => {
    for (const p of byAction('buff')) {
      const id = (p.action as { incident: string }).incident;
      const def = INCIDENT_BY_ID[id];
      expect(def, `${p.id} -> missing incident ${id}`).toBeDefined();
      expect(def!.tone).toBe('good');
      // Weight 0 keeps them out of the random incident roll.
      expect(def!.weight).toBe(0);
    }
  });

  it('ids and labels are unique', () => {
    expect(new Set(PICKUPS.map((p) => p.id)).size).toBe(PICKUPS.length);
    expect(new Set(PICKUPS.map((p) => p.label)).size).toBe(PICKUPS.length);
  });
});

describe('collecting', () => {
  it('a miss leaves the pickup on screen', () => {
    const s = sim();
    place(s, PICKUP_BY_ID['energy_drink']!);
    expect(s.collectPickup(10, 10)).toBe(false);
    expect(s.run.pickup).not.toBeNull();
  });

  it('a hit consumes it and schedules the next one', () => {
    const s = sim();
    place(s, PICKUP_BY_ID['energy_drink']!);
    expect(s.collectPickup(162, 92)).toBe(true);
    expect(s.run.pickup).toBeNull();
    expect(s.run.nextPickupInMs).toBeGreaterThan(0);
  });

  it('buff — grants the timed incident and refreshes rather than stacking', () => {
    const s = sim();
    const def = PICKUP_BY_ID['energy_drink']!;
    place(s, def);
    s.collectPickup(160, 90);
    expect(s.run.incidents.filter((i) => i.id === 'buff_energy_drink')).toHaveLength(1);

    place(s, def);
    s.collectPickup(160, 90);
    expect(s.run.incidents.filter((i) => i.id === 'buff_energy_drink')).toHaveLength(1);
  });

  it('slop — pays a fraction of the current requirement, so it scales', () => {
    const s = sim();
    const def = PICKUP_BY_ID['late_delivery']!;
    const frac = (def.action as { ofRequirement: number }).ofRequirement;
    const before = s.run.slop;
    place(s, def);
    s.collectPickup(160, 90);
    expect(s.run.slop - before).toBeCloseTo(projectRequirement(0) * frac, 6);
    expect(s.run.slopEarned).toBeGreaterThan(0);
  });

  it('time — puts seconds back on the clock', () => {
    const s = sim();
    const def = PICKUP_BY_ID['power_nap']!;
    const ms = (def.action as { ms: number }).ms;
    const before = s.run.timeLeftMs;
    place(s, def);
    s.collectPickup(160, 90);
    expect(s.run.timeLeftMs).toBeCloseTo(before + ms, 6);
  });

  it('cleanse — clears bad incidents but leaves your buffs alone', () => {
    const s = sim();
    s.run.incidents.push(makeActiveIncident(INCIDENT_BY_ID['github_down']!, 0));
    s.run.incidents.push(makeActiveIncident(INCIDENT_BY_ID['flaky_tests']!, 0));
    s.run.incidents.push(makeActiveIncident(INCIDENT_BY_ID['buff_cold_brew']!, 0));

    place(s, PICKUP_BY_ID['hotfix']!);
    s.collectPickup(160, 90);

    const left = s.run.incidents.map((i) => i.id);
    expect(left).toEqual(['buff_cold_brew']);
  });

  it('cleanse — is the answer to an outage, and unblocks the deploy', () => {
    const s = sim();
    s.run.slop = s.derived().requirement * 2;
    s.run.incidents.push(makeActiveIncident(INCIDENT_BY_ID['github_down']!, 0));
    expect(s.derived().canShip).toBe(false);

    place(s, PICKUP_BY_ID['hotfix']!);
    s.collectPickup(160, 90);

    expect(s.derived().shipBlockedBy).toBeNull();
    expect(s.derived().canShip).toBe(true);
    expect(s.ship()).toBe(true);
  });

  it('agent — grants the best tier already fielded, free', () => {
    const s = sim();
    s.run.slop = 1e9;
    s.buyAgent('tab_autocomplete', 1);
    s.buyAgent('copy_paste_chatbot', 1);
    const spentBefore = s.run.slopSpent;

    place(s, PICKUP_BY_ID['summer_intern']!);
    s.collectPickup(160, 90);

    expect(s.run.agents.copy_paste_chatbot).toBe(2);
    expect(s.run.slopSpent, 'the intern is free').toBe(spentBefore);
  });

  it('agent — respects the per-tier ceiling', () => {
    const s = sim();
    s.run.slop = 1e15;
    s.buyAgent('tab_autocomplete', Number.POSITIVE_INFINITY);
    const capped = s.run.agents.tab_autocomplete;
    place(s, PICKUP_BY_ID['summer_intern']!);
    s.collectPickup(160, 90);
    expect(s.run.agents.tab_autocomplete).toBe(capped);
  });

  it('nothing is collectable outside a running project', () => {
    const s = sim();
    place(s, PICKUP_BY_ID['energy_drink']!);
    s.run.phase = 'drafting';
    expect(s.collectPickup(160, 90)).toBe(false);
  });
});

describe('spawning', () => {
  it('only ever offers pickups legal for the current room', () => {
    const s = sim();
    const legal = new Set(pickupsForScene('bedroom').map((p) => p.id));
    for (let i = 0; i < 4000 && s.run.phase === 'running'; i++) {
      s.tick(120);
      if (s.run.pickup) {
        expect(legal.has(s.run.pickup.id), `${s.run.pickup.id} is not a bedroom pickup`).toBe(true);
        s.run.pickup = null;
        s.run.nextPickupInMs = 1;
      }
    }
  });

  it('rare pickups really are rarer', () => {
    const s = sim();
    const seen: Record<string, number> = {};
    for (let i = 0; i < 40_000 && s.run.phase !== 'lost'; i++) {
      s.tick(120);
      if (s.run.pickup) {
        seen[s.run.pickup.id] = (seen[s.run.pickup.id] ?? 0) + 1;
        s.run.pickup = null;
        s.run.nextPickupInMs = 1;
      }
      if (s.run.phase !== 'running') s.startRun(1234 + i);
    }
    const total = Object.values(seen).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(60);
    const rareShare = PICKUPS.filter((p) => p.rare).reduce((n, p) => n + (seen[p.id] ?? 0), 0) / total;
    const commonShare = 1 - rareShare;
    expect(commonShare).toBeGreaterThan(rareShare);
  });
});
