/**
 * Run HUD: wallet, ship bar, CI-pipeline deadline burndown, incident stack,
 * active cards and the ship button.
 *
 * Every read from state goes through a cached cell (see `dom.ts`) so a frame
 * where nothing moved writes nothing at all.
 */
import {
  BALANCE,
  CARD_BY_ID,
  INCIDENT_BY_ID,
  META_BY_ID,
  META_UPGRADES,
  projectAt,
  PROJECT_NAMES,
} from '../sim/content.ts';
import type { DerivedStats, MetaState, RunState } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { Attr, btn, Dis, el, Flag, Hide, KeyedRows, on, Sty, Txt } from './dom.ts';
import { barWidth, fmtEta, fmtInt, fmtNum, fmtShortTime, fmtTime } from './format.ts';
import { formatSlops, slopUnitName } from '../sim/format.ts';
import { RollUp } from './rollup.ts';
import type { UICtx } from './types.ts';

/** Deadline fractions at which the burndown changes colour. */
const WARN_AT = 0.5;
const CRIT_AT = 0.25;
const FLASH_SECONDS = 10;

interface IncidentRow {
  el: HTMLElement;
  timer: Txt;
  clicks: Txt;
  clicksHide: Hide;
}

interface CardChip {
  el: HTMLElement;
}

export class Hud {
  readonly el: HTMLElement;
  /** Canvas the renderer attaches to. */
  readonly canvas: HTMLCanvasElement;
  /** Transparent full-scene input surface (`TID.laptop`). */
  readonly hitArea: HTMLButtonElement;
  readonly stage: HTMLElement;

  private readonly slop: Txt;
  private readonly rate: Txt;
  private readonly click: Txt;
  private readonly projNum: Txt;
  private readonly projName: Txt;
  private readonly requirement: Txt;
  private readonly eta: Txt;
  private readonly demoTally: Txt;
  private readonly deadlineText: Txt;

  private readonly shipFillW: Sty;
  private readonly shipReady: Flag;
  private readonly shipAria: Attr;
  private readonly ghostLeft: Sty;
  private readonly ghostWidth: Sty;
  private readonly previewOn: Flag;

  private readonly dlFillW: Sty;
  private readonly dlWarn: Flag;
  private readonly dlCrit: Flag;
  private readonly dlFlash: Flag;
  private readonly dlAria: Attr;

  private readonly slopLabel!: Txt;
  private readonly risk!: Txt;
  private readonly riskFlag!: Flag;
  private readonly crit!: Txt;
  private readonly critHide!: Hide;
  private readonly shipTxt!: Txt;
  private readonly shipBlocked!: Flag;
  private readonly shipLabel!: Attr;
  private readonly shipBtn: HTMLButtonElement;
  private readonly shipDis: Dis;

  private readonly incidentsHost: HTMLElement;
  private readonly incidentsHide: Hide;
  private readonly incidentRows: KeyedRows<IncidentRow>;
  private readonly incidentIds: string[] = [];

  private readonly cardsHost: HTMLElement;
  private readonly cardRows: KeyedRows<CardChip>;

  private readonly roll = new RollUp(250);
  private readonly disposers: Array<() => void> = [];
  private previewCost: number | null = null;
  private readonly chipKeys: string[] = [];

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.el = el('div', { cls: 'tm-col', parent });

    // ---- HUD band ----------------------------------------------------
    const hud = el('section', { cls: 'tm-hud', parent: this.el, attrs: { 'aria-label': 'Run status' } });

