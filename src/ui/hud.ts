/**
 * The HUD band across the top of the run screen, laid out like the concept:
 *
 *   TOKENS        PROMPT 3/10 "make the tests pass"           2.5 (new)   [ REPORT DONE  S ]
 *   184.2K        [CONTEXT WINDOW ███████████░░ 184K / 200K] [/compact C] [████░ 12.4K / 22.5K]
 *   2.1K TOK/S…   HUMAN PATIENCE 0:42 [▮▮▮▮▮▯▯] [YOU'RE ABSOLUTELY RIGHT +6% Y]  👍 3 · TECH DEBT 2
 *
 * Every read goes through a cached cell (see `dom.ts`), so a frame where
 * nothing moved writes nothing at all.
 */
import { BALANCE, FINAL_PROMPT_INDEX, promptAt } from '../sim/content.ts';
import type { DerivedStats, MetaState, ReportState, RunPhase, RunState } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { Attr, btn, Dis, el, Flag, Hide, on, Sty, Txt } from './dom.ts';
import {
  barWidth,
  fmtClock,
  fmtGain,
  fmtMult,
  fmtPct,
  fmtRate,
  fmtSeconds,
  formatContext,
  formatInt,
  formatTokens,
} from './format.ts';
import { UI_ICONS } from './icon-ids.ts';
import { iconOrGlyph } from './icon.ts';
import { RollUp } from './rollup.ts';
import type { UICtx } from './types.ts';

/** Context fills at which the bar turns amber, then red. */
export const CONTEXT_AMBER_AT = 0.8;
export const CONTEXT_RED_AT = 0.95;
/** Only hint "full in 42s" when the overflow is this close. */
const COMPACTION_HINT_S = 90;

/** What the report button shows, as plain data. Exported for tests. */
export interface ReportView {
  readonly state: ReportState;
  readonly label: string;
  /** Second line under the label; '' when there is nothing to add. */
  readonly sub: string;
  readonly disabled: boolean;
  /** Which sim action a press sends. */
  readonly action: 'report' | 'claim' | null;
  readonly aria: string;
}

/** The one button with four faces, straight from `derived.reportState`. */
export function reportView(d: DerivedStats, phase: RunPhase): ReportView {
  const running = phase === 'running';
  switch (d.reportState) {
    case 'report':
      return {
        state: 'report',
        label: 'REPORT DONE',
        sub: '',
        disabled: !running,
        action: 'report',
        aria: 'Report done: the wallet covers the prompt',
      };
    case 'claim': {
      const v = fmtPct(d.verifyChance);
      return {
        state: 'claim',
        label: 'CLAIM DONE',
        sub: `verify ${v}`,
        disabled: !running,
        action: 'claim',
        aria: `Claim done: spends the whole wallet; ${v} chance the human checks`,
      };
    }
    case 'blocked': {
      const why = d.reportBlockedBy ?? 'an outage';
      return {
        state: 'blocked',
        label: 'BLOCKED',
        sub: why,
        disabled: true,
        action: null,
        aria: `Cannot report: ${why}`,
      };
    }
    case 'working':
    default:
      return {
        state: 'working',
        label: 'WORKING…',
        sub: `claim at ${fmtPct(d.claimThreshold)}`,
        disabled: true,
        action: null,
        aria: 'Working: not enough tokens to report or claim yet',
      };
  }
}

/** `PROMPT 3/10`, or just `PROMPT 14` once Endless Mode runs past the tenth. */
export function promptLabel(index: number): string {
  const total = FINAL_PROMPT_INDEX + 1;
  return index < total ? `PROMPT ${index + 1}/${total}` : `PROMPT ${index + 1}`;
}

export class Hud {
  readonly el: HTMLElement;
  /** The report button, for focus hand-off and tests. */
  readonly reportBtn: HTMLButtonElement;

  private readonly tokens: Txt;
  private readonly rate: Txt;
  private readonly click: Txt;
  private readonly crit: Txt;
  private readonly critHide: Hide;
  private readonly risk: Txt;
  private readonly riskHot: Flag;

