import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaFeature, MetaState } from '../../src/sim/types.ts';
import { BALANCE, PICKUPS, PICKUP_TUNING, TOOL_BY_ID, availablePickups, promptAt } from '../../src/sim/content.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 2024, storage: null, persist: false, ...over });
  s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
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

const PROMPTING = ['prompt_library', 'temperature', 'few_shot', 'unlock_viral', 'system_prompt'];

function withFeatures(extra: string[]): MetaState {
  const m = defaultMeta();
  for (const id of [...PROMPTING, ...extra]) m.levels[id] = 1;
  return m;
}

/** Collect the forced pickup where it hovers. */
function grab(s: Sim, id: string): boolean {
  s.debug.forcePickup(id, 100, 60);
  return s.collectPickup(100, 60);
}

describe('spawning', () => {
  it('waits out the grace window, then spawns every MIN..MAX ms', () => {
    const s = mkSim();
    const log = record(s);
    const spawnTimes: number[] = [];
    s.subscribe((e) => {
      if (e.t === 'pickupSpawn') spawnTimes.push(s.run.elapsedMs);
    });
    for (let t = 0; t < 400_000; t += 250) {
      s.tick(250);
      s.run.patienceMs = s.patienceMaxMs;
      s.run.context = 0;
    }
    expect(spawnTimes[0]).toBeGreaterThanOrEqual(PICKUP_TUNING.GRACE_MS);
    const expires = log.filter((e) => e.t === 'pickupExpire').length;
    expect(expires).toBeGreaterThan(5);
    // Gap between one pickup leaving and the next arriving is MIN..MAX.
    for (let i = 1; i < spawnTimes.length; i++) {
      const gap = spawnTimes[i]! - spawnTimes[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(PICKUP_TUNING.MIN_MS);
      expect(gap).toBeLessThanOrEqual(PICKUP_TUNING.MAX_MS + PICKUP_TUNING.LIFETIME_MS + 500);
    }
  });

  it('Serendipity (pickupRate) shortens the gap', () => {
    const count = (meta: MetaState): number => {
      const s = mkSim({ meta });
      let n = 0;
      s.subscribe((e) => {
        if (e.t === 'pickupSpawn') n += 1;
      });
      for (let t = 0; t < 600_000; t += 250) {
        s.tick(250);
        s.run.patienceMs = s.patienceMaxMs;
        s.run.context = 0;
      }
      return n;
    };
    const slow = count(withFeatures([]));
    const fast = count(withFeatures(['serendipity']));
    expect(fast).toBeGreaterThan(slow * 1.25);
  });

  it('rare pickups need Lucky Tokens', () => {
    const none = availablePickups(new Set<MetaFeature>());
    expect(none.some((p) => p.rare)).toBe(false);
    const lucky = availablePickups(new Set<MetaFeature>(['rarePickups']));
    expect(lucky).toHaveLength(PICKUPS.length);
  });

  it('drifts across the stage and expires after its lifetime', () => {
    const s = mkSim();
    const log = record(s);
    s.run.nextPickupInMs = 1;
    s.tick(10);
    const p = s.run.pickup!;
    expect(p).not.toBeNull();
    const x0 = p.x;
    s.tick(1000);
    expect(Math.abs(s.run.pickup!.x - x0)).toBeCloseTo(PICKUP_TUNING.SPEED, 0);
    for (let t = 0; t < PICKUP_TUNING.LIFETIME_MS; t += 250) s.tick(250);
    expect(s.run.pickup).toBeNull();
    expect(log.some((e) => e.t === 'pickupExpire')).toBe(true);
  });
});

describe('collecting', () => {
  it('needs a hit inside the radius and the running phase', () => {
    const s = mkSim();
    const log = record(s);
    s.debug.forcePickup('golden_token', 100, 60);
    expect(s.collectPickup(100 + PICKUP_TUNING.HIT_RADIUS + 1, 60)).toBe(false);
    expect(s.collectPickup(100 + PICKUP_TUNING.HIT_RADIUS - 1, 60)).toBe(true);
    expect(s.collectPickup(100, 60)).toBe(false); // already gone
    expect(log.find((e) => e.t === 'pickupCollect')).toEqual({ t: 'pickupCollect', id: 'golden_token', x: 100, y: 60 });
    s.debug.forcePickup('golden_token', 100, 60);
    s.run.phase = 'drafting';
    expect(s.collectPickup(100, 60)).toBe(false);
  });

  it('Golden Token and A Bug pay a fraction of the requirement', () => {
    const s = mkSim();
    s.run.promptIndex = 2;
    grab(s, 'golden_token');
    expect(s.run.tokens).toBeCloseTo(0.2 * promptAt(2).requirement, 8);
    grab(s, 'a_bug');
    expect(s.run.tokens).toBeCloseTo(0.3 * promptAt(2).requirement, 8);
  });

  it('Cache Hit frees a fifth of the window, never below the floor', () => {
    const s = mkSim();
    s.run.context = 5000;
    grab(s, 'cache_hit');
    expect(s.run.context).toBeCloseTo(5000 - 0.2 * BALANCE.BASE_CONTEXT, 8);
    s.run.tools.mcp_server = 1;
    s.run.context = 1000;
    grab(s, 'cache_hit');
    expect(s.run.context).toBe(TOOL_BY_ID.mcp_server.floor);
  });

  it('"thanks!" restores patience', () => {
    const s = mkSim();
    const max = s.patienceMaxMs;
    s.run.patienceMs = max / 2;
    grab(s, 'thanks_note');
    expect(s.run.patienceMs).toBeCloseTo(max * 0.7, 6);
  });

  it('buffs run as good incidents, and refresh rather than stack', () => {
    const s = mkSim();
    const log = record(s);
    grab(s, 'stack_overflow');
    expect(s.run.incidents.map((i) => i.id)).toEqual(['pk_stack_overflow']);
    expect(log.find((e) => e.t === 'incidentStart')).toEqual({ t: 'incidentStart', id: 'pk_stack_overflow', tone: 'good' });
    expect(s.derived().clickPower).toBe(BALANCE.BASE_CLICK * 5);
    s.tick(2000);
    grab(s, 'stack_overflow');
    expect(s.run.incidents).toHaveLength(1);
    expect(s.run.incidents[0]?.remainingMs).toBe(8_000);
    grab(s, 'documentation');
    expect(s.derived().multipliers.idle).toBe(2);
  });

  it('the Rubber Duck cleanses bad incidents and leaves good ones', () => {
    const s = mkSim();
    s.debug.forceIncident('linter');
    s.debug.forceIncident('overloaded');
    s.debug.forceIncident('lunch');
    grab(s, 'rubber_duck');
    expect(s.run.incidents.map((i) => i.id)).toEqual(['lunch']);
  });

  it('👍 adds to the pending tally', () => {
    const s = mkSim();
    grab(s, 'thumbs_up');
    expect(s.run.pendingThumbs).toBe(1);
  });

  it('a Free Subagent is one unit of the best tool fielded, respecting the cap', () => {
    const s = mkSim();
    const log = record(s);
    grab(s, 'free_subagent');
    expect(s.run.tools.grep).toBe(1); // nothing owned: tier 1
    s.run.tools.read = 3;
    grab(s, 'free_subagent');
    expect(s.run.tools.read).toBe(4);
    expect(log.filter((e) => e.t === 'buyTool').at(-1)).toEqual({ t: 'buyTool', id: 'read', cost: 0, owned: 4 });
    s.run.tools.read = TOOL_BY_ID.read.maxOwned;
    grab(s, 'free_subagent');
    expect(s.run.tools.read).toBe(TOOL_BY_ID.read.maxOwned);
    expect(s.run.tools.grep).toBe(2); // fell back to the best tool with room
  });

  it('forcePickup hovers where it was put and refuses unknown ids', () => {
    const s = mkSim();
    expect(s.debug.forcePickup('nope')).toBe(false);
    expect(s.debug.forcePickup('golden_token')).toBe(true);
    const p = s.run.pickup!;
    expect(p.vx).toBe(0);
    s.tick(1000);
    expect(s.run.pickup?.x).toBe(p.x);
    expect(s.collectPickup(s.run.pickup!.x, s.run.pickup!.baseY)).toBe(true);
  });

  it('a new prompt clears the stage and restarts the grace window', () => {
    const s = mkSim({ meta: metaWith({}) });
    s.debug.forcePickup('golden_token');
    s.run.tokens = 100;
    s.report();
    s.tick(BALANCE.REPORT_BEAT_MS + 1);
    s.pickCard(s.run.draftOffer[0]!);
    expect(s.run.pickup).toBeNull();
    expect(s.run.nextPickupInMs).toBe(PICKUP_TUNING.GRACE_MS);
  });
});
