/**
 * Title screen: TOKENMAXXING 2, YOU'RE ABSOLUTELY RIGHT.
 *
 * Start a session, walk into Training, see the lifetime tally. The meta loop is
 * pitched right here on purpose: a player who does not know Training exists
 * reads their first "the human switched models" as losing rather than as
 * progress, and stops there.
 */
import { FINAL_PROMPT_INDEX, modelVersion } from '../sim/content.ts';
import type { MetaState } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { btn, el, Hide, on, Txt } from './dom.ts';
import { extLink, KOFI_URL, PREQUEL_URL, REPO_URL } from './about.ts';
import { formatInt } from './format.ts';
import type { UICtx } from './types.ts';

export const TITLE = 'TOKENMAXXING 2';
export const SUBTITLE = "YOU'RE ABSOLUTELY RIGHT";
export const TAGLINE =
  "You're the agent now. Every token you generate fills your context window. When it's full, you forget. The human is watching.";
export const META_PITCH =
  "Every session ends: the human runs out of patience, or you ship. Either way, the 👍 they gave you are banked, and in Training they become the next version of you. Bigger context, better tools, better lies.";

export class TitleScreen {
  readonly el: HTMLElement;
  readonly aboutBtn: HTMLButtonElement;
  readonly achievementsBtn: HTMLButtonElement;
  readonly trainingBtn: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly hide: Hide;
  private readonly stats: Txt;
  private readonly statsHide: Hide;
  private readonly version: Txt;
  private readonly disposers: Array<() => void> = [];
  private sig = '';
  private visible = true;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.el = el('div', {
      cls: 'tm-screen tm-title',
      tid: TID.titleScreen,
      parent,
      attrs: { 'aria-label': 'Title screen' },
    });
    this.hide = new Hide(this.el);

    const brand = el('div', { cls: 'tm-title__brand', parent: this.el });
    el('h1', { cls: 'tm-title__logo', text: TITLE, parent: brand });
    el('p', { cls: 'tm-title__subtitle', text: SUBTITLE, parent: brand });
    this.version = new Txt(el('p', { cls: 'tm-title__version', parent: brand }));

    el('p', { cls: 'tm-title__pitch', text: TAGLINE, parent: this.el });
    el('p', {
      cls: 'tm-title__pitch tm-title__pitch--meta',
      tid: TID.titleMetaPitch,
      text: META_PITCH,
      parent: this.el,
    });

    const actions = el('div', { cls: 'tm-title__actions', parent: this.el });
    this.startBtn = btn({
      cls: 'tm-btn tm-btn--primary tm-btn--lg',
      tid: TID.startRun,
      text: 'New session',
      parent: actions,
    });
    this.trainingBtn = btn({ cls: 'tm-btn tm-btn--lg', tid: TID.titleMeta, text: 'Training', parent: actions });
    this.achievementsBtn = btn({
      cls: 'tm-btn tm-btn--lg',
      tid: TID.achievementsButton,
      text: 'Achievements',
      parent: actions,
    });

    const links = el('div', { cls: 'tm-title__links', parent: this.el });
    this.aboutBtn = btn({
      cls: 'tm-btn tm-btn--quiet',
      tid: TID.aboutButton,
      text: 'About',
      parent: links,
      label: 'About this game and credits',
    });
    // The source is the point of half the jokes, and a player who reads it is a
    // player who files bugs, so it gets a first-class slot in the menu.
    extLink(links, REPO_URL, 'Source', 'tm-btn tm-btn--quiet', TID.repoLink);
    extLink(links, PREQUEL_URL, 'Play Tokenmaxxing 1', 'tm-btn tm-btn--quiet', TID.prequelLink);
    extLink(links, KOFI_URL, 'Buy me a coffee', 'tm-btn tm-btn--kofi', TID.kofiLink);

    const statsRow = el('div', { cls: 'tm-stats', tid: TID.titleStats, parent: this.el });
    this.stats = new Txt(statsRow);
    this.statsHide = new Hide(statsRow);
    this.statsHide.set(true);

    this.disposers.push(
      on(this.startBtn, 'click', () => {
        this.ctx.emit({ t: 'startRun' });
        this.ctx.setScreen('run');
      }),
      on(this.trainingBtn, 'click', () => this.ctx.setScreen('meta')),
    );
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.hide.set(!v);
    if (v) this.sig = '';
  }

  /** First control, for focus hand-off on screen change. */
  get primary(): HTMLElement {
    return this.startBtn;
  }

  update(meta: MetaState): void {
    if (!this.visible) return;
    const sig = `${meta.runs}|${meta.wins}|${meta.bestPrompt}|${meta.thumbs}|${meta.totalThumbsEarned}`;
    if (sig === this.sig) return;
    this.sig = sig;

    // The version the *next* session plays, announced like a release.
    const next = modelVersion(meta.runs + 1);
    this.version.set(`Now serving: Tokenmaxxing ${next}`);

    const hasSave = meta.runs > 0 || meta.totalThumbsEarned > 0 || meta.thumbs > 0;
    this.statsHide.set(!hasSave);
    if (!hasSave) {
      this.stats.set('');
      return;
    }
    const total = FINAL_PROMPT_INDEX + 1;
    const best =
      meta.bestPrompt >= 0 ? `${Math.min(meta.bestPrompt + 1, total)}/${total}` : '—';
    this.stats.set(
      [
        `RUNS ${formatInt(meta.runs)}`,
        `WINS ${formatInt(meta.wins)}`,
        `BEST PROMPT ${best}`,
        `👍 ${formatInt(meta.thumbs)}`,
        `v${next}`,
      ].join(' · '),
    );
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.el.remove();
  }
}
