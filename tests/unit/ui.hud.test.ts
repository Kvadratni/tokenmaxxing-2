/**
 * The HUD band: wallet, prompt, the context window, the human's patience,
 * "You're absolutely right", the four-faced report button, the 👍 tally, tech
 * debt and the model version.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE, promptAt } from '../../src/sim/content.ts';
import { formatTokens } from '../../src/sim/index.ts';
import { TID } from '../../src/testids.ts';
import { CONTEXT_AMBER_AT, CONTEXT_RED_AT, promptLabel, reportView } from '../../src/ui/hud.ts';
import { RollUp } from '../../src/ui/rollup.ts';
import {
  isHidden,
  makeDerived,
  makeRun,
  makeUnlocked,
  mountUI,
  must,
  text,
  unmountAll,
} from './ui.fake-sim.ts';

afterEach(unmountAll);

const reportBtn = (root: HTMLElement): HTMLButtonElement => must(root, TID.reportButton) as HTMLButtonElement;

describe('wallet', () => {
  it('shows the tokens with the sim formatter, the rate line and click power', () => {
    const m = mountUI({ run: makeRun({ tokens: 184_200 }) });
    m.derived = { idleRate: 2_100, clickPower: 64 };
    m.frame();
    expect(text(m.root, TID.tokens)).toBe(formatTokens(184_200));
    expect(text(m.root, TID.tokenRate)).toBe(`${formatTokens(2_100)} TOK/S`);
    expect(text(m.root, TID.clickPower)).toBe('+64/CLICK');
  });

  it('keeps a decimal on small rates instead of printing a first Grep as 0', () => {
    const m = mountUI({ derived: { idleRate: 0.8 } });
    expect(text(m.root, TID.tokenRate)).toBe('0.8 TOK/S');
  });

  it('hides the crit readout at base and shows crit and one-shot once raised', () => {
    const m = mountUI();
    expect(isHidden(must(m.root, TID.critChance))).toBe(true);
    m.derived = { critChance: 0.1, oneShotChance: 0.05 };
    m.frame();
    expect(isHidden(must(m.root, TID.critChance))).toBe(false);
    expect(text(m.root, TID.critChance)).toBe('CRIT 10% · 1-SHOT 5%');
  });

  it('colours the incident risk once tech debt pushes it up', () => {
    const m = mountUI({ derived: { incidentRateMult: 1.2 } });
    const risk = must(m.root, TID.incidentRisk);
    expect(risk.textContent).toBe('RISK ×1.20');
    expect(risk.classList.contains('is-hot')).toBe(true);
  });
});

describe('prompt line', () => {
  it('numbers the prompt out of ten and quotes what the human typed', () => {
    const m = mountUI({ run: makeRun({ promptIndex: 2 }) });
    expect(text(m.root, TID.promptNum)).toBe('PROMPT 3/10');
    expect(text(m.root, TID.promptText)).toBe(`"${promptAt(2).text}"`);
  });

  it('drops the "/10" once Endless Mode runs past the tenth', () => {
    expect(promptLabel(0)).toBe('PROMPT 1/10');
    expect(promptLabel(9)).toBe('PROMPT 10/10');
    expect(promptLabel(10)).toBe('PROMPT 11');
  });

  it('wears the model version', () => {
    const m = mountUI({ derived: { modelVersion: '2.5 (new)' } });
    expect(text(m.root, TID.modelVersion)).toBe('2.5 (new)');
  });
});

describe('context window', () => {
  const bar = (root: HTMLElement): HTMLElement => must(root, TID.contextBar);

  it('reads "used / max" in context units and fills to the fraction', () => {
    const m = mountUI({ run: makeRun({ context: 184_000 }), derived: { contextMax: 200_000 } });
    expect(text(m.root, TID.contextText)).toBe('184K / 200K');
    expect(must(m.root, TID.contextFill).style.width).toBe('92.0%');
    expect(bar(m.root).getAttribute('aria-valuenow')).toBe('92');
  });

  it('is green, then amber from 80%, then red from 95%', () => {
    const m = mountUI();
    const at = (fill: number): { amber: boolean; red: boolean } => {
      m.sim.run.context = fill * BALANCE.BASE_CONTEXT;
      m.frame();
      return { amber: bar(m.root).classList.contains('is-amber'), red: bar(m.root).classList.contains('is-red') };
    };
    expect(at(0.5)).toEqual({ amber: false, red: false });
    expect(at(CONTEXT_AMBER_AT - 0.01)).toEqual({ amber: false, red: false });
    expect(at(CONTEXT_AMBER_AT)).toEqual({ amber: true, red: false });
    expect(at(CONTEXT_RED_AT - 0.01)).toEqual({ amber: true, red: false });
    expect(at(CONTEXT_RED_AT)).toEqual({ amber: false, red: true });
    expect(at(1)).toEqual({ amber: false, red: true });
  });

  it('shows the MCP manuals as a hatched floor segment, and nothing when there are none', () => {
    const m = mountUI();
    const floor = bar(m.root).querySelector<HTMLElement>('.tm-meter__floor')!;
    expect(isHidden(floor)).toBe(true);
    m.derived = { contextFloor: 2_000 };
    m.frame();
    expect(isHidden(floor)).toBe(false);
    expect(floor.style.width).toBe('25.0%');
  });

  it('warns how long until a forced compaction once it is close', () => {
    const m = mountUI({ derived: { secondsToCompaction: 42 } });
    const eta = bar(m.root).querySelector<HTMLElement>('.tm-meter__eta')!;
    expect(isHidden(eta)).toBe(false);
    expect(eta.textContent).toBe('full in 42s');
    m.derived = { secondsToCompaction: Infinity };
    m.frame();
    expect(isHidden(eta)).toBe(true);
  });

  it('marks the bar as compacting through the manual pause', () => {
    const m = mountUI({ run: makeRun({ compactingMs: 2_000 }) });
    expect(bar(m.root).classList.contains('is-compacting')).toBe(true);
  });
});

describe('/compact', () => {
  const button = (root: HTMLElement): HTMLButtonElement => must(root, TID.compactButton) as HTMLButtonElement;

  it('is hidden until Training unlocks the compact feature', () => {
    const m = mountUI();
    expect(isHidden(button(m.root))).toBe(true);
  });

  it('appears once unlocked and sends `compact` when pressed', () => {
    const m = mountUI({ unlocked: makeUnlocked(['compact']), derived: { canCompact: true } });
    const b = button(m.root);
    expect(isHidden(b)).toBe(false);
    expect(b.disabled).toBe(false);
    expect(b.textContent).toContain('/compact');
    expect(b.textContent).toContain('keep 50%');
    b.click();
    expect(m.sent('compact')).toHaveLength(1);
  });

  it('is disabled during the pause, and does nothing when pressed then', () => {
    const m = mountUI({
      unlocked: makeUnlocked(['compact']),
      run: makeRun({ compactingMs: 1_500 }),
      derived: { canCompact: false },
    });
    const b = button(m.root);
    expect(isHidden(b)).toBe(false);
    expect(b.disabled).toBe(true);
    b.click();
    expect(m.sent('compact')).toHaveLength(0);
  });

  it('shows itself whenever the sim says it is usable, even before the unlock list refreshes', () => {
    const m = mountUI({ derived: { canCompact: true } });
    expect(isHidden(button(m.root))).toBe(false);
  });
});

describe('human patience', () => {
  const box = (root: HTMLElement): HTMLElement => must(root, TID.patienceBar).closest<HTMLElement>('.tm-patience')!;

  it('shows the seconds left and drains the amber bar', () => {
    const max = promptAt(0).patienceMs;
    const m = mountUI({ run: makeRun({ patienceMs: max / 2 }) });
    expect(text(m.root, TID.patienceText)).toBe('1:00');
    expect(must(m.root, TID.patienceFill).style.width).toBe('50.0%');
  });

  it('visibly freezes while the human is at lunch', () => {
    const m = mountUI({ derived: { patienceFrozen: true } });
    expect(box(m.root).classList.contains('is-frozen')).toBe(true);
    expect(box(m.root).textContent).toContain('PAUSED');
    m.derived = { patienceFrozen: false };
    m.frame();
    expect(box(m.root).classList.contains('is-frozen')).toBe(false);
  });

  it('flashes in the last seconds, but not while frozen', () => {
    const m = mountUI({ run: makeRun({ patienceMs: (BALANCE.WARN_AT_SECONDS - 1) * 1000 }) });
    expect(box(m.root).classList.contains('is-low')).toBe(true);
    m.derived = { patienceFrozen: true };
    m.frame();
    expect(box(m.root).classList.contains('is-low')).toBe(false);
  });
});

describe("you're absolutely right", () => {
  const button = (root: HTMLElement): HTMLButtonElement => must(root, TID.sycophancyButton) as HTMLButtonElement;

  it("says it, shows what the next press restores, and sends `absolutelyRight`", () => {
    const m = mountUI({ derived: { sycophancyPower: 0.06 } });
    const b = button(m.root);
    expect(b.textContent).toContain("YOU'RE ABSOLUTELY RIGHT");
    expect(b.textContent).toContain('+6%');
    b.click();
    expect(m.sent('absolutelyRight')).toHaveLength(1);
  });

  it('fades as each press is worth less than the first', () => {
    const m = mountUI({ derived: { sycophancyPower: 0.06 } });
    const fade = (): number => Number(button(m.root).style.getPropertyValue('--syc'));
    expect(fade()).toBe(1);
    m.derived = { sycophancyPower: 0.03 };
    m.frame();
    expect(fade()).toBe(0.5);
    expect(button(m.root).textContent).toContain('+3%');
    m.derived = { sycophancyPower: 0.0075 };
    m.frame();
    expect(fade()).toBeLessThan(0.3);
    expect(button(m.root).classList.contains('is-spent')).toBe(true);
    // It cools off: back to full strength once the heat is gone.
    m.derived = { sycophancyPower: 0.06 };
    m.frame();
    expect(fade()).toBe(1);
  });

  it('is disabled outside a running prompt', () => {
    const m = mountUI({ run: makeRun({ phase: 'reported' }) });
    expect(button(m.root).disabled).toBe(true);
  });
});

describe('the report button', () => {
  it('maps every report state to its face', () => {
    const d = makeDerived(makeRun());
    expect(reportView({ ...d, reportState: 'report' }, 'running')).toMatchObject({
      label: 'REPORT DONE',
      action: 'report',
      disabled: false,
    });
    expect(reportView({ ...d, reportState: 'claim', verifyChance: 0.34 }, 'running')).toMatchObject({
      label: 'CLAIM DONE',
      sub: 'verify 34%',
      action: 'claim',
      disabled: false,
    });
    expect(reportView({ ...d, reportState: 'working' }, 'running')).toMatchObject({
      label: 'WORKING…',
      action: null,
      disabled: true,
    });
    expect(
      reportView({ ...d, reportState: 'blocked', reportBlockedBy: 'GitHub Is Down' }, 'running'),
    ).toMatchObject({ label: 'BLOCKED', sub: 'GitHub Is Down', action: null, disabled: true });
    // Nothing is live outside a running prompt.
    expect(reportView({ ...d, reportState: 'report' }, 'drafting').disabled).toBe(true);
  });

  it('reads REPORT DONE, green, and sends `report`', () => {
    const m = mountUI({ run: makeRun({ tokens: 100 }) });
    const b = reportBtn(m.root);
    expect(b.getAttribute('data-state')).toBe('report');
    expect(b.textContent).toContain('REPORT DONE');
    expect(b.disabled).toBe(false);
    expect(isHidden(must(m.root, TID.verifyChance))).toBe(true);
    b.click();
    expect(m.sent('report')).toHaveLength(1);
    expect(m.sent('claim')).toHaveLength(0);
  });

  it('reads CLAIM DONE, amber, with the live verify chance, and sends `claim`', () => {
    const m = mountUI({ run: makeRun({ tokens: 60 }), derived: { verifyChance: 0.34 } });
    const b = reportBtn(m.root);
    expect(b.getAttribute('data-state')).toBe('claim');
    expect(b.textContent).toContain('CLAIM DONE');
    expect(isHidden(must(m.root, TID.verifyChance))).toBe(false);
    expect(text(m.root, TID.verifyChance)).toBe('verify 34%');
    b.click();
    expect(m.sent('claim')).toHaveLength(1);
    expect(m.sent('report')).toHaveLength(0);
  });

  it('reads WORKING… and stays disabled below the claim threshold', () => {
    const m = mountUI({ run: makeRun({ tokens: 10 }) });
    const b = reportBtn(m.root);
    expect(b.getAttribute('data-state')).toBe('working');
    expect(b.textContent).toContain('WORKING…');
    expect(b.disabled).toBe(true);
    b.click();
    expect(m.actions.filter((a) => a.t === 'report' || a.t === 'claim')).toHaveLength(0);
  });

  it('reads BLOCKED and names the outage', () => {
    const m = mountUI({
      run: makeRun({ tokens: 100 }),
      derived: { reportState: 'blocked', reportBlockedBy: 'GitHub Is Down' },
    });
    const b = reportBtn(m.root);
    expect(b.getAttribute('data-state')).toBe('blocked');
    expect(b.textContent).toContain('BLOCKED');
    expect(b.textContent).toContain('GitHub Is Down');
    expect(b.getAttribute('aria-label')).toContain('GitHub Is Down');
    expect(b.disabled).toBe(true);
  });

  it('fills the report bar with the wallet and states the requirement', () => {
    const m = mountUI({ run: makeRun({ tokens: 25 }) });
    expect(must(m.root, TID.reportBarFill).style.width).toBe('25.0%');
    expect(text(m.root, TID.requirement)).toBe(`25 / ${formatTokens(promptAt(0).requirement)}`);
    const tick = must(m.root, TID.reportBar).querySelector<HTMLElement>('.tm-reqbar__claim')!;
    expect(tick.style.left).toBe('50.0%');
  });

  it('paints where a purchase would drop the wallet to', () => {
    const m = mountUI({ run: makeRun({ tokens: 80 }) });
    const bar = must(m.root, TID.reportBar);
    const tool = must(m.root, 'tool-row-grep');
    tool.dispatchEvent(new Event('pointerenter'));
    m.frame();
    expect(bar.classList.contains('is-preview')).toBe(true);
    tool.dispatchEvent(new Event('pointerleave'));
    m.frame();
    expect(bar.classList.contains('is-preview')).toBe(false);
  });
});

describe('tally, tech debt', () => {
  it('shows the 👍 the session would bank, labelled as banked at run end', () => {
    const m = mountUI({ derived: { thumbsIfEndedNow: 3 } });
    const tally = must(m.root, TID.thumbsTally);
    expect(tally.textContent).toContain('3');
    expect(tally.textContent).toContain('banked at run end');
  });

  it('hides the tech-debt chip at zero and shows it once claims get through', () => {
    const m = mountUI();
    expect(isHidden(must(m.root, TID.techDebt))).toBe(true);
    m.sim.run.techDebt = 2;
    m.frame();
    expect(isHidden(must(m.root, TID.techDebt))).toBe(false);
    expect(text(m.root, TID.techDebt)).toBe('TECH DEBT 2');
  });
});

describe('roll-up', () => {
  it('snaps on the first observation and converges exactly', () => {
    const r = new RollUp(250);
    expect(r.step(500, 0)).toBe(500);
    expect(r.step(1500, 0)).toBe(500);
    const mid = r.step(1500, 60);
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(1500);
    expect(r.step(1500, 400)).toBe(1500);
  });

  it('counts the wallet up rather than snapping it', () => {
    const m = mountUI({ run: makeRun({ tokens: 100 }) });
    m.sim.run.tokens = 900;
    m.tick(30);
    m.frame();
    const shown = Number(text(m.root, TID.tokens));
    expect(shown).toBeGreaterThan(100);
    expect(shown).toBeLessThan(900);
    m.tick(2_000);
    m.frame();
    expect(text(m.root, TID.tokens)).toBe('900');
  });
});
