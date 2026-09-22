/**
 * All static game content. Owned by the balance pass — numbers here are tuned
 * by tools/balance, but the *shape* of the data is fixed by src/sim/types.ts.
 */
import type {
  AgentTierDef,
  AgentTierId,
  CardDef,
  CardId,
  IncidentDef,
  IncidentId,
  MetaUpgradeDef,
  ProjectDef,
  SceneKey,
  UpgradeDef,
  UpgradeId,
} from './types.ts';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

export const BALANCE = {
  /** Slop per click before any modifier. */
  BASE_CLICK: 3,
  /** S(N) = REQ_BASE * REQ_GROWTH^(N-1) */
  REQ_BASE: 100,
  // The concept sketched 5.5, but measurement killed it: with a ~52s agent
  // payback inside a ~100s deadline the player compounds their rate roughly
  // e^(T/payback) ~ 7x per project, and a drafted card adds ~1.6x on top. At
  // 5.5 the curve was outrun by project 4 and every run reached Demo Day in
  // ~1s per project. This is tuned against the target failure points instead
  // (see artifacts/balance/report.md).
  REQ_GROWTH: 15,
  /** T(N) = DEADLINE_BASE_MS * DEADLINE_DECAY^(N-1) */
  DEADLINE_BASE_MS: 120_000,
  DEADLINE_DECAY: 0.95,
  /** Shipping deducts the requirement from the wallet. */
  SHIP_DEDUCTS: true,
  /** Bonus Demo when this fraction of the deadline is left at ship time. */
  BONUS_DEMO_TIME_FRACTION: 0.25,
  /** Base seconds between incident rolls; actual roll is uniform in this range. */
  INCIDENT_MIN_MS: 25_000,
  INCIDENT_MAX_MS: 40_000,
  /** Grace period at the start of a project before incidents can fire. */
  INCIDENT_GRACE_MS: 12_000,
  /** Share of incident rolls that produce a *good* event. */
  GOOD_INCIDENT_CHANCE: 0.28,
  /** Chance a click is a crit, before any `critChance` effect. */
  CRIT_CHANCE: 0.04,
  CRIT_MULT: 7,
  /** Ceiling on stacked click crit chance. Crits must stay a gamble. */
  CRIT_CHANCE_CAP: 0.55,
  /**
   * One-shots are the idle-side crit: every roll window, an agent may nail the
   * task first try and dump a burst worth `oneShotPayoutS` seconds of output.
   * Base chance is zero — the whole mechanic is locked until something grants
   * `oneShotChance`, so it reads as a build you commit to rather than a tax.
   */
  ONE_SHOT_ROLL_MS: 1_000,
  ONE_SHOT_BASE_PAYOUT_S: 5,
  ONE_SHOT_CHANCE_CAP: 0.45,
  /** Largest dt the sim will integrate in one step (guards tab-throttle jumps). */
  MAX_STEP_MS: 250,
  /** Total dt beyond this is discarded rather than simulated (backgrounded tab). */
  MAX_CATCHUP_MS: 2_000,
  /** Celebration beat between shipping and the draft. */
  SHIP_BEAT_MS: 900,
  /** Deadline seconds at which the UI starts screaming. */
  WARN_AT_SECONDS: 10,
  DEFAULT_DRAFT_SIZE: 3,
  /**
   * Hard ceiling on units of any one agent tier. Without it the optimal play
   * is to buy tier 1 forever, and the ladder stops mattering.
   */
  MAX_PER_TIER: 60,
  /**
   * How strongly the incident-rate dial biases the bad bucket toward outages.
   * At mult 1 outages are rare; crank the risk upgrades and they dominate.
   */
  OUTAGE_BIAS: 1.6,
  /**
   * An outage must be able to finish this many ms before the deadline, or it
   * does not fire at all. Stops the game stealing a won run at the buzzer.
   */
  OUTAGE_FAIRNESS_MARGIN_MS: 4_000,
} as const;

export const PROJECT_NAMES = [
  'Todo App',
  'SaaS Landing Page',
  'Chrome Extension',
  'CRUD MVP',
  'Crypto Dashboard',
  'AI Wrapper Startup',
  'Uber-for-X',
  'Enterprise Migration',
  'Government Contract',
  'Rewrite Twitter in a Weekend',
] as const;

const PROJECT_SCENES: readonly SceneKey[] = [
  'bedroom',
  'bedroom',
  'coworking',
  'coworking',
  'openplan',
  'openplan',
  'datacenter',
  'datacenter',
  'orbital',
  'orbital',
];

export const FINAL_PROJECT_INDEX = PROJECT_NAMES.length - 1;

export function projectRequirement(index: number): number {
  return BALANCE.REQ_BASE * Math.pow(BALANCE.REQ_GROWTH, index);
}

export function projectDeadlineMs(index: number): number {
  return BALANCE.DEADLINE_BASE_MS * Math.pow(BALANCE.DEADLINE_DECAY, index);
}

/** Endless mode keeps generating projects past index 9. */
export function projectAt(index: number): ProjectDef {
  const name =
    index <= FINAL_PROJECT_INDEX
      ? PROJECT_NAMES[index]!
      : `Rewrite Twitter Again (×${index - FINAL_PROJECT_INDEX + 1})`;
  const scene = PROJECT_SCENES[Math.min(index, PROJECT_SCENES.length - 1)]!;
  return {
    index,
    name,
    requirement: projectRequirement(index),
    deadlineMs: projectDeadlineMs(index),
    scene,
  };
}

export const PROJECTS: readonly ProjectDef[] = PROJECT_NAMES.map((_, i) => projectAt(i));

// ---------------------------------------------------------------------------
// Agent tiers
// ---------------------------------------------------------------------------

// Production must grow ~5.79x per project to keep pace with
// REQ_GROWTH / DEADLINE_DECAY. Two dials control how fast it actually grows:
//
//   payback  - how much rate one slop buys, i.e. the reinvestment multiplier
//              over a project. Short paybacks let the wallet compound out of
//              control; at 24s the curve broke away at project 4.
//   growth   - the ladder step. Kept BELOW REQ_GROWTH (5.5) on purpose, so
//              climbing tiers alone can never outrun the requirement; the
//              player has to stack quantity and multipliers too.
// Early tiers pay back fast so the first minute is about *deciding*, not
// grinding clicks; late tiers pay back slowly so they stay real commitments.
/**
 * Back-loaded curves for the three tree nodes that provably move the production
 * ceiling. Measured with `tools/balance/nodeweight.ts`: every other levelled
 * node contributed zero or *negative* win rate at the top of the tree, so the
 * last ~500 Demos bought nothing. These are linear no longer — the low levels
 * are deliberately weaker than before and the top levels far stronger, so
 * finishing the tree is worth the Demos it costs.
 */
export const META_CURVES = {
  /** `allMult` — the whole-economy multiplier. */
  FOUNDER_MODE: [1.03, 1.07, 1.14, 1.32, 1.68, 2.3] as const,
  /** `deadlineMult` — the only lever that already measured positive. */
  SCOPE_NEGOTIATOR: [1.05, 1.12, 1.24, 1.46] as const,
  /** `agentCostMult` — compounds hard against the exponential cost curve. */
  TECHNICAL_COFOUNDER: [0.95, 0.86, 0.7] as const,
} as const;

/** Level -> value from a curve, clamped to the ends. 0 means "not owned". */
export function metaCurve(curve: readonly number[], level: number, unowned: number): number {
  if (!(level > 0)) return unowned;
  const i = Math.min(Math.floor(level), curve.length) - 1;
  return curve[i] ?? unowned;
}

const TIER_RATE_BASE = 0.8;
const TIER_RATE_GROWTH = 5.2;
const TIER_PAYBACK_BASE_S = 52;
const TIER_PAYBACK_GROWTH = 1.17;

function tierRate(tier: number): number {
  return TIER_RATE_BASE * Math.pow(TIER_RATE_GROWTH, tier - 1);
}
function tierCost(tier: number): number {
  const payback = TIER_PAYBACK_BASE_S * Math.pow(TIER_PAYBACK_GROWTH, tier - 1);
  return Math.round(tierRate(tier) * payback);
}

interface TierSeed {
  id: AgentTierId;
  name: string;
  blurb: string;
  clutterSprite: string;
}

