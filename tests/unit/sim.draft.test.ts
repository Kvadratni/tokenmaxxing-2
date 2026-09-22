import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { BALANCE, CARDS, CARD_BY_ID, projectAt } from '../../src/sim/content.ts';
import { RARITY_WEIGHT, claimedGroups, draftPool, generateOffer } from '../../src/sim/draft.ts';
import { standaloneRng } from '../../src/sim/rng.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: Partial<Parameters<typeof createSim>[0]> = {}): Sim {
  return createSim({ seed: 606, storage: null, persist: false, ...over });
}

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

/** Drive a sim into the drafting phase. */
function toDraft(sim: Sim): void {
  sim.run.slop = projectAt(sim.run.projectIndex).requirement;
  sim.ship();
  sim.tick(BALANCE.SHIP_BEAT_MS + 1);
}

const EXCLUSIVE_GROUPS = new Set(
  CARDS.map((c) => c.exclusiveGroup).filter((g): g is string => typeof g === 'string'),
);

describe('draftPool', () => {
  it('never contains a card already owned', () => {
    const owned = ['opus', 'haiku', 'rubber_duck'];
    const pool = draftPool(owned, 9).map((c) => c.id);
    for (const id of owned) expect(pool).not.toContain(id);
  });

  it('never contains a card whose exclusiveGroup is already claimed', () => {
    expect(EXCLUSIVE_GROUPS.size).toBeGreaterThan(0);
    expect(claimedGroups(['monorepo'])).toEqual(new Set(['repo']));

    const pool = draftPool(['monorepo'], 9).map((c) => c.id);
    expect(pool).not.toContain('microservices');
    expect(pool).not.toContain('monorepo');

    const other = draftPool(['microservices'], 9).map((c) => c.id);
    expect(other).not.toContain('monorepo');
  });

  it('respects minProjectIndex', () => {
    const gated = CARDS.filter((c) => (c.minProjectIndex ?? 0) > 0);
    expect(gated.length).toBeGreaterThan(0);
    for (const card of gated) {
      const tooEarly = draftPool([], (card.minProjectIndex ?? 0) - 1).map((c) => c.id);
      expect(tooEarly).not.toContain(card.id);
      const justRight = draftPool([], card.minProjectIndex ?? 0).map((c) => c.id);
      expect(justRight).toContain(card.id);
    }
  });
});

