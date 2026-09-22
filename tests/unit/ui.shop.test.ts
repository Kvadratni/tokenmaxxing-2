/**
 * Shop rail: affordability gating, the buy-quantity toggle and bulk maths.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_TIERS } from '../../src/sim/content.ts';
import { TID, tid } from '../../src/testids.ts';
import { createUI } from '../../src/ui/index.ts';
import { bulkCost, maxAffordable } from '../../src/ui/shop.ts';
import type { UI } from '../../src/ui/types.ts';
import { makeDerived, makeFakeSim, makeRun, must, q, type FakeSim } from './ui.fake-sim.ts';

const TIER0 = AGENT_TIERS[0]!;
const TIER1 = AGENT_TIERS[1]!;

let mounted: UI | null = null;
let host: HTMLElement | null = null;

function mount(slop: number): { ui: UI; root: HTMLElement; sim: FakeSim; frame: () => void } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sim = makeFakeSim({ run: makeRun({ slop }) });
  const ui = createUI({ root, sim, screen: 'run', now: () => 0 });
  mounted = ui;
  host = root;
  const frame = (): void => ui.update(sim.run, makeDerived(sim.run), sim.meta);
  frame();
  return { ui, root, sim, frame };
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

describe('bulk cost maths', () => {
  it('sums a geometric ladder', () => {
    expect(bulkCost(100, 1.15, 1)).toBeCloseTo(100, 6);
    expect(bulkCost(100, 1.15, 2)).toBeCloseTo(215, 6);
    expect(bulkCost(100, 1.15, 3)).toBeCloseTo(347.25, 6);
    expect(bulkCost(100, 1.15, 0)).toBe(0);
    expect(bulkCost(50, 1, 4)).toBe(200);
  });

  it('inverts to the largest affordable count', () => {
    expect(maxAffordable(100, 1.15, 99)).toBe(0);
    expect(maxAffordable(100, 1.15, 100)).toBe(1);
    expect(maxAffordable(100, 1.15, 214)).toBe(1);
    expect(maxAffordable(100, 1.15, 215)).toBe(2);
    expect(maxAffordable(100, 1.15, 347.25)).toBe(3);
  });
});

describe('affordability gating', () => {
  it('disables a row the player cannot afford and swallows the click', () => {
    const { root, sim } = mount(0);
    const row = must(root, tid(TID.agentRow, TIER0.id)) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    row.click();
    expect(sim.buyAgent).not.toHaveBeenCalled();
  });

  it('enables the row at exactly the asking price and buys on click', () => {
    const { root, sim } = mount(TIER0.baseCost);
    const row = must(root, tid(TID.agentRow, TIER0.id)) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    row.click();
    expect(sim.buyAgent).toHaveBeenCalledWith(TIER0.id, 1);
  });

  it('re-enables rows as the balance moves, without rebuilding them', () => {
    const { root, sim, frame } = mount(0);
    const row = must(root, tid(TID.agentRow, TIER0.id)) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    sim.run.slop = 1e6;
    frame();
    expect(row.disabled).toBe(false);
    // same node identity: rows are built once
    expect(must(root, tid(TID.agentRow, TIER0.id))).toBe(row);
  });

  it('disables everything outside the running phase', () => {
    const { root, sim, frame } = mount(1e9);
    sim.run.phase = 'drafting';
    frame();
    expect((must(root, tid(TID.agentRow, TIER0.id)) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gates upgrades on cost too', () => {
    const { root, sim, frame } = mount(0);
    sim.setUpgrades(['mech_keyboard']);
    frame();
    const row = must(root, tid(TID.upgradeRow, 'mech_keyboard')) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    row.click();
    expect(sim.buyUpgrade).not.toHaveBeenCalled();

    sim.run.slop = 1000;
    frame();
    expect(row.disabled).toBe(false);
    row.click();
    expect(sim.buyUpgrade).toHaveBeenCalledWith('mech_keyboard');
  });
});

describe('buy quantity toggle', () => {
  it('cycles ×1 -> ×10 -> MAX -> ×1', () => {
    const { root } = mount(1e9);
    const toggle = must(root, TID.buyQtyToggle);
    expect(toggle.textContent).toBe('×1');
    toggle.click();
    expect(toggle.textContent).toBe('×10');
    toggle.click();
    expect(toggle.textContent).toBe('MAX');
    toggle.click();
    expect(toggle.textContent).toBe('×1');
  });

  it('passes the selected count to sim.buyAgent, MAX as Infinity', () => {
    const { root, sim, frame } = mount(1e9);
    const toggle = must(root, TID.buyQtyToggle);
    const row = (): HTMLButtonElement => must(root, tid(TID.agentRow, TIER0.id)) as HTMLButtonElement;

    row().click();
    expect(sim.buyAgent).toHaveBeenLastCalledWith(TIER0.id, 1);

    toggle.click();
    frame();
    row().click();
    expect(sim.buyAgent).toHaveBeenLastCalledWith(TIER0.id, 10);

    toggle.click();
    frame();
    row().click();
    expect(sim.buyAgent).toHaveBeenLastCalledWith(TIER0.id, Infinity);
  });

  it('re-prices rows for the selected quantity', () => {
    const { root, frame } = mount(1e9);
    const cost = must(root, tid(TID.agentCost, TIER0.id));
    const one = cost.textContent;
    must(root, TID.buyQtyToggle).click();
    frame();
    expect(cost.textContent).not.toBe(one);
  });

  it('disables a row when ×10 is unaffordable even though ×1 is not', () => {
    const { root, sim, frame } = mount(TIER0.baseCost);
    const row = must(root, tid(TID.agentRow, TIER0.id)) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    must(root, TID.buyQtyToggle).click();
    frame();
    expect(row.disabled).toBe(true);
    row.click();
    expect(sim.buyAgent).not.toHaveBeenCalled();
  });

  it('treats MAX as affordable whenever at least one unit is', () => {
    const { root, frame } = mount(TIER0.baseCost);
    const toggle = must(root, TID.buyQtyToggle);
    toggle.click();
    toggle.click(); // MAX
    frame();
    const row = must(root, tid(TID.agentRow, TIER0.id)) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    expect(must(root, tid(TID.agentCost, TIER0.id)).textContent).toContain('(1)');
  });
});

describe('tabs and rows', () => {
  it('switches tab panels', () => {
    const { root } = mount(0);
    const agents = must(root, TID.agentList);
    const upgrades = must(root, TID.upgradeList);
    expect(agents.hasAttribute('hidden')).toBe(false);
    expect(upgrades.hasAttribute('hidden')).toBe(true);

    must(root, TID.tabUpgrades).click();
    expect(agents.hasAttribute('hidden')).toBe(true);
    expect(upgrades.hasAttribute('hidden')).toBe(false);
    expect(must(root, TID.tabUpgrades).getAttribute('aria-selected')).toBe('true');
  });

  it('adds rows when a tier becomes visible and drops upgrades once bought', () => {
    const { root, sim, frame } = mount(0);
    sim.setVisibleTiers(AGENT_TIERS.slice(0, 3));
    sim.setUpgrades(['mech_keyboard', 'prompt_caching']);
    frame();
    // Tier 4 is now rendered as a *locked preview* rather than being absent,
    // so the ladder reads ten deep from the first run. It must not be buyable.
    const preview = q(root, tid(TID.agentRow, AGENT_TIERS[3]!.id)) as HTMLButtonElement | null;
    expect(preview).not.toBeNull();
    expect(preview!.disabled).toBe(true);
    expect(preview!.classList.contains('tm-row--locked')).toBe(true);
    expect(q(root, tid(TID.upgradeRow, 'prompt_caching'))).not.toBeNull();

    sim.setVisibleTiers(AGENT_TIERS.slice(0, 4));
    sim.setUpgrades(['mech_keyboard']);
    frame();
    const unlocked = q(root, tid(TID.agentRow, AGENT_TIERS[3]!.id)) as HTMLButtonElement | null;
    expect(unlocked).not.toBeNull();
    expect(unlocked!.classList.contains('tm-row--locked')).toBe(false);
    expect(q(root, tid(TID.upgradeRow, 'prompt_caching'))).toBeNull();
  });

  it('reports owned count and per-tier rate', () => {
    const { root, sim, frame } = mount(0);
    sim.run.agents[TIER1.id] = 4;
    frame();
    expect(must(root, tid(TID.agentOwned, TIER1.id)).textContent).toBe('×4');
    expect(must(root, tid(TID.agentRow, TIER1.id)).textContent).toContain('/s');
  });
});

describe('ship-bar preview', () => {
  it('paints a ghost segment while an affordable row is focused', () => {
    const { root, sim, frame } = mount(TIER0.baseCost * 4);
    const bar = must(root, TID.shipBar);
    expect(bar.className).not.toContain('is-preview');

    must(root, tid(TID.agentRow, TIER0.id)).dispatchEvent(new Event('focus'));
    frame();
    expect(bar.className).toContain('is-preview');

    must(root, tid(TID.agentRow, TIER0.id)).dispatchEvent(new Event('blur'));
    frame();
    expect(bar.className).not.toContain('is-preview');
    expect(sim.derived).toHaveBeenCalled();
  });
});
