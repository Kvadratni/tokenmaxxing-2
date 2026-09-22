/**
 * Markdown rendering for the balance sweep.
 */
import { AGENT_TIER_IDS, BALANCE, TOTAL_META_COST, projectAt } from '@sim/index.ts';
import type {
  CardHealthReport,
  ExperimentOptions,
  RiskReport,
  TierReport,
} from './analysis.ts';
import {
  cardHealth,
  fmt,
  incidentEv,
  riskAnalysis,
  synergyAnalysis,
  tierLadder,
  tierLeapfrog,
  tierName,
} from './analysis.ts';
import type { CellStats, SweepReport } from './sweep.ts';
import { META_STATE_NAMES, metaForBudget, sweep } from './sweep.ts';

const POLICY_ORDER = ['miser', 'greedy', 'balanced', 'optimal-ish'] as const;

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function num(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function cellFor(rep: SweepReport, policy: string, metaName: string): CellStats | undefined {
  return rep.cells.find((c) => c.policy === policy && c.metaName === metaName);
}

// ---------------------------------------------------------------------------
// Difficulty curve
// ---------------------------------------------------------------------------

export function curveTable(rep: SweepReport): string {
  const lines: string[] = [];
  lines.push(
    '| policy | meta | median shipped | mean | p05 | p95 | Demo Day | mean Demos | mean run s |',
  );
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const policy of POLICY_ORDER) {
    for (const name of META_STATE_NAMES) {
      const c = cellFor(rep, policy, name);
      if (!c) continue;
      lines.push(
        `| ${policy} | ${name} | ${num(c.medianShipped, 1)} | ${num(c.meanShipped)} | ` +
          `${num(c.p05Shipped, 1)} | ${num(c.p95Shipped, 1)} | ${pct(c.winRate)} | ` +
          `${num(c.meanDemos, 1)} | ${num(c.meanRunSeconds, 0)} |`,
      );
    }
  }
  return lines.join('\n');
}

export function deathTable(rep: SweepReport, policy = 'balanced'): string {
  const lines: string[] = [];
  const header = ['| meta | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | won |'];
  lines.push(...header, '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const name of META_STATE_NAMES) {
    const c = cellFor(rep, policy, name);
    if (!c) continue;
    const total = c.runs || 1;
    const cells: string[] = [];
    for (let p = 1; p <= 10; p++) cells.push(pct((c.deathHistogram[p] ?? 0) / total));
    lines.push(`| ${name} | ${cells.join(' | ')} | ${pct(c.winRate)} |`);
  }
  return lines.join('\n');
}

