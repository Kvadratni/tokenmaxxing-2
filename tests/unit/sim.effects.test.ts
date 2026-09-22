import { describe, expect, it } from 'vitest';
import type { Effect, MetaState } from '../../src/sim/types.ts';
import {
  AGENT_BY_ID,
  BALANCE,
  CARD_BY_ID,
  META_CURVES,
  UPGRADE_BY_ID,
} from '../../src/sim/content.ts';
import {
  aggregate,
  emptyAggregate,
  endlessUnlocked,
  metaEffects,
  metaLevel,
} from '../../src/sim/effects.ts';
import { computeDerived } from '../../src/sim/derive.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import { createSim } from '../../src/sim/sim.ts';

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

function effectsOf(cardId: string): readonly Effect[] {
  const def = CARD_BY_ID[cardId];
  if (!def) throw new Error(`missing card ${cardId}`);
  return def.effects;
}

describe('aggregate — identity', () => {
  it('starts every multiplier at 1 and every additive at 0', () => {
    const agg = aggregate([]);
    expect(agg.clickMult).toBe(1);
    expect(agg.idleMult).toBe(1);
    expect(agg.allMult).toBe(1);
    expect(agg.agentCostMult).toBe(1);
    expect(agg.incidentRateMult).toBe(1);
    expect(agg.deadlineMult).toBe(1);
    expect(agg.demoMult).toBe(1);
    expect(agg.clickAdd).toBe(0);
    expect(agg.clickPerAgent).toBe(0);
    expect(agg.startingSlop).toBe(0);
    expect(agg.idleHalt).toBe(false);
    expect(agg.draftSize).toBe(BALANCE.DEFAULT_DRAFT_SIZE);
    expect(agg.draftRerolls).toBe(0);
    expect(agg.tierMult.agi).toBe(1);
    expect(agg.startingAgents.agi).toBe(0);
    expect(aggregate([])).toEqual(emptyAggregate());
  });
});

describe('aggregate — one of every Effect member', () => {
  it('clickMult / idleMult / allMult / tierMult are multiplicative', () => {
    const agg = aggregate([
      [{ t: 'clickMult', v: 2 }],
      [{ t: 'clickMult', v: 2.5 }],
      [{ t: 'idleMult', v: 1.5 }],
      [{ t: 'idleMult', v: 2 }],
      [{ t: 'allMult', v: 1.25 }],
      [{ t: 'allMult', v: 2 }],
      [{ t: 'tierMult', id: 'ralph_loop', v: 5 }],
      [{ t: 'tierMult', id: 'ralph_loop', v: 3 }],
    ]);
    expect(agg.clickMult).toBe(5);
    expect(agg.idleMult).toBe(3);
    expect(agg.allMult).toBe(2.5);
    expect(agg.tierMult.ralph_loop).toBe(15);
    expect(agg.tierMult.agi).toBe(1);
  });

  it('agentCostMult / incidentRateMult / deadlineMult / demoMult are multiplicative', () => {
    const agg = aggregate([
      [{ t: 'agentCostMult', v: 0.85 }],
      [{ t: 'agentCostMult', v: 0.4 }],
      [{ t: 'incidentRateMult', v: 1.6 }],
      [{ t: 'incidentRateMult', v: 0.5 }],
      [{ t: 'deadlineMult', v: 1.25 }],
      [{ t: 'deadlineMult', v: 0.8 }],
      [{ t: 'demoMult', v: 1.4 }],
      [{ t: 'demoMult', v: 1.2 }],
    ]);
    expect(agg.agentCostMult).toBeCloseTo(0.34, 12);
    expect(agg.incidentRateMult).toBeCloseTo(0.8, 12);
    expect(agg.deadlineMult).toBeCloseTo(1, 12);
    expect(agg.demoMult).toBeCloseTo(1.68, 12);
  });

  it('clickAdd / clickPerAgent / startingSlop / startingAgent are additive', () => {
    const agg = aggregate([
      [{ t: 'clickAdd', v: 5 }],
      [{ t: 'clickAdd', v: 7 }],
      [{ t: 'clickPerAgent', v: 0.15 }],
      [{ t: 'clickPerAgent', v: 0.1 }],
      [{ t: 'startingSlop', v: 60 }],
      [{ t: 'startingSlop', v: 240 }],
      [{ t: 'startingAgent', id: 'tab_autocomplete', n: 3 }],
      [{ t: 'startingAgent', id: 'tab_autocomplete', n: 6 }],
    ]);
    expect(agg.clickAdd).toBe(12);
    expect(agg.clickPerAgent).toBeCloseTo(0.25, 12);
    expect(agg.startingSlop).toBe(300);
    expect(agg.startingAgents.tab_autocomplete).toBe(9);
  });

  it('idleHalt latches true from any single source', () => {
    expect(aggregate([[{ t: 'idleHalt' }]]).idleHalt).toBe(true);
    expect(aggregate([[{ t: 'idleMult', v: 2 }], [{ t: 'idleHalt' }]]).idleHalt).toBe(true);
  });

  it('draftSize and draftRerolls take the largest request', () => {
    const agg = aggregate([
      [{ t: 'draftSize', v: 4 }],
      [{ t: 'draftSize', v: 2 }],
      [{ t: 'draftRerolls', v: 1 }],
      [{ t: 'draftRerolls', v: 2 }],
    ]);
    expect(agg.draftSize).toBe(4);
    expect(agg.draftRerolls).toBe(2);
  });

  it('rejects NaN and negative multipliers instead of poisoning the fold', () => {
    const agg = aggregate([
      [{ t: 'clickMult', v: Number.NaN }],
      [{ t: 'idleMult', v: -3 }],
      [{ t: 'allMult', v: Number.POSITIVE_INFINITY }],
      [{ t: 'clickAdd', v: Number.NaN }],
    ]);
    expect(agg.clickMult).toBe(1);
    expect(agg.idleMult).toBe(1);
    expect(agg.allMult).toBe(1);
    expect(agg.clickAdd).toBe(0);
  });

  it('is pure — folding the same sources twice gives the same object', () => {
    const sources = [effectsOf('opus'), effectsOf('haiku')];
    expect(aggregate(sources)).toEqual(aggregate(sources));
  });
});