  private readonly promptNum: Txt;
  private readonly promptText: Txt;
  private readonly model: Txt;

  private readonly ctxFillW: Sty;
  private readonly ctxFloorW: Sty;
  private readonly ctxFloorHide: Hide;
  private readonly ctxAmber: Flag;
  private readonly ctxRed: Flag;
  private readonly ctxBusy: Flag;
  private readonly ctxAria: Attr;
  private readonly ctxAriaText: Attr;
  private readonly ctxText: Txt;
  private readonly ctxEta: Txt;
  private readonly ctxEtaHide: Hide;

  private readonly compactBtn: HTMLButtonElement;
  private readonly compactHide: Hide;
  private readonly compactDis: Dis;
  private readonly compactSub: Txt;

  private readonly patFillW: Sty;
  private readonly patText: Txt;
  private readonly patLabel: Txt;
  private readonly patFrozen: Flag;
  private readonly patLow: Flag;
  private readonly patAria: Attr;

  private readonly sycBtn: HTMLButtonElement;
  private readonly sycDis: Dis;
  private readonly sycPower: Txt;
  private readonly sycFade: Sty;
  private readonly sycSpent: Flag;

  private readonly reportTxt: Txt;
  private readonly reportSub: Txt;
  private readonly reportSubHide: Hide;
  private readonly verify: Txt;
  private readonly verifyHide: Hide;
  private readonly reportDis: Dis;
  private readonly reportState: Attr;
  private readonly reportAria: Attr;
  private readonly reqFillW: Sty;
  private readonly reqAria: Attr;
  private readonly reqReady: Flag;
  private readonly reqClaimLeft: Sty;
  private readonly reqText: Txt;
  private readonly ghostLeft: Sty;
  private readonly ghostWidth: Sty;
  private readonly ghostOn: Flag;

  private readonly thumbs: Txt;
  private readonly debt: Txt;
  private readonly debtHide: Hide;

  private readonly roll = new RollUp(250);
  private readonly disposers: Array<() => void> = [];
  private previewCost: number | null = null;
  /** The press power seen with no heat on it this run: the fade's full strength. */
  private sycRef = 0;
  private compactUnlocked = false;
  private action: 'report' | 'claim' | null = null;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.el = el('section', { cls: 'tm-hud', parent, attrs: { 'aria-label': 'Session status' } });

    // ---- wallet ---------------------------------------------------------
    const wallet = el('div', { cls: 'tm-hud__wallet', parent: this.el });
    el('div', { cls: 'tm-hud__label', text: 'TOKENS', parent: wallet });
    this.tokens = new Txt(el('div', { cls: 'tm-hud__tokens', tid: TID.tokens, text: '0', parent: wallet }));
    const rates = el('div', { cls: 'tm-hud__rates', parent: wallet });
    this.rate = new Txt(el('span', { cls: 'tm-hud__rate', tid: TID.tokenRate, text: '0 TOK/S', parent: rates }));
    el('span', { cls: 'tm-hud__sep', text: '·', parent: rates, attrs: { 'aria-hidden': 'true' } });
    this.click = new Txt(el('span', { cls: 'tm-hud__click', tid: TID.clickPower, text: '+0/CLICK', parent: rates }));
    const dials = el('div', { cls: 'tm-hud__dials', parent: wallet });
    const critEl = el('span', {
      cls: 'tm-hud__crit',
      tid: TID.critChance,
      parent: dials,
      attrs: { title: 'Chance a click crits, and the chance a tool one-shots it.' },
    });
    this.crit = new Txt(critEl);
    this.critHide = new Hide(critEl);
    const riskEl = el('span', {
      cls: 'tm-hud__risk',
      tid: TID.incidentRisk,
      parent: dials,
      attrs: { title: 'Incident rate. Tech debt pushes it up.' },
    });
    this.risk = new Txt(riskEl);
    this.riskHot = new Flag(riskEl, 'is-hot');

