/**
 * Pins the balance targets (DESIGN.md "Balance targets") with the competent
 * bot from tools/balance, on few seeds so it stays fast. The full picture,
 * with enough seeds to trust the percentages, is artifacts/balance/report.md
 * (`node tools/balance/run-balance.mjs report`). Tolerances here are wide on
 * purpose: they catch a retune that breaks a target, not a 5% drift.
 */
import { describe, expect, it } from 'vitest';
import { sycophancyCases } from '../../tools/balance/analysis.ts';
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
});
