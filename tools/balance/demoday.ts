/**
 * Is Demo Day actually winnable with the right build?
 *
 * Two questions, answered separately:
 *   1. ANALYTIC — with every tier at its cap, what multiplier does project 10
 *      demand, and is that multiplier reachable from the content at all?
 *   2. EMPIRICAL — force a strong synergy build vs. a deliberately poor one and
 *      compare win rates. If the strong build does not clearly outperform, the
 *      draft is not carrying the run and "the right build" means nothing.
 */
import {
  AGENT_TIERS,
  BALANCE,
  CARDS,
  UPGRADES,
  defaultMeta,
  projectDeadlineMs,
  projectRequirement,
} from '@sim/index.ts';
import type { CardId, Effect, MetaState } from '@sim/types.ts';
import { runOne } from './run.ts';

const FINAL = 9; // 0-based project 10

// --- 1. analytic ceiling ---------------------------------------------------

/** Raw slop/s with every tier owned to its cap and no multipliers at all. */
export function cappedRawRate(): number {
  let total = 0;
  for (const t of AGENT_TIERS) total += t.maxOwned * t.baseRate;
  return total;
}

/** Slop/s project 10 demands to be shippable inside its deadline. */
export function demoDayDemand(): number {
  return projectRequirement(FINAL) / (projectDeadlineMs(FINAL) / 1000);
}

const mulOf = (effects: readonly Effect[], t: Effect['t']): number => {
  let m = 1;
  for (const e of effects) if (e.t === t && 'v' in e) m *= e.v;
  return m;
};

/**
 * Best multiplier the content can stack: every non-conflicting upgrade, plus
 * the nine strongest cards a run could plausibly draft.
 */
export function bestCaseMultiplier(): { upgrades: number; cards: number; total: number } {
  let upgrades = 1;
  for (const u of UPGRADES) {
    upgrades *= mulOf(u.effects, 'idleMult') * mulOf(u.effects, 'allMult');
  }
  const cardMults = CARDS.map(
    (c) => mulOf(c.effects, 'idleMult') * mulOf(c.effects, 'allMult'),
  )
    .sort((a, b) => b - a)
    .slice(0, 9);
  const cards = cardMults.reduce((a, b) => a * b, 1);
  return { upgrades, cards, total: upgrades * cards };
}

// --- 2. empirical: does the draft decide the run? --------------------------

/** Cards that actually multiply production, best first. */
function rankedCards(): CardId[] {
  return [...CARDS]
    .map((c) => ({
      id: c.id,
      m: mulOf(c.effects, 'idleMult') * mulOf(c.effects, 'allMult') * mulOf(c.effects, 'clickMult'),
    }))
    .sort((a, b) => b.m - a.m)
    .map((c) => c.id);
}

function maxedMeta(): MetaState {
  const m = defaultMeta();
  for (const id of Object.keys(m.levels)) m.levels[id] = 99;
  return m;
}

export interface ArmResult {
  label: string;
  wins: number;
  runs: number;
  winRate: number;
  medianShipped: number;
  peakIdle: number;
}

function arm(label: string, seeds: number[], force: CardId[], ban: CardId[]): ArmResult {
  const meta = maxedMeta();
  let wins = 0;
  const shipped: number[] = [];
  let peak = 0;
  for (const seed of seeds) {
    const r = runOne({ seed, policy: 'optimal-ish', meta, forceCards: force, banCards: ban });
    if (r.won) wins += 1;
    shipped.push(r.shipped);
    peak = Math.max(peak, r.peakIdleRate);
  }
  shipped.sort((a, b) => a - b);
  return {
    label,
    wins,
    runs: seeds.length,
    winRate: wins / seeds.length,
    medianShipped: shipped[Math.floor(shipped.length / 2)] ?? 0,
    peakIdle: peak,
  };
}

export function demoDayReport(seedCount = 80): string {
  const seeds = Array.from({ length: seedCount }, (_, i) => 9_000 + i * 7);
  const ranked = rankedCards();
  const strong = ranked.slice(0, 8);
  const weak = ranked.slice(-8);

  const raw = cappedRawRate();
  const demand = demoDayDemand();
  const needed = demand / raw;
  const best = bestCaseMultiplier();

  const strongArm = arm('strong build (top cards forced)', seeds, strong, weak);
  const weakArm = arm('weak build (top cards banned)', seeds, weak, strong);
  const freeArm = arm('free draft (whatever shows up)', seeds, [], []);

  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n.toFixed(0));
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const lines: string[] = [];
  lines.push('# Demo Day reachability\n');
  lines.push('## Analytic ceiling\n');
  lines.push('| quantity | value |');
  lines.push('|---|---:|');
  lines.push(`| project 10 requirement | ${projectRequirement(FINAL).toExponential(2)} |`);
  lines.push(`| project 10 deadline | ${(projectDeadlineMs(FINAL) / 1000).toFixed(0)} s |`);
  lines.push(`| slop/s demanded | ${demand.toExponential(2)} |`);
  lines.push(`| raw slop/s, every tier at cap ${BALANCE.MAX_PER_TIER} | ${fmt(raw)} |`);
  lines.push(`| **multiplier required** | **${needed.toFixed(0)}x** |`);
  lines.push(`| best-case multiplier from upgrades | ${best.upgrades.toFixed(1)}x |`);
  lines.push(`| best-case multiplier from 9 cards | ${best.cards.toFixed(0)}x |`);
  lines.push(`| **best-case total available** | **${best.total.toFixed(0)}x** |`);
  const slack = best.total / needed;
  lines.push(
    `\n${slack >= 1 ? 'REACHABLE' : 'IMPOSSIBLE'} — the content offers ` +
      `${slack.toFixed(1)}x the multiplier project 10 demands.\n`,
  );

  lines.push('## Does the build decide it?\n');
  lines.push('`optimal-ish` policy, maxed meta, identical seeds across arms.\n');
  lines.push('| arm | win rate | median shipped | peak slop/s |');
  lines.push('|---|---:|---:|---:|');
  for (const a of [strongArm, freeArm, weakArm]) {
    lines.push(
      `| ${a.label} | ${pct(a.winRate)} | ${a.medianShipped} | ${a.peakIdle.toExponential(2)} |`,
    );
  }
  const spread = strongArm.winRate - weakArm.winRate;
  lines.push(
    `\nBuild swing: **${pct(spread)}** between the best and worst draft. ` +
      (spread >= 0.25
        ? 'The draft is carrying the run, which is the design goal.'
        : 'The draft barely matters — cards need sharper differentiation.'),
  );
  return lines.join('\n');
}
