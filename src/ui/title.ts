/**
 * Title screen. Start a run, walk into the Demos shop, see the lifetime tally.
 */
import { PROJECT_NAMES, projectAt } from '../sim/content.ts';
import type { MetaState } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { btn, el, Hide, on, Txt } from './dom.ts';
import { KOFI_URL, REPO_URL } from './about.ts';
import { fmtInt } from './format.ts';
import type { UICtx } from './types.ts';

export class TitleScreen {
  readonly el: HTMLElement;
  private readonly hide: Hide;
  private readonly statsHide: Hide;
  private readonly runs: Txt;
  private readonly wins: Txt;
  private readonly best: Txt;
  private readonly demos: Txt;
  private readonly lifetime: Txt;
  readonly aboutBtn!: HTMLButtonElement;
  readonly achievementsBtn!: HTMLButtonElement;
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

    el('h1', { cls: 'tm-title__logo', text: 'Tokenmaxxing', parent: this.el });
    el('p', {
      cls: 'tm-title__pitch',
      text:
        'Click the laptop. Hire agents. Your wallet is the ship bar — every ' +
        'purchase drops it, and the deadline does not care.',
      parent: this.el,
    });
    // The meta loop belongs on the title screen: a player who does not know
    // the tree exists reads their first SIGKILL as losing rather than as
    // progress, and stops there.
    el('p', {
      cls: 'tm-title__pitch tm-title__pitch--meta',
      tid: 'title-meta-pitch',
      text:
        'Every run is a startup. Every startup dies. You keep the Demos it ' +
        'earned and spend them on a permanent upgrade tree, so the next ' +
        'venture starts further along than the last one did.',
      parent: this.el,
    });

    const actions = el('div', { cls: 'tm-title__actions', parent: this.el });
    const start = btn({
      cls: 'tm-btn tm-btn--primary tm-btn--lg',
      tid: TID.startRun,
      text: 'New venture',
      parent: actions,
    });
    const shop = btn({
      cls: 'tm-btn tm-btn--lg',
      tid: 'title-meta',
      text: 'Demos shop',
      parent: actions,
    });
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
    // player who files bugs — so it gets a first-class slot in the menu.
    const repo = el('a', { cls: 'tm-btn tm-btn--quiet', text: 'Source', parent: links });
    repo.setAttribute('href', REPO_URL);
    repo.setAttribute('target', '_blank');
    repo.setAttribute('rel', 'noopener noreferrer');
    repo.setAttribute('data-testid', TID.repoLink);

    const kofi = el('a', { cls: 'tm-btn tm-btn--kofi', text: 'Buy me a coffee', parent: links });
    kofi.setAttribute('href', KOFI_URL);
    kofi.setAttribute('target', '_blank');
    kofi.setAttribute('rel', 'noopener noreferrer');
    kofi.setAttribute('data-testid', TID.kofiLink);

    const statsRow = el('div', { cls: 'tm-stats', parent: this.el });
    this.statsHide = new Hide(statsRow);
    this.statsHide.set(true);
    this.runs = new Txt(el('span', { parent: statsRow }));
    this.wins = new Txt(el('span', { parent: statsRow }));
    this.best = new Txt(el('span', { parent: statsRow }));
    this.demos = new Txt(el('span', { parent: statsRow }));
    this.lifetime = new Txt(el('span', { parent: statsRow }));

    this.disposers.push(
      on(start, 'click', () => {
        this.ctx.sim.startRun();
        this.ctx.setScreen('run');
        this.ctx.emit({ t: 'startRun' });
      }),
      on(shop, 'click', () => this.ctx.setScreen('meta')),
    );
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.hide.set(!v);
    if (v) this.sig = '';
  }

  /** First focusable control, for focus hand-off on screen change. */
  get primary(): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-testid="${TID.startRun}"]`);
  }

  update(meta: MetaState): void {
    if (!this.visible) return;
    const sig = `${meta.runs}|${meta.wins}|${meta.bestProject}|${meta.demos}|${meta.totalDemosEarned}`;
    if (sig === this.sig) return;
    this.sig = sig;

    const hasSave = meta.runs > 0 || meta.totalDemosEarned > 0;
    this.statsHide.set(!hasSave);
    if (!hasSave) return;

    this.runs.set(`RUNS ${fmtInt(meta.runs)}`);
    this.wins.set(`WINS ${fmtInt(meta.wins)}`);
    const bi = Math.max(0, Math.min(meta.bestProject, PROJECT_NAMES.length - 1));
    this.best.set(
      meta.bestProject >= 0
        ? `BEST ${projectAt(bi).name}`
        : 'BEST —',
    );
    this.demos.set(`DEMOS ◈${fmtInt(meta.demos)}`);
    this.lifetime.set(`LIFETIME ◈${fmtInt(meta.totalDemosEarned)}`);
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.el.remove();
  }
}
