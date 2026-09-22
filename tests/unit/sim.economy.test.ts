import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { AGENT_BY_ID, META_BY_ID, META_CURVES, UPGRADE_BY_ID } from '../../src/sim/content.ts';
import { agentCostAt, bulkAgentCost } from '../../src/sim/derive.ts';
import { defaultMeta, metaNextCost } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: Partial<Parameters<typeof createSim>[0]> = {}): Sim {
  return createSim({ seed: 4242, storage: null, persist: false, ...over });
}

function record(sim: Sim): GameEvent[] {
  const log: GameEvent[] = [];
  sim.subscribe((e) => log.push(e));
  return log;
}

function metaWith(levels: Record<string, number>, demos = 0): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  m.demos = demos;
  return m;
}

const TIER = AGENT_BY_ID.tab_autocomplete;

describe('agent cost curve', () => {
  it('cost(id, owned) = round(baseCost * costGrowth^owned * agentCostMult)', () => {
    for (let owned = 0; owned < 25; owned++) {
      expect(agentCostAt(TIER, owned, 1)).toBe(
        Math.round(TIER.baseCost * Math.pow(TIER.costGrowth, owned)),
      );
      expect(agentCostAt(TIER, owned, 0.85)).toBe(
        Math.round(TIER.baseCost * Math.pow(TIER.costGrowth, owned) * 0.85),
      );
    }
  });

  it('derived().nextCosts matches the formula for the live agentCostMult', () => {
    const s = mkSim();
    s.run.slop = 1e9;
    s.buyAgent('tab_autocomplete', 7);
    s.run.owned.push('prompt_caching'); // agentCostMult 0.85
    expect(s.derived().nextCosts.tab_autocomplete).toBe(
      Math.round(TIER.baseCost * Math.pow(TIER.costGrowth, 7) * 0.85),
    );
  });

  it('bulk quote is the sum of the rounded per-unit costs', () => {
    const quote = bulkAgentCost(TIER, 0, 10, 1);
    let manual = 0;
    for (let i = 0; i < 10; i++) manual += agentCostAt(TIER, i, 1);
    expect(quote.count).toBe(10);
    expect(quote.total).toBe(manual);
  });
});

