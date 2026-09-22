/**
 * Keyboard operation: hotkeys, focus rules and the scene activation path.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_TIERS } from '../../src/sim/content.ts';
import { TID } from '../../src/testids.ts';
import { createUI } from '../../src/ui/index.ts';
import type { UI, UIAction, UIScreen } from '../../src/ui/types.ts';
import type { RunState } from '../../src/sim/types.ts';
import { key, makeDerived, makeFakeSim, makeRun, must, type FakeSim } from './ui.fake-sim.ts';

let mounted: UI | null = null;
let host: HTMLElement | null = null;

interface Mounted {
  ui: UI;
  root: HTMLElement;
  sim: FakeSim;
  actions: UIAction[];
  frame: () => void;
}

function mount(over: Partial<RunState> = {}, screen: UIScreen = 'run'): Mounted {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sim = makeFakeSim({ run: makeRun({ slop: 1e9, ...over }) });
  const actions: UIAction[] = [];
  const ui = createUI({ root, sim, screen, now: () => 0, onAction: (a) => actions.push(a) });
  mounted = ui;
  host = root;
  const frame = (): void => ui.update(sim.run, makeDerived(sim.run), sim.meta);
  frame();
  return { ui, root, sim, actions, frame };
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

describe('hotkeys', () => {
  it('S ships', () => {
    const { sim } = mount();
    key(window, 's');
    expect(sim.ship).toHaveBeenCalledTimes(1);
    key(window, 'S');
    expect(sim.ship).toHaveBeenCalledTimes(2);
  });

  it('digits buy the matching visible tier', () => {
    const { sim } = mount();
    key(window, '1');
    expect(sim.buyAgent).toHaveBeenLastCalledWith(AGENT_TIERS[0]!.id, 1);
    key(window, '3');
    expect(sim.buyAgent).toHaveBeenLastCalledWith(AGENT_TIERS[2]!.id, 1);
    // only three tiers are visible by default; the 4th slot is a no-op
    sim.buyAgent.mockClear();
    key(window, '4');
    expect(sim.buyAgent).not.toHaveBeenCalled();
  });

  it('the buy-quantity toggle cycles on click and applies to the next purchase', () => {
    // There is no `Q` hotkey any more — the toggle is a button you press.
    const { root, sim } = mount();
    const toggle = must(root, TID.buyQtyToggle);
    toggle.click();
    expect(toggle.textContent).toBe('×10');
    key(window, '1');
    expect(sim.buyAgent).toHaveBeenLastCalledWith(AGENT_TIERS[0]!.id, 10);
    toggle.click();
    expect(toggle.textContent).toBe('MAX');
    key(window, '1');
    expect(sim.buyAgent).toHaveBeenLastCalledWith(AGENT_TIERS[0]!.id, Infinity);
  });

  it('does not fire while a text input has focus', () => {
    const { sim } = mount();
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    key(input, 's');
    key(input, '1');
    expect(sim.ship).not.toHaveBeenCalled();
    expect(sim.buyAgent).not.toHaveBeenCalled();
    input.remove();
  });

  it('does not fire while a range slider in options has focus', () => {
    const { root, sim } = mount();
    must(root, TID.optionsButton).click();
    const slider = must(root, 'music-volume');
    slider.focus();
    key(slider, 's');
    expect(sim.ship).not.toHaveBeenCalled();
  });

  it('ignores modified keystrokes', () => {
    const { sim } = mount();
    key(window, 's', { metaKey: true });
    key(window, 's', { ctrlKey: true });
    key(window, '1', { altKey: true });
    expect(sim.ship).not.toHaveBeenCalled();
    expect(sim.buyAgent).not.toHaveBeenCalled();
  });

  it('is inert outside the run screen', () => {
    const { sim } = mount({}, 'title');
    key(window, 's');
    key(window, '1');
    expect(sim.ship).not.toHaveBeenCalled();
    expect(sim.buyAgent).not.toHaveBeenCalled();
  });

  it('is inert while a modal owns the keyboard', () => {
    const { sim, frame } = mount({ phase: 'drafting', draftOffer: ['sonnet'] });
    frame();
    key(window, 's');
    expect(sim.ship).not.toHaveBeenCalled();
  });

  it('ignores auto-repeat', () => {
    const { sim } = mount();
    key(window, 's', { repeat: true });
    expect(sim.ship).not.toHaveBeenCalled();
  });
});

describe('scene activation', () => {
  it('Space on the focused scene reports a canvasKey action', () => {
    const { root, actions } = mount();
    const hit = must(root, TID.laptop);
    hit.focus();
    const e = key(hit, ' ');
    expect(e.defaultPrevented).toBe(true);
    expect(actions.filter((a) => a.t === 'canvasKey')).toHaveLength(1);
  });

  it('Enter works too', () => {
    const { root, actions } = mount();
    const hit = must(root, TID.laptop);
    key(hit, 'Enter');
    expect(actions.filter((a) => a.t === 'canvasKey')).toHaveLength(1);
  });

  it('pointerdown reports client coordinates for the host to convert', () => {
    const { root, actions } = mount();
    const hit = must(root, TID.laptop);
    hit.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 42, clientY: 17 }),
    );
    const hits = actions.filter((a) => a.t === 'canvasPointer');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ clientX: 42, clientY: 17 });
  });

  it('the scene hit area is a real button with an accessible name', () => {
    const { root } = mount();
    const hit = must(root, TID.laptop);
    expect(hit.tagName).toBe('BUTTON');
    expect(hit.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('ship button', () => {
  it('is disabled until canShip and calls sim.ship when pressed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const sim = makeFakeSim({ run: makeRun({ slop: 0 }) });
    const ui = createUI({ root, sim, screen: 'run', now: () => 0 });
    mounted = ui;
    host = root;

    ui.update(sim.run, makeDerived(sim.run), sim.meta);
    const btn = must(root, TID.shipButton) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(sim.ship).not.toHaveBeenCalled();

    sim.run.slop = 1e6;
    ui.update(sim.run, makeDerived(sim.run), sim.meta);
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(sim.ship).toHaveBeenCalledTimes(1);
  });
});
