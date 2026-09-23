/**
 * The Training tree as a table: every node by branch, its kind, levels, total
 * 👍 cost and what it does at max level.
 *
 *   npx vite-node scripts/treelist.ts
 */
import { META_UPGRADES, TOTAL_META_COST } from '@sim/content.ts';
import type { MetaBranch } from '@sim/types.ts';

const BRANCHES: readonly MetaBranch[] = ['root', 'context', 'tools', 'alignment', 'hacking', 'inference', 'prompting'];
const total = (costs: readonly number[], max: number): number => costs.slice(0, max).reduce((a, c) => a + c, 0);

for (const b of BRANCHES) {
  const nodes = META_UPGRADES.filter((m) => m.branch === b).sort((x, y) => x.pos.y - y.pos.y);
  if (!nodes.length) continue;
  console.log(`\n${b.toUpperCase()}`);
  for (const n of nodes) {
    const lv = n.maxLevel > 1 ? ` x${n.maxLevel}` : '';
    console.log(
      `  ${String(n.pos.y).padStart(2)}. ${n.name.padEnd(26)} ${n.kind.padEnd(7)}${lv.padEnd(4)} 👍${String(total(n.costs, n.maxLevel)).padStart(4)}  ${n.describe(n.maxLevel)}`,
    );
  }
}
console.log(`\n${META_UPGRADES.length} nodes, ${TOTAL_META_COST} 👍 to max the tree`);
