/**
 * Draft modal. Opens on `phase === 'drafting'`, closes when the pick lands.
 * A pick is mandatory, so this dialog is explicitly NOT dismissable: Escape is
 * swallowed by `Modal` and there is no close affordance.
 */
import { CARD_BY_ID } from '../sim/content.ts';
import type { RunState } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, Dis, el, Hide, KeyedRows, on, Txt } from './dom.ts';
import { iconEl } from './icon.ts';
import { Modal } from './modal.ts';
import type { UICtx } from './types.ts';

interface CardNode {
  el: HTMLButtonElement;
}

export class Draft {
  readonly modal: Modal;
  private readonly cardsHost: HTMLElement;
  private readonly cards: KeyedRows<CardNode>;
  private readonly confirmBtn!: HTMLButtonElement;
  private readonly confirmTxt!: Txt;
  private readonly confirmDis!: Dis;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly rerollHide: Hide;
  private readonly rerollCount: Txt;
  private readonly disposers: Array<() => void> = [];
  private offer: string[] = [];
  private selected: string | null = null;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.modal = new Modal({
      tid: TID.draftModal,
      label: 'Draft a card',
      dismissable: false,
      cls: 'tm-draft',
    });
    parent.appendChild(this.modal.el);

    el('h2', { cls: 'tm-modal__title', text: 'Pick one', parent: this.modal.panel });
    el('p', {
      cls: 'tm-modal__sub',
      text: 'Shipped. Take something for the next project — you have to take something.',
      parent: this.modal.panel,
    });

    el('p', {
      cls: 'tm-draft__hint',
      text: 'Arrow keys to choose · Enter to take',
      parent: this.modal.panel,
      attrs: { 'aria-hidden': 'true' },
    });

    this.cardsHost = el('div', { cls: 'tm-draft__cards', parent: this.modal.panel });
    this.cards = new KeyedRows<CardNode>(
      this.cardsHost,
      (id) => this.makeCard(id),
      (r) => r.el,
    );

    const foot = el('div', { cls: 'tm-title__actions', parent: this.modal.panel });
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
    this.disposers.push(on(this.confirmBtn, 'click', () => this.commit()));

    this.rerollBtn = btn({ cls: 'tm-btn', tid: TID.draftReroll, parent: foot });
    el('span', { text: 'Reroll ', parent: this.rerollBtn });
    this.rerollCount = new Txt(
      el('span', { tid: TID.draftRerollCount, text: '0', parent: this.rerollBtn }),
    );
    this.rerollHide = new Hide(this.rerollBtn);
    this.rerollHide.set(true);

    this.disposers.push(
      on(this.modal.el, 'keydown', (ev) => this.onKey(ev as KeyboardEvent)),
      on(this.rerollBtn, 'click', () => {
        const ok = this.ctx.sim.rerollDraft();
        this.ctx.emit({ t: 'rerollDraft', ok });
        if (!ok) this.ctx.toast('No rerolls left', 'bad');
      }),
    );
  }

  /**
   * Arrows move the highlight, Enter takes it. The modal opens with *nothing*
   * highlighted, so a stray Enter right after shipping still cannot commit —
   * you have to aim first.
   */
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
      const at = this.selected ? this.offer.indexOf(this.selected) : -1;
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

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** Force-close (leaving the run screen); the sim keeps its own phase. */
  close(): void {
    if (!this.modal.isOpen) return;
    this.modal.close();
    this.offer = [];
    this.selected = null;
    this.cards.clear();
  }

  update(run: RunState): void {
    const drafting = run.phase === 'drafting';
    if (!drafting) {
      if (this.modal.isOpen) {
        this.modal.close();
        this.offer = [];
        this.selected = null;
        this.cards.clear();
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
      this.selected = null;
      this.confirmTxt.set('Pick a card');
      this.confirmDis.set(true);
    }

    const rerolls = run.draftRerollsLeft;
    this.rerollHide.set(rerolls <= 0);
    this.rerollCount.set(String(Math.max(0, rerolls)));

    if (!this.modal.isOpen) {
      this.modal.open(this.cards.rows.get(this.offer[0] ?? '')?.el ?? null);
    } else if (changed) {
      // Rerolled: the previously focused card is gone.
      this.modal.focusFirst();
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.cards.clear();
    this.modal.destroy();
  }

  private makeCard(id: string): CardNode {
    const def = CARD_BY_ID[id];
    const rarity = def?.rarity ?? 'common';
    const node = btn({
      cls: `tm-card tm-card--${rarity}`,
      tid: tid(TID.draftCard, id),
      attrs: { 'aria-pressed': 'false' },
    });
    const head = el('span', { cls: 'tm-card__head', parent: node });
    iconEl(id, head).classList.add('tm-card__icon');
    el('span', { cls: 'tm-card__rarity', text: rarity, parent: head });
    el('span', { cls: 'tm-card__name', text: def?.name ?? id, parent: node });
    el('span', { cls: 'tm-card__blurb', text: def?.blurb ?? '', parent: node });
    // Clicking a card only *highlights* it. Committing is a separate, explicit
    // press on Confirm — otherwise a stray Space or a second Enter right after
    // shipping silently locks in whichever card happened to have focus.
    node.addEventListener('click', () => this.select(id));
    return { el: node };
  }

  /** Highlight a card without committing to it. */
  private select(id: string): void {
    this.selected = id;
    for (const [key, row] of this.cards.rows) {
      const on = key === id;
      row.el.classList.toggle('is-selected', on);
      row.el.setAttribute('aria-pressed', String(on));
    }
    const def = CARD_BY_ID[id];
    this.confirmTxt.set(`Take ${def?.name ?? id}`);
    this.confirmDis.set(false);
  }

  private commit(): void {
    const id = this.selected;
    if (id === null) return;
    const def = CARD_BY_ID[id];
    const ok = this.ctx.sim.pickCard(id);
    this.ctx.emit({ t: 'pickCard', id, ok });
    if (ok) this.selected = null;
    else this.ctx.toast(`Could not take ${def?.name ?? id}`, 'bad');
  }
}
