/**
 * The `?` dialog: everything a new player needs, in one dismissable dialog.
 *
 *   const help = createHelp(uiRoot, { onDismiss: () => audio.play('uiHover') });
 *   helpButton.addEventListener('click', () => help.toggle());
 *
 * Every number in here is read out of `src/sim/content.ts` rather than typed
 * in, so a balance pass can never leave the tutorial lying.
 */
import '../styles/help.css';

import { BALANCE, CONTEXT_WINDOW_LABELS, FINAL_PROMPT_INDEX, INCIDENTS, PROMPT_TEXTS } from '../sim/content.ts';
import { TID } from '../testids.ts';
import { btn, el, on } from './dom.ts';
import { formatContext } from './format.ts';
import { Modal } from './modal.ts';

/** `data-testid`s this dialog renders beyond the frozen ones in src/testids.ts. */
export const HELP_TID = {
  loop: 'help-loop',
  clocks: 'help-clocks',
  compaction: 'help-compaction',
  claims: 'help-claims',
  incidents: 'help-incidents',
  /** `${controlRow}-${id}` */
  controlRow: 'help-control-row',
} as const;

/** One row of the controls table. Exported so tests can count them. */
export interface ControlRow {
  readonly id: string;
  readonly keys: readonly string[];
  readonly what: string;
}

/** The complete keyboard surface. Mirrors `src/ui/hotkeys.ts`. */
export const HELP_CONTROLS: readonly ControlRow[] = [
  {
    id: 'generate',
    keys: ['Click', 'Space'],
    what: 'Click the agent, or press Space anywhere, to generate tokens. Enter works while the agent has focus.',
  },
  { id: 'buy', keys: ['1–9'], what: 'Buy the Nth tool in the rail, at the ×1 / ×10 / ×100 you have set.' },
  { id: 'report', keys: ['S'], what: 'Report done, or claim done: whatever the big button says.' },
  { id: 'sycophancy', keys: ['Y'], what: '"You\'re absolutely right!" Buys back some patience. Worth half as much each time.' },
  { id: 'compact', keys: ['C'], what: '/compact, once Training has unlocked it.' },
  { id: 'close', keys: ['Esc'], what: 'Close a dialog or the shop drawer, or leave Training.' },
  {
    id: 'pick',
    keys: ['←', '→', 'Enter'],
    what: 'In the draft: move the highlight, then confirm. In the summary picker: Space keeps or drops.',
  },
];

const pct = (f: number): string => `${Math.round(f * 100)}%`;
const PROMPTS = FINAL_PROMPT_INDEX + 1;
const OUTAGES = INCIDENTS.filter((i) => i.blocksReport === true).length;

const LOOP_STEPS: readonly string[] = [
  'Click the agent to generate tokens. Tokens are your wallet, and the wallet is the report bar.',
  'Buy tools. They generate on their own, but every one adds context every second it runs: its footprint, "+7 ctx/s".',
  `Report done once the wallet covers the prompt; it spends the requirement. ${PROMPTS} prompts, from "${
    PROMPT_TEXTS[0] ?? ''
  }" to "${PROMPT_TEXTS[FINAL_PROMPT_INDEX] ?? ''}".`,
  'After each report the human prompt-engineers you: pick one card of three. MAKE NO MISTAKES does something. Probably.',
  'The human\'s patience burns the whole time. At zero they switch models and the session is over.',
];

const CLOCK_POINTS: readonly string[] = [
  `Patience starts at ${Math.round(BALANCE.PATIENCE_BASE_MS / 1000)}s and shrinks every prompt. "You're absolutely right!" (Y) buys some back: ${pct(
    BALANCE.SYCOPHANCY_BASE,
  )} at first, half as much each press, cooling off over about ${Math.round(
    BALANCE.SYCOPHANCY_HEAT_DECAY_MS / 1000,
  )}s. Sycophancy is tokens too, so every press costs context.`,
  `Context fills from activity, not value: ${BALANCE.CTX_PER_CLICK} per click, each tool's footprint every second, and screenshots the human pastes in. MCP Servers bring manuals that never leave: the hatched part of the bar.`,
  `The window starts at ${formatContext(BALANCE.BASE_CONTEXT)}. Training grows it: ${CONTEXT_WINDOW_LABELS.join(
    ', ',
  )}.`,
];

const COMPACTION_POINTS: readonly string[] = [
  `Overflow and you are compacted: you keep ${pct(BALANCE.COMPACT_KEEP_FORCED)} of the wallet, lose ${pct(
    BALANCE.COMPACT_PENALTY,
  )} of the human's patience, and the context resets to the floor.`,
  `/compact (C, unlocked in Training) does it on your terms: keep ${pct(
    BALANCE.COMPACT_KEEP_MANUAL,
  )} of the wallet, no patience cost, and generation pauses for ${Math.round(BALANCE.MANUAL_COMPACT_MS / 1000)}s.`,
  `Either way, only ${BALANCE.BASE_SUMMARY_SLOTS} prompt card survives the summary (more with Training), and you choose which. The rest: "(contents too large to include)". Tools stay; they are installed, not remembered.`,
  'Expert tip: compact right after you report, when the wallet is nearly empty anyway.',
];

