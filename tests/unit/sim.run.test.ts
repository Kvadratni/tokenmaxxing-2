import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { BALANCE, FINAL_PROJECT_INDEX, projectAt } from '../../src/sim/content.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: Partial<Parameters<typeof createSim>[0]> = {}): Sim {
  return createSim({ seed: 20250806, storage: null, persist: false, ...over });
}

function record(sim: Sim): GameEvent[] {
  const log: GameEvent[] = [];
  sim.subscribe((e) => log.push(e));
  return log;
}

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

/** Ship the current project and run out the celebration beat. */
function shipAndSettle(sim: Sim): void {
  sim.run.slop = projectAt(sim.run.projectIndex).requirement;
  sim.ship();
  sim.tick(BALANCE.SHIP_BEAT_MS + 1);
}

describe('startRun', () => {
  it('opens on project 0 with a full deadline and a runStart event', () => {
    const s = mkSim({ autoStart: false });
    const log = record(s);
    s.startRun(99);

    expect(log).toEqual([{ t: 'runStart', seed: 99 }]);
    expect(s.run.seed).toBe(99);
    // The first incident roll has already advanced the cursor off the seed.
    expect(s.run.rngState).not.toBe(99);
    expect(s.run.phase).toBe('running');
    expect(s.run.projectIndex).toBe(0);
    expect(s.run.timeLeftMs).toBe(s.deadlineMs);
    expect(s.deadlineMs).toBe(BALANCE.DEADLINE_BASE_MS);
    expect(s.run.shipped).toBe(0);
    expect(s.run.pendingDemos).toBe(0);
  });

  it('respects the grace period before the first incident', () => {
    for (const seed of [1, 2, 3, 77, 12345]) {
      const s = mkSim({ seed });
      expect(s.run.nextIncidentInMs).toBeGreaterThanOrEqual(BALANCE.INCIDENT_GRACE_MS);
    }
  });

  it('wipes previous run progress', () => {
    const s = mkSim();
    s.run.slop = 5000;
    s.run.owned.push('mech_keyboard');
    s.run.cards.push('opus');
    s.buyAgent('tab_autocomplete', 3);
    s.startRun(5);
    expect(s.run.slop).toBe(0);
    expect(s.run.owned).toEqual([]);
    expect(s.run.cards).toEqual([]);
    expect(s.run.agents.tab_autocomplete).toBe(0);
  });

  it('derives a fresh but deterministic seed when none is given', () => {
    const a = mkSim();
    const b = mkSim();
    const firstA = a.run.seed;
    a.startRun();
    b.startRun();
    expect(a.run.seed).not.toBe(firstA);
    expect(a.run.seed).toBe(b.run.seed);
  });
});