describe('buyAgent', () => {
  it('a bulk buy of 10 costs exactly what ten single buys cost', () => {
    const bulk = mkSim();
    const single = mkSim();
    bulk.run.slop = 1_000_000;
    single.run.slop = 1_000_000;

    expect(bulk.buyAgent('tab_autocomplete', 10)).toBe(true);
    for (let i = 0; i < 10; i++) expect(single.buyAgent('tab_autocomplete', 1)).toBe(true);

    expect(bulk.run.agents.tab_autocomplete).toBe(10);
    expect(single.run.agents.tab_autocomplete).toBe(10);
    expect(bulk.run.slop).toBe(single.run.slop);
    expect(bulk.run.slopSpent).toBe(single.run.slopSpent);
    expect(bulk.derived().nextCosts.tab_autocomplete).toBe(
      single.derived().nextCosts.tab_autocomplete,
    );
  });

  it('is atomic — an unaffordable bulk buy changes nothing', () => {
    const s = mkSim();
    const log = record(s);
    const oneCost = agentCostAt(TIER, 0, 1);
    s.run.slop = oneCost; // enough for exactly one

    const before = JSON.stringify(s.run);
    expect(s.buyAgent('tab_autocomplete', 10)).toBe(false);
    expect(JSON.stringify(s.run)).toBe(before);
    expect(s.run.agents.tab_autocomplete).toBe(0);
    expect(s.run.slop).toBe(oneCost);
    expect(log.filter((e) => e.t === 'denied')).toHaveLength(1);
    expect(log.find((e) => e.t === 'denied')).toEqual({ t: 'denied', reason: 'cost' });
    expect(log.some((e) => e.t === 'buyAgent')).toBe(false);
  });

  it('count: Infinity buys the maximum affordable and no more', () => {
    const s = mkSim();
    s.run.slop = 1000;
    expect(s.buyAgent('tab_autocomplete', Number.POSITIVE_INFINITY)).toBe(true);

    const owned = s.run.agents.tab_autocomplete;
    expect(owned).toBeGreaterThan(0);
    expect(s.run.slop).toBeGreaterThanOrEqual(0);
    // Either the wallet ran out or the tier hit its ceiling — never both wrong.
    if (owned < TIER.maxOwned) {
      expect(s.run.slop).toBeLessThan(agentCostAt(TIER, owned, 1));
    }
    expect(s.run.slop + s.run.slopSpent).toBe(1000);
  });

  it('never buys past the per-tier ceiling, however much slop is on hand', () => {
    const s = mkSim();
    s.run.slop = 1e15;
    s.buyAgent('tab_autocomplete', Number.POSITIVE_INFINITY);
    expect(s.run.agents.tab_autocomplete).toBe(TIER.maxOwned);
    // A further purchase is refused outright rather than silently no-oping.
    const before = s.run.slop;
    expect(s.buyAgent('tab_autocomplete', 1)).toBe(false);
    expect(s.run.slop).toBe(before);
    expect(s.derived().headroom.tab_autocomplete).toBe(0);
  });

  it('a bulk buy that overshoots the ceiling is clamped, not rejected', () => {
    const s = mkSim();
    s.run.slop = 1e15;
    s.buyAgent('tab_autocomplete', TIER.maxOwned - 3);
    expect(s.buyAgent('tab_autocomplete', 10)).toBe(true);
    expect(s.run.agents.tab_autocomplete).toBe(TIER.maxOwned);
  });

  it('emits one buyAgent event carrying the batch total and new owned count', () => {
    const s = mkSim();
    const log = record(s);
    s.run.slop = 1e6;
    s.buyAgent('tab_autocomplete', 3);
    const buys = log.filter((e) => e.t === 'buyAgent');
    expect(buys).toHaveLength(1);
    expect(buys[0]).toEqual({
      t: 'buyAgent',
      id: 'tab_autocomplete',
      cost: bulkAgentCost(TIER, 0, 3, 1).total,
      owned: 3,
    });
  });

  it('refuses tiers that are not revealed yet', () => {
    const s = mkSim();
    const log = record(s);
    s.run.slop = 1e12;
    expect(s.visibleTiers().map((t) => t.id)).toEqual(['tab_autocomplete']);
    expect(s.buyAgent('agentic_ide', 1)).toBe(false);
    expect(log.some((e) => e.t === 'denied' && e.reason === 'locked')).toBe(true);
  });

  it('reveals the next tier once the previous one is owned', () => {
    const s = mkSim();
    s.run.slop = 1e12;
    s.buyAgent('tab_autocomplete', 1);
    expect(s.visibleTiers().map((t) => t.id)).toEqual(['tab_autocomplete', 'copy_paste_chatbot']);
    expect(s.buyAgent('copy_paste_chatbot', 1)).toBe(true);
    expect(s.visibleTiers()).toHaveLength(3);
  });

  it('rejects zero, negative and NaN counts without side effects', () => {
    const s = mkSim();
    s.run.slop = 1e6;
    const before = JSON.stringify(s.run);
    expect(s.buyAgent('tab_autocomplete', 0)).toBe(false);
    expect(s.buyAgent('tab_autocomplete', -5)).toBe(false);
    expect(s.buyAgent('tab_autocomplete', Number.NaN)).toBe(false);
    expect(JSON.stringify(s.run)).toBe(before);
  });

  it('honours agentCostMult from cards when charging', () => {
    const plain = mkSim();
    const cheap = mkSim();
    plain.run.slop = 1e6;
    cheap.run.slop = 1e6;
    cheap.run.cards.push('haiku'); // agentCostMult 0.4

    plain.buyAgent('tab_autocomplete', 5);
    cheap.buyAgent('tab_autocomplete', 5);
    expect(cheap.run.slopSpent).toBe(bulkAgentCost(TIER, 0, 5, 0.4).total);
    expect(cheap.run.slopSpent).toBeLessThan(plain.run.slopSpent);
  });

  it('blocks purchases outside the running phase', () => {
    const s = mkSim();
    const log = record(s);
    s.run.slop = 1e9;
    s.run.phase = 'drafting';
    expect(s.buyAgent('tab_autocomplete', 1)).toBe(false);
    expect(log.some((e) => e.t === 'denied' && e.reason === 'phase')).toBe(true);
  });
});

describe('buyUpgrade', () => {
  it('charges the listed cost once and records ownership', () => {
    const s = mkSim();
    const log = record(s);
    const def = UPGRADE_BY_ID['mech_keyboard'];
    expect(def).toBeDefined();
    s.run.slop = 1000;
    expect(s.buyUpgrade('mech_keyboard')).toBe(true);
    expect(s.run.slop).toBe(1000 - (def?.cost ?? 0));
    expect(s.run.slopSpent).toBe(def?.cost);
    expect(s.run.owned).toEqual(['mech_keyboard']);
    expect(log.filter((e) => e.t === 'buyUpgrade')).toHaveLength(1);

    // Second purchase of the same upgrade is refused.
    expect(s.buyUpgrade('mech_keyboard')).toBe(false);
    expect(s.run.owned).toEqual(['mech_keyboard']);
  });

  it('refuses unknown ids, unmet requirements and insufficient slop', () => {
    const s = mkSim();
    const log = record(s);
    s.run.slop = 1e9;
    expect(s.buyUpgrade('not_a_real_upgrade')).toBe(false);
    expect(s.buyUpgrade('vim_motions')).toBe(false); // requires mech_keyboard
    s.run.slop = 1;
    expect(s.buyUpgrade('mech_keyboard')).toBe(false);
    const reasons = log.filter((e) => e.t === 'denied').map((e) => (e.t === 'denied' ? e.reason : ''));
    expect(reasons).toEqual(['locked', 'locked', 'cost']);
  });

  it('availableUpgrades hides owned and locked entries', () => {
    const s = mkSim();
    const initial = s.availableUpgrades().map((u) => u.id);
    expect(initial).toContain('mech_keyboard');
    expect(initial).not.toContain('vim_motions');

    s.run.slop = 1e9;
    s.buyUpgrade('mech_keyboard');
    const next = s.availableUpgrades().map((u) => u.id);
    expect(next).not.toContain('mech_keyboard');
    expect(next).toContain('vim_motions');
  });

  it('respects agent-count requirements', () => {
    const s = mkSim();
    s.run.slop = 1e9;
    expect(s.availableUpgrades().map((u) => u.id)).not.toContain('muscle_memory');
    s.buyAgent('tab_autocomplete', 10);
    expect(s.availableUpgrades().map((u) => u.id)).toContain('muscle_memory');
  });
});

