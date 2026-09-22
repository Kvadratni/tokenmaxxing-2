/**
 * Run-over modal. SIGKILL on a missed deadline, DEMO DAY on a win.
 * Not Escape-dismissable — banking the Demos and moving to the shop is the
 * only exit — so the only control is Continue.
 */
import { PROJECT_NAMES, projectAt } from '../sim/content.ts';
import type { DerivedStats, RunState } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { btn, el, Flag, on, Txt } from './dom.ts';
import { fmtInt, fmtNum, fmtTime } from './format.ts';
import { Modal } from './modal.ts';
import type { UICtx } from './types.ts';

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
  private readonly demos: Txt;
  private readonly sub: Txt;
  private readonly bkProjects: Txt;
  private readonly bkBonus: Txt;
  private readonly stShipped: Txt;
  private readonly stClicks: Txt;
  private readonly stEarned: Txt;
  private readonly stSpent: Txt;
  private readonly stTime: Txt;
  private readonly disposers: Array<() => void> = [];
  private open_ = false;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.modal = new Modal({
      tid: TID.runOverModal,
      label: 'Run over',
      dismissable: false,
      cls: 'tm-over',
    });
    parent.appendChild(this.modal.el);

    const titleNode = el('h2', {
      cls: 'tm-over__title',
      tid: TID.runOverTitle,
      parent: this.modal.panel,
    });
    this.title = new Txt(titleNode);
    this.wonFlag = new Flag(titleNode, 'is-won');
    this.lostFlag = new Flag(titleNode, 'is-lost');

    this.sub = new Txt(el('p', { cls: 'tm-modal__sub', parent: this.modal.panel }));
    this.demos = new Txt(
      el('div', { cls: 'tm-over__demos', tid: TID.runOverDemos, parent: this.modal.panel }),
    );

    // The single most-missed thing in the game: players bank Demos without
    // realising there is a permanent upgrade tree waiting for them. Say it
    // here, at the exact moment they earn the currency.
    el('p', {
      cls: 'tm-over__carry',
      tid: TID.runOverCarry,
      text:
        'Demos are the only thing that outlives a venture. Spend them on the tree — '
        + 'unlocks add new agents, upgrades and cards to every startup you found after this one.',
      parent: this.modal.panel,
    });

    const bd = el('div', { cls: 'tm-over__breakdown', parent: this.modal.panel });
    this.bkProjects = kv(bd, 'Projects shipped');
    this.bkBonus = kv(bd, 'Speed & finish bonus');

    const st = el('div', { cls: 'tm-over__stats', parent: this.modal.panel });
    this.stShipped = kv(st, 'Reached');
    this.stClicks = kv(st, 'Clicks');
    this.stEarned = kv(st, 'Slop earned');
    this.stSpent = kv(st, 'Slop spent');
    this.stTime = kv(st, 'Run time');

    const foot = el('div', { cls: 'tm-title__actions', parent: this.modal.panel });
    const cont = btn({
      cls: 'tm-btn tm-btn--primary tm-btn--lg',
      tid: TID.runOverContinue,
      text: 'Spend demos →',
      parent: foot,
    });
    this.disposers.push(on(cont, 'click', () => this.ctx.setScreen('meta')));
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.modal.close();
  }

  update(run: RunState, d: DerivedStats): void {
    const over = run.phase === 'won' || run.phase === 'lost';
    if (!over) {
      if (this.open_) {
        this.open_ = false;
        this.modal.close();
      }
      return;
    }

    const won = run.phase === 'won';
    this.title.set(won ? 'DEMO DAY' : 'SIGKILL');
    this.wonFlag.set(won);
    this.lostFlag.set(!won);
    this.sub.set(
      won
        ? 'You shipped everything. The venture exits and the slop is someone else’s problem now.'
        : `The deadline hit zero on ${projectAt(run.projectIndex).name}. The venture is dead.`,
    );

    const total = Math.max(run.pendingDemos, d.demosIfEndedNow);
    const base = Math.min(run.shipped, total);
    this.demos.set(`◈ ${fmtInt(total)} demos banked`);
    this.bkProjects.set(`${fmtInt(run.shipped)} × ◈1 = ◈${fmtInt(base)}`);
    this.bkBonus.set(`◈${fmtInt(Math.max(0, total - base))}`);

    const reached = Math.min(run.projectIndex + 1, PROJECT_NAMES.length);
    this.stShipped.set(`${projectAt(run.projectIndex).name} (${reached}/${PROJECT_NAMES.length})`);
    this.stClicks.set(fmtInt(run.clicks));
    this.stEarned.set(fmtNum(run.slopEarned));
    this.stSpent.set(fmtNum(run.slopSpent));
    this.stTime.set(fmtTime(run.elapsedMs));

    if (!this.open_) {
      this.open_ = true;
      this.modal.open();
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.modal.destroy();
  }
}