describe('ship', () => {
  it('deducts the requirement and banks a pending Demo', () => {
    const s = mkSim();
    const log = record(s);
    const req = projectAt(0).requirement;
    s.run.slop = req + 37;

    expect(s.ship()).toBe(true);
    expect(BALANCE.SHIP_DEDUCTS).toBe(true);
    expect(s.run.slop).toBe(37);
    expect(s.run.shipped).toBe(1);
    expect(s.run.phase).toBe('shipped');
    expect(s.run.pendingDemos).toBeGreaterThan(0);
    expect(log.filter((e) => e.t === 'ship')).toHaveLength(1);
  });

  it('awards projectIndex + 1 Demos before the bonus', () => {
    const s = mkSim();
    s.run.timeLeftMs = 1; // no bonus
    s.run.slop = projectAt(0).requirement;
    s.ship();
    expect(s.run.pendingDemos).toBe(1);
  });

  it('grants the bonus Demo at exactly 25% time left', () => {
    const s = mkSim();
    expect(BALANCE.BONUS_DEMO_TIME_FRACTION).toBe(0.25);
    s.run.timeLeftMs = s.deadlineMs * BALANCE.BONUS_DEMO_TIME_FRACTION;
    s.run.slop = projectAt(0).requirement;
    expect(s.ship()).toBe(true);
    expect(s.run.pendingDemos).toBe(2);
  });

  it('withholds the bonus Demo one millisecond below the boundary', () => {
    const s = mkSim();
    s.run.timeLeftMs = s.deadlineMs * BALANCE.BONUS_DEMO_TIME_FRACTION - 1;
    s.run.slop = projectAt(0).requirement;
    expect(s.ship()).toBe(true);
    expect(s.run.pendingDemos).toBe(1);
  });

  it('applies demoMult from hype_machine', () => {
    const s = mkSim({ meta: metaWith({ hype_machine: 3 }) }); // demoMult 1.6
    s.run.timeLeftMs = s.deadlineMs; // bonus earned -> base 2
    s.run.slop = projectAt(0).requirement;
    s.ship();
    expect(s.run.pendingDemos).toBe(Math.round(2 * 1.6));
  });

  it('refuses when the wallet is short or the phase is wrong', () => {
    const s = mkSim();
    const log = record(s);
    s.run.slop = projectAt(0).requirement - 1;
    expect(s.ship()).toBe(false);
    expect(s.run.shipped).toBe(0);

    s.run.slop = projectAt(0).requirement;
    s.ship();
    expect(s.ship()).toBe(false); // already in the 'shipped' beat
    const reasons = log.filter((e) => e.t === 'denied').map((e) => (e.t === 'denied' ? e.reason : ''));
    expect(reasons).toEqual(['cost', 'phase']);
  });

  it('clears active incidents when the project ends', () => {
    const s = mkSim();
    s.run.incidents.push({ id: 'rate_limited', remainingMs: 8000, clicksRemaining: 0, startedAtMs: 0 });
    const log = record(s);
    s.run.slop = projectAt(0).requirement;
    s.ship();
    expect(s.run.incidents).toHaveLength(0);
    expect(log.some((e) => e.t === 'incidentEnd' && e.id === 'rate_limited')).toBe(true);
  });

  it('opens the draft after the ship beat and advances on pick', () => {
    const s = mkSim();
    const log = record(s);
    s.run.slop = projectAt(0).requirement;
    s.ship();

    s.tick(BALANCE.SHIP_BEAT_MS - 10);
    expect(s.run.phase).toBe('shipped');
    s.tick(20);
    expect(s.run.phase).toBe('drafting');
    expect(s.run.draftOffer).toHaveLength(BALANCE.DEFAULT_DRAFT_SIZE);
    expect(log.some((e) => e.t === 'draftOpen')).toBe(true);

    const pick = s.run.draftOffer[0];
    expect(pick).toBeDefined();
    expect(s.pickCard(pick as string)).toBe(true);
    expect(s.run.cards).toEqual([pick]);
    expect(s.run.phase).toBe('running');
    expect(s.run.projectIndex).toBe(1);
    expect(s.run.timeLeftMs).toBe(s.deadlineMs);
    expect(s.deadlineMs).toBeCloseTo(BALANCE.DEADLINE_BASE_MS * BALANCE.DEADLINE_DECAY, 6);
  });

  it('recomputes the deadline with deadlineMult at each project start', () => {
    const s = mkSim();
    shipAndSettle(s);
    // Force a known deadline card into the hand before advancing.
    s.run.cards.push('scope_negotiation'); // deadlineMult 1.25
    const pick = s.run.draftOffer[0] as string;
    s.pickCard(pick);
    const cardMult = 1.25;
    expect(s.deadlineMs).toBeGreaterThan(BALANCE.DEADLINE_BASE_MS * BALANCE.DEADLINE_DECAY);
    expect(s.deadlineMs / (BALANCE.DEADLINE_BASE_MS * Math.pow(BALANCE.DEADLINE_DECAY, 1))).toBeCloseTo(
      cardMult * (s.run.cards.includes('technical_debt') ? 0.85 : 1) *
        (s.run.cards.includes('ship_it_friday') ? 0.9 : 1) *
        (s.run.cards.includes('crunch_time') ? 0.8 : 1),
      6,
    );
  });
});

describe('winning', () => {
  it('reaching the final project ends the run as a win', () => {
    const s = mkSim();
    const log = record(s);
    s.run.projectIndex = FINAL_PROJECT_INDEX;
    s.run.slop = projectAt(FINAL_PROJECT_INDEX).requirement;
    s.ship();
    s.tick(BALANCE.SHIP_BEAT_MS + 1);

    expect(s.run.phase).toBe('won');
    const over = log.filter((e) => e.t === 'runOver');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ t: 'runOver', won: true, shipped: 1 });
    expect(s.meta.wins).toBe(1);
    expect(s.meta.runs).toBe(1);
  });

  it('endless_mode keeps drafting past the final project', () => {
    const s = mkSim({ meta: metaWith({ endless_mode: 1 }) });
    s.run.projectIndex = FINAL_PROJECT_INDEX;
    s.run.slop = projectAt(FINAL_PROJECT_INDEX).requirement;
    s.ship();
    s.tick(BALANCE.SHIP_BEAT_MS + 1);
    expect(s.run.phase).toBe('drafting');

    s.pickCard(s.run.draftOffer[0] as string);
    expect(s.run.phase).toBe('running');
    expect(s.run.projectIndex).toBe(FINAL_PROJECT_INDEX + 1);
    expect(projectAt(s.run.projectIndex).name).toContain('Rewrite Twitter Again');
  });
});

