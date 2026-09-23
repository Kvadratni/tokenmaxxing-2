/**
 * First-run coach marks.
 *
 *   const coach = createCoach(uiRoot, { enabled: () => meta.runs === 0 });
 *   // per frame, right after ui.update():
 *   coach.update(sim.run, derived);
 *
 * Tips fire on *state*, never on a timer: the game teaches you the thing at the
 * moment the thing becomes true. The context bar, the human's patience, claims
 * and compaction are the four ideas game 1 did not have, so they are the four
 * the coach spends its words on. Each shows once; at most one is on screen, and
 * each retires itself after a few seconds or on click.
 *
 * Layout is only read when a bubble appears, never in the per-frame path.
 */
import '../styles/help.css';

import { TOOLS } from '../sim/content.ts';
import type { DerivedStats, RunState } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, el, layoutViewport, on } from './dom.ts';

/** How long a bubble stays up before retiring itself. */
export const COACH_TIP_MS = 7000;

export interface CoachTip {
  readonly id: string;
  readonly text: string;
  /**
   * Anchors in preference order, as `data-testid` values. The first one found
   * in the DOM wins; if none is present the bubble degrades to a fixed corner.
   */
  readonly anchors: readonly string[];
  /** Which side of the anchor to try first. Default below. */
  readonly placement?: 'above' | 'below';
  readonly when: (run: RunState, d: DerivedStats) => boolean;
}

/** A viewport rectangle, the shape `getBoundingClientRect()` returns. */
export interface TipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface TipPlacement {
  readonly left: number;
  readonly top: number;
  /** Where the bubble ended up relative to its anchor (it points back at it). */
  readonly side: 'above' | 'below' | 'right' | 'left';
}

/** Scene pixels along the bottom of the stage where the canvas prints the prompt. */
export const STAGE_CAPTION_BAND = 22;

function overlaps(a: TipRect, left: number, top: number, w: number, h: number): boolean {
  return left < a.right && left + w > a.left && top < a.bottom && top + h > a.top;
}

/**
 * Where a `w` x `h` bubble goes next to `anchor`. The preferred side first,
 * then the others; a spot that leaves the viewport, or lands on `keepOut`
 * (the prompt line along the bottom of the stage), is passed over. Pure, so
 * it can be tested without a layout engine.
 */
export function placeTip(
  anchor: TipRect,
  w: number,
  h: number,
  vw: number,
  vh: number,
  prefer: 'above' | 'below' = 'below',
  keepOut: TipRect | null = null,
  gap = 10,
): TipPlacement {
  const clampX = (x: number): number => Math.max(gap, Math.min(vw - w - gap, x));
  const clampY = (y: number): number => Math.max(gap, Math.min(vh - h - gap, y));
  const cx = clampX(anchor.left + anchor.width / 2 - w / 2);
  const cy = clampY(anchor.top + anchor.height / 2 - h / 2);
  const spots: Record<TipPlacement['side'], { left: number; top: number; fits: boolean }> = {
    above: { left: cx, top: anchor.top - h - gap, fits: anchor.top - h - gap >= gap },
    below: { left: cx, top: anchor.bottom + gap, fits: anchor.bottom + gap + h <= vh - gap },
    right: { left: anchor.right + gap, top: cy, fits: anchor.right + gap + w <= vw - gap },
    left: { left: anchor.left - w - gap, top: cy, fits: anchor.left - w - gap >= gap },
  };
  const order: TipPlacement['side'][] =
    prefer === 'above' ? ['above', 'right', 'left', 'below'] : ['below', 'above', 'right', 'left'];
  for (const side of order) {
    const s = spots[side];
    if (s.fits && (keepOut === null || !overlaps(keepOut, s.left, s.top, w, h))) {
      return { left: Math.round(s.left), top: Math.round(s.top), side };
    }
  }
  // Nothing fits cleanly: the preferred side, clamped, and lifted off the band.
  const first = spots[order[0]!];
  let top = clampY(first.top);
  if (keepOut !== null && overlaps(keepOut, first.left, top, w, h)) top = Math.max(gap, keepOut.top - h - gap);
  return { left: Math.round(first.left), top: Math.round(top), side: order[0]! };
}

const firstTool = TOOLS[0];

