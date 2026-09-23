import { describe, expect, it } from 'vitest';
import type { Effect, MetaState } from '../../src/sim/types.ts';
import { BALANCE, META_CURVES, META_UPGRADES, TOOL_IDS } from '../../src/sim/content.ts';
import { STAT, aggregate, emptyAggregate, isLegacyCheater, metaEffects, metaLevel } from '../../src/sim/effects.ts';
import { baseAggregate, effectSources, liveAggregate } from '../../src/sim/derive.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import { createSim } from '../../src/sim/sim.ts';

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

describe('aggregate', () => {
  it('starts at the neutral values and the BALANCE crit base', () => {
    const a = aggregate([]);
    expect(a).toEqual(emptyAggregate());
    expect(a.clickMult).toBe(1);
    expect(a.critChance).toBe(BALANCE.CRIT_CHANCE);
    expect(a.critMult).toBe(BALANCE.CRIT_MULT);
    expect(a.oneShotChance).toBe(0);
    expect(a.oneShotPayoutS).toBe(BALANCE.ONE_SHOT_BASE_PAYOUT_S);
    expect(a.draftSize).toBe(BALANCE.DEFAULT_DRAFT_SIZE);
    for (const id of TOOL_IDS) {
      expect(a.toolMult[id]).toBe(1);
      expect(a.toolHalt[id]).toBe(false);
    }
  });

  it('multiplies multiplicative effects and adds additive ones', () => {
    const a = aggregate([
      [{ t: 'clickMult', v: 2 }, { t: 'clickAdd', v: 3 }],
      [{ t: 'clickMult', v: 1.5 }, { t: 'clickAdd', v: 4 }],
      [{ t: 'toolMult', id: 'grep', v: 2 }, { t: 'toolMult', id: 'grep', v: 3 }],
      [{ t: 'footprintMult', v: 0.5 }, { t: 'toolFootprintMult', id: 'read', v: 0.5 }],
      [{ t: 'summarySlots', v: 1 }, { t: 'summarySlots', v: 2 }],
      [{ t: 'verifyChance', v: -0.1 }, { t: 'verifyChance', v: 0.25 }],
      [{ t: 'claimThreshold', v: -0.1 }],
      [{ t: 'startingTool', id: 'grep', n: 5 }, { t: 'startingTool', id: 'grep', n: 2 }],
      [{ t: 'autoClick', v: 2 }, { t: 'autoClick', v: 3 }],
      [{ t: 'permissionMult', v: 0.6 }, { t: 'permissionMult', v: 0.5 }],
    ]);
    expect(a.clickMult).toBe(3);
    expect(a.clickAdd).toBe(7);
    expect(a.toolMult.grep).toBe(6);
    expect(a.footprintMult).toBe(0.5);
    expect(a.toolFootprintMult.read).toBe(0.5);
    expect(a.summarySlots).toBe(3);
    expect(a.verifyChance).toBeCloseTo(0.15, 10);
    expect(a.claimThreshold).toBeCloseTo(-0.1, 10);
    expect(a.startingTools.grep).toBe(7);
    expect(a.autoClick).toBe(5);
    expect(a.permissionMult).toBeCloseTo(0.3, 10);
  });

  it('takes the largest draftSize, and adds rerolls', () => {
    const a = aggregate([[{ t: 'draftSize', v: 4 }], [{ t: 'draftSize', v: 5 }], [{ t: 'draftSize', v: 2 }]]);
    expect(a.draftSize).toBe(5);
    expect(aggregate([[{ t: 'draftRerolls', v: 1 }], [{ t: 'draftRerolls', v: 2 }]]).draftRerolls).toBe(3);
  });

  it('flags halts and freezes', () => {
    const a = aggregate([[{ t: 'idleHalt' }, { t: 'networkHalt' }, { t: 'toolHalt', id: 'bash' }, { t: 'patienceFreeze' }]]);
    expect(a.idleHalt && a.networkHalt && a.patienceFreeze).toBe(true);
    expect(a.toolHalt.bash).toBe(true);
    expect(a.toolHalt.grep).toBe(false);
  });

  it('shrugs off poisoned values', () => {
    const bad: Effect[] = [
      { t: 'clickMult', v: Number.NaN },
      { t: 'idleMult', v: -2 },
      { t: 'clickAdd', v: Number.POSITIVE_INFINITY },
      { t: 'contextMaxMult', v: 0 },
      { t: 'incidentRateMult', v: 0 },
      { t: 'critChance', v: 5 },
      { t: 'oneShotChance', v: -3 },
      { t: 'toolMult', id: 'nope' as never, v: 3 },
    ];
    const a = aggregate([bad]);
    expect(a.clickMult).toBe(1);
    expect(a.idleMult).toBe(1);
    expect(a.clickAdd).toBe(0);
    expect(a.contextMaxMult).toBe(1);
    expect(a.incidentRateMult).toBe(1);
    expect(a.critChance).toBe(BALANCE.CRIT_CHANCE_CAP);
    expect(a.oneShotChance).toBe(0);
  });
});

