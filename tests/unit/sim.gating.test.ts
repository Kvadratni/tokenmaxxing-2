import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import {
  META_BY_ID,
  META_UPGRADES,
  STARTING_CARDS,
  STARTING_TOOLS,
  STARTING_UPGRADES,
  TOOLS,
  UPGRADES,
} from '../../src/sim/content.ts';
import { metaRequirementsMet, unlockedContent } from '../../src/sim/effects.ts';
import { availableUpgradeList, lockedToolList, unlockHint, visibleToolList } from '../../src/sim/derive.ts';
import { defaultMeta, memoryStorage, SAVE_KEY } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 1, storage: null, persist: false, ...over });
  s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
  s.run.nextPickupInMs = Number.POSITIVE_INFINITY;
  return s;
}

function record(s: Sim): GameEvent[] {
  const log: GameEvent[] = [];
  s.subscribe((e) => log.push(e));
  return log;
}

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

describe('unlockedContent', () => {
  it('a fresh save has only the starting sets and no features', () => {
    const u = unlockedContent(defaultMeta());
    expect([...u.tools]).toEqual([...STARTING_TOOLS]);
    expect([...u.upgrades].sort()).toEqual([...STARTING_UPGRADES].sort());
    expect([...u.cards].sort()).toEqual([...STARTING_CARDS].sort());
    expect(u.features.size).toBe(0);
  });

  it('a tool grant brings its upgrades and cards along', () => {
    const u = unlockedContent(metaWith({ unlock_web: 1, unlock_subagent: 1 }));
    expect(u.tools.has('web_search')).toBe(true);
    expect(u.tools.has('subagent')).toBe(true);
    expect(u.upgrades.has('first_result')).toBe(true);
    expect(u.upgrades.has('subagent_summaries')).toBe(true);
    expect(u.cards.has('use_subagents')).toBe(true);
    expect(u.tools.has('mcp_server')).toBe(false);
  });

  it('upgrade grants (with cards), card grants and feature grants', () => {
    const u = unlockedContent(
      metaWith({ unlock_compact: 1, context_window: 1, longer_summaries: 1, better_summaries: 1, unlock_scratchpad: 1 }),
    );
    expect(u.upgrades.has('todo_md')).toBe(true);
    expect(u.features.has('compact')).toBe(true);

    const c = unlockedContent(metaWith({ helpful: 1, rlhf: 1, harmless: 1, honest: 1, constitution: 1 }));
    expect(c.upgrades.has('apology_templates')).toBe(true);
    expect(c.cards.has('be_honest')).toBe(true);

    const p = unlockedContent(metaWith({ prompt_library: 1 }));
    expect(p.cards.has('ultrathink')).toBe(true);
    expect(p.cards.size).toBe(STARTING_CARDS.length + 10);
  });

  it('a maxed tree unlocks every tool, upgrade and card, and every feature', () => {
    const m = defaultMeta();
    for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
    const u = unlockedContent(m);
    expect(u.tools.size).toBe(TOOLS.length);
    for (const up of UPGRADES) expect(u.upgrades.has(up.id), up.id).toBe(true);
    expect(u.features).toEqual(new Set(['compact', 'autoMode', 'systemPrompt', 'pickupRate', 'rarePickups', 'endless']));
  });

  it('upgrade-kind nodes with levels grant nothing but their effects', () => {
    const u = unlockedContent(metaWith({ tool_use: 6, helpful: 4 }));
    expect(u.tools.size).toBe(STARTING_TOOLS.length);
  });
});

