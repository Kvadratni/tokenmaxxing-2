/**
 * The summary picker: the moment the context window runs out.
 *
 * Opens while `phase === 'compacting'` with `run.summary` set: you hold more
 * prompt cards than the summary has slots, so you choose which survive. The
 * rest are compacted away, "(contents too large to include)". Tools are not
 * on the list: they are installed, not remembered.
 *
 * Not dismissable, like the draft: the sim is paused until you choose.
 * Keyboard: arrows move between cards, Space or Enter toggles one, the digits
 * 1-9 toggle the Nth card, and Ctrl/Cmd+Enter (or the button) confirms.
 */
import { CARD_BY_ID } from '../sim/content.ts';
import type { RunState, SummaryChoice } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, Dis, el, Flag, KeyedRows, on, Txt } from './dom.ts';
import { effectsLine } from './effect-text.ts';
import { formatInt } from './format.ts';
import { cardIcon } from './icon-ids.ts';
import { iconEl } from './icon.ts';
import { Modal } from './modal.ts';
import type { UICtx } from './types.ts';

export const SUMMARY_TITLE_FORCED = 'CONTEXT FULL — COMPACTING';
export const SUMMARY_TITLE_MANUAL = '/compact';
/** What a card you let go of turns into. */
export const DROPPED_TEXT = '(contents too large to include)';

interface Row {
  el: HTMLButtonElement;
  state: Txt;
  kept: Flag;
}

/** Initial selection: the first cards, as many as fit. The player can swap. */
export function defaultKeep(choice: SummaryChoice): string[] {
  return choice.offered.slice(0, Math.max(0, choice.slots));
}

export class SummaryPicker {
  readonly modal: Modal;
  private readonly title: Txt;
  private readonly sub: Txt;
  private readonly slotsTxt: Txt;
  private readonly rows: KeyedRows<Row>;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly confirmTxt: Txt;
  private readonly confirmDis: Dis;
  private readonly forcedFlag: Flag;
  private readonly disposers: Array<() => void> = [];

  private choice: SummaryChoice | null = null;
  private offered: string[] = [];
  /** Kept cards in the order they were chosen, so a full summary drops the oldest pick. */
  private keep: string[] = [];
  private sent = false;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.modal = new Modal({
      tid: TID.summaryModal,
      label: 'Compaction: choose which cards survive',
      dismissable: false,
      cls: 'tm-summary',
    });
    parent.appendChild(this.modal.el);
    this.forcedFlag = new Flag(this.modal.el, 'is-forced');

    const banner = el('div', { cls: 'tm-summary__banner', parent: this.modal.panel });
    this.title = new Txt(el('h2', { cls: 'tm-modal__title tm-summary__title', parent: banner }));
    this.sub = new Txt(el('p', { cls: 'tm-modal__sub', parent: this.modal.panel }));
    this.slotsTxt = new Txt(
      el('div', { cls: 'tm-summary__slots', tid: TID.summarySlots, parent: this.modal.panel }),
    );

    const list = el('div', {
      cls: 'tm-summary__cards',
      parent: this.modal.panel,
      attrs: { role: 'group', 'aria-label': 'Cards to keep' },
    });
    this.rows = new KeyedRows<Row>(
      list,
      (id) => this.makeRow(id),
      (r) => r.el,
    );

    el('p', {
      cls: 'tm-hint',
      text: '↑ ↓ to move · Space to keep or drop · Ctrl+Enter to confirm',
      parent: this.modal.panel,
      attrs: { 'aria-hidden': 'true' },
    });

    const foot = el('div', { cls: 'tm-modal__actions', parent: this.modal.panel });
    this.confirmBtn = btn({ cls: 'tm-btn tm-btn--primary', tid: TID.summaryConfirm, parent: foot });
    this.confirmTxt = new Txt(this.confirmBtn);
    this.confirmDis = new Dis(this.confirmBtn);

    this.disposers.push(
      on(this.confirmBtn, 'click', () => this.confirm()),
      on(this.modal.el, 'keydown', (ev) => this.onKey(ev as KeyboardEvent)),
    );
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** Cards currently marked to keep, in the order they were chosen. */
  get kept(): readonly string[] {
    return this.keep;
  }

  close(): void {
    if (!this.modal.isOpen) return;
    this.modal.close();
    this.clear();
  }

