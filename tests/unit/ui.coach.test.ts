/**
 * First-run coach marks: the context bar, the human's patience, claims and
 * compaction, each taught the moment it becomes true, once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE, promptAt } from '../../src/sim/content.ts';
import { TID, tid } from '../../src/testids.ts';
import { COACH_TIP_MS, COACH_TIPS, placeTip, type TipRect } from '../../src/ui/coach.ts';
import { makeMeta, makeRun, mountUI, must, q, unmountAll } from './ui.fake-sim.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
});

const tipOn = (root: HTMLElement): string | null => {
  const node = must(root, TID.coach).querySelector<HTMLElement>(`[data-testid^="${TID.coachTip}-"]`);
  return node?.dataset['testid']?.slice(TID.coachTip.length + 1) ?? null;
};

/** Dismiss whatever is showing, then run a frame so the next tip can land. */
function next(m: ReturnType<typeof mountUI>): string | null {
  const id = tipOn(m.root);
  if (id !== null) (must(m.root, tid(TID.coachDismiss, id)) as HTMLButtonElement).click();
  m.frame();
  return tipOn(m.root);
}

describe('coach marks', () => {
  it('covers the four ideas game 1 did not have', () => {
    const ids = COACH_TIPS.map((t) => t.id);
    for (const id of ['context', 'patience', 'claim', 'compaction']) expect(ids).toContain(id);
  });

  it('leaves "click the agent" to the tour: a fresh session starts quiet', () => {
    expect(COACH_TIPS.map((t) => t.id)).not.toContain('generate');
    const m = mountUI();
    expect(tipOn(m.root)).toBeNull();
  });

  it('teaches each idea when it becomes true, once, in priority order', () => {
    const m = mountUI();
    expect(tipOn(m.root)).toBeNull();

    m.sim.run.context = BALANCE.BASE_CONTEXT * 0.25;
    expect(next(m)).toBe('context');

    m.sim.run.patienceMs = promptAt(0).patienceMs * 0.5;
    expect(next(m)).toBe('patience');

    m.sim.run.tokens = 60; // CLAIM DONE, and a Grep is affordable too: tools first
    expect(next(m)).toBe('tools');
    expect(next(m)).toBe('claim');

    m.sim.run.tokens = 100; // REPORT DONE
    expect(next(m)).toBe('report');

    m.sim.run.context = BALANCE.BASE_CONTEXT * 0.85;
    expect(next(m)).toBe('compaction');
    expect(must(m.root, tid(TID.coachTip, 'compaction')).textContent).toContain('compacted');

    // Nothing is offered twice.
    expect(next(m)).toBeNull();
  });

  it('retires a tip on its own after a few seconds', () => {
    const m = mountUI({ run: makeRun({ context: BALANCE.BASE_CONTEXT * 0.25 }) });
    expect(tipOn(m.root)).toBe('context');
    vi.advanceTimersByTime(COACH_TIP_MS + 10);
    expect(tipOn(m.root)).toBeNull();
  });

  it('stays out of the way on any session after the first, and under dialogs', () => {
    const quarter = BALANCE.BASE_CONTEXT * 0.25;
    const later = mountUI({ meta: makeMeta({ runs: 1 }), run: makeRun({ context: quarter }) });
    expect(tipOn(later.root)).toBeNull();
    unmountAll();
    const m = mountUI({
      run: makeRun({ context: quarter, phase: 'drafting', draftOffer: ['please', 'grandma', 'tip_200'] }),
    });
    expect(q(m.root, tid(TID.coachTip, 'context'))).toBeNull();
  });
});

describe('placing a tip', () => {
  const rect = (left: number, top: number, width: number, height: number): TipRect => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  // A 1280x720 desktop at --px 2: the stage is 640x360 at (220, 150).
  const stage = rect(220, 150, 640, 360);
  const band = rect(stage.left, stage.bottom - 44, stage.width, 44); // 22 scene px
  const agent = rect(508, 330, 64, 124);

  it('puts a tip asked to go above its anchor there, pointing down', () => {
    const p = placeTip(agent, 300, 40, 1280, 720, 'above', band);
    expect(p.side).toBe('above');
    expect(p.top + 40).toBeLessThanOrEqual(agent.top);
  });

  it('never lands on the prompt line along the bottom of the stage', () => {
    // Below the agent is exactly where the canvas prints the prompt.
    const p = placeTip(agent, 300, 40, 1280, 720, 'below', band);
    const hitsBand = p.top < band.bottom && p.top + 40 > band.top && p.left < band.right && p.left + 300 > band.left;
    expect(hitsBand).toBe(false);
  });

  it('goes to the side when there is no room above', () => {
    const high = rect(508, 20, 64, 124);
    const p = placeTip(high, 200, 60, 1280, 720, 'above', band);
    expect(p.side).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(high.right);
  });

  it('stays inside the viewport', () => {
    const edge = rect(1200, 300, 60, 40);
    const p = placeTip(edge, 300, 40, 1280, 720, 'below', null);
    expect(p.left + 300).toBeLessThanOrEqual(1280 - 10);
    expect(p.left).toBeGreaterThanOrEqual(10);
  });
});
