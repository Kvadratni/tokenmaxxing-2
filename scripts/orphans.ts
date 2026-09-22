import { UPGRADES, CARDS, META_UPGRADES, META_BY_ID, defaultMeta, unlockedContent } from '@sim/index.ts';
const m = defaultMeta();
for (const d of META_UPGRADES) m.levels[d.id] = META_BY_ID[d.id]!.maxLevel;
const all = unlockedContent(m);
console.log('orphan upgrades:', UPGRADES.filter(u => !all.upgrades.has(u.id)).map(u => u.id).join(', ') || 'none');
console.log('orphan cards   :', CARDS.filter(c => !all.cards.has(c.id)).map(c => c.id).join(', ') || 'none');
