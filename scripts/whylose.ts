import { AGENT_TIERS, INCIDENT_BY_ID, defaultMeta } from '@sim/index.ts';
import type { MetaState } from '@sim/types.ts';
import { runOne } from '../tools/balance/run.ts';

const meta: MetaState = defaultMeta();
for (const id of Object.keys(meta.levels)) meta.levels[id] = 99;
void AGENT_TIERS;

let losses = 0, reachedTen = 0, blockedAtDeath = 0, nearMiss = 0;
const causes: Record<string, number> = {};
for (let i = 0; i < 200; i++) {
  const r = runOne({ seed: 4000 + i * 13, policy: 'optimal-ish', meta, trace: true });
  if (r.won) continue;
  losses++;
  if (r.reachedProject === 10) reachedTen++;
  // How close was the bar when the clock ran out?
  if (r.deathProgress >= 0.9) nearMiss++;
  for (const id of r.incidentIds.slice(-3)) {
    if (INCIDENT_BY_ID[id]?.blocksShip) { causes[id] = (causes[id] ?? 0) + 1; }
  }
  if (r.incidentIds.some((id) => INCIDENT_BY_ID[id]?.blocksShip)) blockedAtDeath++;
}
console.log('losses:', losses, 'of 200');
console.log('  reached project 10 then died:', reachedTen);
console.log('  bar was >=90% full at death:', nearMiss);
console.log('  run had seen an outage:', blockedAtDeath);
console.log('  outages among last 3 incidents:', JSON.stringify(causes));
