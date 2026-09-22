/**
 * The achievements screen.
 *
 * The case that matters most is a *fresh* save with nothing earned — which is
 * what every new player sees, and which a dirty-check sentinel bug blanked
 * entirely: rows rendered as bare icons with no text and no `is-secret` class,
 * so the hidden art was on display too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../../src/sim/achievements.ts';
import { TID, tid } from '../../src/testids.ts';
import { AchievementsScreen } from '../../src/ui/achievements.ts';
import { makeMeta, must, q } from './ui.fake-sim.ts';
import type { UICtx } from '../../src/ui/types.ts';

let host: HTMLElement | null = null;
let screen: AchievementsScreen | null = null;

function mount(): { root: HTMLElement; s: AchievementsScreen } {
  const root = document.createElement('div');
  root.className = 'tm-ui';
  document.body.appendChild(root);
  host = root;
  const ctx = { setScreen: () => {} } as unknown as UICtx;
  const s = new AchievementsScreen(root, ctx);
  screen = s;
  return { root, s };
}

afterEach(() => {
  screen?.destroy();
  screen = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

const VISIBLE = ACHIEVEMENTS.filter((a) => !a.hidden);
const HIDDEN = ACHIEVEMENTS.filter((a) => a.hidden);

function rowOf(root: HTMLElement, id: string): HTMLElement {
  return must(root, tid(TID.achievementRow, id));
}

describe('achievements screen', () => {
  it('renders every entry with its text on a fresh save', () => {
    const { root, s } = mount();
    s.update(makeMeta({ achievements: {} }));

    expect(root.querySelectorAll(`[data-testid^="${TID.achievementRow}-"]`).length).toBe(
      ACHIEVEMENTS.length,
    );
    // A visible achievement always states what to do, earned or not — otherwise
    // the screen is a wall of unexplained icons.
    for (const a of VISIBLE) {
      const row = rowOf(root, a.id);
      const text = row.textContent ?? '';
      expect(text, a.id).toContain(a.name);
      expect(text, a.id).toContain(a.blurb);
      expect(row.classList.contains('is-secret'), a.id).toBe(false);
      expect(row.classList.contains('is-earned'), a.id).toBe(false);
    }
    expect(must(root, TID.achievementsCount).textContent).toBe(`0 / ${ACHIEVEMENTS.length}`);
  });

  it('gives nothing away about a hidden achievement until it is earned', () => {
    const { root, s } = mount();
    s.update(makeMeta({ achievements: {} }));
    for (const a of HIDDEN) {
      const row = rowOf(root, a.id);
      const text = row.textContent ?? '';
      expect(text, a.id).toContain('???');
      expect(text, `${a.id} leaked its name`).not.toContain(a.name);
      expect(text, `${a.id} leaked its blurb`).not.toContain(a.blurb);
      // The class the CSS uses to black the icon out to a silhouette.
      expect(row.classList.contains('is-secret'), a.id).toBe(true);
    }
  });

  it('reveals a hidden achievement once earned, with the run it landed on', () => {
    const { root, s } = mount();
    const target = HIDDEN[0]!;
    s.update(makeMeta({ achievements: { [target.id]: 7 } }));

    const row = rowOf(root, target.id);
    expect(row.textContent).toContain(target.name);
    expect(row.textContent).toContain(target.blurb);
    expect(row.textContent).toContain('7');
    expect(row.classList.contains('is-secret')).toBe(false);
    expect(row.classList.contains('is-earned')).toBe(true);
    expect(must(root, TID.achievementsCount).textContent).toBe(`1 / ${ACHIEVEMENTS.length}`);
  });

  it('re-renders when the earned set changes and stays put when it does not', () => {
    const { root, s } = mount();
    s.update(makeMeta({ achievements: {} }));
    const first = VISIBLE[0]!;
    expect(rowOf(root, first.id).classList.contains('is-earned')).toBe(false);

    s.update(makeMeta({ achievements: { [first.id]: 1 } }));
    expect(rowOf(root, first.id).classList.contains('is-earned')).toBe(true);

    // Same state twice must not thrash the DOM, but must not undo it either.
    s.update(makeMeta({ achievements: { [first.id]: 1 } }));
    expect(rowOf(root, first.id).classList.contains('is-earned')).toBe(true);
    expect(must(root, TID.achievementsCount).textContent).toBe(`1 / ${ACHIEVEMENTS.length}`);
  });

  it('mounts hidden and toggles with setVisible', () => {
    const { root, s } = mount();
    expect(q(root, TID.achievementsScreen)?.hasAttribute('hidden')).toBe(true);
    s.setVisible(true);
    expect(q(root, TID.achievementsScreen)?.hasAttribute('hidden')).toBe(false);
    s.setVisible(false);
    expect(q(root, TID.achievementsScreen)?.hasAttribute('hidden')).toBe(true);
  });
});
