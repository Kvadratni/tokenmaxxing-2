/**
 * Dirty-tracking proof.
 *
 * `update()` runs 60 times a second. A frame where nothing changed must not
 * touch the DOM at all: no text, no attributes, no reordering. The whole
 * subtree is watched with a MutationObserver and must record nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DerivedStats, RunState, SummaryChoice } from '../../src/sim/types.ts';
import { TID, tid } from '../../src/testids.ts';
import type { UIScreen } from '../../src/ui/types.ts';
import { makeDerived, makeIncident, makeMeta, makeRun, makeUnlocked, mountUI, must, unmountAll } from './ui.fake-sim.ts';

let observer: MutationObserver | null = null;

afterEach(() => {
  observer?.disconnect();
  observer = null;
  unmountAll();
});

function rig(over: Partial<RunState> = {}, screen: UIScreen = 'run', derived: Partial<DerivedStats> = {}) {
  const m = mountUI({
    run: makeRun(over),
    meta: makeMeta({ runs: 2, thumbs: 9, levels: { helpful: 1 } }),
    screen,
    upgrades: ['streaming', 'prompt_caching', 'confident_tone'],
    unlocked: makeUnlocked(['compact']),
    derived: { canCompact: true, ...derived },
  });
  // Frozen inputs: the same objects, every frame.
  const run = m.sim.run;
  const d = makeDerived(run, m.derived);
  const frame = (): void => m.ui.update(run, d, m.sim.meta);
  const obs = new MutationObserver(() => undefined);
  obs.observe(m.root, { subtree: true, childList: true, attributes: true, characterData: true });
  observer = obs;
  return { ...m, run, frame, drain: () => obs.takeRecords() };
}

function describeRecords(records: MutationRecord[]): string {
  return records
    .slice(0, 8)
    .map((r) => {
      const target = r.target as Element;
      const testid = target.getAttribute?.('data-testid') ?? target.parentElement?.getAttribute('data-testid') ?? '';
      return `${r.type}@${target.nodeName}${testid ? `[${testid}]` : ''}${r.attributeName ? `.${r.attributeName}` : ''}`;
    })
    .join(', ');
}

function settle(r: ReturnType<typeof rig>): void {
  r.frame();
  r.frame();
  r.drain();
}

describe('dirty tracking', () => {
  it('writes nothing across 100 frames of an unchanged, busy run', () => {
    const r = rig(
      {
        tokens: 1234,
        context: 6_900,
        patienceMs: 61_500,
        techDebt: 1,
        pendingThumbs: 3,
        tools: { grep: 3, read: 1 } as never,
        cards: ['please', 'grandma'],
        incidents: [makeIncident('wait_stop'), makeIncident('continue', { clicksRemaining: 6 })],
      },
      'run',
      { contextFloor: 900, secondsToCompaction: 30, patienceFrozen: true },
    );
    settle(r);
    for (let i = 0; i < 100; i++) r.frame();
    const records = r.drain();
    expect(records, describeRecords(records)).toHaveLength(0);
  });

  for (const screen of ['title', 'meta', 'achievements'] as const) {
    it(`writes nothing across 100 frames on the ${screen} screen`, () => {
      const r = rig({}, screen);
      settle(r);
      for (let i = 0; i < 100; i++) r.frame();
      const records = r.drain();
      expect(records, describeRecords(records)).toHaveLength(0);
    });
  }

  it('writes nothing while the draft is open and unchanged', () => {
    const r = rig({ phase: 'drafting', draftOffer: ['please', 'thank_you', 'grandma'], draftRerollsLeft: 1 });
    settle(r);
    for (let i = 0; i < 100; i++) r.frame();
    expect(r.drain()).toHaveLength(0);
  });

  it('writes nothing while the summary picker is open and unchanged', () => {
    const summary: SummaryChoice = { offered: ['please', 'grandma', 'tip_200'], slots: 1, forced: true };
    const r = rig({ phase: 'compacting', cards: ['please', 'grandma', 'tip_200'], summary });
    settle(r);
    for (let i = 0; i < 100; i++) r.frame();
    expect(r.drain()).toHaveLength(0);
  });

  it('writes nothing while the run-over dialog is open and unchanged', () => {
    const r = rig({ phase: 'lost', reported: 4, pendingThumbs: 6 });
    settle(r);
    for (let i = 0; i < 100; i++) r.frame();
    expect(r.drain()).toHaveLength(0);
  });

  it('still writes when something actually changes', () => {
    const r = rig({ tokens: 100 });
    settle(r);
    const run = { ...r.run, tokens: 200, context: 3_000 };
    r.ui.update(run, makeDerived(run), r.sim.meta);
    expect(r.drain().length).toBeGreaterThan(0);
  });

  it('never rebuilds a shop row between frames', () => {
    const r = rig({ tokens: 1e6 });
    const before = must(r.root, tid(TID.toolRow, 'grep'));
    for (let i = 0; i < 50; i++) r.frame();
    expect(must(r.root, tid(TID.toolRow, 'grep'))).toBe(before);
  });
});