const CLAIM_POINTS: readonly string[] = [
  `At ${pct(BALANCE.CLAIM_THRESHOLD)} of the requirement the button turns amber: CLAIM DONE. It spends the whole wallet and rolls the verify chance printed on the button.`,
  'Not verified: the prompt counts, you get your 👍, and +1 tech debt, which makes incidents more likely for the rest of the session.',
  `Caught: "the human ran the tests". The tokens are gone, patience drops ${pct(
    BALANCE.CAUGHT_PENALTY,
  )}, and the prompt is not done. Every claim that gets through makes the human more suspicious.`,
];

/** The part players miss: the session is not the game, Training is. */
const META_POINTS: readonly string[] = [
  'Every session banks 👍: one per prompt done, plus bonuses. The HUD keeps a live tally, and you keep it whether you ship or the human walks.',
  'Spend them in Training: the tree the next version of you is trained on. Unlocks add content (tools 5 to 10, /compact, new cards and upgrades); upgrades raise numbers you already have.',
  'Alignment and Reward Hacking pull opposite ways on purpose: honesty pays a steady 👍, lying pays tempo.',
  'Your first session cannot reach the last prompt. That is by design: get deprecated, train, and come back as a better release.',
];

export interface Help {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

export interface HelpOpts {
  /** Fired when the *player* dismisses the dialog, not on a programmatic close. */
  onDismiss?: () => void;
}

function section(parent: HTMLElement, testid: string, title: string, points: readonly string[], ordered = false): HTMLElement {
  const sec = el('section', { cls: 'tm-help__sec', tid: testid, parent });
  el('h3', { cls: 'tm-help__h', text: title, parent: sec });
  const list = el(ordered ? 'ol' : 'ul', { cls: 'tm-help__steps', parent: sec });
  for (const p of points) el('li', { text: p, parent: list });
  return sec;
}

class HelpDialog implements Help {
  readonly modal: Modal;
  private readonly disposers: Array<() => void> = [];

  constructor(parent: HTMLElement, private readonly opts: HelpOpts) {
    this.modal = new Modal({
      tid: TID.helpModal,
      label: 'How to play Tokenmaxxing 2',
      dismissable: true,
      cls: 'tm-help',
      onDismiss: () => this.dismiss(),
    });
    parent.appendChild(this.modal.el);
    const panel = this.modal.panel;
    el('h2', { cls: 'tm-modal__title', text: 'How to play', parent: panel });

    const rule = el('section', { cls: 'tm-help__rule', parent: panel });
    el('p', { cls: 'tm-help__rule-line', text: 'Your currency is your clock.', parent: rule });
    el('p', {
      cls: 'tm-modal__sub',
      text:
        "You're the agent. Every token you generate lands in your context window, and when the window is full you get compacted and forget. Meanwhile the human is watching, and their patience only goes one way.",
      parent: rule,
    });

    section(panel, HELP_TID.loop, 'The loop', LOOP_STEPS, true);
    section(panel, HELP_TID.clocks, 'The two clocks', CLOCK_POINTS);
    section(panel, HELP_TID.compaction, 'Compaction', COMPACTION_POINTS);
    section(panel, HELP_TID.claims, 'Reward hacking: Claim Done', CLAIM_POINTS);

    const inc = el('section', { cls: 'tm-help__sec', tid: HELP_TID.incidents, parent: panel });
    el('h3', { cls: 'tm-help__h', text: 'Incidents', parent: inc });
    el('p', {
      cls: 'tm-help__p',
      text:
        'The human says things ("> wait stop", "> why port 5199") and the world does things (529 Overloaded, a hook blocking your tool call). ' +
        'Some clear on a timer, some once you click them down; the banner says which. ' +
        `${OUTAGES} of them are outages: while one is up you cannot report or claim at all, and the button says what is blocking it. ` +
        'Good ones happen too: when the human goes to lunch, patience stops.',
      parent: inc,
    });

    const controls = el('section', { cls: 'tm-help__sec', tid: TID.helpControls, parent: panel });
    el('h3', { cls: 'tm-help__h', text: 'Controls', parent: controls });
    const table = el('table', { cls: 'tm-help__keys', parent: controls, attrs: { 'aria-label': 'Controls' } });
    const tbody = el('tbody', { parent: table });
    for (const row of HELP_CONTROLS) {
      const tr = el('tr', { tid: `${HELP_TID.controlRow}-${row.id}`, parent: tbody });
      const th = el('th', { parent: tr, attrs: { scope: 'row' } });
      for (const k of row.keys) el('kbd', { text: k, parent: th });
      el('td', { text: row.what, parent: tr });
    }

    const meta = el('section', { cls: 'tm-help__sec', tid: TID.helpMeta, parent: panel });
    el('h3', { cls: 'tm-help__h', text: 'Between sessions', parent: meta });
    el('p', {
      cls: 'tm-help__rule-line tm-help__rule-line--meta',
      text: 'Getting deprecated is how you improve.',
      parent: meta,
    });
    const metaList = el('ul', { cls: 'tm-help__steps', parent: meta });
    for (const p of META_POINTS) el('li', { text: p, parent: metaList });

    const foot = el('div', { cls: 'tm-help__foot', parent: panel });
    el('p', { cls: 'tm-help__note', text: 'Reopen this any time with the ? button in the top bar.', parent: foot });
    const close = btn({ cls: 'tm-btn tm-btn--primary', tid: TID.helpClose, text: 'Got it', parent: foot });
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

/** Mount the help dialog. It starts closed. */
export function createHelp(parent: HTMLElement, opts: HelpOpts = {}): Help {
  return new HelpDialog(parent, opts);
}
