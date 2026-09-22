/**
 * HUD behaviour: wallet roll-up, ship bar, CI deadline burndown, incident
 * stack and the active-card strip.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { projectDeadlineMs, projectRequirement } from '../../src/sim/content.ts';
import type { RunState } from '../../src/sim/types.ts';
import { TID } from '../../src/testids.ts';
import { fmtBarCost, fmtNum, fmtTime } from '../../src/ui/format.ts';
import { createUI } from '../../src/ui/index.ts';
import { RollUp } from '../../src/ui/rollup.ts';
import {
  computeScale,
  DRAWER_MAX_VH,
  MIN_SCALE,
  UNITS_H_STACKED,
  UNITS_H_STACKED_DRAWER,
  UNITS_W_STACKED,
} from '../../src/ui/scale.ts';
import type { UI } from '../../src/ui/types.ts';
import {
  all,
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
let clock = 0;

interface Mounted {
  ui: UI;
  root: HTMLElement;
  sim: FakeSim;
  frame: () => void;
}

function mount(over: Partial<RunState> = {}): Mounted {
  clock = 0;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sim = makeFakeSim({ run: makeRun(over) });
  const ui = createUI({ root, sim, screen: 'run', now: () => clock });
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

describe('formatting', () => {
  it('compacts big numbers without locale drift', () => {
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(947)).toBe('947');
    expect(fmtNum(1000)).toBe('1.00k');
    expect(fmtNum(1_240)).toBe('1.24k');
    expect(fmtNum(88_100_000)).toBe('88.1M');
    expect(fmtNum(4.6e8)).toBe('460M');
    expect(fmtNum(Infinity)).toBe('∞');
  });

  it('caps the ship-bar cost hint instead of printing -771%', () => {
    expect(fmtBarCost(0.18)).toBe('18%');
    expect(fmtBarCost(0.0004)).toBe('<1%');
    expect(fmtBarCost(1)).toBe('100%+');
    expect(fmtBarCost(7.71)).toBe('100%+');
    expect(fmtBarCost(Infinity)).toBe('∞');
  });

  it('keeps the deadline readout a fixed width', () => {
    expect(fmtTime(120_000)).toBe('02:00.0');
    expect(fmtTime(7_400)).toBe('00:07.4');
    expect(fmtTime(0)).toBe('00:00.0');
    expect(fmtTime(-5)).toBe('00:00.0');
    expect(fmtTime(120_000)).toHaveLength(fmtTime(7_400).length);
  });
});

describe('roll-up', () => {
  it('snaps on the first observation and converges exactly', () => {
    const r = new RollUp(250);
    expect(r.step(500, 0)).toBe(500);
    // Same instant: no time has passed, so nothing moves.
    expect(r.step(1500, 0)).toBe(500);
    // Part-way through the window it is between the two, not at either end.
    const mid = r.step(1500, 60);
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(1500);
    // A full window later it has landed exactly, so the DOM stops being written.
    expect(r.step(1500, 400)).toBe(1500);
  });

  it('follows a target that moves every single frame', () => {
    // The wallet's target is not a series of discrete jumps: one agent owned and
    // idle income moves it on every frame. A from/to tween that restarts its
    // clock on each change never advances at all under that load — the display
    // froze on whatever it happened to be showing when income started.
    const r = new RollUp(250);
    r.step(0, 0);
    let target = 0;
    for (let f = 1; f <= 120; f++) {
      target += 10; // 10 slop per frame, forever
      r.step(target, f * 16);
    }
    expect(r.value, 'the display froze instead of tracking').toBeGreaterThan(target * 0.8);
    expect(r.value, 'the display ran ahead of the truth').toBeLessThanOrEqual(target);
  });
});

describe('scale', () => {
  it('picks integer steps that fit the viewport', () => {
    const inline = { shop: 'inline' } as const;
    expect(computeScale(1920, 1080)).toEqual({ px: 4, layout: 'wide', ...inline });
    expect(computeScale(1440, 900)).toEqual({ px: 3, layout: 'wide', ...inline });
    expect(computeScale(1280, 800)).toEqual({ px: 3, layout: 'wide', ...inline });
    expect(computeScale(900, 600)).toEqual({ px: 2, layout: 'wide', ...inline });
    expect(computeScale(375, 667)).toEqual({ px: 1, layout: 'stacked', ...inline });
    expect(computeScale(768, 1024).layout).toBe('stacked');
    expect(computeScale(200, 200).px).toBe(1);
  });

  it('keeps the shop in the flow on a portrait phone for free', () => {
    /*
     * The in-flow shop costs 420 units of height against the drawer's 268, but
     * every portrait phone is *width*-bound — the width term is the smaller of
     * the two either way — so putting the shop back below the stage takes nothing
     * off the scale. Asserted so a future re-tune of the height budget cannot
     * quietly start costing portrait its scale.
     */
    for (const [vw, vh] of [
      [375, 667],
      [390, 844],
      [430, 932],
      [412, 915],
      [360, 740],
      [320, 568],
    ] as const) {
      const got = computeScale(vw, vh, 2);
      expect(got.shop, `${vw}x${vh} has the height for an in-flow shop`).toBe('inline');
      expect(got.layout).toBe('stacked');
      expect(got.px).toBeGreaterThanOrEqual(MIN_SCALE);

      // The fit itself, computed both ways. Equal fits mean an equal `--px`
      // whatever rounding is applied on top, which is the whole claim.
      const byWidth = (vw - 12) / UNITS_W_STACKED;
      const inFlow = Math.min(byWidth, (vh - 12) / UNITS_H_STACKED);
      const asDrawer = Math.min(byWidth, (vh - 12) / UNITS_H_STACKED_DRAWER);
      expect(inFlow, `${vw}x${vh} must be width-bound, not height-bound`).toBeCloseTo(byWidth, 10);
      expect(
        inFlow,
        `${vw}x${vh} would gain scale from a drawer, so the shop is not free in the flow`,
      ).toBeCloseTo(asDrawer, 10);
    }
  });

  it('drops the shop into a drawer once the viewport is too short for it', () => {
    // A landscape phone: `stacked` at the drawer's 268-unit height budget, which
    // is the only layout that makes sense once the rail is gone.
    expect(computeScale(844, 390, 2)).toEqual({
      px: (390 - 12) / UNITS_H_STACKED_DRAWER,
      layout: 'stacked',
      shop: 'drawer',
    });
    expect(computeScale(932, 430, 2).shop).toBe('drawer');
    // The boundary itself, so the threshold cannot drift unnoticed.
    expect(computeScale(1440, DRAWER_MAX_VH).shop).toBe('inline');
    expect(computeScale(1440, DRAWER_MAX_VH - 1).shop).toBe('drawer');
  });
});

