/**
 * The one-time "we found your Tokenmaxxing 1 save" notice.
 *
 * Both games live on the same origin, so the sequel can read the first game's
 * save. When the sim runs that import it emits `legacyImport` exactly once,
 * and this dialog says so: you were the human last time. A save the first
 * game would have called tampered gets the gift anyway, plus a word from
 * Legal. Dismissable; it never comes back, because the event never does.
 */
import type { SaveVerdict } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { btn, el, on, Txt } from './dom.ts';
import { formatInt } from './format.ts';
import { Modal } from './modal.ts';

/** The notice's copy, as plain data. Exported for tests. */
export function legacyLines(
  verdict: SaveVerdict,
  gift: number,
  cheater = false,
): { title: string; body: string; legal: string | null } {
  const tampered = cheater || verdict === 'edited' || verdict === 'forged';
  return {
    title: 'Returning customer',
    body: `Found a Tokenmaxxing 1 save. You were the human last time. +${formatInt(gift)} 👍`,
    legal: tampered
      ? 'Legal has been notified. Here is the gift anyway: the human cheats too, so they will check your work less.'
      : null,
  };
}

export class LegacyNotice {
  readonly modal: Modal;
  private readonly title: Txt;
  private readonly body: Txt;
  private readonly legal: Txt;
  private readonly okBtn: HTMLButtonElement;
  private readonly disposers: Array<() => void> = [];
  private shown = false;

  constructor(parent: HTMLElement) {
    this.modal = new Modal({
      tid: TID.legacyNotice,
      label: 'A Tokenmaxxing 1 save was found',
      dismissable: true,
      cls: 'tm-legacy',
      onDismiss: () => this.close(),
    });
    parent.appendChild(this.modal.el);
    const p = this.modal.panel;
    el('div', { cls: 'tm-legacy__kicker', text: 'tokenmaxxing.save.v1', parent: p });
    this.title = new Txt(el('h2', { cls: 'tm-modal__title', parent: p }));
    this.body = new Txt(el('p', { cls: 'tm-legacy__body', parent: p }));
    this.legal = new Txt(el('p', { cls: 'tm-legacy__legal', parent: p }));
    const foot = el('div', { cls: 'tm-modal__actions', parent: p });
    this.okBtn = btn({ cls: 'tm-btn tm-btn--primary', text: 'Nice', parent: foot, tid: TID.legacyOk });
    this.disposers.push(on(this.okBtn, 'click', () => this.close()));
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** Show the notice. Only the first call ever does anything. */
  show(verdict: SaveVerdict, gift: number, cheater = false): void {
    if (this.shown) return;
    this.shown = true;
    const lines = legacyLines(verdict, gift, cheater);
    this.title.set(lines.title);
    this.body.set(lines.body);
    this.legal.set(lines.legal ?? '');
    this.legal.node.hidden = lines.legal === null;
    this.modal.el.classList.toggle('is-tampered', lines.legal !== null);
    this.modal.open(this.okBtn);
  }

  close(): void {
    this.modal.close();
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.modal.destroy();
  }
}
