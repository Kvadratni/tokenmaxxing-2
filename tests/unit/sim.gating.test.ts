/**
 * The meta unlock gate, enforced everywhere rather than only in the shop.
 *
 * Two real bugs live here, both from `meta` being an *optional* parameter:
 * omitting it silently disabled the gate, so locked content leaked into the
 * rail — and a tier the ladder had revealed but the tree had not unlocked fell
 * out of both the visible list and the locked preview and vanished mid-run.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_TIERS, META_BY_ID, STARTING_TIERS, UPGRADES } from '../../src/sim/content.ts';
import { availableUpgradeList, lockedTierList, visibleTierList } from '../../src/sim/derive.ts';
import { unlockedContent } from '../../src/sim/effects.ts';
import * as Sim from '../../src/sim/index.ts';
import type { AgentTierId, MetaState } from '../../src/sim/types.ts';

function sim(levels: Record<string, number> = {}): ReturnType<typeof Sim.createSim> {
  const s = Sim.createSim({ seed: 5, storage: null, persist: false });
  for (const [id, n] of Object.entries(levels)) {
    if (!META_BY_ID[id]) throw new Error(`no such meta node: ${id}`);
    (s.meta as unknown as { levels: Record<string, number> }).levels[id] = n;
  }
  s.startRun(5);
  return s;
}

/** Exactly what src/ui/shop.ts composes for the agent rail. */
function rail(run: Parameters<typeof visibleTierList>[0], meta: MetaState): AgentTierId[] {
  const visible = visibleTierList(run, meta).map((t) => t.id);
  const seen = new Set(visible);
  const locked = lockedTierList(run, meta)
    .filter((t) => !seen.has(t.id))
    .map((t) => t.id);
  return [...visible, ...locked];
}

describe('agent rail gating', () => {
  it('never shows a tier the save has not unlocked', () => {
    const s = sim();
    const unlocked = unlockedContent(s.meta).tiers;
    s.run.slop = 1e15;
    // Walk the whole ladder, checking the rail after every rung.
    for (const t of AGENT_TIERS) {
      s.buyAgent(t.id, 3);
      for (const id of rail(s.run, s.meta)) {
        expect(unlocked.has(id), `rail leaked locked tier ${id}`).toBe(true);
      }
    }
  });

  it('never drops an unlocked tier out of both lists', () => {
    // The reported bug: buying the first CLI Agent revealed Subagent Swarm on
    // the ladder, which removed it from the locked preview — while the meta gate
    // kept it out of the live list. It disappeared and Ralph Loop took its slot.
    const s = sim({ unlock_swarm: 1, unlock_ralph: 1 });
    s.run.slop = 1e15;
    const unlocked = unlockedContent(s.meta).tiers;

    for (const t of AGENT_TIERS) {
      s.buyAgent(t.id, 1);
      const shown = new Set(rail(s.run, s.meta));
      // Every unlocked tier at or below the deepest shown rung must be present:
      // the rail is allowed to stop early, never to have a hole in it.
      const deepest = Math.max(...[...shown].map((id) => AGENT_TIERS.findIndex((a) => a.id === id)));
      for (let i = 0; i <= deepest; i++) {
        const def = AGENT_TIERS[i];
        if (!def || !unlocked.has(def.id)) continue;
        expect(shown.has(def.id), `hole in the rail at ${def.id} after buying ${t.id}`).toBe(true);
      }
    }
  });

  it('reveals a tier only once the tree grants it', () => {
    const before = sim();
    expect(visibleTierList(before.run, before.meta).map((t) => t.id)).not.toContain(
      'subagent_swarm',
    );
    expect(lockedTierList(before.run, before.meta).map((t) => t.id)).not.toContain(
      'subagent_swarm',
    );

    const after = sim({ unlock_swarm: 1 });
    after.run.slop = 1e15;
    after.buyAgent('tab_autocomplete', 1);
    after.buyAgent('copy_paste_chatbot', 1);
    after.buyAgent('agentic_ide', 1);
    after.buyAgent('cli_agent', 1);
    expect(rail(after.run, after.meta)).toContain('subagent_swarm');
  });

  it('always shows a tier the player has paid Demos for', () => {
    // Reported: buying Subagent Swarm in the tree left it invisible in the shop,
    // because a 3-rung lookahead window cut off before reaching it. Anything the
    // save has unlocked must be on screen, however deep the ladder queue is.
    const s = sim({ unlock_swarm: 1, unlock_ralph: 1, unlock_harness: 1, unlock_fleet: 1 });
    const unlocked = unlockedContent(s.meta).tiers;
    // Worst case for the window: own nothing at all, so every rung is queued.
    expect(s.run.agents['tab_autocomplete']).toBe(0);
    const shown = new Set(rail(s.run, s.meta));
    for (const id of unlocked) {
      expect(shown.has(id), `paid-for tier ${id} is missing from the shop`).toBe(true);
    }
  });

  it('starts a fresh save on exactly the starting tiers', () => {
    const s = sim();
    expect([...unlockedContent(s.meta).tiers].sort()).toEqual([...STARTING_TIERS].sort());
  });
});

describe('upgrade gating', () => {
  it('never offers an upgrade the save has not unlocked', () => {
    const s = sim();
    const unlocked = unlockedContent(s.meta).upgrades;
    s.run.slop = 1e15;
    for (const t of AGENT_TIERS) s.buyAgent(t.id, 5);
    for (const u of availableUpgradeList(s.run, s.meta)) {
      expect(unlocked.has(u.id), `shop leaked locked upgrade ${u.id}`).toBe(true);
    }
  });

  it('refuses to sell a locked upgrade through the public API', () => {
    // The shop never *offers* these, but `buyUpgrade` is public: the balance bot
    // and the test hooks call it directly, and it used to check only the run
    // requirements. Same bypass shape as the outage hole in `ship()`.
    const s = sim();
    s.run.slop = 1e15;
    const locked = UPGRADES.filter((u) => !unlockedContent(s.meta).upgrades.has(u.id));
    expect(locked.length, 'a fresh save should not unlock everything').toBeGreaterThan(0);

    for (const u of locked) {
      expect(s.buyUpgrade(u.id), `sold locked upgrade ${u.id}`).toBe(false);
      expect(s.run.owned).not.toContain(u.id);
    }
    expect(s.run.slopSpent).toBe(0);
  });

  it('sells it once the tree unlocks it', () => {
    // yolo_mode ships behind the risk gate, and has no in-run requirement.
    const s = sim({ unlock_yolo: 1 });
    s.run.slop = 1e15;
    expect(s.buyUpgrade('yolo_mode')).toBe(true);
    expect(s.run.owned).toContain('yolo_mode');
  });

  it('refuses to sell a locked agent tier through the public API', () => {
    const s = sim();
    s.run.slop = 1e15;
    expect(s.buyAgent('agi', 1)).toBe(false);
    expect(s.run.agents['agi']).toBe(0);
  });
});
