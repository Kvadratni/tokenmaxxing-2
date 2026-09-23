/**
 * The draft: "THE HUMAN IS PROMPT ENGINEERING".
 *
 * Opens on `phase === 'drafting'` and closes when the pick lands. A pick is
 * mandatory, so the dialog is NOT dismissable: Escape is swallowed by `Modal`
 * and there is no close button. Picking is two-step on purpose: a click (or
 * the arrows) only highlights a card, CONFIRM commits it. The dialog opens
 * with nothing highlighted, so a stray Enter right after reporting cannot lock
 * in whichever card happened to have focus.
 */
import { CARD_BY_ID } from '../sim/content.ts';
import type { RunState } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, Dis, el, KeyedRows, on, Txt } from './dom.ts';
import { effectsLine } from './effect-text.ts';
import { cardIcon } from './icon-ids.ts';
import { iconEl } from './icon.ts';
import { Modal } from './modal.ts';
import type { UICtx } from './types.ts';

export const DRAFT_TITLE = 'THE HUMAN IS PROMPT ENGINEERING';

interface CardNode {
  el: HTMLButtonElement;
}

export class Draft {
  readonly modal: Modal;
  private readonly cards: KeyedRows<CardNode>;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly confirmTxt: Txt;
  private readonly confirmDis: Dis;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly rerollDis: Dis;
  private readonly rerollCount: Txt;
  private readonly disposers: Array<() => void> = [];
  private offer: string[] = [];
  private selected: string | null = null;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.modal = new Modal({
      tid: TID.draftModal,
      label: 'The human is prompt engineering: pick a card',
      dismissable: false,
      cls: 'tm-draft',
    });
    parent.appendChild(this.modal.el);

    el('h2', { cls: 'tm-modal__title tm-draft__title', text: DRAFT_TITLE, parent: this.modal.panel });
    el('p', {
      cls: 'tm-modal__sub',
      text: 'Reported. Now the human is tweaking the prompt. Pick what they type next: it stays in every prompt until a compaction forgets it.',
      parent: this.modal.panel,
    });

    const cardsHost = el('div', { cls: 'tm-draft__cards', parent: this.modal.panel });
    this.cards = new KeyedRows<CardNode>(
      cardsHost,
      (id) => this.makeCard(id),
      (r) => r.el,
    );

    el('p', {
      cls: 'tm-hint',
      text: '← → to choose · Enter to confirm',
      parent: this.modal.panel,
      attrs: { 'aria-hidden': 'true' },
    });

    const foot = el('div', { cls: 'tm-modal__actions', parent: this.modal.panel });
    this.rerollBtn = btn({ cls: 'tm-btn', tid: TID.draftReroll, parent: foot });
    el('span', { text: 'Reroll ', parent: this.rerollBtn });
    this.rerollCount = new Txt(
      el('span', { cls: 'tm-draft__rerolls', tid: TID.draftRerollCount, text: '0', parent: this.rerollBtn }),
    );
    this.rerollDis = new Dis(this.rerollBtn);
    this.rerollDis.set(true);

    this.confirmBtn = btn({
      cls: 'tm-btn tm-btn--primary',
      tid: TID.draftConfirm,
      parent: foot,
      label: 'Confirm the highlighted card',
    });
    this.confirmTxt = new Txt(this.confirmBtn);
    this.confirmTxt.set('Pick a card');
    this.confirmDis = new Dis(this.confirmBtn);
    this.confirmDis.set(true);

    this.disposers.push(
      on(this.confirmBtn, 'click', () => this.commit()),
      on(this.rerollBtn, 'click', () => {
        if (!this.rerollBtn.disabled) this.ctx.emit({ t: 'reroll' });
      }),
      on(this.modal.el, 'keydown', (ev) => this.onKey(ev as KeyboardEvent)),
    );
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** The card currently highlighted, if any. */
  get highlighted(): string | null {
    return this.selected;
  }

