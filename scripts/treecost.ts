import { META_UPGRADES, STARTING_TIERS, STARTING_CARDS, STARTING_UPGRADES } from '@sim/content.ts';
const total = META_UPGRADES.reduce((n, m) => n + m.costs.slice(0, m.maxLevel).reduce((a, b) => a + b, 0), 0);
console.log('nodes:', META_UPGRADES.length, '| unlocks:', META_UPGRADES.filter(m=>m.kind==='unlock').length);
console.log('total tree cost:', total, 'Demos');
console.log('start: tiers', STARTING_TIERS.length, '| upgrades', STARTING_UPGRADES.length, '| cards', STARTING_CARDS.length);
