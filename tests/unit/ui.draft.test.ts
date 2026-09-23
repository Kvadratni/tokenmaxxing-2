/**
 * The draft: "THE HUMAN IS PROMPT ENGINEERING". Two-step on purpose: a click
 * only highlights, CONFIRM commits.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CARD_BY_ID } from '../../src/sim/content.ts';
import { TID, tid } from '../../src/testids.ts';
import { DRAFT_TITLE } from '../../src/ui/draft.ts';
import { isHidden, key, makeRun, mountUI, must, q, text, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

const OFFER = ['make_no_mistakes', 'think_step_by_step', 'tip_200'];

function drafting(rerolls = 1) {
  return mountUI({ run: makeRun({ phase: 'drafting', draftOffer: OFFER.slice(), draftRerollsLeft: rerolls }) });
}

const card = (root: HTMLElement, id: string): HTMLButtonElement => must(root, tid(TID.draftCard, id)) as HTMLButtonElement;
const confirm = (root: HTMLElement): HTMLButtonElement => must(root, TID.draftConfirm) as HTMLButtonElement;

describe('the draft', () => {
  it('opens on drafting with the header, one card per offer and caps names', () => {
    const m = drafting();
    const modal = must(m.root, TID.draftModal);
    expect(isHidden(modal)).toBe(false);
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.textContent).toContain(DRAFT_TITLE);
    for (const id of OFFER) {
      const c = card(m.root, id);
      const def = CARD_BY_ID[id]!;
      expect(c.querySelector('.tm-card__name')!.textContent).toBe(def.name.toUpperCase());
      expect(c.textContent).toContain(def.blurb);
      expect(c.querySelector('.tm-icon')!.getAttribute('data-icon')).toBe(`card_${id}`);
    }
  });

  it('says what each card really does, whatever the blurb claims', () => {
    const m = drafting();
    // "Does nothing. The human feels better." It does something.
    expect(card(m.root, 'make_no_mistakes').textContent).toContain('Patience ×1.12');
    expect(card(m.root, 'think_step_by_step').textContent).toContain('Clicks ×3');
  });

  it('highlights on click and commits only on Confirm', () => {
    const m = drafting();
    expect(confirm(m.root).disabled).toBe(true);
    card(m.root, 'tip_200').click();
    expect(card(m.root, 'tip_200').getAttribute('aria-pressed')).toBe('true');
    expect(card(m.root, 'tip_200').classList.contains('is-selected')).toBe(true);
    expect(m.sent('pickCard')).toHaveLength(0);
    card(m.root, 'make_no_mistakes').click();
    expect(card(m.root, 'tip_200').getAttribute('aria-pressed')).toBe('false');
    confirm(m.root).click();
    expect(m.sent('pickCard')).toEqual([{ t: 'pickCard', id: 'make_no_mistakes' }]);
  });

  it('opens with nothing highlighted, so a stray Enter cannot pick', () => {
    const m = drafting();
    key(must(m.root, TID.draftModal), 'Enter');
    expect(m.sent('pickCard')).toHaveLength(0);
  });

  it('moves the highlight with the arrows and takes it with Enter', () => {
    const m = drafting();
    const modal = must(m.root, TID.draftModal);
    key(modal, 'ArrowRight');
    expect(card(m.root, 'make_no_mistakes').getAttribute('aria-pressed')).toBe('true');
    key(modal, 'ArrowRight');
    expect(card(m.root, 'think_step_by_step').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(card(m.root, 'think_step_by_step'));
    key(modal, 'ArrowLeft');
    key(modal, 'ArrowLeft');
    expect(card(m.root, 'tip_200').getAttribute('aria-pressed')).toBe('true');
    key(modal, 'Enter');
    expect(m.sent('pickCard')).toEqual([{ t: 'pickCard', id: 'tip_200' }]);
  });

  it('counts the rerolls, sends `reroll`, and clears the highlight when the offer changes', () => {
    const m = drafting(2);
    expect(text(m.root, TID.draftRerollCount)).toBe('2');
    card(m.root, 'tip_200').click();
    (must(m.root, TID.draftReroll) as HTMLButtonElement).click();
    expect(m.sent('reroll')).toHaveLength(1);
    m.sim.run.draftOffer = ['please', 'thank_you', 'grandma'];
    m.sim.run.draftRerollsLeft = 1;
    m.frame();
    expect(q(m.root, tid(TID.draftCard, 'tip_200'))).toBeNull();
    expect(card(m.root, 'please').getAttribute('aria-pressed')).toBe('false');
    expect(confirm(m.root).disabled).toBe(true);
    expect(text(m.root, TID.draftRerollCount)).toBe('1');
  });

  it('disables reroll with none left', () => {
    const m = drafting(0);
    const reroll = must(m.root, TID.draftReroll) as HTMLButtonElement;
    expect(reroll.disabled).toBe(true);
    expect(text(m.root, TID.draftRerollCount)).toBe('0');
    reroll.click();
    expect(m.sent('reroll')).toHaveLength(0);
  });

  it('cannot be dismissed: Escape is swallowed and the dialog stays', () => {
    const m = drafting();
    const e = key(must(m.root, TID.draftModal), 'Escape');
    expect(e.defaultPrevented).toBe(true);
    m.frame();
    expect(isHidden(must(m.root, TID.draftModal))).toBe(false);
  });

  it('closes once the pick lands', () => {
    const m = drafting();
    m.sim.run.phase = 'running';
    m.sim.run.draftOffer = [];
    m.frame();
    expect(isHidden(must(m.root, TID.draftModal))).toBe(true);
  });
});