  /** Force-close (leaving the run screen); the sim keeps its own phase. */
  close(): void {
    if (!this.modal.isOpen) return;
    this.modal.close();
    this.reset();
  }

  update(run: RunState): void {
    if (run.phase !== 'drafting') {
      if (this.modal.isOpen) {
        this.modal.close();
        this.reset();
      }
      return;
    }

    let changed = this.offer.length !== run.draftOffer.length;
    if (!changed) {
      for (let i = 0; i < this.offer.length; i++) {
        if (this.offer[i] !== run.draftOffer[i]) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      this.offer = run.draftOffer.slice();
      this.cards.sync(this.offer);
      // A reroll invalidates the highlight.
      this.select(null);
    }

    const rerolls = Math.max(0, run.draftRerollsLeft);
    this.rerollCount.set(String(rerolls));
    this.rerollDis.set(rerolls <= 0);

    if (!this.modal.isOpen) {
      this.modal.open(this.cards.rows.get(this.offer[0] ?? '')?.el ?? null);
    } else if (changed) {
      // Rerolled: the previously focused card is gone.
      this.cards.rows.get(this.offer[0] ?? '')?.el.focus();
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.cards.clear();
    this.modal.destroy();
  }

  // -------------------------------------------------------------------------

  private reset(): void {
    this.offer = [];
    this.selected = null;
    this.cards.clear();
    this.confirmTxt.set('Pick a card');
    this.confirmDis.set(true);
  }

  /** Arrows move the highlight, Enter takes it. */
  private onKey(e: KeyboardEvent): void {
    if (!this.modal.isOpen || this.offer.length === 0) return;
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (dir !== 0) {
      e.preventDefault();
      const at = this.selected !== null ? this.offer.indexOf(this.selected) : dir > 0 ? -1 : 0;
      const next = this.offer[(at + dir + this.offer.length) % this.offer.length];
      if (next !== undefined) {
        this.select(next);
        this.cards.rows.get(next)?.el.focus();
      }
      return;
    }
    if (e.key === 'Enter' && this.selected !== null) {
      // Stop the focused card's native activation firing a second select.
      e.preventDefault();
      e.stopPropagation();
      this.commit();
    }
  }

  private makeCard(id: string): CardNode {
    const def = CARD_BY_ID[id];
    const rarity = def?.rarity ?? 'common';
    const node = btn({
      cls: `tm-card tm-card--${rarity}`,
      tid: tid(TID.draftCard, id),
      attrs: { 'aria-pressed': 'false' },
    });
    el('span', { cls: 'tm-card__name', text: (def?.name ?? id).toUpperCase(), parent: node });
    const art = el('span', { cls: 'tm-card__art', parent: node });
    iconEl(cardIcon(id), art).classList.add('tm-card__icon');
    el('span', { cls: 'tm-card__rarity', text: rarity, parent: art });
    el('span', { cls: 'tm-card__blurb', text: def?.blurb ?? '', parent: node });
    const what = def ? effectsLine(def.effects, def.onPick ?? []) : '';
    if (what) el('span', { cls: 'tm-card__effect', text: what, parent: node });
    node.addEventListener('click', () => this.select(id));
    return { el: node };
  }

  /** Highlight a card without committing to it (null clears). */
  private select(id: string | null): void {
    this.selected = id;
    for (const [key, row] of this.cards.rows) {
      const on_ = key === id;
      row.el.classList.toggle('is-selected', on_);
      row.el.setAttribute('aria-pressed', String(on_));
    }
    if (id === null) {
      this.confirmTxt.set('Pick a card');
      this.confirmDis.set(true);
      return;
    }
    this.confirmTxt.set('Confirm');
    this.confirmDis.set(false);
  }

  private commit(): void {
    const id = this.selected;
    if (id === null || this.confirmBtn.disabled) return;
    this.ctx.emit({ t: 'pickCard', id });
  }
}
