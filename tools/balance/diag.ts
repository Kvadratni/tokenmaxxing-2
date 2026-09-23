/**
 * Instrumented runs: what the aggregate tables cannot show.
 *
 *  - **tiers**: for every tool tier, the moment its first unit became
 *    affordable in a competent run, what one unit would pay back, and whether
 *    it did pay back (integrating one unit's output at the run's real,
 *    evolving multipliers) before the run ended. "Prompts" are fractional
 *    positions in the run: 8.5 is halfway through prompt 9.
 *  - **incidents**: what each incident actually cost, in seconds of the
 *    run's clean production (tools and sustained clicking), plus its lump
 *    sums (wallet, patience, context).
 *    Pickups are traced in the same run, as \`pickup:<id>\`: what each paid.
 *
 * Every job is one seeded game; results are plain JSON so the jobs shard
 * over worker processes like the rest of the tooling.
 */
import type { GameEvent, MetaState, RunState, ToolId } from '@sim/types.ts';
import type { Sim } from '@sim/index.ts';
import {
  INCIDENT_BY_ID,
  PICKUP_BY_ID,
  TOOLS,
  aggregate,
  baseAggregate,
  computeDerived,
  effectSources,
  liveAggregate,
  promptAt,
  visibleToolList,
} from '@sim/index.ts';
import type { ClickModel, PolicyId, PolicyOptions } from './policy.ts';
import { HUMAN_CLICKS, averageCps, econOf } from './policy.ts';
import { runOne } from './run.ts';

/** `incidents` traces pickups too: they are costed from the same run. */
export type DiagKind = 'tiers' | 'incidents';

