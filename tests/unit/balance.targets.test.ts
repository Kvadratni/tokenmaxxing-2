/**
 * Pins the balance targets (DESIGN.md "Balance targets") with the competent
 * bot from tools/balance, on few seeds so it stays fast. The full picture,
 * with enough seeds to trust the percentages, is artifacts/balance/report.md
 * (`node tools/balance/run-balance.mjs report`). Tolerances here are wide on
 * purpose: they catch a retune that breaks a target, not a 5% drift.
 */
import { describe, expect, it } from 'vitest';
import { INCIDENTS, PICKUPS, PICKUP_BUFFS } from '../../src/sim/content.ts';
import { sycophancyCases } from '../../tools/balance/analysis.ts';
import type { TierRun } from '../../tools/balance/diag.ts';
import { playDiag } from '../../tools/balance/diag.ts';
import { HUMAN_CLICKS, averageCps } from '../../tools/balance/policy.ts';
import type { MetaStateName } from '../../tools/balance/meta.ts';
import { maxedCost, metaForBudget, orderProblems } from '../../tools/balance/meta.ts';
import type { PolicyId } from '../../tools/balance/policy.ts';
import type { RunResult } from '../../tools/balance/run.ts';
import { runOne } from '../../tools/balance/run.ts';
import { median, seeds } from '../../tools/balance/sweep.ts';

const cache = new Map<string, RunResult[]>();

function play(state: MetaStateName, policy: PolicyId, n: number): RunResult[] {
  const key = `${state}/${policy}/${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const meta = metaForBudget(state).meta;
  const rs = seeds(n, 500).map((seed) => runOne({ seed, policy, meta, metaName: state }));
  cache.set(key, rs);
  return rs;
}

const wins = (rs: readonly RunResult[]): number => rs.filter((r) => r.won).length;
/** Whole simulated sessions: generous, because the suite shares the machine. */
const SLOW = 60_000;
const meanReached = (rs: readonly RunResult[]): number => rs.reduce((s, r) => s + r.reachedPrompt, 0) / rs.length;

describe('balance targets', () => {
  it('the Training order covers the tree, and the tree costs 647 👍', () => {
    expect(orderProblems()).toEqual([]);
    expect(maxedCost()).toBe(647);
  });

  it('a fresh run dies on prompt 3-5, is force-compacted, and never wins', () => {
    const rs = play('fresh', 'competent', 8);
    expect(wins(rs)).toBe(0);
    for (const r of rs) {
      expect(r.reachedPrompt).toBeGreaterThanOrEqual(3);
      expect(r.reachedPrompt).toBeLessThanOrEqual(5);
    }
    expect(rs.filter((r) => r.forcedCompactions > 0).length).toBeGreaterThanOrEqual(7);
    const prompts = rs.reduce((s, r) => s + r.reported + 1, 0);
    const forcedPerPrompt = rs.reduce((s, r) => s + r.forcedCompactions, 0) / prompts;
    expect(forcedPerPrompt).toBeGreaterThan(0.3);
    expect(forcedPerPrompt).toBeLessThan(1.2);
  }, SLOW);

  it('mid meta wins some and loses some', () => {
    const rs = play('mid', 'competent', 10);
    expect(wins(rs)).toBeGreaterThanOrEqual(2);
    expect(wins(rs)).toBeLessThanOrEqual(9);
  }, SLOW);

  it('maxed meta nearly always wins, and a winning run lasts 12-25 minutes', () => {
    const rs = play('maxed', 'competent', 6);
    expect(wins(rs)).toBeGreaterThanOrEqual(5);
    const minutes = median(rs.filter((r) => r.won).map((r) => r.elapsedS / 60));
    expect(minutes).toBeGreaterThan(12);
    expect(minutes).toBeLessThan(25);
    // A maxed save barely compacts.
    expect(rs.every((r) => r.forcedCompactions === 0)).toBe(true);
  }, SLOW);

  it('careless play is visibly worse than competent play', () => {
    expect(meanReached(play('fresh', 'careless', 8))).toBeLessThan(meanReached(play('fresh', 'competent', 8)) - 0.5);
    expect(wins(play('mid', 'careless', 4))).toBe(0);
  }, SLOW);

  it('degenerate strategies do not beat the competent policy', () => {
    const competent = wins(play('mid', 'competent', 10)) / 10;
    for (const policy of ['always-claim', 'no-tools', 'clicker'] as const) {
      expect(wins(play('mid', policy, 4)) / 4).toBeLessThanOrEqual(competent);
    }
  }, SLOW);

  it('"You\'re absolutely right!" slows the drain but can never hold the bar up', () => {
    for (const c of sycophancyCases()) {
      expect(c.sustainRatio).toBeLessThan(0.8);
      expect(Number.isFinite(c.measuredStretch)).toBe(true);
      expect(c.measuredStretch).toBeLessThan(5);
    }
  }, SLOW);

  it('Ralph Loop and Recursive Self-Improvement pay back within about two prompts of becoming affordable', () => {
    for (const state of ['mid', 'maxed'] as const) {
      const meta = metaForBudget(state).meta;
      const runs = seeds(4, 500).map(
        (seed) => playDiag({ key: state, kind: 'tiers', seed, policy: 'competent', meta, metaName: state }).out as TierRun,
      );
      for (const id of ['ralph_loop', 'rsi'] as const) {
        const traces = runs.flatMap((r) => r.tiers.filter((t) => t.id === id));
        // A maxed save always reaches the top of the ladder; most mid runs do.
        expect(traces.length).toBeGreaterThanOrEqual(state === 'maxed' ? 4 : 3);
        for (const t of traces) {
          // One unit's price over its output when it first became affordable, in prompts.
          expect(t.instPaybackS / t.promptLenS).toBeLessThan(2);
        }
        // It typically becomes affordable with a prompt or more to go, not on the
        // final stretch. A median, because one unlucky seed can land it late.
        const firsts = traces.map((t) => t.firstPos).sort((x, y) => x - y);
        expect(firsts[Math.floor(firsts.length / 2)]).toBeLessThan(9);
        // A player who unlocked it wants it.
        expect(traces.filter((t) => t.boughtPos !== null).length).toBeGreaterThanOrEqual(traces.length - 1);
      }
    }
  }, SLOW);

  it('pickups are a bonus: no common pickup is a big lump of tokens or patience', () => {
    // Lucky Tokens' rare pickups displace a share of the common ones, so a
    // common payout big enough to carry a run would make Lucky Tokens a loss.
    for (const p of PICKUPS) {
      const a = p.action;
      if (a.t === 'tokens') expect(a.ofRequirement).toBeLessThanOrEqual(0.05);
      if (a.t === 'patience') expect(a.ofMax).toBeLessThanOrEqual(0.1);
    }
    for (const b of PICKUP_BUFFS) expect(b.durationMs).toBeLessThanOrEqual(20_000);
  });

  it('Auto Mode is worth buying because the game gets quieter, not because prompts are cruel', () => {
    // Under Auto Mode a roll that lands on a permission prompt becomes quiet
    // time (src/sim/incidents.ts, autoApprovedWeight). So the prompts can stay
    // humane: a human clears any of them in a few seconds of clicking.
    for (const p of INCIDENTS.filter((i) => i.permission)) {
      expect(p.clearWithClicks, p.id).toBeDefined();
      const clearS = (p.clearWithClicks ?? 0) / averageCps(HUMAN_CLICKS);
      expect(clearS, `${p.id} takes ${clearS.toFixed(1)}s of clicking`).toBeLessThanOrEqual(10);
      expect(p.durationMs, p.id).toBeLessThanOrEqual(60_000);
    }
  });
});