/**
 * Evaluated top-down; the first unseen tip whose predicate holds is shown, so
 * the order here is the priority order.
 *
 * "Click the agent" is not here: the first-run tour (tour.ts) has the player
 * do it before the clock starts. What is left fires when its moment arrives.
 */
export const COACH_TIPS: readonly CoachTip[] = [
  {
    id: 'context',
    text: 'Everything you generate lands in your context window. When it fills up, you get compacted and forget.',
    anchors: [TID.contextBar],
    when: (run, d) => run.phase === 'running' && d.contextFill >= 0.2,
  },
  {
    id: 'tools',
    text: 'Tools generate on their own, but each adds context every second. Watch the ctx/s.',
    anchors: [tid(TID.toolRow, firstTool?.id ?? ''), TID.toolList, TID.shop],
    when: (run, d) => run.phase === 'running' && run.tokens >= (d.nextCosts[firstTool?.id ?? 'grep'] ?? Infinity),
  },
  {
    id: 'patience',
    text: "The human's patience only goes down. Report before it runs out, or press Y to tell them they're absolutely right.",
    anchors: [TID.patienceBar, TID.sycophancyButton],
    when: (run, d) => run.phase === 'running' && d.patienceProgress <= 0.6,
  },
  {
    id: 'claim',
    text: 'Half done is done enough? CLAIM DONE spends the whole wallet and hopes the human does not check.',
    anchors: [TID.reportButton],
    when: (run, d) => run.phase === 'running' && d.reportState === 'claim',
  },
  {
    id: 'report',
    text: 'The wallet covers it. Press S to report done.',
    anchors: [TID.reportButton],
    when: (run, d) => run.phase === 'running' && d.reportState === 'report',
  },
  {
    id: 'compaction',
    text: 'Context 80%. At 100% you are compacted: most of the wallet, and all but one card, is forgotten.',
    anchors: [TID.contextBar, TID.compactButton],
    when: (run, d) => run.phase === 'running' && d.contextFill >= 0.8,
  },
];

export interface Coach {
  readonly el: HTMLElement;
  /** Called every frame with fresh state; decides whether to show a tip. */
  update(run: RunState, derived: DerivedStats): void;
  /** Take down the tip on screen, if any, and keep offering the rest. */
  clear(): void;
  dismissAll(): void;
  destroy(): void;
}

export interface CoachOpts {
  /** True only on the player's very first session ever. Host supplies it. */
  enabled: () => boolean;
  /** Persist that a tip has been seen. Host owns storage. */
  onSeen?: (id: string) => void;
  seen?: () => ReadonlySet<string>;
}

interface Live {
  readonly id: string;
  readonly node: HTMLElement;
  readonly disposers: Array<() => void>;
  timer: number | null;
}

const EMPTY: ReadonlySet<string> = new Set<string>();
/** Gap between the anchor and the bubble, and the viewport keep-out margin. */
const GAP = 10;

class CoachMarks implements Coach {
  readonly el: HTMLElement;

  private readonly shown = new Set<string>();
  private live: Live | null = null;
  private muted = false;
  private destroyed = false;

