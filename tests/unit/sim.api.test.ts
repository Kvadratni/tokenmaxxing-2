/**
 * Barrel smoke test: everything the rest of the app imports must resolve from
 * `src/sim/index.ts` and satisfy the frozen `SimApi` contract.
 */
import { describe, expect, it } from 'vitest';
import * as Sim from '../../src/sim/index.ts';
import type { SimApi } from '../../src/sim/types.ts';

describe('public surface', () => {
  it('re-exports the contract constants and content tables', () => {
    expect(Sim.SCENE_WIDTH).toBe(320);
    expect(Sim.SCENE_HEIGHT).toBe(180);
    expect(Sim.AGENT_TIERS).toHaveLength(10);
    expect(Sim.PROJECTS).toHaveLength(10);
    expect(Sim.FINAL_PROJECT_INDEX).toBe(9);
    expect(Sim.BALANCE.MAX_STEP_MS).toBeGreaterThan(0);
  });

  it('exports every function the shell needs', () => {
    const expected = [
      'createSim',
      'computeDerived',
      'aggregate',
      'metaEffects',
      'metaLevel',
      'endlessUnlocked',
      'generateOffer',
      'draftPool',
      'selectIncident',
      'rollIncidentDelayMs',
      'loadMeta',
      'saveMeta',
      'defaultMeta',
      'clearMeta',
      'metaNextCost',
      'formatSlop',
      'formatTime',
      'formatRate',
      'formatInt',
      'formatMult',
      'formatPercent',
      'formatEta',
      'createRng',
      'standaloneRng',
      'agentCostAt',
      'bulkAgentCost',
      'visibleTierList',
      'availableUpgradeList',
    ] as const;
    for (const name of expected) {
      expect(typeof (Sim as unknown as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('createSim satisfies SimApi structurally', () => {
    const sim: SimApi = Sim.createSim({ seed: 1, storage: null, persist: false });
    const methods: (keyof SimApi)[] = [
      'derived',
      'tick',
      'click',
      'buyAgent',
      'buyUpgrade',
      'ship',
      'pickCard',
      'rerollDraft',
      'buyMeta',
      'endRun',
      'startRun',
      'availableUpgrades',
      'visibleTiers',
      'subscribe',
    ];
    for (const m of methods) expect(typeof sim[m], m).toBe('function');
    expect(sim.run).toBeDefined();
    expect(sim.meta).toBeDefined();
    expect(sim.derived()).toBeDefined();
  });

  it('sim.run keeps a stable object identity across runs', () => {
    const sim = Sim.createSim({ seed: 1, storage: null, persist: false });
    const first = sim.run;
    sim.startRun(2);
    expect(sim.run).toBe(first);
    expect(sim.run.seed).toBe(2);
  });

  it('DerivedStats carries every field the renderer reads', () => {
    const sim = Sim.createSim({ seed: 1, storage: null, persist: false });
    const d = sim.derived();
    expect(Object.keys(d).sort()).toEqual(
      [
        'canShip',
        'autoClickHz',
        'clickPower',
        'critChance',
        'critMult',
        'oneShotChance',
        'oneShotPayoutS',
        'deadlineProgress',
        'demosIfEndedNow',
        'etaSeconds',
        'headroom',
        'idleRate',
        'incidentRateMult',
        'multipliers',
        'nextCosts',
        'requirement',
        'shipBlockedBy',
        'shipProgress',
        'tierRates',
      ].sort(),
    );
    expect(Object.keys(d.tierRates).sort()).toEqual([...Sim.AGENT_TIER_IDS].sort());
    expect(Object.keys(d.nextCosts).sort()).toEqual([...Sim.AGENT_TIER_IDS].sort());
  });

  it('RunState carries every field the contract declares', () => {
    const sim = Sim.createSim({ seed: 1, storage: null, persist: false });
    expect(Object.keys(sim.run).sort()).toEqual(
      [
        'agents',
        'cards',
        'clicks',
        'draftOffer',
        'draftRerollsLeft',
        'elapsedMs',
        'incidents',
        'nextIncidentInMs',
        'nextPickupInMs',
        'owned',
        'pendingDemos',
        'phase',
        'pickup',
        'projectIndex',
        'rngState',
        'seed',
        'shipped',
        'slop',
        'slopEarned',
        'slopSpent',
        'timeLeftMs',
      ].sort(),
    );
  });
});