describe('aggregate — real content stacking', () => {
  it('Opus + Haiku multiply out to idle ×2.4 at cost ×1.2', () => {
    const agg = aggregate([effectsOf('opus'), effectsOf('haiku')]);
    // Opus: idle ×3, cost ×3.  Haiku: cost ×0.4, idle ×0.8.
    expect(agg.idleMult).toBe(3 * 0.8);
    expect(agg.agentCostMult).toBe(3 * 0.4);
    expect(agg.idleMult).toBeCloseTo(2.4, 12);
    expect(agg.agentCostMult).toBeCloseTo(1.2, 12);
  });

  it('order of sources does not change the result', () => {
    const a = aggregate([effectsOf('opus'), effectsOf('haiku'), effectsOf('sonnet')]);
    const b = aggregate([effectsOf('sonnet'), effectsOf('opus'), effectsOf('haiku')]);
    expect(a.idleMult).toBeCloseTo(b.idleMult, 12);
    expect(a.agentCostMult).toBeCloseTo(b.agentCostMult, 12);
  });

  it('YOLO Mode stacks idle and incident rate together', () => {
    const yolo = UPGRADE_BY_ID['yolo_mode'];
    const skip = UPGRADE_BY_ID['skip_permissions'];
    expect(yolo).toBeDefined();
    expect(skip).toBeDefined();
    const agg = aggregate([yolo?.effects, skip?.effects]);

    // Read the expected products out of the content rather than hard-coding
    // them: these are balance dials and the tuning pass moves them. What must
    // hold is that each risk upgrade contributes multiplicatively to its own
    // channel, and that both of them push the incident rate *up*.
    const pick = (id: string, t: string): number =>
      (UPGRADE_BY_ID[id]?.effects.find((e) => e.t === t) as { v: number } | undefined)?.v ?? 1;

    expect(agg.idleMult).toBeCloseTo(pick('yolo_mode', 'idleMult'), 12);
    expect(agg.allMult).toBeCloseTo(pick('skip_permissions', 'allMult'), 12);
    expect(agg.incidentRateMult).toBeCloseTo(
      pick('yolo_mode', 'incidentRateMult') * pick('skip_permissions', 'incidentRateMult'),
      12,
    );
    // Both are genuine risk trades, not free wins.
    expect(agg.idleMult).toBeGreaterThan(1);
    expect(agg.allMult).toBeGreaterThan(1);
    expect(agg.incidentRateMult).toBeGreaterThan(1);
  });
});

