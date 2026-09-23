import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { BALANCE, CARDS, CARD_BY_ID, STARTING_CARDS } from '../../src/sim/content.ts';
import { unlockedContent } from '../../src/sim/effects.ts';
import { RARITY_WEIGHT, draftPool, generateOffer } from '../../src/sim/draft.ts';
import { standaloneRng } from '../../src/sim/rng.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 606, storage: null, persist: false, ...over });
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

function toDraft(s: Sim): void {
  s.run.tokens = 1e30;
  s.report();
  s.tick(BALANCE.REPORT_BEAT_MS + 1);
}

const ALL = new Set(CARDS.map((c) => c.id));

describe('draftPool', () => {
  it('offers only unlocked cards not already held', () => {
    const unlocked = new Set(STARTING_CARDS);
    const pool = draftPool(['please'], 0, unlocked).map((c) => c.id);
    expect(pool).not.toContain('please');
    for (const id of pool) expect(unlocked.has(id)).toBe(true);
    expect(pool).toHaveLength(STARTING_CARDS.length - 1);
  });

  it('respects minPromptIndex', () => {
    expect(draftPool([], 4, ALL).map((c) => c.id)).not.toContain('agi_by_friday');
    expect(draftPool([], 5, ALL).map((c) => c.id)).toContain('agi_by_friday');
  });

  it('an exclusive group held blocks the rest of the group', () => {
    const pool = draftPool(['grandma'], 3, ALL).map((c) => c.id);
    expect(pool).not.toContain('fix_it_now');
  });

  it('keeps the group closed after compaction drops the claimant', () => {
    const pool = draftPool([], 3, ALL, ['grandma']).map((c) => c.id);
    expect(pool).not.toContain('fix_it_now');
    // The claimant itself may come back.
    expect(pool).toContain('grandma');
  });
});