    const wallet = el('div', { cls: 'tm-hud__wallet', parent: hud });
    this.slopLabel = new Txt(
      el('div', { cls: 'tm-hud__slop-label', text: 'SLOP', parent: wallet }),
    );
    this.slop = new Txt(
      el('div', { cls: 'tm-hud__slop', tid: TID.slop, text: '0', parent: wallet }),
    );
    const sub = el('div', { cls: 'tm-hud__sub', parent: wallet });
    this.rate = new Txt(el('span', { cls: 'tm-hud__rate', tid: TID.slopRate, text: '0/s', parent: sub }));
    this.click = new Txt(
      el('span', { cls: 'tm-hud__click', tid: TID.clickPower, text: '+1/click', parent: sub }),
    );
    const riskEl = el('span', {
      cls: 'tm-hud__risk',
      tid: TID.incidentRisk,
      parent: sub,
      attrs: { title: 'Incident rate. Higher means outages and debuffs land more often.' },
    });
    this.risk = new Txt(riskEl);
    this.riskFlag = new Flag(riskEl, 'is-hot');

    // Crit is a dial the player spends on, so it has to be visible. Hidden
    // entirely at the base rate — a permanent "CRIT 4%" is just noise.
    const critEl = el('span', {
      cls: 'tm-hud__crit',
      tid: TID.critChance,
      parent: sub,
      attrs: { title: 'Chance a click crits, and the chance an agent one-shots it.' },
    });
    this.crit = new Txt(critEl);
    this.critHide = new Hide(critEl);

    const bars = el('div', { cls: 'tm-hud__bars', parent: hud });

    const line = el('div', { cls: 'tm-hud__line', parent: bars });
    this.projNum = new Txt(
      el('span', { cls: 'tm-hud__projnum', tid: TID.projectNum, text: 'PROJECT 1', parent: line }),
    );
    this.projName = new Txt(
      el('span', { cls: 'tm-hud__projname', tid: TID.projectName, text: '—', parent: line }),
    );
    el('span', { cls: 'tm-hud__line-spacer', parent: line });
    this.requirement = new Txt(
      el('span', { cls: 'tm-hud__req', tid: TID.requirement, text: '0 / 0', parent: line }),
    );
    this.eta = new Txt(el('span', { cls: 'tm-hud__eta', text: '', parent: line }));

    // ship bar — the wallet *is* the bar
    const shipBar = el('div', {
      cls: 'tm-bar tm-bar--ship',
      tid: TID.shipBar,
      parent: bars,
      attrs: {
        role: 'progressbar',
        'aria-label': 'Ship progress',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
      },
    });
    const shipFill = el('div', { cls: 'tm-bar__fill', tid: TID.shipBarFill, parent: shipBar });
    const ghost = el('div', { cls: 'tm-bar__ghost', parent: shipBar });
    this.shipFillW = new Sty(shipFill, 'width');
    this.shipReady = new Flag(shipBar, 'is-ready');
    this.shipAria = new Attr(shipBar, 'aria-valuenow');
    this.ghostLeft = new Sty(ghost, 'left');
    this.ghostWidth = new Sty(ghost, 'width');
    this.previewOn = new Flag(shipBar, 'is-preview');

    // deadline burndown — CI pipeline strip
    const dlBar = el('div', {
      cls: 'tm-bar tm-bar--deadline',
      tid: TID.deadlineBar,
      parent: bars,
      attrs: {
        role: 'progressbar',
        'aria-label': 'Deadline remaining',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '100',
      },
    });
    const dlFill = el('div', { cls: 'tm-bar__fill', tid: TID.deadlineFill, parent: dlBar });
    el('div', { cls: 'tm-bar__segs', parent: dlBar });
    this.deadlineText = new Txt(
      el('span', { cls: 'tm-bar__time', tid: TID.deadlineText, text: '00:00.0', parent: dlBar }),
    );
    this.dlFillW = new Sty(dlFill, 'width');
    this.dlWarn = new Flag(dlBar, 'is-warn');
    this.dlCrit = new Flag(dlBar, 'is-crit');
    this.dlFlash = new Flag(dlBar, 'is-flash');
    this.dlAria = new Attr(dlBar, 'aria-valuenow');

