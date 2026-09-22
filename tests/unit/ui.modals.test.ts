/**
 * Draft modal, run-over modal, focus trapping and Escape policy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TID, tid } from '../../src/testids.ts';
import { createUI } from '../../src/ui/index.ts';
import type { UI, UIScreen } from '../../src/ui/types.ts';
import {
  allPrefixed,
  isHidden,
  key,
  makeDerived,
  makeFakeSim,
  makeRun,
  must,
  q,
  type FakeSim,
} from './ui.fake-sim.ts';
import type { RunState } from '../../src/sim/types.ts';

let mounted: UI | null = null;
let host: HTMLElement | null = null;

function mount(
  over: Partial<RunState> = {},
  screen: UIScreen = 'run',
): { ui: UI; root: HTMLElement; sim: FakeSim; frame: () => void } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sim = makeFakeSim({ run: makeRun(over) });
  const ui = createUI({ root, sim, screen, now: () => 0 });
  mounted = ui;
  host = root;
  const frame = (): void => ui.update(sim.run, makeDerived(sim.run), sim.meta);
  frame();
  return { ui, root, sim, frame };
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

describe('draft modal', () => {
  const drafting = { phase: 'drafting' as const, draftOffer: ['sonnet', 'haiku', 'opus'] };

  it('is closed while the run is running', () => {
    const { root } = mount();
    expect(isHidden(q(root, TID.draftModal))).toBe(true);
  });

  it('opens on phase=drafting and renders one card per offer entry', () => {
    const { root } = mount(drafting);
    const modal = must(root, TID.draftModal);
    expect(isHidden(modal)).toBe(false);
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(allPrefixed(root, TID.draftCard)).toHaveLength(3);
    for (const id of drafting.draftOffer) {
      expect(q(root, tid(TID.draftCard, id))).not.toBeNull();
    }
  });

  it('renders four cards when Prompt Library widens the offer', () => {
    const { root } = mount({
      phase: 'drafting',
      draftOffer: ['sonnet', 'haiku', 'opus', 'rubber_duck'],
    });
    expect(allPrefixed(root, TID.draftCard)).toHaveLength(4);
  });

  it('highlights a card on click but does not commit it', () => {
    const { root, sim } = mount(drafting);
    must(root, tid(TID.draftCard, 'haiku')).click();
    // Selection is not a purchase — this is what stops a stray keypress right
    // after shipping from locking in the wrong card.
    expect(sim.pickCard).not.toHaveBeenCalled();
    expect(must(root, tid(TID.draftCard, 'haiku')).getAttribute('aria-pressed')).toBe('true');
  });

  it('commits only when Confirm is pressed, with the highlighted id', () => {
    const { root, sim } = mount(drafting);
    expect((must(root, TID.draftConfirm) as HTMLButtonElement).disabled).toBe(true);
    must(root, tid(TID.draftCard, 'haiku')).click();
    expect((must(root, TID.draftConfirm) as HTMLButtonElement).disabled).toBe(false);
    must(root, TID.draftConfirm).click();
    expect(sim.pickCard).toHaveBeenCalledWith('haiku');
  });

  it('re-highlighting swaps the selection instead of stacking picks', () => {
    const { root, sim } = mount(drafting);
    must(root, tid(TID.draftCard, 'haiku')).click();
    must(root, tid(TID.draftCard, 'sonnet')).click();
    must(root, TID.draftConfirm).click();
    expect(sim.pickCard).toHaveBeenCalledTimes(1);
    expect(sim.pickCard).toHaveBeenCalledWith('sonnet');
  });

  it('cannot be dismissed with Escape', () => {
    const { root } = mount(drafting);
    const card = must(root, tid(TID.draftCard, 'sonnet'));
    card.focus();
    const e = key(card, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(isHidden(q(root, TID.draftModal))).toBe(false);
  });

  it('closes once the sim leaves the drafting phase', () => {
    const { root, sim, frame } = mount(drafting);
    expect(isHidden(q(root, TID.draftModal))).toBe(false);
    sim.run.phase = 'running';
    sim.run.draftOffer = [];
    frame();
    expect(isHidden(q(root, TID.draftModal))).toBe(true);
    expect(allPrefixed(root, TID.draftCard)).toHaveLength(0);
  });

  it('hides the reroll button at zero rerolls and calls rerollDraft otherwise', () => {
    const { root, sim, frame } = mount(drafting);
    expect(isHidden(q(root, TID.draftReroll))).toBe(true);

    sim.run.draftRerollsLeft = 2;
    frame();
    const reroll = must(root, TID.draftReroll);
    expect(isHidden(reroll)).toBe(false);
    expect(must(root, TID.draftRerollCount).textContent).toBe('2');
    reroll.click();
    expect(sim.rerollDraft).toHaveBeenCalledTimes(1);
  });

  it('traps Tab from the last focusable back to the first', () => {
    const { root } = mount({ ...drafting, draftRerollsLeft: 1 });
    const first = must(root, tid(TID.draftCard, 'sonnet'));
    const reroll = must(root, TID.draftReroll);

    reroll.focus();
    expect(document.activeElement).toBe(reroll);
    const fwd = key(reroll, 'Tab');
    expect(fwd.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    // and shift-tab from the first wraps back to the last
    const back = key(first, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(reroll);
  });

  it('focuses the first card when it opens', () => {
    const { root } = mount(drafting);
    expect(document.activeElement).toBe(must(root, tid(TID.draftCard, 'sonnet')));
  });
});

describe('run over modal', () => {
  it('shows SIGKILL on a loss', () => {
    const { root } = mount({ phase: 'lost', shipped: 3, pendingDemos: 5, clicks: 120 });
    expect(isHidden(q(root, TID.runOverModal))).toBe(false);
    expect(must(root, TID.runOverTitle).textContent).toBe('SIGKILL');
    expect(must(root, TID.runOverDemos).textContent).toContain('5');
    expect(must(root, TID.runOverContinue)).toBeTruthy();
  });

  it('shows DEMO DAY on a win', () => {
    const { root } = mount({ phase: 'won', shipped: 10, pendingDemos: 14 });
    expect(must(root, TID.runOverTitle).textContent).toBe('DEMO DAY');
    expect(must(root, TID.runOverTitle).className).toContain('is-won');
  });

  it('breaks the demos down into base + bonus', () => {
    const { root } = mount({ phase: 'lost', shipped: 3, pendingDemos: 7 });
    const text = must(root, TID.runOverModal).textContent ?? '';
    expect(text).toContain('3 × ◈1 = ◈3');
    expect(text).toContain('◈4'); // bonus = 7 - 3
  });

  it('stays closed while the run is live', () => {
    const { root } = mount({ phase: 'running' });
    expect(isHidden(q(root, TID.runOverModal))).toBe(true);
  });

  it('continue banks into the meta screen', () => {
    const { root, ui } = mount({ phase: 'lost', pendingDemos: 2 });
    must(root, TID.runOverContinue).click();
    expect(ui.screen).toBe('meta');
    expect(isHidden(q(root, TID.runOverModal))).toBe(true);
    expect(isHidden(q(root, TID.metaScreen))).toBe(false);
  });

  it('is not Escape-dismissable either', () => {
    const { root } = mount({ phase: 'lost' });
    const cont = must(root, TID.runOverContinue);
    cont.focus();
    key(cont, 'Escape');
    expect(isHidden(q(root, TID.runOverModal))).toBe(false);
  });
});

describe('options dialog', () => {
  it('closes on Escape and restores focus', () => {
    const { root } = mount();
    const opener = must(root, TID.optionsButton);
    opener.focus();
    opener.click();
    const panel = must(root, TID.optionsPanel);
    expect(isHidden(panel)).toBe(false);

    key(document.activeElement ?? panel, 'Escape');
    expect(isHidden(panel)).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab inside the options panel', () => {
    const { root } = mount();
    must(root, TID.optionsButton).click();
    const panel = must(root, TID.optionsPanel);
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>('button, input'),
    ).filter((n) => !(n as HTMLButtonElement).disabled);
    const first = items[0]!;
    const last = items[items.length - 1]!;
    last.focus();
    key(last, 'Tab');
    expect(document.activeElement).toBe(first);
  });
});

describe('meta screen escape', () => {
  it('Escape returns to the title screen', () => {
    const { root, ui } = mount({}, 'meta');
    expect(ui.screen).toBe('meta');
    key(window, 'Escape');
    expect(ui.screen).toBe('title');
    expect(isHidden(q(root, TID.titleScreen))).toBe(false);
  });
});
