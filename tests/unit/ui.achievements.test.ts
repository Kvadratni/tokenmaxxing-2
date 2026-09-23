/**
 * The achievements screen. The case that matters most is a *fresh* save,
 * which is what every new player sees: every visible achievement must say what
 * to do, and every hidden one must give nothing away.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, modelVersion } from '../../src/sim/content.ts';
import { TID, tid } from '../../src/testids.ts';
import { makeMeta, mountUI, must, text, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

const VISIBLE = ACHIEVEMENTS.filter((a) => !a.hidden);
const HIDDEN = ACHIEVEMENTS.filter((a) => a.hidden);
const row = (root: HTMLElement, id: string): HTMLElement => must(root, tid(TID.achievementRow, id));

describe('achievements screen', () => {
  it('renders every entry with its text on a fresh save', () => {
    const m = mountUI({ screen: 'achievements' });
    expect(m.root.querySelectorAll(`[data-testid^="${TID.achievementRow}-"]`)).toHaveLength(ACHIEVEMENTS.length);
    for (const a of VISIBLE) {
      const r = row(m.root, a.id);
      expect(r.textContent, a.id).toContain(a.name);
      expect(r.textContent, a.id).toContain(a.blurb);
      expect(r.classList.contains('is-secret'), a.id).toBe(false);
    }
  });

  it('gives a hidden achievement away only once it is earned', () => {
    const secret = HIDDEN[0]!;
    const m = mountUI({ screen: 'achievements' });
    const r = row(m.root, secret.id);
    expect(r.textContent).toContain('???');
    expect(r.textContent).not.toContain(secret.name);
    expect(r.classList.contains('is-secret')).toBe(true);
    m.sim.meta.achievements[secret.id] = 3;
    m.frame();
    expect(r.textContent).toContain(secret.name);
    expect(r.classList.contains('is-earned')).toBe(true);
    expect(r.textContent).toContain(`RUN 3 · v${modelVersion(3)}`);
  });

  it('counts what is earned and goes back to the title', () => {
    const m = mountUI({ screen: 'achievements', meta: makeMeta({ achievements: { compacted: 1, works_on_my_machine: 2 } }) });
    expect(text(m.root, TID.achievementsCount)).toBe(`2 / ${ACHIEVEMENTS.length}`);
    (must(m.root, 'achv-back') as HTMLButtonElement).click();
    expect(m.ui.screen).toBe('title');
  });
});