  update(run: RunState): void {
    const choice = run.phase === 'compacting' ? run.summary : null;
    if (choice === null) {
      if (this.modal.isOpen) {
        this.modal.close();
        this.clear();
      }
      return;
    }
    // Keyed on content, not identity: a sim that rebuilds the choice object
    // must not wipe the player's picks every frame.
    const prev = this.choice;
    const fresh =
      prev === null ||
      !this.modal.isOpen ||
      prev.slots !== choice.slots ||
      prev.forced !== choice.forced ||
      !sameList(choice.offered, this.offered);
    if (fresh) {
      this.choice = choice;
      this.offered = choice.offered.slice();
      this.keep = defaultKeep(choice);
      this.sent = false;
      this.rows.sync(this.offered);
      const forced = choice.forced;
      this.forcedFlag.set(forced);
      this.title.set(forced ? SUMMARY_TITLE_FORCED : SUMMARY_TITLE_MANUAL);
      this.sub.set(
        forced
          ? 'Your context window overflowed. The summary has room for a few prompt cards; the rest are forgotten. Tools stay installed.'
          : 'Summarising on your own terms. Pick the prompt cards worth remembering; the rest are forgotten. Tools stay installed.',
      );
      this.render();
    } else if (this.sent) {
      // Still compacting a frame after confirming: the sim refused the pick.
      // Hand the controls back rather than leaving a dead button.
      this.sent = false;
      this.render();
    }
    if (!this.modal.isOpen) {
      this.modal.open(this.rows.rows.get(this.offered[0] ?? '')?.el ?? null);
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.rows.clear();
    this.modal.destroy();
  }

  // -------------------------------------------------------------------------

  private clear(): void {
    this.choice = null;
    this.offered = [];
    this.keep = [];
    this.sent = false;
    this.rows.clear();
  }

  private get slots(): number {
    return Math.max(0, this.choice?.slots ?? 0);
  }

  private toggle(id: string): void {
    if (this.sent) return;
    const at = this.keep.indexOf(id);
    if (at >= 0) {
      this.keep.splice(at, 1);
    } else if (this.slots > 0) {
      // Full: the earliest pick makes room, so with one slot this behaves like
      // a radio group and with more it never refuses a click.
      if (this.keep.length >= this.slots) this.keep.shift();
      this.keep.push(id);
    }
    this.render();
  }

  private render(): void {
    const kept = new Set(this.keep);
    for (const [id, row] of this.rows.rows) {
      const on_ = kept.has(id);
      row.kept.set(on_);
      row.el.setAttribute('aria-pressed', String(on_));
      row.state.set(on_ ? 'KEPT IN SUMMARY' : DROPPED_TEXT);
    }
    const n = this.keep.length;
    const total = this.offered.length;
    this.slotsTxt.set(`Keep ${formatInt(Math.min(this.slots, total))} of ${formatInt(total)}`);
    this.confirmTxt.set(
      n === 0 ? 'Forget them all' : `Keep ${formatInt(n)}, forget ${formatInt(Math.max(0, total - n))}`,
    );
    this.confirmDis.set(this.sent);
  }

  private confirm(): void {
    if (this.sent || this.choice === null) return;
    this.sent = true;
    this.confirmDis.set(true);
    this.ctx.emit({ t: 'keepCards', ids: this.keep.slice() });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.modal.isOpen || this.offered.length === 0) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      this.confirm();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (dir !== 0) {
      e.preventDefault();
      const active = document.activeElement;
      const at = this.offered.findIndex((id) => this.rows.rows.get(id)?.el === active);
      const nextAt = at < 0 ? (dir > 0 ? 0 : this.offered.length - 1) : (at + dir + this.offered.length) % this.offered.length;
      const next = this.offered[nextAt];
      if (next !== undefined) this.rows.rows.get(next)?.el.focus();
      return;
    }
    if (e.key >= '1' && e.key <= '9') {
      const id = this.offered[e.key.charCodeAt(0) - 49];
      if (id !== undefined) {
        e.preventDefault();
        this.toggle(id);
        this.rows.rows.get(id)?.el.focus();
      }
    }
  }

  private makeRow(id: string): Row {
    const def = CARD_BY_ID[id];
    const node = btn({
      cls: `tm-sumcard tm-card--${def?.rarity ?? 'common'}`,
      tid: tid(TID.summaryCard, id),
      attrs: { 'aria-pressed': 'false' },
    });
    iconEl(cardIcon(id), node).classList.add('tm-sumcard__icon');
    const body = el('span', { cls: 'tm-sumcard__body', parent: node });
    el('span', { cls: 'tm-sumcard__name', text: (def?.name ?? id).toUpperCase(), parent: body });
    el('span', { cls: 'tm-sumcard__blurb', text: def?.blurb ?? '', parent: body });
    const what = def ? effectsLine(def.effects) : '';
    if (what) el('span', { cls: 'tm-sumcard__effect', text: what, parent: body });
    const state = new Txt(el('span', { cls: 'tm-sumcard__state', parent: node }));
    // Native button activation covers Space and Enter; the click is the toggle.
    node.addEventListener('click', () => this.toggle(id));
    return { el: node, state, kept: new Flag(node, 'is-kept') };
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