describe('metaEffects', () => {
  it('seed_funding grants 60 * 4^(L-1)', () => {
    for (const [level, slop] of [
      [1, 60],
      [2, 240],
      [3, 960],
      [4, 3840],
      [5, 15360],
    ] as const) {
      expect(aggregate([metaEffects(metaWith({ seed_funding: level }))]).startingSlop).toBe(slop);
    }
    expect(aggregate([metaEffects(metaWith({ seed_funding: 0 }))]).startingSlop).toBe(0);
  });

  it('cracked gives +100% click power per level', () => {
    expect(aggregate([metaEffects(metaWith({ cracked: 1 }))]).clickMult).toBe(2);
    expect(aggregate([metaEffects(metaWith({ cracked: 3 }))]).clickMult).toBe(4);
  });

  // These three read their curve out of content rather than pinning a literal:
  // they are deliberately back-loaded (weak early, steep at max) so that
  // finishing the tree is worth its Demos, and the shape is a balance dial.
  it('founder_mode follows its back-loaded allMult curve', () => {
    for (const level of [1, 2, 4, 6]) {
      expect(aggregate([metaEffects(metaWith({ founder_mode: level }))]).allMult).toBeCloseTo(
        META_CURVES.FOUNDER_MODE[level - 1] ?? 1,
        12,
      );
    }
    // Back-loaded: the last level must add more than the first.
    const c = META_CURVES.FOUNDER_MODE;
    expect(c[c.length - 1]! - c[c.length - 2]!).toBeGreaterThan(c[1]! - c[0]!);
  });

  it('scope_negotiator follows its back-loaded deadline curve', () => {
    for (const level of [1, 2, 4]) {
      expect(aggregate([metaEffects(metaWith({ scope_negotiator: level }))]).deadlineMult).toBeCloseTo(
        META_CURVES.SCOPE_NEGOTIATOR[level - 1] ?? 1,
        12,
      );
    }
  });

  it('incubator grants 3 Tab Autocomplete per level', () => {
    const agg = aggregate([metaEffects(metaWith({ incubator: 2 }))]);
    expect(agg.startingAgents.tab_autocomplete).toBe(6);
    expect(agg.startingAgents.copy_paste_chatbot).toBe(0);
  });

  it('prompt_library widens the draft to 4', () => {
    expect(aggregate([metaEffects(metaWith({ prompt_library: 1 }))]).draftSize).toBe(4);
    expect(aggregate([metaEffects(metaWith({ prompt_library: 0 }))]).draftSize).toBe(
      BALANCE.DEFAULT_DRAFT_SIZE,
    );
  });

  it('reroll_token grants one reroll per level', () => {
    expect(aggregate([metaEffects(metaWith({ reroll_token: 2 }))]).draftRerolls).toBe(2);
  });

  it('technical_cofounder follows its back-loaded cost curve', () => {
    for (const level of [1, 2, 3]) {
      expect(
        aggregate([metaEffects(metaWith({ technical_cofounder: level }))]).agentCostMult,
      ).toBeCloseTo(META_CURVES.TECHNICAL_COFOUNDER[level - 1] ?? 1, 12);
    }
    // Monotonically cheaper, never above 1.
    const c = META_CURVES.TECHNICAL_COFOUNDER;
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeLessThan(c[i - 1]!);
    expect(c[0]!).toBeLessThan(1);
  });

  it('hype_machine gives +20% demos per level', () => {
    expect(aggregate([metaEffects(metaWith({ hype_machine: 3 }))]).demoMult).toBeCloseTo(1.6, 12);
  });

  it('endless_mode is a gate, not an effect', () => {
    const meta = metaWith({ endless_mode: 1 });
    expect(metaEffects(meta).some((e) => e.t === 'draftSize')).toBe(false);
    expect(endlessUnlocked(meta)).toBe(true);
    expect(endlessUnlocked(defaultMeta())).toBe(false);
  });

  it('clamps levels beyond maxLevel and ignores garbage', () => {
    expect(metaLevel(metaWith({ cracked: 99 }), 'cracked')).toBe(6);
    expect(metaLevel(metaWith({ cracked: -4 }), 'cracked')).toBe(0);
    expect(metaLevel(metaWith({ cracked: Number.NaN }), 'cracked')).toBe(0);
    expect(metaLevel(defaultMeta(), 'does_not_exist')).toBe(0);
  });
});

