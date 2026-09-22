/**
 * Which meta nodes actually move the win rate?
 *
 * `maxed` currently wins no more often than `deep`, so ~530 Demos of tree buy
 * nothing measurable. This walks the levelled nodes one at a time: start from
 * the `deep` state, raise a single node to its max level, and re-measure. A node
 * with a Δ near zero is dead weight at the top of the tree.
 *
 *   npx tsx tools/balance/nodeweight.ts [seedCount]
 */
import { META_UPGRADES } from '@sim/index.ts';
import { runOne } from './run.ts';
import { metaForBudget, seeds } from './sweep.ts';
import type { MetaState } from '@sim/types.ts';

const SEEDS = Number(process.argv[2] ?? 60);
const FINAL = 9; // 0-based index of the last project

function winRate(meta: MetaState): { win: number; median: number } {
  const shipped: number[] = [];
  let wins = 0;
  for (const seed of seeds(SEEDS)) {
    const r = runOne({ seed, meta, policy: 'balanced' });
    shipped.push(r.shipped);
    if (r.shipped > FINAL) wins += 1;
  }
  shipped.sort((a, b) => a - b);
  return { win: wins / SEEDS, median: shipped[Math.floor(SEEDS / 2)] ?? 0 };
}

const deep = metaForBudget('deep');
const maxed = metaForBudget('maxed');
const base = winRate(deep.meta);
const top = winRate(maxed.meta);

console.log(`seeds: ${SEEDS}`);
console.log(`deep  (${deep.spent} demos): win ${(base.win * 100).toFixed(0)}%  median ${base.median}`);
console.log(`maxed (${maxed.spent} demos): win ${(top.win * 100).toFixed(0)}%  median ${top.median}`);
console.log();

const rows: Array<{ id: string; from: number; to: number; dWin: number; dMed: number }> = [];
for (const def of META_UPGRADES) {
  const from = deep.levels[def.id] ?? 0;
  const to = def.maxLevel;
  if (from >= to) continue;
  const meta: MetaState = {
    ...deep.meta,
    levels: { ...deep.meta.levels, [def.id]: to },
  };
  const r = winRate(meta);
  rows.push({ id: def.id, from, to, dWin: r.win - base.win, dMed: r.median - base.median });
}

rows.sort((a, b) => b.dWin - a.dWin);
console.log('| node | deep→max | Δ win | Δ median |');
console.log('|---|---|---:|---:|');
for (const r of rows) {
  const pct = `${r.dWin >= 0 ? '+' : ''}${(r.dWin * 100).toFixed(0)}%`;
  const med = `${r.dMed >= 0 ? '+' : ''}${r.dMed.toFixed(1)}`;
  console.log(`| ${r.id} | ${r.from}→${r.to} | ${pct} | ${med} |`);
}