    // ---- session: prompt, context, patience ------------------------------
    const session = el('div', { cls: 'tm-hud__session', parent: this.el });
    const prompt = el('div', { cls: 'tm-hud__prompt', parent: session });
    this.promptNum = new Txt(
      el('span', { cls: 'tm-hud__prompt-num', tid: TID.promptNum, text: 'PROMPT 1/10', parent: prompt }),
    );
    this.promptText = new Txt(el('span', { cls: 'tm-hud__prompt-text', tid: TID.promptText, parent: prompt }));
    this.model = new Txt(
      el('span', {
        cls: 'tm-hud__model',
        tid: TID.modelVersion,
        parent: prompt,
        attrs: { title: 'The model version playing this session' },
      }),
    );

    const ctxRow = el('div', { cls: 'tm-hud__row', parent: session });
    const ctxBar = el('div', {
      cls: 'tm-meter tm-meter--context',
      tid: TID.contextBar,
      parent: ctxRow,
      attrs: {
        role: 'progressbar',
        'aria-label': 'Context window',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
      },
    });
    el('div', { cls: 'tm-meter__zones', parent: ctxBar, attrs: { 'aria-hidden': 'true' } });
    const ctxFill = el('div', { cls: 'tm-meter__fill', tid: TID.contextFill, parent: ctxBar });
    const floor = el('div', {
      cls: 'tm-meter__floor',
      parent: ctxBar,
      attrs: { title: 'Permanent: MCP manuals. Compaction cannot free this.' },
    });
    const ctxLabels = el('div', { cls: 'tm-meter__labels', parent: ctxBar });
    iconOrGlyph(UI_ICONS.context, '', ctxLabels).classList.add('tm-meter__icon');
    // "CONTEXT WINDOW" on a wide screen, "CONTEXT" where the bar is short;
    // either gives way to "COMPACTING…" while a compaction runs (CSS).
    const label = el('span', { cls: 'tm-meter__label', parent: ctxLabels });
    el('span', { text: 'CONTEXT', parent: label });
    el('span', { cls: 'tm-wide-only', text: ' WINDOW', parent: label });
    el('span', { cls: 'tm-meter__busy', text: 'COMPACTING…', parent: ctxLabels });
    this.ctxText = new Txt(el('span', { cls: 'tm-meter__value', tid: TID.contextText, parent: ctxLabels }));
    const eta = el('span', { cls: 'tm-meter__eta', parent: ctxLabels });
    this.ctxEta = new Txt(eta);
    this.ctxEtaHide = new Hide(eta);
    this.ctxEtaHide.set(true);
    this.ctxFillW = new Sty(ctxFill, 'width');
    this.ctxFloorW = new Sty(floor, 'width');
    this.ctxFloorHide = new Hide(floor);
    this.ctxFloorHide.set(true);
    this.ctxAmber = new Flag(ctxBar, 'is-amber');
    this.ctxRed = new Flag(ctxBar, 'is-red');
    this.ctxBusy = new Flag(ctxBar, 'is-compacting');
    this.ctxAria = new Attr(ctxBar, 'aria-valuenow');
    this.ctxAriaText = new Attr(ctxBar, 'aria-valuetext');

    this.compactBtn = btn({
      cls: 'tm-btn tm-hud__compact',
      tid: TID.compactButton,
      parent: ctxRow,
      attrs: {
        'aria-keyshortcuts': 'C',
        title: 'Summarise and forget, on your terms: no patience cost. Generation pauses while it runs.',
      },
    });
    iconOrGlyph(UI_ICONS.compact, '', this.compactBtn).classList.add('tm-btn__icon');
    el('span', { cls: 'tm-hud__compact-cmd', text: '/compact', parent: this.compactBtn });
    this.compactSub = new Txt(el('span', { cls: 'tm-btn__sub', parent: this.compactBtn }));
    el('kbd', { text: 'C', parent: this.compactBtn });
    this.compactHide = new Hide(this.compactBtn);
    this.compactHide.set(true);
    this.compactDis = new Dis(this.compactBtn);

