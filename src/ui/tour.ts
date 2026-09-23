/**
 * The first-run guided tour: a spotlight over one thing at a time, and a
 * tooltip beside it that says what the thing is.
 *
 *   const tour = createTour(uiRoot, host);
 *   tour.start();       // NEW SESSION on a device that has never seen it, or Replay
 *   tour.update();      // every frame: follows its targets as the chrome moves
 *   tour.noteClick();   // the sim registered a click on the agent
 *
 * While it is open the host holds the clock (`ui.holdsClock`): no sim ticks, so
 * the human's patience does not drain while the player reads. Input still takes
 * the normal path. On the "this is you" step a click on the agent is a real
 * click, and the sim registers it with time frozen.
 *
 * The spotlight is a set of dim panels that tile everything *except* the
 * cut-outs (`shadeRects`), so a target is never painted over and never loses
 * its pointer events. An amber ring sits in each cut-out's padding, clear of
 * the target, and the tooltip goes beside the first cut-out and never over any
 * of them (`placeTooltip`). Both are pure, so they are tested without a layout
 * engine. Layout is read on a step change, on resize and scale changes, and
 * once a frame while the tour is open; the DOM is only written when a rect
 * actually moved.
 *
 * The steps and their copy live in tour-steps.ts.
 */
import '../styles/tour.css';

import { TID, tid } from '../testids.ts';
import { btn, el, focusables, layoutViewport, on, trapTab } from './dom.ts';
import { TOUR_KEY, TOUR_STEPS, type TourSide, type TourStep } from './tour-steps.ts';
import type { UIAction } from './types.ts';

export { TOUR_CLICKS, TOUR_KEY, TOUR_STEPS } from './tour-steps.ts';
export type { TourSide, TourStep } from './tour-steps.ts';

/** How long "3/3" stays up before the interactive step moves on by itself. */
export const TOUR_ADVANCE_MS = 450;
/** How long the card waits for the shop drawer to finish sliding (ui.css: 220ms). */
export const TOUR_SETTLE_MS = 240;
/** Room between a target and the edge of its cut-out. The ring sits in it. */
export const TOUR_PAD = 5;
/** Gap between the tooltip and its cut-out. */
export const TOUR_GAP = 10;
/** The tooltip's keep-out margin from the edges of the viewport. */
export const TOUR_MARGIN = 8;
/**
 * The stage floor in 320x180 scene pixels: the bottom of the glass and the
 * bezel the agent stands on, where the token pile grows. Scene space so it
 * scales with the canvas; the prompt line under it stays out.
 */
export const FLOOR_BAND = { x: 6, y: 134, w: 308, h: 33 } as const;
/** Two cut-outs merge when one frame around both is at most this much bigger. */
export const MERGE_SLACK = 1.35;

// ---------------------------------------------------------------------------
// Geometry. Pure, so the tests can hold it to account without a browser.
// ---------------------------------------------------------------------------

/** A viewport rectangle, the shape `getBoundingClientRect()` returns. */
export interface TourRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export function box(left: number, top: number, width: number, height: number): TourRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const span = (l: number, t: number, r: number, b: number): TourRect => box(l, t, r - l, b - t);

export function union(a: TourRect, b: TourRect): TourRect {
  return span(Math.min(a.left, b.left), Math.min(a.top, b.top), Math.max(a.right, b.right), Math.max(a.bottom, b.bottom));
}

/** Grown by `by` on every side and snapped outwards to whole pixels, so a cut-out never shaves its target. */
export function inflate(r: TourRect, by: number): TourRect {
  return span(Math.floor(r.left - by), Math.floor(r.top - by), Math.ceil(r.right + by), Math.ceil(r.bottom + by));
}

/** The part of `r` inside the viewport, or null when none of it is. */
export function clip(r: TourRect, vw: number, vh: number): TourRect | null {
  const l = Math.max(0, r.left);
  const t = Math.max(0, r.top);
  const rr = Math.min(vw, r.right);
  const b = Math.min(vh, r.bottom);
  return rr > l && b > t ? span(l, t, rr, b) : null;
}