describe('generateOffer', () => {
  it('draws `size` distinct cards, never two from one group', () => {
    for (let seed = 1; seed < 200; seed++) {
      const offer = generateOffer(standaloneRng(seed), [], 6, 5, ALL);
      expect(offer).toHaveLength(5);
      expect(new Set(offer).size).toBe(5);
      const groups = offer.map((id) => CARD_BY_ID[id]?.exclusiveGroup).filter(Boolean);
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  it('is deterministic per seed', () => {
    expect(generateOffer(standaloneRng(42), [], 3, 3, ALL)).toEqual(generateOffer(standaloneRng(42), [], 3, 3, ALL));
  });

  it('weights by rarity: rares stay rare', () => {
    const counts = { common: 0, uncommon: 0, rare: 0 };
    const rng = standaloneRng(9);
    for (let i = 0; i < 3000; i++) {
      const [id] = generateOffer(rng, [], 9, 1, ALL);
      const r = CARD_BY_ID[id!]!.rarity;
      counts[r] += 1;
    }
    const pool = draftPool([], 9, ALL);
    const weight = (r: 'common' | 'uncommon' | 'rare'): number =>
      pool.filter((c) => c.rarity === r).length * RARITY_WEIGHT[r];
    const total = weight('common') + weight('uncommon') + weight('rare');
    expect(counts.rare / 3000).toBeCloseTo(weight('rare') / total, 1);
    expect(counts.common).toBeGreaterThan(counts.rare);
  });

  it('shrinks to what is left', () => {
    const held = STARTING_CARDS.slice(0, STARTING_CARDS.length - 2);
    expect(generateOffer(standaloneRng(1), held, 1, 3, new Set(STARTING_CARDS))).toHaveLength(2);
  });
});

describe('the draft in a run', () => {
  it('opens after a report with DEFAULT_DRAFT_SIZE unlocked cards', () => {
    const s = mkSim();
    const log = record(s);
    toDraft(s);
    expect(s.run.phase).toBe('drafting');
    expect(s.run.draftOffer).toHaveLength(BALANCE.DEFAULT_DRAFT_SIZE);
    const unlocked = unlockedContent(s.meta).cards;
    for (const id of s.run.draftOffer) expect(unlocked.has(id)).toBe(true);
    expect(log.find((e) => e.t === 'draftOpen')).toEqual({ t: 'draftOpen', offer: s.run.draftOffer });
  });

  it('draftSize takes the largest request (Few-Shot)', () => {
    const s = mkSim({ meta: metaWith({ prompt_library: 1, temperature: 1, few_shot: 2 }) });
    toDraft(s);
    expect(s.run.draftOffer).toHaveLength(BALANCE.DEFAULT_DRAFT_SIZE + 2);
  });

  it('rerolls come from Temperature, and run out', () => {
    const s = mkSim({ meta: metaWith({ prompt_library: 1, temperature: 2 }) });
    const log = record(s);
    toDraft(s);
    expect(s.run.draftRerollsLeft).toBe(2);
    expect(s.rerollDraft()).toBe(true);
    expect(s.rerollDraft()).toBe(true);
    expect(s.rerollDraft()).toBe(false);
    expect(log.filter((e) => e.t === 'draftReroll')).toHaveLength(2);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'locked' });
    expect(s.run.draftOffer).toHaveLength(BALANCE.DEFAULT_DRAFT_SIZE);
  });

  it('rerolls are refused outside a draft', () => {
    const s = mkSim({ meta: metaWith({ prompt_library: 1, temperature: 2 }) });
    expect(s.rerollDraft()).toBe(false);
  });

  it('pickCard only takes a card on offer', () => {
    const s = mkSim();
    const log = record(s);
    expect(s.pickCard('please')).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'phase' });
    toDraft(s);
    const outside = STARTING_CARDS.find((id) => !s.run.draftOffer.includes(id))!;
    expect(s.pickCard(outside)).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'locked' });
    const pick = s.run.draftOffer[1]!;
    expect(s.pickCard(pick)).toBe(true);
    expect(log.find((e) => e.t === 'draftPick')).toEqual({ t: 'draftPick', id: pick });
    expect(s.run.draftOffer).toEqual([]);
  });

  it('applies onPick: READ THE DOCS FIRST dumps the docs into context', () => {
    const s = mkSim({ meta: metaWith({ prompt_library: 1 }) });
    toDraft(s);
    s.debug.forceDraft(['read_the_docs']);
    s.run.context = 0;
    s.pickCard('read_the_docs');
    expect(s.run.context).toBeCloseTo(0.3 * BALANCE.BASE_CONTEXT, 8);
  });

  it('applies onPick: LGTM comes with a thumbs-up', () => {
    const s = mkSim();
    toDraft(s);
    const before = s.run.pendingThumbs;
    s.debug.forceDraft(['lgtm']);
    s.pickCard('lgtm');
    expect(s.run.pendingThumbs).toBe(before + 1);
  });

  it('a card that overflows the window compacts at the start of the prompt', () => {
    const s = mkSim({ meta: metaWith({ prompt_library: 1 }) });
    toDraft(s);
    s.run.context = BALANCE.BASE_CONTEXT * 0.8;
    s.debug.forceDraft(['read_the_docs']);
    s.pickCard('read_the_docs');
    expect(s.run.forcedCompactions).toBe(1);
  });

  it('forceDraft opens a draft of exactly those cards and validates them', () => {
    const s = mkSim();
    const log = record(s);
    expect(s.debug.forceDraft([])).toBe(false);
    expect(s.debug.forceDraft(['not_a_card'])).toBe(false);
    expect(s.debug.forceDraft(['please', 'thank_you'])).toBe(true);
    expect(s.run.phase).toBe('drafting');
    expect(s.run.draftOffer).toEqual(['please', 'thank_you']);
    expect(log.at(-1)).toEqual({ t: 'draftOpen', offer: ['please', 'thank_you'] });
  });

  it('skips straight to the next prompt when nothing is left to offer', () => {
    const s = mkSim();
    for (const id of STARTING_CARDS) s.run.cards.push(id);
    toDraft(s);
    expect(s.run.phase).toBe('running');
    expect(s.run.promptIndex).toBe(1);
  });
});
