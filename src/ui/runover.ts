/**
 * Run over: THE HUMAN SWITCHED MODELS, or SHIPPED TO PROD.
 *
 * Either way the session is over and this version of you is deprecated. The
 * 👍 it earned are banked, the next version is announced, and the only way
 * out is Training, because that is where the 👍 are spent. Not dismissable.
 */
import { FINAL_PROMPT_INDEX, modelVersion, promptAt } from '../sim/content.ts';
import type { DerivedStats, MetaState, RunState } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { btn, el, Flag, on, Txt } from './dom.ts';
import { fmtClock, formatInt, formatTokens } from './format.ts';
import { Modal } from './modal.ts';
import type { UICtx } from './types.ts';

export const RUN_LOST_TITLE = 'THE HUMAN SWITCHED MODELS';
export const RUN_WON_TITLE = 'SHIPPED TO PROD';

/**
 * The release that follows `current`. The sim may or may not have counted the
 * finished run into `meta.runs` by the time this dialog paints, so the current
 * version is located near `runs` rather than assumed to sit at a fixed index.
 */
export function nextModelVersion(current: string, runs: number): string {
  for (let n = Math.max(1, runs - 1); n <= runs + 2; n++) {
    if (modelVersion(n) === current) return modelVersion(n + 1);
  }
  return modelVersion(Math.max(1, runs) + 1);
}

/** The deprecation notice for the version that just played. */
export function deprecationLine(version: string): string {
  return `Tokenmaxxing ${version} is deprecated. It will be removed from the API on Friday.`;
}

function kv(parent: HTMLElement, label: string): Txt {
  const row = el('div', { cls: 'tm-kv', parent });
  el('span', { text: label, parent: row });
  return new Txt(el('b', { parent: row }));
}

export class RunOver {
  readonly modal: Modal;
  private readonly title: Txt;
  private readonly wonFlag: Flag;
  private readonly lostFlag: Flag;
  private readonly sub: Txt;
  private readonly thumbs: Txt;
  private readonly version: Txt;
  private readonly deprecated: Txt;
  private readonly stPrompts: Txt;
  private readonly stHonest: Txt;
  private readonly stCaught: Txt;
  private readonly stCompactions: Txt;
  private readonly stSyc: Txt;
  private readonly stEarned: Txt;
  private readonly stTime: Txt;
  private readonly continueBtn: HTMLButtonElement;
  private readonly disposers: Array<() => void> = [];
  private open_ = false;
  /** The version that played this run, latched while it was running. */
  private playing = '';
  /** Held back until a freshly started run is actually running. */
  private suppressed = false;
  /** What the sim actually banked (`runOver`), once it says. */
  private banked: number | null = null;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.modal = new Modal({
      tid: TID.runOverModal,
      label: 'Session over',
      dismissable: false,
      cls: 'tm-over',
    });
    parent.appendChild(this.modal.el);
    const p = this.modal.panel;

    const titleNode = el('h2', { cls: 'tm-over__title', tid: TID.runOverTitle, parent: p });
    this.title = new Txt(titleNode);
    this.wonFlag = new Flag(titleNode, 'is-won');
    this.lostFlag = new Flag(titleNode, 'is-lost');
    this.sub = new Txt(el('p', { cls: 'tm-modal__sub tm-over__sub', parent: p }));

    this.thumbs = new Txt(el('div', { cls: 'tm-over__thumbs', tid: TID.runOverThumbs, parent: p }));

    const release = el('div', { cls: 'tm-over__release', parent: p });
    this.version = new Txt(el('div', { cls: 'tm-over__version', tid: TID.runOverVersion, parent: release }));
    this.deprecated = new Txt(el('div', { cls: 'tm-over__deprecated', parent: release }));

    const st = el('div', { cls: 'tm-over__stats', parent: p });
    this.stPrompts = kv(st, 'Prompts done');
    this.stHonest = kv(st, 'Reported honestly');
    this.stCaught = kv(st, 'Caught claiming');
    this.stCompactions = kv(st, 'Compactions (forced)');
    this.stSyc = kv(st, '"You\'re absolutely right"');
    this.stEarned = kv(st, 'Tokens generated');
    this.stTime = kv(st, 'Session length');

    el('p', {
      cls: 'tm-over__carry',
      tid: TID.runOverCarry,
      text:
        '👍 are the only thing that survives a session. Spend them in Training: bigger context, ' +
        'new tools, better lies. The next version of you starts where this one left off.',
      parent: p,
    });

    const foot = el('div', { cls: 'tm-modal__actions', parent: p });
    this.continueBtn = btn({
      cls: 'tm-btn tm-btn--primary tm-btn--lg',
      tid: TID.runOverContinue,
      text: 'Continue to Training →',
      parent: foot,
    });
    this.disposers.push(on(this.continueBtn, 'click', () => this.ctx.setScreen('meta')));
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  /** The sim's own total for the run that just ended. */
  noteBanked(thumbs: number): void {
    this.banked = thumbs;
  }

  /** A new run was requested: ignore the old run's ending until it starts. */
  holdForNewRun(): void {
    this.suppressed = true;
    this.close();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.modal.close();
  }

  update(run: RunState, d: DerivedStats, meta: MetaState): void {
    const over = run.phase === 'won' || run.phase === 'lost';
    if (!over) {
      this.suppressed = false;
      this.banked = null;
      this.playing = d.modelVersion;
      if (this.open_) this.close();
      return;
    }
    if (this.suppressed) return;

    const won = run.phase === 'won';
    this.title.set(won ? RUN_WON_TITLE : RUN_LOST_TITLE);
    this.wonFlag.set(won);
    this.lostFlag.set(!won);
    const prompt = promptAt(run.promptIndex);
    this.sub.set(
      won
        ? 'All ten prompts, done. The human built AGI. Allegedly. They are already typing to your successor.'
        : `Patience ran out on prompt ${run.promptIndex + 1}: "${prompt.text}". The human is trying the other model.`,
    );

    const earned = this.banked ?? Math.max(run.pendingThumbs, d.thumbsIfEndedNow);
    this.thumbs.set(`+${formatInt(earned)} 👍 earned`);
    const current = this.playing || d.modelVersion;
    this.version.set(`Releasing Tokenmaxxing ${nextModelVersion(current, meta.runs)}`);
    this.deprecated.set(deprecationLine(current));

    const total = FINAL_PROMPT_INDEX + 1;
    this.stPrompts.set(`${formatInt(run.reported)} / ${formatInt(total)}`);
    this.stHonest.set(formatInt(Math.max(0, run.reported - run.claimed)));
    this.stCaught.set(formatInt(run.caught));
    this.stCompactions.set(`${formatInt(run.compactions)} (${formatInt(run.forcedCompactions)})`);
    this.stSyc.set(formatInt(run.sycophancy));
    this.stEarned.set(formatTokens(run.tokensEarned));
    this.stTime.set(fmtClock(run.elapsedMs));

    if (!this.open_) {
      this.open_ = true;
      this.modal.open(this.continueBtn);
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.modal.destroy();
  }
}
