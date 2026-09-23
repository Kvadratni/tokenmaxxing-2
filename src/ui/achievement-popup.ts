/**
 * Achievement unlocked popup — the Steam one.
 *
 * Slides in from the bottom-right corner with the achievement's own icon, its
 * name and its description, sits there long enough to actually read, then slides
 * out. Deliberately *not* a line in the toast strip: earning one of these is a
 * moment, and the toast strip is where "Not enough tokens" lives.
 *
 * Unlocks can land in the same frame (reporting the first prompt can complete
 * more than one), so they queue and play one at a time rather than stacking up
 * the corner of the screen.
 */
import { ACHIEVEMENT_BY_ID } from '../sim/content.ts';
import type { AchievementId } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { el } from './dom.ts';
import { iconEl } from './icon.ts';

/** How long a card stays fully on screen, excluding the slides. */
const HOLD_MS = 5_200;
/** Slide duration each way. Mirrored in the CSS transition. */
const SLIDE_MS = 420;
/** Gap between one card leaving and the next arriving. */
const GAP_MS = 220;

export interface AchievementPopup {
  readonly el: HTMLElement;
  /** Enqueue an unlock. Unknown ids are ignored. */
  show(id: AchievementId): void;
  /** True while a card is on screen — used by the sound cue and by tests. */
  readonly isShowing: boolean;
  destroy(): void;
}

export interface AchievementPopupOpts {
  /** Skip the slide when the player has asked for less motion. */
  reducedMotion?: () => boolean;
}

export function createAchievementPopup(
  parent: HTMLElement,
  opts: AchievementPopupOpts = {},
): AchievementPopup {
  const reduced = opts.reducedMotion ?? ((): boolean => false);
  const root = el('div', {
    cls: 'tm-achv-pop',
    tid: TID.achievementPopup,
    parent,
    // Announced politely: an achievement is good news, not an alert, and it must
    // not interrupt whatever the player is doing.
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'true', role: 'status' },
  });

  const queue: AchievementId[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let current: HTMLElement | null = null;
  let destroyed = false;

  function later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!destroyed) fn();
    }, ms);
    timers.add(t);
  }

  function build(id: AchievementId): HTMLElement | null {
    const def = ACHIEVEMENT_BY_ID[id];
    if (!def) return null;
    const card = el('div', {
      cls: 'tm-achv-pop__card',
      tid: tid(TID.achievementPopupCard, id),
      parent: root,
    });
    iconEl(def.icon, card).classList.add('tm-achv-pop__icon');
    const body = el('div', { cls: 'tm-achv-pop__body', parent: card });
    el('div', {
      cls: 'tm-achv-pop__kicker',
      text: 'Achievement unlocked',
      parent: body,
    });
    el('div', { cls: 'tm-achv-pop__name', text: def.name, parent: body });
    el('div', { cls: 'tm-achv-pop__blurb', text: def.blurb, parent: body });
    return card;
  }

  function pump(): void {
    if (destroyed || current !== null) return;
    const id = queue.shift();
    if (id === undefined) return;
    const card = build(id);
    if (!card) {
      pump();
      return;
    }
    current = card;

    const skipSlide = reduced();
    if (skipSlide) {
      card.classList.add('is-in', 'is-static');
    } else {
      // One frame off-position first, so the transition has something to run
      // from — adding the class in the same frame as the node would not animate.
      requestAnimationFrame(() => {
        if (!destroyed) card.classList.add('is-in');
      });
    }

    const dwell = HOLD_MS + (skipSlide ? 0 : SLIDE_MS);
    later(() => {
      card.classList.remove('is-in');
      later(() => {
        card.remove();
        current = null;
        later(pump, GAP_MS);
      }, skipSlide ? 0 : SLIDE_MS);
    }, dwell);
  }

  return {
    el: root,
    show(id: AchievementId): void {
      if (destroyed || !ACHIEVEMENT_BY_ID[id]) return;
      queue.push(id);
      pump();
    },
    get isShowing(): boolean {
      return current !== null;
    },
    destroy(): void {
      destroyed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      queue.length = 0;
      current = null;
      root.remove();
    },
  };
}
