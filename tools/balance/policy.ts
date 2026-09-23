/**
 * Bot play policies for the headless balance simulator (Tokenmaxxing 2).
 *
 * Every policy drives the real `Sim` through its public API: it clicks, buys,
 * reports, claims, compacts, flatters the human, drafts and keeps cards. It
 * values purchases with the sim's own pure derivation (`computeDerived`,
 * `baseAggregate`) applied to hypothetical copies of `RunState`, so the bot can
 * never disagree with the HUD about what a purchase does.
 *
 * The valuation folds every in-run dial into one number, *effective tokens per
 * second*: raw production (tools, sustained clicking, crits and one-shots
 * averaged) minus what compaction destroys, plus rate-equivalents for patience,
 * sycophancy, claims, incidents, permissions and summary slots. That is what
 * lets the competent policy buy a footprint cut over a tool when the window is
 * the problem, and what makes Training's context nodes measurable at all.
 */
import type { CardId, DerivedStats, MetaState, RunState, ToolId } from '@sim/types.ts';
import type { Aggregate, Sim, UnlockedContent } from '@sim/index.ts';
import {
  AUTO_CLICK_POINT,
  BALANCE,
  CARD_BY_ID,
  FINAL_PROMPT_INDEX,
  PICKUP_TUNING,
  TOOLS,
  TOOL_BY_ID,
  availableUpgradeList,
  baseAggregate,
  computeDerived,
  patienceMaxOf,
  sycophancyPowerOf,
  visibleToolList,
} from '@sim/index.ts';

// ---------------------------------------------------------------------------
// Click model
// ---------------------------------------------------------------------------

export interface ClickModel {
  readonly id: string;
  /** Clicks per second while actively clicking. */
  readonly cps: number;
  /** Fraction of the run spent actively clicking, 0..1. */
  readonly uptime: number;
  /** Length of one click/rest cycle in ms. 0 smooths the rate instead. */
  readonly dutyPeriodMs: number;
}

/**
 * Engaged human play: 6 clicks/s bursts, clicking 70% of the time (the rest
 * is shopping, reading cards and looking at the human). About 4.2 clicks/s.
 */
export const HUMAN_CLICKS: ClickModel = { id: 'human', cps: 6, uptime: 0.7, dutyPeriodMs: 10_000 };

/** A slower, more casual clicker: 3 clicks/s, 70% of the time. About 2.1 clicks/s. */
export const SLOW_CLICKS: ClickModel = { id: 'slow', cps: 3, uptime: 0.7, dutyPeriodMs: 10_000 };

/** Time-averaged clicks per second: what purchase valuation assumes. */
export function averageCps(m: ClickModel): number {
  return m.cps * Math.max(0, Math.min(1, m.uptime));
}

/** Instantaneous click rate at a point in the duty cycle. */
export function instantCps(m: ClickModel, elapsedMs: number, phaseMs = 0): number {
  const up = Math.max(0, Math.min(1, m.uptime));
  if (!(m.dutyPeriodMs > 0)) return m.cps * up;
  const t = (((elapsedMs + phaseMs) % m.dutyPeriodMs) + m.dutyPeriodMs) % m.dutyPeriodMs;
  return t < m.dutyPeriodMs * up ? m.cps : 0;
}

// ---------------------------------------------------------------------------
// Policy configuration
// ---------------------------------------------------------------------------

export type PolicyId =
  | 'competent'
  | 'careless'
  | 'always-claim'
  | 'no-tools'
  | 'clicker'
  | 'syco-spam';

export const POLICY_IDS: readonly PolicyId[] = [
  'competent',
  'careless',
  'always-claim',
  'no-tools',
  'clicker',
  'syco-spam',
];

export interface PolicyConfig {
  readonly id: PolicyId;
  readonly buyTools: boolean;
  readonly buyUpgrades: boolean;
  /**
   * Context-aware valuation: compaction losses, patience, claims, incidents.
   * Off means "raw tokens per second is all that matters".
   */
  readonly smartValue: boolean;
  /** Spend whatever is affordable on the best rate-per-token, every decision. */
  readonly greedy: boolean;
  /** Uses /compact (when unlocked): after a report, and ahead of an overflow. */
  readonly manualCompact: boolean;
  /** Spends the wallet on tools before an overflow it cannot outrun (tools survive). */
  readonly dumpBeforeOverflow: boolean;
  /**
   * `doomed`: only when the honest report cannot be made in time.
   * `always`: the moment the amber button lights up.
   * `lastSecond`: a panicked press with seconds left.
   */
  readonly claim: 'never' | 'doomed' | 'always' | 'lastSecond';
  /**
   * `smart`: when patience is needed and the heat has cooled.
   * `panic`: only when the bar is nearly empty.
   * `spam`: every time the heat has cooled, needed or not.
   */
  readonly syco: 'never' | 'smart' | 'panic' | 'spam';
  /** Chance a drifting pickup gets clicked. */
  readonly pickupChance: number;
  /** Keep a patience reserve so the report earns the bonus 👍. */
  readonly holdForBonus: boolean;
}