export function intersects(a: TourRect, b: TourRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

const area = (r: TourRect): number => Math.max(0, r.width) * Math.max(0, r.height);

function overlapArea(a: TourRect, b: TourRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Distance between two rectangles' nearest edges; 0 when they touch or overlap. */
function distance(a: TourRect, b: TourRect): number {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
}

/**
 * Cut-outs that overlap, or sit so close that one frame around both is barely
 * bigger than the two apart (`slack`), become one. Order is kept: the first
 * cut-out is the one the tooltip points at.
 */
export function mergeHoles(holes: readonly TourRect[], slack = MERGE_SLACK): TourRect[] {
  const out = holes.slice();
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const u = union(a, b);
        if (intersects(a, b) || area(u) <= slack * (area(a) + area(b))) {
          out[i] = u;
          out.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * The dim, as rectangles that tile the viewport except the cut-outs: a band
 * between every pair of cut-out edges, and in each band whatever no cut-out
 * covers. Bands that line up are stacked into one panel. Nothing is ever drawn
 * over a cut-out.
 */
export function shadeRects(vw: number, vh: number, holes: readonly TourRect[]): TourRect[] {
  const cuts = holes.map((h) => clip(h, vw, vh)).filter((h): h is TourRect => h !== null);
  const ys = Array.from(new Set([0, vh, ...cuts.flatMap((h) => [h.top, h.bottom])])).sort((a, b) => a - b);
  const bands: TourRect[] = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const y0 = ys[k]!;
    const y1 = ys[k + 1]!;
    if (y1 <= y0) continue;
    const xs = cuts
      .filter((h) => h.top < y1 && h.bottom > y0)
      .map((h) => [h.left, h.right] as const)
      .sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const [l, r] of xs) {
      if (l > x) bands.push(span(x, y0, l, y1));
      x = Math.max(x, r);
    }
    if (x < vw) bands.push(span(x, y0, vw, y1));
  }
  const out: TourRect[] = [];
  for (const r of bands) {
    const k = out.findIndex((o) => o.left === r.left && o.right === r.right && o.bottom === r.top);
    if (k >= 0) out[k] = span(out[k]!.left, out[k]!.top, r.right, r.bottom);
    else out.push(r);
  }
  return out;
}

export interface TourPlacement {
  readonly left: number;
  readonly top: number;
  /**
   * Where the tooltip landed against the first cut-out. `center` when nothing
   * is lit; `free` when no side fitted and it went to the nearest open spot.
   */
  readonly side: TourSide | 'center' | 'free';
}

const OPPOSITE: Readonly<Record<TourSide, TourSide>> = { above: 'below', below: 'above', left: 'right', right: 'left' };

function sideOrder(a: TourRect, prefer: TourSide | null): TourSide[] {
  const base: TourSide[] = a.width >= a.height ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'below', 'above'];
  if (prefer === null) return base;
  const first: TourSide[] = [prefer, OPPOSITE[prefer]];
  return [...first, ...base.filter((s) => !first.includes(s))];
}

/** `from`, `from + step`, ..., always ending exactly on `to`. */
function steps(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v < to; v += step) out.push(v);
  out.push(to);
  return out;
}

/**
 * Where a `w` x `h` tooltip goes. Beside the first cut-out: the preferred side
 * first, then its opposite, then the other two, each centred on the target
 * and then slid to either end of it. A spot counts only if it is inside the
 * viewport and clear of every cut-out. When no side has room (a tall target on
 * a short screen), the free spot nearest the target; when nothing on screen is
 * free, the spot that covers the least. With nothing lit, the middle.
 */
