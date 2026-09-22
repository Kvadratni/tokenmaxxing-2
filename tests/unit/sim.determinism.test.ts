import { describe, expect, it } from 'vitest';
import type { AgentTierId, DerivedStats, GameEvent, MetaState, RunState } from '../../src/sim/types.ts';
import { AGENT_TIER_IDS, BALANCE, projectAt } from '../../src/sim/content.ts';
import { createRng, hash32, normalizeSeed, standaloneRng } from '../../src/sim/rng.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

function mkSim(seed: number, levels: Record<string, number> = {}): Sim {
  return createSim({ seed, storage: null, persist: false, meta: metaWith(levels) });
}

/**
 * A 2000-step input script. Every decision comes from its own seeded stream, so
 * two sims fed the same script receive byte-identical input.
 */
function runScript(sim: Sim, steps: number, scriptSeed = 555): GameEvent[] {
  const r = standaloneRng(scriptSeed);
  const log: GameEvent[] = [];
  sim.subscribe((e) => log.push(e));

  for (let i = 0; i < steps; i++) {
    sim.tick(8 + r.nextInt(300));
    const roll = r.nextFloat();
    if (roll < 0.55) sim.click(r.nextInt(320), r.nextInt(180));
    if (roll > 0.9) sim.click(r.nextInt(320), r.nextInt(180));

    const action = r.nextFloat();
    if (action < 0.14) {
      const tier = AGENT_TIER_IDS[r.nextInt(AGENT_TIER_IDS.length)] as AgentTierId;
      sim.buyAgent(tier, r.nextFloat() < 0.3 ? 10 : 1);
    } else if (action < 0.18) {
      const up = sim.availableUpgrades()[0];
      if (up) sim.buyUpgrade(up.id);
    } else if (action < 0.22) {
      const tier = AGENT_TIER_IDS[r.nextInt(3)] as AgentTierId;
      sim.buyAgent(tier, Number.POSITIVE_INFINITY);
    }

    if (r.nextFloat() < 0.08) sim.ship();

    if (sim.run.phase === 'drafting') {
      if (sim.run.draftRerollsLeft > 0 && r.nextFloat() < 0.4) sim.rerollDraft();
      const pick = sim.run.draftOffer[r.nextInt(sim.run.draftOffer.length)];
      if (pick) sim.pickCard(pick);
    }
    // Let runs end on their own terms, then immediately start the next one.
    if (sim.run.phase === 'lost' || sim.run.phase === 'won') sim.startRun();
  }
  return log;
}

function countEvents(log: GameEvent[], t: GameEvent['t']): number {
  return log.filter((e) => e.t === t).length;
}

