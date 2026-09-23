/**
 * Random play, checked after every action. Anything a player (or a test hook)
 * can do must leave the run in a state the UI can draw.
 */
import { describe, expect, it } from 'vitest';
import type { MetaState } from '../../src/sim/types.ts';
import { CARDS, INCIDENTS, META_UPGRADES, PICKUPS, TOOL_IDS, UPGRADES } from '../../src/sim/content.ts';
import { standaloneRng } from '../../src/sim/rng.ts';
import type { Rng } from '../../src/sim/rng.ts';
import { auditSave, defaultMeta, memoryStorage, SAVE_KEY } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

/** Lifetime 👍 equal to what the levels cost, so the save is one play could produce. */
function earnedFor(m: MetaState): MetaState {
  let spent = 0;
  for (const d of META_UPGRADES) spent += d.costs.slice(0, m.levels[d.id] ?? 0).reduce((a, b) => a + b, 0);
  m.totalThumbsEarned = spent;
  return m;
}

function maxed(): MetaState {
  const m = defaultMeta();
  for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
  return earnedFor(m);
}

function partial(r: Rng): MetaState {
  const m = defaultMeta();
  // Buy random nodes in tree order so the save stays coherent.
  for (let pass = 0; pass < 4; pass++) {
    for (const d of META_UPGRADES) {
      if (r.nextFloat() < 0.35 && d.requires.every((q) => (m.levels[q] ?? 0) >= 1)) {
        m.levels[d.id] = Math.min(d.maxLevel, (m.levels[d.id] ?? 0) + 1);
      }
    }
  }
  return earnedFor(m);
}

function act(s: Sim, r: Rng): void {
  const pick = <T>(xs: readonly T[]): T => xs[r.nextInt(xs.length)]!;
  switch (r.nextInt(22)) {
    case 0:
    case 1:
    case 2:
      s.click(160, 112);
      break;
    case 3:
      s.buyTool(pick(TOOL_IDS), pick([1, 5, Number.POSITIVE_INFINITY]));
      break;
    case 4:
      s.buyUpgrade(pick(UPGRADES).id);
      break;
    case 5:
      s.report();
      break;
    case 6:
      s.claim();
      break;
    case 7:
      s.compact();
      break;
    case 8:
      if (s.run.summary) s.keepCards(s.run.summary.offered.slice(0, r.nextInt(s.run.summary.slots + 2)));
      break;
    case 9:
      s.absolutelyRight();
      break;
    case 10:
      if (s.run.draftOffer.length) s.pickCard(pick(s.run.draftOffer));
      break;
    case 11:
      s.rerollDraft();
      break;
    case 12:
      if (s.run.pickup) s.collectPickup(s.run.pickup.x, s.run.pickup.y);
      break;
    case 13:
      s.debug.grantTokens(Math.pow(10, r.nextInt(14)));
      break;
    case 14:
      s.debug.forceIncident(pick(INCIDENTS).id);
      break;
    case 15:
      s.debug.forcePickup(pick(PICKUPS).id);
      break;
    case 16:
      s.debug.setContext(r.nextFloat() * 1.1);
      break;
    case 17:
      s.debug.forceVerify(pick(['pass', 'catch', null] as const));
      break;
    case 18:
      if (r.nextFloat() < 0.05) s.debug.forceDraft([pick(CARDS).id, pick(CARDS).id]);
      break;
    default:
      s.tick(50 + r.nextInt(900));
  }
}

/** Every invariant, as plain booleans: expect() per check is far too slow for a fuzz loop. */
function violations(s: Sim): string[] {
  const run = s.run;
  const d = s.derived();
  const bad: string[] = [];
  const need = (ok: boolean, what: string): void => {
    if (!ok) bad.push(`${what} (phase ${run.phase}, prompt ${run.promptIndex})`);
  };
  need(Number.isFinite(run.tokens) && run.tokens >= 0, `tokens ${run.tokens}`);
  need(Number.isFinite(run.context), 'context finite');
  need(run.context >= d.contextFloor - 1e-6, 'context >= floor');
  need(run.patienceMs >= 0 && run.patienceMs <= d.patienceMaxMs + 1e-6, `patience ${run.patienceMs}/${d.patienceMaxMs}`);
  need(run.sycophancyHeat >= 0, 'heat >= 0');
  need(run.compactingMs >= 0, 'compactingMs >= 0');
  need((run.summary !== null) === (run.phase === 'compacting'), 'summary iff compacting');
  if (run.summary) need(run.summary.offered.length > run.summary.slots, 'picker only when cards overflow');
  if (run.phase === 'drafting') need(run.draftOffer.length > 0, 'a draft offers something');
  need(new Set(run.cards).size === run.cards.length, 'no duplicate cards');
  need(new Set(run.incidents.map((i) => i.id)).size === run.incidents.length, 'no stacked incidents');
  for (const id of TOOL_IDS) {
    need(Number.isInteger(run.tools[id]) && run.tools[id] >= 0, `tools.${id}`);
    need(d.toolRates[id] >= 0, `toolRates.${id}`);
  }
  for (const [k, v] of Object.entries(d)) if (typeof v === 'number') need(!Number.isNaN(v), `derived.${k} NaN`);
  need(d.contextFill >= 0 && d.contextFill <= 1, 'contextFill in [0,1]');
  need(d.verifyChance >= 0.05 - 1e-9 && d.verifyChance <= 0.95 + 1e-9, 'verifyChance clamped');
  return bad;
}

describe('invariants under random play', () => {
  it('hold for fresh, partial and maxed saves, and the save stays coherent', () => {
    const r = standaloneRng(8675309);
    for (let game = 0; game < 24; game++) {
      const meta = game % 3 === 0 ? defaultMeta() : game % 3 === 1 ? partial(r) : maxed();
      const storage = memoryStorage();
      const s = createSim({ seed: 1000 + game, meta, storage, legacyStorage: null });
      s.subscribe(() => undefined);
      for (let i = 0; i < 2500; i++) {
        if (s.run.phase === 'won' || s.run.phase === 'lost') {
          s.startRun(r.nextInt(1e6) + 1);
          continue;
        }
        act(s, r);
        const bad = violations(s);
        if (bad.length > 0) expect.fail(`game ${game}, step ${i}: ${bad.join('; ')}`);
      }
      s.endRun(false);
      // Random play never produces a save the tamper audit would flag.
      expect(auditSave(JSON.parse(storage.getItem(SAVE_KEY) ?? '{}'))).toBe('clean');
    }
  });
});