export function placeTooltip(
  holes: readonly TourRect[],
  w: number,
  h: number,
  vw: number,
  vh: number,
  prefer: TourSide | null = null,
  gap = TOUR_GAP,
  margin = TOUR_MARGIN,
): TourPlacement {
  const maxX = Math.max(margin, vw - w - margin);
  const maxY = Math.max(margin, vh - h - margin);
  const cx = (x: number): number => Math.round(Math.max(margin, Math.min(maxX, x)));
  const cy = (y: number): number => Math.round(Math.max(margin, Math.min(maxY, y)));
  const anchor = holes[0];
  if (anchor === undefined) return { left: cx((vw - w) / 2), top: cy((vh - h) / 2), side: 'center' };

  const inside = (x: number, y: number): boolean =>
    x >= margin - 0.5 && y >= margin - 0.5 && x + w <= vw - margin + 0.5 && y + h <= vh - margin + 0.5;
  const clear = (x: number, y: number): boolean => {
    const t = box(x, y, w, h);
    return !holes.some((c) => intersects(c, t));
  };

  for (const side of sideOrder(anchor, prefer)) {
    let spots: Array<readonly [number, number]>;
    if (side === 'below' || side === 'above') {
      const y = Math.round(side === 'below' ? anchor.bottom + gap : anchor.top - gap - h);
      spots = [cx(anchor.left + anchor.width / 2 - w / 2), cx(anchor.left), cx(anchor.right - w)].map((x) => [x, y] as const);
    } else {
      const x = Math.round(side === 'right' ? anchor.right + gap : anchor.left - gap - w);
      spots = [cy(anchor.top + anchor.height / 2 - h / 2), cy(anchor.top), cy(anchor.bottom - h)].map((y) => [x, y] as const);
    }
    for (const [x, y] of spots) {
      if (inside(x, y) && clear(x, y)) return { left: x, top: y, side };
    }
  }

  // Nothing beside it: scan the screen. Covering any cut-out costs more than
  // any distance, so a free spot always wins; among those, the one nearest
  // `gap` away from the target.
  let best = { x: maxX, y: maxY, cost: Infinity };
  for (const y of steps(margin, maxY, 4)) {
    for (const x of steps(margin, maxX, 4)) {
      const t = box(x, y, w, h);
      let covered = 0;
      for (const c of holes) covered += overlapArea(c, t);
      const cost = covered * 1e6 + Math.abs(distance(t, anchor) - gap);
      if (cost < best.cost) best = { x, y, cost };
    }
  }
  return { left: Math.round(best.x), top: Math.round(best.y), side: 'free' };
}

// ---------------------------------------------------------------------------
// Seen
// ---------------------------------------------------------------------------

/** The two calls the tour needs from Web Storage. */
export type TourStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** `localStorage`, where there is a usable one (not in private mode, not a stub). */
export function browserStorage(): TourStorage | null {
  try {
    const s = globalThis.localStorage as Partial<Storage> | undefined;
    return s !== undefined && typeof s.getItem === 'function' && typeof s.setItem === 'function'
      ? (s as TourStorage)
      : null;
  } catch {
    return null;
  }
}

/** Whether this browser has finished or skipped the tour. */
export function tourSeen(storage: TourStorage | null): boolean {
  try {
    return storage?.getItem(TOUR_KEY) != null;
  } catch {
    return false;
  }
}

export function markTourSeen(storage: TourStorage | null): void {
  try {
    storage?.setItem(TOUR_KEY, '1');
  } catch {
    /* storage full or refused: the tour remembers for this page anyway */
  }
}

// ---------------------------------------------------------------------------
// The tour
// ---------------------------------------------------------------------------

export type TourEnd = 'done' | 'skip' | 'closed';

export interface TourHost {
  /** Where "seen" is kept (`TOUR_KEY`). Null: nowhere, so only for this page. */
  readonly storage: TourStorage | null;
  /** The live element for a testid, or null. */
  find(testid: string): HTMLElement | null;
  /** Player input that goes the normal way: Space on the interactive step. */
  emit(a: UIAction): void;
  /**
   * Open or shut the shop drawer without moving focus. A no-op where the shop
   * is in the flow. True when the drawer actually moved.
   */
  setDrawer(open: boolean): boolean;
  reducedMotion(): boolean;
  /** The tour opened: anything else floating over the board should stand down. */
  onOpen?(): void;
  /** It ended: finished (`done`), skipped, or closed under it by a screen change. */
  onClose?(how: TourEnd): void;
}

