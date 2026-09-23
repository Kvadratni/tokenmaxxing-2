/**
 * Cartesian sweep: {policies} × {meta states} × {N seeds}, aggregated into the
 * numbers the balance targets are written in.
 */
import { FINAL_PROMPT_INDEX } from '@sim/index.ts';
import type { ClickModel, PolicyId, PolicyOptions } from './policy.ts';
import type { BuiltMeta, MetaStateName } from './meta.ts';
import { META_STATE_NAMES, metaForBudget } from './meta.ts';
import type { EndCause, RunResult } from './run.ts';
import { runOne } from './run.ts';

// ---------------------------------------------------------------------------
// Seeds and statistics
// ---------------------------------------------------------------------------

/** Deterministic, well-spread seed list. */
export function seeds(n: number, offset = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((i + offset) * 0x9e3779b1 + 0x2545f491) | 0 || 1);
  return out;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (i - lo);
}

export function median(values: readonly number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

/** Prompts a run actually played: every completed one plus the one it died on. */
export function promptsPlayed(r: Pick<RunResult, 'won' | 'reported'>): number {
  return r.won ? r.reported : r.reported + 1;
}

// ---------------------------------------------------------------------------
// Cell statistics
// ---------------------------------------------------------------------------

export interface CellStats {
  readonly policy: string;
  readonly metaName: string;
  readonly runs: number;
  readonly winRate: number;
  readonly medianReached: number;
  readonly meanReached: number;
  readonly p10Reached: number;
  readonly p90Reached: number;
  /** Share of runs ending on each 1-based prompt; index 11 is "won". */
  readonly endHistogram: readonly number[];
  readonly medianMinutes: number;
  /** Median length of the winning runs only; NaN when none won. */
  readonly medianWinMinutes: number;
  readonly p10WinMinutes: number;
  readonly p90WinMinutes: number;
  readonly forcedPerPrompt: number;
  readonly manualPerPrompt: number;
  /** Share of runs with at least one forced compaction. */
  readonly anyForced: number;
  readonly claimsPerRun: number;
  readonly caughtPerRun: number;
  readonly sycophancyPerRun: number;
  readonly meanThumbs: number;
  readonly medianThumbs: number;
  readonly meanPurchases: number;
  /** Mean seconds spent per completed prompt, by prompt index. */
  readonly secondsByPrompt: readonly number[];
  readonly causes: Readonly<Record<EndCause, number>>;
  readonly longestPromptRatio: number;
  readonly reportReadyRate: number;
  readonly tensionRate: number;
  readonly anyInvalid: boolean;
}

export function summarize(policy: string, metaName: string, results: readonly RunResult[]): CellStats {
  const n = results.length;
  const reached = results.map((r) => r.reachedPrompt).sort((a, b) => a - b);
  const wins = results.filter((r) => r.won);
  const winMinutes = wins.map((r) => r.elapsedS / 60).sort((a, b) => a - b);
  const endHistogram = new Array<number>(FINAL_PROMPT_INDEX + 3).fill(0);
  const causes: Record<EndCause, number> = { won: 0, patience: 0, caught: 0, compaction: 0, 'step-cap': 0 };
  let prompts = 0;
  let forced = 0;
  let manual = 0;
  let decisions = 0;
  let ready = 0;
  let tension = 0;
  const perPrompt: number[][] = [];
  for (const r of results) {
    const bucket = r.won ? FINAL_PROMPT_INDEX + 2 : r.reachedPrompt;
    endHistogram[bucket] = (endHistogram[bucket] ?? 0) + 1 / Math.max(1, n);
    causes[r.cause] += 1;
    prompts += promptsPlayed(r);
    forced += r.forcedCompactions;
    manual += r.manualCompactions;
    decisions += r.decisions;
    ready += r.reportReadyDecisions;
    tension += r.tensionDecisions;
    r.promptSeconds.forEach((s, i) => {
      const b = perPrompt[i] ?? (perPrompt[i] = []);
      b.push(s);
    });
  }
  return {
    policy,
    metaName,
    runs: n,
    winRate: n ? wins.length / n : 0,
    medianReached: quantile(reached, 0.5),
    meanReached: mean(reached),
    p10Reached: quantile(reached, 0.1),
    p90Reached: quantile(reached, 0.9),
    endHistogram,
    medianMinutes: median(results.map((r) => r.elapsedS / 60)),
    medianWinMinutes: winMinutes.length ? quantile(winMinutes, 0.5) : Number.NaN,
    p10WinMinutes: winMinutes.length ? quantile(winMinutes, 0.1) : Number.NaN,
    p90WinMinutes: winMinutes.length ? quantile(winMinutes, 0.9) : Number.NaN,
    forcedPerPrompt: prompts ? forced / prompts : 0,
    manualPerPrompt: prompts ? manual / prompts : 0,
    anyForced: n ? results.filter((r) => r.forcedCompactions > 0).length / n : 0,
    claimsPerRun: mean(results.map((r) => r.claimsPassed + r.caught)),
    caughtPerRun: mean(results.map((r) => r.caught)),
    sycophancyPerRun: mean(results.map((r) => r.sycophancy)),
    meanThumbs: mean(results.map((r) => r.thumbs)),
    medianThumbs: median(results.map((r) => r.thumbs)),
    meanPurchases: mean(results.map((r) => r.purchases)),
    secondsByPrompt: perPrompt.map((b) => mean(b)),
    causes,
    longestPromptRatio: Math.max(0, ...results.map((r) => r.longestPromptRatio)),
    reportReadyRate: decisions ? ready / decisions : 0,
    tensionRate: decisions ? tension / decisions : 0,
    anyInvalid: results.some((r) => r.invalid),
  };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export interface CellOptions {
  readonly clicks?: ClickModel;
  readonly stepMs?: number;
  readonly decisionEveryMs?: number;
  readonly policyOptions?: PolicyOptions;
}

export function runCell(
  policy: PolicyId,
  built: BuiltMeta,
  seedList: readonly number[],
  opts: CellOptions = {},
): RunResult[] {
  return seedList.map((seed) =>
    runOne({
      seed,
      policy,
      meta: built.meta,
      metaName: built.name,
      ...(opts.clicks ? { clicks: opts.clicks } : {}),
      ...(opts.stepMs ? { stepMs: opts.stepMs } : {}),
      ...(opts.decisionEveryMs ? { decisionEveryMs: opts.decisionEveryMs } : {}),
      ...(opts.policyOptions ? { policyOptions: opts.policyOptions } : {}),
    }),
  );
}

export interface SweepOptions extends CellOptions {
  readonly policies?: readonly PolicyId[];
  readonly metaStates?: readonly MetaStateName[];
  readonly seedCount?: number;
  readonly seedOffset?: number;
}

export interface SweepReport {
  readonly cells: readonly CellStats[];
  readonly metas: readonly BuiltMeta[];
  readonly seedCount: number;
  readonly wallMs: number;
}

export function sweep(opts: SweepOptions = {}): SweepReport {
  const started = Date.now();
  const policies = opts.policies ?? (['competent', 'careless'] as const);
  const names = opts.metaStates ?? META_STATE_NAMES;
  const seedList = seeds(opts.seedCount ?? 60, opts.seedOffset ?? 0);
  const metas = names.map((n) => metaForBudget(n));
  const cells: CellStats[] = [];
  for (const policy of policies) {
    for (const built of metas) {
      cells.push(summarize(policy, built.name, runCell(policy, built, seedList, opts)));
    }
  }
  return { cells, metas, seedCount: seedList.length, wallMs: Date.now() - started };
}
