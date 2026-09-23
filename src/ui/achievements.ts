/**
 * Achievements screen.
 *
 * A locked *visible* achievement shows its name and what to do. A locked
 * *hidden* one shows `???` and nothing else — the whole point is discovering it
 * exists. Earned entries reveal the real name either way, plus the run number
 * they were earned on, since the sim has no clock to date them with. The run
 * number doubles as a release: "2.5 (new)" earned it.
 */
import { ACHIEVEMENTS, modelVersion } from '../sim/content.ts';
import type { AchievementDef, MetaState } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, el, Flag, Hide, on, Txt } from './dom.ts';
import { iconEl } from './icon.ts';
import type { UICtx } from './types.ts';

interface Row {
  readonly def: AchievementDef;
  readonly name: Txt;
  readonly blurb: Txt;
  readonly stamp: Txt;
  readonly earned: Flag;
  readonly secret: Flag;
}

export class AchievementsScreen {
  readonly el: HTMLElement;
  readonly primary: HTMLButtonElement;
  private readonly hide: Hide;
  private readonly count: Txt;
  private readonly rows = new Map<string, Row>();
  private readonly disposers: Array<() => void> = [];
  /**
   * Signature of the last rendered state, or null before the first render.
   *
   * Deliberately not `''`: an empty string is also the signature of "nothing
   * earned yet", so a fresh save matched on the very first call and the dirty
   * check returned before any row was populated — every entry rendered as a
   * bare icon with no name, no description, and no `is-secret` class, which
   * also exposed the hidden art.
   */
  private sig: string | null = null;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.el = el('div', {
      cls: 'tm-screen tm-achv',
      tid: TID.achievementsScreen,
      parent,
      attrs: { 'aria-label': 'Achievements' },
    });
    this.hide = new Hide(this.el);
    this.hide.set(true);

    const head = el('div', { cls: 'tm-achv__head', parent: this.el });
    el('h2', { cls: 'tm-modal__title', text: 'Achievements', parent: head });
    this.count = new Txt(
      el('span', { cls: 'tm-achv__count', tid: TID.achievementsCount, parent: head }),
    );
    el('span', { cls: 'tm-topbar__spacer', parent: head });
    this.primary = btn({
      cls: 'tm-btn',
      text: '← Back',
      parent: head,
      tid: TID.achievementsBack,
    });
    this.disposers.push(on(this.primary, 'click', () => this.ctx.setScreen('title')));

    const grid = el('ul', { cls: 'tm-achv__grid', parent: this.el });
    for (const def of ACHIEVEMENTS) this.rows.set(def.id, this.makeRow(grid, def));
  }

  setVisible(v: boolean): void {
    this.hide.set(!v);
  }

  update(meta: MetaState): void {
    const earnedIds = ACHIEVEMENTS.filter((a) => meta.achievements[a.id]);
    // One string covers the whole screen's state: skip the rest when unchanged.
    const next = earnedIds.map((a) => `${a.id}:${meta.achievements[a.id]}`).join(',');
    if (next === this.sig) return;
    this.sig = next;

    this.count.set(`${earnedIds.length} / ${ACHIEVEMENTS.length}`);
    for (const [id, row] of this.rows) {
      const run = meta.achievements[id] ?? 0;
      const got = run > 0;
      // A hidden achievement gives nothing away until it is earned.
      const secret = row.def.hidden && !got;
      row.earned.set(got);
      row.secret.set(secret);
      row.name.set(secret ? '???' : row.def.name);
      row.blurb.set(secret ? 'Hidden' : row.def.blurb);
      row.stamp.set(got ? `RUN ${run} · v${modelVersion(run)}` : '');
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.rows.clear();
    this.el.remove();
  }

  private makeRow(parent: HTMLElement, def: AchievementDef): Row {
    const li = el('li', {
      cls: 'tm-achv__row',
      tid: tid(TID.achievementRow, def.id),
      parent,
    });
    iconEl(def.icon, li).classList.add('tm-achv__icon');
    const body = el('span', { cls: 'tm-achv__body', parent: li });
    const name = new Txt(el('span', { cls: 'tm-achv__name', parent: body }));
    const blurb = new Txt(el('span', { cls: 'tm-achv__blurb', parent: body }));
    const stamp = new Txt(el('span', { cls: 'tm-achv__stamp', parent: li }));
    return {
      def,
      name,
      blurb,
      stamp,
      earned: new Flag(li, 'is-earned'),
      secret: new Flag(li, 'is-secret'),
    };
  }
}
