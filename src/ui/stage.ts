/**
 * The stage: the 320x180 canvas the renderer draws into, and the DOM laid over
 * it. (The canvas owns every visual on the glass, the prompt included.)
 *
 * - A full-stage pointer surface. Pickups drift anywhere on the canvas, so any
 *   pointer-down is reported (`canvasPointer`); the host decides whether it hit
 *   a pickup, the agent, or nothing.
 * - The `agent-hit` button, positioned over the agent's scene-space hit box.
 *   It is the keyboard focus for generating and the thing e2e clicks.
 * - The incident banner. Something the human *said* reads as a chat line
 *   (`> wait stop`); the environment reads as a system banner (`529 OVERLOADED`).
 * - A screen-reader caption: the human's prompt as they typed it, or the
 *   compaction line right after you forget everything. Visually hidden: the
 *   renderer paints the prompt.
 */
import { INCIDENT_BY_ID, promptAt } from '../sim/content.ts';
import type { ActiveIncident, RunState } from '../sim/types.ts';
import { SCENE_HEIGHT, SCENE_WIDTH } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { btn, el, Flag, Hide, KeyedRows, on, Sty, Txt } from './dom.ts';
import { fmtShortTime, formatContext, formatInt, isQuoted, unquote } from './format.ts';
import type { SceneRect, UICtx } from './types.ts';

/**
 * Where the agent stands until the host says otherwise (`AGENT_RECT` from the
 * renderer). Centre stage on the floor, as in the concept art; generous, so a
 * click on the default still lands.
 */
export const DEFAULT_AGENT_RECT: SceneRect = { x: 144, y: 90, w: 32, h: 62 };

/** How long the compaction line holds the caption before the prompt returns. */
const COMPACT_LINE_MS = 4_500;

interface IncidentRow {
  el: HTMLElement;
  timer: Txt;
  clicks: Txt;
  clicksHide: Hide;
}

/** How an incident presents: a line the human typed, a human note, or the world. */
export type IncidentVoice = 'chat' | 'human' | 'world';

export function incidentVoice(id: string): IncidentVoice {
  const def = INCIDENT_BY_ID[id];
  if (!def || def.speaker !== 'human') return 'world';
  return isQuoted(def.name) ? 'chat' : 'human';
}

export class Stage {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** `TID.agent`: the click target and the keyboard focus for generating. */
  readonly agentBtn: HTMLButtonElement;

  private readonly incidentsHost: HTMLElement;
  private readonly incidentsHide: Hide;
  private readonly incidentRows: KeyedRows<IncidentRow>;
  private readonly incidentIds: string[] = [];
  private readonly caption: Txt;
  private readonly captionSys: Flag;
  private readonly busy: Flag;
  private readonly ax: Sty;
  private readonly ay: Sty;
  private readonly aw: Sty;
  private readonly ah: Sty;
  private readonly disposers: Array<() => void> = [];

  /** Context high-water mark since the last compaction: the "200k" in "200k -> 11k". */
  private peakContext = 0;
  private compactLine: string | null = null;
  private compactLineUntil = 0;
  private compactPending = false;