  constructor(parent: HTMLElement, private readonly opts: CoachOpts) {
    this.el = el('div', {
      cls: 'tm-coach',
      tid: TID.coach,
      parent,
      attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    this.el.setAttribute('hidden', '');
  }

  update(run: RunState, derived: DerivedStats): void {
    if (this.destroyed || this.muted) return;
    if (!this.opts.enabled()) return;
    if (this.live !== null) return;
    const persisted = this.opts.seen?.() ?? EMPTY;
    for (const tip of COACH_TIPS) {
      if (this.shown.has(tip.id) || persisted.has(tip.id)) continue;
      if (!tip.when(run, derived)) continue;
      this.show(tip);
      return;
    }
  }

  clear(): void {
    if (this.destroyed) return;
    this.clearLive();
  }

  /**
   * Retire the coach: clear whatever is on screen and stop offering tips for
   * the rest of the session. Every tip the player never got is reported through
   * `onSeen` so a host that persists it does not re-offer them.
   */
  dismissAll(): void {
    if (this.destroyed) return;
    this.muted = true;
    this.clearLive();
    for (const tip of COACH_TIPS) {
      if (this.shown.has(tip.id)) continue;
      this.shown.add(tip.id);
      this.opts.onSeen?.(tip.id);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearLive();
    this.el.remove();
  }

  // -------------------------------------------------------------------------

  private show(tip: CoachTip): void {
    // Marked seen the moment it is shown: a tip the player scrolled past is
    // still a tip they were offered, and re-offering it is worse than losing it.
    this.shown.add(tip.id);
    this.opts.onSeen?.(tip.id);

    const node = el('div', {
      cls: 'tm-coach__tip',
      tid: tid(TID.coachTip, tip.id),
      parent: this.el,
      attrs: { role: 'status' },
    });
    el('span', { cls: 'tm-coach__text', text: tip.text, parent: node });
    const x = btn({
      cls: 'tm-coach__x',
      tid: tid(TID.coachDismiss, tip.id),
      text: '×',
      parent: node,
      label: 'Dismiss tip',
    });
    this.el.removeAttribute('hidden');

    const live: Live = { id: tip.id, node, disposers: [], timer: null };
    this.live = live;
    const drop = (): void => {
      if (this.live === live) this.clearLive();
    };
    live.disposers.push(on(node, 'click', drop));
    live.disposers.push(on(x, 'click', drop));
    // A bubble pinned to a control has to follow it when the chrome rescales.
    live.disposers.push(on(window, 'resize', () => this.place(live, tip)));
    live.timer = window.setTimeout(drop, COACH_TIP_MS);
    this.place(live, tip);
  }

  /**
   * Pin the bubble beside its anchor (see `placeTip`), or park it in the
   * corner when nothing can be measured.
   */
  private place(live: Live, tip: CoachTip): void {
    const node = live.node;
    const anchor = this.findAnchor(tip.anchors);
    const rect = anchor?.getBoundingClientRect();
    if (rect === undefined || (rect.width === 0 && rect.height === 0)) {
      node.classList.add('is-corner');
      node.style.removeProperty('left');
      node.style.removeProperty('top');
      return;
    }
    node.classList.remove('is-corner');
    // Layout viewport, not `innerWidth`: on mobile the visual viewport can be
    // wider than the page, and clamping against it overhung the real edge.
    const { vw, vh } = layoutViewport();
    const w = node.offsetWidth || 0;
    const h = node.offsetHeight || 0;
    const p = placeTip(rect, w, h, vw, vh, tip.placement ?? 'below', this.captionBand(), GAP);
    node.style.setProperty('left', `${p.left}px`);
    node.style.setProperty('top', `${p.top}px`);
    node.dataset['side'] = p.side;
    // The pointer aims at the anchor even when the bubble is clamped off-centre.
    const aim = rect.left + rect.width / 2 - p.left;
    node.style.setProperty('--aim', `${Math.round(Math.max(12, Math.min(w - 12, aim)))}px`);
  }

  /** The strip along the bottom of the stage where the canvas prints the prompt. */
  private captionBand(): TipRect | null {
    const stage = this.el.parentElement?.querySelector<HTMLElement>('.tm-stage');
    const r = stage?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    const band = STAGE_CAPTION_BAND * (r.width / 320);
    return { left: r.left, right: r.right, top: r.bottom - band, bottom: r.bottom, width: r.width, height: band };
  }

  /** Scoped to the coach's own parent first, then the document. */
  private findAnchor(ids: readonly string[]): HTMLElement | null {
    const scope = this.el.parentElement;
    const doc = this.el.ownerDocument;
    for (const id of ids) {
      if (id === '') continue;
      const sel = `[data-testid="${id}"]`;
      const found = scope?.querySelector<HTMLElement>(sel) ?? doc.querySelector<HTMLElement>(sel);
      if (found !== null && found !== undefined && !found.closest('[hidden]')) return found;
    }
    return null;
  }

  private clearLive(): void {
    const live = this.live;
    if (live === null) return;
    this.live = null;
    if (live.timer !== null) window.clearTimeout(live.timer);
    live.timer = null;
    for (const d of live.disposers) d();
    live.disposers.length = 0;
    live.node.remove();
    this.el.setAttribute('hidden', '');
  }
}

/**
 * Mount the coach layer. Nothing renders until `update()` sees state that
 * satisfies a tip, and nothing ever renders while `enabled()` is false.
 */
export function createCoach(parent: HTMLElement, opts: CoachOpts): Coach {
  return new CoachMarks(parent, opts);
}