export const POLICIES: Readonly<Record<PolicyId, PolicyConfig>> = {
  competent: {
    id: 'competent',
    buyTools: true,
    buyUpgrades: true,
    smartValue: true,
    greedy: false,
    manualCompact: true,
    dumpBeforeOverflow: true,
    claim: 'doomed',
    syco: 'smart',
    pickupChance: 0.85,
    holdForBonus: true,
  },
  careless: {
    id: 'careless',
    buyTools: true,
    buyUpgrades: true,
    smartValue: false,
    greedy: true,
    manualCompact: false,
    dumpBeforeOverflow: false,
    claim: 'lastSecond',
    syco: 'panic',
    pickupChance: 0.6,
    holdForBonus: false,
  },
  'always-claim': {
    id: 'always-claim',
    buyTools: true,
    buyUpgrades: true,
    smartValue: true,
    greedy: false,
    manualCompact: true,
    dumpBeforeOverflow: true,
    claim: 'always',
    syco: 'smart',
    pickupChance: 0.85,
    holdForBonus: false,
  },
  'no-tools': {
    id: 'no-tools',
    buyTools: false,
    buyUpgrades: true,
    smartValue: true,
    greedy: false,
    manualCompact: true,
    dumpBeforeOverflow: true,
    claim: 'doomed',
    syco: 'smart',
    pickupChance: 0.85,
    holdForBonus: true,
  },
  clicker: {
    id: 'clicker',
    buyTools: false,
    buyUpgrades: false,
    smartValue: true,
    greedy: false,
    manualCompact: true,
    dumpBeforeOverflow: false,
    claim: 'doomed',
    syco: 'smart',
    pickupChance: 0.85,
    holdForBonus: true,
  },
  'syco-spam': {
    id: 'syco-spam',
    buyTools: true,
    buyUpgrades: true,
    smartValue: true,
    greedy: false,
    manualCompact: true,
    dumpBeforeOverflow: true,
    claim: 'doomed',
    syco: 'spam',
    pickupChance: 0.85,
    holdForBonus: true,
  },
};

/** Experiment hooks: forbid or force specific content for A/B arms. */
export interface PolicyOptions {
  /** Upgrades the bot will never buy. */
  readonly banUpgrades?: readonly string[];
  /** Cards the bot will never draft (unless nothing else is offered). */
  readonly banCards?: readonly CardId[];
  /** Cards the bot drafts the moment they are offered. */
  readonly forceCards?: readonly CardId[];
  /** Overrides the policy's chance of clicking a drifting pickup (0 ignores them all). */
  readonly pickupChance?: number;
  /** Pickups the bot never clicks, whatever its chance. */
  readonly skipPickups?: readonly string[];
  /** Replace parts of the policy, e.g. a competent player who never /compacts. */
  readonly override?: Partial<Omit<PolicyConfig, 'id'>>;
}

// ---------------------------------------------------------------------------
// Economy model
// ---------------------------------------------------------------------------

/**
 * Tuning of the bot's own judgement. These are the bot's beliefs about the
 * game, not game numbers; they only need to be sane.
 */
export const JUDGEMENT = {
  /** Share of a prompt's patience a competent player expects to spend on it. */
  PROMPT_SHARE: 0.7,
  /**
   * Wallet at a compaction, as a fraction of a prompt's production, once the
   * player dumps it into tools first (forced) or compacts right after a
   * report (manual).
   */
  WALLET_AT_FORCED: 0.18,
  WALLET_AT_MANUAL: 0.1,
  /** Rate-equivalent weight of +100% patience: extra time is extra output. */
  PATIENCE_PRESSURE: 0.8,
  /** Fraction of production a bad-incident rate of 1.0 costs. */
  INCIDENT_COST: 0.06,
  /** Fraction of production a permission-prompt rate of 1.0 costs. */
  PERMISSION_COST: 0.05,
  /** Value of the claim fallback: rescued prompts, as a production share. */
  CLAIM_WEIGHT: 0.12,
  /** Value of one card kept through a compaction, as a production share. */
  SLOT_VALUE: 0.08,
  /** 👍 are the meta currency: a card's 👍 per prompt is worth this share. */
  THUMB_VALUE: 0.04,
  /**
   * Share of every later prompt's expected working time counted as purchase
   * horizon: tools keep producing for the rest of the run, so a purchase that
   * repays itself over the next few prompts is worth making now.
   */
  FUTURE_WEIGHT: 0.5,
  /** Safety factor on "can I still report in time after this purchase?". */
  FEASIBILITY: 0.88,
  /** Patience kept in hand above the bonus-👍 line, as a fraction of the bar. */
  BONUS_MARGIN: 0.06,
  /** Heat below which "You're absolutely right!" is considered cooled. */
  COOL_HEAT: 0.3,
  /** Smart sycophancy: only with the bar at or under this fraction. */
  SYCO_BELOW: 0.9,
  /** Panic sycophancy: only with the bar at or under this fraction. */
  PANIC_BELOW: 0.2,
  /** Seconds before an overflow that trigger a wallet dump / manual compact. */
  OVERFLOW_LEAD_S: 1.2,
  /** A doomed claim waits for the last seconds, in case the report comes good. */
  CLAIM_LATE_S: 4,
  /** Units of the top two tools on sale a drafter assumes it will add. */
  LOOKAHEAD_UNITS: 5,
  /** Weight of that projected run in a card's value (the rest is the present). */
  LOOKAHEAD_WEIGHT: 0.65,
  /** Reroll a draft when the best card improves the run by less than this. */
  REROLL_BELOW: 0.08,
  /** Upper bound on purchases per decision tick. */
  MAX_BUYS: 12,
  /** Candidates priced beyond this multiple of max(wallet, requirement) are skipped. */
  REACH: 2,
} as const;