export function paceTable(rep: SweepReport, policy = 'balanced'): string {
  const lines = ['| meta | ' + Array.from({ length: 10 }, (_, i) => `P${i + 1}`).join(' | ') + ' |'];
  lines.push('|---|' + '---:|'.repeat(10));
  for (const name of META_STATE_NAMES) {
    const c = cellFor(rep, policy, name);
    if (!c) continue;
    const cells: string[] = [];
    for (let i = 0; i < 10; i++) {
      const v = c.meanSecondsPerProject[i];
      cells.push(v === undefined ? '—' : v.toFixed(0));
    }
    lines.push(`| ${name} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function tensionTable(rep: SweepReport): string {
  const lines = [
    '| policy | meta | ship-ready decisions | genuine forks | bought over shipping | banked (could not afford) |',
    '|---|---|---:|---:|---:|---:|',
  ];
  for (const policy of ['balanced', 'optimal-ish'] as const) {
    for (const name of META_STATE_NAMES) {
      const c = cellFor(rep, policy, name);
      if (!c) continue;
      lines.push(
        `| ${policy} | ${name} | ${pct(c.shipReadyRate)} | ${pct(c.tensionRate)} | ` +
          `${pct(c.buyOverShipRate)} | ${pct(c.bankedRate)} |`,
      );
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Content tables
// ---------------------------------------------------------------------------

export function requirementTable(): string {
  const lines = ['| project | requirement | deadline s | slop/s needed |', '|---:|---:|---:|---:|'];
  for (let i = 0; i < 10; i++) {
    const p = projectAt(i);
    lines.push(
      `| ${i + 1} ${p.name} | ${fmt(p.requirement)} | ${(p.deadlineMs / 1000).toFixed(0)} | ` +
        `${fmt(p.requirement / (p.deadlineMs / 1000))} |`,
    );
  }
  return lines.join('\n');
}

export function metaTable(): string {
  const lines = ['| state | Demos spent | levels |', '|---|---:|---|'];
  for (const name of META_STATE_NAMES) {
    const built = metaForBudget(name);
    const levels = Object.entries(built.levels)
      .filter(([, l]) => l > 0)
      .map(([id, l]) => `${id} ${l}`)
      .join(', ');
    lines.push(`| ${name} | ${built.spent} | ${levels || '—'} |`);
  }
  return lines.join('\n');
}

export function renderCards(rep: CardHealthReport): string {
  const lines = [
    `Forced-take vs forbidden A/B on ${rep.seedCount} shared seeds, \`${rep.metaState}\` meta, \`balanced\` policy.`,
    'Δ is per *acquired* copy: raw arm difference divided by how often the forced arm actually got the card.',
    '',
    '| card | rarity | Δ projects | Δ win rate | pick rate when offered | acquired | verdict |',
    '|---|---|---:|---:|---:|---:|---|',
  ];
  for (const c of rep.cards) {
    lines.push(
      `| ${c.name} | ${c.rarity} | ${c.deltaShipped >= 0 ? '+' : ''}${num(c.deltaShipped)} | ` +
        `${c.deltaWinRate >= 0 ? '+' : ''}${pct(c.deltaWinRate)} | ${pct(c.pickRate)} | ` +
        `${pct(c.acquiredRate)} | ${c.verdict} |`,
    );
  }
  return lines.join('\n');
}

export function renderRisk(rep: RiskReport): string {
  const lines = [
    `Paired A/B on ${rep.seedCount} shared seeds, \`${rep.metaState}\` meta.`,
    '',
    '| upgrade | mean (on) | mean (off) | Δ mean | Δ sd | Δ p10 | Δ p90 | verdict |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const p of rep.pairs) {
    lines.push(
      `| ${p.id} | ${num(p.on.meanShipped)} | ${num(p.off.meanShipped)} | ` +
        `${p.deltaMean >= 0 ? '+' : ''}${num(p.deltaMean)} | ${p.deltaSd >= 0 ? '+' : ''}${num(p.deltaSd)} | ` +
        `${p.deltaP10 >= 0 ? '+' : ''}${num(p.deltaP10, 1)} | ${p.deltaP90 >= 0 ? '+' : ''}${num(p.deltaP90, 1)} | ` +
        `${p.verdict} |`,
    );
  }
  return lines.join('\n');
}

export function renderTiers(rep: TierReport): string {
  const lines = [
    tierLadder(),
    '',
    `Modal best affordable purchase per project (${rep.seedCount} seeds × mid/deep/maxed, \`balanced\`):`,
    '',
    '| project | best tier | share of decisions | samples |',
    '|---:|---|---:|---:|',
  ];
  for (const r of rep.rows) {
    lines.push(
      `| ${r.projectNumber} | ${r.bestTier ? tierName(r.bestTier) : '—'} | ${pct(r.share)} | ${r.samples} |`,
    );
  }
  lines.push('', '| tier | times "best buy" | mean owned at end | runs reaching it |', '|---|---:|---:|---:|');
  for (const id of AGENT_TIER_IDS) {
    lines.push(
      `| ${tierName(id)} | ${rep.bestCounts[id]} | ${num(rep.meanOwned[id], 1)} | ${pct(rep.reachRate[id])} |`,
    );
  }
  if (rep.deadTiers.length > 0) {
    lines.push('', `**Dead tiers (never the best buy): ${rep.deadTiers.join(', ')}**`);
  } else {
    lines.push('', 'No dead tiers: every tier is the best affordable purchase somewhere.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

export interface ReportOptions {
  readonly seedCount?: number;
  /** Seeds for the (much more expensive) card A/B grid. */
  readonly cardSeedCount?: number;
  readonly riskSeedCount?: number;
  readonly tierSeedCount?: number;
  /** Skip the controlled experiments; curve only. */
  readonly curveOnly?: boolean;
}

interface TargetCheck {
  readonly label: string;
  readonly target: string;
  readonly actual: string;
  readonly ok: boolean;
}

function checkTargets(rep: SweepReport): TargetCheck[] {
  const out: TargetCheck[] = [];
  const fresh = cellFor(rep, 'balanced', 'fresh');
  const early = cellFor(rep, 'balanced', 'early');
  const mid = cellFor(rep, 'balanced', 'mid');
  const deep = cellFor(rep, 'balanced', 'deep');
  const maxed = cellFor(rep, 'balanced', 'maxed');

  if (fresh) {
    out.push({
      label: 'run 1 (fresh + balanced)',
      target: 'median 3 shipped, p95 < 5',
      actual: `median ${num(fresh.medianShipped, 1)}, p95 ${num(fresh.p95Shipped, 1)}`,
      ok: fresh.medianShipped === 3 && fresh.p95Shipped < 5,
    });
  }
  if (early) {
    out.push({
      label: 'early meta',
      target: 'reaches project 4–5',
      actual: `median ${num(early.medianShipped, 1)} shipped (mean ${num(early.meanShipped)})`,
      ok: early.medianShipped >= 4 && early.medianShipped <= 5,
    });
  }
  if (mid) {
    out.push({
      label: 'mid meta, average draft',
      target: 'reaches project 5–6',
      actual: `median ${num(mid.medianShipped, 1)} shipped (mean ${num(mid.meanShipped)})`,
      ok: mid.medianShipped >= 5 && mid.medianShipped <= 6,
    });
  }
  if (deep) {
    out.push({
      label: 'deep meta',
      target: 'Demo Day on a good draft — win rate in (0, 60%)',
      actual: `win rate ${pct(deep.winRate)}, median ${num(deep.medianShipped, 1)}`,
      ok: deep.winRate > 0.05 && deep.winRate < 0.6,
    });
  }
  if (maxed) {
    out.push({
      label: 'maxed meta',
      target: 'wins comfortably (>90%) but not trivially',
      actual: `win rate ${pct(maxed.winRate)}`,
      ok: maxed.winRate > 0.9,
    });
  }
  out.push({
    label: 'total meta-tree cost',
    target: '200–300 Demos',
    actual: `${TOTAL_META_COST} Demos`,
    ok: TOTAL_META_COST >= 200 && TOTAL_META_COST <= 300,
  });

  const paceCell = mid ?? deep;
  if (paceCell) {
    const paces = paceCell.meanSecondsPerProject.slice(1).filter((v) => Number.isFinite(v));
    const lo = paces.length ? Math.min(...paces) : 0;
    const hi = paces.length ? Math.max(...paces) : 0;
    out.push({
      label: 'seconds per project after the first (mid meta)',
      target: '60–90 s of engaged play',
      actual: `${lo.toFixed(0)}–${hi.toFixed(0)} s`,
      ok: lo >= 55 && hi <= 95,
    });
  }
  return out;
}

export function buildReport(opts: ReportOptions = {}): string {
  const seedCount = opts.seedCount ?? 120;
  const rep = sweep({ seedCount });
  const targets = checkTargets(rep);

  const parts: string[] = [];
  parts.push('# Tokenmaxxing — balance report');
  parts.push('');
  parts.push(
    `Generated by \`tools/balance\`. ${seedCount} seeds × ${POLICY_ORDER.length} policies × ` +
      `${META_STATE_NAMES.length} meta states = ${seedCount * POLICY_ORDER.length * META_STATE_NAMES.length} headless runs ` +
      `in ${(rep.wallMs / 1000).toFixed(1)} s.`,
  );
  parts.push('');
  parts.push(
    `Click model: ${'6'} clicks/s while active, 70% click uptime on a 10 s duty cycle ` +
      `(≈ ${(6 * 0.7).toFixed(1)} clicks/s averaged, ×${(1 + BALANCE.CRIT_CHANCE * (BALANCE.CRIT_MULT - 1)).toFixed(2)} for crits).`,
  );
  parts.push('');

  parts.push('## Targets');
  parts.push('');
  parts.push('| target | wanted | measured | |');
  parts.push('|---|---|---|:--:|');
  for (const t of targets) {
    parts.push(`| ${t.label} | ${t.target} | ${t.actual} | ${t.ok ? 'PASS' : 'MISS'} |`);
  }
  parts.push('');

  parts.push('## Difficulty curve');
  parts.push('');
  parts.push(curveTable(rep));
  parts.push('');
  parts.push('### Where runs die (`balanced`) — share of runs ending on each project');
  parts.push('');
  parts.push(deathTable(rep));
  parts.push('');
  parts.push('### Seconds spent per shipped project (`balanced`)');
  parts.push('');
  parts.push(paceTable(rep));
  parts.push('');

  parts.push('## The central tension');
  parts.push('');
  parts.push(
    'A decision tick is a "genuine fork" when the wallet is already over the ship bar *and* a ' +
      'purchase still passes its own payback test — the player must choose. `banked` counts ticks ' +
      'where a worthwhile purchase existed but could not be afforded.',
  );
  parts.push('');
  parts.push(tensionTable(rep));
  parts.push('');

  parts.push('## Requirement curve');
  parts.push('');
  parts.push(requirementTable());
  parts.push('');

  parts.push('## Meta tree');
  parts.push('');
  parts.push(`\`TOTAL_META_COST\` = **${TOTAL_META_COST}** Demos.`);
  parts.push('');
  parts.push(metaTable());
  parts.push('');

  if (!opts.curveOnly) {
    const expOpts: ExperimentOptions = { metaState: 'deep', policy: 'balanced' };
    parts.push('## Agent tiers');
    parts.push('');
    parts.push(renderTiers(tierLeapfrog({ seedCount: opts.tierSeedCount ?? 40 })));
    parts.push('');

    parts.push('## Card health');
    parts.push('');
    parts.push(renderCards(cardHealth({ ...expOpts, seedCount: opts.cardSeedCount ?? 30 })));
    parts.push('');

    parts.push('### Opus / Haiku synergy');
    parts.push('');
    parts.push(synergyAnalysis({ ...expOpts, seedCount: opts.cardSeedCount ?? 30 }).text);
    parts.push('');

    parts.push('## Risk upgrades');
    parts.push('');
    parts.push(renderRisk(riskAnalysis({ ...expOpts, seedCount: opts.riskSeedCount ?? 80 })));
    parts.push('');
    const ev = incidentEv({ ...expOpts, seedCount: opts.riskSeedCount ?? 80 });
    parts.push(
      `Incident EV probe (\`100% Coverage\`, a pure −50% incident-rate card): ` +
        `${num(ev.on.meanShipped)} projects with it vs ${num(ev.off.meanShipped)} without ` +
        `(sd ${num(ev.on.sdShipped)} vs ${num(ev.off.sdShipped)}). ` +
        `Positive means incidents are net-negative and risk upgrades really cost something.`,
    );
    parts.push('');
  }

  return `${parts.join('\n')}\n`;
}