const TIER_SEEDS: readonly TierSeed[] = [
  {
    id: 'tab_autocomplete',
    name: 'Tab Autocomplete',
    blurb: 'Finishes your line before you know what it was.',
    clutterSprite: 'clutter_duck',
  },
  {
    id: 'copy_paste_chatbot',
    name: 'Copy-Paste Chatbot',
    blurb: 'Alt-tab, paste, pray, paste back.',
    clutterSprite: 'clutter_mug',
  },
  {
    id: 'agentic_ide',
    name: 'Agentic IDE',
    blurb: 'It edits files now. You watch, mostly.',
    clutterSprite: 'clutter_monitor',
  },
  {
    id: 'cli_agent',
    name: 'CLI Agent',
    blurb: 'No GUI, no mercy, no undo.',
    clutterSprite: 'clutter_terminal',
  },
  {
    id: 'subagent_swarm',
    name: 'Subagent Swarm',
    blurb: 'Twelve of them. None of them talk to each other.',
    clutterSprite: 'clutter_swarm',
  },
  {
    id: 'ralph_loop',
    name: 'Ralph Loop',
    blurb: 'while true; do agent; done. It has been three days.',
    clutterSprite: 'clutter_loop',
  },
  {
    id: 'multi_harness',
    name: 'Multi-Harness Orchestrator',
    blurb: 'A harness for your harnesses. Yes, really.',
    clutterSprite: 'clutter_rack',
  },
  {
    id: 'background_fleet',
    name: 'Background Fleet',
    blurb: 'You stopped reading the diffs at PR #4,000.',
    clutterSprite: 'clutter_fleet',
  },
  {
    id: 'finetune_farm',
    name: 'Fine-tune Farm',
    blurb: 'Your slop, trained on your slop, producing more slop.',
    clutterSprite: 'clutter_gpuwall',
  },
  {
    id: 'agi',
    name: 'AGI',
    blurb: 'It asked for equity. You said yes.',
    clutterSprite: 'clutter_agi',
  },
];

export const AGENT_TIERS: readonly AgentTierDef[] = TIER_SEEDS.map((seed, i) => ({
  ...seed,
  tier: i + 1,
  baseCost: tierCost(i + 1),
  baseRate: tierRate(i + 1),
  costGrowth: 1.15,
  revealAfterPrevOwned: i === 0 ? 0 : 1,
  maxOwned: BALANCE.MAX_PER_TIER,
}));

export const AGENT_TIER_IDS: readonly AgentTierId[] = AGENT_TIERS.map((t) => t.id);

export const AGENT_BY_ID: Readonly<Record<AgentTierId, AgentTierDef>> = Object.fromEntries(
  AGENT_TIERS.map((t) => [t.id, t]),
) as Record<AgentTierId, AgentTierDef>;

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