describe('generateOffer', () => {
  it('produces exactly the requested size when the pool allows', () => {
    const rng = standaloneRng(1);
    for (const size of [1, 2, 3, 4, 5]) {
      expect(generateOffer(rng, [], 9, size)).toHaveLength(size);
    }
  });

  it('never repeats a card inside one offer', () => {
    const rng = standaloneRng(2);
    for (let i = 0; i < 2000; i++) {
      const offer = generateOffer(rng, [], 9, 4);
      expect(new Set(offer).size).toBe(offer.length);
    }
  });

  it('never offers two cards from the same exclusiveGroup', () => {
    const rng = standaloneRng(3);
    for (let i = 0; i < 3000; i++) {
      const offer = generateOffer(rng, [], 9, 4);
      const groups = offer
        .map((id) => CARD_BY_ID[id]?.exclusiveGroup)
        .filter((g): g is string => typeof g === 'string');
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  it('never offers an owned card or a blocked group across many rolls', () => {
    const rng = standaloneRng(4);
    const owned = ['monorepo', 'opus', 'chinchilla'];
    for (let i = 0; i < 3000; i++) {
      const offer = generateOffer(rng, owned, 9, 4);
      for (const id of offer) {
        expect(owned).not.toContain(id);
        expect(CARD_BY_ID[id]?.exclusiveGroup).not.toBe('repo');
      }
    }
  });

  it('never offers a card gated above the target project index', () => {
    const rng = standaloneRng(5);
    for (let i = 0; i < 2000; i++) {
      for (const projectIndex of [0, 1, 2, 3, 4, 5]) {
        for (const id of generateOffer(rng, [], projectIndex, 4)) {
          expect(CARD_BY_ID[id]?.minProjectIndex ?? 0).toBeLessThanOrEqual(projectIndex);
        }
      }
    }
  });

  it('degrades gracefully when the pool is smaller than the offer', () => {
    const rng = standaloneRng(6);
    const nearlyAll = CARDS.slice(0, CARDS.length - 1).map((c) => c.id);
    const offer = generateOffer(rng, nearlyAll, 9, 4);
    expect(offer.length).toBeLessThanOrEqual(1);
    expect(generateOffer(rng, CARDS.map((c) => c.id), 9, 4)).toEqual([]);
    expect(generateOffer(rng, [], 9, 0)).toEqual([]);
  });

  it('weights rarity — commons show up more often than rares', () => {
    expect(RARITY_WEIGHT.common).toBeGreaterThan(RARITY_WEIGHT.uncommon);
    expect(RARITY_WEIGHT.uncommon).toBeGreaterThan(RARITY_WEIGHT.rare);

    const rng = standaloneRng(7);
    const counts = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < 5000; i++) {
      for (const id of generateOffer(rng, [], 9, 1)) {
        const rarity = CARD_BY_ID[id]?.rarity;
        if (rarity) counts[rarity] += 1;
      }
    }
    expect(counts.common).toBeGreaterThan(counts.uncommon);
    expect(counts.uncommon).toBeGreaterThan(counts.rare);
  });

  it('is deterministic for a given seed', () => {
    expect(generateOffer(standaloneRng(9), [], 4, 4)).toEqual(
      generateOffer(standaloneRng(9), [], 4, 4),
    );
  });
});

describe('draft phase', () => {
  it('opens with DEFAULT_DRAFT_SIZE cards and emits draftOpen', () => {
    const s = mkSim();
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    toDraft(s);

    expect(s.run.phase).toBe('drafting');
    expect(s.run.draftOffer).toHaveLength(BALANCE.DEFAULT_DRAFT_SIZE);
    const opens = log.filter((e) => e.t === 'draftOpen');
    expect(opens).toHaveLength(1);
    expect(opens[0]).toEqual({ t: 'draftOpen', offer: s.run.draftOffer });
  });

  it('prompt_library widens the offer to 4', () => {
    const s = mkSim({ meta: metaWith({ prompt_library: 1 }) });
    toDraft(s);
    expect(s.run.draftOffer).toHaveLength(4);
  });

  it('pickCard adds the card, clears the offer and starts the next project', () => {
    const s = mkSim();
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    toDraft(s);
    const pick = s.run.draftOffer[0] as string;

    expect(s.pickCard(pick)).toBe(true);
    expect(s.run.cards).toEqual([pick]);
    expect(s.run.draftOffer).toEqual([]);
    expect(s.run.phase).toBe('running');
    expect(s.run.projectIndex).toBe(1);
    expect(log.filter((e) => e.t === 'draftPick')).toEqual([{ t: 'draftPick', id: pick }]);
  });

  it('pickCard refuses cards outside the offer and outside the phase', () => {
    const s = mkSim();
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    expect(s.pickCard('opus')).toBe(false); // still running
    toDraft(s);
    const notOffered = CARDS.map((c) => c.id).find((id) => !s.run.draftOffer.includes(id));
    expect(notOffered).toBeDefined();
    expect(s.pickCard(notOffered as string)).toBe(false);
    expect(s.pickCard('definitely_not_a_card')).toBe(false);
    expect(s.run.cards).toEqual([]);

    const reasons = log.filter((e) => e.t === 'denied').map((e) => (e.t === 'denied' ? e.reason : ''));
    expect(reasons).toEqual(['phase', 'locked', 'locked']);
  });

  it('reroll consumes exactly one charge and yields a fresh valid offer', () => {
    const s = mkSim({ meta: metaWith({ reroll_token: 2 }) });
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    toDraft(s);
    expect(s.run.draftRerollsLeft).toBe(2);

    const first = s.run.draftOffer.slice();
    expect(s.rerollDraft()).toBe(true);
    expect(s.run.draftRerollsLeft).toBe(1);
    expect(s.run.draftOffer).toHaveLength(first.length);
    expect(new Set(s.run.draftOffer).size).toBe(s.run.draftOffer.length);
    expect(log.filter((e) => e.t === 'draftReroll')).toHaveLength(1);
    expect(log.filter((e) => e.t === 'draftOpen')).toHaveLength(2);

    expect(s.rerollDraft()).toBe(true);
    expect(s.run.draftRerollsLeft).toBe(0);
    expect(s.rerollDraft()).toBe(false);
    expect(s.run.draftRerollsLeft).toBe(0);
    expect(log.some((e) => e.t === 'denied' && e.reason === 'locked')).toBe(true);
  });

  it('rerolling actually changes the hand at least sometimes', () => {
    let changed = 0;
    for (let seed = 0; seed < 30; seed++) {
      const s = mkSim({ seed, meta: metaWith({ reroll_token: 1 }) });
      toDraft(s);
      const before = s.run.draftOffer.join(',');
      s.rerollDraft();
      if (s.run.draftOffer.join(',') !== before) changed += 1;
    }
    expect(changed).toBeGreaterThan(20);
  });

  it('rerollDraft is refused outside the drafting phase', () => {
    const s = mkSim({ meta: metaWith({ reroll_token: 2 }) });
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    expect(s.rerollDraft()).toBe(false);
    expect(log).toEqual([{ t: 'denied', reason: 'phase' }]);
  });

  it('never offers a card the player already drafted, run after run', () => {
    const s = mkSim({ seed: 2024 });
    for (let i = 0; i < 6; i++) {
      toDraft(s);
      if (s.run.phase !== 'drafting') break;
      for (const id of s.run.draftOffer) expect(s.run.cards).not.toContain(id);
      const groups = new Set(
        s.run.cards.map((id) => CARD_BY_ID[id]?.exclusiveGroup).filter(Boolean),
      );
      for (const id of s.run.draftOffer) {
        const g = CARD_BY_ID[id]?.exclusiveGroup;
        if (g) expect(groups.has(g)).toBe(false);
      }
      s.pickCard(s.run.draftOffer[0] as string);
    }
    expect(new Set(s.run.cards).size).toBe(s.run.cards.length);
  });
});
