/**
 * Draft offer generation.
 *
 * Rules enforced here:
 *  - never offer a card already owned this run
 *  - never offer a card whose exclusiveGroup is already claimed by an owned card
 *  - never offer two cards from the same exclusiveGroup in one offer
 *  - respect minProjectIndex against the project about to be played
 */
import type { CardDef, CardId } from './types.ts';
import { CARDS, CARD_BY_ID } from './content.ts';
import type { Rng } from './rng.ts';

/** Relative pick weight by rarity — rare cards stay rare. */
export const RARITY_WEIGHT: Readonly<Record<CardDef['rarity'], number>> = {
  common: 10,
  uncommon: 5,
  rare: 2,
};

/** exclusiveGroups already locked in by the cards the player owns. */
export function claimedGroups(ownedCards: readonly CardId[]): Set<string> {
  const groups = new Set<string>();
  for (const id of ownedCards) {
    const def = CARD_BY_ID[id];
    if (def?.exclusiveGroup) groups.add(def.exclusiveGroup);
  }
  return groups;
}

/**
 * Every card legally offerable right now.
 * `projectIndex` is the index of the project the draft leads into.
 */
export function draftPool(
  ownedCards: readonly CardId[],
  projectIndex: number,
  /** Cards the save has unlocked. Omit to allow the whole catalogue. */
  unlocked?: ReadonlySet<string>,
): CardDef[] {
  const owned = new Set(ownedCards);
  const blocked = claimedGroups(ownedCards);
  return CARDS.filter(
    (c) =>
      !owned.has(c.id) &&
      (unlocked === undefined || unlocked.has(c.id)) &&
      (c.minProjectIndex ?? 0) <= projectIndex &&
      !(c.exclusiveGroup && blocked.has(c.exclusiveGroup)),
  );
}

/** Weighted sample without replacement, group-exclusive within the offer. */
export function generateOffer(
  rng: Rng,
  ownedCards: readonly CardId[],
  projectIndex: number,
  size: number,
  unlocked?: ReadonlySet<string>,
): CardId[] {
  const want = Math.max(0, Math.min(CARDS.length, Math.floor(size)));
  let pool = draftPool(ownedCards, projectIndex, unlocked);
  const offer: CardId[] = [];

  while (offer.length < want && pool.length > 0) {
    const picked = rng.weightedPick(pool, (c) => RARITY_WEIGHT[c.rarity] ?? 1);
    if (!picked) break;
    offer.push(picked.id);
    pool = pool.filter(
      (c) =>
        c.id !== picked.id &&
        !(c.exclusiveGroup && picked.exclusiveGroup && c.exclusiveGroup === picked.exclusiveGroup),
    );
  }
  return offer;
}