describe('buyMeta', () => {
  it('deducts demos, raises the level, persists and emits metaBuy', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const s = createSim({ seed: 1, storage, meta: metaWith({}, 10) });
    const log = record(s);

    const cost = metaNextCost(s.meta, 'cracked');
    expect(cost).toBe(META_BY_ID['cracked']?.costs[0]);
    expect(s.buyMeta('cracked')).toBe(true);
    expect(s.meta.levels['cracked']).toBe(1);
    expect(s.meta.demos).toBe(10 - cost);
    expect(log.filter((e) => e.t === 'metaBuy')).toHaveLength(1);
    expect(log.find((e) => e.t === 'metaBuy')).toEqual({ t: 'metaBuy', id: 'cracked', level: 1, cost });
    expect(store.size).toBe(1);
  });

  it('refuses when demos are short', () => {
    const s = mkSim({ meta: metaWith({}, 1) });
    const log = record(s);
    expect(s.buyMeta('cracked')).toBe(false);
    expect(s.meta.levels['cracked']).toBe(0);
    // `demos`, not `cost`: a shared reason made the shop report "not enough slop".
    expect(log.some((e) => e.t === 'denied' && e.reason === 'demos')).toBe(true);
    expect(log.some((e) => e.t === 'denied' && e.reason === 'cost')).toBe(false);
  });

  it('refuses past maxLevel and for unknown ids', () => {
    const s = mkSim({ meta: metaWith({ prompt_library: 1 }, 9999) });
    const log = record(s);
    expect(s.buyMeta('prompt_library')).toBe(false);
    expect(s.buyMeta('nope')).toBe(false);
    expect(log.filter((e) => e.t === 'denied' && e.reason === 'locked')).toHaveLength(2);
    expect(metaNextCost(s.meta, 'prompt_library')).toBe(Number.POSITIVE_INFINITY);
  });

  it('walks a full upgrade ladder level by level', () => {
    const s = mkSim({ meta: metaWith({}, 9999) });
    const def = META_BY_ID['cracked'];
    expect(def).toBeDefined();
    let spent = 0;
    for (let l = 0; l < (def?.maxLevel ?? 0); l++) {
      spent += def?.costs[l] ?? 0;
      expect(s.buyMeta('cracked')).toBe(true);
      expect(s.meta.levels['cracked']).toBe(l + 1);
    }
    expect(s.buyMeta('cracked')).toBe(false);
    expect(s.meta.demos).toBe(9999 - spent);
  });
});

describe('meta effects reach a live run', () => {
  it('seed_funding and incubator seed the opening state', () => {
    const s = mkSim({ meta: metaWith({ seed_funding: 3, incubator: 2 }) });
    expect(s.run.slop).toBe(960);
    expect(s.run.agents.tab_autocomplete).toBe(6);
    expect(s.derived().idleRate).toBeGreaterThan(0);
  });

  it('scope_negotiator lengthens the opening deadline', () => {
    const plain = mkSim();
    const scoped = mkSim({ meta: metaWith({ scope_negotiator: 4 }) });
    // Read the multiplier out of content: the curve is a balance dial.
    const mult = META_CURVES.SCOPE_NEGOTIATOR[3] ?? 1;
    expect(scoped.deadlineMs).toBeCloseTo(plain.deadlineMs * mult, 6);
    expect(scoped.run.timeLeftMs).toBe(scoped.deadlineMs);
  });

  it('reroll_token seeds draftRerollsLeft at run start', () => {
    const s = mkSim({ meta: metaWith({ reroll_token: 2 }) });
    expect(s.run.draftRerollsLeft).toBe(2);
  });

  it('technical_cofounder discounts every agent purchase', () => {
    const s = mkSim({ meta: metaWith({ technical_cofounder: 3 }) });
    s.run.slop = 1e6;
    s.buyAgent('tab_autocomplete', 4);
    const mult = META_CURVES.TECHNICAL_COFOUNDER[2] ?? 1;
    expect(s.run.slopSpent).toBe(bulkAgentCost(TIER, 0, 4, mult).total);
  });
});