export const UPGRADES: readonly UpgradeDef[] = [
  // --- click line ---
  {
    id: 'mech_keyboard',
    name: 'Mechanical Keyboard',
    blurb: 'Blues. Your roommate has opinions. ×2 click.',
    kind: 'click',
    cost: 100,
    effects: [{ t: 'clickMult', v: 2 }],
  },
  {
    id: 'vim_motions',
    name: 'Vim Motions',
    blurb: 'ciw, dd, :wq. You can leave whenever you want. ×2.5 click.',
    kind: 'click',
    cost: 1_100,
    effects: [{ t: 'clickMult', v: 2.5 }],
    requires: { upgrade: 'mech_keyboard' },
  },
  {
    id: 'macros',
    name: 'Keyboard Macros',
    blurb: 'One key, forty keystrokes, zero understanding. ×3 click.',
    kind: 'click',
    cost: 14_000,
    effects: [{ t: 'clickMult', v: 3 }],
    requires: { upgrade: 'vim_motions' },
  },
  {
    id: 'emacs_pinky',
    name: 'Emacs Pinky',
    blurb: 'Worth it. ×4 click.',
    kind: 'click',
    cost: 220_000,
    effects: [{ t: 'clickMult', v: 4 }],
    requires: { upgrade: 'macros' },
  },
  {
    id: 'neural_interface',
    name: 'Neural Interface',
    blurb: 'You think the slop directly into main. ×6 click.',
    kind: 'click',
    cost: 6_500_000,
    effects: [{ t: 'clickMult', v: 6 }],
    requires: { upgrade: 'emacs_pinky' },
  },

  // --- automation: the no-click path -------------------------------------
  // These fire *real* clicks, so they take click power, can crit, and clear
  // click-to-fix incidents. Stack them and the game plays itself; skip them
  // and clicking stays the strongest early lever. Both are viable builds.
  {
    id: 'autoclicker',
    name: 'Autoclicker',
    blurb: 'A weight on the spacebar. 2 clicks/sec, hands free.',
    kind: 'click',
    cost: 180,
    effects: [{ t: 'autoClick', v: 2 }],
  },
  {
    id: 'cron_job',
    name: 'Cron Job',
    blurb: '*/1 * * * * ship. 5 clicks/sec.',
    kind: 'click',
    cost: 2_400,
    effects: [{ t: 'autoClick', v: 5 }],
    requires: { upgrade: 'autoclicker' },
  },
  {
    id: 'ci_on_push',
    name: 'Build On Push',
    blurb: 'Every commit triggers everything. 14 clicks/sec.',
    kind: 'click',
    cost: 45_000,
    effects: [{ t: 'autoClick', v: 14 }],
    requires: { upgrade: 'cron_job' },
  },
  {
    id: 'daemon_mode',
    name: 'Daemon Mode',
    blurb: 'It survives reboots now. 120 clicks/sec.',
    kind: 'click',
    cost: 40_000_000,
    effects: [{ t: 'autoClick', v: 120 }],
    requires: { upgrade: 'headless_loop' },
  },
  {
    id: 'headless_loop',
    name: 'Headless Loop',
    blurb: 'You closed the laptop an hour ago. 40 clicks/sec.',
    kind: 'click',
    cost: 1_200_000,
    effects: [{ t: 'autoClick', v: 40 }],
    requires: { upgrade: 'ci_on_push' },
  },

  // --- agent economy ---
  {
    id: 'prompt_caching',
    name: 'Prompt Caching',
    blurb: 'Same prompt, cheaper bill. Agents cost −15%.',
    kind: 'agent',
    cost: 600,
    effects: [{ t: 'agentCostMult', v: 0.85 }],
  },
  {
    id: 'bigger_context',
    name: 'Bigger Context Window',
    blurb: 'It can finally see the whole file. +30% idle.',
    kind: 'agent',
    cost: 2_800,
    effects: [{ t: 'idleMult', v: 1.3 }],
  },
  {
    id: 'model_router',
    name: 'Model Router',
    blurb: 'Cheap model for cheap problems. Agents cost −15%.',
    kind: 'agent',
    cost: 48_000,
    effects: [{ t: 'agentCostMult', v: 0.85 }],
    requires: { upgrade: 'prompt_caching' },
  },
  {
    id: 'mcp_servers',
    name: 'MCP Servers',
    blurb: 'Now it can read your Jira. +35% idle.',
    kind: 'agent',
    cost: 26_000,
    effects: [{ t: 'idleMult', v: 1.35 }],
    requires: { agent: { id: 'agentic_ide', owned: 5 } },
  },
  {
    id: 'claude_md',
    name: 'CLAUDE.md',
    blurb: 'Six hundred lines of "DO NOT". +15% everything.',
    kind: 'global',
    cost: 75_000,
    effects: [{ t: 'allMult', v: 1.15 }],
  },
  {
    id: 'speculative_decoding',
    name: 'Speculative Decoding',
    blurb: 'Guess ahead, throw away the wrong guesses. +50% idle.',
    kind: 'agent',
    cost: 1_900_000,
    effects: [{ t: 'idleMult', v: 1.5 }],
    requires: { upgrade: 'bigger_context' },
  },
  {
    id: 'distillation',
    name: 'Distillation',
    blurb: 'Small model, big model\'s bad habits. +25% everything.',
    kind: 'global',
    cost: 28_000_000,
    effects: [{ t: 'allMult', v: 1.25 }],
    requires: { upgrade: 'claude_md' },
  },

  // --- crit: the human track -------------------------------------------
  // Cheap and available from the first run, because clicking *is* the early
  // game. A hand-clicker needs something to build toward before agents land.
  {
    id: 'flow_state',
    name: 'Flow State',
    blurb: 'Nothing exists but the diff. +8% crit chance.',
    kind: 'click',
    cost: 900,
    effects: [{ t: 'critChance', v: 0.08 }],
  },
  {
    id: 'hyperfocus',
    name: 'Hyperfocus',
    blurb: 'Four hours gone. +9% crit chance.',
    kind: 'click',
    cost: 9_500,
    effects: [{ t: 'critChance', v: 0.09 }],
    requires: { upgrade: 'flow_state' },
  },

  // --- crit: the agent track ---------------------------------------------
  // Gated, because one-shots multiply idle output and idle is the channel that
  // already scales hardest. You commit to this build; you do not stumble into it.
  {
    id: 'one_shot',
    name: 'One-Shot',
    blurb: 'Sometimes the agent just gets it. 8% chance per second.',
    kind: 'agent',
    cost: 55_000,
    effects: [{ t: 'oneShotChance', v: 0.08 }],
    requires: { agent: { id: 'cli_agent', owned: 3 } },
  },
  {
    id: 'eval_harness',
    name: 'Eval Harness',
    blurb: 'Measure it and it stops lying. +7% one-shot.',
    kind: 'agent',
    cost: 400_000,
    effects: [{ t: 'oneShotChance', v: 0.07 }],
    requires: { upgrade: 'one_shot' },
  },
  {
    id: 'best_of_n',
    name: 'Best-of-N',
    blurb: 'Generate eight, keep one. +10% one-shot, +3s payout.',
    kind: 'agent',
    cost: 4_500_000,
    effects: [
      { t: 'oneShotChance', v: 0.1 },
      { t: 'oneShotPayout', v: 3 },
    ],
    requires: { upgrade: 'eval_harness' },
  },

  // --- tier boosters ---
  {
    id: 'muscle_memory',
    name: 'Copilot Muscle Memory',
    blurb: 'Tab. Tab. Tab. ×5 Tab Autocomplete.',
    kind: 'agent',
    cost: 3_400,
    effects: [{ t: 'tierMult', id: 'tab_autocomplete', v: 5 }],
    requires: { agent: { id: 'tab_autocomplete', owned: 10 } },
  },
  {
    id: 'subagent_sharding',
    name: 'Subagent Sharding',
    blurb: 'Disjoint file ownership. Mostly. ×3 Subagent Swarm.',
    kind: 'agent',
    cost: 520_000,
    effects: [{ t: 'tierMult', id: 'subagent_swarm', v: 3 }],
    requires: { agent: { id: 'subagent_swarm', owned: 3 } },
  },
  {
    id: 'gpu_interconnect',
    name: 'NVLink Interconnect',
    blurb: 'The GPUs gossip at 900GB/s. ×3 Fine-tune Farm.',
    kind: 'agent',
    cost: 90_000_000,
    effects: [{ t: 'tierMult', id: 'finetune_farm', v: 3 }],
    requires: { agent: { id: 'finetune_farm', owned: 2 } },
  },

  // --- risk knobs ---
  {
    id: 'yolo_mode',
    name: 'YOLO Mode',
    blurb: 'Auto-accept every edit. +50% idle, +60% incidents.',
    kind: 'risk',
    cost: 9_000,
    effects: [
      { t: 'idleMult', v: 1.5 },
      { t: 'incidentRateMult', v: 1.6 },
    ],
  },
  {
    id: 'skip_permissions',
    name: '--dangerously-skip-permissions',
    blurb: 'The flag is named after what happens. +50% all, +75% incidents.',
    kind: 'risk',
    cost: 300_000,
    effects: [
      { t: 'allMult', v: 1.5 },
      { t: 'incidentRateMult', v: 1.75 },
    ],
    requires: { upgrade: 'yolo_mode' },
  },
  {
    id: 'ci_gate',
    name: 'CI Gate',
    blurb: 'Slower, but the pager stays quiet. −35% incidents.',
    kind: 'risk',
    cost: 40_000,
    effects: [{ t: 'incidentRateMult', v: 0.65 }],
  },

  // --- locations ---------------------------------------------------------
  // The room is bought, not granted. Each one is a big, visible, deliberate
  // purchase: it changes the whole backdrop and gives a modest global bump.
  // The bedroom is where you start, so it is not in this list.
  {
    id: 'loc_coworking',
    name: 'Coworking Space',
    blurb: 'A desk, a monstera, and someone else\'s cold brew. +10% everything.',
    kind: 'location',
    cost: 4_000,
    effects: [{ t: 'allMult', v: 1.1 }],
    scene: 'coworking',
  },
  {
    id: 'loc_openplan',
    name: 'Open-Plan Office',
    blurb: 'Rows of identical desks. Nobody has spoken aloud in a week. +12% everything.',
    kind: 'location',
    cost: 180_000,
    effects: [{ t: 'allMult', v: 1.12 }],
    requires: { upgrade: 'loc_coworking' },
    scene: 'openplan',
  },
  {
    id: 'loc_datacenter',
    name: 'Your Own Data Center',
    blurb: 'Cold aisle, hot aisle, and a badge reader you keep losing. +15% everything.',
    kind: 'location',
    cost: 9_000_000,
    effects: [{ t: 'allMult', v: 1.15 }],
    requires: { upgrade: 'loc_openplan' },
    scene: 'datacenter',
  },
  {
    id: 'loc_orbital',
    name: 'Orbital GPU Cluster',
    blurb: 'Free cooling. Terrible commute. +18% everything.',
    kind: 'location',
    cost: 600_000_000,
    effects: [{ t: 'allMult', v: 1.18 }],
    requires: { upgrade: 'loc_datacenter' },
    scene: 'orbital',
  },
];

/**
 * Locations in ladder order, cheapest first. `null` is the free starting room.
 */
export const LOCATION_ORDER: readonly (UpgradeId | null)[] = [
  null,
  'loc_coworking',
  'loc_openplan',
  'loc_datacenter',
  'loc_orbital',
];

export const STARTING_SCENE: SceneKey = 'bedroom';

/**
 * The backdrop the player has actually paid for — the furthest location they
 * own, or the bedroom. Deliberately not a function of the project number.
 */
export function currentScene(owned: readonly UpgradeId[]): SceneKey {
  let scene = STARTING_SCENE;
  for (const id of LOCATION_ORDER) {
    if (id === null) continue;
    if (!owned.includes(id)) break;
    scene = UPGRADE_BY_ID[id]?.scene ?? scene;
  }
  return scene;
}

export const UPGRADE_BY_ID: Readonly<Record<string, UpgradeDef>> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u]),
);

// ---------------------------------------------------------------------------
// Draft cards
// ---------------------------------------------------------------------------