describe('RNG', () => {
  it('is reproducible from a seed', () => {
    const a = standaloneRng(12345);
    const b = standaloneRng(12345);
    for (let i = 0; i < 1000; i++) expect(a.nextFloat()).toBe(b.nextFloat());
  });

  it('stays in [0, 1) and never emits NaN', () => {
    const rng = standaloneRng(7);
    for (let i = 0; i < 50_000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('keeps its whole state in the holder, so the stream can be resumed', () => {
    const holder = { rngState: 999 };
    const rng = createRng(holder);
    const first = [rng.nextFloat(), rng.nextFloat(), rng.nextFloat()];
    const checkpoint = holder.rngState;
    const next = [rng.nextFloat(), rng.nextFloat()];

    holder.rngState = checkpoint;
    expect([rng.nextFloat(), rng.nextFloat()]).toEqual(next);
    expect(first).toHaveLength(3);
  });

  it('nextInt is uniform over the requested range', () => {
    const rng = standaloneRng(3);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const v = rng.nextInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(8000);
  });

  it('handles degenerate arguments', () => {
    const rng = standaloneRng(3);
    expect(rng.nextInt(0)).toBe(0);
    expect(rng.nextInt(-4)).toBe(0);
    expect(rng.nextInt(Number.NaN)).toBe(0);
    expect(rng.pick([])).toBeUndefined();
    expect(rng.nextRange(5, 5)).toBe(5);
    expect(rng.nextRange(Number.NaN, 1)).toBe(0);
    expect(rng.weightedPick([], () => 1)).toBeUndefined();
    expect(rng.weightedPick(['a', 'b'], () => 0)).toBeUndefined();
    expect(rng.weightedPick(['a'], () => Number.NaN)).toBeUndefined();
    expect(rng.shuffled([])).toEqual([]);
  });

  it('weightedPick honours the weights', () => {
    const rng = standaloneRng(11);
    let heavy = 0;
    for (let i = 0; i < 20_000; i++) {
      if (rng.weightedPick(['heavy', 'light'], (v) => (v === 'heavy' ? 9 : 1)) === 'heavy') heavy += 1;
    }
    expect(heavy / 20_000).toBeCloseTo(0.9, 1);
  });

  it('shuffled is a permutation and is seed-stable', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = standaloneRng(42).shuffled(input);
    const b = standaloneRng(42).shuffled(input);
    expect(a).toEqual(b);
    expect(a.slice().sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // not mutated
  });

  it('normalizeSeed and hash32 coerce anything to a usable int32', () => {
    expect(normalizeSeed(Number.NaN)).toBe(1);
    expect(normalizeSeed(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeSeed(0)).toBe(1);
    expect(normalizeSeed(7.9)).toBe(7);
    expect(Number.isInteger(hash32(123))).toBe(true);
    expect(hash32(123)).toBe(hash32(123));
    expect(hash32(123)).not.toBe(hash32(124));
  });
});

describe('determinism', () => {
  it('two sims, same seed, same 2000-step script, identical state', () => {
    const a = mkSim(987654);
    const b = mkSim(987654);
    const la = runScript(a, 2000);
    runScript(b, 2000);

    expect(a.run).toEqual(b.run);
    expect(JSON.stringify(a.run)).toBe(JSON.stringify(b.run));
    expect(a.derived()).toEqual(b.derived());
    expect(a.meta).toEqual(b.meta);
    expect(a.deadlineMs).toBe(b.deadlineMs);

    // Sanity: the script actually exercised the whole machine.
    expect(countEvents(la, 'click')).toBeGreaterThan(500);
    expect(countEvents(la, 'buyAgent')).toBeGreaterThan(0);
    expect(countEvents(la, 'ship')).toBeGreaterThan(0);
    expect(countEvents(la, 'draftPick')).toBeGreaterThan(0);
    expect(countEvents(la, 'incidentStart')).toBeGreaterThan(0);
    expect(countEvents(la, 'incidentEnd')).toBeGreaterThan(0);
    expect(countEvents(la, 'denied')).toBeGreaterThan(0);
    expect(a.run.elapsedMs).toBeGreaterThan(0);

    // Banking at run end must land on the same numbers too.
    a.endRun(false);
    b.endRun(false);
    expect(a.meta).toEqual(b.meta);
    expect(a.meta.runs).toBeGreaterThan(0);
    expect(a.meta.totalDemosEarned).toBeGreaterThan(0);
    expect(a.run).toEqual(b.run);
  });

  it('emits an identical event stream', () => {
    const a = mkSim(31415);
    const b = mkSim(31415);
    const ea = runScript(a, 1200);
    const eb = runScript(b, 1200);
    expect(ea.length).toBeGreaterThan(500);
    expect(ea).toEqual(eb);
  });

  it('is identical with meta upgrades in play', () => {
    const levels = {
      seed_funding: 4,
      cracked: 5,
      founder_mode: 3,
      scope_negotiator: 2,
      incubator: 3,
      prompt_library: 1,
      reroll_token: 2,
      technical_cofounder: 2,
      hype_machine: 2,
      endless_mode: 1,
    };
    const a = mkSim(2718, levels);
    const b = mkSim(2718, levels);
    runScript(a, 2000, 909);
    runScript(b, 2000, 909);
    expect(a.run).toEqual(b.run);
    expect(a.meta).toEqual(b.meta);
  });

  it('different seeds diverge', () => {
    const a = mkSim(1);
    const b = mkSim(2);
    runScript(a, 600);
    runScript(b, 600);
    expect(JSON.stringify(a.run)).not.toBe(JSON.stringify(b.run));
  });

  it('restarting with an explicit seed reproduces the opening state', () => {
    const s = mkSim(1);
    s.startRun(4242);
    const opening = JSON.stringify(s.run);
    runScript(s, 200);
    s.startRun(4242);
    expect(JSON.stringify(s.run)).toBe(opening);
  });
});

describe('tick robustness', () => {
  it('clamps a single huge tick to MAX_CATCHUP_MS of production', () => {
    const s = mkSim(1);
    s.run.slop = 1e9;
    s.buyAgent('tab_autocomplete', 25);
    const rate = s.derived().idleRate;
    expect(rate).toBeGreaterThan(0);

    const slopBefore = s.run.slop;
    const timeBefore = s.run.timeLeftMs;
    s.tick(60_000);

    const gained = s.run.slop - slopBefore;
    expect(gained).toBeCloseTo(rate * (BALANCE.MAX_CATCHUP_MS / 1000), 6);
    expect(gained).toBeLessThan(rate * 3);
    expect(timeBefore - s.run.timeLeftMs).toBeCloseTo(BALANCE.MAX_CATCHUP_MS, 6);
    expect(s.run.elapsedMs).toBeCloseTo(BALANCE.MAX_CATCHUP_MS, 6);
  });

  it('integrates in sub-steps no larger than MAX_STEP_MS', () => {
    const s = mkSim(1);
    let maxSeen = 0;
    let last = s.run.elapsedMs;
    // Watch elapsed advance through a single catch-up tick.
    s.subscribe(() => {
      maxSeen = Math.max(maxSeen, s.run.elapsedMs - last);
      last = s.run.elapsedMs;
    });
    s.tick(BALANCE.MAX_CATCHUP_MS);
    expect(s.run.elapsedMs).toBeCloseTo(BALANCE.MAX_CATCHUP_MS, 6);
    expect(maxSeen).toBeLessThanOrEqual(BALANCE.MAX_STEP_MS + 1e-6);
  });

  it('a stalled tab cannot skip past an incident window', () => {
    const s = mkSim(1);
    s.run.incidents.push({ id: 'prod_outage', remainingMs: 200, clicksRemaining: 0, startedAtMs: 0 });
    let ended = 0;
    s.subscribe((e) => {
      if (e.t === 'incidentEnd') ended += 1;
    });
    s.tick(60_000);
    expect(ended).toBe(1);
    expect(s.run.incidents.some((i) => i.id === 'prod_outage')).toBe(false);
  });

  it('ignores non-positive and non-finite dt', () => {
    const s = mkSim(1);
    const before = JSON.stringify(s.run);
    s.tick(0);
    s.tick(-1000);
    s.tick(Number.NaN);
    s.tick(Number.POSITIVE_INFINITY);
    expect(JSON.stringify(s.run)).toBe(before);
  });

  it('many small ticks match one clamped tick of the same total', () => {
    const many = mkSim(1);
    const one = mkSim(1);
    for (const s of [many, one]) {
      s.run.slop = 1e6;
      s.buyAgent('tab_autocomplete', 10);
    }
    for (let i = 0; i < 8; i++) many.tick(250);
    one.tick(BALANCE.MAX_CATCHUP_MS);
    expect(many.run.slop).toBeCloseTo(one.run.slop, 6);
    expect(many.run.timeLeftMs).toBeCloseTo(one.run.timeLeftMs, 6);
  });
});

describe('numeric hygiene', () => {
  const NUMERIC_RUN_KEYS: (keyof RunState)[] = [
    'slop',
    'projectIndex',
    'timeLeftMs',
    'elapsedMs',
    'nextIncidentInMs',
    'clicks',
    'slopEarned',
    'slopSpent',
    'shipped',
    'pendingDemos',
    'rngState',
    'seed',
    'draftRerollsLeft',
  ];

  function assertRunFinite(run: RunState): void {
    for (const key of NUMERIC_RUN_KEYS) {
      const v = run[key] as number;
      expect(Number.isFinite(v), `run.${String(key)} = ${v}`).toBe(true);
    }
    for (const id of AGENT_TIER_IDS) {
      expect(Number.isFinite(run.agents[id]), `agents.${id}`).toBe(true);
      expect(run.agents[id]).toBeGreaterThanOrEqual(0);
    }
    for (const inc of run.incidents) {
      expect(Number.isFinite(inc.remainingMs) || inc.remainingMs === Infinity).toBe(true);
      expect(Number.isFinite(inc.clicksRemaining)).toBe(true);
      expect(Number.isFinite(inc.startedAtMs)).toBe(true);
    }
    expect(run.slop).toBeGreaterThanOrEqual(0);
    expect(run.timeLeftMs).toBeGreaterThanOrEqual(0);
  }

  function assertDerivedFinite(d: DerivedStats): void {
    const simple: (keyof DerivedStats)[] = [
      'clickPower',
      'idleRate',
      'requirement',
      'shipProgress',
      'deadlineProgress',
      'demosIfEndedNow',
      'incidentRateMult',
    ];
    for (const key of simple) {
      expect(Number.isFinite(d[key] as number), `derived.${String(key)}`).toBe(true);
    }
    for (const id of AGENT_TIER_IDS) {
      expect(Number.isFinite(d.tierRates[id]), `tierRates.${id}`).toBe(true);
      expect(Number.isFinite(d.nextCosts[id]), `nextCosts.${id}`).toBe(true);
    }
    for (const [k, v] of Object.entries(d.multipliers)) {
      expect(Number.isFinite(v), `multipliers.${k}`).toBe(true);
    }
    // etaSeconds is allowed to be Infinity — that is its documented "unreachable".
    expect(Number.isFinite(d.etaSeconds) || d.etaSeconds === Number.POSITIVE_INFINITY).toBe(true);
    expect(d.shipProgress).toBeGreaterThanOrEqual(0);
    expect(d.shipProgress).toBeLessThanOrEqual(1);
    expect(d.deadlineProgress).toBeGreaterThanOrEqual(0);
    expect(d.deadlineProgress).toBeLessThanOrEqual(1);
  }

  it('a long randomized fuzz run keeps every numeric field finite', () => {
    for (const seed of [1, 2, 3, 101, 65535]) {
      const s = mkSim(seed, { endless_mode: 1, seed_funding: 5, cracked: 6, founder_mode: 6 });
      const r = standaloneRng(seed * 7 + 1);
      for (let i = 0; i < 1500; i++) {
        s.tick(r.nextRange(1, 400));
        if (r.nextFloat() < 0.7) s.click(r.nextInt(320), r.nextInt(180));
        if (r.nextFloat() < 0.2) {
          const tier = AGENT_TIER_IDS[r.nextInt(AGENT_TIER_IDS.length)] as AgentTierId;
          s.buyAgent(tier, r.nextFloat() < 0.5 ? Number.POSITIVE_INFINITY : 10);
        }
        if (r.nextFloat() < 0.1) {
          const up = s.availableUpgrades()[r.nextInt(s.availableUpgrades().length)];
          if (up) s.buyUpgrade(up.id);
        }
        if (r.nextFloat() < 0.2) s.ship();
        if (s.run.phase === 'drafting') {
          const pick = s.run.draftOffer[r.nextInt(s.run.draftOffer.length)];
          if (pick) s.pickCard(pick);
        }
        if (s.run.phase === 'lost' || s.run.phase === 'won') s.startRun();
        if (i % 37 === 0) {
          assertRunFinite(s.run);
          assertDerivedFinite(s.derived());
        }
      }
      assertRunFinite(s.run);
      assertDerivedFinite(s.derived());
      expect(Number.isFinite(s.meta.demos)).toBe(true);
      expect(Number.isFinite(s.meta.totalDemosEarned)).toBe(true);
    }
  });

  it('survives an absurdly deep project index without NaN', () => {
    const s = mkSim(9, { endless_mode: 1 });
    s.run.projectIndex = 40;
    s.run.slop = projectAt(40).requirement;
    expect(Number.isFinite(s.derived().requirement)).toBe(true);
    assertDerivedFinite(s.derived());
    s.ship();
    s.tick(BALANCE.SHIP_BEAT_MS + 1);
    assertRunFinite(s.run);
  });

  it('a hand full of every card still produces finite stats', () => {
    const s = mkSim(9);
    s.run.slop = 1e12;
    for (const id of AGENT_TIER_IDS) s.run.agents[id] = 500;
    s.run.owned.push(...s.availableUpgrades().map((u) => u.id));
    assertDerivedFinite(s.derived());
    expect(s.derived().idleRate).toBeGreaterThan(0);
  });
});
