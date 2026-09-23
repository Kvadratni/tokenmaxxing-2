/**
 * Layout choice and the shop drawer.
 *
 * Which layout, and whether the shop is a drawer, is decided by the viewport
 * (src/ui/scale.ts): wide on a desktop, a single stacked column on a portrait
 * phone, and on anything short (a phone on its side) the side layout, with
 * the HUD beside the stage and the shop in a bottom drawer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TID, tid } from '../../src/testids.ts';
import { focusables } from '../../src/ui/dom.ts';
import { computeScale, DRAWER_MAX_VH, glyphPx, UNITS_W_STACKED } from '../../src/ui/scale.ts';
import { key, makeRun, mountUI, must, q, unmountAll } from './ui.fake-sim.ts';

/** Phone on its side: short, so the shop is a bottom sheet. */
const LANDSCAPE = [844, 390] as const;
/** Phone upright: height to spare, so the shop stays in the flow. */
const PORTRAIT = [390, 844] as const;
/** Desktop: the shop is a side rail. */
const DESKTOP = [1440, 900] as const;

const original = { w: window.innerWidth, h: window.innerHeight };

/**
 * happy-dom reports `documentElement.clientWidth` as 0, so `layoutViewport()`
 * falls through to `innerWidth`/`innerHeight`, which a test can set.
 */
function setViewport([vw, vh]: readonly [number, number]): void {
  (window as unknown as { innerWidth: number }).innerWidth = vw;
  (window as unknown as { innerHeight: number }).innerHeight = vh;
}

function mountAt(size: readonly [number, number], run = makeRun({ tokens: 5_000 })) {
  setViewport(size);
  return mountUI({ run, upgrades: ['streaming'] });
}

afterEach(() => {
  unmountAll();
  setViewport([original.w, original.h]);
});

const toggle = (root: HTMLElement): HTMLElement => must(root, TID.shopToggle);
const shop = (root: HTMLElement): HTMLElement => must(root, TID.shop);
const isOpen = (el: HTMLElement): boolean => el.hasAttribute('data-shop-open');

describe('layout', () => {
  it('is wide on a desktop, stacked on a portrait phone, side on a landscape one', () => {
    expect(computeScale(...DESKTOP)).toMatchObject({ layout: 'wide', shop: 'inline', px: 3 });
    expect(computeScale(...PORTRAIT, 3)).toMatchObject({ layout: 'stacked', shop: 'inline' });
    expect(computeScale(...LANDSCAPE, 3)).toMatchObject({ layout: 'side', shop: 'drawer' });
    expect(computeScale(667, 375, 2)).toMatchObject({ layout: 'side', shop: 'drawer' });
    expect(computeScale(1920, 1080)).toMatchObject({ layout: 'wide', px: 4 });
  });

  it('fits a 320px phone: the stacked column is 320 units at scale 1', () => {
    const s = computeScale(320, 568, 2);
    expect(s.layout).toBe('stacked');
    expect(s.px).toBe(1);
    expect(UNITS_W_STACKED - 8).toBe(320);
  });

  it('only goes to a drawer on a short viewport', () => {
    expect(computeScale(1280, DRAWER_MAX_VH).shop).toBe('inline');
    expect(computeScale(1280, DRAWER_MAX_VH - 1).shop).toBe('drawer');
    // Too narrow to put the HUD beside the stage: one column, still a drawer.
    expect(computeScale(420, 400, 2)).toMatchObject({ layout: 'stacked', shop: 'drawer' });
  });

  it('sizes a glyph pixel in whole device pixels, never under one CSS pixel', () => {
    expect(glyphPx(3, 1)).toBe(1);
    expect(glyphPx(6, 1)).toBe(2);
    expect(glyphPx(1, 3)).toBe(1);
    expect(glyphPx(4.5, 2)).toBe(1.5);
    for (const [px, dpr] of [
      [1.27, 3],
      [3.35, 2],
      [2.3, 2],
      [5, 1],
    ] as const) {
      const g = glyphPx(px, dpr);
      expect(Number.isInteger(Math.round(g * dpr * 1e6) / 1e6), `${px}@${dpr}`).toBe(true);
      expect(g).toBeGreaterThanOrEqual(1);
    }
  });

  it('writes the layout, the scales and the drawer flag on the shell', () => {
    const m = mountAt(LANDSCAPE);
    expect(m.ui.el.dataset['layout']).toBe('side');
    expect(m.ui.el.hasAttribute('data-shop-drawer')).toBe(true);
    expect(m.ui.el.style.getPropertyValue('--px')).toMatch(/px$/);
    expect(m.ui.el.style.getPropertyValue('--g')).toMatch(/px$/);
    expect(m.sent('scale').length).toBeGreaterThan(0);
  });

  it('follows a rotation, putting the shop back in the flow', () => {
    const m = mountAt(LANDSCAPE);
    setViewport(PORTRAIT);
    m.ui.resize();
    expect(m.ui.el.dataset['layout']).toBe('stacked');
    expect(m.ui.el.hasAttribute('data-shop-drawer')).toBe(false);
    expect(toggle(m.root).hidden).toBe(true);
    expect(shop(m.root).hasAttribute('inert'), 'an in-flow shop must be usable').toBe(false);
  });
});

