/**
 * Dialog shell: `role="dialog"`, `aria-modal`, a focus trap, focus restore and
 * Escape handling. Non-dismissable dialogs (the draft) swallow Escape rather
 * than letting it bubble out to the game hotkeys.
 */
import { el, focusables, Hide, on, trapTab } from './dom.ts';

export interface ModalOpts {
  /** `data-testid` for the outer overlay. */
  tid: string;
  /** Accessible name. */
  label: string;
  /** Whether Escape / backdrop click may close it. */
  dismissable: boolean;
  cls?: string;
  onDismiss?: () => void;
}

export class Modal {
  /** The full-viewport overlay. Carries the testid and the dialog role. */
  readonly el: HTMLElement;
  /** The bordered panel that content goes into. */
  readonly panel: HTMLElement;

  private readonly hide: Hide;
  private readonly disposers: Array<() => void> = [];
  private prevFocus: HTMLElement | null = null;
  private open_ = false;
  private initial: HTMLElement | null = null;

  constructor(private readonly opts: ModalOpts) {
    this.el = el('div', {
      cls: `tm-modal${opts.cls ? ' ' + opts.cls : ''}`,
      tid: opts.tid,
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': opts.label,
      },
    });
    this.el.setAttribute('hidden', '');
    this.hide = new Hide(this.el);
    this.hide.set(true);
    this.panel = el('div', { cls: 'tm-modal__panel', parent: this.el });

    this.disposers.push(
      on(this.el, 'keydown', (ev) => this.onKeyDown(ev as KeyboardEvent)),
    );
    if (opts.dismissable) {
      this.disposers.push(
        on(this.el, 'mousedown', (ev) => {
          if (ev.target === this.el) this.opts.onDismiss?.();
        }),
      );
    }
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** `initialFocus` wins over the first focusable child. */
  open(initialFocus?: HTMLElement | null): void {
    if (this.open_) return;
    this.open_ = true;
    const active = document.activeElement;
    this.prevFocus = active instanceof HTMLElement ? active : null;
    this.hide.set(false);
    this.initial = initialFocus ?? null;
    this.focusFirst();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.hide.set(true);
    const prev = this.prevFocus;
    this.prevFocus = null;
    if (prev !== null && prev.isConnected) prev.focus();
  }

  /** Re-focus after content has been (re)built while already open. */
  focusFirst(): void {
    const target = this.initial ?? focusables(this.panel)[0] ?? this.panel;
    if (!(target instanceof HTMLElement)) return;
    if (target === this.panel && !this.panel.hasAttribute('tabindex')) {
      this.panel.setAttribute('tabindex', '-1');
    }
    target.focus();
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.el.remove();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // Either way the key stops here: a modal is up, the game must not react.
      e.stopPropagation();
      e.preventDefault();
      if (this.opts.dismissable) this.opts.onDismiss?.();
      return;
    }
    trapTab(this.panel, e);
  }
}
