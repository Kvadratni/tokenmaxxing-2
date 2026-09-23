/**
 * Integer pixel scaling.
 *
 * The canvas is 320x180. Everything in the chrome is sized in
 * `calc(N * var(--px))`, so picking one integer `--px` steps the entire layout
 * together and nothing lands on a half pixel.
 *
 * Three layouts:
 *   wide     HUD band over stage + rail, card strip under. 420 x 250 units.
 *   stacked  one 320-unit column: HUD, stage, strip, then the shop. Portrait.
 *   side     short screens (a phone on its side): the stage on the left, the
 *            HUD as a column beside it, the shop in a bottom drawer.
 *
 * Type is set in the pixel font (src/ui/pixel-font.ts) and sized in *glyph
 * pixels*, `--g`: one glyph pixel is a whole number of device pixels, about a
 * third of `--px`, never less than one CSS pixel. So the letters stay as crisp
 * as the canvas at every scale, at the price of text that is a little larger
 * or smaller than the layout around it between the integer steps. The CSS
 * wraps rather than clips for exactly that reason.
 */
import { layoutViewport, on } from './dom.ts';

export const UNITS_W_WIDE = 420;
export const UNITS_W_STACKED = 328;
export const UNITS_H = 250;
/**
 * Stacked height with the shop in the flow: topbar + the two-row HUD + 180 of
 * stage + the card strip + the shop rail underneath.
 */
export const UNITS_H_STACKED = 440;
/**
 * Stacked height with the shop in a drawer: the same column *minus* the shop.
 * Only ever used at a small `--px`, where the type floor makes the chrome
 * proportionally taller, so it errs generous.
 */
export const UNITS_H_STACKED_DRAWER = 290;
/**
 * Layout viewport height below which the shop cannot live in the flow: the
 * height a wide layout needs to reach `--px` 2. Below it the side rail is a
 * scale-1-ish sliver and stacking spends height the screen has not got, so the
 * shop becomes a bottom sheet. A height test on purpose: a landscape phone is
 * wide *and* short, and the short part is what matters.
 */
export const DRAWER_MAX_VH = 2 * UNITS_H + 24;
export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
/**
 * The side layout's budgets are in CSS pixels, not units: its HUD column and
 * the rows around the stage are type and touch targets, which do not shrink
 * with `--px`. Narrowest HUD column that still reads, and the height the
 * topbar, the card strip and the padding take off the stage.
 */
export const SIDE_HUD_MIN_PX = 230;
export const SIDE_CHROME_W_PX = 28;
export const SIDE_CHROME_H_PX = 124;

export type Layout = 'wide' | 'stacked' | 'side';
/** Whether the shop is a block in the flow or a bottom sheet. */
export type ShopMode = 'inline' | 'drawer';

export interface ScaleState {
  px: number;
  /** CSS pixels per glyph pixel of the pixel font (see `glyphPx`). */
  g: number;
  layout: Layout;
  shop: ShopMode;
}

/** Below this much extra room, a fractional scale is not worth the softness. */
const FRACTIONAL_THRESHOLD = 1.08;

/**
 * Size of one glyph pixel, in CSS pixels: a third of `--px`, rounded to whole
 * *device* pixels so the pixel font never renders between them, and never
 * under one CSS pixel (7px capitals) so a phone stays legible.
 */
export function glyphPx(px: number, dpr = 1): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const floor = Math.ceil(d - 1e-9);
  const device = Math.max(floor, Math.round((px * d) / 3));
  return device / d;
}

/** Largest scale the side layout can be drawn at inside `vw` x `vh`. */
function fitSide(vw: number, vh: number): number {
  return Math.min(
    Math.max(0, vw - SIDE_CHROME_W_PX - SIDE_HUD_MIN_PX) / 320,
    Math.max(0, vh - SIDE_CHROME_H_PX) / 180,
  );
}

