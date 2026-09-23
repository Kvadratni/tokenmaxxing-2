/**
 * Keyboard: Space generates, 1-9 buy tools, S reports or claims, Y is
 * sycophancy, C compacts, Esc closes. Never while typing, never with a
 * modifier, never while a dialog owns the keyboard.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TID, tid } from '../../src/testids.ts';
import { HOTKEY_HINTS } from '../../src/ui/hotkeys.ts';
import { key, makeRun, makeUnlocked, mountUI, must, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

const toasts = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll(`[data-testid="${TID.toast}"]`), (n) => n.textContent ?? '');

describe('Space generates', () => {
  it('clicks the agent from anywhere on the run screen', () => {
    const m = mountUI();
    key(window, ' ');
    expect(m.sent('canvasKey')).toHaveLength(1);
  });

  it('does not also press whatever button has focus', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e9 }) });
    const row = must(m.root, tid(TID.toolRow, 'grep'));
    row.focus();
    const e = key(row, ' ');
    expect(e.defaultPrevented).toBe(true);
    expect(m.sent('canvasKey')).toHaveLength(1);
  });

  it('does not autoclick when held', () => {
    const m = mountUI();
    key(window, ' ', { repeat: true });
    expect(m.sent('canvasKey')).toHaveLength(0);
  });

  it('does nothing outside a running prompt', () => {
    const m = mountUI({ run: makeRun({ phase: 'reported' }) });
    key(window, ' ');
    expect(m.sent('canvasKey')).toHaveLength(0);
  });
});

describe('the letter keys', () => {
  it('1-9 buy the Nth visible tool at the current quantity', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e12 }) });
    key(window, '1');
    key(window, '3');
    must(m.root, TID.buyQtyToggle).click();
    m.frame();
    key(window, '2');
    expect(m.sent('buyTool')).toEqual([
      { t: 'buyTool', id: 'grep', count: 1 },
      { t: 'buyTool', id: 'edit', count: 1 },
      { t: 'buyTool', id: 'read', count: 10 },
    ]);
  });

  it('a digit past the list, or for a tool the wallet cannot cover, buys nothing', () => {
    const m = mountUI({ run: makeRun({ tokens: 0 }) });
    key(window, '9');
    key(window, '1');
    expect(m.sent('buyTool')).toHaveLength(0);
    expect(toasts(m.root)).toContain('Not enough tokens');
  });

  it('S reports when the button says REPORT DONE and claims when it says CLAIM DONE', () => {
    const m = mountUI({ run: makeRun({ tokens: 100 }) });
    key(window, 's');
    expect(m.sent('report')).toHaveLength(1);
    m.sim.run.tokens = 60;
    m.frame();
    key(window, 'S');
    expect(m.sent('claim')).toHaveLength(1);
    expect(m.sent('report')).toHaveLength(1);
  });

  it('S explains itself while there is nothing to report', () => {
    const m = mountUI({ run: makeRun({ tokens: 0 }) });
    key(window, 's');
    expect(m.actions.filter((a) => a.t === 'report' || a.t === 'claim')).toHaveLength(0);
    expect(toasts(m.root).join()).toContain('claim unlocks at 50%');
    m.sim.run.tokens = 100;
    m.derived = { reportState: 'blocked', reportBlockedBy: 'Merge Conflict' };
    m.frame();
    key(window, 's');
    expect(toasts(m.root).join()).toContain('Blocked: Merge Conflict');
  });

  it("Y says you're absolutely right", () => {
    const m = mountUI();
    key(window, 'y');
    expect(m.sent('absolutelyRight')).toHaveLength(1);
  });

  it('C compacts only once /compact is usable', () => {
    const m = mountUI();
    key(window, 'c');
    expect(m.sent('compact')).toHaveLength(0);
    m.sim.setUnlocked(makeUnlocked(['compact']));
    m.derived = { canCompact: true };
    m.frame();
    key(window, 'c');
    expect(m.sent('compact')).toHaveLength(1);
    // Mid-pause: nothing.
    m.sim.run.compactingMs = 1_000;
    m.frame();
    key(window, 'c');
    expect(m.sent('compact')).toHaveLength(1);
  });
});

describe('when the keys stand down', () => {
  it('ignores modifiers, key repeats and text fields', () => {
    const m = mountUI({ run: makeRun({ tokens: 100 }) });
    key(window, 's', { ctrlKey: true });
    key(window, 's', { metaKey: true });
    key(window, 'y', { repeat: true });
    const input = document.createElement('input');
    m.root.appendChild(input);
    key(input, 's');
    key(input, ' ');
    expect(m.actions.filter((a) => ['report', 'absolutelyRight', 'canvasKey'].includes(a.t))).toHaveLength(0);
  });

  it('is silent off the run screen', () => {
    const m = mountUI({ screen: 'title', run: makeRun({ tokens: 100 }) });
    key(window, 's');
    key(window, ' ');
    key(window, '1');
    expect(m.actions.filter((a) => ['report', 'canvasKey', 'buyTool'].includes(a.t))).toHaveLength(0);
  });

  it('is silent while a dialog is up', () => {
    const m = mountUI({ run: makeRun({ tokens: 100 }) });
    (must(m.root, TID.optionsButton) as HTMLButtonElement).click();
    key(window, 's');
    key(window, ' ');
    expect(m.actions.filter((a) => ['report', 'canvasKey'].includes(a.t))).toHaveLength(0);
  });

  it('Escape closes the topmost dialog first, then leaves Training', () => {
    const m = mountUI();
    (must(m.root, TID.helpButton) as HTMLButtonElement).click();
    expect(must(m.root, TID.helpModal).hidden).toBe(false);
    key(document.activeElement ?? window, 'Escape');
    expect(must(m.root, TID.helpModal).hidden).toBe(true);
    m.ui.setScreen('meta');
    key(window, 'Escape');
    expect(m.ui.screen).toBe('title');
  });

  it('lists the run keys in the topbar legend', () => {
    expect(HOTKEY_HINTS.map((h) => h.keys)).toEqual(['Space', '1-9', 'S', 'Y', 'C']);
  });
});
