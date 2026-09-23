/**
 * Is the final prompt ("ok now build agi. make no mistakes") reachable, and
 * how much headroom does a maxed save have over it?
 *
 * Analytic, not simulated: every tool at its cap, every tool upgrade owned,
 * the maxed Training multipliers, no cards. It answers "can it be done at
 * all" and "how many seconds of the last prompt's patience does perfect
 * production need", which the sweep cannot separate from play quality.
 */
import {
  FINAL_PROMPT_INDEX,
  TOOLS,
  UPGRADES,
  baseAggregate,
  computeDerived,
  createSim,
  formatTokens,
  promptAt,
} from '@sim/index.ts';
import type { MetaState } from '@sim/types.ts';
import { metaForBudget } from './meta.ts';

export interface CeilingRow {
  readonly label: string;
  /** Tokens/s with every tool capped and every unlocked upgrade owned. */
  readonly cappedRate: number;
  /** Seconds that rate needs for the final requirement. */
  readonly finalSeconds: number;
  /** The final prompt's patience before cards, in seconds. */
  readonly finalPatienceS: number;
}

export function ceiling(label: string, meta: MetaState): CeilingRow {
  const sim = createSim({ seed: 1, meta: structuredClone(meta), storage: null, persist: false, trustSave: true, legacyStorage: null });
  const run = sim.run;
  const unlocked = sim.unlocked();
  for (const t of TOOLS) if (unlocked.tools.has(t.id)) run.tools[t.id] = t.maxOwned;
  for (const u of UPGRADES) if (unlocked.upgrades.has(u.id)) run.owned.push(u.id);
  run.promptIndex = FINAL_PROMPT_INDEX;
  const agg = baseAggregate(run, sim.meta);
  const d = computeDerived(run, sim.meta, agg);
  const req = promptAt(FINAL_PROMPT_INDEX).requirement;
  return {
    label,
    cappedRate: d.idleRate,
    finalSeconds: d.idleRate > 0 ? req / d.idleRate : Number.POSITIVE_INFINITY,
    finalPatienceS: d.patienceMaxMs / 1000,
  };
}

/** Markdown table for the report. */
export function ceilingTable(): string {
  const rows = (['fresh', 'mid', 'deep', 'maxed'] as const).map((n) => ceiling(n, metaForBudget(n).meta));
  const lines = [
    '| save | capped tool output | final prompt needs | final prompt patience |',
    '|---|---:|---:|---:|',
  ];
  for (const r of rows) {
    const need = Number.isFinite(r.finalSeconds) ? `${r.finalSeconds.toFixed(0)} s` : 'never';
    lines.push(`| ${r.label} | ${formatTokens(r.cappedRate)}/s | ${need} | ${r.finalPatienceS.toFixed(0)} s |`);
  }
  return lines.join('\n');
}
