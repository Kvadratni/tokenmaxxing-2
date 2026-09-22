import { META_UPGRADES } from '@sim/content.ts';
const B = ['headcount','automation','capital','process','risk','root'];
for (const b of B) {
  const ns = META_UPGRADES.filter(m => m.branch === b).sort((x,y) => x.pos.y - y.pos.y);
  if (!ns.length) continue;
  console.log(`\n${b.toUpperCase()}`);
  for (const n of ns) {
    const total = n.costs.slice(0, n.maxLevel).reduce((a,c)=>a+c,0);
    const lv = n.maxLevel > 1 ? ` x${n.maxLevel}` : '';
    console.log(`  ${String(n.pos.y).padStart(2)}. ${n.name.padEnd(22)} ${(n.kind).padEnd(7)}${lv.padEnd(4)} ◈${String(total).padStart(3)}  ${n.describe(n.maxLevel)}`);
  }
}
console.log('\ntotal:', META_UPGRADES.reduce((a,m)=>a+m.costs.slice(0,m.maxLevel).reduce((x,y)=>x+y,0),0), 'Demos');
