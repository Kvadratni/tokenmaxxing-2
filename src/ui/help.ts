/**
 * The `?` overlay — everything a new player needs, in one dismissable dialog.
 *
 *   const help = createHelp(uiRoot, { onDismiss: () => audio.play('uiHover') });
 *   helpButton.addEventListener('click', () => help.toggle());
 *
 * Structurally a sibling of `about.ts`: a dismissable `Modal`, opened and
 * closed by its owner. `Modal` only *reports* a dismissal (Escape, backdrop);
 * actually closing is this module's job.
 *
 * Every number in here is read out of `src/sim/content.ts` rather than typed
 * in, so a balance pass can never leave the tutorial lying.
 */
import '../styles/help.css';

import { BALANCE, INCIDENTS, PICKUP_BY_ID, PROJECT_NAMES } from '../sim/content.ts';
import {
  formatSlopUnit,
  formatSlops,
  SLOP_UNIT_NAMES,
  SLOP_UNITS,
} from '../sim/format.ts';
import { btn, el, on } from './dom.ts';
import { Modal } from './modal.ts';

// ---------------------------------------------------------------------------
// testids
// ---------------------------------------------------------------------------

/**
 * `data-testid` values this module renders.
 *
 * These belong in `src/testids.ts` — the integrator owns that file, so they
 * live here until they land there. The literals are the contract; once `TID`
 * carries them this object should become an alias, not a second copy.
 */
export const HELP_TID = {
  /** Topbar trigger. Rendered by the host, not by this module. */
  button: 'help-button',
  modal: 'help-modal',
  close: 'help-close',
  loop: 'help-loop',
  /** The 'Between runs' section — the meta loop nobody notices. */
  meta: 'help-meta',
  units: 'help-units',
  controls: 'help-controls',
  /** `${controlRow}-${id}` */
  controlRow: 'help-control-row',
  incidents: 'help-incidents',
} as const;