describe('wallet + bars', () => {
  it('renders slop, rate, click power and the requirement', () => {
    const { root, sim, frame } = mount({ slop: 250 });
    sim.run.agents.tab_autocomplete = 5;
    frame();
    expect(must(root, TID.slop).textContent).toBe('250');
    // Rate reads "12.3 MSLOPS" — the trailing S is the per-second, so there
    // is deliberately no "/s" suffix any more.
    expect(must(root, TID.slopRate).textContent).toMatch(/SLOPS$/);
    expect(must(root, TID.clickPower).textContent).toBe('+1/click');
    expect(must(root, TID.requirement).textContent).toBe(`250 / ${fmtNum(projectRequirement(0))}`);
    expect(must(root, TID.projectNum).textContent).toBe('PROJECT 1/10');
    expect(must(root, TID.projectName).textContent).toBe('Todo App');
  });

  it('rolls the wallet up instead of snapping, and catches up inside the window', () => {
    const { root, sim, frame } = mount({ slop: 0 });
    expect(must(root, TID.slop).textContent).toBe('0');
    sim.run.slop = 900;

    clock = 60;
    frame();
    const mid = must(root, TID.slop).textContent ?? '';
    expect(Number(mid), 'snapped straight to the target').toBeLessThan(900);
    expect(Number(mid), 'did not move at all').toBeGreaterThan(0);

    clock = 400;
    frame();
    expect(must(root, TID.slop).textContent).toBe('900');
  });

  it('fills the ship bar and marks it ready at the requirement', () => {
    // Half the requirement, read from content so a balance retune cannot
    // silently invalidate the assertion.
    const half = projectRequirement(0) / 2;
    const { root, sim, frame } = mount({ slop: half });
    const bar = must(root, TID.shipBar);
    const fill = must(root, TID.shipBarFill);
    expect(fill.style.width).toBe('50.0%');
    expect(bar.className).not.toContain('is-ready');
    expect((must(root, TID.shipButton) as HTMLButtonElement).disabled).toBe(true);

    sim.run.slop = projectRequirement(0);
    clock = 999;
    frame();
    expect(fill.style.width).toBe('100.0%');
    expect(bar.className).toContain('is-ready');
    expect((must(root, TID.shipButton) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ramps the deadline bar green -> amber -> red and flashes under 10s', () => {
    const total = projectDeadlineMs(0);
    const { root, sim, frame } = mount({ timeLeftMs: total });
    const bar = must(root, TID.deadlineBar);
    expect(bar.className).not.toContain('is-warn');
    expect(bar.className).not.toContain('is-crit');
    expect(must(root, TID.deadlineText).textContent).toBe(fmtTime(total));

    sim.run.timeLeftMs = total * 0.4;
    frame();
    expect(bar.className).toContain('is-warn');
    expect(bar.className).not.toContain('is-crit');

    sim.run.timeLeftMs = total * 0.1;
    frame();
    expect(bar.className).toContain('is-crit');

    sim.run.timeLeftMs = 8_000;
    frame();
    expect(bar.className).toContain('is-flash');
    expect(must(root, TID.deadlineFill).style.width).toBe('6.7%');
  });

  it('shows the running demo tally labelled as banked at run end', () => {
    const { root, sim, frame } = mount({ pendingDemos: 4 });
    const tally = must(root, TID.demoTally);
    expect(tally.textContent).toContain('4');
    expect((tally.textContent ?? '').toLowerCase()).toContain('banked at run end');
    sim.run.pendingDemos = 9;
    frame();
    expect(tally.textContent).toContain('9');
  });
});

describe('incident banner', () => {
  it('is hidden with no incidents', () => {
    const { root } = mount();
    expect(isHidden(q(root, TID.incidentBanner))).toBe(true);
  });

  it('renders one entry per active incident with the right tone', () => {
    const { root } = mount({
      incidents: [makeIncident('rate_limited'), makeIncident('viral_tweet')],
    });
    expect(isHidden(q(root, TID.incidentBanner))).toBe(false);
    const names = all(root, TID.incidentName).map((n) => n.textContent);
    expect(names).toEqual(['Rate Limited', 'Viral Launch Tweet']);
    expect(all(root, TID.incidentTimer)).toHaveLength(2);

    const rows = must(root, TID.incidentBanner).children;
    expect(rows[0]!.className).not.toContain('tm-incident--good');
    expect(rows[1]!.className).toContain('tm-incident--good');
  });

  it('counts the timer down and clears the row when it ends', () => {
    const { root, sim, frame } = mount({
      incidents: [makeIncident('rate_limited', { remainingMs: 8_000 })],
    });
    expect(all(root, TID.incidentTimer)[0]!.textContent).toBe('8.0s');
    sim.run.incidents[0]!.remainingMs = 3_200;
    frame();
    expect(all(root, TID.incidentTimer)[0]!.textContent).toBe('3.2s');

    sim.run.incidents = [];
    frame();
    expect(isHidden(q(root, TID.incidentBanner))).toBe(true);
    expect(all(root, TID.incidentName)).toHaveLength(0);
  });

  it('ticks the click-to-fix counter down live', () => {
    const { root, sim, frame } = mount({
      incidents: [makeIncident('hallucinated_dep', { clicksRemaining: 10 })],
    });
    const banner = must(root, TID.incidentBanner);
    expect(banner.textContent).toContain('click ×10 to fix');

    sim.run.incidents[0]!.clicksRemaining = 4;
    frame();
    expect(banner.textContent).toContain('click ×4 to fix');
    expect(banner.textContent).not.toContain('×10');

    sim.run.incidents[0]!.clicksRemaining = 0;
    frame();
    expect(banner.textContent).not.toContain('to fix');
  });

  it('stacks and unstacks as incidents come and go', () => {
    const { root, sim, frame } = mount({ incidents: [makeIncident('rate_limited')] });
    expect(all(root, TID.incidentName)).toHaveLength(1);
    sim.run.incidents = [makeIncident('rate_limited'), makeIncident('flaky_tests')];
    frame();
    expect(all(root, TID.incidentName)).toHaveLength(2);
    sim.run.incidents = [makeIncident('flaky_tests')];
    frame();
    expect(all(root, TID.incidentName).map((n) => n.textContent)).toEqual(['Flaky Tests']);
  });
});

describe('active cards strip', () => {
  it('adds a chip per drafted card carrying its effect text', () => {
    const { root, sim, frame } = mount();
    expect(must(root, TID.activeCards).childElementCount).toBe(0);
    sim.run.cards = ['sonnet', 'opus'];
    frame();
    const strip = must(root, TID.activeCards);
    expect(strip.childElementCount).toBe(2);
    const chip = strip.querySelector('button');
    expect(chip?.getAttribute('aria-label')).toContain('The reasonable one');
    expect(strip.textContent).toContain('Agents produce ×3');
  });
});
