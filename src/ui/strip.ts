/**
 * The card strip under the stage: every prompt card the human has typed into
 * this session, plus the number that makes holding them a decision, how many
 * survive the next compaction.
 */
import { CARD_BY_ID } from '../sim/content.ts';
import type { DerivedStats, RunState } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, el, Flag, Hide, KeyedRows, Txt } from './dom.ts';
import { effectsLine } from './effect-text.ts';
import { formatInt } from './format.ts';
import { cardIcon } from './icon-ids.ts';
import { iconEl } from './icon.ts';

interface Chip {
  el: HTMLElement;
}

export class CardStrip {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rows: KeyedRows<Chip>;
  private readonly count: Txt;
  private readonly risk: Flag;
  private readonly empty: Hide;

  constructor(parent: HTMLElement) {
    this.el = el('div', { cls: 'tm-strip', parent });
    const head = el('div', {
      cls: 'tm-strip__head',
      parent: this.el,
      attrs: { title: 'Compaction keeps this many cards. You choose which.' },
    });
    this.count = new Txt(el('span', { cls: 'tm-strip__count', parent: head }));
    this.risk = new Flag(head, 'is-risk');
    this.list = el('ul', {
      cls: 'tm-strip__cards',
      tid: TID.activeCards,
      parent: this.el,
      attrs: { 'aria-label': 'Prompt cards in effect' },
    });
    const empty = el('div', {
      cls: 'tm-strip__empty',
      text: 'No prompt cards yet. Report done and the human starts prompt engineering.',
      parent: this.el,
    });
    this.empty = new Hide(empty);
    this.rows = new KeyedRows<Chip>(
      this.list,
      (id) => this.makeChip(id),
      (r) => r.el,
    );
  }

  update(run: RunState, d: DerivedStats): void {
    this.rows.sync(run.cards);
    this.empty.set(run.cards.length > 0);
    const held = run.cards.length;
    const slots = d.summarySlots;
    this.count.set(`CARDS ${formatInt(held)} · KEEP ${formatInt(slots)}`);
    this.risk.set(held > slots);
  }

  destroy(): void {
    this.rows.clear();
    this.el.remove();
  }

  private makeChip(id: string): Chip {
    const def = CARD_BY_ID[id];
    const li = el('li', { cls: 'tm-strip__item' });
    const what = def ? effectsLine(def.effects) : '';
    const chip = btn({
      cls: `tm-chip tm-chip--card tm-chip--${def?.rarity ?? 'common'}`,
      tid: tid(TID.activeCard, id),
      parent: li,
      label: `${def?.name ?? id}: ${def?.blurb ?? ''} ${what}`.trim(),
    });
    iconEl(cardIcon(id), chip).classList.add('tm-chip__icon');
    el('span', { cls: 'tm-chip__name', text: def?.name ?? id, parent: chip });
    const tip = el('span', { cls: 'tm-chip__tip', parent: chip, attrs: { 'aria-hidden': 'true' } });
    el('span', { cls: 'tm-chip__blurb', text: def?.blurb ?? '', parent: tip });
    if (what) el('span', { cls: 'tm-chip__effect', text: what, parent: tip });
    return { el: li };
  }
}
