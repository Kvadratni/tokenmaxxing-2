/**
 * Transient messages. Polite live region so a screen reader hears denied
 * purchases and incident chatter without stealing focus.
 */
import { TID } from '../testids.ts';
import { el } from './dom.ts';
import type { ToastTone } from './types.ts';

const MAX_VISIBLE = 4;
const LIFETIME_MS = 2200;

export class Toasts {
  readonly el: HTMLElement;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastText = '';
  private lastAt = -1e9;

  constructor(parent: HTMLElement, private readonly now: () => number) {
    this.el = el('div', {
      cls: 'tm-toasts',
      attrs: { 'aria-live': 'polite', 'aria-atomic': 'false', role: 'status' },
      parent,
    });
  }

  push(text: string, tone: ToastTone = 'info'): void {
    // Rapid-fire duplicates (spamming a denied purchase) collapse into one.
    const t = this.now();
    if (text === this.lastText && t - this.lastAt < 600) return;
    this.lastText = text;
    this.lastAt = t;

    const node = el('div', {
      cls: `tm-toast tm-toast--${tone}`,
      text,
      tid: TID.toast,
      parent: this.el,
    });

    while (this.el.childElementCount > MAX_VISIBLE) {
      this.el.firstElementChild?.remove();
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      node.remove();
    }, LIFETIME_MS);
    this.timers.add(timer);
  }

  destroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.el.remove();
  }
}
