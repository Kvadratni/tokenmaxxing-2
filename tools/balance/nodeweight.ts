/**
 * Does every Training node pull its weight?
 *
 * Three paired experiments per node, all on one seed list:
 *
 *  - **purchase point**: the save just before the node's first level in the
 *    Training order, with and without the node at max level. What a player
 *    feels the run after buying it.
 *  - **mid toggle**: the mid save (≈50% wins, the most sensitive point) with
 *    the node knocked out if it owns it, or knocked in if it does not.
 *  - **maxed knock-out**: the maxed save without the node. Maxed wins almost
 *    always, so here the signal is speed (winning minutes) and 👍.
 *
 * A node "contributes" when any of its effects clears two standard errors:
 * strength score (prompts done plus progress), win rate, winning minutes,
 * 👍, compactions per prompt, or catches per run. Seeing the score *improve*
 * without it is flagged as harmful.
 */
import type { MetaState, MetaUpgradeId } from '@sim/types.ts';
import { META_BY_ID, META_UPGRADES, defaultMeta } from '@sim/index.ts';
import type { ArmSpec, ArmStats } from './analysis.ts';
import { runArms } from './analysis.ts';
import { EXCLUDED_FROM_MAXED, TRAINING_ORDER, metaForBudget } from './meta.ts';

export interface NodeEffect {
  readonly base: ArmStats;
  readonly arm: ArmStats;
  /** +1 when the arm adds the node, -1 when it removes it. */
  readonly sign: 1 | -1;
}

export interface NodeReport {
  readonly id: MetaUpgradeId;
  readonly name: string;
  readonly purchase: NodeEffect;
  readonly mid: NodeEffect;
  readonly maxed: NodeEffect;
  readonly verdict: 'strong' | 'contributes' | 'weak' | 'mixed' | 'dead' | 'harmful';
  readonly why: string;
}

/** The save right before `node` first appears in the Training order. */
export function prefixBefore(node: MetaUpgradeId): MetaState {
  const meta = defaultMeta();
  meta.legacy = { verdict: 'none' };
  const lv: Record<string, number> = {};
  for (const id of TRAINING_ORDER) {
    if (id === node) break;
    lv[id] = (lv[id] ?? 0) + 1;
    meta.levels[id] = lv[id] ?? 0;
  }
  return meta;
}

function withLevel(meta: MetaState, id: MetaUpgradeId, level: number): MetaState {
  const m = structuredClone(meta);
  m.levels[id] = level;
  return m;
}

/** Signed gain of the node on each metric (positive means the node helps), with standard errors. */
export interface NodeDeltas {
  readonly score: number;
  readonly scoreSe: number;
  readonly win: number;
  readonly winSe: number;
  /** Relative change in 👍 per run. */
  readonly thumbs: number;
  readonly thumbsSe: number;
  /** Winning minutes saved by owning the node. */
  readonly minutes: number;
  readonly minutesSe: number;
  /** Compactions per prompt (forced + manual) avoided by owning the node. */
  readonly compactions: number;
  readonly compactionsSe: number;
  /** Catches per run avoided by owning the node. */
  readonly caught: number;
  readonly caughtSe: number;
}

export function deltas(e: NodeEffect): NodeDeltas {
  const s = e.sign;
  const a = e.arm;
  const b = e.base;
  const winSe = Math.sqrt(
    (a.winRate * (1 - a.winRate)) / Math.max(1, a.runs) + (b.winRate * (1 - b.winRate)) / Math.max(1, b.runs),
  );
  const timed = Number.isFinite(a.medianWinMinutes) && Number.isFinite(b.medianWinMinutes);
  const thumbsBase = Math.max(1e-9, b.meanThumbs);
  return {
    score: s * (a.score - b.score),
    scoreSe: Math.hypot(a.scoreSe, b.scoreSe),
    win: s * (a.winRate - b.winRate),
    winSe,
    thumbs: (s * (a.meanThumbs - b.meanThumbs)) / thumbsBase,
    thumbsSe: Math.hypot(a.thumbsSe, b.thumbsSe) / thumbsBase,
    minutes: timed ? -s * (a.medianWinMinutes - b.medianWinMinutes) : 0,
    minutesSe: timed ? Math.hypot(a.winMinutesSe || 0, b.winMinutesSe || 0) || Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
    compactions: -s * (a.compactionsPerPrompt - b.compactionsPerPrompt),
    compactionsSe: Math.hypot(a.compactionsSe, b.compactionsSe),
    caught: -s * (a.caughtPerRun - b.caughtPerRun),
    caughtSe: Math.hypot(a.caughtSe, b.caughtSe),
  };
}

/** Standard errors an effect must clear to count, and the bar for "strong". */
export const NODE_BAR = { CLEAR: 2, STRONG: 4 } as const;

const METRICS = [
  { key: 'score', se: 'scoreSe', label: 'score', fmt: (v: number): string => `+${v.toFixed(2)}` },
  { key: 'win', se: 'winSe', label: 'win', fmt: (v: number): string => `+${Math.round(v * 100)}%` },
  { key: 'thumbs', se: 'thumbsSe', label: '👍', fmt: (v: number): string => `+${Math.round(v * 100)}%` },
  { key: 'minutes', se: 'minutesSe', label: 'faster', fmt: (v: number): string => `${v.toFixed(1)} min` },
  { key: 'compactions', se: 'compactionsSe', label: 'compactions/prompt', fmt: (v: number): string => `−${v.toFixed(2)}` },
  { key: 'caught', se: 'caughtSe', label: 'caught/run', fmt: (v: number): string => `−${v.toFixed(2)}` },
] as const;

