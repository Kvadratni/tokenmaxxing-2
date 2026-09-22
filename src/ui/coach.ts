/**
 * First-run coach marks.
 *
 *   const coach = createCoach(uiRoot, {
 *     enabled: () => meta.runs === 0,              // very first run ever
 *     seen:    () => new Set(save.coachSeen),      // host owns storage
 *     onSeen:  (id) => { save.coachSeen.push(id); persist(); },
 *   });
 *   // per frame, right after ui.update():
 *   coach.update(sim.run, derived);
 *
 * Tips fire on *state*, never on a timer: the game teaches you the thing at the
 * moment the thing becomes true. Each one shows once, ever. At most one is on
 * screen at a time, and each self-dismisses after ~6 seconds or on click.
 *
 * Layout is only read when a bubble appears (at most a handful of times in a
 * player's life), never in the per-frame path.
 */
import '../styles/help.css';

import { AGENT_TIERS, AGENT_TIER_IDS } from '../sim/content.ts';
import type { DerivedStats, RunState } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, el, on, layoutViewport } from './dom.ts';

// ---------------------------------------------------------------------------
// testids
// ---------------------------------------------------------------------------

/**
 * `data-testid` values this module renders. Belongs in `src/testids.ts`; the
 * integrator owns that file, so the literals live here until they land there.
 */
export const COACH_TID = {
  /** The (usually empty) live region every bubble is announced through. */
  layer: 'coach',
  /** `${tip}-${tipId}` — the bubble itself. */
  tip: 'coach-tip',
  /** `${dismiss}-${tipId}` — the bubble's close button. */
  dismiss: 'coach-dismiss',
} as const;

/** How long a bubble stays up before retiring itself. */
export const COACH_TIP_MS = 6000;

/** Below this much time left, the "you are not making it" tip fires. */
const LOW_TIME_MS = 20_000;

// ---------------------------------------------------------------------------
// tips
// ---------------------------------------------------------------------------

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

function totalAgents(run: RunState): number {
  let n = 0;
  for (const id of AGENT_TIER_IDS) n += run.agents[id] ?? 0;
  return n;
}

/** What one unit of the cheapest tier costs right now. */
function firstAgentCost(d: DerivedStats): number {
  const t = AGENT_TIERS[0];
  if (t === undefined) return Number.POSITIVE_INFINITY;
  const next = d.nextCosts[t.id];
  return Number.isFinite(next) && next > 0 ? next : t.baseCost;
}

/**
 * Evaluated top-down; the first unseen tip whose predicate holds is shown, so
 * the order here is the priority order.
 */
export const COACH_TIPS: readonly CoachTip[] = [
  {
    id: 'click',
    text: 'Click the laptop. Every click is slop.',
    anchors: [TID.laptop, TID.scene],
    when: (run) => run.phase === 'running',
  },
  {
    id: 'afford',
    text: 'You can afford an agent. It costs slop — watch the ship bar drop.',
    anchors: [tid(TID.agentRow, AGENT_TIERS[0]?.id ?? ''), TID.agentList, TID.shop],
    when: (run, d) => run.slop >= firstAgentCost(d),
  },
  {
    id: 'owned',
    text: 'Agents produce while you do nothing. That is the point.',
    anchors: [TID.slopRate, TID.slop],
    when: (run) => totalAgents(run) > 0,
  },
  {
    id: 'ship',
    text: "Bar's full. Press S to ship.",
    anchors: [TID.shipButton, TID.shipBar],
    when: (_run, d) => d.canShip,
  },
  {
    id: 'incident',
    text: 'Incidents never pause the clock.',
    anchors: [TID.deadlineBar, TID.incidentBanner],
    when: (run) => run.incidents.length > 0,
  },
  {
    id: 'lowtime',
    text: 'Short on time. Ship what you can next run.',
    anchors: [TID.deadlineText, TID.deadlineBar],
    when: (run, d) => run.phase === 'running' && run.timeLeftMs < LOW_TIME_MS && !d.canShip,
  },
];

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export interface Coach {
  readonly el: HTMLElement;
  /** Called every frame with fresh state; decides whether to show a tip. */
  update(run: RunState, derived: DerivedStats): void;
  dismissAll(): void;
  destroy(): void;
}

export interface CoachOpts {
  /** True only on the player's very first run ever. Host supplies it. */
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
      tid: COACH_TID.layer,
      parent,
      attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    this.el.setAttribute('hidden', '');
  }

  update(run: RunState, derived: DerivedStats): void {
    // Inert unless the host says this is the first run. No DOM, no timers.
    if (this.destroyed || this.muted) return;
    if (!this.opts.enabled()) return;
    // Never more than one on screen.
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
   * the rest of the session. Every tip the player never got is reported
   * through `onSeen` so a host that persists it does not re-offer them.
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
      tid: tid(COACH_TID.tip, tip.id),
      parent: this.el,
      attrs: { role: 'status' },
    });
    el('span', { cls: 'tm-coach__text', text: tip.text, parent: node });
    const x = btn({
      cls: 'tm-coach__x',
      tid: tid(COACH_TID.dismiss, tip.id),
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
   * Pin the bubble under its anchor, or drop it in the corner when the anchor
   * is missing or unmeasurable (a headless DOM, a `display: none` ancestor).
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
    // wider than the page, and clamping against it let a bubble overhang the
    // real right edge and give the document a horizontal scrollbar.
    const { vw, vh } = layoutViewport();
    const w = node.offsetWidth || 0;
    const h = node.offsetHeight || 0;

    const left = Math.max(GAP, Math.min(vw - w - GAP, rect.left + rect.width / 2 - w / 2));
    // Below the anchor by default; flipped above when that would run off.
    const below = rect.bottom + GAP;
    const top = below + h > vh - GAP ? Math.max(GAP, rect.top - h - GAP) : below;

    node.style.setProperty('left', `${Math.round(left)}px`);
    node.style.setProperty('top', `${Math.round(top)}px`);
  }

  /**
   * Scoped to the coach's own parent first, so a stray testid elsewhere on the
   * page cannot drag a bubble into someone else's widget. Falls back to the
   * document for hosts that mount the coach outside the HUD's subtree.
   */
  private findAnchor(ids: readonly string[]): HTMLElement | null {
    const scope = this.el.parentElement;
    const doc = this.el.ownerDocument;
    for (const id of ids) {
      if (id === '') continue;
      const sel = `[data-testid="${id}"]`;
      const found = scope?.querySelector<HTMLElement>(sel) ?? doc.querySelector<HTMLElement>(sel);
      if (found !== null && found !== undefined) return found;
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
 * Mount the coach layer. Nothing renders until `update()` is called with state
 * that satisfies a tip — and nothing ever renders while `enabled()` is false.
 */
export function createCoach(parent: HTMLElement, opts: CoachOpts): Coach {
  return new CoachMarks(parent, opts);
}