export const CARDS: readonly CardDef[] = [
  {
    id: 'opus',
    name: 'Opus',
    blurb: 'Agents produce ×3. Agents cost ×3.',
    rarity: 'uncommon',
    effects: [
      { t: 'idleMult', v: 3 },
      { t: 'agentCostMult', v: 3 },
    ],
  },
  {
    id: 'haiku',
    name: 'Haiku',
    blurb: 'Agents cost −60%. Idle ×0.8.',
    rarity: 'common',
    effects: [
      { t: 'agentCostMult', v: 0.4 },
      { t: 'idleMult', v: 0.8 },
    ],
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    blurb: 'The reasonable one. Idle ×1.8, agents −10%.',
    rarity: 'common',
    effects: [
      { t: 'idleMult', v: 1.8 },
      { t: 'agentCostMult', v: 0.9 },
    ],
  },
  {
    id: 'open_weights',
    name: 'Open Weights',
    blurb: 'All production +40%. Incidents +50%.',
    rarity: 'common',
    effects: [
      { t: 'allMult', v: 1.4 },
      { t: 'incidentRateMult', v: 1.5 },
    ],
  },
  {
    id: 'monorepo',
    name: 'Monorepo',
    blurb: 'Click power scales with your agent count (+15% each). Idle ×1.55.',
    rarity: 'uncommon',
    // `clickPerAgent` alone made this a trap: it reads enormous, it is pure
    // click-channel (which stops mattering by project 5), and its exclusive
    // group locks out Microservices — the card that actually scales. Measured at
    // -23% win rate for the *unlock* that puts it in the pool. The idle line
    // makes the pair a real choice: scaling clicks and safe idle, or bigger
    // idle with more incidents.
    effects: [
      { t: 'clickPerAgent', v: 0.15 },
      { t: 'idleMult', v: 1.55 },
    ],
    exclusiveGroup: 'repo',
  },
  {
    id: 'microservices',
    name: 'Microservices',
    blurb: 'Every tier +90% idle. Incidents +25%.',
    rarity: 'common',
    // Both repo cards sat far below the pool they compete in — Sonnet is a
    // *common* at idle x1.8, and these were x1.10 and x1.25. Two under-powered
    // cards in an exclusive group meant unlocking Architecture measured at
    // -25% win rate: pure dilution of the draft.
    effects: [
      { t: 'idleMult', v: 1.9 },
      { t: 'incidentRateMult', v: 1.25 },
    ],
    exclusiveGroup: 'repo',
  },
  {
    id: 'vibe_coding',
    name: 'Vibe Coding',
    blurb: 'Click ×3. Incidents +40%. Read nothing.',
    rarity: 'common',
    effects: [
      { t: 'clickMult', v: 3 },
      { t: 'incidentRateMult', v: 1.4 },
    ],
  },
  {
    id: 'rubber_duck',
    name: 'Rubber Duck',
    blurb: 'It listens. Click ×2.',
    rarity: 'common',
    effects: [{ t: 'clickMult', v: 2 }],
  },
  {
    id: 'test_coverage',
    name: '100% Coverage',
    blurb: 'Incidents −50%. The tests assert true === true.',
    rarity: 'common',
    effects: [{ t: 'incidentRateMult', v: 0.5 }],
  },
  {
    id: 'observability',
    name: 'Observability',
    blurb: 'Incidents −30%. All production +15%.',
    rarity: 'common',
    effects: [
      { t: 'incidentRateMult', v: 0.7 },
      { t: 'allMult', v: 1.15 },
    ],
  },
  {
    id: 'scope_negotiation',
    name: 'Scope Negotiation',
    blurb: '+25% deadline on every project.',
    rarity: 'uncommon',
    effects: [{ t: 'deadlineMult', v: 1.25 }],
  },
  {
    id: 'technical_debt',
    name: 'Technical Debt',
    blurb: 'All production +70%. Deadlines −15%.',
    rarity: 'uncommon',
    effects: [
      { t: 'allMult', v: 1.7 },
      { t: 'deadlineMult', v: 0.85 },
    ],
  },
  {
    id: 'ship_it_friday',
    name: 'Ship It Friday',
    blurb: 'All production +35%. Deadlines −10%.',
    rarity: 'common',
    effects: [
      { t: 'allMult', v: 1.35 },
      { t: 'deadlineMult', v: 0.9 },
    ],
  },
  {
    id: 'prompt_engineering',
    name: 'Prompt Engineering',
    blurb: 'Click ×1.6 and idle ×1.6. You are a "engineer".',
    rarity: 'common',
    effects: [
      { t: 'clickMult', v: 1.6 },
      { t: 'idleMult', v: 1.6 },
    ],
  },
  {
    id: 'chinchilla',
    name: 'Chinchilla Optimal',
    blurb: 'All production +55%.',
    rarity: 'uncommon',
    effects: [{ t: 'allMult', v: 1.55 }],
    minProjectIndex: 2,
  },
  {
    id: 'infinite_context',
    name: 'Infinite Context',
    blurb: 'Idle ×2.4. It remembers everything, including the bugs.',
    rarity: 'rare',
    effects: [{ t: 'idleMult', v: 2.4 }],
    minProjectIndex: 3,
  },
  {
    id: 'gpu_cluster',
    name: 'Depreciating GPU Cluster',
    blurb: 'Fine-tune Farm ×4. Idle +30%.',
    rarity: 'rare',
    effects: [
      { t: 'tierMult', id: 'finetune_farm', v: 4 },
      { t: 'idleMult', v: 1.3 },
    ],
    minProjectIndex: 5,
  },
  {
    id: 'ralph_supremacy',
    name: 'Ralph Supremacy',
    blurb: 'Ralph Loop ×5. It has been three weeks.',
    rarity: 'rare',
    effects: [{ t: 'tierMult', id: 'ralph_loop', v: 5 }],
    minProjectIndex: 4,
  },
  {
    id: 'swarm_supremacy',
    name: 'Disjoint Ownership',
    blurb: 'Subagent Swarm ×4. Nobody touched the same file.',
    rarity: 'rare',
    effects: [{ t: 'tierMult', id: 'subagent_swarm', v: 4 }],
    minProjectIndex: 3,
  },
  {
    id: 'growth_hacking',
    name: 'Growth Hacking',
    blurb: 'Demos earned +40%.',
    rarity: 'uncommon',
    effects: [{ t: 'demoMult', v: 1.4 }],
  },
  {
    id: 'pair_programming',
    name: 'Pair Programming',
    blurb: 'Click ×2.2. Idle ×0.9. Someone is watching you type.',
    rarity: 'common',
    effects: [
      { t: 'clickMult', v: 2.2 },
      { t: 'idleMult', v: 0.9 },
    ],
  },
  {
    id: 'afk_farming',
    name: 'AFK Farming',
    blurb: '+8 clicks/sec, forever. Go outside.',
    rarity: 'uncommon',
    effects: [{ t: 'autoClick', v: 8 }],
  },
  {
    id: 'crunch_time',
    name: 'Crunch Time',
    blurb: 'Click ×4. Deadlines −20%.',
    rarity: 'uncommon',
    effects: [
      { t: 'clickMult', v: 4 },
      { t: 'deadlineMult', v: 0.8 },
    ],
  },

  // --- crit cards ---------------------------------------------------------
  {
    id: 'beginners_luck',
    name: "Beginner's Luck",
    blurb: 'It worked and you do not know why. +8% crit, +3 clicks/sec.',
    rarity: 'common',
    // Crit chance alone is a dead draw by project 5, when clicking stops
    // mattering. Pairing it with auto-clicks makes the two halves multiply:
    // auto-clicks are real clicks, so they crit too.
    effects: [
      { t: 'critChance', v: 0.08 },
      { t: 'autoClick', v: 3 },
    ],
  },
  {
    id: 'in_the_zone',
    name: 'In The Zone',
    blurb: 'Headphones on, Slack closed. +15% crit, +10 clicks/sec.',
    rarity: 'rare',
    effects: [
      { t: 'critChance', v: 0.15 },
      { t: 'autoClick', v: 10 },
    ],
  },
  {
    id: 'overclocked',
    name: 'Overclocked',
    blurb: 'Crits hit for ×15 instead of ×7. +6 clicks/sec.',
    rarity: 'rare',
    effects: [
      { t: 'critMult', v: 8 },
      { t: 'autoClick', v: 6 },
    ],
  },
  {
    id: 'first_try',
    name: 'First Try',
    blurb: 'No follow-up prompt needed. +8% one-shot.',
    rarity: 'rare',
    effects: [{ t: 'oneShotChance', v: 0.08 }],
  },
  {
    id: 'temperature_zero',
    name: 'Temperature Zero',
    blurb: 'Deterministic and dull. +9% one-shot, idle ×0.94.',
    rarity: 'rare',
    effects: [
      { t: 'oneShotChance', v: 0.09 },
      { t: 'idleMult', v: 0.94 },
    ],
  },
];