function judge(effects: readonly NodeEffect[]): { verdict: NodeReport['verdict']; why: string } {
  const reasons: string[] = [];
  let strong = false;
  let harmful = false;
  for (const [i, e] of effects.entries()) {
    const where = ['purchase', 'mid', 'maxed'][i];
    const d = deltas(e);
    for (const m of METRICS) {
      const v = d[m.key];
      const se = d[m.se];
      if (!(se > 0) || !Number.isFinite(se)) continue;
      if (v > NODE_BAR.CLEAR * se) {
        reasons.push(`${where}: ${m.label} ${m.fmt(v)}`);
        if (v > NODE_BAR.STRONG * se) strong = true;
      }
    }
    if (d.scoreSe > 0 && -d.score > NODE_BAR.CLEAR * d.scoreSe) harmful = true;
  }
  if (reasons.length === 0) return { verdict: harmful ? 'harmful' : 'dead', why: 'no effect clears 2 standard errors' };
  // Helps on one axis, measurably hurts the run on another.
  if (harmful) return { verdict: 'mixed', why: `${reasons.join('; ')}; but the score drops with it` };
  if (strong) return { verdict: 'strong', why: reasons.join('; ') };
  return { verdict: reasons.length >= 2 ? 'contributes' : 'weak', why: reasons.join('; ') };
}

export interface NodeWeightOptions {
  readonly seedCount?: number;
  readonly workers?: number;
  readonly only?: readonly MetaUpgradeId[];
  /**
   * Nodes judged weak or dead get their mid toggle re-run with this many
   * seeds (a different seed list), and are judged again on the merged data.
   * Small real effects hide under the noise of a knife-edge save. 0 skips it.
   */
  readonly followUpSeeds?: number;
}

export async function nodeWeights(opts: NodeWeightOptions = {}): Promise<NodeReport[]> {
  const seedCount = opts.seedCount ?? 96;
  const workers = opts.workers ?? 1;
  const mid = metaForBudget('mid').meta;
  const maxed = metaForBudget('maxed').meta;
  const nodes = META_UPGRADES.filter(
    (d) => !EXCLUDED_FROM_MAXED.includes(d.id) && (!opts.only || opts.only.includes(d.id)),
  );

  const arms: ArmSpec[] = [
    { label: 'mid', policy: 'competent', meta: mid, metaName: 'mid' },
    { label: 'maxed', policy: 'competent', meta: maxed, metaName: 'maxed' },
  ];
  for (const def of nodes) {
    const pre = prefixBefore(def.id);
    arms.push({ label: `pre:${def.id}`, policy: 'competent', meta: pre, metaName: 'purchase' });
    arms.push({ label: `pre+${def.id}`, policy: 'competent', meta: withLevel(pre, def.id, def.maxLevel), metaName: 'purchase' });
    const owned = (mid.levels[def.id] ?? 0) > 0;
    arms.push({
      label: `mid~${def.id}`,
      policy: 'competent',
      meta: withLevel(mid, def.id, owned ? 0 : def.maxLevel),
      metaName: 'mid',
    });
    arms.push({ label: `maxed-${def.id}`, policy: 'competent', meta: withLevel(maxed, def.id, 0), metaName: 'maxed' });
  }
  const stats = new Map((await runArms(arms, seedCount, workers)).map((s) => [s.label, s]));
  const get = (k: string): ArmStats => {
    const s = stats.get(k);
    if (!s) throw new Error(`missing arm ${k}`);
    return s;
  };
  const first = nodes.map((def) => {
    const owned = (mid.levels[def.id] ?? 0) > 0;
    const purchase: NodeEffect = { base: get(`pre:${def.id}`), arm: get(`pre+${def.id}`), sign: 1 };
    const midEffect: NodeEffect = { base: get('mid'), arm: get(`mid~${def.id}`), sign: owned ? -1 : 1 };
    const maxedEffect: NodeEffect = { base: get('maxed'), arm: get(`maxed-${def.id}`), sign: -1 };
    const { verdict, why } = judge([purchase, midEffect, maxedEffect]);
    return { id: def.id, name: META_BY_ID[def.id]?.name ?? def.id, purchase, mid: midEffect, maxed: maxedEffect, verdict, why };
  });

  const followUp = opts.followUpSeeds ?? 0;
  const again = first.filter((n) => n.verdict === 'weak' || n.verdict === 'dead');
  if (followUp <= 0 || again.length === 0) return first;
  // A fresh seed list, so the follow-up is independent evidence.
  const more: ArmSpec[] = [{ label: 'mid', policy: 'competent', meta: mid, metaName: 'mid' }];
  for (const n of again) {
    const def = META_BY_ID[n.id];
    if (!def) continue;
    const owned = (mid.levels[n.id] ?? 0) > 0;
    more.push({ label: `mid~${n.id}`, policy: 'competent', meta: withLevel(mid, n.id, owned ? 0 : def.maxLevel), metaName: 'mid' });
  }
  const second = new Map((await runArms(more, followUp, workers, 10_000)).map((s) => [s.label, s]));
  return first.map((n) => {
    if (!again.includes(n)) return n;
    const base = second.get('mid');
    const arm = second.get(`mid~${n.id}`);
    if (!base || !arm) return n;
    const midEffect: NodeEffect = { base, arm, sign: n.mid.sign };
    const { verdict, why } = judge([n.purchase, midEffect, n.maxed]);
    return { ...n, mid: midEffect, verdict, why: `${why} (mid re-run on ${followUp} fresh seeds)` };
  });
}