    const right = el('div', { cls: 'tm-hud__right', parent: hud });
    this.shipBtn = btn({
      cls: 'tm-ship',
      tid: TID.shipButton,
      text: 'SHIP IT',
      parent: right,
      attrs: { 'aria-keyshortcuts': 'S' },
    });
    this.shipTxt = new Txt(this.shipBtn);
    this.shipDis = new Dis(this.shipBtn);
    this.shipDis.set(true);
    this.shipBlocked = new Flag(this.shipBtn, 'is-blocked');
    this.shipLabel = new Attr(this.shipBtn, 'aria-label');
    const demos = el('div', { cls: 'tm-hud__demos', tid: TID.demoTally, parent: right });
    // The value lives in its own node: writing textContent on the container
    // would wipe the label.
    this.demoTally = new Txt(el('span', { text: '◈ 0', parent: demos }));
    el('small', { text: 'demos · banked at run end', parent: demos });

    this.disposers.push(
      on(this.shipBtn, 'click', () => {
        if (this.shipBtn.disabled) return;
        const ok = this.ctx.sim.ship();
        this.ctx.emit({ t: 'ship', ok });
        if (!ok) this.ctx.toast('Not enough slop to ship', 'bad');
      }),
    );

    // ---- stage ---------------------------------------------------------
    this.stage = el('div', { cls: 'tm-stage', parent: this.el });
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tm-scene';
    this.canvas.width = 320;
    this.canvas.height = 180;
    this.canvas.setAttribute('data-testid', TID.scene);
    this.canvas.setAttribute('aria-hidden', 'true');
    this.stage.appendChild(this.canvas);

    this.hitArea = btn({
      cls: 'tm-laptop-hit',
      tid: TID.laptop,
      parent: this.stage,
      label: 'Write code — click to produce slop',
      attrs: { 'aria-keyshortcuts': 'Space Enter' },
    });
    this.disposers.push(
      on(this.hitArea, 'pointerdown', (ev) => {
        const p = ev as PointerEvent;
        p.preventDefault();
        this.hitArea.focus();
        this.ctx.emit({ t: 'canvasPointer', clientX: p.clientX, clientY: p.clientY });
      }),
      on(this.hitArea, 'keydown', (ev) => {
        const k = ev as KeyboardEvent;
        if (k.key !== ' ' && k.key !== 'Enter' && k.key !== 'Spacebar') return;
        if (k.ctrlKey || k.metaKey || k.altKey || k.repeat) return;
        k.preventDefault(); // suppress the synthetic click that would double-fire
        this.ctx.emit({ t: 'canvasKey' });
      }),
    );

    this.incidentsHost = el('div', {
      cls: 'tm-incidents',
      tid: TID.incidentBanner,
      parent: this.stage,
      attrs: { 'aria-live': 'polite', 'aria-label': 'Active incidents' },
    });
    this.incidentsHide = new Hide(this.incidentsHost);
    this.incidentsHide.set(true);
    this.incidentRows = new KeyedRows<IncidentRow>(
      this.incidentsHost,
      (id) => this.makeIncident(id),
      (r) => r.el,
    );

