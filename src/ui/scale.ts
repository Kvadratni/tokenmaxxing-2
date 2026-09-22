/**
 * Integer pixel scaling.
 *
 * The canvas is 320x180. Everything in the chrome is sized in
 * `calc(N * var(--px))`, so picking one integer `--px` steps the entire layout
 * together and nothing lands on a half pixel.
 *
 * Design budget, in canvas pixels:
 *   wide   320 canvas + 8 gap + 76 rail            = 404 units across
 *   height 180 canvas + 70 units of chrome         = 250 units down
 */
import { layoutViewport, on } from './dom.ts';

export const UNITS_W_WIDE = 404;
export const UNITS_W_STACKED = 328;
export const UNITS_H = 250;
/**
 * Stacked height with the shop in the flow: topbar + HUD + 180 of stage + the
 * shop rail + the card strip.
 *
 * This was 236, which is roughly the wide-layout height and nowhere near the
 * truth — measured at 417. Under-stating it meant the height term never
 * constrained anything, so a landscape phone chose a scale whose layout was 171%
 * of the screen and you had to scroll to reach the shop.
 */
export const UNITS_H_STACKED = 420;
/**
 * Stacked height with the shop in a drawer: the same column *minus* the shop.
 *
 * Measured empirically; the min-font-size floors mean the chrome is
 * proportionally taller at low scale, so this errs generous. Note it is *more*
 * than `UNITS_H` (250) for the same content: the drawer only ever applies at a
 * small `--px`, where the floors have kicked in.
 */
export const UNITS_H_STACKED_DRAWER = 268;
/**
 * Layout viewport height below which the shop cannot live in the flow.
 *
 * `2 * UNITS_H + 24` is the height a wide layout needs to reach `--px` 2. Below
 * that the side rail is 104 units of a scale-1-ish pixel — about 150 real
 * pixels — while the type has a 10px floor, so every row wrapped mid-word; and
 * stacking instead spends 420 units of height the viewport does not have. Above
 * it there is room for the shop where you can see it without a tap, which is
 * where it belongs: a portrait phone is *width*-bound, so keeping the shop in
 * the flow there costs it no scale at all.
 *
 * Deliberately a height test, not `data-layout`: a landscape phone resolves to
 * `wide`, so keying the drawer to `stacked` put it on exactly the wrong screens.
 */
export const DRAWER_MAX_VH = 2 * UNITS_H + 24;
/**
 * Legacy width-only threshold, kept for callers that still reference it. The
 * layout is now chosen by which one actually fits (see `computeScale`), because
 * a 844x390 landscape phone is under this width yet far too short to stack.
 */
export const STACK_BREAKPOINT = 860;
export const MIN_SCALE = 1;
export const MAX_SCALE = 6;

export type Layout = 'wide' | 'stacked';
/** Whether the shop is a block in the flow or a bottom sheet. */
export type ShopMode = 'inline' | 'drawer';

export interface ScaleState {
  px: number;
  layout: Layout;
  shop: ShopMode;
}

/** Below this much extra room, a fractional scale is not worth the softness. */
const FRACTIONAL_THRESHOLD = 1.08;

/**
 * @param dpr Device pixel ratio. A fractional scale is only ever chosen when
 *   the display has pixels to spare (dpr >= 2), so on a 1x screen the art stays
 *   exactly integer-scaled and perfectly crisp.
 */
/** Largest scale a given layout can be drawn at inside `vw` x `vh`. */
function fitFor(layout: Layout, vw: number, vh: number, shop: ShopMode): number {
  const padW = layout === 'wide' ? 32 : 12;
  const padH = layout === 'wide' ? 24 : 12;
  const unitsW = layout === 'wide' ? UNITS_W_WIDE : UNITS_W_STACKED;
  const unitsH =
    layout === 'wide'
      ? UNITS_H
      : shop === 'drawer'
        ? UNITS_H_STACKED_DRAWER
        : UNITS_H_STACKED;
  return Math.min(Math.max(0, vw - padW) / unitsW, Math.max(0, vh - padH) / unitsH);
}

