/**
 * Contract coverage: every `TID` the UI owns must exist in the DOM in the
 * phase it belongs to. Plus mount/teardown hygiene.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { META_UPGRADES } from '../../src/sim/content.ts';
import { TID, tid } from '../../src/testids.ts';
import { createUI } from '../../src/ui/index.ts';
import type { UI, UIScreen } from '../../src/ui/types.ts';
import {
  all,
  allPrefixed,
  isHidden,
  makeDerived,
  makeFakeSim,
  makeIncident,
  makeRun,
  must,
  q,
  type FakeSim,
} from './ui.fake-sim.ts';

let mounted: UI | null = null;
let host: HTMLElement | null = null;

function mount(screen: UIScreen, sim: FakeSim = makeFakeSim()): { ui: UI; root: HTMLElement; sim: FakeSim } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ui = createUI({ root, sim, screen, now: () => 0 });
  mounted = ui;
  host = root;
  return { ui, root, sim };
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

describe('shell', () => {
  it('stamps the app testid and creates the 320x180 canvas', () => {
    const { ui, root } = mount('title');
    expect(root.getAttribute('data-testid')).toBe(TID.app);
    expect(ui.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(ui.canvas.width).toBe(320);
    expect(ui.canvas.height).toBe(180);
    expect(ui.canvas.getAttribute('data-testid')).toBe(TID.scene);
    expect(q(root, TID.laptop)).not.toBeNull();
    expect(ui.scale).toBeGreaterThanOrEqual(1);
  });

  it('does not clobber a testid the host already set', () => {
    const root = document.createElement('div');
    root.setAttribute('data-testid', 'host-app');
    document.body.appendChild(root);
    const ui = createUI({ root, sim: makeFakeSim(), screen: 'title', now: () => 0 });
    expect(root.getAttribute('data-testid')).toBe('host-app');
    ui.destroy();
    expect(root.getAttribute('data-testid')).toBe('host-app');
    root.remove();
  });

  it('writes --px on its own wrapper so the layout steps in integers', () => {
    const { ui } = mount('run');
    const px = ui.el.style.getPropertyValue('--px');
    expect(px).toMatch(/^\d+px$/);
    expect(['wide', 'stacked']).toContain(ui.el.dataset['layout']);
  });
});

describe('title screen', () => {
  it('renders the title testids and lifetime stats when a save exists', () => {
    const sim = makeFakeSim();
    sim.meta.runs = 7;
    sim.meta.wins = 2;
    sim.meta.bestProject = 3;
    sim.meta.demos = 12;
    sim.meta.totalDemosEarned = 40;
    const { root, ui } = mount('title', sim);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);

    expect(isHidden(q(root, TID.titleScreen))).toBe(false);
    // Labelled, but not pinned to a word: the button is themed copy ("New
    // venture") and the framing is allowed to change without breaking a test.
    expect((must(root, TID.startRun).textContent ?? '').trim().length).toBeGreaterThan(3);
    const stats = must(root, TID.titleScreen).textContent ?? '';
    expect(stats).toContain('RUNS 7');
    expect(stats).toContain('WINS 2');
    expect(stats).toContain('LIFETIME');
  });

  it('start-run calls sim.startRun and switches to the run screen', () => {
    const { root, ui, sim } = mount('title');
    must(root, TID.startRun).click();
    expect(sim.startRun).toHaveBeenCalledTimes(1);
    expect(ui.screen).toBe('run');
    expect(isHidden(q(root, TID.titleScreen))).toBe(true);
  });
});

describe('meta screen', () => {
  it('renders one row per META_UPGRADES entry with a buy button', () => {
    const sim = makeFakeSim();
    sim.meta.demos = 9;
    const { root, ui } = mount('meta', sim);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);

    expect(isHidden(q(root, TID.metaScreen))).toBe(false);
    expect(must(root, TID.metaDemos).textContent).toContain('9');
    for (const def of META_UPGRADES) {
      expect(q(root, tid(TID.metaRow, def.id))).not.toBeNull();
      expect(q(root, tid(TID.metaBuy, def.id))).not.toBeNull();
    }
    expect(allPrefixed(root, TID.metaRow)).toHaveLength(META_UPGRADES.length);
  });

  it('disables meta buys that are unaffordable and enables the ones that are not', () => {
    // Costs are balance dials — read them out of the content so a re-tune
    // cannot silently invalidate this.
    // Only root nodes are buyable on a fresh save; a deep node is disabled by
    // its prerequisites regardless of price.
    const sorted = [...META_UPGRADES]
      .filter((d) => d.requires.length === 0)
      .sort((a, b) => (a.costs[0] ?? 0) - (b.costs[0] ?? 0));
    const cheapDef = sorted[0]!;
    const dearDef = [...sorted].reverse().find((d) => (d.costs[0] ?? 0) > (cheapDef.costs[0] ?? 0))!;

    const sim = makeFakeSim();
    sim.meta.demos = cheapDef.costs[0]!;
    const { root, ui } = mount('meta', sim);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);

    const cheap = must(root, tid(TID.metaBuy, cheapDef.id)) as HTMLButtonElement;
    const dear = must(root, tid(TID.metaBuy, dearDef.id)) as HTMLButtonElement;
    expect(cheap.disabled, `${cheapDef.id} should be affordable`).toBe(false);
    expect(dear.disabled, `${dearDef.id} should be too expensive`).toBe(true);

    cheap.click();
    expect(sim.buyMeta).toHaveBeenCalledWith(cheapDef.id);
    dear.click();
    expect(sim.buyMeta).toHaveBeenCalledTimes(1);
  });

  it('shows the maxed state at max level', () => {
    const sim = makeFakeSim();
    sim.meta.demos = 999;
    sim.meta.levels = { prompt_library: 1 };
    const { root, ui } = mount('meta', sim);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);
    // The whole node is the button now, so its text carries name + effect too.
    const buy = must(root, tid(TID.metaBuy, 'prompt_library')) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
    expect(buy.textContent).toContain('MAX');
    expect(buy.className).toContain('is-owned');
  });
});

describe('run HUD + shop testids', () => {
  it('renders every run-phase testid', () => {
    const sim = makeFakeSim();
    sim.run.incidents = [makeIncident('rate_limited')];
    sim.run.cards = ['sonnet'];
    sim.setUpgrades(['mech_keyboard', 'yolo_mode']);
    const { root, ui } = mount('run', sim);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);

    const expected = [
      TID.slop,
      TID.slopRate,
      TID.clickPower,
      TID.projectName,
      TID.projectNum,
      TID.shipBar,
      TID.shipBarFill,
      TID.requirement,
      TID.deadlineBar,
      TID.deadlineFill,
      TID.deadlineText,
      TID.demoTally,
      TID.shipButton,
      TID.incidentBanner,
      TID.incidentName,
      TID.incidentTimer,
      TID.activeCards,
      TID.shop,
      TID.tabAgents,
      TID.tabUpgrades,
      TID.agentList,
      TID.upgradeList,
      TID.buyQtyToggle,
      TID.optionsButton,
      TID.optionsPanel,
      TID.muteToggle,
      TID.reducedMotion,
      TID.resetSave,
    ];
    for (const t of expected) {
      expect(q(root, t), `missing ${t}`).not.toBeNull();
    }

    // scoped ids
    expect(q(root, tid(TID.agentRow, 'tab_autocomplete'))).not.toBeNull();
    expect(q(root, tid(TID.agentCost, 'tab_autocomplete'))).not.toBeNull();
    expect(q(root, tid(TID.agentOwned, 'tab_autocomplete'))).not.toBeNull();
    expect(q(root, tid(TID.upgradeRow, 'mech_keyboard'))).not.toBeNull();
    expect(q(root, tid(TID.upgradeRow, 'yolo_mode'))).not.toBeNull();
  });

  it('marks risk upgrades with the dangerous treatment', () => {
    const sim = makeFakeSim();
    sim.setUpgrades(['mech_keyboard', 'yolo_mode', 'ci_gate']);
    const { root, ui } = mount('run', sim);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);

    const yolo = must(root, tid(TID.upgradeRow, 'yolo_mode'));
    expect(yolo.className).toContain('tm-row--risk');
    expect(yolo.className).not.toContain('tm-row--risk-safe');
    expect(yolo.textContent).toContain('MORE INCIDENTS');

    // CI Gate is kind:'risk' but turns the dial the other way.
    const gate = must(root, tid(TID.upgradeRow, 'ci_gate'));
    expect(gate.className).toContain('tm-row--risk-safe');
    expect(gate.textContent).toContain('FEWER INCIDENTS');

    expect(must(root, tid(TID.upgradeRow, 'mech_keyboard')).className).not.toContain('tm-row--risk');
  });

  it('shows the ship-bar cost of every purchase inline', () => {
    const sim = makeFakeSim({ run: makeRun({ slop: 100 }) });
    const { root, ui } = mount('run', sim);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);
    const row = must(root, tid(TID.agentRow, 'tab_autocomplete'));
    expect(row.textContent).toMatch(/−\d+% bar/);
  });

  it('renders a toast through the public helper', () => {
    const { root, ui } = mount('run');
    ui.toast('hello', 'good');
    expect(all(root, TID.toast)).toHaveLength(1);
    expect(must(root, TID.toast).textContent).toBe('hello');
  });
});

describe('options', () => {
  it('opens on the options button and exposes its controls', () => {
    const { root, ui, sim } = mount('run');
    expect(isHidden(q(root, TID.optionsPanel))).toBe(true);
    must(root, TID.optionsButton).click();
    expect(isHidden(q(root, TID.optionsPanel))).toBe(false);

    const mute = must(root, TID.muteToggle);
    mute.click();
    expect(sim.meta.settings.musicVolume).toBe(0);
    expect(sim.meta.settings.sfxVolume).toBe(0);
    mute.click();
    expect(sim.meta.settings.musicVolume).toBeGreaterThan(0);

    const motion = must(root, TID.reducedMotion);
    motion.click();
    expect(sim.meta.settings.reducedMotion).toBe(true);
    ui.update(sim.run, makeDerived(sim.run), sim.meta);
    expect(ui.el.getAttribute('data-reduced-motion')).toBe('1');
  });

  it('requires two clicks to reset the save', () => {
    const actions: string[] = [];
    const root = document.createElement('div');
    document.body.appendChild(root);
    const sim = makeFakeSim();
    const ui = createUI({
      root,
      sim,
      screen: 'run',
      now: () => 0,
      onAction: (a) => actions.push(a.t),
    });
    mounted = ui;
    host = root;

    must(root, TID.optionsButton).click();
    const reset = must(root, TID.resetSave);
    reset.click();
    expect(actions).not.toContain('resetSave');
    expect(reset.textContent).toMatch(/again/i);
    reset.click();
    expect(actions).toContain('resetSave');
  });
});

describe('destroy', () => {
  it('empties the root and stops responding to hotkeys', () => {
    const { root, ui, sim } = mount('run');
    expect(root.childElementCount).toBe(1);
    ui.destroy();
    expect(root.childElementCount).toBe(0);
    expect(root.hasAttribute('data-testid')).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(sim.ship).not.toHaveBeenCalled();

    // idempotent, and update()/handle() become no-ops
    ui.destroy();
    ui.update(sim.run, makeDerived(sim.run), sim.meta);
    ui.handle({ t: 'runStart', seed: 1 });
    expect(root.childElementCount).toBe(0);
    mounted = null;
  });
});