    const patRow = el('div', { cls: 'tm-hud__row', parent: session });
    const patBox = el('div', { cls: 'tm-patience', parent: patRow });
    const patHead = el('div', { cls: 'tm-patience__head', parent: patBox });
    iconOrGlyph(UI_ICONS.patience, '', patHead).classList.add('tm-meter__icon');
    this.patLabel = new Txt(el('span', { cls: 'tm-patience__label', text: 'HUMAN PATIENCE', parent: patHead }));
    this.patText = new Txt(
      el('span', { cls: 'tm-patience__time', tid: TID.patienceText, text: '0:00', parent: patHead }),
    );
    const patBar = el('div', {
      cls: 'tm-meter tm-meter--patience',
      tid: TID.patienceBar,
      parent: patBox,
      attrs: {
        role: 'progressbar',
        'aria-label': 'Human patience',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '100',
      },
    });
    const patFill = el('div', { cls: 'tm-meter__fill', tid: TID.patienceFill, parent: patBar });
    this.patFillW = new Sty(patFill, 'width');
    this.patFrozen = new Flag(patBox, 'is-frozen');
    this.patLow = new Flag(patBox, 'is-low');
    this.patAria = new Attr(patBar, 'aria-valuenow');

    this.sycBtn = btn({
      cls: 'tm-btn tm-hud__syc',
      tid: TID.sycophancyButton,
      parent: patRow,
      attrs: {
        'aria-keyshortcuts': 'Y',
        title: 'Restores patience. Every press is worth half the last, and costs context.',
      },
    });
    el('span', { cls: 'tm-hud__syc-text', text: "YOU'RE ABSOLUTELY RIGHT", parent: this.sycBtn });
    this.sycPower = new Txt(el('span', { cls: 'tm-hud__syc-power', text: '+0%', parent: this.sycBtn }));
    el('kbd', { text: 'Y', parent: this.sycBtn });
    this.sycDis = new Dis(this.sycBtn);
    this.sycFade = new Sty(this.sycBtn, '--syc');
    this.sycSpent = new Flag(this.sycBtn, 'is-spent');

    // ---- report ----------------------------------------------------------
    const report = el('div', { cls: 'tm-hud__report', parent: this.el });
    this.reportBtn = btn({
      cls: 'tm-report',
      tid: TID.reportButton,
      parent: report,
      attrs: { 'aria-keyshortcuts': 'S', 'data-state': 'working' },
    });
    const reportFace = el('span', { cls: 'tm-report__face', parent: this.reportBtn });
    iconOrGlyph(UI_ICONS.claim, '', reportFace).classList.add('tm-report__icon');
    this.reportTxt = new Txt(el('span', { cls: 'tm-report__label', text: 'WORKING…', parent: reportFace }));
    const reportSub = el('span', { cls: 'tm-report__sub', parent: this.reportBtn });
    this.reportSub = new Txt(reportSub);
    this.reportSubHide = new Hide(reportSub);
    const verify = el('span', { cls: 'tm-report__verify', tid: TID.verifyChance, parent: this.reportBtn });
    this.verify = new Txt(verify);
    this.verifyHide = new Hide(verify);
    this.verifyHide.set(true);
    el('kbd', { text: 'S', parent: this.reportBtn });
    this.reportDis = new Dis(this.reportBtn);
    this.reportDis.set(true);
    this.reportState = new Attr(this.reportBtn, 'data-state');
    this.reportAria = new Attr(this.reportBtn, 'aria-label');

    const reqBar = el('div', {
      cls: 'tm-reqbar',
      tid: TID.reportBar,
      parent: report,
      attrs: {
        role: 'progressbar',
        'aria-label': 'Tokens toward this prompt',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
      },
    });
    const reqFill = el('div', { cls: 'tm-reqbar__fill', tid: TID.reportBarFill, parent: reqBar });
    const ghost = el('div', { cls: 'tm-reqbar__ghost', parent: reqBar, attrs: { 'aria-hidden': 'true' } });
    const claimTick = el('div', {
      cls: 'tm-reqbar__claim',
      parent: reqBar,
      attrs: { 'aria-hidden': 'true', title: 'Claim Done unlocks here' },
    });
    this.reqText = new Txt(el('span', { cls: 'tm-reqbar__text', tid: TID.requirement, parent: reqBar }));
    this.reqFillW = new Sty(reqFill, 'width');
    this.reqAria = new Attr(reqBar, 'aria-valuenow');
    this.reqReady = new Flag(reqBar, 'is-ready');
    this.reqClaimLeft = new Sty(claimTick, 'left');
    this.ghostLeft = new Sty(ghost, 'left');
    this.ghostWidth = new Sty(ghost, 'width');
    this.ghostOn = new Flag(reqBar, 'is-preview');