describe('computeDerived — the two production formulas', () => {
  const sim = () => createSim({ seed: 7, storage: null, persist: false });

  it('clickPower = (BASE_CLICK + clickAdd + clickPerAgentTotal) * clickMult * allMult', () => {
    const s = sim();
    s.run.slop = 1e12;
    s.buyAgent('tab_autocomplete', 10);
    s.run.cards.push('monorepo'); // clickPerAgent 0.15
    s.run.cards.push('rubber_duck'); // clickMult 2
    s.run.cards.push('open_weights'); // allMult 1.4

    const expected = (BALANCE.BASE_CLICK + 0 + 0.15 * 10) * 2 * 1.4;
    expect(s.derived().clickPower).toBeCloseTo(expected, 10);
    // Monorepo carries a small idleMult too, read from content so retuning the
    // card cannot silently invalidate the formula under test.
    const monorepoIdle =
      CARD_BY_ID['monorepo']?.effects.reduce((m, e) => (e.t === 'idleMult' ? m * e.v : m), 1) ?? 1;
    expect(s.derived().multipliers).toEqual({ click: 2, idle: monorepoIdle, all: 1.4 });
  });

  it('idleRate = sum(baseRate * count * tierMult) * idleMult * allMult', () => {
    const s = sim();
    s.run.slop = 1e12;
    s.buyAgent('tab_autocomplete', 5);
    s.run.cards.push('sonnet'); // idleMult 1.8
    s.run.cards.push('open_weights'); // allMult 1.4

    const tier = AGENT_BY_ID.tab_autocomplete;
    const expected = tier.baseRate * 5 * 1 * 1.8 * 1.4;
    const d = s.derived();
    expect(d.idleRate).toBeCloseTo(expected, 10);
    expect(d.tierRates.tab_autocomplete).toBeCloseTo(expected, 10);
    expect(d.tierRates.agi).toBe(0);
  });

  it('tierMult only touches its own tier', () => {
    const s = sim();
    s.run.slop = 1e12;
    s.buyAgent('tab_autocomplete', 10);
    const before = s.derived().tierRates.tab_autocomplete;
    s.run.owned.push('muscle_memory'); // tierMult tab_autocomplete ×5
    const after = s.derived();
    expect(after.tierRates.tab_autocomplete).toBeCloseTo(before * 5, 10);
    expect(after.tierRates.copy_paste_chatbot).toBe(0);
  });

  it('idleHalt zeroes idle production entirely', () => {
    const s = sim();
    s.run.slop = 1e12;
    s.buyAgent('tab_autocomplete', 20);
    expect(s.derived().idleRate).toBeGreaterThan(0);
    s.run.incidents.push({
      id: 'rate_limited',
      remainingMs: 8000,
      clicksRemaining: 0,
      startedAtMs: 0,
    });
    const halted = s.derived();
    expect(halted.idleRate).toBe(0);
    expect(halted.tierRates.tab_autocomplete).toBe(0);
    // Clicking is untouched by idleHalt.
    expect(halted.clickPower).toBeGreaterThan(0);
  });

  it('etaSeconds is 0 when already affordable and Infinity with no idle', () => {
    const s = sim();
    expect(s.derived().idleRate).toBe(0);
    expect(s.derived().etaSeconds).toBe(Number.POSITIVE_INFINITY);
    s.run.slop = s.derived().requirement;
    expect(s.derived().etaSeconds).toBe(0);
    expect(s.derived().canShip).toBe(true);
    expect(s.derived().shipProgress).toBe(1);
  });

  it('shipProgress and deadlineProgress clamp to [0,1]', () => {
    const s = sim();
    s.run.slop = 1e30;
    s.run.timeLeftMs = 1e12;
    expect(s.derived().shipProgress).toBe(1);
    expect(s.derived().deadlineProgress).toBe(1);
    s.run.slop = -5;
    s.run.timeLeftMs = -5;
    expect(s.derived().shipProgress).toBe(0);
    expect(s.derived().deadlineProgress).toBe(0);
  });

  it('computeDerived does not mutate the run', () => {
    const s = sim();
    s.run.slop = 500;
    const snapshot = JSON.stringify(s.run);
    computeDerived(s.run, s.meta);
    expect(JSON.stringify(s.run)).toBe(snapshot);
  });
});
