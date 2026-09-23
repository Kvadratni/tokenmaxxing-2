/**
 * Smoke: the shell mounts and unmounts cleanly, renders every frozen testid,
 * never renders one twice where QA would trip over it, and has no game 1
 * vocabulary left in it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TID } from '../../src/testids.ts';
import { createUI } from '../../src/ui/index.ts';
import { makeFakeSim, makeIncident, makeRun, makeUnlocked, mountUI, q, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

/** Frozen ids that are prefixes for scoped ids, or only exist in a given state. */
const SCOPED: ReadonlySet<string> = new Set([
  TID.toolRow,
  TID.toolCost,
  TID.toolOwned,
  TID.toolFootprint,
  TID.upgradeRow,
  TID.draftCard,
  TID.summaryCard,
  TID.metaRow,
  TID.metaBuy,
  TID.activeCard,
  TID.achievementRow,
  TID.achievementPopupCard,
  TID.coachTip,
  TID.coachDismiss,
  // Only while something is on screen (each has its own test).
  TID.incidentName,
  TID.incidentTimer,
  TID.toast,
]);

describe('the shell', () => {
  it('renders every frozen testid', () => {
    const m = mountUI({
      run: makeRun({ incidents: [makeIncident('wait_stop')], cards: ['please'] }),
      unlocked: makeUnlocked(['compact']),
      upgrades: ['streaming'],
    });
    m.ui.toast('hello');
    const missing: string[] = [];
    // Cards exist only while their dialog is open; ui.draft, ui.summary and
    // ui.modals cover those.
    const openOnly = new Set<string>([TID.draftCard, TID.summaryCard, TID.achievementPopupCard]);
    for (const id of Object.values(TID)) {
      if (id === TID.app || openOnly.has(id)) continue; // app is stamped on the host's root
      const found = SCOPED.has(id)
        ? m.root.querySelector(`[data-testid="${id}"], [data-testid^="${id}-"]`)
        : q(m.root, id);
      if (found === null) missing.push(id);
    }
    expect(missing).toEqual([]);
    expect(m.root.getAttribute('data-testid')).toBe(TID.app);
  });

  it('never renders a unique control twice (strict locators would trip)', () => {
    const m = mountUI({ upgrades: ['streaming'] });
    const once = [
      TID.agent,
      TID.reportButton,
      TID.compactButton,
      TID.sycophancyButton,
      TID.startRun,
      TID.contextBar,
      TID.patienceBar,
      TID.tokens,
      TID.shop,
      TID.draftModal,
      TID.summaryModal,
      TID.runOverModal,
      TID.metaScreen,
      TID.titleScreen,
      TID.legacyNotice,
      TID.helpModal,
    ];
    for (const id of once) {
      expect(m.root.querySelectorAll(`[data-testid="${id}"]`).length, id).toBe(1);
    }
  });

  it('mounts on the title screen by default, with the run layer inert behind it', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ui = createUI({ root, sim: makeFakeSim() });
    expect(ui.screen).toBe('title');
    expect(root.querySelector('.tm-main')!.hasAttribute('inert')).toBe(true);
    ui.setScreen('run');
    expect(root.querySelector('.tm-main')!.hasAttribute('inert')).toBe(false);
    ui.destroy();
    expect(root.childElementCount).toBe(0);
    expect(root.hasAttribute('data-testid')).toBe(false);
    root.remove();
  });

  it('reports screen changes and keeps a host-stamped testid', () => {
    const root = document.createElement('div');
    root.setAttribute('data-testid', 'app');
    document.body.appendChild(root);
    const seen: string[] = [];
    const ui = createUI({ root, sim: makeFakeSim(), onAction: (a) => a.t === 'screen' && seen.push(a.screen) });
    ui.setScreen('meta');
    ui.setScreen('achievements');
    ui.setScreen('achievements');
    expect(seen).toEqual(['meta', 'achievements']);
    ui.destroy();
    expect(root.getAttribute('data-testid')).toBe('app');
    root.remove();
  });

  it('is inert after destroy', () => {
    const m = mountUI();
    m.ui.destroy();
    expect(() => m.frame()).not.toThrow();
    expect(() => m.ui.handle({ t: 'denied', reason: 'cost' })).not.toThrow();
  });

  it('has no game 1 vocabulary left in what it renders', () => {
    const m = mountUI({ upgrades: ['streaming', 'prompt_caching'] });
    for (const s of ['title', 'meta', 'achievements', 'run'] as const) m.ui.setScreen(s);
    (m.root.querySelector(`[data-testid="${TID.helpButton}"]`) as HTMLButtonElement).click();
    const words = (m.root.textContent ?? '').toLowerCase();
    for (const w of ['slop', 'laptop', 'demos', 'ship it', 'venture', 'agent tier']) {
      expect(words.includes(w), `"${w}" is still in the UI`).toBe(false);
    }
  });
});
