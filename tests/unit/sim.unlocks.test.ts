/**
 * The meta tree gates content, not just numbers.
 *
 * The load-bearing claim is that a fresh save *cannot* win — not "very rarely
 * wins", cannot. That is an arithmetic property of the starting loadout, so it
 * is asserted arithmetically rather than by sampling runs.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_BY_ID,
  AGENT_TIERS,
  CARDS,
  FINAL_PROJECT_INDEX,
  META_BY_ID,
  META_UPGRADES,
  STARTING_CARDS,
  STARTING_TIERS,
  STARTING_UPGRADES,
  UPGRADES,
  createSim,
  defaultMeta,
  metaRequirementsMet,
  projectDeadlineMs,
  projectRequirement,
  unlockedContent,
} from '../../src/sim/index.ts';
import type { MetaState } from '../../src/sim/types.ts';

function metaWith(ids: string[]): MetaState {
  const m = defaultMeta();
  for (const id of ids) m.levels[id] = META_BY_ID[id]?.maxLevel ?? 1;
  return m;
}

const maxed = (): MetaState => metaWith(META_UPGRADES.map((m) => m.id));

describe('the tree is well formed', () => {
  it('every prerequisite names a real node', () => {
    for (const def of META_UPGRADES) {
      for (const req of def.requires) {
        expect(META_BY_ID[req], `${def.id} requires missing node ${req}`).toBeDefined();
      }
    }
  });

  it('has no cycles and no node depends on itself', () => {
    const depth = (id: string, seen = new Set<string>()): number => {
      expect(seen.has(id), `cycle through ${id}`).toBe(false);
      seen.add(id);
      const def = META_BY_ID[id];
      if (!def || def.requires.length === 0) return 0;
      return 1 + Math.max(...def.requires.map((r) => depth(r, new Set(seen))));
    };
    for (const def of META_UPGRADES) expect(depth(def.id)).toBeLessThan(META_UPGRADES.length);
  });

  it('every unlock grants something that exists', () => {
    for (const def of META_UPGRADES) {
      if (def.kind !== 'unlock') continue;
      const g = def.grants;
      expect(g, `${def.id} unlocks nothing`).toBeDefined();
      if (g?.t === 'agentTier') expect(AGENT_BY_ID[g.id]).toBeDefined();
      if (g?.t === 'upgrades') {
        for (const id of g.ids) {
          expect(UPGRADES.some((u) => u.id === id), `${def.id} -> unknown upgrade ${id}`).toBe(true);
        }
      }
      if (g?.t === 'cards') {
        for (const id of g.ids) {
          expect(CARDS.some((c) => c.id === id), `${def.id} -> unknown card ${id}`).toBe(true);
        }
      }
    }
  });

  it('every agent tier, upgrade and card is reachable — nothing is orphaned', () => {
    const all = unlockedContent(maxed());
    for (const t of AGENT_TIERS) expect(all.tiers.has(t.id), `tier ${t.id} unreachable`).toBe(true);
    for (const u of UPGRADES) expect(all.upgrades.has(u.id), `upgrade ${u.id} unreachable`).toBe(true);
    for (const c of CARDS) expect(all.cards.has(c.id), `card ${c.id} unreachable`).toBe(true);
  });

  it('the starting loadout is a strict subset of everything', () => {
    expect(STARTING_TIERS.length).toBeLessThan(AGENT_TIERS.length);
    expect(STARTING_UPGRADES.length).toBeLessThan(UPGRADES.length);
    expect(STARTING_CARDS.length).toBeLessThan(CARDS.length);
  });
});

describe('a fresh save is missing most of the game', () => {
  const fresh = defaultMeta();

  it('fields only the first four agent tiers', () => {
    const u = unlockedContent(fresh);
    expect([...u.tiers].sort()).toEqual([...STARTING_TIERS].sort());
    expect(u.tiers.has('agi')).toBe(false);
    expect(u.tiers.has('subagent_swarm')).toBe(false);
  });

  it('the shop will not show a locked tier even with infinite slop', () => {
    const s = createSim({ seed: 3, meta: fresh, storage: null, autoStart: true });
    s.run.slop = 1e18;
    const ids = s.visibleTiers().map((t) => t.id);
    expect(ids).not.toContain('subagent_swarm');
    expect(s.buyAgent('subagent_swarm', 1)).toBe(false);
    expect(s.run.agents.subagent_swarm).toBe(0);
  });

  it('the draft never offers a locked card', () => {
    const s = createSim({ seed: 11, meta: fresh, storage: null, autoStart: true });
    const allowed = new Set(STARTING_CARDS);
    for (let i = 0; i < 400; i++) {
      s.run.slop = s.derived().requirement;
      s.ship();
      s.tick(1000);
      for (const id of s.run.draftOffer) {
        expect(allowed.has(id), `${id} should be locked on a fresh save`).toBe(true);
      }
      if (s.run.draftOffer[0]) s.pickCard(s.run.draftOffer[0]);
      if (s.run.phase !== 'running') break;
    }
  });

  it('the automation line and the risk knobs are absent from the shop', () => {
    const s = createSim({ seed: 5, meta: fresh, storage: null, autoStart: true });
    s.run.slop = 1e18;
    const ids = s.availableUpgrades().map((u) => u.id);
    expect(ids).not.toContain('autoclicker');
    expect(ids).not.toContain('yolo_mode');
    expect(ids).toContain('mech_keyboard');
  });
});

describe('run 1 cannot be won — arithmetic, not luck', () => {
  it('the starting tiers cannot physically produce what Demo Day demands', () => {
    // Every starting tier at its cap, before any multiplier at all.
    let rawCeiling = 0;
    for (const id of STARTING_TIERS) {
      const def = AGENT_BY_ID[id]!;
      rawCeiling += def.maxOwned * def.baseRate;
    }
    const demand =
      projectRequirement(FINAL_PROJECT_INDEX) / (projectDeadlineMs(FINAL_PROJECT_INDEX) / 1000);

    // Wildly generous: pretend a fresh save could stack a 100x multiplier,
    // which it cannot — most multiplier upgrades are themselves locked.
    expect(rawCeiling * 100).toBeLessThan(demand);
  });

  it('unlocking the ladder is what closes the gap', () => {
    const all = unlockedContent(maxed());
    let full = 0;
    for (const t of AGENT_TIERS) if (all.tiers.has(t.id)) full += t.maxOwned * t.baseRate;
    let fresh = 0;
    for (const id of STARTING_TIERS) full && (fresh += AGENT_BY_ID[id]!.maxOwned * AGENT_BY_ID[id]!.baseRate);
    expect(full / fresh).toBeGreaterThan(1000);
  });
});

describe('buying nodes', () => {
  it('a node with unmet prerequisites cannot be bought at any price', () => {
    const m = defaultMeta();
    m.demos = 100_000;
    const s = createSim({ seed: 7, meta: m, storage: null, autoStart: true });
    expect(metaRequirementsMet(s.meta, 'unlock_agi')).toBe(false);
    expect(s.buyMeta('unlock_agi')).toBe(false);
    expect(s.meta.demos).toBe(100_000);
  });

  it('the headcount chain opens one rung at a time', () => {
    const m = defaultMeta();
    m.demos = 100_000;
    const s = createSim({ seed: 9, meta: m, storage: null, autoStart: true });
    const chain = ['unlock_swarm', 'unlock_ralph', 'unlock_harness'];
    for (let i = 0; i < chain.length; i++) {
      // Everything past the frontier is still refused.
      for (const later of chain.slice(i + 1)) expect(s.buyMeta(later)).toBe(false);
      expect(s.buyMeta(chain[i]!)).toBe(true);
    }
    expect(unlockedContent(s.meta).tiers.has('multi_harness')).toBe(true);
  });

  it('an unlock immediately changes what the run can see', () => {
    const m = defaultMeta();
    m.demos = 100_000;
    const s = createSim({ seed: 13, meta: m, storage: null, autoStart: true });
    expect(s.availableUpgrades().map((u) => u.id)).not.toContain('yolo_mode');
    expect(s.buyMeta('unlock_yolo')).toBe(true);
    s.run.slop = 1e9;
    expect(s.availableUpgrades().map((u) => u.id)).toContain('yolo_mode');
  });
});