export const CARD_BY_ID: Readonly<Record<string, CardDef>> = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
);

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENTS: readonly IncidentDef[] = [
  {
    id: 'hallucinated_dep',
    name: 'Hallucinated Dependency',
    flavor: 'npm ERR! 404 `react-use-vibes` is not in the registry.',
    tone: 'bad',
    weight: 10,
    durationMs: 22_000,
    effects: [{ t: 'idleMult', v: 0.5 }],
    clearWithClicks: 10,
  },
  {
    id: 'rate_limited',
    name: 'Rate Limited',
    flavor: '429. Your fleet is having a think.',
    tone: 'bad',
    weight: 9,
    durationMs: 8_000,
    effects: [{ t: 'idleHalt' }],
  },
  {
    id: 'context_overflow',
    name: 'Context Overflow',
    flavor: 'It forgot the requirements. Again.',
    tone: 'bad',
    weight: 9,
    durationMs: 13_000,
    effects: [{ t: 'idleMult', v: 0.6 }],
  },
  {
    id: 'security_review',
    name: 'Security Review',
    flavor: 'Someone found the hardcoded key. Everything stops.',
    tone: 'bad',
    weight: 7,
    durationMs: 11_000,
    effects: [{ t: 'allMult', v: 0.5 }],
  },
  {
    id: 'merge_conflict',
    name: 'Merge Conflict',
    flavor: '<<<<<<< HEAD. Forty files. Good luck.',
    tone: 'bad',
    weight: 8,
    durationMs: 15_000,
    effects: [{ t: 'clickMult', v: 0.35 }],
    clearWithClicks: 8,
  },
  {
    id: 'flaky_tests',
    name: 'Flaky Tests',
    flavor: 'It passes locally. It always passes locally.',
    tone: 'bad',
    weight: 8,
    durationMs: 16_000,
    effects: [{ t: 'idleMult', v: 0.7 }],
  },
  {
    id: 'prod_outage',
    name: 'Prod Is Down',
    flavor: 'The pager went off. Everyone is looking at you.',
    tone: 'bad',
    weight: 6,
    durationMs: 6_500,
    effects: [{ t: 'idleHalt' }],
    minProjectIndex: 3,
  },
  {
    id: 'compliance_audit',
    name: 'Compliance Audit',
    flavor: 'SOC 2 Type II would like a word about your slop.',
    tone: 'bad',
    weight: 6,
    durationMs: 15_000,
    effects: [{ t: 'allMult', v: 0.55 }],
    minProjectIndex: 5,
  },

  // --- outages: shipping is blocked while these run, and the clock does not
  // stop. Their weight scales with the incident-rate dial, so the risk
  // upgrades are what actually make these common.
  {
    id: 'github_down',
    name: 'GitHub Is Down',
    flavor: 'Cannot push. Cannot ship. The status page is a yellow circle.',
    tone: 'bad',
    weight: 7,
    durationMs: 9_000,
    effects: [],
    blocksShip: true,
  },
  {
    id: 'registry_down',
    name: 'npm Registry 503',
    flavor: 'The install step is a coin flip and it keeps landing on edge.',
    tone: 'bad',
    weight: 6,
    durationMs: 8_000,
    effects: [{ t: 'idleMult', v: 0.75 }],
    blocksShip: true,
    minProjectIndex: 1,
  },
  {
    id: 'region_down',
    name: 'us-east-1 Degraded',
    flavor: 'It is always us-east-1. Deploys are queued behind the whole internet.',
    tone: 'bad',
    weight: 6,
    durationMs: 11_000,
    effects: [{ t: 'idleMult', v: 0.6 }],
    blocksShip: true,
    minProjectIndex: 2,
  },
  {
    id: 'cert_expired',
    name: 'Certificate Expired',
    flavor: 'Nobody owned the renewal. The deploy gate is red.',
    tone: 'bad',
    weight: 5,
    durationMs: 10_000,
    effects: [],
    blocksShip: true,
    clearWithClicks: 12,
    minProjectIndex: 3,
  },
  {
    id: 'change_freeze',
    name: 'Change Freeze',
    flavor: 'Someone senior said "no deploys today". The deadline disagrees.',
    tone: 'bad',
    weight: 5,
    durationMs: 13_000,
    effects: [],
    blocksShip: true,
    minProjectIndex: 5,
  },

  // --- good ---
  {
    id: 'viral_tweet',
    name: 'Viral Launch Tweet',
    flavor: '4.2M impressions. Nobody clicked the link.',
    tone: 'good',
    weight: 10,
    durationMs: 15_000,
    effects: [{ t: 'allMult', v: 2 }],
  },
  {
    id: 'free_credits',
    name: 'Free Credits',
    flavor: 'A vendor wants you on stage. Idle ×2.5.',
    tone: 'good',
    weight: 9,
    durationMs: 12_000,
    effects: [{ t: 'idleMult', v: 2.5 }],
  },
  {
    id: 'hn_front_page',
    name: 'HN Front Page',
    flavor: '"Show HN: I made slop". 900 comments about the font.',
    tone: 'good',
    weight: 6,
    durationMs: 9_000,
    effects: [{ t: 'allMult', v: 3 }],
  },
  {
    id: 'flow_state',
    name: 'Flow State',
    flavor: 'You have not blinked in four minutes. Click ×5.',
    tone: 'good',
    weight: 8,
    durationMs: 11_000,
    effects: [{ t: 'clickMult', v: 5 }],
  },
  {
    id: 'cache_hit',
    name: 'Warm Cache',
    flavor: 'Everything is already computed. Idle ×1.9.',
    tone: 'good',
    weight: 9,
    durationMs: 18_000,
    effects: [{ t: 'idleMult', v: 1.9 }],
  },
];

// ---------------------------------------------------------------------------
// Pickups — collectibles that drift across the room
// ---------------------------------------------------------------------------

/**
 * The buff each pickup grants. These live in the incident system so they get
 * the HUD banner, the timer, the effect folding and the audio sting for free —
 * they are simply never rolled at random (`weight: 0`).
 */
const PICKUP_BUFFS: readonly IncidentDef[] = [
  {
    id: 'buff_energy_drink',
    name: 'Energy Drink',
    flavor: 'Tastes like a fire alarm. Click power ×4.',
    tone: 'good',
    weight: 0,
    durationMs: 12_000,
    effects: [{ t: 'clickMult', v: 4 }],
  },
  {
    id: 'buff_cold_brew',
    name: 'Cold Brew',
    flavor: 'Someone left it unattended. Idle ×2.2.',
    tone: 'good',
    weight: 0,
    durationMs: 13_000,
    effects: [{ t: 'idleMult', v: 2.2 }],
  },
  {
    id: 'buff_catered_lunch',
    name: 'Catered Lunch',
    flavor: 'Free food. The whole floor produces. Everything ×2.',
    tone: 'good',
    weight: 0,
    durationMs: 11_000,
    effects: [{ t: 'allMult', v: 2 }],
  },
  {
    id: 'buff_spare_gpu',
    name: 'Unracked GPU',
    flavor: 'It fell off a truck. Idle ×3.',
    tone: 'good',
    weight: 0,
    durationMs: 10_000,
    effects: [{ t: 'idleMult', v: 3 }],
  },
  {
    id: 'buff_solar_flare',
    name: 'Solar Flare',
    flavor: 'Free power, brief window. Everything ×3.5.',
    tone: 'good',
    weight: 0,
    durationMs: 8_000,
    effects: [{ t: 'allMult', v: 3.5 }],
  },
  {
    id: 'buff_discount',
    name: 'Vendor Discount',
    flavor: 'Agents 55% off while it lasts.',
    tone: 'good',
    weight: 0,
    durationMs: 15_000,
    effects: [{ t: 'agentCostMult', v: 0.45 }],
  },
  {
    id: 'buff_zero_g',
    name: 'Zero-G Focus',
    flavor: 'Nothing to lean on but the keyboard. Click x6.',
    tone: 'good',
    weight: 0,
    durationMs: 10_000,
    effects: [{ t: 'clickMult', v: 6 }],
  },
  {
    id: 'buff_stackoverflow',
    name: 'Accepted Answer',
    flavor: 'Someone solved this in 2013. Everything ×2.5.',
    tone: 'good',
    weight: 0,
    durationMs: 10_000,
    effects: [{ t: 'allMult', v: 2.5 }],
  },
];

/** How the renderer draws a pickup. Procedural — no atlas dependency. */
export type PickupShape =
  | 'can'
  | 'cup'
  | 'box'
  | 'chip'
  | 'star'
  | 'bubble'
  | 'clock'
  | 'wrench'
  | 'badge';

/**
 * What collecting a pickup actually does. Deliberately not all timed
 * multipliers — a lump sum, a chunk of deadline and an outage cleanse are
 * different *verbs*, and variety of verb beats variety of number.
 */
export type PickupAction =
  /** Grants a timed buff, implemented as a good-tone incident. */
  | { readonly t: 'buff'; readonly incident: IncidentId }
  /** Instant slop, as a fraction of the current project's requirement. */
  | { readonly t: 'slop'; readonly ofRequirement: number }
  /** Adds time to the deadline. */
  | { readonly t: 'time'; readonly ms: number }
  /** Clears every active bad incident, outages included. */
  | { readonly t: 'cleanse' }
  /** One free unit of the best tier the player already fields. */
  | { readonly t: 'agent' };