export interface EconParams {
  /** Average human clicks per second. */
  readonly cps: number;
  /** How the player handles overflow: with /compact, forced only, or not at all. */
  readonly compactMode: 'manual' | 'forced' | 'ignore';
}

export interface Econ {
  /** Raw tokens/s: tools and clicks, crits and one-shots averaged in. */
  readonly rate: number;
  readonly clickHz: number;
  /** Context/s: tool footprint plus the context of every click. */
  readonly ctxRate: number;
  /** Seconds between compactions at this context rate. */
  readonly tc: number;
  /** Expected compactions per prompt. */
  readonly perPrompt: number;
  /** Share of production compaction destroys. */
  readonly lossFrac: number;
  /** rate × (1 − lossFrac). */
  readonly eff: number;
  /** Seconds a competent player expects to spend on a prompt. */
  readonly promptS: number;
}

function finiteOr(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

export function econOf(d: DerivedStats, agg: Aggregate, p: EconParams): Econ {
  const clickHz = p.cps + d.autoClickHz;
  const critEv = 1 + d.critChance * (d.critMult - 1);
  const oneShotEv = 1 + d.oneShotChance * d.oneShotPayoutS * (1000 / BALANCE.ONE_SHOT_ROLL_MS);
  const rate = Math.max(0, finiteOr(d.idleRate * oneShotEv + d.clickPower * clickHz * critEv, 0));
  const ctxRate = Math.max(0, finiteOr(d.contextRate + d.clickContext * clickHz, 0));
  const usable = Math.max(1, d.contextMax * (1 - BALANCE.SUMMARY_FRACTION) - d.contextFloor);
  const tc = ctxRate > 0 ? usable / ctxRate : Number.POSITIVE_INFINITY;
  const promptS = Math.max(10, (d.patienceMaxMs / 1000) * JUDGEMENT.PROMPT_SHARE);
  const perPrompt = Number.isFinite(tc) ? promptS / tc : 0;

  let lossPer = 0;
  if (p.compactMode === 'manual') {
    lossPer =
      (1 - d.compactKeepManual) * JUDGEMENT.WALLET_AT_MANUAL + BALANCE.MANUAL_COMPACT_MS / 1000 / promptS;
  } else if (p.compactMode === 'forced') {
    lossPer =
      (1 - d.compactKeepForced) * JUDGEMENT.WALLET_AT_FORCED +
      (BALANCE.COMPACT_PENALTY * agg.compactPenaltyMult * (d.patienceMaxMs / 1000)) / promptS;
  }
  const lossFrac = p.compactMode === 'ignore' ? 0 : Math.min(0.9, perPrompt * lossPer);
  return { rate, clickHz, ctxRate, tc, perPrompt, lossFrac, eff: rate * (1 - lossFrac), promptS };
}

/** A valuation view of the run: incidents and a /compact pause stripped. */
export interface View {
  readonly run: RunState;
  readonly agg: Aggregate;
  readonly d: DerivedStats;
  readonly e: Econ;
}

export function cleanRun(run: RunState): RunState {
  return { ...run, incidents: [], compactingMs: 0 };
}

export function viewOf(run: RunState, meta: MetaState, p: EconParams, agg?: Aggregate): View {
  const clean = cleanRun(run);
  const a = agg ?? baseAggregate(clean, meta);
  const d = computeDerived(clean, meta, a);
  return { run: clean, agg: a, d, e: econOf(d, a, p) };
}

function withTool(run: RunState, id: ToolId, n = 1): RunState {
  return { ...run, tools: { ...run.tools, [id]: run.tools[id] + n } };
}
function withUpgrade(run: RunState, id: string): RunState {
  return { ...run, owned: [...run.owned, id] };
}
function withCard(run: RunState, id: CardId): RunState {
  return { ...run, cards: [...run.cards, id] };
}
function withoutCard(run: RunState, id: CardId): RunState {
  return { ...run, cards: run.cards.filter((c) => c !== id) };
}

/**
 * What the save has unlocked. Training only changes between runs, so the
 * answer is cached per levels object: the lookup is one of the sim's
 * heavier calls and the bot asks it constantly.
 */
const unlockCache = new WeakMap<object, UnlockedContent>();
export function unlockedOf(sim: Sim): UnlockedContent {
  const key = sim.meta.levels;
  let u = unlockCache.get(key);
  if (!u) {
    u = sim.unlocked();
    unlockCache.set(key, u);
  }
  return u;
}

/** Share of raw tool output coming from tools that can be stalled by permission prompts. */
function permissionShare(d: DerivedStats): number {
  if (!(d.idleRate > 0)) return 0;
  let s = 0;
  for (const [id, r] of Object.entries(d.toolRates) as [ToolId, number][]) {
    if (TOOL_BY_ID[id].needsPermission) s += r;
  }
  return s / d.idleRate;
}

/**
 * Effective tokens/s gained by moving from `b` to `a`. With `smart` off only
 * raw production counts, which is how a careless player reads the shop.
 * `permissions` is false once Auto Mode has removed permission prompts: an
 * allowlist then has nothing left to allow.
 */
export function gainOf(b: View, a: View, smart: boolean, claims: boolean, permissions = true): number {
  if (!smart) return a.e.rate - b.e.rate;
  const base = Math.max(b.e.eff, 1e-9);
  let g = a.e.eff - b.e.eff;

  // Patience is time, and time is output.
  const pm = a.d.patienceMaxMs / b.d.patienceMaxMs - 1;
  if (Number.isFinite(pm)) g += base * pm * JUDGEMENT.PATIENCE_PRESSURE;

  // Sycophancy stretches the bar; its share of a prompt's time scales the value.
  const coldB = sycophancyPowerOf(b.agg, 0);
  const coldA = sycophancyPowerOf(a.agg, 0);
  if (coldA !== coldB && coldB > 0) {
    const pressesPerPrompt = (b.e.promptS * 1000) / BALANCE.SYCOPHANCY_HEAT_DECAY_MS;
    const share = Math.min(0.6, pressesPerPrompt * coldB * 0.5);
    g += base * share * (coldA / coldB - 1) * JUDGEMENT.PATIENCE_PRESSURE;
  }

  // Incidents cost output; permission prompts only halt their own tool.
  g -= base * JUDGEMENT.INCIDENT_COST * (a.d.incidentRateMult - b.d.incidentRateMult);
  if (permissions && b.agg.permissionMult > 0) {
    g +=
      base * JUDGEMENT.PERMISSION_COST * permissionShare(b.d) * (1 - a.agg.permissionMult / b.agg.permissionMult);
  }

  // The claim fallback: a lower verify chance or threshold rescues doomed prompts.
  if (claims) {
    const dv = b.d.verifyChance - a.d.verifyChance;
    const dt = b.d.claimThreshold - a.d.claimThreshold;
    const dp = b.agg.caughtPenaltyMult > 0 ? 1 - a.agg.caughtPenaltyMult / b.agg.caughtPenaltyMult : 0;
    g += base * JUDGEMENT.CLAIM_WEIGHT * (dv + 0.5 * dt + 0.2 * dp);
  }

  // One more summary slot keeps one more card through every compaction.
  const dSlots = a.d.summarySlots - b.d.summarySlots;
  if (dSlots !== 0) {
    const spare = Math.max(0, b.run.cards.length + 1 - b.d.summarySlots);
    const kept = dSlots > 0 ? Math.min(dSlots, spare) : dSlots;
    g += base * JUDGEMENT.SLOT_VALUE * Math.min(1, b.e.perPrompt) * kept;
  }
  return Number.isFinite(g) ? g : 0;
}

// ---------------------------------------------------------------------------
// Purchase candidates
// ---------------------------------------------------------------------------

export interface Candidate {
  readonly kind: 'tool' | 'upgrade';
  readonly id: string;
  readonly cost: number;
  /** Effective tokens/s gained (rate-equivalent). */
  readonly gain: number;
  /** Raw tokens/s gained. */
  readonly dRate: number;
  readonly payback: number;
  readonly affordable: boolean;
}

export function enumerateCandidates(
  sim: Sim,
  v: View,
  cfg: PolicyConfig,
  p: EconParams,
  ban: ReadonlySet<string> | null,
): Candidate[] {
  const meta = sim.meta;
  const wallet = Math.max(0, sim.run.tokens);
  const reach = Math.max(wallet, v.d.requirement) * JUDGEMENT.REACH;
  const claims = cfg.claim !== 'never';
  const permissions = !unlockedOf(sim).features.has('autoMode');
  const out: Candidate[] = [];

  if (cfg.buyTools) {
    const visible = visibleToolList(v.run, meta);
    const unlockedTools = unlockedOf(sim).tools;
    for (const def of visible) {
      const cost = v.d.nextCosts[def.id];
      if (v.d.headroom[def.id] <= 0 || !(cost > 0) || cost > reach) continue;
      const run1 = withTool(v.run, def.id);
      const d1 = computeDerived(run1, meta, v.agg);
      const a: View = { run: run1, agg: v.agg, d: d1, e: econOf(d1, v.agg, p) };
      let gain = gainOf(v, a, cfg.smartValue, claims);
      // The first unit of a tier also reveals the next one: value the pair.
      const next = TOOLS[def.tier];
      if (v.run.tools[def.id] === 0 && next && unlockedTools.has(next.id) && !visible.includes(next)) {
        const run2 = withTool(run1, next.id);
        const d2 = computeDerived(run2, meta, v.agg);
        const pair = gainOf(v, { run: run2, agg: v.agg, d: d2, e: econOf(d2, v.agg, p) }, cfg.smartValue, claims);
        const pairCost = cost + d1.nextCosts[next.id];
        if (pair > 0 && pairCost > 0 && pair / pairCost > gain / cost) gain = (pair / pairCost) * cost;
      }
      if (!(gain > 0)) continue;
      out.push({
        kind: 'tool',
        id: def.id,
        cost,
        gain,
        dRate: a.e.rate - v.e.rate,
        payback: cost / gain,
        affordable: cost <= wallet,
      });
    }
  }

  if (cfg.buyUpgrades) {
    for (const def of availableUpgradeList(v.run, meta)) {
      if (def.cost > reach || ban?.has(def.id)) continue;
      const run1 = withUpgrade(v.run, def.id);
      const a = viewOf(run1, meta, p);
      const gain = gainOf(v, a, cfg.smartValue, claims, permissions);
      if (!(gain > 0)) continue;
      out.push({
        kind: 'upgrade',
        id: def.id,
        cost: def.cost,
        gain,
        dRate: a.e.rate - v.e.rate,
        payback: def.cost / gain,
        affordable: def.cost <= wallet,
      });
    }
  }
  return out;
}

function execute(sim: Sim, c: Candidate): boolean {
  return c.kind === 'tool' ? sim.buyTool(c.id as ToolId, 1) : sim.buyUpgrade(c.id);
}

// ---------------------------------------------------------------------------
// Card valuation
// ---------------------------------------------------------------------------

/**
 * Where the run is heading: a few more units of the top tools on sale. Cards
 * last the whole run, and by the late prompts tools are nearly all of the
 * output, so a card is judged against this as well as against the present.
 */
export function projectedRun(run: RunState, meta: MetaState): RunState {
  const visible = visibleToolList(run, meta);
  const top = visible[visible.length - 1];
  if (!top) return run;
  let out = withTool(run, top.id, JUDGEMENT.LOOKAHEAD_UNITS);
  const below = visible[visible.length - 2];
  if (below) out = withTool(out, below.id, JUDGEMENT.LOOKAHEAD_UNITS);
  return out;
}

/** A card's rate-equivalent share of one view's effective output. */
function cardShare(before: View, id: CardId, meta: MetaState, cfg: PolicyConfig, p: EconParams): number {
  const after = viewOf(withCard(before.run, id), meta, p);
  return gainOf(before, after, cfg.smartValue, cfg.claim !== 'never') / Math.max(before.e.eff, 1e-9);
}

/**
 * A card's rate-equivalent value, as a fraction of effective output: a blend
 * of what it does now and what it does once the tools have grown. Its onPick
 * lump sums count too: a context dump costs a share of a compaction, a 👍 is
 * meta currency.
 */
export function cardValue(sim: Sim, id: CardId, cfg: PolicyConfig, p: EconParams, v?: View): number {
  const def = CARD_BY_ID[id];
  if (!def) return -1;
  const before = v ?? viewOf(sim.run, sim.meta, p);
  let score = cardShare(before, id, sim.meta, cfg, p);
  if (cfg.smartValue) {
    const ahead = viewOf(projectedRun(before.run, sim.meta), sim.meta, p);
    score = (1 - JUDGEMENT.LOOKAHEAD_WEIGHT) * score + JUDGEMENT.LOOKAHEAD_WEIGHT * cardShare(ahead, id, sim.meta, cfg, p);
    // 👍 per honest report: meta currency, lightly valued.
    const dh = viewOf(withCard(before.run, id), sim.meta, p).agg.thumbsPerHonest - before.agg.thumbsPerHonest;
    score += dh * JUDGEMENT.THUMB_VALUE;
    for (const a of def.onPick ?? []) {
      if (a.t === 'context' && a.ofMax > 0) {
        // A lump of context brings the next compaction closer.
        const lossPer = before.e.perPrompt > 0 ? before.e.lossFrac / before.e.perPrompt : 0.1;
        score -= a.ofMax * lossPer;
      } else if (a.t === 'thumbs') {
        score += a.n * JUDGEMENT.THUMB_VALUE * 2;
      }
    }
  }
  return Number.isFinite(score) ? score : -1;
}

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

/** Per-decision instrumentation. */
export interface DecisionLog {
  canReport: boolean;
  bought: number;
  reported: boolean;
  /** Able to report *and* a worthwhile purchase was on the table. */
  tension: boolean;
  /** Bought instead of reporting while able to report. */
  boughtOverReport: boolean;
}

/** A tiny deterministic generator for the bot's own dice (pickup reactions). */
function botRng(seed: number): () => number {
  let s = (seed ^ 0x2f6b_1d3c) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Bot {
  readonly cfg: PolicyConfig;
  /** Every simulation step while running: pickups, overflow, flattery, claims. */
  reflex(sim: Sim, cpsNow: number): void;
  /** On the decision cadence while running: shopping and reporting. */
  decide(sim: Sim): DecisionLog;
  /** phase === 'drafting': a card id, 'reroll', or null. */
  draft(sim: Sim): CardId | 'reroll' | null;
  /** phase === 'compacting': the cards to keep. */
  keep(sim: Sim): CardId[];
  /** The bot saw the prompt change (report or claim landed). */
  notePrompt(sim: Sim): void;
}

export function makeBot(
  policy: PolicyId | PolicyConfig,
  clicks: ClickModel,
  seed: number,
  opts: PolicyOptions = {},
): Bot {
  const base: PolicyConfig = typeof policy === 'string' ? POLICIES[policy] : policy;
  const cfg: PolicyConfig = opts.override ? { ...base, ...opts.override } : base;
  const cps = averageCps(clicks);
  const banUpgrades = opts.banUpgrades && opts.banUpgrades.length > 0 ? new Set(opts.banUpgrades) : null;
  const banCards = opts.banCards && opts.banCards.length > 0 ? new Set(opts.banCards) : null;
  const forceCards = opts.forceCards && opts.forceCards.length > 0 ? new Set(opts.forceCards) : null;
  const pickupChance = opts.pickupChance ?? cfg.pickupChance;
  const skipPickups = opts.skipPickups && opts.skipPickups.length > 0 ? new Set(opts.skipPickups) : null;
  const dice = botRng(seed);
  let pickupSeen: object | null = null;
  let pickupWanted = false;
  /** Set on a new prompt: the next running step considers a cheap /compact. */
  let freshPrompt = false;

  function params(sim: Sim): EconParams {
    if (!cfg.smartValue) return { cps, compactMode: 'ignore' };
    const manual = cfg.manualCompact && unlockedOf(sim).features.has('compact');
    return { cps, compactMode: manual ? 'manual' : 'forced' };
  }

  /** Patience the bot wants left when it reports: the bonus-👍 line, if still above it. */
  function reserveS(d: DerivedStats, patienceLeftS: number): number {
    if (!cfg.holdForBonus) return 0;
    const line = (BALANCE.BONUS_THUMB_PATIENCE_FRACTION + JUDGEMENT.BONUS_MARGIN) * (d.patienceMaxMs / 1000);
    return patienceLeftS > line ? line : 0;
  }

  /** Patience the bot expects "You're absolutely right!" to add over `seconds`. */
  function sycoBudgetS(sim: Sim, v: View, seconds: number): number {
    if (cfg.syco === 'never' || cfg.syco === 'panic') return 0;
    const cold = sycophancyPowerOf(v.agg, 0);
    const presses = (seconds * 1000) / BALANCE.SYCOPHANCY_HEAT_DECAY_MS;
    // Conservative: half the optimal cadence, minus the heat already built up.
    const heatPenalty = Math.pow(0.5, Math.max(0, sim.run.sycophancyHeat));
    return Math.max(0, presses * 0.5 * cold * heatPenalty * (v.d.patienceMaxMs / 1000));
  }

  /** Working seconds still to come after this prompt, discounted: the purchase horizon's tail. */
  function futureS(sim: Sim, promptIndex: number, agg: Aggregate): number {
    // Endless keeps going; count a few more prompts rather than forever.
    const last = unlockedOf(sim).features.has('endless') ? promptIndex + 3 : FINAL_PROMPT_INDEX;
    let s = 0;
    for (let i = promptIndex + 1; i <= last; i++) s += patienceMaxOf(i, agg) / 1000;
    return s * JUDGEMENT.PROMPT_SHARE * JUDGEMENT.FUTURE_WEIGHT;
  }

  function etaS(need: number, rate: number): number {
    if (need <= 0) return 0;
    return rate > 0 ? need / rate : Number.POSITIVE_INFINITY;
  }

  /** Shop until nothing passes, then report if the wallet covers the prompt. */
  function decide(sim: Sim): DecisionLog {
    const log: DecisionLog = { canReport: false, bought: 0, reported: false, tension: false, boughtOverReport: false };
    const p = params(sim);
    const live0 = sim.derived();
    log.canReport = live0.reportState === 'report';

    // A careless player reports first and shops with whatever is left.
    if (cfg.greedy) {
      if (live0.reportState === 'report') {
        log.reported = sim.report();
        if (log.reported) return log;
      }
      for (let i = 0; i < JUDGEMENT.MAX_BUYS; i++) {
        const v = viewOf(sim.run, sim.meta, p);
        let pick: Candidate | null = null;
        for (const c of enumerateCandidates(sim, v, cfg, p, banUpgrades)) {
          if (!c.affordable) continue;
          if (pick === null || c.gain / c.cost > pick.gain / pick.cost) pick = c;
        }
        if (!pick || !execute(sim, pick)) break;
        log.bought += 1;
      }
      return log;
    }

    let v = viewOf(sim.run, sim.meta, p);
    let cands = enumerateCandidates(sim, v, cfg, p, banUpgrades);
    let saving = false;
    for (let i = 0; i < JUDGEMENT.MAX_BUYS; i++) {
      saving = false;
      const run = sim.run;
      const req = v.d.requirement;
      const wallet = Math.max(0, run.tokens);
      const leftS = Math.max(0, run.patienceMs / 1000);
      const reserve = reserveS(v.d, leftS);
      const budgetS = Math.max(0, leftS - reserve) + sycoBudgetS(sim, v, leftS);
      const future = futureS(sim, run.promptIndex, v.agg);
      const horizon = budgetS + future;
      // On the last prompt nothing is left to invest for: only buy what
      // brings the report closer.
      const finalPrompt = future <= 0;
      const rate = Math.max(v.e.eff, 1e-9);
      const preEta = etaS(req - wallet, rate);
      const doomed = preEta > leftS + sycoBudgetS(sim, v, leftS);
      const claimFloor = cfg.claim === 'never' ? 0 : v.d.claimThreshold * req;

      const syco = sycoBudgetS(sim, v, leftS);

      // Rank by "time to afford + payback": saving up for a great buy beats
      // frittering the wallet on a mediocre one.
      const ranked = cands
        .filter((c) => c.payback <= horizon)
        .map((c) => ({ c, score: (c.affordable ? 0 : (c.cost - wallet) / rate) + c.payback }))
        .sort((a, b) => a.score - b.score);
      if (i === 0) log.tension = log.canReport && ranked.some((r) => r.c.affordable);

      let best: Candidate | null = null;
      for (const { c } of ranked) {
        // The best buy is out of reach: save for it, and do not spend the
        // savings on the report if saving, buying and re-earning the
        // requirement all fit in the patience budget.
        if (!c.affordable) {
          const waitS = (c.cost - wallet) / rate;
          const rebuildS = etaS(req, Math.max(1e-9, rate + c.gain));
          saving = !finalPrompt && waitS + rebuildS <= budgetS * JUDGEMENT.FEASIBILITY;
          break;
        }
        const after = wallet - c.cost;
        const postEta = etaS(req - after, Math.max(1e-9, rate + c.gain));
        // A purchase that pays back before the report would land brings the
        // report closer: always worth it. Otherwise it must leave the report
        // reachable inside the patience budget.
        const speedsUp = postEta < preEta * 0.98;
        const feasible = !finalPrompt && postEta <= budgetS * JUDGEMENT.FEASIBILITY;
        if (!speedsUp && !feasible) continue;
        // Out of time with a claim in hand: only spend it away if honest work
        // becomes plausible again.
        if (doomed && claimFloor > 0 && wallet >= claimFloor && after < claimFloor && postEta > (leftS + syco) * 1.1) {
          continue;
        }
        best = c;
        break;
      }
      if (!best) break;
      if (!execute(sim, best)) break;
      log.bought += 1;
      if (log.canReport) log.boughtOverReport = true;
      if (sim.run.phase !== 'running') break;
      // Tools leave the aggregate alone; upgrades change everything.
      v = best.kind === 'tool' ? viewOf(sim.run, sim.meta, p, v.agg) : viewOf(sim.run, sim.meta, p);
      cands =
        best.kind === 'tool'
          ? [
              ...enumerateCandidates(sim, v, { ...cfg, buyUpgrades: false }, p, banUpgrades),
              ...cands.filter((c) => c.kind === 'upgrade'),
            ]
          : enumerateCandidates(sim, v, cfg, p, banUpgrades);
    }

    if (!saving && sim.run.phase === 'running' && sim.derived().reportState === 'report') {
      log.reported = sim.report();
    }
    return log;
  }

  /**
   * Spend what an overflow would destroy. Only the share the compaction would
   * have kept is a real cost, so the payback bar drops accordingly.
   */
  function dumpWallet(sim: Sim, p: EconParams, keep: number): void {
    for (let i = 0; i < JUDGEMENT.MAX_BUYS; i++) {
      const v = viewOf(sim.run, sim.meta, p);
      const horizon = Math.max(0, sim.run.patienceMs / 1000) + futureS(sim, sim.run.promptIndex, v.agg);
      let pick: Candidate | null = null;
      for (const c of enumerateCandidates(sim, v, cfg, p, banUpgrades)) {
        if (!c.affordable || c.payback * keep > horizon) continue;
        if (pick === null || c.payback < pick.payback) pick = c;
      }
      if (!pick || !execute(sim, pick)) return;
      if (sim.run.phase !== 'running') return;
    }
  }

  function collectPickup(sim: Sim): void {
    const pk = sim.run.pickup;
    if (!pk) {
      pickupSeen = null;
      return;
    }
    if (pickupSeen !== pk) {
      pickupSeen = pk;
      pickupWanted = dice() < pickupChance && !skipPickups?.has(pk.id);
    }
    // A human needs a moment to notice it and move the mouse.
    if (pickupWanted && pk.ageS >= 0.9) {
      if (sim.collectPickup(pk.x, pk.y)) pickupSeen = null;
    }
  }

  function reflex(sim: Sim, cpsNow: number): void {
    if (sim.run.phase !== 'running') return;
    collectPickup(sim);
    if (sim.run.phase !== 'running') return;
    const p = params(sim);
    let d = sim.derived();

    // A new prompt with little in the wallet is the cheapest moment to /compact.
    if (freshPrompt) {
      freshPrompt = false;
      if (cfg.manualCompact && d.canCompact) {
        const ctxRate = d.contextRate + d.clickContext * (cps + d.autoClickHz);
        const room = d.contextMax - Math.max(sim.run.context, d.contextFloor);
        const expectS = (d.patienceMaxMs / 1000) * JUDGEMENT.PROMPT_SHARE;
        if (ctxRate > 0 && room / ctxRate < expectS && sim.run.context > d.contextMax * 0.25) {
          sim.compact();
          return;
        }
      }
    }

    // Overflow guard: dump the wallet into tools, then /compact on your own terms.
    const ctxRateNow = d.contextRate + d.clickContext * (cpsNow + d.autoClickHz);
    const toOverflow = ctxRateNow > 0 ? (d.contextMax - sim.run.context) / ctxRateNow : Number.POSITIVE_INFINITY;
    if (toOverflow < JUDGEMENT.OVERFLOW_LEAD_S && sim.run.compactingMs <= 0) {
      if (d.reportState === 'report') {
        if (sim.report()) return;
      }
      const manual = cfg.manualCompact && d.canCompact;
      if (cfg.dumpBeforeOverflow) dumpWallet(sim, p, manual ? d.compactKeepManual : d.compactKeepForced);
      if (sim.run.phase !== 'running') return;
      d = sim.derived();
      if (manual && d.canCompact) {
        sim.compact();
        return;
      }
    }

    // "You're absolutely right!"
    if (cfg.syco !== 'never' && d.sycophancyPower > 0) {
      const heat = sim.run.sycophancyHeat;
      const fill = d.patienceProgress;
      const fits = fill + d.sycophancyPower <= 1.001;
      const ctxOk = sim.run.context + BALANCE.CTX_PER_SYCOPHANCY < d.contextMax * 0.985;
      let press = false;
      if (cfg.syco === 'spam') {
        press = heat <= 0.05;
      } else if (cfg.syco === 'panic') {
        press = fill <= JUDGEMENT.PANIC_BELOW && heat <= 0.5 && ctxOk;
      } else if (heat <= JUDGEMENT.COOL_HEAT && fits && ctxOk && fill <= JUDGEMENT.SYCO_BELOW) {
        // Patience is investment time, so a cooled press that is not wasted
        // is worth it, unless the prompt is about to be reported anyway or the
        // window is so small that 300 tokens of flattery bring a compaction.
        if (d.reportState !== 'report') {
          const window = d.contextMax;
          const restoredS = d.sycophancyPower * (d.patienceMaxMs / 1000);
          const ctxRate = d.contextRate + d.clickContext * (cps + d.autoClickHz);
          const windowS = ctxRate > 0 ? BALANCE.CTX_PER_SYCOPHANCY / ctxRate : 0;
          press = window >= 64_000 || restoredS > windowS * 1.5;
        }
      }
      if (press) {
        sim.absolutelyRight();
        if (sim.run.phase !== 'running') return;
        d = sim.derived();
      }
    }

    // Claim Done.
    if (d.reportState === 'claim') {
      const leftS = sim.run.patienceMs / 1000;
      if (cfg.claim === 'always') {
        sim.claim();
      } else if (cfg.claim === 'lastSecond') {
        if (leftS <= 3) sim.claim();
      } else if (cfg.claim === 'doomed') {
        // Live numbers are enough here, and this runs every step in the amber band.
        const critEv = 1 + d.critChance * (d.critMult - 1);
        const rate = Math.max(1e-9, d.idleRate + d.clickPower * (cps + d.autoClickHz) * critEv);
        const need = etaS(d.requirement - sim.run.tokens, rate);
        const cold = d.sycophancyPower / Math.pow(0.5, Math.max(0, sim.run.sycophancyHeat));
        const syco = (s: number): number =>
          cfg.syco === 'smart' || cfg.syco === 'spam'
            ? ((s * 1000) / BALANCE.SYCOPHANCY_HEAT_DECAY_MS) * 0.5 * cold * (d.patienceMaxMs / 1000)
            : 0;
        // Honest work cannot land in time, so the lie is the only way through.
        if (need > (leftS + syco(leftS)) * 1.05) {
          if (leftS <= JUDGEMENT.CLAIM_LATE_S) {
            sim.claim();
          } else {
            // Two shots beat one: lie now if getting caught would still leave
            // time to rebuild the wallet to the claim line and lie again.
            const caughtMult = viewOf(sim.run, sim.meta, p).agg.caughtPenaltyMult;
            const penaltyS = BALANCE.CAUGHT_PENALTY * caughtMult * (d.patienceMaxMs / 1000);
            const afterS = leftS - penaltyS;
            const rebuildS = (d.claimThreshold * d.requirement) / rate;
            if (afterS > JUDGEMENT.CLAIM_LATE_S && rebuildS < (afterS + syco(afterS)) * 0.8) sim.claim();
          }
        }
      }
    }
  }

  function draft(sim: Sim): CardId | 'reroll' | null {
    const offer = sim.run.draftOffer;
    if (offer.length === 0) return null;
    if (forceCards) {
      const f = offer.find((c) => forceCards.has(c));
      if (f) return f;
    }
    const allowed = banCards ? offer.filter((c) => !banCards.has(c)) : offer.slice();
    const pool = allowed.length > 0 ? allowed : offer.slice();
    const p = params(sim);
    const v = viewOf(sim.run, sim.meta, p);
    let best: CardId | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const id of pool) {
      const s = cardValue(sim, id, cfg, p, v);
      if (s > bestScore) {
        bestScore = s;
        best = id;
      }
    }
    if (cfg.smartValue && sim.run.draftRerollsLeft > 0 && bestScore < JUDGEMENT.REROLL_BELOW) return 'reroll';
    return best;
  }

  function keep(sim: Sim): CardId[] {
    const s = sim.run.summary;
    if (!s) return [];
    const p = params(sim);
    // Marginal value of each held card: what the run loses without it, now
    // and once the tools have grown.
    const claims = cfg.claim !== 'never';
    const held = { ...sim.run, cards: s.offered.slice() };
    const full = viewOf(held, sim.meta, p);
    const ahead = viewOf(projectedRun(held, sim.meta), sim.meta, p);
    const w = cfg.smartValue ? JUDGEMENT.LOOKAHEAD_WEIGHT : 0;
    const scored = s.offered.map((id) => {
      const now = gainOf(viewOf(withoutCard(full.run, id), sim.meta, p), full, cfg.smartValue, claims);
      const later = gainOf(viewOf(withoutCard(ahead.run, id), sim.meta, p), ahead, cfg.smartValue, claims);
      const value = (1 - w) * (now / Math.max(full.e.eff, 1e-9)) + w * (later / Math.max(ahead.e.eff, 1e-9));
      return { id, value };
    });
    scored.sort((a, b) => b.value - a.value);
    return scored.slice(0, s.slots).map((x) => x.id);
  }

  return {
    cfg,
    reflex,
    decide,
    draft,
    keep,
    notePrompt: () => {
      freshPrompt = true;
    },
  };
}

/** Where the bot's clicks land. Cosmetic: the sim only counts them. */
export const CLICK_AT = AUTO_CLICK_POINT;

/** Re-exported so callers can size a hit test without importing content. */
export const PICKUP_RADIUS = PICKUP_TUNING.HIT_RADIUS;
