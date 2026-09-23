/**
 * Draft offers: "The human is prompt engineering".
 *
 * Rules enforced here:
 *  - only cards the save has unlocked, and never one already held;
 *  - an exclusiveGroup claimed this run blocks every other card of the group,
 *    even after compaction drops the claimant (the contract says the two can
 *    never both appear in one run);
 *  - never two cards from one exclusiveGroup in the same offer;
 *  - respect minPromptIndex against the prompt the draft leads into.
 */
import type { CardDef, CardId } from './types.ts';
import { CARDS, CARD_BY_ID } from './content.ts';
import type { Rng } from './rng.ts';

/** Relative pick weight by rarity: rare cards stay rare. */
export const RARITY_WEIGHT: Readonly<Record<CardDef['rarity'], number>> = {
  common: 10,
  uncommon: 5,
  rare: 2,
};

/** exclusiveGroup -> the card that claimed it this run. */
export function claimedGroups(cards: readonly CardId[]): Map<string, CardId> {
  const groups = new Map<string, CardId>();
  for (const id of cards) {
    const group = CARD_BY_ID[id]?.exclusiveGroup;
    if (group && !groups.has(group)) groups.set(group, id);
  }
  return groups;
}

/**
 * Every card legally offerable right now.
 *
 * @param held      cards currently in effect
 * @param promptIndex the prompt the draft leads into
 * @param unlocked  cards the save has unlocked; omit to allow the catalogue
 * @param history   every card picked this run, including compacted-away ones
 */
export function draftPool(
  held: readonly CardId[],
  promptIndex: number,
  unlocked?: ReadonlySet<string>,
  history: readonly CardId[] = [],
): CardDef[] {
  const holding = new Set(held);
  const claimed = claimedGroups([...held, ...history]);
  return CARDS.filter((c) => {
    if (holding.has(c.id)) return false;
    if (unlocked !== undefined && !unlocked.has(c.id)) return false;
    if ((c.minPromptIndex ?? 0) > promptIndex) return false;
    if (c.exclusiveGroup) {
      const owner = claimed.get(c.exclusiveGroup);
      if (owner !== undefined && owner !== c.id) return false;
    }
    return true;
  });
}

/** Weighted sample without replacement, group-exclusive within the offer. */
export function generateOffer(
  rng: Rng,
  held: readonly CardId[],
  promptIndex: number,
  size: number,
  unlocked?: ReadonlySet<string>,
  history: readonly CardId[] = [],
): CardId[] {
  const want = Math.max(0, Math.min(CARDS.length, Math.floor(size)));
  let pool = draftPool(held, promptIndex, unlocked, history);
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