export interface PickupDef {
  readonly id: string;
  readonly label: string;
  /** One-line description, shown in the collect toast. */
  readonly blurb: string;
  readonly action: PickupAction;
  readonly shape: PickupShape;
  /** Palette key for the body. */
  readonly accent: string;
  /** Scene it appears in; `null` means anywhere. */
  readonly scene: SceneKey | null;
  /** Rare pickups spawn less often and get a louder halo. */
  readonly rare?: boolean;
}

export const PICKUPS: readonly PickupDef[] = [
  // --- bedroom -----------------------------------------------------------
  {
    id: 'energy_drink',
    label: 'Energy Drink',
    blurb: 'Click power x4 for 12s.',
    action: { t: 'buff', incident: 'buff_energy_drink' },
    shape: 'can',
    accent: 'red',
    scene: 'bedroom',
  },
  {
    id: 'late_delivery',
    label: 'Late Delivery',
    blurb: 'A courier hands you a lump of slop.',
    action: { t: 'slop', ofRequirement: 0.3 },
    shape: 'box',
    accent: 'amber',
    scene: 'bedroom',
  },
  {
    id: 'power_nap',
    label: 'Power Nap',
    blurb: 'Twenty minutes. Somehow the deadline moved.',
    action: { t: 'time', ms: 7_000 },
    shape: 'clock',
    accent: 'blue',
    scene: 'bedroom',
    rare: true,
  },

  // --- coworking ---------------------------------------------------------
  {
    id: 'cold_brew',
    label: 'Cold Brew',
    blurb: 'Idle x2.2 for 13s.',
    action: { t: 'buff', incident: 'buff_cold_brew' },
    shape: 'cup',
    accent: 'amber',
    scene: 'coworking',
  },
  {
    id: 'summer_intern',
    label: 'Summer Intern',
    blurb: 'Unpaid, briefly enthusiastic. One free agent.',
    action: { t: 'agent' },
    shape: 'badge',
    accent: 'green',
    scene: 'coworking',
  },
  {
    id: 'networking',
    label: 'Networking Event',
    blurb: 'You met a vendor. Agents 55% off for 15s.',
    action: { t: 'buff', incident: 'buff_discount' },
    shape: 'bubble',
    accent: 'blue',
    scene: 'coworking',
  },

  // --- open plan ---------------------------------------------------------
  {
    id: 'catered_lunch',
    label: 'Catered Lunch',
    blurb: 'Everything x2 for 11s.',
    action: { t: 'buff', incident: 'buff_catered_lunch' },
    shape: 'box',
    accent: 'green',
    scene: 'openplan',
  },
  {
    id: 'it_support',
    label: 'IT Support',
    blurb: 'Have you tried turning it off. Clears every incident.',
    action: { t: 'cleanse' },
    shape: 'wrench',
    accent: 'green',
    scene: 'openplan',
    rare: true,
  },
  {
    id: 'all_hands',
    label: 'All-Hands',
    blurb: 'Nobody shipped for an hour, so the date slipped.',
    action: { t: 'time', ms: 8_000 },
    shape: 'clock',
    accent: 'blue',
    scene: 'openplan',
    rare: true,
  },

  // --- data center -------------------------------------------------------
  {
    id: 'spare_gpu',
    label: 'Loose GPU',
    blurb: 'Idle x3 for 10s.',
    action: { t: 'buff', incident: 'buff_spare_gpu' },
    shape: 'chip',
    accent: 'purple',
    scene: 'datacenter',
  },
  {
    id: 'spot_instance',
    label: 'Spot Instance',
    blurb: 'Someone else got evicted. Agents 55% off for 15s.',
    action: { t: 'buff', incident: 'buff_discount' },
    shape: 'chip',
    accent: 'blue',
    scene: 'datacenter',
  },
  {
    id: 'redundant_psu',
    label: 'Spare Capacity',
    blurb: 'Budget nobody claimed. Instant slop.',
    action: { t: 'slop', ofRequirement: 0.35 },
    shape: 'box',
    accent: 'green',
    scene: 'datacenter',
  },

  // --- orbital -----------------------------------------------------------
  {
    id: 'solar_flare',
    label: 'Solar Flare',
    blurb: 'Everything x3.5 for 8s.',
    action: { t: 'buff', incident: 'buff_solar_flare' },
    shape: 'star',
    accent: 'amber',
    scene: 'orbital',
  },
  {
    id: 'zero_g',
    label: 'Zero-G Focus',
    blurb: 'Nothing to lean on. Click power x6 for 10s.',
    action: { t: 'buff', incident: 'buff_zero_g' },
    shape: 'star',
    accent: 'purple',
    scene: 'orbital',
  },
  {
    id: 'launch_window',
    label: 'Launch Window',
    blurb: 'The orbit lines up. Ten more seconds.',
    action: { t: 'time', ms: 10_000 },
    shape: 'clock',
    accent: 'blue',
    scene: 'orbital',
    rare: true,
  },

  // --- anywhere ----------------------------------------------------------
  {
    id: 'stackoverflow',
    label: 'Accepted Answer',
    blurb: 'Someone solved this in 2013. Everything x2.5.',
    action: { t: 'buff', incident: 'buff_stackoverflow' },
    shape: 'bubble',
    accent: 'blue',
    scene: null,
  },
  {
    id: 'hotfix',
    label: 'Hotfix',
    blurb: 'Straight to main. Clears every incident, outages included.',
    action: { t: 'cleanse' },
    shape: 'wrench',
    accent: 'red',
    scene: null,
    rare: true,
  },
  {
    id: 'lucky_refactor',
    label: 'Lucky Refactor',
    blurb: 'You deleted 400 lines and it got faster. Instant slop.',
    action: { t: 'slop', ofRequirement: 0.25 },
    shape: 'bubble',
    accent: 'green',
    scene: null,
  },
];

export const PICKUP_BY_ID: Readonly<Record<string, PickupDef>> = Object.fromEntries(
  PICKUPS.map((p) => [p.id, p]),
);

/**
 * Pickups that can appear in a given room. Rare ones are gated behind the
 * Lucky Streak unlock, so an early save sees a small, learnable set and the
 * good stuff arrives as a visible upgrade rather than as invisible variance.
 */
export function pickupsForScene(
  scene: SceneKey,
  features?: ReadonlySet<string>,
): readonly PickupDef[] {
  return PICKUPS.filter(
    (p) =>
      (p.scene === scene || p.scene === null) &&
      (!p.rare || features === undefined || features.has('rarePickups')),
  );
}

/** Rare pickups show up roughly a third as often as common ones. */
export function pickupWeight(def: PickupDef): number {
  return def.rare ? 1 : 3;
}

export const PICKUP_TUNING = {
  MIN_MS: 20_000,
  MAX_MS: 34_000,
  /** Grace after a project starts before the first one drifts in. */
  GRACE_MS: 9_000,
  /** Seconds on screen before it leaves. */
  LIFETIME_MS: 8_000,
  /** Scene units per second of horizontal drift. */
  SPEED: 26,
  /** Click tolerance in scene units. Generous — the sprite is tiny. */
  HIT_RADIUS: 15,
  BOB_AMPLITUDE: 7,
  BOB_HZ: 0.75,
} as const;

export const INCIDENT_BY_ID: Readonly<Record<string, IncidentDef>> = Object.fromEntries(
  [...INCIDENTS, ...PICKUP_BUFFS].map((i) => [i.id, i]),
);

// ---------------------------------------------------------------------------
// Meta progression
// ---------------------------------------------------------------------------

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The meta tree. Five trunks off a free root, mixing one-time `unlock` nodes
 * (which add content to the game) with the levelled `upgrade` ladders.
 *
 * The load-bearing idea: a fresh save does NOT have the whole game. Agent tiers
 * 5-10, the automation line, the risk knobs and most of the card pool are all
 * locked. That is what makes run 1 unwinnable by construction rather than by
 * tuning — with only tiers 1-4 the production ceiling is orders of magnitude
 * below what project 10 demands.
 */