export interface Tour {
  /** `TID.tour`: the full-viewport layer. `hidden` while the tour is shut. */
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  /** The step on screen, or null while shut. */
  readonly step: TourStep | null;
  /** Index into TOUR_STEPS; -1 while shut. */
  readonly index: number;
  /** Finished or skipped in this browser (or on this page, where storage is off). */
  readonly seen: boolean;
  /** Open at the first step (or go back to it). */
  start(): void;
  next(): void;
  back(): void;
  /** Leave for good: marks it seen. */
  skip(): void;
  /** Take it down without marking it seen: the run screen went away under it. */
  close(): void;
  /** A click the sim registered. Counts on the interactive step. */
  noteClick(): void;
  /** Per frame. Follows the targets, and the reduced-motion setting. Cheap when nothing moved. */
  update(): void;
  /** Re-measure and re-place now: a resize, a new `--px`, a rotation. */
  reflow(): void;
  destroy(): void;
}

interface Measured {
  readonly vw: number;
  readonly vh: number;
  readonly w: number;
  readonly h: number;
  readonly cuts: readonly TourRect[];
  readonly sig: string;
}

class GuidedTour implements Tour {
  readonly el: HTMLElement;

  private readonly shadeLayer: HTMLElement;
  private readonly ringLayer: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly count: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly nextLabel: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly shades: HTMLElement[] = [];
  private readonly rings: HTMLElement[] = [];
  /** Last geometry written to each pooled node, so an unchanged frame writes nothing. */
  private readonly written = new WeakMap<HTMLElement, string>();
  private readonly disposers: Array<() => void> = [];
  private readonly live: Array<() => void> = [];

  private clicksEl: HTMLElement | null = null;
  private i = -1;
  private clicks = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private sig = '';
  private pulse: boolean | null = null;
  private seenHere = false;
  private destroyed = false;

  constructor(
    parent: HTMLElement,
    private readonly host: TourHost,
  ) {
    this.el = el('div', { cls: 'tm-tour', tid: TID.tour, parent });
    this.el.setAttribute('hidden', '');
    this.shadeLayer = el('div', { cls: 'tm-tour__layer', parent: this.el, attrs: { 'aria-hidden': 'true' } });
    this.ringLayer = el('div', { cls: 'tm-tour__layer', parent: this.el, attrs: { 'aria-hidden': 'true' } });

    this.tip = el('div', {
      cls: 'tm-tour__tip',
      tid: tid(TID.tourStep, TOUR_STEPS[0]?.id ?? ''),
      parent: this.el,
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'tm-tour-title',
        'aria-describedby': 'tm-tour-body',
        // Clicking the copy focuses the card, not <body>: the keys keep working.
        tabindex: '-1',
      },
    });
    const text = el('div', { cls: 'tm-tour__text', parent: this.tip, attrs: { 'aria-live': 'polite' } });
    const head = el('div', { cls: 'tm-tour__head', parent: text });
    this.count = el('span', { cls: 'tm-tour__count', parent: head });
    // The keys, the way the top bar's legend writes them. Not on a phone.
    const keys = el('span', { cls: 'tm-tour__keys', parent: head, attrs: { 'aria-hidden': 'true' } });
    el('kbd', { text: '←', parent: keys });
    el('kbd', { text: '→', parent: keys });
    el('span', { text: 'step', parent: keys });
    el('kbd', { text: 'Esc', parent: keys });
    el('span', { text: 'skip', parent: keys });
    this.title = el('h2', { cls: 'tm-tour__title', parent: text, attrs: { id: 'tm-tour-title' } });
    this.body = el('p', { cls: 'tm-tour__body', parent: text, attrs: { id: 'tm-tour-body' } });

    const foot = el('div', { cls: 'tm-tour__foot', parent: this.tip });
    this.skipBtn = btn({
      cls: 'tm-btn tm-btn--quiet tm-tour__skip',
      tid: TID.tourSkip,
      text: 'Skip tour',
      parent: foot,
      attrs: { 'aria-keyshortcuts': 'Escape' },
    });
    el('span', { cls: 'tm-spacer', parent: foot });
    this.backBtn = btn({
      cls: 'tm-btn',
      tid: TID.tourBack,
      text: 'Back',
      parent: foot,
      attrs: { 'aria-keyshortcuts': 'ArrowLeft' },
    });
    this.nextBtn = btn({
      cls: 'tm-btn tm-btn--primary',
      tid: TID.tourNext,
      parent: foot,
      attrs: { 'aria-keyshortcuts': 'ArrowRight Enter' },
    });
    this.nextLabel = el('span', { text: 'Next', parent: this.nextBtn });