function scoped(base: string, suffix: string): string {
  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

/** One row of the controls table. Exported so tests can count them. */
export interface ControlRow {
  readonly id: string;
  readonly keys: readonly string[];
  readonly what: string;
}

/**
 * The complete keyboard surface. Mirrors `src/ui/hotkeys.ts`.
 *
 * There is deliberately no `Q` hotkey: the buy-quantity toggle is a button on
 * the rail, because changing how much you are about to spend should never be
 * one stray keystroke away.
 */
export const HELP_CONTROLS: readonly ControlRow[] = [
  {
    id: 'click',
    keys: ['Space', 'Enter'],
    what: 'Click the laptop. Either key works. Every click is slop.',
  },
  {
    id: 'buy',
    keys: ['1–9'],
    what: 'Buy one of the Nth agent tier currently visible in the rail.',
  },
  { id: 'ship', keys: ['S'], what: 'Ship the project the moment the bar is full.' },
  { id: 'close', keys: ['Esc'], what: 'Close a dismissable dialog, or leave the Demos shop.' },
  {
    id: 'draft',
    keys: ['←', '→', '↑', '↓', 'Enter'],
    what: 'Move the highlight across the draft, then Enter to take that card.',
  },
];

const SHIP_RULE = BALANCE.SHIP_DEDUCTS
  ? 'Shipping deducts the requirement straight out of the wallet, so the bar empties and the next project starts from near zero.'
  : 'Shipping leaves the wallet alone; the bar carries over into the next project.';


const LOOP_STEPS: readonly string[] = [
  'Click the laptop. Every click is slop, and slop is the only currency there is.',
  'Buy agents. They produce while you sit still — but the purchase comes off the bar.',
  `Ship when the bar is full. ${SHIP_RULE}`,
  `Draft a card, then take on a harder project. There are ${PROJECT_NAMES.length}, from ${
    PROJECT_NAMES[0] ?? 'the first'
  } to ${PROJECT_NAMES[PROJECT_NAMES.length - 1] ?? 'the last'}.`,
  'Miss a deadline and the venture dies — but you keep its Demos. Spend those, found another.',
];

/** The part players miss: the run is not the game, the tree is. */
const META_POINTS: readonly string[] = [
  'Each run is one startup. Every project it ships banks a Demo, plus a bonus for finishing early — and you keep those whether the venture exits or folds.',
  'Demos buy nodes on a permanent tree. Nothing else carries over: slop, agents and cards all die with the venture.',
  'Unlock nodes add content — new agent tiers, new shop upgrades, new cards. Upgrade nodes raise numbers you already have.',
  'Your first startup cannot reach the last project. That is by design. You are meant to fold, spend, and found a better-funded one.',
];

const OUTAGE_COUNT = INCIDENTS.filter((i) => i.blocksShip === true).length;
const HOTFIX = PICKUP_BY_ID['hotfix'];

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export interface Help {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

export interface HelpOpts {
  /**
   * Fired when the *player* dismisses the overlay — Escape, backdrop click or
   * the Close button. Not fired by a programmatic `close()`, so a host that
   * closes the overlay itself does not get its own event back.
   */
  onDismiss?: () => void;
}

class HelpOverlay implements Help {
  readonly modal: Modal;
  private readonly disposers: Array<() => void> = [];

  constructor(parent: HTMLElement, private readonly opts: HelpOpts) {
    this.modal = new Modal({
      tid: HELP_TID.modal,
      label: 'How to play Tokenmaxxing',
      dismissable: true,
      cls: 'tm-help',
      // `Modal` reports the dismissal; closing is the owner's job.
      onDismiss: () => this.dismiss(),
    });
    parent.appendChild(this.modal.el);

    const panel = this.modal.panel;
    el('h2', { cls: 'tm-modal__title', text: 'How to play', parent: panel });

    // ---- 1. the one rule --------------------------------------------------
    const rule = el('section', { cls: 'tm-help__rule', parent: panel });
    el('p', { cls: 'tm-help__rule-line', text: 'Your wallet is the ship bar.', parent: rule });
    el('p', {
      cls: 'tm-modal__sub',
      text:
        'Every purchase spends the same slop the ship bar measures, so buying always ' +
        'drops the bar. Invest now and finish faster, or hoard and ship on time — that ' +
        'single trade-off is the whole game.',
      parent: rule,
    });

    // ---- 2. the loop ------------------------------------------------------
    const loop = el('section', { cls: 'tm-help__sec', tid: HELP_TID.loop, parent: panel });
    el('h3', { cls: 'tm-help__h', text: 'The loop', parent: loop });
    const steps = el('ol', { cls: 'tm-help__steps', parent: loop });
    for (const s of LOOP_STEPS) el('li', { text: s, parent: steps });

    // ---- 3. between runs -------------------------------------------------
    const meta = el('section', { cls: 'tm-help__sec', tid: HELP_TID.meta, parent: panel });
    el('h3', { cls: 'tm-help__h', text: 'Between runs', parent: meta });
    el('p', {
      cls: 'tm-help__rule-line tm-help__rule-line--meta',
      text: 'Losing is how you make progress.',
      parent: meta,
    });
    const metaList = el('ul', { cls: 'tm-help__steps', parent: meta });
    for (const p of META_POINTS) el('li', { text: p, parent: metaList });

    // ---- 4. slop units ----------------------------------------------------
    const units = el('section', { cls: 'tm-help__sec', tid: HELP_TID.units, parent: panel });
    el('h3', { cls: 'tm-help__h', text: 'Slop and slops', parent: units });
    el('p', {
      cls: 'tm-help__p',
      text:
        'A quantity of work is slop. A rate is slops — slop per second, the same joke ' +
        'as FLOPS. So the wallet reads ' +
        formatSlopUnit(4.2e12) +
        ' and the production readout reads ' +
        formatSlops(1.73e10) +
        '. The trailing S is the "per second"; there is no "/s" after it.',
      parent: units,
    });
    const ladder = el('ul', { cls: 'tm-help__ladder', parent: units });
    for (let i = 1; i < SLOP_UNITS.length; i++) {
      const sym = SLOP_UNITS[i];
      const name = SLOP_UNIT_NAMES[i];
      if (sym === undefined || sym === '' || name === undefined) continue;
      const li = el('li', { parent: ladder });
      el('b', { text: sym, parent: li });
      el('span', { text: ` ${name}`, parent: li });
    }

    // ---- 5. controls ------------------------------------------------------
    const controls = el('section', {
      cls: 'tm-help__sec',
      tid: HELP_TID.controls,
      parent: panel,
    });
    el('h3', { cls: 'tm-help__h', text: 'Controls', parent: controls });
    const table = el('table', {
      cls: 'tm-help__keys',
      parent: controls,
      attrs: { 'aria-label': 'Keyboard controls' },
    });
    const tbody = el('tbody', { parent: table });
    for (const row of HELP_CONTROLS) {
      const tr = el('tr', { tid: scoped(HELP_TID.controlRow, row.id), parent: tbody });
      const th = el('th', { parent: tr, attrs: { scope: 'row' } });
      for (const k of row.keys) el('kbd', { text: k, parent: th });
      el('td', { text: row.what, parent: tr });
    }
    el('p', {
      cls: 'tm-help__note',
      text:
        'There is deliberately no Q hotkey. The buy-quantity toggle is a button on the ' +
        'rail, because changing how much you are about to spend should never be one ' +
        'stray keystroke away.',
      parent: controls,
    });

    // ---- 6. incidents and outages ----------------------------------------
    const inc = el('section', { cls: 'tm-help__sec', tid: HELP_TID.incidents, parent: panel });
    el('h3', { cls: 'tm-help__h', text: 'Incidents and outages', parent: inc });
    el('p', {
      cls: 'tm-help__p',
      text:
        'Incidents never pause the deadline. The clock keeps burning while you deal with ' +
        'them, and that panic is the point. Some clear on a timer, some clear once you ' +
        'have clicked them down — the banner tells you which.',
      parent: inc,
    });
    el('p', {
      cls: 'tm-help__p',
      text:
        `An outage is the nasty one: ${OUTAGE_COUNT} of them exist, and while any is ` +
        'active shipping is blocked outright — the ship button reads CANNOT SHIP even ' +
        'at a full bar. Wait it out, click it down where it allows that, or catch a ' +
        (HOTFIX?.label ?? 'Hotfix') +
        ' pickup: ' +
        (HOTFIX?.blurb ?? 'it clears every incident, outages included.'),
      parent: inc,
    });

    // ---- foot -------------------------------------------------------------
    const foot = el('div', { cls: 'tm-help__foot', parent: panel });
    el('p', {
      cls: 'tm-help__note',
      text: 'Reopen this any time with the ? button in the top bar.',
      parent: foot,
    });
    const close = btn({
      cls: 'tm-btn tm-btn--primary',
      tid: HELP_TID.close,
      text: 'Got it',
      parent: foot,
    });
    this.disposers.push(on(close, 'click', () => this.dismiss()));
  }

  get el(): HTMLElement {
    return this.modal.el;
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  open(): void {
    this.modal.open(null);
  }

  close(): void {
    this.modal.close();
  }

  toggle(): void {
    if (this.modal.isOpen) this.close();
    else this.open();
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.modal.destroy();
  }

  /** Player-initiated close: shut the dialog, then tell the host. */
  private dismiss(): void {
    this.close();
    this.opts.onDismiss?.();
  }
}

/**
 * Mount the help overlay. It starts closed and hidden; nothing renders on
 * screen until `open()`.
 */
export function createHelp(parent: HTMLElement, opts: HelpOpts = {}): Help {
  return new HelpOverlay(parent, opts);
}