export interface DiagJob {
  readonly key: string;
  readonly kind: DiagKind;
  readonly seed: number;
  readonly policy: PolicyId;
  readonly meta: MetaState;
  readonly metaName: string;
  readonly clicks?: ClickModel;
  readonly policyOptions?: PolicyOptions;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Tokens/s the way the bot values them: tools, sustained clicking, crits and one-shots. */
function rateOf(run: RunState, meta: MetaState, cps: number, withIncidents: boolean): number {
  const agg = withIncidents ? liveAggregate(run, meta) : baseAggregate(run, meta);
  const d = computeDerived(run, meta, agg);
  return econOf(d, agg, { cps, compactMode: 'manual' }).rate;
}

/** Where the run is, as a fractional prompt position (0.5 = halfway through prompt 1). */
class PromptClock {
  private readonly starts: number[] = [0];
  note(sim: Sim): void {
    while (this.starts.length <= sim.run.promptIndex) this.starts.push(sim.run.elapsedMs);
  }
  pos(t: number, endMs: number): number {
    let i = 0;
    while (i + 1 < this.starts.length && (this.starts[i + 1] ?? Infinity) <= t) i++;
    const start = this.starts[i] ?? 0;
    const next = this.starts[i + 1] ?? Math.max(endMs, start + 1);
    return i + Math.min(1, Math.max(0, (t - start) / Math.max(1, next - start)));
  }
  /** Seconds the run spent on prompt `i` (to the end of the run for the last one). */
  lengthS(i: number, endMs: number): number {
    const start = this.starts[i] ?? 0;
    const next = this.starts[i + 1] ?? endMs;
    return Math.max(0, next - start) / 1000;
  }
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export interface TierTrace {
  readonly tier: number;
  readonly id: ToolId;
  /** Fractional prompt position when the first unit became affordable. */
  readonly firstPos: number;
  readonly cost: number;
  /** Cost over one unit's clean output at that moment, in seconds. */
  readonly instPaybackS: number;
  /** Seconds the run spent on the prompt it became affordable in. */
  readonly promptLenS: number;
  /** Fractional prompt position when one unit's integrated output reached the cost; null = never. */
  readonly paidPos: number | null;
  /** Fractional position of the first purchase; null = never bought. */
  readonly boughtPos: number | null;
  readonly endOwned: number;
  /** Share of the run's tool output this tier made at the final report (0 if none). */
  readonly endShare: number;
}

export interface TierRun {
  readonly won: boolean;
  readonly reached: number;
  readonly endPos: number;
  readonly tiers: readonly TierTrace[];
}

function traceTiers(job: DiagJob): TierRun {
  const clock = new PromptClock();
  type Live = { first: number; cost: number; inst: number; prompt: number; acc: number; paidAt: number | null };
  const live = new Map<ToolId, Live>();
  const bought = new Map<ToolId, number>();
  let shares: Record<string, number> = {};
  let steps = 0;

  let sinceS = 0;
  const onStep = (sim: Sim, stepMs: number): void => {
    clock.note(sim);
    steps += 1;
    sinceS += stepMs / 1000;
    if (sim.run.phase !== 'running') return;
    const run = sim.run;
    // Detection every step (the bot re-plans once a second); integration once a second.
    const integrate = steps % 5 === 0;
    const pending = TOOLS.some((t) => !live.has(t.id) && run.tools[t.id] === 0);
    if (!integrate && !pending) return;
    const agg = baseAggregate(run, sim.meta);
    const d = computeDerived(run, sim.meta, agg);
    const visible = visibleToolList(run, sim.meta);
    const dt = sinceS;
    if (integrate) sinceS = 0;
    for (const def of TOOLS) {
      const unit = def.baseRate * agg.toolMult[def.id] * agg.idleMult * agg.allMult;
      const l = live.get(def.id);
      if (!l) {
        if (!visible.includes(def) || run.tools[def.id] > 0) continue;
        const cost = d.nextCosts[def.id];
        if (!(run.tokens >= cost)) continue;
        live.set(def.id, { first: run.elapsedMs, cost, inst: unit > 0 ? cost / unit : Infinity, prompt: run.promptIndex, acc: 0, paidAt: null });
        continue;
      }
      if (l.paidAt !== null || !integrate) continue;
      l.acc += unit * dt;
      if (l.acc >= l.cost) l.paidAt = run.elapsedMs;
    }
  };
  const onEvent = (e: GameEvent, sim: Sim): void => {
    if (e.t === 'buyTool' && !bought.has(e.id)) bought.set(e.id, sim.run.elapsedMs);
    if (e.t === 'report' || e.t === 'claim') {
      const d = computeDerived(sim.run, sim.meta, baseAggregate(sim.run, sim.meta));
      const total = Math.max(1e-9, d.idleRate);
      shares = {};
      for (const def of TOOLS) shares[def.id] = d.toolRates[def.id] / total;
    }
  };
  const r = runOne({
    seed: job.seed,
    policy: job.policy,
    meta: job.meta,
    metaName: job.metaName,
    ...(job.clicks ? { clicks: job.clicks } : {}),
    ...(job.policyOptions ? { policyOptions: job.policyOptions } : {}),
    onStep,
    onEvent,
  });
  const endMs = r.elapsedS * 1000;
  const tiers: TierTrace[] = [];
  for (const def of TOOLS) {
    const l = live.get(def.id);
    if (!l) continue;
    const b = bought.get(def.id);
    tiers.push({
      tier: def.tier,
      id: def.id,
      firstPos: clock.pos(l.first, endMs),
      cost: l.cost,
      instPaybackS: l.inst,
      promptLenS: clock.lengthS(l.prompt, endMs),
      paidPos: l.paidAt === null ? null : clock.pos(l.paidAt, endMs),
      boughtPos: b === undefined ? null : clock.pos(b, endMs),
      endOwned: r.tools[def.id],
      endShare: shares[def.id] ?? 0,
    });
  }
  return { won: r.won, reached: r.reachedPrompt, endPos: clock.pos(endMs, endMs), tiers };
}

// ---------------------------------------------------------------------------
// Incidents and pickups
// ---------------------------------------------------------------------------

export interface CostRecord {
  /** Firings (or collections). */
  n: number;
  /** Seconds of clean production lost while active (negative: gained). */
  lostS: number;
  /** Wallet lost as a fraction of the requirement (negative: gained). */
  walletFrac: number;
  /** Patience lost, in seconds (negative: restored). */
  patienceS: number;
  /** Context added, as a fraction of the window (negative: freed). */
  contextFrac: number;
  /** Seconds active. */
  activeS: number;
}

export interface CostRun {
  readonly won: boolean;
  readonly reached: number;
  readonly elapsedS: number;
  readonly records: Readonly<Record<string, CostRecord>>;
}

function blank(): CostRecord {
  return { n: 0, lostS: 0, walletFrac: 0, patienceS: 0, contextFrac: 0, activeS: 0 };
}

/**
 * Incidents (pickup buffs are incidents too) are costed live: at every step,
 * the run's rate with the incident against the rate without it. Pickups that
 * are lump sums are costed at collection.
 */
function traceCosts(job: DiagJob): CostRun {
  const cps = averageCps(job.clicks ?? HUMAN_CLICKS);
  const records: Record<string, CostRecord> = {};
  const rec = (id: string): CostRecord => (records[id] ??= blank());

  const onStep = (sim: Sim, stepMs: number): void => {
    const run = sim.run;
    if (run.phase !== 'running' || run.incidents.length === 0) return;
    const clean = rateOf({ ...run, incidents: [] }, sim.meta, cps, false);
    if (!(clean > 0)) return;
    const all = rateOf(run, sim.meta, cps, true);
    const dt = stepMs / 1000;
    for (const inc of run.incidents) {
      const others = { ...run, incidents: run.incidents.filter((x) => x !== inc) };
      const agg = aggregate(effectSources(others, sim.meta, true));
      const d = computeDerived(others, sim.meta, agg);
      const without = econOf(d, agg, { cps, compactMode: 'manual' }).rate;
      const r = rec(inc.id);
      r.lostS += ((without - all) * dt) / clean;
      r.activeS += dt;
    }
  };
  const onEvent = (e: GameEvent, sim: Sim): void => {
    const run = sim.run;
    const req = promptAt(run.promptIndex).requirement;
    const d = sim.derived();
    if (e.t === 'incidentStart') {
      const def = INCIDENT_BY_ID[e.id];
      if (!def) return;
      const r = rec(e.id);
      r.n += 1;
      for (const a of def.onStart ?? []) {
        if (a.t === 'loseTokens') r.walletFrac += (Math.max(0, run.tokens) * a.fraction) / req;
        else if (a.t === 'tokens') r.walletFrac -= a.ofRequirement;
        else if (a.t === 'patience') r.patienceS -= (a.ofMax * d.patienceMaxMs) / 1000;
        else if (a.t === 'context') r.contextFrac += a.ofMax;
      }
      return;
    }
    if (e.t === 'pickupCollect') {
      const def = PICKUP_BY_ID[e.id];
      if (!def) return;
      const r = rec(`pickup:${e.id}`);
      r.n += 1;
      const a = def.action;
      if (a.t === 'tokens') r.walletFrac -= a.ofRequirement;
      else if (a.t === 'patience') {
        const room = Math.max(0, d.patienceMaxMs - run.patienceMs);
        r.patienceS -= Math.min(room, a.ofMax * d.patienceMaxMs) / 1000;
      } else if (a.t === 'context') r.contextFrac += a.ofMax;
      else if (a.t === 'freeTool') {
        // One more unit of the top tool fielded: its share of clean production, per second, as "seconds per second".
        let top: (typeof TOOLS)[number] | undefined;
        for (const t of TOOLS) if (run.tools[t.id] > 0 && run.tools[t.id] < t.maxOwned) top = t;
        const rate = rateOf(run, sim.meta, cps, false);
        if (top && rate > 0) {
          const agg = baseAggregate(run, sim.meta);
          r.lostS -= (top.baseRate * agg.toolMult[top.id] * agg.idleMult * agg.allMult) / rate;
        }
      }
    }
  };
  const r = runOne({
    seed: job.seed,
    policy: job.policy,
    meta: job.meta,
    metaName: job.metaName,
    ...(job.clicks ? { clicks: job.clicks } : {}),
    ...(job.policyOptions ? { policyOptions: job.policyOptions } : {}),
    onStep,
    onEvent,
  });
  return { won: r.won, reached: r.reachedPrompt, elapsedS: r.elapsedS, records };
}

export function playDiag(job: DiagJob): { key: string; seed: number; out: TierRun | CostRun } {
  const out = job.kind === 'tiers' ? traceTiers(job) : traceCosts(job);
  return { key: job.key, seed: job.seed, out };
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function med(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) / 2;
  const lo = s[Math.floor(i)] ?? 0;
  const hi = s[Math.ceil(i)] ?? lo;
  return (lo + hi) / 2;
}

export interface TierSummary {
  readonly tier: number;
  readonly id: ToolId;
  /** Share of runs in which the first unit ever became affordable. */
  readonly affordableRate: number;
  readonly medianFirstPos: number;
  readonly medianInstPaybackS: number;
  /** Instant payback over the length of the prompt it became affordable in. */
  readonly medianInstPrompts: number;
  /** Share of affordable runs where one unit paid for itself before the run ended. */
  readonly paidRate: number;
  /** Median prompts from affordable to paid back; runs that never paid count as infinite. */
  readonly medianPaidPrompts: number;
  /** Share of affordable runs where the bot bought one. */
  readonly boughtRate: number;
  readonly medianEndOwned: number;
  /** Median share of tool output at the final report, over runs that reached it. */
  readonly medianEndShare: number;
}

export function summarizeTiers(runs: readonly TierRun[]): TierSummary[] {
  const out: TierSummary[] = [];
  for (const def of TOOLS) {
    const ts = runs.flatMap((r) => r.tiers.filter((t) => t.id === def.id));
    if (ts.length === 0) continue;
    out.push({
      tier: def.tier,
      id: def.id,
      affordableRate: ts.length / Math.max(1, runs.length),
      medianFirstPos: med(ts.map((t) => t.firstPos)),
      medianInstPaybackS: med(ts.map((t) => t.instPaybackS)),
      medianInstPrompts: med(ts.map((t) => t.instPaybackS / Math.max(1, t.promptLenS))),
      paidRate: ts.filter((t) => t.paidPos !== null).length / ts.length,
      medianPaidPrompts: med(ts.map((t) => (t.paidPos === null ? Number.POSITIVE_INFINITY : t.paidPos - t.firstPos))),
      boughtRate: ts.filter((t) => t.boughtPos !== null).length / ts.length,
      medianEndOwned: med(ts.map((t) => t.endOwned)),
      medianEndShare: med(ts.map((t) => t.endShare)),
    });
  }
  return out;
}

export interface CostSummary {
  readonly id: string;
  readonly perRun: number;
  readonly lostS: number;
  readonly walletFrac: number;
  readonly patienceS: number;
  readonly contextFrac: number;
  readonly activeS: number;
}

/** Mean cost per firing, and firings per run. */
export function summarizeCosts(runs: readonly CostRun[]): CostSummary[] {
  const tot: Record<string, CostRecord> = {};
  for (const r of runs) {
    for (const [id, c] of Object.entries(r.records)) {
      const t = (tot[id] ??= blank());
      t.n += c.n;
      t.lostS += c.lostS;
      t.walletFrac += c.walletFrac;
      t.patienceS += c.patienceS;
      t.contextFrac += c.contextFrac;
      t.activeS += c.activeS;
    }
  }
  return Object.entries(tot)
    .map(([id, t]) => {
      const n = Math.max(1, t.n);
      return {
        id,
        perRun: t.n / Math.max(1, runs.length),
        lostS: t.lostS / n,
        walletFrac: t.walletFrac / n,
        patienceS: t.patienceS / n,
        contextFrac: t.contextFrac / n,
        activeS: t.activeS / n,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
