/**
 * The shop drawer: when it exists, and how it behaves while it is open.
 *
 * Which form the shop takes is decided by *height*, not by `data-layout` — see
 * `DRAWER_MAX_VH` in src/ui/scale.ts. A portrait phone is stacked and still keeps
 * the shop in the flow, so every test here says which viewport it means.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TID, tid } from '../../src/testids.ts';
import { createUI } from '../../src/ui/index.ts';
import { computeScale } from '../../src/ui/scale.ts';
import type { UI } from '../../src/ui/types.ts';
import type { RunState } from '../../src/sim/types.ts';
import { key, makeDerived, makeFakeSim, makeRun, must, q, type FakeSim } from './ui.fake-sim.ts';

/** Phone on its side: short, so the shop is a bottom sheet. */
const LANDSCAPE = [844, 390] as const;
/** Phone upright: height to spare, so the shop stays in the flow. */
const PORTRAIT = [390, 844] as const;
/** Desktop: the shop is a side rail. */
const DESKTOP = [1440, 900] as const;

let mounted: UI | null = null;
let host: HTMLElement | null = null;
const original = { w: window.innerWidth, h: window.innerHeight };

/**
 * happy-dom reports `documentElement.clientWidth` as 0, so `layoutViewport()`
 * falls through to `innerWidth`/`innerHeight` — which is what makes the viewport
 * settable from a test at all.
 */
function setViewport([vw, vh]: readonly [number, number]): void {
  (window as unknown as { innerWidth: number }).innerWidth = vw;
  (window as unknown as { innerHeight: number }).innerHeight = vh;
}

function mount(
  size: readonly [number, number],
  over: Partial<RunState> = {},
): { ui: UI; root: HTMLElement; sim: FakeSim; frame: () => void } {
  // Set before mounting: `createScale` samples the viewport as it is built.
  setViewport(size);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sim = makeFakeSim({ run: makeRun(over) });
  const ui = createUI({ root, sim, screen: 'run', now: () => 0 });
  mounted = ui;
  host = root;
  const frame = (): void => ui.update(sim.run, makeDerived(sim.run), sim.meta);
  frame();
  return { ui, root, sim, frame };
}

const toggle = (root: HTMLElement): HTMLElement => must(root, TID.shopToggle);
const shop = (root: HTMLElement): HTMLElement => must(root, TID.shop);
const isOpen = (ui: UI): boolean => ui.el.hasAttribute('data-shop-open');

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
  setViewport([original.w, original.h]);
});

describe('which form the shop takes', () => {
  it('is a drawer on a short viewport and in the flow on a tall one', () => {
    // The pairs that matter: a landscape phone is `wide`-ish and short, a
    // portrait phone is `stacked` and tall. Keying the drawer to the layout put
    // it on exactly the wrong one of those two.
    expect(computeScale(...LANDSCAPE, 2).shop).toBe('drawer');
    expect(computeScale(...PORTRAIT, 2).shop).toBe('inline');
    expect(computeScale(...DESKTOP).shop).toBe('inline');
    expect(computeScale(667, 375, 2).shop).toBe('drawer');
    expect(computeScale(320, 568, 2).shop).toBe('inline');
  });

  it('writes the mode on the shell and offers the toggle only in drawer mode', () => {
    const landscape = mount(LANDSCAPE);
    expect(landscape.ui.el.hasAttribute('data-shop-drawer')).toBe(true);
    expect(toggle(landscape.root).hidden).toBe(false);
    landscape.ui.destroy();
    mounted = null;

    const portrait = mount(PORTRAIT);
    expect(portrait.ui.el.hasAttribute('data-shop-drawer')).toBe(false);
    expect(toggle(portrait.root).hidden).toBe(true);
  });

  it('follows a rotation, putting the shop back in the flow', () => {
    const { ui, root } = mount(LANDSCAPE);
    expect(ui.el.hasAttribute('data-shop-drawer')).toBe(true);

    setViewport(PORTRAIT);
    ui.resize();
    expect(ui.el.hasAttribute('data-shop-drawer')).toBe(false);
    expect(toggle(root).hidden).toBe(true);
    expect(shop(root).hasAttribute('inert'), 'an in-flow shop must be usable').toBe(false);
  });
});