/** Largest scale a given layout can be drawn at inside `vw` x `vh`. */
function fitFor(layout: 'wide' | 'stacked', vw: number, vh: number, shop: ShopMode): number {
  const padW = layout === 'wide' ? 32 : 12;
  const padH = layout === 'wide' ? 24 : 12;
  const unitsW = layout === 'wide' ? UNITS_W_WIDE : UNITS_W_STACKED;
  const unitsH =
    layout === 'wide' ? UNITS_H : shop === 'drawer' ? UNITS_H_STACKED_DRAWER : UNITS_H_STACKED;
  return Math.min(Math.max(0, vw - padW) / unitsW, Math.max(0, vh - padH) / unitsH);
}

/**
 * @param dpr Device pixel ratio. A fractional scale is only ever chosen when
 *   the display has pixels to spare (dpr >= 2), so on a 1x screen the art stays
 *   exactly integer-scaled and perfectly crisp.
 */
export function computeScale(vw: number, vh: number, dpr = 1): ScaleState {
  const scaleOf = (fit: number): number => {
    const floored = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.floor(fit)));
    const useFraction = dpr >= 2 && fit >= floored * FRACTIONAL_THRESHOLD;
    return useFraction ? Math.min(MAX_SCALE, fit) : floored;
  };
  const withG = (px: number, layout: Layout, shop: ShopMode): ScaleState => ({
    px,
    g: glyphPx(px, dpr),
    layout,
    shop,
  });

  // Short viewport: the shop becomes a bottom sheet. A phone on its side has
  // width to spare and no height, so the HUD moves beside the stage; anything
  // too narrow for that keeps the single column.
  if (vh < DRAWER_MAX_VH) {
    const column = scaleOf(fitFor('stacked', vw, vh, 'drawer'));
    const sideFit = fitSide(vw, vh);
    const side = scaleOf(sideFit);
    if (sideFit >= MIN_SCALE && side >= column) return withG(side, 'side', 'drawer');
    return withG(column, 'stacked', 'drawer');
  }

  // Whichever layout ends up bigger wins, wide on a tie; wide only competes if
  // it genuinely fits (on a 360px phone both clamp to MIN_SCALE, and a "tie"
  // handed the win to a layout 420 units wide).
  const fitWide = fitFor('wide', vw, vh, 'inline');
  const fitStacked = fitFor('stacked', vw, vh, 'inline');
  const wide = scaleOf(fitWide);
  const stacked = scaleOf(fitStacked);
  const wideFits = fitWide >= MIN_SCALE;
  const layout: Layout = wideFits && wide >= stacked ? 'wide' : 'stacked';
  return withG(layout === 'wide' ? wide : stacked, layout, 'inline');
}

export interface ScaleController {
  readonly px: number;
  readonly g: number;
  readonly layout: Layout;
  readonly shop: ShopMode;
  apply(): void;
  destroy(): void;
}

export function createScale(
  host: HTMLElement,
  onChange: (s: ScaleState) => void,
): ScaleController {
  let current: ScaleState = { px: 0, g: 0, layout: 'wide', shop: 'inline' };
  let queued = 0;

  /**
   * The *layout* viewport, not the visual one: on mobile Chrome the visual
   * viewport grows to fit overflowing content, and reading it fed back into a
   * bigger scale and more overflow.
   */
  const apply = (): void => {
    const m = layoutViewport();
    const vw = m.vw || 1024;
    const vh = m.vh || 768;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const next = computeScale(vw, vh, dpr);
    if (
      next.px === current.px &&
      next.g === current.g &&
      next.layout === current.layout &&
      next.shop === current.shop
    ) {
      return;
    }
    current = next;
    host.style.setProperty('--px', `${next.px}px`);
    host.style.setProperty('--g', `${next.g}px`);
    host.dataset['layout'] = next.layout;
    if (next.shop === 'drawer') host.dataset['shopDrawer'] = '';
    else delete host.dataset['shopDrawer'];
    onChange(next);
  };

  const schedule = (): void => {
    if (queued !== 0) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      apply();
    });
  };

  const offResize = on(window, 'resize', schedule);
  const offOrient = on(window, 'orientationchange', schedule);
  apply();

  return {
    get px() {
      return current.px;
    },
    get g() {
      return current.g;
    },
    get layout() {
      return current.layout;
    },
    get shop() {
      return current.shop;
    },
    apply,
    destroy() {
      if (queued !== 0) cancelAnimationFrame(queued);
      queued = 0;
      offResize();
      offOrient();
    },
  };
}