    // ---- active cards ----------------------------------------------------
    this.cardsHost = el('ul', {
      cls: 'tm-cards',
      tid: TID.activeCards,
      parent: this.el,
      attrs: { 'aria-label': 'Permanent upgrades and cards in play' },
    });
    this.cardRows = new KeyedRows<CardChip>(
      this.cardsHost,
      (id) => this.makeChip(id),
      (r) => r.el,
    );
  }

  /** Called by the shop on hover/focus of an affordable purchase row. */
  setPreviewCost(cost: number | null): void {
    this.previewCost = cost;
  }

  /** New run: stop the wallet counting up from the previous run's balance. */
  reset(): void {
    this.roll.reset();
    this.previewCost = null;
  }

  update(run: RunState, d: DerivedStats, meta: MetaState): void {
    const now = this.ctx.now();

    // wallet
    const shown = this.roll.step(run.slop, now);
    this.slop.set(fmtNum(shown));
    this.slopLabel.set(slopUnitName(shown).toUpperCase());
    // Rate is slop *per second* — that trailing S is the whole FLOPS joke, so
    // there is deliberately no "/s" after it.
    this.rate.set(formatSlops(d.idleRate));
    this.click.set(`+${fmtNum(d.clickPower)}/click`);
    // Incident rate is the risk dial the player is actively trading against,
    // so it belongs on screen rather than buried in upgrade blurbs.
    const risk = d.incidentRateMult;
    this.risk.set(`RISK ×${risk.toFixed(2)}`);
    this.riskFlag.set(risk > 1.05);

    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const critUp = d.critChance > BALANCE.CRIT_CHANCE + 1e-9;
    this.critHide.set(!critUp && d.oneShotChance <= 0);
    this.crit.set(
      d.oneShotChance > 0
        ? `CRIT ${pct(d.critChance)} · 1-SHOT ${pct(d.oneShotChance)}`
        : `CRIT ${pct(d.critChance)}`,
    );

    // project
    const idx = run.projectIndex;
    this.projNum.set(
      idx < PROJECT_NAMES.length ? `PROJECT ${idx + 1}/${PROJECT_NAMES.length}` : `PROJECT ${idx + 1}`,
    );
    this.projName.set(projectAt(idx).name);
    this.requirement.set(`${fmtNum(run.slop)} / ${fmtNum(d.requirement)}`);
    this.eta.set(
      d.shipBlockedBy !== null
        ? 'BLOCKED'
        : d.canShip
          ? 'READY'
          : `ETA ${fmtEta(d.etaSeconds)}`,
    );

    // ship bar
    const p = d.shipProgress;
    this.shipFillW.set(barWidth(p));
    this.shipReady.set(d.canShip);
    this.shipAria.set(String(Math.round(p * 100)));

    // ghost segment: what this purchase would eat off the bar
    const cost = this.previewCost;
    if (cost !== null && cost > 0 && d.requirement > 0) {
      const after = Math.max(0, (run.slop - cost) / d.requirement);
      this.ghostLeft.set(barWidth(after));
      this.ghostWidth.set(barWidth(Math.max(0, p - after)));
      this.previewOn.set(true);
    } else {
      this.previewOn.set(false);
    }

    // deadline
    const dp = d.deadlineProgress;
    this.dlFillW.set(barWidth(dp));
    this.dlAria.set(String(Math.round(dp * 100)));
    this.dlWarn.set(dp <= WARN_AT && dp > CRIT_AT);
    this.dlCrit.set(dp <= CRIT_AT);
    this.dlFlash.set(run.timeLeftMs <= FLASH_SECONDS * 1000 && run.phase === 'running');
    this.deadlineText.set(fmtTime(run.timeLeftMs));

    // demos
    this.demoTally.set(`◈ ${fmtInt(d.demosIfEndedNow)}`);

    // ship button
    this.shipDis.set(!(d.canShip && run.phase === 'running'));
    // Say *why* the deploy is refused — an outage looks like a bug otherwise.
    this.shipTxt.set(d.shipBlockedBy !== null ? 'CANNOT SHIP' : 'SHIP IT');
    this.shipBlocked.set(d.shipBlockedBy !== null);
    this.shipLabel.set(
      d.shipBlockedBy !== null ? `Cannot ship: ${d.shipBlockedBy}` : 'Ship the current project',
    );

    this.syncIncidents(run);
    this.syncCards(run, meta);
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.incidentRows.clear();
    this.cardRows.clear();
    this.el.remove();
  }

  // -------------------------------------------------------------------------

  private syncIncidents(run: RunState): void {
    const list = run.incidents;
    this.incidentIds.length = 0;
    for (const inc of list) {
      // Defensive: a duplicate id would make the keyed reconciler thrash.
      if (!this.incidentIds.includes(inc.id)) this.incidentIds.push(inc.id);
    }
    this.incidentRows.sync(this.incidentIds);
    this.incidentsHide.set(list.length === 0);

    for (const inc of list) {
      const row = this.incidentRows.rows.get(inc.id);
      if (row === undefined) continue;
      row.timer.set(fmtShortTime(inc.remainingMs));
      const clicks = inc.clicksRemaining;
      const needsClicks = Number.isFinite(clicks) && clicks > 0;
      row.clicksHide.set(!needsClicks);
      // Cleared rather than just hidden: `hidden` text still shows up in
      // textContent, and a stale "click x4 to fix" would read as a live cue.
      row.clicks.set(needsClicks ? `click ×${fmtInt(clicks)} to fix` : '');
    }
  }

  private makeIncident(id: string): IncidentRow {
    const def = INCIDENT_BY_ID[id];
    const good = def?.tone === 'good';
    const node = el('div', {
      cls: `tm-incident${good ? ' tm-incident--good' : ''}`,
    });
    el('span', {
      cls: 'tm-incident__name',
      tid: TID.incidentName,
      text: def?.name ?? id,
      parent: node,
    });
    el('span', { cls: 'tm-incident__flavor', text: def?.flavor ?? '', parent: node });
    const clicksNode = el('span', { cls: 'tm-incident__clicks', parent: node });
    const clicksHide = new Hide(clicksNode);
    clicksHide.set(true);
    const timer = new Txt(
      el('span', { cls: 'tm-incident__timer', tid: TID.incidentTimer, parent: node }),
    );
    return { el: node, timer, clicks: new Txt(clicksNode), clicksHide };
  }

  /**
   * Permanent tree buffs first, then this run's cards.
   *
   * The levelled meta upgrades are live modifiers exactly like a card, and they
   * were invisible during a run — you could feel Cracked working and have
   * nothing on screen saying so. Only `kind: 'upgrade'` nodes appear: `unlock`
   * nodes add *content* rather than a modifier, and fifteen "unlocked X" chips
   * would bury the cards.
   *
   * Keyed by level as well as id, so raising a level rebuilds the chip instead
   * of leaving a stale description behind.
   */
  private syncCards(run: RunState, meta: MetaState): void {
    this.chipKeys.length = 0;
    for (const def of META_UPGRADES) {
      if (def.kind !== 'upgrade') continue;
      const level = meta.levels[def.id] ?? 0;
      if (level > 0) this.chipKeys.push(`meta:${def.id}:${level}`);
    }
    for (const id of run.cards) this.chipKeys.push(id);
    this.cardRows.sync(this.chipKeys);
  }

  private makeChip(key: string): CardChip {
    if (key.startsWith('meta:')) return this.makeMetaChip(key);
    const id = key;
    const def = CARD_BY_ID[id];
    const li = el('li', { attrs: { role: 'listitem' } });
    const chip = btn({
      cls: `tm-chip tm-chip--${def?.rarity ?? 'common'}`,
      text: def?.name ?? id,
      tid: tid('active-card', id),
      parent: li,
      label: `${def?.name ?? id}: ${def?.blurb ?? ''}`,
    });
    el('span', { cls: 'tm-chip__tip', text: def?.blurb ?? '', parent: chip });
    return { el: li };
  }

  private makeMetaChip(key: string): CardChip {
    const [, id, lvl] = key.split(':');
    const def = META_BY_ID[id ?? ''];
    const level = Number(lvl ?? 0);
    const li = el('li', { attrs: { role: 'listitem' } });
    const what = def ? def.describe(level) : '';
    const chip = btn({
      cls: 'tm-chip tm-chip--meta',
      text: def?.name ?? (id ?? ''),
      tid: tid('active-meta', id ?? ''),
      parent: li,
      label: `${def?.name ?? id}, permanent: ${what}`,
    });
    el('span', { cls: 'tm-chip__tip', text: what, parent: chip });
    return { el: li };
  }
}
