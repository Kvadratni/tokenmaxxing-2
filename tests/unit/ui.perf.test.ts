/**
 * Dirty-tracking proof.
 *
 * `update()` runs 60 times a second. A frame where nothing changed must not
 * touch the DOM at all — no text nodes, no attributes, no reordering. We watch
 * the whole subtree with a MutationObserver and assert zero records.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DerivedStats, MetaState, RunState } from '../../src/sim/types.ts';
import { TID, tid } from '../../src/testids.ts';
import { createUI } from '../../src/ui/index.ts';
import type { UI, UIScreen } from '../../src/ui/types.ts';
import {
  makeDerived,
  makeFakeSim,
  makeIncident,
  makeRun,
  must,
  type FakeSim,
} from './ui.fake-sim.ts';

let mounted: UI | null = null;
let host: HTMLElement | null = null;
let observer: MutationObserver | null = null;

interface Rig {
  ui: UI;
  root: HTMLElement;
  sim: FakeSim;
  run: RunState;
  derived: DerivedStats;
  meta: MetaState;
  frame: () => void;
  /** Mutation records since the last call. */
  drain: () => MutationRecord[];
}

function rig(over: Partial<RunState> = {}, screen: UIScreen = 'run'): Rig {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sim = makeFakeSim({ run: makeRun(over) });
  sim.setUpgrades(['mech_keyboard', 'prompt_caching', 'yolo_mode']);
  const ui = createUI({ root, sim, screen, now: () => 1000 });
  mounted = ui;
  host = root;

  // Frozen state objects: identical input every frame.
  const run = sim.run;
  const derived = makeDerived(run);
  const meta = sim.meta;
  const frame = (): void => ui.update(run, derived, meta);

  const obs = new MutationObserver(() => undefined);
  obs.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  observer = obs;

  return { ui, root, sim, run, derived, meta, frame, drain: () => obs.takeRecords() };
}

afterEach(() => {
  observer?.disconnect();
  observer = null;
  mounted?.destroy();
  mounted = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

describe('dirty tracking', () => {
  it('writes nothing across 100 frames of unchanged state', () => {
    const r = rig({
      slop: 1234,
      timeLeftMs: 61_500,
      cards: ['sonnet', 'opus'],
      incidents: [makeIncident('rate_limited'), makeIncident('hallucinated_dep', { clicksRemaining: 6 })],
      pendingDemos: 3,
    });

    r.frame();
    r.frame();
    expect(r.drain().length).toBeGreaterThan(0); // the first frames do build the DOM

    for (let i = 0; i < 100; i++) r.frame();
    const records = r.drain();
    expect(records, describeRecords(records)).toHaveLength(0);
  });

  it('writes nothing across 100 frames on the title screen', () => {
    const r = rig({}, 'title');
    r.frame();
    r.frame();
    r.drain();
    for (let i = 0; i < 100; i++) r.frame();
    expect(r.drain()).toHaveLength(0);
  });

  it('writes nothing across 100 frames on the meta screen', () => {
    const r = rig({}, 'meta');
    r.frame();
    r.frame();
    r.drain();
    for (let i = 0; i < 100; i++) r.frame();
    expect(r.drain()).toHaveLength(0);
  });

  it('writes nothing while the draft modal is open and unchanged', () => {
    const r = rig({ phase: 'drafting', draftOffer: ['sonnet', 'haiku', 'opus'], draftRerollsLeft: 1 });
    r.frame();
    r.frame();
    r.drain();
    for (let i = 0; i < 100; i++) r.frame();
    expect(r.drain()).toHaveLength(0);
  });

  it('writes nothing while the run-over modal is open and unchanged', () => {
    const r = rig({ phase: 'lost', shipped: 4, pendingDemos: 6 });
    r.frame();
    r.frame();
    r.drain();
    for (let i = 0; i < 100; i++) r.frame();
    expect(r.drain()).toHaveLength(0);
  });

  it('still writes when something actually changes', () => {
    const r = rig({ slop: 100 });
    r.frame();
    r.frame();
    r.drain();

    r.ui.update({ ...r.run, slop: 200 }, makeDerived({ ...r.run, slop: 200 }), r.meta);
    expect(r.drain().length).toBeGreaterThan(0);
  });

  it('does not rebuild shop rows between frames', () => {
    const r = rig({ slop: 1e6 });
    r.frame();
    const before = must(r.root, tid(TID.agentRow, 'tab_autocomplete'));
    for (let i = 0; i < 50; i++) r.frame();
    expect(must(r.root, tid(TID.agentRow, 'tab_autocomplete'))).toBe(before);
  });
});

function describeRecords(records: MutationRecord[]): string {
  return records
    .slice(0, 8)
    .map((m) => {
      const target = m.target as Element;
      const name = target.nodeName ?? '?';
      const testid =
        target.getAttribute?.('data-testid') ??
        (target.parentElement?.getAttribute('data-testid') || '');
      return `${m.type}@${name}${testid ? `[${testid}]` : ''}${
        m.attributeName ? `.${m.attributeName}` : ''
      }`;
    })
    .join(', ');
}