describe('the drawer, open and shut', () => {
  it('opens on the toggle and shuts on the next press', () => {
    const m = mountAt(LANDSCAPE);
    expect(isOpen(m.ui.el)).toBe(false);
    toggle(m.root).click();
    expect(isOpen(m.ui.el)).toBe(true);
    expect(toggle(m.root).getAttribute('aria-expanded')).toBe('true');
    toggle(m.root).click();
    expect(isOpen(m.ui.el)).toBe(false);
  });

  it('shuts on Escape and on the scrim', () => {
    const m = mountAt(LANDSCAPE);
    toggle(m.root).click();
    key(document.activeElement ?? shop(m.root), 'Escape');
    expect(isOpen(m.ui.el)).toBe(false);
    toggle(m.root).click();
    must(m.root, TID.shopScrim).click();
    expect(isOpen(m.ui.el)).toBe(false);
  });

  it('shuts itself once the run stops running', () => {
    const m = mountAt(LANDSCAPE);
    toggle(m.root).click();
    m.sim.run.phase = 'drafting';
    m.sim.run.draftOffer = ['please', 'thank_you', 'grandma'];
    m.frame();
    expect(isOpen(m.ui.el)).toBe(false);
  });

  it('lets Space activate a focused button in the open sheet', () => {
    const m = mountAt(LANDSCAPE);
    toggle(m.root).click();
    const e = key(document.activeElement ?? shop(m.root), ' ');
    expect(e.defaultPrevented).toBe(false);
    expect(m.sent('canvasKey')).toHaveLength(0);
  });
});

describe('the drawer takes the keyboard while it is open', () => {
  it('moves focus into the sheet and gives it back to the toggle', () => {
    const m = mountAt(LANDSCAPE);
    toggle(m.root).click();
    expect(document.activeElement).toBe(must(m.root, TID.tabTools));
    toggle(m.root).click();
    expect(document.activeElement).toBe(toggle(m.root));
  });

  it('traps Tab from the last control back to the first, and back again', () => {
    const m = mountAt(LANDSCAPE);
    toggle(m.root).click();
    const first = must(m.root, TID.tabTools);
    // The same rule the trap uses: controls on the hidden tab are not in the ring.
    const items = focusables(shop(m.root));
    expect(items.length, 'the sheet must have controls to trap').toBeGreaterThan(1);
    const last = items[items.length - 1]!;
    last.focus();
    expect(key(last, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(key(first, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('holds everything behind the scrim inert, and hands it back on close', () => {
    const m = mountAt(LANDSCAPE);
    const behind = [must(m.root, TID.scene).closest('.tm-stage')!, m.root.querySelector('.tm-hud')!];
    toggle(m.root).click();
    for (const node of behind) expect(node.hasAttribute('inert')).toBe(true);
    expect(shop(m.root).hasAttribute('inert')).toBe(false);
    toggle(m.root).click();
    for (const node of behind) expect(node.hasAttribute('inert')).toBe(false);
  });

  it('keeps a shut sheet out of the tab ring', () => {
    const m = mountAt(LANDSCAPE);
    expect(shop(m.root).hasAttribute('inert')).toBe(true);
    toggle(m.root).click();
    expect(shop(m.root).hasAttribute('inert')).toBe(false);
  });
});

describe('the drawer does nothing where the shop is in the flow', () => {
  for (const [name, size] of [
    ['wide', DESKTOP],
    ['stacked portrait', PORTRAIT],
  ] as const) {
    it(`on a ${name} layout`, () => {
      const m = mountAt(size);
      expect(toggle(m.root).hidden).toBe(true);
      expect(q(m.root, TID.shopScrim)).not.toBeNull();
      toggle(m.root).click();
      expect(isOpen(m.ui.el)).toBe(false);
      key(window, 'Escape');
      expect(isOpen(m.ui.el)).toBe(false);
      expect(shop(m.root).hasAttribute('inert')).toBe(false);
      expect(must(m.root, tid(TID.toolRow, 'grep')).isConnected).toBe(true);
    });
  }
});
