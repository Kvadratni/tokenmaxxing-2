/**
 * Run over: THE HUMAN SWITCHED MODELS, or SHIPPED TO PROD. The 👍, the next
 * release, the deprecation of this one, and the way out: Training.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { modelVersion, promptAt } from '../../src/sim/content.ts';
import { TID } from '../../src/testids.ts';
import {
  deprecationLine,
  nextModelVersion,
  RUN_LOST_TITLE,
  RUN_WON_TITLE,
} from '../../src/ui/runover.ts';
import { isHidden, makeMeta, makeRun, mountUI, must, text, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

describe('the next release', () => {
  it('follows the version that played, whether or not the run is counted yet', () => {
    // Run 3 played "2.5 (new)". Counted already (runs 3) or not yet (runs 2).
    expect(modelVersion(3)).toBe('2.5 (new)');
    expect(nextModelVersion('2.5 (new)', 3)).toBe(modelVersion(4));
    expect(nextModelVersion('2.5 (new)', 2)).toBe(modelVersion(4));
    // Something it cannot place falls back to the next run's.
    expect(nextModelVersion('???', 5)).toBe(modelVersion(6));
  });

  it('deprecates the version that just played', () => {
    expect(deprecationLine('2.0')).toContain('Tokenmaxxing 2.0 is deprecated');
  });
});

describe('run over', () => {
  function lose() {
    const m = mountUI({ run: makeRun({ promptIndex: 3 }), meta: makeMeta({ runs: 1 }), derived: { modelVersion: '2.5' } });
    // It played as 2.5, then the human switched models; the sim counts the run.
    m.sim.run.phase = 'lost';
    m.sim.run.reported = 3;
    m.sim.run.claimed = 1;
    m.sim.meta.runs = 2;
    m.derived = { modelVersion: '2.5 (new)', thumbsIfEndedNow: 4 };
    m.frame();
    return m;
  }

  it('titles a loss THE HUMAN SWITCHED MODELS and says where patience ran out', () => {
    const m = lose();
    const modal = must(m.root, TID.runOverModal);
    expect(isHidden(modal)).toBe(false);
    expect(text(m.root, TID.runOverTitle)).toBe(RUN_LOST_TITLE);
    expect(RUN_LOST_TITLE).toBe('THE HUMAN SWITCHED MODELS');
    expect(modal.textContent).toContain(promptAt(3).text);
  });

  it('titles a win SHIPPED TO PROD', () => {
    const m = mountUI({ run: makeRun({ promptIndex: 9, phase: 'won', reported: 10 }) });
    expect(text(m.root, TID.runOverTitle)).toBe(RUN_WON_TITLE);
    expect(RUN_WON_TITLE).toBe('SHIPPED TO PROD');
    expect(must(m.root, TID.runOverTitle).classList.contains('is-won')).toBe(true);
  });

  it('shows the 👍 earned, preferring what the sim says it banked', () => {
    const m = lose();
    expect(text(m.root, TID.runOverThumbs)).toBe('+4 👍 earned');
    m.ui.handle({ t: 'runOver', won: false, thumbs: 6, reported: 3 });
    m.frame();
    expect(text(m.root, TID.runOverThumbs)).toBe('+6 👍 earned');
  });

  it('announces the next release and deprecates the one that played', () => {
    const m = lose();
    expect(text(m.root, TID.runOverVersion)).toBe(`Releasing Tokenmaxxing ${modelVersion(3)}`);
    expect(must(m.root, TID.runOverModal).textContent).toContain(deprecationLine('2.5'));
  });

  it('says the 👍 carry over into Training', () => {
    const m = lose();
    expect(text(m.root, TID.runOverCarry)).toContain('Training');
  });

  it('continues to Training', () => {
    const m = lose();
    (must(m.root, TID.runOverContinue) as HTMLButtonElement).click();
    expect(m.ui.screen).toBe('meta');
    expect(isHidden(must(m.root, TID.metaScreen))).toBe(false);
    expect(m.sent('screen')).toEqual([{ t: 'screen', screen: 'meta' }]);
  });

  it('cannot be dismissed with Escape', () => {
    const m = lose();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    must(m.root, TID.runOverModal).dispatchEvent(e);
    m.frame();
    expect(isHidden(must(m.root, TID.runOverModal))).toBe(false);
  });

  it('stays down while a freshly requested run boots', () => {
    const m = lose();
    (must(m.root, TID.runOverContinue) as HTMLButtonElement).click();
    (must(m.root, TID.metaStart) as HTMLButtonElement).click();
    expect(m.sent('startRun')).toHaveLength(1);
    expect(m.ui.screen).toBe('run');
    // The host has not started the run yet: the old ending must not flash up.
    m.frame();
    expect(isHidden(must(m.root, TID.runOverModal))).toBe(true);
    // Then the new run is running, and later ends: now it shows.
    m.sim.run.phase = 'running';
    m.frame();
    m.sim.run.phase = 'lost';
    m.frame();
    expect(isHidden(must(m.root, TID.runOverModal))).toBe(false);
  });
});
