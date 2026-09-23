/**
 * The summary picker: the context window ran out, and only so many prompt
 * cards fit in the summary. Everything else: "(contents too large to include)".
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SummaryChoice } from '../../src/sim/types.ts';
import { TID, tid } from '../../src/testids.ts';
import {
  defaultKeep,
  DROPPED_TEXT,
  SUMMARY_TITLE_FORCED,
  SUMMARY_TITLE_MANUAL,
} from '../../src/ui/summary.ts';
import { isHidden, key, makeRun, mountUI, must, text, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

const CARDS = ['make_no_mistakes', 'think_step_by_step', 'tip_200'];

function compacting(slots = 1, forced = true, offered: string[] = CARDS) {
  const summary: SummaryChoice = { offered: offered.slice(), slots, forced };
  return mountUI({ run: makeRun({ phase: 'compacting', cards: offered.slice(), summary }) });
}

const card = (root: HTMLElement, id: string): HTMLButtonElement =>
  must(root, tid(TID.summaryCard, id)) as HTMLButtonElement;
const kept = (root: HTMLElement): string[] =>
  CARDS.filter((id) => card(root, id).getAttribute('aria-pressed') === 'true');

describe('the summary picker', () => {
  it('opens on a forced compaction with the hazard header', () => {
    const m = compacting();
    const modal = must(m.root, TID.summaryModal);
    expect(isHidden(modal)).toBe(false);
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.textContent).toContain(SUMMARY_TITLE_FORCED);
    expect(SUMMARY_TITLE_FORCED).toBe('CONTEXT FULL — COMPACTING');
    expect(modal.classList.contains('is-forced')).toBe(true);
  });

  it('reads /compact when the player compacted on purpose', () => {
    const m = compacting(1, false);
    expect(must(m.root, TID.summaryModal).textContent).toContain(SUMMARY_TITLE_MANUAL);
    expect(must(m.root, TID.summaryModal).classList.contains('is-forced')).toBe(false);
  });

  it('states how many survive: "Keep N of M"', () => {
    expect(text(compacting(1).root, TID.summarySlots)).toBe('Keep 1 of 3');
    unmountAll();
    expect(text(compacting(2).root, TID.summarySlots)).toBe('Keep 2 of 3');
  });

  it('starts with the first cards kept, as many as fit', () => {
    expect(defaultKeep({ offered: CARDS, slots: 2, forced: true })).toEqual(CARDS.slice(0, 2));
    const m = compacting(1);
    expect(kept(m.root)).toEqual(['make_no_mistakes']);
  });

  it('marks the dropped cards as too large to include', () => {
    const m = compacting(1);
    expect(card(m.root, 'make_no_mistakes').textContent).toContain('KEPT IN SUMMARY');
    expect(card(m.root, 'tip_200').textContent).toContain(DROPPED_TEXT);
    expect(DROPPED_TEXT).toBe('(contents too large to include)');
  });

  it('with one slot, choosing a card swaps it in', () => {
    const m = compacting(1);
    card(m.root, 'tip_200').click();
    expect(kept(m.root)).toEqual(['tip_200']);
    expect(card(m.root, 'make_no_mistakes').textContent).toContain(DROPPED_TEXT);
  });

  it('with the summary full, the earliest pick makes room; a kept card toggles off', () => {
    const m = compacting(2);
    expect(kept(m.root)).toEqual(['make_no_mistakes', 'think_step_by_step']);
    card(m.root, 'tip_200').click();
    expect(kept(m.root)).toEqual(['think_step_by_step', 'tip_200']);
    card(m.root, 'tip_200').click();
    expect(kept(m.root)).toEqual(['think_step_by_step']);
  });

  it('sends `keepCards` with the kept ids on confirm', () => {
    const m = compacting(2);
    card(m.root, 'make_no_mistakes').click(); // drop it
    card(m.root, 'tip_200').click();
    const btn = must(m.root, TID.summaryConfirm) as HTMLButtonElement;
    expect(btn.textContent).toBe('Keep 2, forget 1');
    btn.click();
    expect(m.sent('keepCards')).toEqual([{ t: 'keepCards', ids: ['think_step_by_step', 'tip_200'] }]);
    // One answer per compaction.
    btn.click();
    expect(m.sent('keepCards')).toHaveLength(1);
  });

  it('can forget everything', () => {
    const m = compacting(1);
    card(m.root, 'make_no_mistakes').click();
    const btn = must(m.root, TID.summaryConfirm) as HTMLButtonElement;
    expect(btn.textContent).toBe('Forget them all');
    btn.click();
    expect(m.sent('keepCards')).toEqual([{ t: 'keepCards', ids: [] }]);
  });

  it('is fully keyboard driven: arrows move, digits toggle, Ctrl+Enter confirms', () => {
    const m = compacting(1);
    const modal = must(m.root, TID.summaryModal);
    card(m.root, 'make_no_mistakes').focus();
    key(modal, 'ArrowDown');
    expect(document.activeElement).toBe(card(m.root, 'think_step_by_step'));
    key(modal, 'ArrowUp');
    key(modal, 'ArrowUp');
    expect(document.activeElement).toBe(card(m.root, 'tip_200'));
    key(modal, '2');
    expect(kept(m.root)).toEqual(['think_step_by_step']);
    key(modal, 'Enter', { ctrlKey: true });
    expect(m.sent('keepCards')).toEqual([{ t: 'keepCards', ids: ['think_step_by_step'] }]);
  });

  it('cannot be dismissed while the sim waits for an answer', () => {
    const m = compacting();
    key(must(m.root, TID.summaryModal), 'Escape');
    m.frame();
    expect(isHidden(must(m.root, TID.summaryModal))).toBe(false);
  });

  it('hands the controls back if the sim refuses the answer', () => {
    const m = compacting(1);
    const btn = must(m.root, TID.summaryConfirm) as HTMLButtonElement;
    btn.click();
    expect(btn.disabled).toBe(true);
    m.frame(); // still compacting: refused
    expect(btn.disabled).toBe(false);
  });

  it('keeps the picks when the sim hands over a fresh but identical choice object', () => {
    const m = compacting(1);
    card(m.root, 'tip_200').click();
    m.sim.run.summary = { offered: CARDS.slice(), slots: 1, forced: true };
    m.frame();
    expect(kept(m.root)).toEqual(['tip_200']);
  });

  it('closes when the compaction resolves', () => {
    const m = compacting();
    m.sim.run.phase = 'running';
    m.sim.run.summary = null;
    m.frame();
    expect(isHidden(must(m.root, TID.summaryModal))).toBe(true);
  });
});
