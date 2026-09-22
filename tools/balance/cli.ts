/**
 * Ad-hoc driver for the balance simulator (run via `tools/balance/run-balance.mjs`).
 *
 *   node tools/balance/run-balance.mjs curve  [seeds]   difficulty curve only
 *   node tools/balance/run-balance.mjs sweep  [seeds]   full policy × meta grid
 *   node tools/balance/run-balance.mjs cards  [seeds]   card marginal contribution
 *   node tools/balance/run-balance.mjs risk   [seeds]   risk upgrade EV/variance
 *   node tools/balance/run-balance.mjs tiers  [seeds]   agent tier leapfrog table
 *   node tools/balance/run-balance.mjs report [seeds]   write artifacts/balance/report.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TOTAL_META_COST } from '@sim/index.ts';
import { cardHealth, riskAnalysis, synergyAnalysis, tierLeapfrog } from './analysis.ts';
import { buildReport, curveTable, renderCards, renderRisk, renderTiers } from './report.ts';
import { META_STATE_NAMES, metaForBudget, sweep } from './sweep.ts';

const [, , rawMode = 'report', rawSeeds] = process.argv;
const mode = rawMode.toLowerCase();
const seedCount = Number.parseInt(rawSeeds ?? '', 10);

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function writeReport(text: string): void {
  const out = resolve(process.cwd(), 'artifacts/balance/report.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, 'utf8');
  log(`wrote ${out} (${text.length} bytes)`);
}

switch (mode) {
  case 'curve': {
    const n = Number.isFinite(seedCount) ? seedCount : 120;
    const rep = sweep({ policies: ['balanced'], seedCount: n });
    log(curveTable(rep));
    log(`\nwall ${rep.wallMs} ms for ${rep.cells.length * n} runs`);
    break;
  }
  case 'sweep': {
    const n = Number.isFinite(seedCount) ? seedCount : 80;
    const rep = sweep({ seedCount: n });
    log(curveTable(rep));
    log(`\nwall ${rep.wallMs} ms for ${rep.cells.length * n} runs`);
    break;
  }
  case 'cards': {
    const n = Number.isFinite(seedCount) ? seedCount : 40;
    log(renderCards(cardHealth({ seedCount: n })));
    log(synergyAnalysis({ seedCount: n }).text);
    break;
  }
  case 'risk': {
    const n = Number.isFinite(seedCount) ? seedCount : 120;
    log(renderRisk(riskAnalysis({ seedCount: n })));
    break;
  }
  case 'tiers': {
    const n = Number.isFinite(seedCount) ? seedCount : 60;
    log(renderTiers(tierLeapfrog({ seedCount: n })));
    break;
  }
  case 'meta': {
    log(`TOTAL_META_COST = ${TOTAL_META_COST}`);
    for (const name of META_STATE_NAMES) {
      const built = metaForBudget(name);
      const levels = Object.entries(built.levels)
        .filter(([, l]) => l > 0)
        .map(([id, l]) => `${id}:${l}`)
        .join(' ');
      log(`${name.padEnd(6)} spent=${String(built.spent).padStart(4)}  ${levels}`);
    }
    break;
  }
  case 'report':
  default: {
    const n = Number.isFinite(seedCount) ? seedCount : 120;
    writeReport(buildReport({ seedCount: n }));
    break;
  }
}