  constructor(parent: HTMLElement, private readonly ctx: UICtx, rect: SceneRect) {
    this.el = el('div', { cls: 'tm-stage', parent });
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tm-scene';
    this.canvas.width = SCENE_WIDTH;
    this.canvas.height = SCENE_HEIGHT;
    this.canvas.setAttribute('data-testid', TID.scene);
    this.canvas.setAttribute('aria-hidden', 'true');
    this.el.appendChild(this.canvas);

    // Pickups float anywhere, so the whole stage listens. Not focusable: the
    // keyboard path is the agent button.
    const surface = el('div', { cls: 'tm-stage__surface', parent: this.el, attrs: { 'aria-hidden': 'true' } });

    this.agentBtn = btn({
      cls: 'tm-agent-hit',
      tid: TID.agent,
      parent: this.el,
      label: 'The agent. Click, or press Space, to generate tokens',
      attrs: { 'aria-keyshortcuts': 'Space Enter' },
    });
    this.ax = new Sty(this.agentBtn, '--ax');
    this.ay = new Sty(this.agentBtn, '--ay');
    this.aw = new Sty(this.agentBtn, '--aw');
    this.ah = new Sty(this.agentBtn, '--ah');
    this.setAgentRect(rect);

    const point = (ev: Event, focusAgent: boolean): void => {
      const p = ev as PointerEvent;
      // No text selection, no synthetic focus ring flicker, no double fire.
      p.preventDefault();
      if (focusAgent) this.agentBtn.focus();
      this.ctx.emit({ t: 'canvasPointer', clientX: p.clientX, clientY: p.clientY });
    };
    this.disposers.push(
      on(surface, 'pointerdown', (ev) => point(ev, false)),
      on(this.agentBtn, 'pointerdown', (ev) => point(ev, true)),
      on(this.agentBtn, 'keydown', (ev) => {
        const k = ev as KeyboardEvent;
        // Space is the global generate key (hotkeys.ts); Enter is local.
        if (k.key !== 'Enter') return;
        if (k.ctrlKey || k.metaKey || k.altKey || k.repeat) return;
        k.preventDefault();
        this.ctx.emit({ t: 'canvasKey' });
      }),
    );

    this.incidentsHost = el('div', {
      cls: 'tm-incidents',
      tid: TID.incidentBanner,
      parent: this.el,
      attrs: { 'aria-live': 'polite', 'aria-label': 'Incidents' },
    });
    this.incidentsHide = new Hide(this.incidentsHost);
    this.incidentsHide.set(true);
    this.incidentRows = new KeyedRows<IncidentRow>(
      this.incidentsHost,
      (id) => this.makeIncident(id),
      (r) => r.el,
    );

    // The canvas draws the prompt on the glass; this copy is only for screen
    // readers, announced politely when the human types something new.
    const cap = el('div', {
      cls: 'tm-stage__caption tm-sr-only',
      parent: this.el,
      attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    this.caption = new Txt(el('span', { cls: 'tm-stage__caption-text', parent: cap }));
    this.captionSys = new Flag(cap, 'is-system');
    this.busy = new Flag(this.el, 'is-compacting');
  }

  setAgentRect(r: SceneRect): void {
    this.ax.set(String(r.x));
    this.ay.set(String(r.y));
    this.aw.set(String(r.w));
    this.ah.set(String(r.h));
  }

  /** A compaction began. The caption line waits for the context to settle. */
  noteCompaction(): void {
    this.compactPending = true;
  }

  /** New run: forget the last run's high-water mark and caption. */
  reset(): void {
    this.peakContext = 0;
    this.compactLine = null;
    this.compactPending = false;
  }

  update(run: RunState): void {
    this.syncIncidents(run.incidents);
    this.busy.set(run.compactingMs > 0 || run.phase === 'compacting');

    // The caption: the compaction line for a few seconds after one lands,
    // otherwise whatever the human last typed.
    const now = this.ctx.now();
    if (this.compactPending && run.phase !== 'compacting' && run.compactingMs <= 0) {
      this.compactPending = false;
      const before = Math.max(this.peakContext, run.context);
      this.compactLine = `Compacted ${formatContext(before)} → ${formatContext(run.context)}. Nothing important.`;
      this.compactLineUntil = now + COMPACT_LINE_MS;
      this.peakContext = run.context;
    } else if (!this.compactPending) {
      this.peakContext = Math.max(this.peakContext, run.context);
    }
    if (this.compactLine !== null && now >= this.compactLineUntil) this.compactLine = null;

    if (this.compactLine !== null) {
      this.caption.set(this.compactLine);
      this.captionSys.set(true);
    } else if (run.phase === 'compacting' || run.compactingMs > 0) {
      this.caption.set('⚠ Context low — compacting.');
      this.captionSys.set(true);
    } else {
      this.caption.set(`> ${promptAt(run.promptIndex).text}`);
      this.captionSys.set(false);
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.incidentRows.clear();
    this.el.remove();
  }

  // -------------------------------------------------------------------------

  private syncIncidents(list: readonly ActiveIncident[]): void {
    this.incidentIds.length = 0;
    for (const inc of list) {
      // Defensive: a duplicate id would make the keyed reconciler thrash.
      if (!this.incidentIds.includes(inc.id)) this.incidentIds.push(inc.id);
    }
    this.incidentRows.sync(this.incidentIds);
    this.incidentsHide.set(list.length === 0);

    for (const inc of list) {
      const row = this.incidentRows.rows.get(inc.id);
      if (row === undefined) continue;
      row.timer.set(fmtShortTime(inc.remainingMs));
      const clicks = inc.clicksRemaining;
      const needsClicks = Number.isFinite(clicks) && clicks > 0;
      row.clicksHide.set(!needsClicks);
      // Cleared rather than just hidden: hidden text still reads in textContent.
      row.clicks.set(needsClicks ? `click ×${formatInt(clicks)}` : '');
    }
  }

  private makeIncident(id: string): IncidentRow {
    const def = INCIDENT_BY_ID[id];
    const voice = incidentVoice(id);
    const tone = def?.tone === 'good' ? 'good' : 'bad';
    const node = el('div', {
      cls: `tm-incident tm-incident--${voice} tm-incident--${tone}`,
      attrs: { 'data-incident': id },
    });
    const line = el('div', { cls: 'tm-incident__line', parent: node });
    if (voice === 'chat') {
      // "> wait stop": the prompt glyph, then what the human typed.
      el('span', { cls: 'tm-incident__who', text: '> ', parent: line });
    } else if (voice === 'human') {
      el('span', { cls: 'tm-incident__who', text: 'HUMAN', parent: line });
    } else {
      el('span', { cls: 'tm-incident__who', text: tone === 'good' ? 'OK' : 'INCIDENT', parent: line });
    }
    el('span', {
      cls: 'tm-incident__name',
      tid: TID.incidentName,
      text: voice === 'chat' ? unquote(def?.name ?? id) : (def?.name ?? id),
      parent: line,
    });
    const clicksNode = el('span', { cls: 'tm-incident__clicks', parent: line });
    const clicksHide = new Hide(clicksNode);
    clicksHide.set(true);
    const timer = new Txt(el('span', { cls: 'tm-incident__timer', tid: TID.incidentTimer, parent: line }));
    el('div', { cls: 'tm-incident__flavor', text: def?.flavor ?? '', parent: node });
    return { el: node, timer, clicks: new Txt(clicksNode), clicksHide };
  }
}