describe('the shop respects the save', () => {
  it('a locked tool stays hidden and unbuyable however much is owned before it', () => {
    const s = mkSim();
    s.run.tools.bash = 30;
    s.run.tools.grep = s.run.tools.read = s.run.tools.edit = 1;
    s.run.tokens = 1e10;
    expect(visibleToolList(s.run, s.meta).map((t) => t.id)).not.toContain('web_search');
    const log = record(s);
    expect(s.buyTool('web_search')).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'locked' });
  });

  it('unlocking in Training puts it on sale once the ladder reaches it', () => {
    const s = mkSim({ meta: metaWith({ unlock_web: 1 }) });
    s.run.tokens = 1e10;
    expect(lockedToolList(s.run, s.meta).map((t) => t.id)).toEqual(['read', 'edit', 'bash', 'web_search']);
    for (const id of ['grep', 'read', 'edit', 'bash'] as const) s.buyTool(id);
    expect(s.visibleTools().map((t) => t.id)).toContain('web_search');
    expect(s.buyTool('web_search')).toBe(true);
    expect(s.lockedTools()).toEqual([]);
  });

  it('a locked upgrade is refused even with its requirement met', () => {
    const s = mkSim();
    s.run.promptIndex = 4;
    s.run.tokens = 1e10;
    expect(s.availableUpgrades().map((u) => u.id)).not.toContain('keep_going');
    expect(s.buyUpgrade('keep_going')).toBe(false);
    const t = mkSim({ meta: metaWith({ helpful: 1, rlhf: 1, harmless: 1, honest: 1, constitution: 1, character: 1, unlock_initiative: 1 }) });
    t.run.promptIndex = 4;
    t.run.tokens = 1e10;
    expect(t.availableUpgrades().map((u) => u.id)).toContain('keep_going');
    expect(t.buyUpgrade('keep_going')).toBe(true);
  });

  it('availableUpgradeList filters by requirement and ownership', () => {
    const s = mkSim();
    const ids = (): string[] => availableUpgradeList(s.run, s.meta).map((u) => u.id);
    expect(ids()).toContain('streaming');
    expect(ids()).not.toContain('spec_decoding'); // minPrompt 1
    expect(ids()).not.toContain('ripgrep'); // needs 5 grep
    s.run.owned.push('streaming');
    expect(ids()).not.toContain('streaming');
  });

  it('unlockHint names the Training node or the ladder rung', () => {
    const s = mkSim();
    const byId = (id: string) => TOOLS.find((t) => t.id === id)!;
    expect(unlockHint(s.run, s.meta, byId('grep'))).toBeNull();
    expect(unlockHint(s.run, s.meta, byId('read'))).toBe('Needs 1 × Grep');
    expect(unlockHint(s.run, s.meta, byId('web_search'))).toBe('Unlock in Training: Web Search');
    s.run.tools.grep = 1;
    expect(unlockHint(s.run, s.meta, byId('read'))).toBeNull();
  });
});

describe('buyMeta', () => {
  it('buys a level, pays 👍, persists and announces it', () => {
    const storage = memoryStorage();
    const s = createSim({ storage, legacyStorage: null, autoStart: false });
    const log = record(s);
    s.meta.thumbs = 10;
    s.meta.totalThumbsEarned = 10;
    expect(s.metaCost('tool_use')).toBe(META_BY_ID['tool_use']!.costs[0]);
    expect(s.buyMeta('tool_use')).toBe(true);
    expect(s.meta.levels['tool_use']).toBe(1);
    expect(s.meta.thumbs).toBe(10 - 2);
    expect(log.at(-1)).toEqual({ t: 'metaBuy', id: 'tool_use', level: 1, cost: 2 });
    expect(JSON.parse(storage.getItem(SAVE_KEY) ?? '{}').levels.tool_use).toBe(1);
  });

  it('denies unmet prerequisites, a maxed node and a thin wallet', () => {
    const s = mkSim();
    const log = record(s);
    s.meta.thumbs = 1000;
    expect(metaRequirementsMet(s.meta, 'pretraining')).toBe(false);
    expect(s.buyMeta('pretraining')).toBe(false);
    expect(s.buyMeta('not_a_node')).toBe(false);
    s.meta.levels['honest'] = 1;
    s.meta.levels['helpful'] = 1;
    s.meta.levels['rlhf'] = 1;
    s.meta.levels['harmless'] = 1;
    expect(s.buyMeta('honest')).toBe(false); // maxLevel 1
    expect(s.metaCost('honest')).toBe(Number.POSITIVE_INFINITY);
    s.meta.thumbs = 1;
    expect(s.buyMeta('tool_use')).toBe(false);
    const reasons = log.filter((e) => e.t === 'denied').map((e) => (e.t === 'denied' ? e.reason : ''));
    expect(reasons).toEqual(['locked', 'locked', 'locked', 'thumbs']);
  });

  it('is for between runs: refused once a run is under way', () => {
    const s = mkSim();
    s.meta.thumbs = 100;
    expect(s.buyMeta('tool_use')).toBe(true); // the untouched autoStart run counts as between runs
    s.tick(100);
    const log = record(s);
    expect(s.buyMeta('pretraining')).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'phase' });
    s.endRun(false);
    expect(s.buyMeta('pretraining')).toBe(true);
  });

  it('every node can be bought in tree order from zero with enough 👍', () => {
    const s = createSim({ storage: null, persist: false, autoStart: false });
    s.meta.thumbs = 1e6;
    let progress = true;
    while (progress) {
      progress = false;
      for (const d of META_UPGRADES) {
        if (s.metaCost(d.id) < Number.POSITIVE_INFINITY && metaRequirementsMet(s.meta, d.id)) {
          if (s.buyMeta(d.id)) progress = true;
        }
      }
    }
    for (const d of META_UPGRADES) expect(s.meta.levels[d.id], d.id).toBe(d.maxLevel);
  });
});
