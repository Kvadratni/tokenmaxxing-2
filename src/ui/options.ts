/**
 * Options dialog. Everything here writes straight into `sim.meta.settings`
 * (the sim owns persistence) and re-reports through `onAction` so the host can
 * flush the save and re-apply volumes immediately.
 *
 * `Settings` has no `muted` field, so mute is modelled as "both volumes to 0",
 * with the pre-mute levels remembered in memory for the session.
 */
import type { Settings } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { btn, el, on, Txt } from './dom.ts';
import { Modal } from './modal.ts';
import type { UICtx } from './types.ts';

const RESET_CONFIRM_MS = 4000;

interface Slider {
  input: HTMLInputElement;
  value: Txt;
}

export class Options {
  readonly modal: Modal;
  private readonly music: Slider;
  private readonly sfx: Slider;
  private readonly muteBtn: HTMLButtonElement;
  private readonly motionBtn: HTMLButtonElement;
  private readonly shakeBtn: HTMLButtonElement;
  private readonly fpsBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly resetTxt: Txt;
  private readonly disposers: Array<() => void> = [];
  private resetArmed = false;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private premute = { music: 0.6, sfx: 0.8 };

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.modal = new Modal({
      tid: TID.optionsPanel,
      label: 'Options',
      dismissable: true,
      cls: 'tm-options',
      onDismiss: () => this.close(),
    });
    parent.appendChild(this.modal.el);

    el('h2', { cls: 'tm-modal__title', text: 'Options', parent: this.modal.panel });

    this.music = this.makeSlider('Music', 'music-volume', (v) => {
      this.settings.musicVolume = v;
      this.commit();
    });
    this.sfx = this.makeSlider('SFX', 'sfx-volume', (v) => {
      this.settings.sfxVolume = v;
      this.commit();
    });

    this.muteBtn = this.makeToggle('Mute', TID.muteToggle, () => {
      const s = this.settings;
      if (s.musicVolume === 0 && s.sfxVolume === 0) {
        s.musicVolume = this.premute.music;
        s.sfxVolume = this.premute.sfx;
      } else {
        this.premute = { music: s.musicVolume, sfx: s.sfxVolume };
        s.musicVolume = 0;
        s.sfxVolume = 0;
      }
      this.commit();
    });
    this.motionBtn = this.makeToggle('Reduced motion', TID.reducedMotion, () => {
      this.settings.reducedMotion = !this.settings.reducedMotion;
      this.commit();
    });
    this.shakeBtn = this.makeToggle('Screen shake', 'screen-shake', () => {
      this.settings.screenShake = !this.settings.screenShake;
      this.commit();
    });
    this.fpsBtn = this.makeToggle('Show FPS', 'show-fps', () => {
      this.settings.showFps = !this.settings.showFps;
      this.commit();
    });

    const foot = el('div', { cls: 'tm-title__actions', parent: this.modal.panel });
    this.resetBtn = btn({
      cls: 'tm-btn tm-btn--danger',
      tid: TID.resetSave,
      text: 'Reset save',
      parent: foot,
    });
    this.resetTxt = new Txt(this.resetBtn);
    this.resetTxt.set('Reset save');
    const close = btn({ cls: 'tm-btn', text: 'Close', parent: foot, tid: 'options-close' });

    this.disposers.push(
      on(this.resetBtn, 'click', () => this.onReset()),
      on(close, 'click', () => this.close()),
    );
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(): void {
    this.sync();
    this.modal.open();
  }

  close(): void {
    this.disarmReset();
    this.modal.close();
  }

  toggle(): void {
    if (this.modal.isOpen) this.close();
    else this.open();
  }

  /** Pull DOM controls back in line with the current settings object. */
  sync(): void {
    const s = this.settings;
    this.music.input.value = String(Math.round(s.musicVolume * 100));
    this.music.value.set(`${Math.round(s.musicVolume * 100)}%`);
    this.sfx.input.value = String(Math.round(s.sfxVolume * 100));
    this.sfx.value.set(`${Math.round(s.sfxVolume * 100)}%`);
    press(this.muteBtn, s.musicVolume === 0 && s.sfxVolume === 0);
    press(this.motionBtn, s.reducedMotion);
    press(this.shakeBtn, s.screenShake);
    press(this.fpsBtn, s.showFps);
  }

  destroy(): void {
    this.disarmReset();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.modal.destroy();
  }

  // -------------------------------------------------------------------------

  private get settings(): Settings {
    return this.ctx.sim.meta.settings;
  }

  private commit(): void {
    this.sync();
    this.ctx.emit({ t: 'settingsChange', settings: this.settings });
  }

  private makeSlider(label: string, testid: string, onInput: (v: number) => void): Slider {
    const row = el('div', { cls: 'tm-opt', parent: this.modal.panel });
    const id = `tm-opt-${testid}`;
    const lab = el('label', { text: label, parent: row });
    lab.setAttribute('for', id);
    const input = el('input', { parent: row, tid: testid });
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.id = id;
    const value = new Txt(el('span', { cls: 'tm-opt__value', parent: row }));
    this.disposers.push(
      on(input, 'input', () => {
        const n = Number(input.value);
        onInput(Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 0);
      }),
    );
    return { input, value };
  }

  private makeToggle(label: string, testid: string, onClick: () => void): HTMLButtonElement {
    const row = el('div', { cls: 'tm-opt', parent: this.modal.panel });
    el('span', { text: label, parent: row });
    const b = btn({
      cls: 'tm-toggle',
      tid: testid,
      text: 'off',
      parent: row,
      attrs: { 'aria-pressed': 'false' },
      label,
    });
    this.disposers.push(on(b, 'click', onClick));
    return b;
  }

  private onReset(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetTxt.set('Really? Click again');
      this.resetTimer = setTimeout(() => this.disarmReset(), RESET_CONFIRM_MS);
      return;
    }
    this.disarmReset();
    this.ctx.emit({ t: 'resetSave' });
    this.ctx.toast('Save wiped', 'bad');
    this.close();
  }

  private disarmReset(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    if (this.resetArmed) {
      this.resetArmed = false;
      this.resetTxt.set('Reset save');
    }
  }
}

function press(b: HTMLButtonElement, on_: boolean): void {
  if (b.getAttribute('aria-pressed') === String(on_)) return;
  b.setAttribute('aria-pressed', String(on_));
  b.textContent = on_ ? 'on' : 'off';
}