    // A press on the dim does nothing, and must not blur the card either.
    const hold = (ev: Event): void => ev.preventDefault();
    this.disposers.push(
      on(this.nextBtn, 'click', () => this.next()),
      on(this.backBtn, 'click', () => this.back()),
      on(this.skipBtn, 'click', () => this.skip()),
      on(this.shadeLayer, 'mousedown', hold),
      on(this.shadeLayer, 'pointerdown', hold),
    );
  }

  get isOpen(): boolean {
    return this.i >= 0;
  }

  get index(): number {
    return this.i;
  }

  get step(): TourStep | null {
    return this.i >= 0 ? (TOUR_STEPS[this.i] ?? null) : null;
  }

  get seen(): boolean {
    return this.seenHere || tourSeen(this.host.storage);
  }

  start(): void {
    if (this.destroyed || TOUR_STEPS.length === 0) return;
    if (!this.isOpen) {
      this.el.removeAttribute('hidden');
      this.live.push(
        // Capture, on the window: the tour hears a key before anything else can.
        on(window, 'keydown', (ev) => this.onKeyDown(ev as KeyboardEvent), { capture: true }),
        on(window, 'keyup', (ev) => this.onKeyUp(ev as KeyboardEvent), { capture: true }),
        on(document, 'focusin', (ev) => this.onFocusIn(ev), { capture: true }),
        on(window, 'resize', () => this.reflow()),
        on(window, 'scroll', () => this.reflow(), { capture: true, passive: true }),
      );
      this.syncPulse();
      this.host.onOpen?.();
    }
    this.show(0);
  }

  next(): void {
    if (!this.isOpen) return;
    if (this.i >= TOUR_STEPS.length - 1) this.end('done');
    else this.show(this.i + 1);
  }

  back(): void {
    if (this.isOpen && this.i > 0) this.show(this.i - 1);
  }

  skip(): void {
    this.end('skip');
  }

  close(): void {
    this.end('closed');
  }

  noteClick(): void {
    const step = this.step;
    if (step === null || step.clicks === undefined) return;
    this.clicks = Math.min(step.clicks, this.clicks + 1);
    this.clicksEl?.replaceChildren(`${this.clicks}/${step.clicks}`);
    if (this.clicks < step.clicks || this.timer !== null) return;
    // "3/3" stays up for a beat, so the player sees they did it.
    const at = this.i;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.i === at) this.next();
    }, TOUR_ADVANCE_MS);
  }

  update(): void {
    if (this.destroyed) return;
    this.syncPulse();
    const step = this.step;
    if (step === null) return;
    const m = this.measure(step);
    if (m.sig !== this.sig) this.paint(step, m);
  }

  reflow(): void {
    const step = this.step;
    if (this.destroyed || step === null) return;
    // A rotation can turn the rail into a drawer (or back) mid-step.
    this.syncDrawer(step);
    this.paint(step, this.measure(step));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.end('closed');
    this.destroyed = true;
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.el.remove();
  }

  // -------------------------------------------------------------------------

  private show(i: number): void {
    const step = TOUR_STEPS[i];
    if (step === undefined) return;
    this.clearTimer();
    this.i = i;
    this.clicks = 0;

    this.tip.setAttribute('data-testid', tid(TID.tourStep, step.id));
    this.el.dataset['step'] = step.id;
    this.el.dataset['targets'] = step.targets.flat().join(' ');
    this.count.textContent = `${i + 1}/${TOUR_STEPS.length}`;
    this.title.textContent = step.title;
    this.renderBody(step);
    this.backBtn.disabled = i === 0;
    // On the last step, skipping and finishing are the same button.
    this.skipBtn.hidden = i === TOUR_STEPS.length - 1;
    this.nextLabel.textContent = step.next ?? 'Next';

    this.syncDrawer(step);
    this.reveal(step);
    this.paint(step, this.measure(step));
    this.focusTip();
    if (this.settleTimer === null) this.fadeIn();
  }

  private end(how: TourEnd): void {
    if (!this.isOpen) return;
    if (how !== 'closed') {
      this.seenHere = true;
      markTourSeen(this.host.storage);
    }
    this.clearTimer();
    this.clearSettle();
    this.i = -1;
    this.sig = '';
    for (const d of this.live) d();
    this.live.length = 0;
    this.el.setAttribute('hidden', '');
    this.host.setDrawer(false);
    this.host.onClose?.(how);
  }

  /**
   * Open the drawer for a step that wants it, shut it for one that does not.
   * While the sheet slides, the ring rides up with it and the card waits,
   * invisible and unpressable, then lands beside the target where it stopped.
   */
  private syncDrawer(step: TourStep): void {
    if (!this.host.setDrawer(step.drawer === true) || this.host.reducedMotion()) return;
    this.clearSettle();
    this.el.setAttribute('data-settling', '');
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.el.removeAttribute('data-settling');
      const now = this.step;
      if (now === null) return;
      this.paint(now, this.measure(now));
      this.fadeIn();
    }, TOUR_SETTLE_MS);
  }

  private clearSettle(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.el.removeAttribute('data-settling');
  }

  private renderBody(step: TourStep): void {
    this.body.replaceChildren();
    this.clicksEl = null;
    const parts = step.body.split('{clicks}');
    parts.forEach((part, k) => {
      if (k > 0) {
        this.clicksEl = el('b', { cls: 'tm-tour__clicks', text: `0/${step.clicks ?? 0}`, parent: this.body });
      }
      if (part !== '') this.body.append(part);
    });
  }

  /**
   * Bring an off-screen target into view first. A no-op on every layout that
   * fits, and for anything in a fixed layer (the shop drawer, mid-slide):
   * scrolling the page cannot move those, only the page under the tour.
   */
  private reveal(step: TourStep): void {
    const first = step.targets[0]?.[0];
    const node = first === undefined ? null : this.host.find(first);
    if (node === null || typeof node.scrollIntoView !== 'function') return;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const { vw, vh } = layoutViewport();
    if (r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw) return;
    for (let n: Element | null = node; n !== null; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return;
    }
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private measure(step: TourStep): Measured {
    const { vw, vh } = layoutViewport();
    const holes: TourRect[] = [];
    for (const group of step.targets) {
      let u: TourRect | null = null;
      for (const id of group) {
        const r = this.boxOf(id, step.panel === true);
        if (r !== null) u = u === null ? r : union(u, r);
      }
      if (u !== null) holes.push(inflate(u, TOUR_PAD));
    }
    if (step.floor === true) {
      const f = this.floorBox();
      if (f !== null) holes.push(inflate(f, 0));
    }
    const cuts = mergeHoles(holes.map((h) => clip(h, vw, vh)).filter((h): h is TourRect => h !== null));
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    const sig = `${vw}x${vh}|${w}x${h}|${cuts.map((c) => `${c.left},${c.top},${c.width},${c.height}`).join(';')}`;
    return { vw, vh, w, h, cuts, sig };
  }

  /** A target's box: its panel's where asked (and where the panel has one), else its own. */
  private boxOf(id: string, panel: boolean): TourRect | null {
    const node = this.host.find(id);
    if (node === null || node.closest('[hidden]') !== null) return null;
    const own = (n: Element): TourRect | null => {
      const r = n.getBoundingClientRect();
      return r.width > 0 || r.height > 0 ? box(r.left, r.top, r.width, r.height) : null;
    };
    const parent = panel ? node.parentElement : null;
    return (parent !== null ? own(parent) : null) ?? own(node);
  }

  /** The stage floor, from the canvas as drawn. */
  private floorBox(): TourRect | null {
    const canvas = this.host.find(TID.scene);
    if (canvas === null || canvas.closest('[hidden]') !== null) return null;
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return null;
    const s = r.width / 320;
    return box(r.left + FLOOR_BAND.x * s, r.top + FLOOR_BAND.y * s, FLOOR_BAND.w * s, FLOOR_BAND.h * s);
  }

  private paint(step: TourStep, m: Measured): void {
    this.sig = m.sig;
    this.pool(this.shades, this.shadeLayer, 'tm-tour__shade', shadeRects(m.vw, m.vh, m.cuts));
    this.pool(this.rings, this.ringLayer, 'tm-tour__ring', m.cuts);
    const p = placeTooltip(m.cuts, m.w, m.h, m.vw, m.vh, step.side ?? null);
    this.place(this.tip, p.left, p.top, null, null);
    this.tip.dataset['side'] = p.side;
  }

  /** Enough nodes for `rects`, placed; the rest hidden. */
  private pool(nodes: HTMLElement[], layer: HTMLElement, cls: string, rects: readonly TourRect[]): void {
    while (nodes.length < rects.length) nodes.push(el('div', { cls, parent: layer }));
    nodes.forEach((n, k) => {
      const r = rects[k];
      if (r === undefined) {
        if (!n.hidden) n.hidden = true;
        return;
      }
      if (n.hidden) n.hidden = false;
      this.place(n, r.left, r.top, r.width, r.height);
    });
  }

  private place(n: HTMLElement, left: number, top: number, width: number | null, height: number | null): void {
    const key = `${left},${top},${width},${height}`;
    if (this.written.get(n) === key) return;
    this.written.set(n, key);
    n.style.left = `${left}px`;
    n.style.top = `${top}px`;
    if (width !== null) n.style.width = `${width}px`;
    if (height !== null) n.style.height = `${height}px`;
  }

  private syncPulse(): void {
    const pulse = !this.host.reducedMotion();
    if (pulse === this.pulse) return;
    this.pulse = pulse;
    if (pulse) this.el.setAttribute('data-pulse', '');
    else this.el.removeAttribute('data-pulse');
  }

  private fadeIn(): void {
    if (this.host.reducedMotion() || typeof this.tip.animate !== 'function') return;
    try {
      // Opacity only: the card must not move while a pointer is aiming at it.
      this.tip.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    } catch {
      /* no Web Animations: it just appears */
    }
  }

  private focusTip(): void {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && this.tip.contains(active) && !active.disabled) return;
    this.nextBtn.focus({ preventScroll: true });
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private onFocusIn(ev: Event): void {
    const t = ev.target;
    if (!this.isOpen || (t instanceof Node && this.tip.contains(t))) return;
    // Something outside took focus (a click on the agent focuses it): bring it back.
    this.focusTip();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const inTip = t instanceof Node && this.tip.contains(t);
    const onButton = inTip && t instanceof HTMLButtonElement;
    const consume = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'Escape':
        consume();
        this.skip();
        return;
      case 'ArrowRight':
        consume();
        if (!e.repeat) this.next();
        return;
      case 'ArrowLeft':
        consume();
        if (!e.repeat) this.back();
        return;
      case 'Enter':
        // A focused tour button activates itself; anywhere else Enter is Next.
        if (onButton) return;
        consume();
        if (!e.repeat) this.next();
        return;
      case ' ':
      case 'Spacebar':
        // Space never presses a tour button: on this screen it means generate,
        // and a player mashing it must not skip through the steps. On the
        // interactive step it does what it says, the normal way.
        consume();
        if (!e.repeat && this.step?.clicks !== undefined) this.host.emit({ t: 'canvasKey' });
        return;
      case 'Tab': {
        if (inTip && t !== this.tip) {
          trapTab(this.tip, e);
          return;
        }
        // From the card itself, or from anywhere outside it: into the ring.
        consume();
        const items = focusables(this.tip);
        (e.shiftKey ? items[items.length - 1] : items[0])?.focus();
        return;
      }
      default:
        // Everything else is a game hotkey, and those stand down on their own.
        return;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    // A button activates on Space's keyup: that must not happen either.
    if (this.isOpen && (e.key === ' ' || e.key === 'Spacebar')) e.preventDefault();
  }
}

/** Mount the tour layer. It stays hidden until `start()`. */
export function createTour(parent: HTMLElement, host: TourHost): Tour {
  return new GuidedTour(parent, host);
}
