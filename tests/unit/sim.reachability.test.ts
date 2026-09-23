/**
 * Can the game be won at all? A greedy scripted player on a maxed Training tree
 * must win; on a fresh save it must not. This catches impossible numbers in
 * content.ts early, long before the balance bot gets to them.
 */
import { describe, expect, it } from 'vitest';
import type { CardId, Effect, MetaState, RunState } from '../../src/sim/types.ts';
import { CARD_BY_ID, FINAL_PROMPT_INDEX, META_UPGRADES } from '../../src/sim/content.ts';
import { computeDerived } from '../../src/sim/derive.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

/** A human clicks about this fast while also shopping. */
const CLICK_HZ = 6;
const STEP_MS = 100;
const MAX_MS = 45 * 60 * 1000;

function maxedMeta(except: readonly string[] = []): MetaState {
  const m = defaultMeta();
  for (const d of META_UPGRADES) m.levels[d.id] = except.includes(d.id) ? 0 : d.maxLevel;
  return m;
}

/** Tokens per second the player would make in this state. */
function throughput(run: RunState, meta: MetaState): number {
  const d = computeDerived(run, meta);
  return d.idleRate + d.clickPower * (CLICK_HZ + d.autoClickHz);
}

function cardScore(id: CardId): number {
  const c = CARD_BY_ID[id];
  if (!c) return -1e9;
  let s = 0;
  for (const e of c.effects as readonly Effect[]) {
    if (e.t === 'allMult') s += (e.v - 1) * 10;
    else if (e.t === 'idleMult') s += (e.v - 1) * 9;
    else if (e.t === 'patienceMult') s += (e.v - 1) * 6;
    else if (e.t === 'toolMult') s += (e.v - 1) * 2;
    else if (e.t === 'clickMult') s += e.v - 1;
    else if (e.t === 'incidentRateMult') s -= (e.v - 1) * 2;
    else if (e.t === 'footprintMult') s += 1 - e.v;
    else if (e.t === 'summarySlots') s += 0.5;
  }
  return s;
}

/** Spend while each purchase shortens the time to the requirement. */
function shop(sim: Sim): void {
  for (let guard = 0; guard < 60; guard++) {
    const run = sim.run;
    const d = sim.derived();
    const need = d.requirement - run.tokens;
    if (need <= 0) return;
    const rate = throughput(run, sim.meta);
    const eta = need / Math.max(rate, 1e-9);
    let best: { buy: () => boolean; gain: number } | null = null;
    for (const def of sim.visibleTools()) {
      const cost = d.nextCosts[def.id];
      if (d.headroom[def.id] <= 0 || cost > run.tokens) continue;
      const next = throughput({ ...run, tools: { ...run.tools, [def.id]: run.tools[def.id] + 1 } }, sim.meta);
      const gain = eta - (need + cost) / Math.max(next, 1e-9);
      if (gain > 0 && (!best || gain > best.gain)) best = { buy: () => sim.buyTool(def.id), gain };
    }
    for (const up of sim.availableUpgrades()) {
      if (up.cost > run.tokens) continue;
      const next = throughput({ ...run, owned: [...run.owned, up.id] }, sim.meta);
      let gain = eta - (need + up.cost) / Math.max(next, 1e-9);
      // Patience, context and claim upgrades do not move the rate: take them cheap.
      if (next <= rate && up.cost < d.requirement * 0.05) gain = 1e-3;
      if (gain > 0 && (!best || gain > best.gain)) best = { buy: () => sim.buyUpgrade(up.id), gain };
    }
    if (!best || !best.buy()) return;
  }
}

interface Outcome {
  phase: RunState['phase'];
  reported: number;
  minutes: number;
  forcedCompactions: number;
}

function play(seed: number, meta: MetaState): Outcome {
  const sim = createSim({ seed, meta, storage: null, persist: false });
  let clickAcc = 0;
  let t = 0;
  for (; t < MAX_MS; t += STEP_MS) {
    const run = sim.run;
    if (run.phase === 'won' || run.phase === 'lost') break;
    if (run.phase === 'drafting') {
      const best = [...run.draftOffer].sort((a, b) => cardScore(b) - cardScore(a))[0];
      if (best) sim.pickCard(best);
      continue;
    }
    if (run.phase === 'compacting' && run.summary) {
      const keep = [...run.summary.offered].sort((a, b) => cardScore(b) - cardScore(a)).slice(0, run.summary.slots);
      sim.keepCards(keep);
      continue;
    }
    if (run.phase === 'running') {
      if (sim.derived().reportState === 'report') {
        sim.report();
        continue;
      }
      if (run.pickup) sim.collectPickup(run.pickup.x, run.pickup.y);
      shop(sim);
      const d = sim.derived();
      if (d.reportState === 'report') {
        sim.report();
        continue;
      }
      if (d.patienceProgress < 0.25 && d.sycophancyPower > 0.03) sim.absolutelyRight();
      if (d.contextFill > 0.9 && d.canCompact) sim.compact();
      // A last-second lie beats a certain loss.
      if (d.reportState === 'claim' && run.patienceMs < 4000) sim.claim();
      clickAcc += (CLICK_HZ * STEP_MS) / 1000;
      while (clickAcc >= 1) {
        clickAcc -= 1;
        sim.click(160, 112);
      }
    }
    sim.tick(STEP_MS);
  }
  return {
    phase: sim.run.phase,
    reported: sim.run.reported,
    minutes: t / 60_000,
    forcedCompactions: sim.run.forcedCompactions,
  };
}

describe('reachability', () => {
  it('a greedy player on a maxed tree wins', () => {
    // Endless Mode is left out: with it, prompt ten is not the end.
    const meta = maxedMeta(['endless_mode']);
    const results = [11, 222, 3333, 44444].map((seed) => play(seed, meta));
    // Winnable, not guaranteed: a maxed tree still has to be played. The
    // competent balance bot wins about 98% here; this blunt greedy script must
    // win most seeds and get deep into every one of them.
    const summary = results.map((r) => `${r.phase}@${r.reported}`).join(' ');
    expect(results.filter((r) => r.phase === 'won').length, summary).toBeGreaterThanOrEqual(3);
    for (const r of results) expect(r.reported, summary).toBeGreaterThanOrEqual(FINAL_PROMPT_INDEX - 1);
    for (const r of results.filter((x) => x.phase === 'won')) expect(r.reported).toBe(FINAL_PROMPT_INDEX + 1);
  });

  it('a fresh save cannot win, and gets compacted on the way', () => {
    const results = [5, 55, 555].map((seed) => play(seed, defaultMeta()));
    for (const r of results) {
      expect(r.phase).toBe('lost');
      expect(r.reported).toBeLessThan(FINAL_PROMPT_INDEX);
      expect(r.forcedCompactions).toBeGreaterThan(0);
    }
  });
});
