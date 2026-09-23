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
  readonly when: (run: RunState, d: DerivedStats) => boolean;
}

const firstTool = TOOLS[0];

/**
 * Evaluated top-down; the first unseen tip whose predicate holds is shown, so
 * the order here is the priority order.
 */
export const COACH_TIPS: readonly CoachTip[] = [
  {
    id: 'generate',
    text: 'Click the agent, or press Space, to generate tokens.',
    anchors: [TID.agent, TID.scene],
    when: (run) => run.phase === 'running',
  },
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

  /** Pin the bubble under its anchor, or park it in the corner when it cannot be measured. */
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
    const left = Math.max(GAP, Math.min(vw - w - GAP, rect.left + rect.width / 2 - w / 2));
    const below = rect.bottom + GAP;
    const top = below + h > vh - GAP ? Math.max(GAP, rect.top - h - GAP) : below;
    node.style.setProperty('left', `${Math.round(left)}px`);
    node.style.setProperty('top', `${Math.round(top)}px`);
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
