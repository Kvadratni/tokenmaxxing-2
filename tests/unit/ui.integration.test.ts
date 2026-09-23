/**
 * The UI against the real sim, wired the way src/main.ts should wire it:
 * `applySimAction` for the sim-bound actions, a stand-in for the renderer's
 * coordinate maths for the stage ones, and the sim's events fed back in.
 *
 * Everything else in tests/unit/ui.* runs against the double in
 * ui.fake-sim.ts; this file is the proof the double did not lie.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/sim/index.ts';
import { TID, tid } from '../../src/testids.ts';
import { applySimAction } from '../../src/ui/actions.ts';
import { createUI } from '../../src/ui/index.ts';
import type { UI } from '../../src/ui/types.ts';
import { key, must, text, tourStorage } from './ui.fake-sim.ts';

let ui: UI | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  ui?.destroy();
  ui = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

function boot(
  { tour = false }: { tour?: boolean } = {},
): { sim: Sim; ui: UI; root: HTMLElement; frame: () => void; step: (ms: number) => void } {
  const sim = createSim({ storage: null, seed: 7, autoStart: true, trustSave: true });
  const root = document.createElement('div');
  document.body.appendChild(root);
  host = root;
  const u = createUI({
    root,
    sim,
    screen: 'title',
    // A returning browser unless asked: the first-run tour has its own test below.
    storage: tourStorage(!tour),
    onAction: (a) => {
      if (applySimAction(sim, a)) return;
      // The renderer's job in the real host: every stage click lands on the agent.
      if (a.t === 'canvasPointer' || a.t === 'canvasKey') sim.click(160, 120);
    },
  });
  ui = u;
  sim.subscribe((e) => u.handle(e));
  const frame = (): void => u.update(sim.run, sim.derived(), sim.meta);
  // The host's frame loop: no ticks while the UI holds the clock (src/main.ts).
  const step = (ms: number): void => {
    for (let t = 0; t < ms; t += 100) if (!u.holdsClock) sim.tick(100);
    frame();
  };
  frame();
  return { sim, ui: u, root, frame, step };
}

describe('the UI on the real sim', () => {
  it('starts a session, generates, buys and reports', () => {
    const { sim, root, frame } = boot();
    (must(root, TID.startRun) as HTMLButtonElement).click();
    frame();
    expect(sim.run.phase).toBe('running');

    for (let i = 0; i < 20; i++) key(window, ' ');
    frame();
    expect(sim.run.clicks).toBe(20);
    expect(sim.run.tokens).toBeGreaterThan(0);
    expect(text(root, TID.tokens)).not.toBe('0');

    sim.debug.grantTokens(1_000);
    frame();
    (must(root, tid(TID.toolRow, 'grep')) as HTMLButtonElement).click();
    frame();
    expect(sim.run.tools.grep).toBe(1);
    expect(text(root, tid(TID.toolOwned, 'grep'))).toBe('×1');

    // Enough to report the first prompt.
    frame();
    const report = must(root, TID.reportButton) as HTMLButtonElement;
    expect(report.getAttribute('data-state')).toBe('report');
    key(window, 's');
    expect(sim.run.reported).toBe(1);
  });

  it('drafts through the two-step pick', () => {
    const { sim, root, frame, step } = boot();
    (must(root, TID.startRun) as HTMLButtonElement).click();
    sim.debug.grantTokens(1_000);
    frame();
    key(window, 's');
    step(3_000);
    expect(sim.run.phase).toBe('drafting');
    const first = sim.run.draftOffer[0]!;
    (must(root, tid(TID.draftCard, first)) as HTMLButtonElement).click();
    (must(root, TID.draftConfirm) as HTMLButtonElement).click();
    frame();
    expect(sim.run.cards).toContain(first);
    expect(sim.run.phase).toBe('running');
    expect(must(root, TID.draftModal).hidden).toBe(true);
  });

  it('says it when told to, and the power fades', () => {
    const { sim, root, frame } = boot();
    (must(root, TID.startRun) as HTMLButtonElement).click();
    frame();
    const before = sim.derived().sycophancyPower;
    key(window, 'y');
    frame();
    expect(sim.run.sycophancy).toBe(1);
    expect(sim.derived().sycophancyPower).toBeLessThan(before);
    const fade = Number(must(root, TID.sycophancyButton).style.getPropertyValue('--syc'));
    expect(fade).toBeLessThan(1);
  });

  it('opens the first session on the tour: the clock is held, and its clicks are real ones', () => {
    const { sim, ui: u, root, frame, step } = boot({ tour: true });
    (must(root, TID.startRun) as HTMLButtonElement).click();
    frame();
    expect(u.holdsClock).toBe(true);
    const patience = sim.run.patienceMs;
    step(5_000);
    expect(sim.run.patienceMs, 'the human waits while the player reads').toBe(patience);
    expect(sim.run.elapsedMs).toBe(0);

    (must(root, TID.tourNext) as HTMLButtonElement).click();
    expect(root.querySelector(`[data-testid="${tid(TID.tourStep, 'agent')}"]`)).not.toBeNull();
    const agent = must(root, TID.agent);
    for (let i = 0; i < 2; i++) {
      agent.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    }
    key(document.activeElement ?? window, ' ');
    frame();
    // Three clicks the sim took with time frozen: tokens, and context with them.
    expect(sim.run.clicks).toBe(3);
    expect(sim.run.tokens).toBeGreaterThan(0);
    expect(sim.run.context).toBeGreaterThan(0);
    expect(text(root, tid(TID.tourStep, 'agent'))).toContain('3/3');

    key(document.activeElement ?? window, 'Escape');
    expect(u.holdsClock).toBe(false);
    step(1_000);
    expect(sim.run.patienceMs).toBeLessThan(patience);
  });

  it('runs out of patience into THE HUMAN SWITCHED MODELS, then Training', () => {
    const { sim, root, frame, step } = boot();
    (must(root, TID.startRun) as HTMLButtonElement).click();
    frame();
    sim.debug.setPatience(0);
    step(500);
    expect(sim.run.phase).toBe('lost');
    expect(text(root, TID.runOverTitle)).toBe('THE HUMAN SWITCHED MODELS');
    expect(text(root, TID.runOverVersion)).toMatch(/^Releasing Tokenmaxxing /);
    (must(root, TID.runOverContinue) as HTMLButtonElement).click();
    frame();
    expect(must(root, TID.metaScreen).hidden).toBe(false);
  });
});