export function computeScale(vw: number, vh: number, dpr = 1): ScaleState {
  /*
   * Whichever orientation fits bigger wins, rather than a width threshold.
   * Stacking is about *aspect*, not width: a 844x390 landscape phone is narrower
   * than the old 860px breakpoint yet nowhere near tall enough to stack, and
   * stacking it wasted half the screen while overflowing vertically.
   */
  const scaleOf = (fit: number): number => {
    const floored = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.floor(fit)));
    const useFraction = dpr >= 2 && fit >= floored * FRACTIONAL_THRESHOLD;
    return useFraction ? Math.min(MAX_SCALE, fit) : floored;
  };

  /*
   * Short viewport: the shop becomes a bottom sheet and there is only one layout
   * left to pick. With the shop out of the flow the side rail is gone, so the
   * board is a single column either way — and the column's honest height budget
   * at this scale is the stacked one, not `UNITS_H`. Taking `UNITS_H` here looks
   * like it buys a bigger scale (1.46 against 1.41 on a 844x390 phone) but the
   * chrome then overflows the bottom of the screen and takes Ship It with it.
   */
  if (vh < DRAWER_MAX_VH) {
    return {
      px: scaleOf(fitFor('stacked', vw, vh, 'drawer')),
      layout: 'stacked',
      shop: 'drawer',
    };
  }

  /*
   * Compare the scale each layout would actually end up at, and prefer wide on a
   * tie. Comparing the raw fits instead flipped a 900x600 window to stacked on a
   * 2% margin when both round to the same scale — the side rail is nicer there.
   * A tablet in landscape still stacks, because there stacked genuinely wins
   * (scale 3 against 2.88).
   */
  const fitWide = fitFor('wide', vw, vh, 'inline');
  const fitStacked = fitFor('stacked', vw, vh, 'inline');
  const wide = scaleOf(fitWide);
  const stacked = scaleOf(fitStacked);
  /*
   * Wide only competes if it genuinely fits. On a 360px phone both layouts clamp
   * to MIN_SCALE, and treating that as a tie handed the win to wide — which then
   * needs 404 units in 360px and overflowed by 13px.
   */
  const wideFits = fitWide >= MIN_SCALE;
  const layout: Layout = wideFits && wide >= stacked ? 'wide' : 'stacked';
  const px = layout === 'wide' ? wide : stacked;

  /*
   * Integer scaling alone cannot fill a phone. The stacked design is 328 units
   * wide, so scale 2 needs 656px — no phone has that, which pinned every handset
   * at scale 1 and left a 430px screen using 84% of its width and a 932x430
   * landscape using 43%, with the shop rail squeezed to one character per line.
   *
   * So where the display has pixels to spare, take the exact fit instead of the
   * floor. At dpr 3 a 1.27x scale puts ~3.8 device pixels behind every art pixel
   * — the non-integrality is not visible — while the whole layout grows
   * uniformly because every chrome dimension is `calc(N * var(--px))`. On a 1x
   * display the floor is kept, because there the softness would show.
   */
  return { px, layout, shop: 'inline' };
}

export interface ScaleController {
  readonly px: number;
  readonly layout: Layout;
  readonly shop: ShopMode;
  apply(): void;
  destroy(): void;
}

export function createScale(
  host: HTMLElement,
  onChange: (s: ScaleState) => void,
): ScaleController {
  let current: ScaleState = { px: 0, layout: 'wide', shop: 'inline' };
  let queued = 0;

  /**
   * The *layout* viewport, not the visual one.
   *
   * `window.innerWidth` is the visual viewport, and on mobile Chrome that
   * **expands to fit overflowing content**. Reading it created a feedback loop:
   * content overflows a little -> innerWidth grows -> a larger integer scale is
   * chosen -> the 320-unit stage renders wider -> more overflow. On a 390px
   * phone it settled at innerWidth 515 with a scale of 2, a 640px-wide stage,
   * and 125px of horizontal scroll. `documentElement.clientWidth` stays honest
   * at 390 and breaks the loop.
   */
  const apply = (): void => {
    const m = layoutViewport();
    const vw = m.vw || 1024;
    const vh = m.vh || 768;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const next = computeScale(vw, vh, dpr);
    if (
      next.px === current.px &&
      next.layout === current.layout &&
      next.shop === current.shop
    ) {
      return;
    }
    current = next;
    host.style.setProperty('--px', `${next.px}px`);
    host.dataset['layout'] = next.layout;
    // Presence, not a value: the stylesheet only ever asks whether the shop is a
    // drawer, and `[data-shop-drawer]` reads better than `="1"` at every use.
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
