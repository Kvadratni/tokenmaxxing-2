/**
 * The action contract: every `UIAction` is either sim-bound (and
 * `applySimAction` makes exactly one sim call for it) or host-side.
 */
import { describe, expect, it, vi } from 'vitest';
import { applySimAction, HOST_ACTIONS, SIM_ACTIONS, type SimActionTarget } from '../../src/ui/actions.ts';
import type { UIAction, UIActionType } from '../../src/ui/types.ts';

function target() {
  return {
    buyTool: vi.fn(() => true),
    buyUpgrade: vi.fn(() => true),
    report: vi.fn(() => true),
    claim: vi.fn(() => 'passed' as const),
    compact: vi.fn(() => true),
    absolutelyRight: vi.fn(() => true),
    keepCards: vi.fn(() => true),
    pickCard: vi.fn(() => true),
    rerollDraft: vi.fn(() => true),
    buyMeta: vi.fn(() => true),
    startRun: vi.fn(() => undefined),
    setSettings: vi.fn(() => undefined),
  } satisfies SimActionTarget;
}

/** One of every action, so a new member of the union has to be added here. */
const EVERY: Record<UIActionType, UIAction> = {
  buyTool: { t: 'buyTool', id: 'grep', count: 10 },
  buyUpgrade: { t: 'buyUpgrade', id: 'streaming' },
  report: { t: 'report' },
  claim: { t: 'claim' },
  compact: { t: 'compact' },
  absolutelyRight: { t: 'absolutelyRight' },
  keepCards: { t: 'keepCards', ids: ['please'] },
  pickCard: { t: 'pickCard', id: 'please' },
  reroll: { t: 'reroll' },
  buyMeta: { t: 'buyMeta', id: 'helpful' },
  startRun: { t: 'startRun' },
  settings: { t: 'settings', patch: { reducedMotion: true } },
  canvasPointer: { t: 'canvasPointer', clientX: 1, clientY: 2 },
  canvasKey: { t: 'canvasKey' },
  resetSave: { t: 'resetSave' },
  screen: { t: 'screen', screen: 'meta' },
  scale: { t: 'scale', px: 3 },
  uiHover: { t: 'uiHover' },
};

describe('applySimAction', () => {
  it('splits every action into sim-bound or host-side, with no overlap', () => {
    for (const t of Object.keys(EVERY) as UIActionType[]) {
      expect(SIM_ACTIONS.has(t) !== HOST_ACTIONS.has(t), t).toBe(true);
    }
    expect(SIM_ACTIONS.size + HOST_ACTIONS.size).toBe(Object.keys(EVERY).length);
  });

  it('makes exactly one sim call for each sim-bound action, with its arguments', () => {
    const cases: Array<[UIActionType, keyof SimActionTarget, unknown[]]> = [
      ['buyTool', 'buyTool', ['grep', 10]],
      ['buyUpgrade', 'buyUpgrade', ['streaming']],
      ['report', 'report', []],
      ['claim', 'claim', []],
      ['compact', 'compact', []],
      ['absolutelyRight', 'absolutelyRight', []],
      ['keepCards', 'keepCards', [['please']]],
      ['pickCard', 'pickCard', ['please']],
      ['reroll', 'rerollDraft', []],
      ['buyMeta', 'buyMeta', ['helpful']],
      ['startRun', 'startRun', []],
      ['settings', 'setSettings', [{ reducedMotion: true }]],
    ];
    for (const [t, method, args] of cases) {
      const sim = target();
      expect(applySimAction(sim, EVERY[t]), t).toBe(true);
      expect(sim[method], t).toHaveBeenCalledTimes(1);
      expect(sim[method], t).toHaveBeenCalledWith(...args);
      const calls = Object.values(sim).reduce((n, f) => n + f.mock.calls.length, 0);
      expect(calls, `${t} made more than one call`).toBe(1);
    }
  });

  it('leaves the host-side actions alone', () => {
    for (const t of HOST_ACTIONS) {
      const sim = target();
      expect(applySimAction(sim, EVERY[t]), t).toBe(false);
      expect(Object.values(sim).every((f) => f.mock.calls.length === 0)).toBe(true);
    }
  });
});