export const META_UPGRADES: readonly MetaUpgradeDef[] = [
  // --- HEADCOUNT: the agent ladder ---------------------------------------
  {
    id: 'unlock_swarm',
    name: 'Subagent Swarm',
    blurb: 'Hire in parallel. Unlocks agent tier 5.',
    kind: 'unlock',
    branch: 'headcount',
    pos: { x: 0, y: 1 },
    requires: [],
    grants: { t: 'agentTier', id: 'subagent_swarm', withUpgrades: ['subagent_sharding'] },
    maxLevel: 1,
    costs: [5],
    describe: () => 'Unlocks Subagent Swarm and its sharding upgrade',
  },
  {
    id: 'unlock_ralph',
    name: 'Ralph Loop',
    blurb: 'while true. Unlocks agent tier 6.',
    kind: 'unlock',
    branch: 'headcount',
    pos: { x: 0, y: 2 },
    requires: ['unlock_swarm'],
    grants: { t: 'agentTier', id: 'ralph_loop', withUpgrades: ['one_shot'] },
    maxLevel: 1,
    costs: [8],
    describe: () => 'Unlocks Ralph Loop and One-Shot',
  },
  {
    id: 'unlock_harness',
    name: 'Multi-Harness',
    blurb: 'A harness for your harnesses. Unlocks agent tier 7.',
    kind: 'unlock',
    branch: 'headcount',
    pos: { x: 0, y: 3 },
    requires: ['unlock_ralph'],
    grants: { t: 'agentTier', id: 'multi_harness' },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Unlocks Multi-Harness Orchestrator',
  },
  {
    id: 'unlock_fleet',
    name: 'Background Fleet',
    blurb: 'Stop reading the diffs. Unlocks agent tier 8.',
    kind: 'unlock',
    branch: 'headcount',
    pos: { x: 0, y: 4 },
    requires: ['unlock_harness'],
    grants: { t: 'agentTier', id: 'background_fleet', withUpgrades: ['eval_harness'] },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Unlocks Background Fleet',
  },
  {
    id: 'unlock_farm',
    name: 'Fine-tune Farm',
    blurb: 'Slop trained on slop. Unlocks agent tier 9.',
    kind: 'unlock',
    branch: 'headcount',
    pos: { x: 0, y: 5 },
    requires: ['unlock_fleet'],
    grants: { t: 'agentTier', id: 'finetune_farm', withUpgrades: ['gpu_interconnect'] },
    maxLevel: 1,
    costs: [34],
    describe: () => 'Unlocks Fine-tune Farm',
  },
  {
    id: 'unlock_agi',
    name: 'AGI',
    blurb: 'It asked for equity. Unlocks agent tier 10.',
    kind: 'unlock',
    branch: 'headcount',
    pos: { x: 0, y: 6 },
    requires: ['unlock_farm'],
    grants: { t: 'agentTier', id: 'agi', withUpgrades: ['best_of_n'] },
    maxLevel: 1,
    costs: [55],
    describe: () => 'Unlocks AGI',
  },

  // --- AUTOMATION: raw talent, then hand it to a machine ------------------
  {
    id: 'cracked',
    name: 'Cracked',
    blurb: 'Raw clicking talent.',
    kind: 'upgrade',
    branch: 'automation',
    pos: { x: 1, y: 1 },
    requires: [],
    maxLevel: 6,
    costs: [2, 3, 5, 8, 13, 21],
    describe: (l) => (l ? `+${l * 100}% click power` : '+100% click power per level'),
  },
  {
    id: 'unlock_autoclicker',
    name: 'Autoclicker',
    blurb: 'A weight on the spacebar. Unlocks the automation line.',
    kind: 'unlock',
    branch: 'automation',
    pos: { x: 1, y: 2 },
    requires: ['cracked'],
    grants: { t: 'upgrades', ids: ['autoclicker', 'cron_job'], withCards: ['afk_farming'] },
    maxLevel: 1,
    costs: [5],
    describe: () => 'Unlocks Autoclicker and Cron Job',
  },
  {
    id: 'idle_hands',
    name: 'Idle Hands',
    blurb: 'Start every run with the spacebar already held down.',
    kind: 'upgrade',
    branch: 'automation',
    pos: { x: 1, y: 3 },
    requires: ['unlock_autoclicker'],
    maxLevel: 3,
    costs: [3, 8, 13],
    describe: (l) => (l ? `+${l} click${l > 1 ? 's' : ''}/sec from the start` : '+1 click/sec per level'),
  },
  {
    id: 'unlock_headless',
    name: 'Headless Loop',
    blurb: 'You closed the laptop an hour ago. Unlocks the deep automation.',
    kind: 'unlock',
    branch: 'automation',
    pos: { x: 1, y: 4 },
    requires: ['idle_hands'],
    grants: { t: 'upgrades', ids: ['ci_on_push', 'headless_loop', 'emacs_pinky', 'neural_interface'] },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Unlocks Build On Push and Headless Loop',
  },

  {
    id: 'keyboard_shortcuts',
    name: 'Keyboard Shortcuts',
    blurb: 'Flat slop on every click, before multipliers.',
    kind: 'upgrade',
    branch: 'automation',
    pos: { x: 1, y: 5 },
    requires: ['unlock_headless'],
    maxLevel: 4,
    costs: [5, 8, 13, 21],
    describe: (l) => (l ? `+${l * 4} slop per click, pre-multiplier` : '+4 flat slop per click per level'),
  },
  {
    id: 'unlock_daemon',
    name: 'Daemon Mode',
    blurb: 'It survives reboots. The deepest automation there is.',
    kind: 'unlock',
    branch: 'automation',
    pos: { x: 1, y: 6 },
    requires: ['keyboard_shortcuts'],
    grants: { t: 'upgrades', ids: ['daemon_mode'], withCards: ['afk_farming'] },
    maxLevel: 1,
    costs: [34],
    describe: () => 'Unlocks Daemon Mode and AFK Farming',
  },

  // --- CAPITAL: the economy ----------------------------------------------
  {
    id: 'seed_funding',
    name: 'Seed Funding',
    blurb: 'Start every run with banked slop.',
    kind: 'upgrade',
    branch: 'capital',
    pos: { x: 2, y: 1 },
    requires: [],
    maxLevel: 5,
    costs: [2, 3, 5, 8, 13],
    describe: (l) => (l ? `Start with ${(60 * Math.pow(4, l - 1)).toLocaleString()} slop` : 'Start with slop'),
  },
  {
    id: 'technical_cofounder',
    name: 'Technical Cofounder',
    blurb: 'They negotiate the API bill.',
    kind: 'upgrade',
    branch: 'capital',
    pos: { x: 2, y: 2 },
    requires: ['seed_funding'],
    maxLevel: 3,
    costs: [5, 8, 13],
    describe: (l) =>
      l
        ? `Agents ${pct(1 - metaCurve(META_CURVES.TECHNICAL_COFOUNDER, l, 1))} cheaper`
        : 'Cheaper agents, compounding at the top',
  },
  {
    id: 'incubator',
    name: 'Incubator',
    blurb: 'Start with free agents.',
    kind: 'upgrade',
    branch: 'capital',
    pos: { x: 2, y: 3 },
    requires: ['technical_cofounder'],
    maxLevel: 3,
    costs: [3, 8, 21],
    describe: (l) => (l ? `Start with ${l * 3} Tab Autocomplete` : 'Start with free agents'),
  },
  {
    id: 'founder_mode',
    name: 'Founder Mode',
    blurb: 'Everything, slightly more.',
    kind: 'upgrade',
    branch: 'capital',
    pos: { x: 2, y: 4 },
    requires: ['incubator'],
    maxLevel: 6,
    costs: [3, 5, 8, 13, 21, 34],
    describe: (l) =>
      l
        ? `×${metaCurve(META_CURVES.FOUNDER_MODE, l, 1).toFixed(2)} all production`
        : 'All production, compounding hard at the top',
  },

  {
    id: 'unlock_datacenter',
    name: 'Data Center',
    blurb: 'Stop renting other people\'s compute.',
    kind: 'unlock',
    branch: 'capital',
    pos: { x: 2, y: 5 },
    requires: ['founder_mode'],
    grants: { t: 'upgrades', ids: ['loc_datacenter'] },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Unlocks the Data Center location',
  },
  {
    id: 'unlock_orbital',
    name: 'Orbital Cluster',
    blurb: 'Free cooling. Terrible commute.',
    kind: 'unlock',
    branch: 'capital',
    pos: { x: 2, y: 6 },
    requires: ['unlock_datacenter'],
    grants: { t: 'upgrades', ids: ['loc_orbital'] },
    maxLevel: 1,
    costs: [34],
    describe: () => 'Unlocks the Orbital GPU Cluster location',
  },

  // --- PROCESS: drafts and deadlines -------------------------------------
  {
    id: 'unlock_model_cards',
    name: 'Model Cards',
    blurb: 'Opus, Haiku and Sonnet join the draft pool.',
    kind: 'unlock',
    branch: 'process',
    pos: { x: 3, y: 1 },
    requires: [],
    grants: { t: 'cards', ids: ['opus', 'haiku', 'sonnet', 'scope_negotiation'] },
    maxLevel: 1,
    costs: [3],
    describe: () => 'Adds Opus, Haiku and Sonnet to drafts',
  },
  {
    id: 'prompt_library',
    name: 'Prompt Library',
    blurb: 'Drafts offer a fourth card.',
    kind: 'upgrade',
    branch: 'process',
    pos: { x: 3, y: 2 },
    requires: ['unlock_model_cards'],
    maxLevel: 1,
    costs: [8],
    describe: () => 'Drafts offer 4 cards',
  },
  {
    id: 'reroll_token',
    name: 'Reroll Token',
    blurb: 'Do not like the hand? Redraw.',
    kind: 'upgrade',
    branch: 'process',
    pos: { x: 3, y: 3 },
    requires: ['prompt_library'],
    maxLevel: 2,
    costs: [5, 13],
    describe: (l) => (l ? `${l} reroll${l > 1 ? 's' : ''} per draft` : '1 reroll per draft'),
  },
  {
    id: 'unlock_rare_cards',
    name: 'Bleeding Edge',
    blurb: 'The rare, run-defining cards enter the pool.',
    kind: 'unlock',
    branch: 'process',
    pos: { x: 3, y: 4 },
    requires: ['reroll_token'],
    grants: {
      t: 'cards',
      ids: [
        'infinite_context',
        'gpu_cluster',
        'ralph_supremacy',
        'swarm_supremacy',
        'chinchilla',
        'growth_hacking',
        'first_try',
        'temperature_zero',
      ],
    },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Adds the rare cards to drafts',
  },
  {
    id: 'scope_negotiator',
    name: 'Scope Negotiator',
    blurb: 'Push the deadline. Politely.',
    kind: 'upgrade',
    branch: 'process',
    pos: { x: 3, y: 5 },
    requires: ['unlock_rare_cards'],
    maxLevel: 4,
    costs: [3, 5, 8, 13],
    describe: (l) =>
      l
        ? `+${pct(metaCurve(META_CURVES.SCOPE_NEGOTIATOR, l, 1) - 1)} deadline time`
        : 'More deadline time, compounding at the top',
  },

  {
    id: 'unlock_architecture',
    name: 'Architecture',
    blurb: 'Monorepo or Microservices — you may only ever have one.',
    kind: 'unlock',
    branch: 'process',
    pos: { x: 3, y: 6 },
    requires: ['scope_negotiator'],
    grants: { t: 'cards', ids: ['monorepo', 'microservices'] },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Adds the mutually exclusive repo cards',
  },

  // --- RISK: the danger dial ---------------------------------------------
  {
    id: 'unlock_yolo',
    name: 'YOLO Mode',
    blurb: 'Auto-accept everything. Unlocks the risk knobs, both directions.',
    kind: 'unlock',
    branch: 'risk',
    pos: { x: 4, y: 1 },
    requires: [],
    grants: {
      t: 'upgrades',
      // Crits are a gamble, so the human crit track hangs off the risk gate
      // rather than getting a branch of its own.
      ids: ['yolo_mode', 'ci_gate', 'hyperfocus'],
      // Cards that trade safety for speed belong behind the risk gate.
      withCards: ['technical_debt', 'ship_it_friday', 'crunch_time', 'in_the_zone'],
    },
    maxLevel: 1,
    costs: [5],
    describe: () => 'Unlocks YOLO Mode, CI Gate and Hyperfocus',
  },
  {
    id: 'unlock_skip',
    name: 'Skip Permissions',
    blurb: 'The flag is named after what happens.',
    kind: 'unlock',
    branch: 'risk',
    pos: { x: 4, y: 2 },
    requires: ['unlock_yolo'],
    grants: {
      t: 'upgrades',
      ids: ['skip_permissions', 'speculative_decoding', 'distillation'],
      withCards: ['overclocked'],
    },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Unlocks --dangerously-skip-permissions and Overclocked',
  },
  {
    id: 'hype_machine',
    name: 'Hype Machine',
    blurb: 'The demo is the product.',
    kind: 'upgrade',
    branch: 'risk',
    pos: { x: 4, y: 3 },
    requires: ['unlock_skip'],
    maxLevel: 3,
    costs: [5, 8, 13],
    describe: (l) => (l ? `+${pct(l * 0.2)} Demos earned` : '+20% Demos earned per level'),
  },
  {
    id: 'snack_drawer',
    name: 'Snack Drawer',
    blurb: 'Somebody keeps restocking it. Collectibles drift by more often.',
    kind: 'unlock',
    branch: 'risk',
    pos: { x: 4, y: 4 },
    requires: ['hype_machine'],
    grants: { t: 'feature', id: 'pickupRate' },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Pickups appear ~40% more often',
  },

  {
    id: 'insurance',
    name: 'Incident Insurance',
    blurb: 'A retainer with someone who owns a pager.',
    kind: 'upgrade',
    branch: 'risk',
    pos: { x: 4, y: 5 },
    requires: ['snack_drawer'],
    maxLevel: 3,
    costs: [8, 13, 21],
    describe: (l) => (l ? `Incidents ${pct(1 - Math.pow(0.88, l))} rarer` : 'Incidents 12% rarer per level'),
  },
  {
    id: 'unlock_lucky',
    name: 'Lucky Streak',
    blurb: 'The rare collectibles start showing up at all.',
    kind: 'unlock',
    branch: 'risk',
    pos: { x: 4, y: 6 },
    requires: ['insurance'],
    grants: { t: 'feature', id: 'rarePickups' },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Rare pickups begin to appear',
  },

  // --- capstone ----------------------------------------------------------
  {
    id: 'endless_mode',
    name: 'Endless Mode',
    blurb: 'Keep going past Demo Day. It never ends.',
    kind: 'unlock',
    branch: 'root',
    pos: { x: 2, y: 7 },
    requires: [
      'unlock_agi',
      'unlock_daemon',
      'unlock_orbital',
      'unlock_architecture',
      'unlock_lucky',
    ],
    grants: { t: 'feature', id: 'endless' },
    maxLevel: 1,
    costs: [34],
    describe: () => 'Unlocks Endless past project 10',
  },
];