describe('Training folds through levelEffects', () => {
  it('reads each node at its clamped level', () => {
    const m = metaWith({ unlock_compact: 1, context_window: 9, helpful: 4, tool_use: 2 });
    expect(metaLevel(m, 'context_window')).toBe(5);
    const a = aggregate([metaEffects(m)]);
    expect(a.contextMaxMult).toBe(META_CURVES.CONTEXT_WINDOW[4]);
    expect(a.patienceMult).toBe(META_CURVES.HELPFUL[3]);
    expect(a.idleMult).toBe(META_CURVES.TOOL_USE[1]);
  });

  it('matches every node\'s own levelEffects at max level', () => {
    const m = defaultMeta();
    for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
    const expected = META_UPGRADES.flatMap((d) => (d.levelEffects ? [...d.levelEffects(d.maxLevel)] : []));
    expect(metaEffects(m)).toEqual(expected);
  });

  it('distillation hands out starting tools by level', () => {
    const a = aggregate([metaEffects(metaWith({ tool_use: 1, pretraining: 1, inference_budget: 1, distillation: 2 }))]);
    expect(a.startingTools.grep).toBe(5);
    expect(a.startingTools.read).toBe(5);
    expect(a.startingTools.edit).toBe(0);
    expect(a.startingTokens).toBe(META_CURVES.INFERENCE_BUDGET[0]);
  });

  it('unlock nodes carry no modifiers', () => {
    expect(metaEffects(metaWith({ unlock_web: 1, unlock_compact: 1, prompt_library: 1 }))).toEqual([]);
  });
});

describe('sources in a run', () => {
  it('fold upgrades, cards, incidents (buffs too) and Training', () => {
    const s = createSim({ seed: 1, storage: null, persist: false, meta: metaWith({ tool_use: 1 }) });
    s.run.owned.push('parallel_tool_calls'); // idle x1.5
    s.run.cards.push('tip_200'); // idle x1.3
    s.run.incidents.push({ id: 'pk_docs', remainingMs: 1000, clicksRemaining: 0, startedAtMs: 0 }); // idle x2
    expect(liveAggregate(s.run, s.meta).idleMult).toBeCloseTo(1.1 * 1.5 * 1.3 * 2, 10);
    expect(baseAggregate(s.run, s.meta).idleMult).toBeCloseTo(1.1 * 1.5 * 1.3, 10);
    expect(effectSources(s.run, s.meta, false)).toHaveLength(effectSources(s.run, s.meta, true).length - 1);
  });

  it('tech debt multiplies the incident rate', () => {
    const s = createSim({ seed: 1, storage: null, persist: false });
    s.run.cards.push('ten_x'); // x1.3
    s.run.techDebt = 2;
    expect(liveAggregate(s.run, s.meta).incidentRateMult).toBeCloseTo(1.3 * (1 + 2 * BALANCE.TECH_DEBT_INCIDENT), 10);
  });

  it('a cheating human lowers verifyChance by LEGACY_CHEATER_VERIFY', () => {
    const m = defaultMeta();
    expect(isLegacyCheater(m)).toBe(false);
    m.legacy = { verdict: 'forged', runs: 2, wins: 1, gift: 5 };
    expect(isLegacyCheater(m)).toBe(true);
    const s = createSim({ seed: 1, storage: null, persist: false, meta: m });
    expect(liveAggregate(s.run, s.meta).verifyChance).toBe(BALANCE.LEGACY_CHEATER_VERIFY);
    m.legacy = { verdict: 'none' };
    expect(isLegacyCheater(m)).toBe(false);
    m.stats[STAT.legacyCheater] = 1;
    expect(isLegacyCheater(m)).toBe(true);
  });
});