describe('losing', () => {
  it('deadline expiry sets lost and emits runOver exactly once', () => {
    const s = mkSim();
    const log = record(s);
    for (let i = 0; i < 200; i++) s.tick(BALANCE.MAX_CATCHUP_MS);

    expect(s.run.phase).toBe('lost');
    expect(s.run.timeLeftMs).toBe(0);
    expect(log.filter((e) => e.t === 'runOver')).toHaveLength(1);
    expect(log.find((e) => e.t === 'runOver')).toMatchObject({ won: false, shipped: 0 });
    expect(s.meta.runs).toBe(1);
    expect(s.meta.wins).toBe(0);
  });

  it('a lost run stops accumulating anything', () => {
    const s = mkSim();
    s.run.slop = 1e9;
    s.buyAgent('tab_autocomplete', 5);
    for (let i = 0; i < 200; i++) s.tick(BALANCE.MAX_CATCHUP_MS);
    const frozen = JSON.stringify(s.run);
    for (let i = 0; i < 20; i++) {
      s.tick(1000);
      s.click(10, 10);
    }
    expect(JSON.stringify(s.run)).toBe(frozen);
  });

  it('emits deadlineWarn once per second inside the warning window', () => {
    const s = mkSim();
    s.run.timeLeftMs = BALANCE.WARN_AT_SECONDS * 1000 + 500;
    const log = record(s);
    for (let i = 0; i < 40; i++) s.tick(500);

    const warns = log.filter((e) => e.t === 'deadlineWarn');
    const seconds = warns.map((e) => (e.t === 'deadlineWarn' ? e.secondsLeft : -1));
    expect(seconds).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe('endRun', () => {
  it('banks pendingDemos into meta and is idempotent', () => {
    const s = mkSim();
    const log = record(s);
    s.run.slop = projectAt(0).requirement;
    s.ship();
    const pending = s.run.pendingDemos;
    expect(pending).toBeGreaterThan(0);
    expect(s.meta.demos).toBe(0); // banked only at run end

    s.endRun(false);
    expect(s.meta.demos).toBe(pending);
    expect(s.meta.totalDemosEarned).toBe(pending);
    expect(s.meta.runs).toBe(1);
    expect(s.meta.bestProject).toBe(0);
    expect(s.run.phase).toBe('lost');

    s.endRun(false);
    s.endRun(true);
    expect(s.meta.demos).toBe(pending);
    expect(s.meta.runs).toBe(1);
    expect(log.filter((e) => e.t === 'runOver')).toHaveLength(1);
  });

  it('records the highest project index shipped', () => {
    const s = mkSim();
    for (let i = 0; i < 3; i++) {
      shipAndSettle(s);
      if (s.run.phase === 'drafting') s.pickCard(s.run.draftOffer[0] as string);
    }
    expect(s.run.shipped).toBe(3);
    s.endRun(false);
    expect(s.meta.bestProject).toBe(2);
  });

  it('persists meta through the configured storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const s = createSim({ seed: 3, storage });
    s.run.slop = projectAt(0).requirement;
    s.ship();
    s.endRun(false);
    expect(store.size).toBe(1);
    const raw = store.get('tokenmaxxing2.save.v1');
    expect(raw).toBeDefined();
    expect(JSON.parse(raw as string).demos).toBe(s.meta.demos);
  });
});

describe('click', () => {
  it('adds clickPower to the wallet and emits a click event', () => {
    const s = mkSim();
    const log = record(s);
    const power = s.derived().clickPower;
    const gained = s.click(160, 90);

    expect(gained === power || gained === power * BALANCE.CRIT_MULT).toBe(true);
    expect(s.run.slop).toBeCloseTo(gained, 10);
    expect(s.run.slopEarned).toBeCloseTo(gained, 10);
    expect(s.run.clicks).toBe(1);
    const clicks = log.filter((e) => e.t === 'click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ t: 'click', x: 160, y: 90, amount: gained });
  });

  it('crits multiply by CRIT_MULT and appear at roughly CRIT_CHANCE', () => {
    const s = mkSim({ seed: 991 });
    const log = record(s);
    const power = s.derived().clickPower;

    for (let i = 0; i < 4000; i++) s.click(1, 1);
    const clicks = log.filter((e): e is Extract<GameEvent, { t: 'click' }> => e.t === 'click');
    const crits = clicks.filter((c) => c.crit);
    expect(crits.length).toBeGreaterThan(0);
    for (const c of clicks) {
      expect(c.amount).toBeCloseTo(c.crit ? power * BALANCE.CRIT_MULT : power, 10);
    }
    const rate = crits.length / clicks.length;
    expect(rate).toBeGreaterThan(BALANCE.CRIT_CHANCE * 0.5);
    expect(rate).toBeLessThan(BALANCE.CRIT_CHANCE * 2);
  });

  it('returns 0 and denies outside the running phase', () => {
    const s = mkSim();
    const log = record(s);
    s.run.phase = 'drafting';
    expect(s.click(1, 1)).toBe(0);
    expect(s.run.clicks).toBe(0);
    expect(log).toEqual([{ t: 'denied', reason: 'phase' }]);
  });
});

describe('events', () => {
  it('subscribe returns a working unsubscribe', () => {
    const s = mkSim();
    const seen: GameEvent[] = [];
    const off = s.subscribe((e) => seen.push(e));
    s.click(1, 1);
    expect(seen).toHaveLength(1);
    off();
    off(); // double-unsubscribe is a no-op
    s.click(1, 1);
    expect(seen).toHaveLength(1);
  });

  it('a throwing handler cannot wedge the sim or starve other handlers', () => {
    const s = mkSim();
    const seen: GameEvent[] = [];
    s.subscribe(() => {
      throw new Error('bad listener');
    });
    s.subscribe((e) => seen.push(e));

    expect(() => s.click(1, 1)).not.toThrow();
    expect(() => s.tick(1000)).not.toThrow();
    expect(seen.length).toBeGreaterThan(0);
    expect(s.run.clicks).toBe(1);
  });

  it('a handler that unsubscribes mid-dispatch does not disturb the others', () => {
    const s = mkSim();
    const seen: string[] = [];
    const off = s.subscribe(() => {
      seen.push('a');
      off();
    });
    s.subscribe(() => seen.push('b'));
    s.click(1, 1);
    s.click(1, 1);
    expect(seen).toEqual(['a', 'b', 'b']);
  });

  it('emits every member of the GameEvent union', () => {
    const s = mkSim({ meta: metaWith({ reroll_token: 1 }) });
    const seen = new Set<GameEvent['t']>();
    s.subscribe((e) => seen.add(e.t));

    s.startRun(11); // runStart
    s.click(1, 1); // click
    s.buyUpgrade('not_a_real_upgrade'); // denied
    s.run.slop = 1e6;
    s.buyAgent('tab_autocomplete', 1); // buyAgent
    s.buyUpgrade('mech_keyboard'); // buyUpgrade

    // incidentProgress + incidentEnd via a click-cleared incident
    s.run.incidents.push({
      id: 'merge_conflict',
      remainingMs: 15_000,
      clicksRemaining: 2,
      startedAtMs: 0,
    });
    s.click(1, 1);
    s.click(1, 1);

    // incidentStart by forcing the scheduler due
    s.run.nextIncidentInMs = 1;
    s.tick(10);

    // deadlineWarn
    s.run.timeLeftMs = 3000;
    s.tick(1000);

    // ship -> draftOpen -> draftReroll -> draftPick
    s.run.timeLeftMs = 60_000;
    s.run.slop = projectAt(s.run.projectIndex).requirement;
    s.ship();
    s.tick(BALANCE.SHIP_BEAT_MS + 1);
    s.rerollDraft();
    s.pickCard(s.run.draftOffer[0] as string);

    s.meta.demos = 100;
    s.buyMeta('cracked'); // metaBuy
    s.endRun(false); // runOver

    expect([...seen].sort()).toEqual(
      [
        // Shipping the first project earns Hello World, so `achievement` fires
        // as a side effect of this script rather than needing its own beat.
        'achievement',
        'buyAgent',
        'buyUpgrade',
        'click',
        'deadlineWarn',
        'denied',
        'draftOpen',
        'draftPick',
        'draftReroll',
        'incidentEnd',
        'incidentProgress',
        'incidentStart',
        'metaBuy',
        'runOver',
        'runStart',
        'ship',
      ].sort(),
    );
  });

  it('opts.onEvent receives the runStart of the very first run', () => {
    const seen: GameEvent[] = [];
    createSim({ seed: 8, storage: null, persist: false, onEvent: (e) => seen.push(e) });
    expect(seen).toEqual([{ t: 'runStart', seed: 8 }]);
  });
});