/**
 * Content a fresh save starts with. Everything else is behind the tree.
 * Tiers 1-4 alone cap raw production three orders of magnitude below what
 * project 10 demands, so run 1 cannot be won at any skill level.
 */
export const STARTING_TIERS: readonly AgentTierId[] = [
  'tab_autocomplete',
  'copy_paste_chatbot',
  'agentic_ide',
  'cli_agent',
];

export const STARTING_UPGRADES: readonly UpgradeId[] = [
  'mech_keyboard',
  'vim_motions',
  'macros',
  'prompt_caching',
  'bigger_context',
  'model_router',
  'mcp_servers',
  'claude_md',
  'muscle_memory',
  // The entry rung of the human crit track. Free from run one, because a
  // hand-clicker needs something to build toward before agents come online.
  'flow_state',
  // Only the first two offices are free; the rest are bought in the capital
  // branch of the tree.
  'loc_coworking',
  'loc_openplan',
];

export const STARTING_CARDS: readonly CardId[] = [
  'open_weights',
  'vibe_coding',
  'rubber_duck',
  'test_coverage',
  'observability',
  'prompt_engineering',
  'pair_programming',
  'beginners_luck',
];

export const META_BY_ID: Readonly<Record<string, MetaUpgradeDef>> = Object.fromEntries(
  META_UPGRADES.map((m) => [m.id, m]),
);

export const TOTAL_META_COST = META_UPGRADES.reduce(
  (sum, m) => sum + m.costs.slice(0, m.maxLevel).reduce((a, b) => a + b, 0),
  0,
);