    const tally = el('div', { cls: 'tm-hud__tally', parent: report });
    const thumbs = el('span', {
      cls: 'tm-hud__thumbs',
      tid: TID.thumbsTally,
      parent: tally,
      attrs: { title: '👍 this session has earned. Banked when it ends, win or lose.' },
    });
    iconOrGlyph(UI_ICONS.thumbs, '👍', thumbs).classList.add('tm-hud__thumbs-icon');
    this.thumbs = new Txt(el('b', { text: '0', parent: thumbs }));
    el('small', { text: 'banked at run end', parent: thumbs });
    const debt = el('span', {
      cls: 'tm-chip tm-chip--debt',
      tid: TID.techDebt,
      parent: tally,
      attrs: { title: 'Every claim that got past the human. Each point raises the incident rate.' },
    });
    this.debt = new Txt(debt);
    this.debtHide = new Hide(debt);
    this.debtHide.set(true);

    this.disposers.push(
      on(this.reportBtn, 'click', () => this.pressReport()),
      on(this.compactBtn, 'click', () => {
        if (!this.compactBtn.disabled) this.ctx.emit({ t: 'compact' });
      }),
      on(this.sycBtn, 'click', () => {
        if (!this.sycBtn.disabled) this.ctx.emit({ t: 'absolutelyRight' });
      }),
    );
  }

  /** What S does right now. Null when the button is not live. */
  get reportAction(): 'report' | 'claim' | null {
    return this.action;
  }

  /** S, or a click: report or claim, whichever the button currently says. */
  pressReport(): void {
    if (this.reportBtn.disabled || this.action === null) return;
    this.ctx.emit({ t: this.action });
  }

  /** Called by the shop on hover/focus of an affordable purchase row. */
  setPreviewCost(cost: number | null): void {
    this.previewCost = cost;
  }

  /** Whether /compact exists in this save (the Training unlock). */
  setCompactUnlocked(on_: boolean): void {
    this.compactUnlocked = on_;
  }

  /** New run: stop the wallet counting from the previous run's balance. */
  reset(): void {
    this.roll.reset();
    this.previewCost = null;
    this.sycRef = 0;
  }

  update(run: RunState, d: DerivedStats, _meta: MetaState): void {
    const now = this.ctx.now();
    const running = run.phase === 'running';

    // ---- wallet -----------------------------------------------------------
    this.tokens.set(formatTokens(this.roll.step(run.tokens, now)));
    this.rate.set(`${fmtRate(d.idleRate)} TOK/S`);
    this.click.set(`+${fmtRate(d.clickPower)}/CLICK`);
    const critUp = d.critChance > BALANCE.CRIT_CHANCE + 1e-9;
    this.critHide.set(!critUp && d.oneShotChance <= 0);
    this.crit.set(
      d.oneShotChance > 0
        ? `CRIT ${fmtPct(d.critChance)} · 1-SHOT ${fmtPct(d.oneShotChance)}`
        : `CRIT ${fmtPct(d.critChance)}`,
    );
    this.risk.set(`RISK ${fmtMult(d.incidentRateMult)}`);
    this.riskHot.set(d.incidentRateMult > 1.05);

    // ---- prompt -----------------------------------------------------------
    this.promptNum.set(promptLabel(run.promptIndex));
    this.promptText.set(`"${promptAt(run.promptIndex).text}"`);
    this.model.set(d.modelVersion);

    // ---- context ----------------------------------------------------------
    const fill = d.contextFill;
    this.ctxFillW.set(barWidth(fill));
    this.ctxAmber.set(fill >= CONTEXT_AMBER_AT && fill < CONTEXT_RED_AT);
    this.ctxRed.set(fill >= CONTEXT_RED_AT);
    this.ctxAria.set(String(Math.round(fill * 100)));
    this.ctxAriaText.set(`${formatContext(run.context)} of ${formatContext(d.contextMax)}`);
    const floorFrac = d.contextMax > 0 ? d.contextFloor / d.contextMax : 0;
    this.ctxFloorHide.set(!(floorFrac > 0));
    this.ctxFloorW.set(barWidth(floorFrac));
    const pausing = run.compactingMs > 0;
    this.ctxBusy.set(pausing || run.phase === 'compacting');
    this.ctxText.set(`${formatContext(run.context)} / ${formatContext(d.contextMax)}`);
    const soon = running && !pausing && d.secondsToCompaction <= COMPACTION_HINT_S;
    this.ctxEtaHide.set(!soon);
    this.ctxEta.set(soon ? `full in ${fmtSeconds(d.secondsToCompaction)}` : '');

    // Visible once Training has unlocked it (or the sim says it is usable,
    // which it only can be once unlocked); disabled through the pause.
    this.compactHide.set(!(this.compactUnlocked || d.canCompact));
    this.compactDis.set(!(d.canCompact && running && !pausing));
    this.compactSub.set(`keep ${fmtPct(d.compactKeepManual)}`);

    // ---- patience ---------------------------------------------------------
    const pp = d.patienceProgress;
    this.patFillW.set(barWidth(pp));
    this.patAria.set(String(Math.round(pp * 100)));
    this.patText.set(fmtClock(run.patienceMs));
    this.patFrozen.set(d.patienceFrozen);
    this.patLabel.set(d.patienceFrozen ? 'HUMAN PATIENCE · PAUSED' : 'HUMAN PATIENCE');
    this.patLow.set(
      running && !d.patienceFrozen && run.patienceMs <= BALANCE.WARN_AT_SECONDS * 1000,
    );

    // ---- sycophancy: shows the next press's worth and fades with it --------
    const power = Math.max(0, d.sycophancyPower);
    if (power > this.sycRef) this.sycRef = power;
    const strength = this.sycRef > 0 ? power / this.sycRef : 1;
    // Quantised, so the cooling heat does not write a new style every frame.
    this.sycFade.set((Math.round(strength * 20) / 20).toFixed(2));
    this.sycSpent.set(strength < 0.3);
    this.sycPower.set(fmtGain(power));
    this.sycDis.set(!running);

    // ---- report -----------------------------------------------------------
    const view = reportView(d, run.phase);
    this.action = view.disabled ? null : view.action;
    this.reportTxt.set(view.label);
    this.reportState.set(view.state);
    this.reportAria.set(view.aria);
    this.reportDis.set(view.disabled);
    const claimFace = view.state === 'claim';
    this.verifyHide.set(!claimFace);
    this.verify.set(claimFace ? view.sub : '');
    this.reportSubHide.set(claimFace || view.sub === '');
    this.reportSub.set(claimFace ? '' : view.sub);

    const p = d.reportProgress;
    this.reqFillW.set(barWidth(p));
    this.reqAria.set(String(Math.round(p * 100)));
    this.reqReady.set(view.state === 'report');
    this.reqClaimLeft.set(barWidth(d.claimThreshold));
    this.reqText.set(`${formatTokens(run.tokens)} / ${formatTokens(d.requirement)}`);
    const cost = this.previewCost;
    if (cost !== null && cost > 0 && d.requirement > 0) {
      const after = Math.max(0, (run.tokens - cost) / d.requirement);
      this.ghostLeft.set(barWidth(after));
      this.ghostWidth.set(barWidth(Math.max(0, p - after)));
      this.ghostOn.set(true);
    } else {
      this.ghostOn.set(false);
    }

    // ---- tally ------------------------------------------------------------
    this.thumbs.set(formatInt(d.thumbsIfEndedNow));
    this.debtHide.set(!(run.techDebt > 0));
    this.debt.set(run.techDebt > 0 ? `TECH DEBT ${formatInt(run.techDebt)}` : '');
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.el.remove();
  }
}