describe('the drawer, open and shut', () => {
  it('opens on the toggle and shuts on the next press', () => {
    const { ui, root } = mount(LANDSCAPE);
    expect(isOpen(ui)).toBe(false);

    toggle(root).click();
    expect(isOpen(ui)).toBe(true);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');

    toggle(root).click();
    expect(isOpen(ui)).toBe(false);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('shuts on Escape', () => {
    const { ui, root } = mount(LANDSCAPE);
    toggle(root).click();
    expect(isOpen(ui)).toBe(true);

    key(document.activeElement ?? shop(root), 'Escape');
    expect(isOpen(ui)).toBe(false);
  });

  it('shuts when the scrim behind it is tapped', () => {
    const { ui, root } = mount(LANDSCAPE);
    toggle(root).click();
    expect(isOpen(ui)).toBe(true);

    must(root, TID.shopScrim).click();
    expect(isOpen(ui)).toBe(false);
  });

  it('shuts itself once the run stops running', () => {
    // Nothing is buyable outside `running`, and an open sheet would be holding
    // the board inert underneath a mandatory draft.
    const { ui, root, sim, frame } = mount(LANDSCAPE);
    toggle(root).click();
    expect(isOpen(ui)).toBe(true);

    sim.run.phase = 'drafting';
    sim.run.draftOffer = ['sonnet', 'haiku', 'opus'];
    frame();
    expect(isOpen(ui)).toBe(false);
  });
});

describe('the drawer takes the keyboard while it is open', () => {
  it('moves focus into the sheet and gives it back to the toggle', () => {
    const { root } = mount(LANDSCAPE);
    toggle(root).click();
    expect(document.activeElement).toBe(must(root, TID.tabAgents));

    toggle(root).click();
    expect(document.activeElement).toBe(toggle(root));
  });

  it('traps Tab from the last control back to the first, and back again', () => {
    const { root } = mount(LANDSCAPE, { slop: 5_000 });
    toggle(root).click();

    const first = must(root, TID.tabAgents);
    // Last focusable in the sheet: whatever the shop happens to end on. Read it
    // out of the DOM rather than naming a row, so a new control cannot make this
    // pass vacuously.
    const items = Array.from(
      shop(root).querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    expect(items.length, 'the sheet must have controls to trap').toBeGreaterThan(1);
    const last = items[items.length - 1]!;

    last.focus();
    const fwd = key(last, 'Tab');
    expect(fwd.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const back = key(first, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('holds the board behind the scrim inert, and hands it back on close', () => {
    const { root } = mount(LANDSCAPE);
    const board = must(root, TID.laptop).closest('.tm-col');
    expect(board, 'the board column must exist').not.toBeNull();

    toggle(root).click();
    expect(board!.hasAttribute('inert'), 'content behind the scrim must not be reachable').toBe(
      true,
    );
    expect(shop(root).hasAttribute('inert'), 'the open sheet itself must be reachable').toBe(false);

    toggle(root).click();
    expect(board!.hasAttribute('inert')).toBe(false);
  });

  it('keeps a shut sheet out of the tab ring', () => {
    // Shut, it is parked at translateY(100%) — off the bottom of the screen, and
    // an invisible shop must not be somewhere Tab can land.
    const { root } = mount(LANDSCAPE);
    expect(shop(root).hasAttribute('inert')).toBe(true);
    toggle(root).click();
    expect(shop(root).hasAttribute('inert')).toBe(false);
  });
});

describe('the drawer is inert where the shop is in the flow', () => {
  for (const [name, size] of [
    ['wide', DESKTOP],
    ['stacked portrait', PORTRAIT],
  ] as const) {
    it(`does nothing at all on a ${name} layout`, () => {
      const { ui, root } = mount(size);
      const board = must(root, TID.laptop).closest('.tm-col')!;

      // The toggle is hidden rather than merely unpainted: `focusables()` and the
      // e2e tab-ring test both key off the attribute, and a `display: none`
      // button that still counts as focusable is how the desktop tab order broke.
      expect(toggle(root).hidden).toBe(true);
      expect(q(root, TID.shopScrim)).not.toBeNull();

      // Pressing it anyway — or Escape — must not turn the shop into a sheet.
      toggle(root).click();
      expect(isOpen(ui)).toBe(false);
      key(window, 'Escape');
      expect(isOpen(ui)).toBe(false);

      // And nothing is inert: the shop is a normal part of the page, and the
      // board is still there to be clicked.
      expect(shop(root).hasAttribute('inert')).toBe(false);
      expect(board.hasAttribute('inert')).toBe(false);
      expect((must(root, tid(TID.agentRow, 'tab_autocomplete')) as HTMLButtonElement).isConnected).toBe(
        true,
      );
    });
  }
});
