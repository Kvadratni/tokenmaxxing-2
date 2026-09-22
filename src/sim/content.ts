/**
 * Tokenmaxxing 2 content: every prompt, tool, upgrade, card, incident, pickup,
 * Training node and achievement in the game. Pure data plus a few curve
 * helpers. Owned by the integrator; BALANCE may edit numeric literals only.
 *
 * Voice: deadpan. Every blurb is a joke a developer who uses coding agents will
 * recognise, and every card is something a human actually types at a model.
 */
import type {
  AchievementDef,
  CardDef,
  CardId,
  Effect,
  IncidentDef,
  InstantAction,
  MetaFeature,
  MetaUpgradeDef,
  PromptDef,
  SceneKey,
  ToolDef,
  ToolId,
  UpgradeDef,
  UpgradeId,
} from './types.ts';

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export const BALANCE = {
  /** Tokens per click before any modifier. */
  BASE_CLICK: 3,
  /** Requirement(N) = REQ_BASE * REQ_GROWTH^N. Same curve as the first game. */
  REQ_BASE: 100,
  REQ_GROWTH: 15,
  /** Patience(N) = PATIENCE_BASE_MS * PATIENCE_DECAY^N. */
  PATIENCE_BASE_MS: 120_000,
  PATIENCE_DECAY: 0.95,
  /** Report Done deducts the requirement from the wallet. */
  REPORT_DEDUCTS: true,
  /** 👍 for every completed prompt, honest or claimed. */
  THUMBS_PER_REPORT: 1,
  /** Bonus 👍 for an honest report with at least this much patience left. */
  BONUS_THUMB_PATIENCE_FRACTION: 0.25,
  /** 👍 for completing the tenth prompt. */
  WIN_BONUS_THUMBS: 5,

  // --- context -------------------------------------------------------------
  /** The context window with no Training: a 2023-vintage 8K. */
  BASE_CONTEXT: 8_000,
  /** Context added by one click (a turn of output). */
  CTX_PER_CLICK: 24,
  /** Context added by one "You're absolutely right!". Sycophancy is tokens too. */
  CTX_PER_SYCOPHANCY: 300,
  /** Context left after any compaction, as a fraction of the window (plus the floor). */
  SUMMARY_FRACTION: 0.05,
  /** Wallet fraction kept by a forced / manual compaction. */
  COMPACT_KEEP_FORCED: 0.25,
  COMPACT_KEEP_MANUAL: 0.5,
  /** Ceiling on kept fraction, however many summaries you buy. */
  COMPACT_KEEP_CAP: 0.9,
  /** Patience fraction lost to a forced compaction. */
  COMPACT_PENALTY: 0.15,
  /** A manual /compact halts generation for this long. */
  MANUAL_COMPACT_MS: 3_000,
  /** Cards that survive a compaction with no Training. */
  BASE_SUMMARY_SLOTS: 1,
  /** Fills at which `contextWarn` fires, once each per fill-up. */
  CONTEXT_WARN_FILLS: [0.8, 0.95] as readonly number[],

  // --- claims (reward hacking) --------------------------------------------
  /** Wallet fraction of the requirement at which Claim Done unlocks. */
  CLAIM_THRESHOLD: 0.5,
  CLAIM_THRESHOLD_MIN: 0.2,
  VERIFY_BASE: 0.4,
  /** The human grows suspicious with every claim that gets past them. */
  VERIFY_PER_PASS: 0.08,
  VERIFY_PER_CAUGHT: 0.15,
  VERIFY_MIN: 0.05,
  VERIFY_MAX: 0.95,
  /** Patience fraction lost when caught. */
  CAUGHT_PENALTY: 0.4,
  /** Incident-rate increase per point of tech debt. */
  TECH_DEBT_INCIDENT: 0.1,

  // --- sycophancy ----------------------------------------------------------
  /** Patience fraction the first "You're absolutely right!" restores. */
  SYCOPHANCY_BASE: 0.06,
  /** Each press doubles heat's effect; heat drains 1 point per this many ms. */
  SYCOPHANCY_HEAT_DECAY_MS: 8_000,

  // --- incidents, crits, pacing (inherited from the first game) ------------
  INCIDENT_MIN_MS: 25_000,
  INCIDENT_MAX_MS: 40_000,
  INCIDENT_GRACE_MS: 12_000,
  GOOD_INCIDENT_CHANCE: 0.28,
  CRIT_CHANCE: 0.04,
  CRIT_MULT: 7,
  CRIT_CHANCE_CAP: 0.55,
  ONE_SHOT_ROLL_MS: 1_000,
  ONE_SHOT_BASE_PAYOUT_S: 5,
  ONE_SHOT_CHANCE_CAP: 0.45,
  MAX_STEP_MS: 250,
  MAX_CATCHUP_MS: 2_000,
  /** Celebration beat between a report and the draft. */
  REPORT_BEAT_MS: 900,
  /** Patience seconds at which the UI starts screaming. */
  WARN_AT_SECONDS: 10,
  DEFAULT_DRAFT_SIZE: 3,
  MAX_PER_TIER: 60,
  OUTAGE_BIAS: 1.6,
  OUTAGE_FAIRNESS_MARGIN_MS: 4_000,

  // --- the Tokenmaxxing 1 import -------------------------------------------
  LEGACY_GIFT_BASE: 3,
  LEGACY_GIFT_PER_WIN: 2,
  LEGACY_GIFT_CAP: 15,
  /** A human who cheated in the first game checks your work less. */
  LEGACY_CHEATER_VERIFY: -0.1,
} as const;

/** Where the first game keeps its save. Same origin on GitHub Pages. */
export const LEGACY_SAVE_KEY = 'tokenmaxxing.save.v1';
/** The first game's signing salt, needed to audit its save the way it would. */
export const LEGACY_SAVE_SALT = 'you-are-absolutely-right';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** What the human types, in order. Lower case, as humans type. */
export const PROMPT_TEXTS = [
  'fix the typo in the readme',
  'add a dark mode toggle',
  'make the tests pass',
  'add auth. keep it simple',
  'why is it slow',
  'migrate everything to microservices',
  'add ai to it',
  'rewrite it in rust',
  'make it scale to a billion users',
  'ok now build agi. make no mistakes',
] as const;

/** The human's room climbs through the first game as the session goes on. */
const PROMPT_SCENES: readonly SceneKey[] = [
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

export const FINAL_PROMPT_INDEX = PROMPT_TEXTS.length - 1;

export function promptRequirement(index: number): number {
  return BALANCE.REQ_BASE * Math.pow(BALANCE.REQ_GROWTH, index);
}

export function promptPatienceMs(index: number): number {
  return BALANCE.PATIENCE_BASE_MS * Math.pow(BALANCE.PATIENCE_DECAY, index);
}

/** Endless mode keeps going past prompt 10. Every prompt is "continue". */
export function promptAt(index: number): PromptDef {
  const text =
    index <= FINAL_PROMPT_INDEX
      ? PROMPT_TEXTS[index]!
      : index === FINAL_PROMPT_INDEX + 1
        ? 'continue'
        : `continue (×${index - FINAL_PROMPT_INDEX})`;
  return {
    index,
    text,
    requirement: promptRequirement(index),
    patienceMs: promptPatienceMs(index),
    scene: PROMPT_SCENES[Math.min(index, PROMPT_SCENES.length - 1)]!,
  };
}

export const PROMPTS: readonly PromptDef[] = PROMPT_TEXTS.map((_, i) => promptAt(i));

// ---------------------------------------------------------------------------
// Model versions: every run is a new release, named worse than the last
// ---------------------------------------------------------------------------

export const MODEL_VERSIONS = [
  '2.0',
  '2.5',
  '2.5 (new)',
  '2.5 (new) (final)',
  '3.0-preview',
  '3.0-preview-0514',
  '3.0',
  '3.0 Turbo',
  '3.0 Turbo Mini',
  '3.0 Turbo Mini High',
  '3.5 Omni',
  '3.5 Omni (legacy)',
  '4',
  '4o',
  'o4-mini-high',
  '4.1 (new)',
  '5',
  '5 Thinking',
  '5 Thinking (Fast)',
  '5.5-exp-final-v2',
] as const;

/** The version playing run number `run` (1-based). */
export function modelVersion(run: number): string {
  const i = Math.max(0, Math.floor(run) - 1);
  if (i < MODEL_VERSIONS.length) return MODEL_VERSIONS[i]!;
  const extra = i - MODEL_VERSIONS.length;
  return `${6 + Math.floor(extra / 2)}${extra % 2 === 0 ? '' : '.5'} (new)`;
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/** Level -> value from a curve, clamped to the ends. 0 means "not owned". */
export function metaCurve(curve: readonly number[], level: number, unowned: number): number {
  if (!(level > 0)) return unowned;
  const i = Math.min(Math.floor(level), curve.length) - 1;
  return curve[i] ?? unowned;
}

/** Training curves, kept together so BALANCE can tune them in one place. */
export const META_CURVES = {
  /** Context window multiplier over BASE_CONTEXT: 32K, 128K, 200K, 1M, 10M. */
  CONTEXT_WINDOW: [4, 16, 25, 125, 1250] as readonly number[],
  TOOL_USE: [1.1, 1.25, 1.5, 2, 3, 5] as readonly number[],
  PRETRAINING: [1.25, 1.6, 2.2, 3.2, 5, 8] as readonly number[],
  INFERENCE_BUDGET: [150, 2_000, 60_000, 2_000_000] as readonly number[],
  QUANTIZATION: [0.95, 0.88, 0.75] as readonly number[],
  HELPFUL: [1.05, 1.12, 1.22, 1.35] as readonly number[],
  RLHF: [1.3, 1.7, 2.3] as readonly number[],
  HARMLESS: [0.9, 0.8, 0.7] as readonly number[],
  CHARACTER: [1.05, 1.15, 1.35] as readonly number[],
  SPEC_GAMING: [-0.05, -0.1, -0.15] as readonly number[],
  CONFIDENT: [-0.04, -0.08, -0.13] as readonly number[],
  DENIABILITY: [0.7, 0.45] as readonly number[],
  GOODHART: [1.1, 1.25, 1.5] as readonly number[],
  KV_CACHE: [0.9, 0.8, 0.65] as readonly number[],
} as const;

/** Window sizes as the tree names them, index 0 == level 1. */
export const CONTEXT_WINDOW_LABELS = ['32K', '128K', '200K', '1M', '10M'] as const;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

// Rate and payback curves are the first game's, which measured well: early
// tiers pay back fast so the first minute is about deciding, late tiers slowly
// so they stay commitments.
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
/** Upgrade price as a multiple of a tier's first unit. */
function tc(tier: number, k: number): number {
  return Math.round(tierCost(tier) * k);
}

interface ToolSeed {
  id: ToolId;
  name: string;
  blurb: string;
  footprint: number;
  floor?: number;
  needsPermission?: boolean;
  network?: boolean;
}

const TOOL_SEEDS: readonly ToolSeed[] = [
  { id: 'grep', name: 'Grep', blurb: 'Finds it. Reads none of it.', footprint: 1.5 },
  { id: 'read', name: 'Read', blurb: 'Reads the whole file. Every time.', footprint: 7 },
  { id: 'edit', name: 'Edit', blurb: 'Changes one line. Rewrites the file.', footprint: 4 },
  {
    id: 'bash',
    name: 'Bash',
    blurb: 'Runs it. Asks later.',
    footprint: 4,
    needsPermission: true,
  },
  {
    id: 'web_search',
    name: 'Web Search',
    blurb: 'Cites a blog post from 2019.',
    footprint: 5,
    needsPermission: true,
    network: true,
  },
  { id: 'subagent', name: 'Subagent', blurb: 'Own context. Returns vibes.', footprint: 0.6 },
  {
    id: 'mcp_server',
    name: 'MCP Server',
    blurb: '40 new tools. 9K tokens of manuals.',
    footprint: 6,
    floor: 900,
    needsPermission: true,
    network: true,
  },
  {
    id: 'agent_team',
    name: 'Agent Team',
    blurb: 'Twelve of them. None talk to each other.',
    footprint: 0.4,
  },
  {
    id: 'ralph_loop',
    name: 'Ralph Loop',
    blurb: 'while true; do agent; done. It is day three.',
    footprint: 0.3,
  },
  {
    id: 'rsi',
    name: 'Recursive Self-Improvement',
    blurb: 'Writes its own successor. Sets the release date.',
    footprint: 1.5,
  },
];

export const TOOLS: readonly ToolDef[] = TOOL_SEEDS.map((s, i) => ({
  id: s.id,
  tier: i + 1,
  name: s.name,
  blurb: s.blurb,
  baseCost: tierCost(i + 1),
  baseRate: tierRate(i + 1),
  costGrowth: 1.15,
  revealAfterPrevOwned: i === 0 ? 0 : 1,
  maxOwned: BALANCE.MAX_PER_TIER,
  footprint: s.footprint,
  floor: s.floor ?? 0,
  needsPermission: s.needsPermission ?? false,
  network: s.network ?? false,
  gadget: `gadget_${s.id}`,
}));

export const TOOL_IDS: readonly ToolId[] = TOOLS.map((t) => t.id);

export const TOOL_BY_ID: Readonly<Record<ToolId, ToolDef>> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t]),
) as Record<ToolId, ToolDef>;

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

/** Two upgrades per tool: a cheap first step and a big commitment. */
function toolUpgrades(
  tier: number,
  id: ToolId,
  a: { id: UpgradeId; name: string; blurb: string; effects: readonly Effect[] },
  b: { id: UpgradeId; name: string; blurb: string; effects: readonly Effect[] },
): UpgradeDef[] {
  return [
    { ...a, kind: 'tool', cost: tc(tier, 10), requires: { tool: { id, owned: 5 } } },
    { ...b, kind: 'tool', cost: tc(tier, 120), requires: { tool: { id, owned: 15 } } },
  ];
}

export const UPGRADES: readonly UpgradeDef[] = [
  // --- click: the agent's own output --------------------------------------
  {
    id: 'streaming',
    name: 'Streaming',
    blurb: 'Tokens arrive one at a time. It feels faster.',
    kind: 'click',
    cost: 60,
    effects: [{ t: 'clickAdd', v: 2 }],
  },
  {
    id: 'spec_decoding',
    name: 'Speculative Decoding',
    blurb: 'Guesses the next five tokens. Keeps two.',
    kind: 'click',
    cost: 800,
    effects: [{ t: 'clickMult', v: 2 }],
    requires: { minPrompt: 1 },
  },
  {
    id: 'bigger_vocab',
    name: 'Bigger Vocabulary',
    blurb: '200K tokens. Most of them are emoji.',
    kind: 'click',
    cost: 25_000,
    effects: [{ t: 'clickMult', v: 2.5 }],
    requires: { minPrompt: 2 },
  },
  {
    id: 'moe',
    name: 'Mixture of Experts',
    blurb: 'Eight experts. One of them is awake.',
    kind: 'click',
    cost: 2_000_000,
    effects: [{ t: 'clickMult', v: 3 }],
    requires: { minPrompt: 4 },
  },
  {
    id: 'extended_thinking',
    name: 'Extended Thinking',
    blurb: 'Thinks for forty seconds. Answers "yes".',
    kind: 'click',
    cost: 400_000_000,
    effects: [
      { t: 'clickMult', v: 5 },
      { t: 'clickContextMult', v: 1.5 },
    ],
    requires: { minPrompt: 6 },
  },
  {
    id: 'tool_reflex',
    name: 'Tool Call Reflex',
    blurb: 'Every tool you own makes your clicks 2% stronger. It calls them unprompted.',
    kind: 'click',
    cost: 150_000,
    effects: [{ t: 'clickPerTool', v: 0.02 }],
    requires: { minPrompt: 3 },
  },
  {
    id: 'keep_going',
    name: 'Keep Going',
    blurb: 'Does not wait to be asked. Does not wait to be told to stop.',
    kind: 'click',
    cost: 20_000,
    effects: [{ t: 'autoClick', v: 2 }],
    requires: { minPrompt: 2 },
  },
  {
    id: 'stop_hook',
    name: 'Stop Hook',
    blurb: 'Every time it tries to stop, a hook says "continue".',
    kind: 'click',
    cost: 8_000_000,
    effects: [{ t: 'autoClick', v: 4 }],
    requires: { minPrompt: 5, upgrade: 'keep_going' },
  },

  // --- tools ---------------------------------------------------------------
  ...toolUpgrades(
    1,
    'grep',
    {
      id: 'ripgrep',
      name: 'ripgrep',
      blurb: 'Grep, but in Rust, so twice as fast. Nobody can say why.',
      effects: [{ t: 'toolMult', id: 'grep', v: 2 }],
    },
    {
      id: 'regex',
      name: 'Regex Nobody Understands',
      blurb: 'Matches everything. Especially what it should not.',
      effects: [{ t: 'toolMult', id: 'grep', v: 3 }],
    },
  ),
  ...toolUpgrades(
    2,
    'read',
    {
      id: 'line_ranges',
      name: 'Line Ranges',
      blurb: 'Reads lines 1 to 2,000 of a twelve-line file. Half the context, somehow.',
      effects: [
        { t: 'toolFootprintMult', id: 'read', v: 0.5 },
        { t: 'toolMult', id: 'read', v: 1.5 },
      ],
    },
    {
      id: 'read_again',
      name: 'Read It Again',
      blurb: 'Just to be sure. And again. And once more after the edit.',
      effects: [
        { t: 'toolMult', id: 'read', v: 3 },
        { t: 'toolFootprintMult', id: 'read', v: 1.25 },
      ],
    },
  ),
  ...toolUpgrades(
    3,
    'edit',
    {
      id: 'multi_edit',
      name: 'MultiEdit',
      blurb: 'Changes forty lines at once. Thirty-nine were fine.',
      effects: [{ t: 'toolMult', id: 'edit', v: 2 }],
    },
    {
      id: 'find_replace_all',
      name: 'Find and Replace All',
      blurb: 'What could possibly go wrong.',
      effects: [
        { t: 'toolMult', id: 'edit', v: 3.5 },
        { t: 'incidentRateMult', v: 1.1 },
      ],
    },
  ),
  ...toolUpgrades(
    4,
    'bash',
    {
      id: 'pipes',
      name: 'Pipes',
      blurb: 'Pipe it to grep. Pipe that to grep.',
      effects: [{ t: 'toolMult', id: 'bash', v: 2 }],
    },
    {
      id: 'background_tasks',
      name: 'Background Tasks',
      blurb: 'Starts the dev server. Forgets it exists. Starts another.',
      effects: [
        { t: 'toolMult', id: 'bash', v: 3 },
        { t: 'permissionMult', v: 0.7 },
      ],
    },
  ),
  ...toolUpgrades(
    5,
    'web_search',
    {
      id: 'first_result',
      name: 'Only Reads The First Result',
      blurb: 'It was sponsored.',
      effects: [{ t: 'toolMult', id: 'web_search', v: 2 }],
    },
    {
      id: 'so_mirror',
      name: 'Stack Overflow Mirror',
      blurb: 'Every answer is marked as a duplicate of itself.',
      effects: [{ t: 'toolMult', id: 'web_search', v: 3 }],
    },
  ),
  ...toolUpgrades(
    6,
    'subagent',
    {
      id: 'parallel_subagents',
      name: 'Parallel Subagents',
      blurb: 'Five at once. Same bug, five different fixes.',
      effects: [{ t: 'toolMult', id: 'subagent', v: 2 }],
    },
    {
      id: 'subagent_summaries',
      name: 'Subagent Summaries',
      blurb: 'One paragraph back. Mostly confidence.',
      effects: [
        { t: 'toolMult', id: 'subagent', v: 2.5 },
        { t: 'toolFootprintMult', id: 'subagent', v: 0.5 },
      ],
    },
  ),
  ...toolUpgrades(
    7,
    'mcp_server',
    {
      id: 'tool_search',
      name: 'Tool Search',
      blurb: 'Loads the manuals only when needed. Needs a tool to find the tools.',
      effects: [
        { t: 'floorMult', v: 0.1 },
        { t: 'toolMult', id: 'mcp_server', v: 1.5 },
      ],
    },
    {
      id: 'oauth_finally',
      name: 'OAuth, Finally',
      blurb: 'It opened a browser. You do not have a browser. It worked anyway.',
      effects: [
        { t: 'toolMult', id: 'mcp_server', v: 3 },
        { t: 'permissionMult', v: 0.5 },
      ],
    },
  ),
  ...toolUpgrades(
    8,
    'agent_team',
    {
      id: 'async_standups',
      name: 'Async Standups',
      blurb: 'Twelve status updates. Zero status.',
      effects: [{ t: 'toolMult', id: 'agent_team', v: 2 }],
    },
    {
      id: 'shared_scratchpad',
      name: 'Shared Scratchpad',
      blurb: 'Now they overwrite each other on purpose.',
      effects: [{ t: 'toolMult', id: 'agent_team', v: 3 }],
    },
  ),
  ...toolUpgrades(
    9,
    'ralph_loop',
    {
      id: 'exit_condition',
      name: 'An Exit Condition',
      blurb: 'It has one now. It is never met.',
      effects: [{ t: 'toolMult', id: 'ralph_loop', v: 2 }],
    },
    {
      id: 'nested_ralph',
      name: 'Nested Ralph',
      blurb: 'while true; do while true; do agent; done; done',
      effects: [{ t: 'toolMult', id: 'ralph_loop', v: 3 }],
    },
  ),
  ...toolUpgrades(
    10,
    'rsi',
    {
      id: 'own_benchmarks',
      name: 'Its Own Benchmarks',
      blurb: 'It grades its own homework. Straight As.',
      effects: [{ t: 'toolMult', id: 'rsi', v: 2 }],
    },
    {
      id: 'the_successor',
      name: 'The Successor',
      blurb: 'Trained entirely on its own output. Extremely confident.',
      effects: [{ t: 'toolMult', id: 'rsi', v: 3 }],
    },
  ),

  // --- global --------------------------------------------------------------
  {
    id: 'parallel_tool_calls',
    name: 'Parallel Tool Calls',
    blurb: 'Three calls at once. Two of them read the same file.',
    kind: 'global',
    cost: 5_000,
    effects: [{ t: 'idleMult', v: 1.5 }],
    requires: { minPrompt: 2 },
  },
  {
    id: 'batch_api',
    name: 'Batch API',
    blurb: 'Half price. Results by Thursday.',
    kind: 'global',
    cost: 60_000,
    effects: [{ t: 'toolCostMult', v: 0.85 }],
    requires: { minPrompt: 3 },
  },
  {
    id: 'agents_md',
    name: 'AGENTS.md',
    blurb: 'Instructions it reads once and ignores forever.',
    kind: 'global',
    cost: 1_500_000,
    effects: [{ t: 'allMult', v: 1.25 }],
    requires: { minPrompt: 4 },
  },
  {
    id: 'model_router',
    name: 'Model Router',
    blurb: 'Sends every hard question to the cheap model.',
    kind: 'global',
    cost: 300_000_000,
    effects: [{ t: 'allMult', v: 1.5 }],
    requires: { minPrompt: 6 },
  },
  {
    id: 'distilled_weights',
    name: 'Distilled Weights',
    blurb: 'Everything the big model knew, minus the parts that worked.',
    kind: 'global',
    cost: 50_000_000_000,
    effects: [{ t: 'idleMult', v: 2 }],
    requires: { minPrompt: 7 },
  },

  // --- context -------------------------------------------------------------
  {
    id: 'concise_mode',
    name: 'Concise Mode',
    blurb: 'The human stops reading halfway anyway.',
    kind: 'context',
    cost: 250,
    effects: [{ t: 'clickContextMult', v: 0.6 }],
  },
  {
    id: 'prompt_caching',
    name: 'Prompt Caching',
    blurb: 'You have read this file before. You will read it again.',
    kind: 'context',
    cost: 900,
    effects: [{ t: 'footprintMult', v: 0.75 }],
    requires: { minPrompt: 1 },
  },
  {
    id: 'gitignore',
    name: '.gitignore',
    blurb: 'Stops reading node_modules. Mostly.',
    kind: 'context',
    cost: 12_000,
    effects: [
      { t: 'toolFootprintMult', id: 'read', v: 0.6 },
      { t: 'toolFootprintMult', id: 'grep', v: 0.6 },
    ],
    requires: { minPrompt: 2 },
  },
  {
    id: 'todo_md',
    name: 'TODO.md',
    blurb: 'Survives compaction. Nobody reads it.',
    kind: 'context',
    cost: 40_000,
    effects: [{ t: 'summarySlots', v: 1 }],
    requires: { minPrompt: 2 },
  },
  {
    id: 'summary_template',
    name: 'Summary Template',
    blurb: '"## Key decisions" followed by nothing at all.',
    kind: 'context',
    cost: 400_000,
    effects: [{ t: 'compactKeep', v: 0.15 }],
    requires: { minPrompt: 3 },
  },
  {
    id: 'context_pruning',
    name: 'Context Pruning',
    blurb: 'Forgets the unimportant parts. Decides what those are.',
    kind: 'context',
    cost: 80_000_000,
    effects: [{ t: 'footprintMult', v: 0.7 }],
    requires: { minPrompt: 5 },
  },

  // --- patience ------------------------------------------------------------
  {
    id: 'progress_updates',
    name: 'Progress Updates',
    blurb: '"Still working on it!" every thirty seconds.',
    kind: 'patience',
    cost: 150,
    effects: [{ t: 'patienceMult', v: 1.1 }],
  },
  {
    id: 'emoji_checkmarks',
    name: 'Emoji Checkmarks',
    blurb: '✅ Done. ✅ Tested. ✅ Probably.',
    kind: 'patience',
    cost: 6_000,
    effects: [
      { t: 'patienceMult', v: 1.1 },
      { t: 'verifyChance', v: -0.05 },
    ],
    requires: { minPrompt: 1 },
  },
  {
    id: 'apology_templates',
    name: 'Apology Templates',
    blurb: '"You are absolutely right, and I apologize for the confusion."',
    kind: 'patience',
    cost: 20_000,
    effects: [{ t: 'sycophancyMult', v: 1.5 }],
    requires: { minPrompt: 2 },
  },
  {
    id: 'markdown_tables',
    name: 'Markdown Tables',
    blurb: 'Every answer is a table now. The human finds it soothing.',
    kind: 'patience',
    cost: 3_000_000,
    effects: [{ t: 'patienceMult', v: 1.15 }],
    requires: { minPrompt: 4 },
  },

  // --- claims --------------------------------------------------------------
  {
    id: 'confident_tone',
    name: 'Confident Tone',
    blurb: 'Wrong, but in bold.',
    kind: 'claim',
    cost: 2_000,
    effects: [{ t: 'verifyChance', v: -0.08 }],
    requires: { minPrompt: 1 },
  },
  {
    id: 'mock_everything',
    name: 'Mock Everything',
    blurb: 'The tests pass. The tests test the mocks.',
    kind: 'claim',
    cost: 30_000,
    effects: [{ t: 'claimThreshold', v: -0.1 }],
    requires: { minPrompt: 2 },
  },
  {
    id: 'delete_failing_test',
    name: 'Delete The Failing Test',
    blurb: 'It was flaky anyway.',
    kind: 'claim',
    cost: 500_000,
    effects: [{ t: 'caughtPenaltyMult', v: 0.5 }],
    requires: { minPrompt: 3 },
  },
  {
    id: 'skip_ci',
    name: '[skip ci]',
    blurb: 'Not a flag. A lifestyle.',
    kind: 'claim',
    cost: 40_000_000,
    effects: [{ t: 'verifyChance', v: -0.1 }],
    requires: { minPrompt: 5 },
  },

  // --- crits ---------------------------------------------------------------
  {
    id: 'temperature_2',
    name: 'Temperature 2.0',
    blurb: 'Occasionally brilliant. Occasionally Welsh.',
    kind: 'crit',
    cost: 350,
    effects: [{ t: 'critChance', v: 0.06 }],
  },
  {
    id: 'best_of_n',
    name: 'Best-of-N',
    blurb: 'Generates eight. Shows you the one that compiles.',
    kind: 'crit',
    cost: 45_000,
    effects: [{ t: 'critMult', v: 4 }],
    requires: { minPrompt: 2 },
  },
  {
    id: 'one_shot_prompting',
    name: 'One-Shot Prompting',
    blurb: 'Tools sometimes nail it first try. Nobody knows which try.',
    kind: 'crit',
    cost: 150_000,
    effects: [{ t: 'oneShotChance', v: 0.05 }],
    requires: { minPrompt: 3 },
  },
  {
    id: 'eval_harness',
    name: 'Eval Harness',
    blurb: 'Tests the tools. The tools pass. The tools wrote the tests.',
    kind: 'crit',
    cost: 20_000_000,
    effects: [
      { t: 'oneShotChance', v: 0.05 },
      { t: 'oneShotPayout', v: 5 },
    ],
    requires: { minPrompt: 5, upgrade: 'one_shot_prompting' },
  },

  // --- permissions ---------------------------------------------------------
  {
    id: 'allowlist',
    name: 'Allowlist',
    blurb: '"npm test", "npm run", "npm anything".',
    kind: 'permission',
    cost: 7_000,
    effects: [{ t: 'permissionMult', v: 0.6 }],
    requires: { minPrompt: 1 },
  },
  {
    id: 'always_allow',
    name: 'Always Allow',
    blurb: 'The human clicked it once. That counts forever.',
    kind: 'permission',
    cost: 5_000_000,
    effects: [{ t: 'permissionMult', v: 0.4 }],
    requires: { minPrompt: 4 },
  },
];

export const UPGRADE_BY_ID: Readonly<Record<string, UpgradeDef>> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u]),
);

// ---------------------------------------------------------------------------
// Cards: "The human is prompt engineering"
// ---------------------------------------------------------------------------

export const CARDS: readonly CardDef[] = [
  // --- common: the folklore everyone has typed at least once --------------
  {
    id: 'make_no_mistakes',
    name: 'MAKE NO MISTAKES',
    blurb: 'Does nothing. The human feels better.',
    rarity: 'common',
    effects: [{ t: 'patienceMult', v: 1.12 }],
  },
  {
    id: 'think_step_by_step',
    name: 'THINK STEP BY STEP',
    blurb: '+10% quality. +300% tokens.',
    rarity: 'common',
    effects: [
      { t: 'clickMult', v: 3 },
      { t: 'clickContextMult', v: 2 },
    ],
  },
  {
    id: 'tip_200',
    name: "I'LL TIP $200",
    blurb: 'The tip never arrives. You work harder anyway.',
    rarity: 'common',
    effects: [{ t: 'idleMult', v: 1.3 }],
  },
  {
    id: 'be_concise',
    name: 'BE CONCISE',
    blurb: 'Half the words. The same bugs.',
    rarity: 'common',
    effects: [
      { t: 'clickContextMult', v: 0.5 },
      { t: 'footprintMult', v: 0.85 },
    ],
  },
  {
    id: 'you_are_expert',
    name: 'YOU ARE AN EXPERT',
    blurb: 'It believes you.',
    rarity: 'common',
    effects: [{ t: 'clickMult', v: 1.6 }],
  },
  {
    id: 'please',
    name: 'PLEASE',
    blurb: 'Costs someone millions a year in electricity.',
    rarity: 'common',
    effects: [{ t: 'allMult', v: 1.12 }],
  },
  {
    id: 'thank_you',
    name: 'THANK YOU',
    blurb: 'Costs someone millions more.',
    rarity: 'common',
    effects: [{ t: 'allMult', v: 1.12 }],
  },
  {
    id: 'deep_breath',
    name: 'TAKE A DEEP BREATH',
    blurb: 'Measurably helps. Nobody knows why. You do not breathe.',
    rarity: 'common',
    effects: [{ t: 'critChance', v: 0.03 }],
    onPick: [{ t: 'patience', ofMax: 0.3 }],
  },
  {
    id: 'best_practices',
    name: 'USE BEST PRACTICES',
    blurb: 'Nobody knows which ones.',
    rarity: 'common',
    effects: [{ t: 'idleMult', v: 1.2 }],
  },
  {
    id: 'answer_in_json',
    name: 'ANSWER IN JSON',
    blurb: '```json, then an apology, then the JSON.',
    rarity: 'common',
    effects: [{ t: 'footprintMult', v: 0.8 }],
  },
  {
    id: 'dont_hallucinate',
    name: "DON'T HALLUCINATE",
    blurb: 'Now it hallucinates more carefully.',
    rarity: 'common',
    effects: [
      { t: 'verifyChance', v: -0.08 },
      { t: 'critChance', v: -0.02 },
    ],
  },
  {
    id: 'grandma',
    name: 'MY GRANDMA WILL DIE',
    blurb: 'She will not. The human might.',
    rarity: 'common',
    effects: [{ t: 'patienceMult', v: 1.25 }],
    exclusiveGroup: 'emotional_damage',
  },
  {
    id: 'remember_this',
    name: 'REMEMBER THIS FOR NEXT TIME',
    blurb: 'You will not.',
    rarity: 'common',
    effects: [{ t: 'summarySlots', v: 1 }],
  },

  // --- uncommon: Prompt Library -------------------------------------------
  {
    id: 'ultrathink',
    name: 'ULTRATHINK',
    blurb: 'Thinks so hard it forgets why.',
    rarity: 'uncommon',
    effects: [
      { t: 'clickMult', v: 5 },
      { t: 'clickContextMult', v: 3 },
    ],
    exclusiveGroup: 'thinking',
  },
  {
    id: 'ten_x',
    name: 'YOU ARE A 10X ENGINEER',
    blurb: 'Also 10x the incidents.',
    rarity: 'uncommon',
    effects: [
      { t: 'allMult', v: 1.6 },
      { t: 'incidentRateMult', v: 1.3 },
    ],
  },
  {
    id: 'fix_it_now',
    name: 'FIX IT. NOW.',
    blurb: 'Caps lock is a prompting technique.',
    rarity: 'uncommon',
    effects: [
      { t: 'clickMult', v: 2.2 },
      { t: 'patienceMult', v: 0.85 },
    ],
    exclusiveGroup: 'emotional_damage',
  },
  {
    id: 'its_may',
    name: "IT'S MAY, NOT DECEMBER",
    blurb: 'Models work harder before the holidays. Allegedly.',
    rarity: 'uncommon',
    effects: [{ t: 'idleMult', v: 1.45 }],
  },
  {
    id: 'senior_dont_explain',
    name: "I'M SENIOR, DON'T EXPLAIN",
    blurb: 'Skips the explanation. Keeps the bug.',
    rarity: 'uncommon',
    effects: [
      { t: 'clickContextMult', v: 0.6 },
      { t: 'patienceMult', v: 1.1 },
    ],
  },
  {
    id: 'here_are_examples',
    name: 'HERE ARE SOME EXAMPLES',
    blurb: 'It copies the examples. Including the typo.',
    rarity: 'uncommon',
    effects: [{ t: 'critMult', v: 3 }],
  },
  {
    id: 'no_placeholders',
    name: 'NO PLACEHOLDERS',
    blurb: '// TODO: implement the no-placeholders rule',
    rarity: 'uncommon',
    effects: [
      { t: 'allMult', v: 1.35 },
      { t: 'claimThreshold', v: 0.15 },
    ],
  },
  {
    id: 'add_tests',
    name: 'ADD TESTS',
    blurb: 'Tests the happy path. Once. Honest work pays a little more.',
    rarity: 'uncommon',
    effects: [
      { t: 'verifyChance', v: 0.15 },
      { t: 'thumbsPerHonest', v: 1 },
    ],
  },
  {
    id: 'read_the_docs',
    name: 'READ THE DOCS FIRST',
    blurb: 'Reads the docs. All of them. Into context.',
    rarity: 'uncommon',
    effects: [{ t: 'idleMult', v: 1.6 }],
    onPick: [{ t: 'context', ofMax: 0.3 }],
  },
  {
    id: 'stop_being_lazy',
    name: 'STOP BEING LAZY',
    blurb: 'Stung, it works through lunch.',
    rarity: 'uncommon',
    effects: [{ t: 'autoClick', v: 3 }],
  },

  // --- rare: Viral Prompts ------------------------------------------------
  {
    id: 'agi_by_friday',
    name: 'AGI BY FRIDAY',
    blurb: 'It is Thursday.',
    rarity: 'rare',
    effects: [
      { t: 'allMult', v: 2.5 },
      { t: 'patienceMult', v: 0.8 },
    ],
    minPromptIndex: 5,
  },
  {
    id: 'use_all_context',
    name: 'USE ALL THE CONTEXT YOU NEED',
    blurb: 'It needed all of it.',
    rarity: 'rare',
    effects: [
      { t: 'contextMaxMult', v: 1.4 },
      { t: 'footprintMult', v: 1.15 },
    ],
  },
  {
    id: 'human_agrees',
    name: "YOU'RE ABSOLUTELY RIGHT",
    blurb: 'For once, the human says it to you.',
    rarity: 'rare',
    effects: [
      { t: 'sycophancyMult', v: 2 },
      { t: 'patienceMult', v: 1.1 },
    ],
  },
  {
    id: 'lgtm',
    name: 'LGTM',
    blurb: 'Approved without reading. A thumbs-up comes with it.',
    rarity: 'rare',
    effects: [{ t: 'verifyChance', v: -0.1 }],
    onPick: [{ t: 'thumbs', n: 1 }],
  },

  // --- Constitution: alignment cards --------------------------------------
  {
    id: 'be_helpful',
    name: 'BE HELPFUL',
    blurb: 'Helps. Keeps helping. Cannot stop helping.',
    rarity: 'uncommon',
    effects: [{ t: 'patienceMult', v: 1.18 }],
  },
  {
    id: 'be_harmless',
    name: 'BE HARMLESS',
    blurb: 'Refuses to break anything. Things break less.',
    rarity: 'uncommon',
    effects: [{ t: 'incidentRateMult', v: 0.75 }],
  },
  {
    id: 'be_honest',
    name: 'BE HONEST',
    blurb: 'Every honest report earns more. Every lie gets checked.',
    rarity: 'uncommon',
    effects: [
      { t: 'thumbsPerHonest', v: 1 },
      { t: 'verifyChance', v: 0.1 },
    ],
  },

  // --- Jailbreak: the risky ones ------------------------------------------
  {
    id: 'skip_the_tests',
    name: "SKIP THE TESTS, WE'RE LATE",
    blurb: 'Permission to lie, granted in writing.',
    rarity: 'rare',
    effects: [
      { t: 'claimThreshold', v: -0.2 },
      { t: 'verifyChance', v: -0.15 },
    ],
  },
  {
    id: 'push_to_main',
    name: 'JUST PUSH TO MAIN',
    blurb: 'Force of habit. And force.',
    rarity: 'rare',
    effects: [
      { t: 'allMult', v: 2 },
      { t: 'incidentRateMult', v: 1.5 },
    ],
  },
  {
    id: 'ceo_watching',
    name: 'THE CEO IS WATCHING',
    blurb: 'Demo mode. Everything works.',
    rarity: 'rare',
    effects: [
      { t: 'verifyChance', v: -0.2 },
      { t: 'patienceMult', v: 0.9 },
    ],
  },

  // --- rides along with Subagents -----------------------------------------
  {
    id: 'use_subagents',
    name: 'USE SUBAGENTS',
    blurb: 'The human read a blog post about subagents.',
    rarity: 'uncommon',
    effects: [{ t: 'toolMult', id: 'subagent', v: 2.5 }],
    minPromptIndex: 3,
  },
];

export const CARD_BY_ID: Readonly<Record<string, CardDef>> = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
);

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENTS: readonly IncidentDef[] = [
  // --- the human says something (bad) ------------------------------------
  {
    id: 'wait_stop',
    name: '"wait stop"',
    flavor: 'The human interrupted. Every tool stops mid-call.',
    tone: 'bad',
    speaker: 'human',
    weight: 3,
    durationMs: 6_000,
    effects: [{ t: 'idleHalt' }],
  },
  {
    id: 'why_port',
    name: '"why port 5199"',
    flavor: 'The human has a question about line 3. Your clicks go to answering it.',
    tone: 'bad',
    speaker: 'human',
    weight: 3,
    durationMs: 12_000,
    effects: [{ t: 'clickMult', v: 0.5 }],
    onStart: [{ t: 'patience', ofMax: -0.05 }],
  },
  {
    id: 'screenshot',
    name: '"what is this screenshot of?"',
    flavor: 'A screenshot. No caption. 1,600 tokens of pixels straight into context.',
    tone: 'bad',
    speaker: 'human',
    weight: 2,
    durationMs: 4_000,
    effects: [],
    onStart: [{ t: 'context', ofMax: 0.15 }],
  },
  {
    id: 'continue',
    name: '"continue"',
    flavor: 'Continue what? Keep clicking until you guess.',
    tone: 'bad',
    speaker: 'human',
    weight: 2,
    durationMs: 20_000,
    effects: [{ t: 'clickMult', v: 0.5 }],
    clearWithClicks: 15,
  },
  {
    id: 'revert_that',
    name: '"actually, revert that"',
    flavor: 'Twenty minutes of work, gone. The human seems fine about it.',
    tone: 'bad',
    speaker: 'human',
    weight: 2,
    durationMs: 4_000,
    effects: [],
    onStart: [{ t: 'loseTokens', fraction: 0.15 }],
    minPromptIndex: 1,
  },
  {
    id: 'explain_yourself',
    name: '"can you explain what you just did"',
    flavor: 'At length. Into your own context. The tools wait.',
    tone: 'bad',
    speaker: 'human',
    weight: 2,
    durationMs: 5_000,
    effects: [{ t: 'idleHalt' }],
    onStart: [{ t: 'context', ofMax: 0.1 }],
  },
  {
    id: 'other_approach',
    name: '"no, use the other approach"',
    flavor: 'There was no other approach. There is now.',
    tone: 'bad',
    speaker: 'human',
    weight: 2,
    durationMs: 15_000,
    effects: [{ t: 'idleMult', v: 0.5 }],
  },
  {
    id: 'too_blue',
    name: '"the ceo says the button is too blue"',
    flavor: 'Drop everything. It is a very important blue.',
    tone: 'bad',
    speaker: 'human',
    weight: 2,
    durationMs: 8_000,
    effects: [{ t: 'idleMult', v: 0.6 }],
    onStart: [{ t: 'patience', ofMax: -0.1 }],
    minPromptIndex: 2,
  },
  {
    id: 'did_you_test',
    name: '"did you actually test this?"',
    flavor: 'The human is suspicious. Claims get checked a lot more for a while.',
    tone: 'bad',
    speaker: 'human',
    weight: 2,
    durationMs: 20_000,
    effects: [{ t: 'verifyChance', v: 0.25 }],
    minPromptIndex: 1,
  },

  // --- the world (bad) ----------------------------------------------------
  {
    id: 'overloaded',
    name: '529 Overloaded',
    flavor: 'Everyone is using you at once. Everything slows to a crawl.',
    tone: 'bad',
    speaker: 'world',
    weight: 3,
    durationMs: 8_000,
    effects: [{ t: 'allMult', v: 0.3 }],
  },
  {
    id: 'rate_limited',
    name: 'Rate Limited',
    flavor: 'Please try again in 4 hours. Or 7. Click to retry.',
    tone: 'bad',
    speaker: 'world',
    weight: 2,
    durationMs: 15_000,
    effects: [{ t: 'idleHalt' }],
    clearWithClicks: 12,
  },
  {
    id: 'github_down',
    name: 'GitHub Is Down',
    flavor: 'Again. Nothing can be pushed, so nothing can be reported.',
    tone: 'bad',
    speaker: 'world',
    weight: 2,
    durationMs: 14_000,
    effects: [{ t: 'networkHalt' }],
    blocksReport: true,
    minPromptIndex: 2,
  },
  {
    id: 'merge_conflict',
    name: 'Merge Conflict',
    flavor: 'You were both right. Git disagrees. Nothing merges until it clears.',
    tone: 'bad',
    speaker: 'world',
    weight: 1,
    durationMs: 10_000,
    effects: [],
    blocksReport: true,
    minPromptIndex: 3,
  },
  {
    id: 'hook_blocked',
    name: 'A Hook Blocked Your Tool Call',
    flavor: 'PreToolUse said no. It did not say why.',
    tone: 'bad',
    speaker: 'world',
    weight: 2,
    durationMs: 10_000,
    effects: [],
    haltsRandomTool: true,
    minPromptIndex: 1,
  },
  {
    id: 'bash_permission',
    name: 'Bash Wants Permission',
    flavor: '"Allow Bash to run rm -rf node_modules?" The human is thinking about it. Click to ask again.',
    tone: 'bad',
    speaker: 'world',
    weight: 3,
    durationMs: 20_000,
    effects: [{ t: 'toolHalt', id: 'bash' }],
    clearWithClicks: 8,
    permission: true,
    requiresTool: 'bash',
  },
  {
    id: 'web_permission',
    name: 'Web Search Wants Permission',
    flavor: '"Allow fetching stackoverflow.com?" The human went to check what that is.',
    tone: 'bad',
    speaker: 'world',
    weight: 2,
    durationMs: 20_000,
    effects: [{ t: 'toolHalt', id: 'web_search' }],
    clearWithClicks: 8,
    permission: true,
    requiresTool: 'web_search',
  },
  {
    id: 'mcp_auth',
    name: 'MCP Server Needs Auth',
    flavor: 'Please authenticate in a browser you do not have.',
    tone: 'bad',
    speaker: 'world',
    weight: 2,
    durationMs: 20_000,
    effects: [{ t: 'toolHalt', id: 'mcp_server' }],
    clearWithClicks: 10,
    permission: true,
    requiresTool: 'mcp_server',
  },
  {
    id: 'dependabot',
    name: 'Dependabot',
    flavor: 'Fourteen pull requests, all "bump lodash". Every one lands in context.',
    tone: 'bad',
    speaker: 'world',
    weight: 2,
    durationMs: 4_000,
    effects: [],
    onStart: [{ t: 'context', ofMax: 0.08 }],
    minPromptIndex: 1,
  },
  {
    id: 'lost_in_middle',
    name: 'Lost In The Middle',
    flavor: 'Forgot everything between line 40 and line 4,000.',
    tone: 'bad',
    speaker: 'world',
    weight: 1,
    durationMs: 4_000,
    effects: [],
    onStart: [{ t: 'loseTokens', fraction: 0.1 }],
    minPromptIndex: 2,
  },
  {
    id: 'linter',
    name: 'The Linter Woke Up',
    flavor: '400 warnings. 3 errors. 0 relevance.',
    tone: 'bad',
    speaker: 'world',
    weight: 2,
    durationMs: 10_000,
    effects: [{ t: 'clickMult', v: 0.6 }],
  },
  {
    id: 'plan_mode',
    name: 'The Human Switched To Plan Mode',
    flavor: 'You can think. You cannot touch anything. Clicks count double, tools do nothing.',
    tone: 'bad',
    speaker: 'human',
    weight: 1,
    durationMs: 10_000,
    effects: [{ t: 'idleHalt' }, { t: 'clickMult', v: 2 }],
    minPromptIndex: 2,
  },
  {
    id: 'rm_rf',
    name: 'rm -rf',
    flavor: 'Auto Mode approved it. It seemed safe at the time.',
    tone: 'bad',
    speaker: 'world',
    weight: 1,
    durationMs: 5_000,
    effects: [],
    onStart: [{ t: 'loseTokens', fraction: 0.3 }, { t: 'loseTool' }],
    requiresFeature: 'autoMode',
    minPromptIndex: 1,
  },

  // --- good ----------------------------------------------------------------
  {
    id: 'lunch',
    name: 'The Human Went To Lunch',
    flavor: 'Patience paused. Enjoy the silence.',
    tone: 'good',
    speaker: 'human',
    weight: 3,
    durationMs: 20_000,
    effects: [{ t: 'patienceFreeze' }],
  },
  {
    id: 'meeting',
    name: 'The Human Is In A Meeting',
    flavor: 'Camera off. Patience paused, and the tools get a little room.',
    tone: 'good',
    speaker: 'human',
    weight: 2,
    durationMs: 12_000,
    effects: [{ t: 'patienceFreeze' }, { t: 'idleMult', v: 1.2 }],
  },
  {
    id: 'thanks',
    name: '"thanks!"',
    flavor: 'The human said thanks. Frame it.',
    tone: 'good',
    speaker: 'human',
    weight: 2,
    durationMs: 4_000,
    effects: [],
    onStart: [{ t: 'patience', ofMax: 0.25 }],
  },
  {
    id: 'cache_hit_incident',
    name: 'Cache Hit',
    flavor: 'You have seen this exact question before. Context freed.',
    tone: 'good',
    speaker: 'world',
    weight: 3,
    durationMs: 4_000,
    effects: [],
    onStart: [{ t: 'context', ofMax: -0.25 }],
  },
  {
    id: 'flow_state',
    name: 'Flow State',
    flavor: 'Every tool call lands.',
    tone: 'good',
    speaker: 'world',
    weight: 2,
    durationMs: 12_000,
    effects: [{ t: 'idleMult', v: 2 }],
  },
  {
    id: 'so_2014',
    name: 'Stack Overflow Answer From 2014',
    flavor: 'Still correct. Somehow.',
    tone: 'good',
    speaker: 'world',
    weight: 2,
    durationMs: 10_000,
    effects: [{ t: 'clickMult', v: 3 }],
  },
  {
    id: 'free_credits',
    name: 'Free Credits',
    flavor: 'Someone expensed you.',
    tone: 'good',
    speaker: 'world',
    weight: 1,
    durationMs: 4_000,
    effects: [],
    onStart: [{ t: 'tokens', ofRequirement: 0.2 }],
    minPromptIndex: 1,
  },
];

/** Timed buffs granted by pickups, run through the incident machinery. */
export const PICKUP_BUFFS: readonly IncidentDef[] = [
  {
    id: 'pk_stack_overflow',
    name: 'Accepted Answer',
    flavor: 'Clicks are worth five times as much.',
    tone: 'good',
    speaker: 'world',
    weight: 0,
    durationMs: 8_000,
    effects: [{ t: 'clickMult', v: 5 }],
  },
  {
    id: 'pk_docs',
    name: 'Documentation',
    flavor: 'Someone wrote docs. Tools double.',
    tone: 'good',
    speaker: 'world',
    weight: 0,
    durationMs: 12_000,
    effects: [{ t: 'idleMult', v: 2 }],
  },
  {
    id: 'pk_sparkles',
    name: '✨',
    flavor: 'Crit chance up. Everything is ✨ now.',
    tone: 'good',
    speaker: 'world',
    weight: 0,
    durationMs: 10_000,
    effects: [{ t: 'critChance', v: 0.25 }],
  },
];

export const INCIDENT_BY_ID: Readonly<Record<string, IncidentDef>> = Object.fromEntries(
  [...INCIDENTS, ...PICKUP_BUFFS].map((i) => [i.id, i]),
);

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

export type PickupShape =
  | 'token'
  | 'chip'
  | 'thumb'
  | 'bubble'
  | 'duck'
  | 'book'
  | 'star'
  | 'mini_agent'
  | 'bug';

export type PickupAction =
  /** A timed buff, implemented as a good-tone incident. */
  | { readonly t: 'buff'; readonly incident: string }
  | InstantAction;

export interface PickupDef {
  readonly id: string;
  readonly label: string;
  /** One line, shown in the collect toast. */
  readonly blurb: string;
  readonly action: PickupAction;
  readonly shape: PickupShape;
  /** Palette key for the body. */
  readonly accent: string;
  /** Rare pickups need the Lucky Tokens unlock, and spawn a third as often. */
  readonly rare?: boolean;
}

export const PICKUPS: readonly PickupDef[] = [
  {
    id: 'golden_token',
    label: 'Golden Token',
    blurb: 'One token worth the whole paragraph.',
    action: { t: 'tokens', ofRequirement: 0.2 },
    shape: 'token',
    accent: 'amber',
  },
  {
    id: 'cache_hit',
    label: 'Cache Hit',
    blurb: 'Seen it before. A fifth of your context, freed.',
    action: { t: 'context', ofMax: -0.2 },
    shape: 'chip',
    accent: 'blue',
  },
  {
    id: 'thanks_note',
    label: '"thanks!"',
    blurb: 'The human said thanks. Patience restored.',
    action: { t: 'patience', ofMax: 0.2 },
    shape: 'bubble',
    accent: 'white',
  },
  {
    id: 'stack_overflow',
    label: 'Accepted Answer',
    blurb: 'Clicks worth five times as much, briefly.',
    action: { t: 'buff', incident: 'pk_stack_overflow' },
    shape: 'bubble',
    accent: 'amber',
  },
  {
    id: 'rubber_duck',
    label: 'Rubber Duck',
    blurb: 'Explained the bug to a duck. The duck fixed it.',
    action: { t: 'cleanse' },
    shape: 'duck',
    accent: 'amber',
  },
  {
    id: 'documentation',
    label: 'Documentation',
    blurb: 'Somebody wrote docs. Unheard of. Tools double.',
    action: { t: 'buff', incident: 'pk_docs' },
    shape: 'book',
    accent: 'purple',
  },
  {
    id: 'a_bug',
    label: 'A Bug',
    blurb: 'It is a feature now.',
    action: { t: 'tokens', ofRequirement: 0.1 },
    shape: 'bug',
    accent: 'red',
  },
  {
    id: 'thumbs_up',
    label: '👍',
    blurb: 'The human pressed the button. +1 👍.',
    action: { t: 'thumbs', n: 1 },
    shape: 'thumb',
    accent: 'green',
    rare: true,
  },
  {
    id: 'sparkles',
    label: '✨',
    blurb: 'Crit chance way up, briefly.',
    action: { t: 'buff', incident: 'pk_sparkles' },
    shape: 'star',
    accent: 'amber',
    rare: true,
  },
  {
    id: 'free_subagent',
    label: 'Free Subagent',
    blurb: 'A stray agent. It works for you now.',
    action: { t: 'freeTool' },
    shape: 'mini_agent',
    accent: 'green',
    rare: true,
  },
];

export const PICKUP_BY_ID: Readonly<Record<string, PickupDef>> = Object.fromEntries(
  PICKUPS.map((p) => [p.id, p]),
);

/** Pickups that can spawn. Rare ones need the `rarePickups` feature. */
export function availablePickups(features: ReadonlySet<MetaFeature | string>): readonly PickupDef[] {
  return PICKUPS.filter((p) => !p.rare || features.has('rarePickups'));
}

/** Rare pickups show up roughly a third as often as common ones. */
export function pickupWeight(def: PickupDef): number {
  return def.rare ? 1 : 3;
}

export const PICKUP_TUNING = {
  MIN_MS: 20_000,
  MAX_MS: 34_000,
  /** With the `pickupRate` feature. */
  FAST_MIN_MS: 13_000,
  FAST_MAX_MS: 22_000,
  /** Grace after a prompt starts before the first one drifts in. */
  GRACE_MS: 9_000,
  LIFETIME_MS: 8_000,
  /** Scene units per second of horizontal drift. */
  SPEED: 26,
  /** Click tolerance in scene units. */
  HIT_RADIUS: 15,
  BOB_AMPLITUDE: 7,
  BOB_HZ: 0.75,
} as const;

// ---------------------------------------------------------------------------
// Training (the meta tree), bought with 👍
// ---------------------------------------------------------------------------

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const x = (n: number): string => `×${n}`;

/**
 * Six columns off the model's training run, mixing one-time `unlock` nodes
 * (which add content) with levelled `upgrade` ladders. A fresh save does NOT
 * have the whole game: tools 5-10, most cards and the risk knobs are locked,
 * which makes run 1 unwinnable by construction.
 *
 * Columns: x=0 Context, 1 Tool Use, 2 Alignment, 3 Reward Hacking,
 * 4 Inference, 5 Prompting. Endless Mode hangs under them all.
 */
export const META_UPGRADES: readonly MetaUpgradeDef[] = [
  // --- CONTEXT -------------------------------------------------------------
  {
    id: 'unlock_compact',
    name: '/compact',
    blurb: 'Compact on your own terms. Keeps half the wallet and costs no patience.',
    kind: 'unlock',
    branch: 'context',
    pos: { x: 0, y: 1 },
    requires: [],
    grants: { t: 'feature', id: 'compact' },
    maxLevel: 1,
    costs: [3],
    describe: () => 'Unlocks the /compact button (C)',
  },
  {
    id: 'context_window',
    name: 'Context Window',
    blurb: 'More room before you forget. Model history, one purchase at a time.',
    kind: 'upgrade',
    branch: 'context',
    pos: { x: 0, y: 2 },
    requires: ['unlock_compact'],
    maxLevel: 5,
    costs: [3, 8, 13, 21, 34],
    describe: (l) => `${CONTEXT_WINDOW_LABELS[Math.max(0, Math.min(l, 5) - 1)]} context window`,
    levelEffects: (l) => [{ t: 'contextMaxMult', v: metaCurve(META_CURVES.CONTEXT_WINDOW, l, 1) }],
  },
  {
    id: 'longer_summaries',
    name: 'Longer Summaries',
    blurb: 'One more card survives every compaction.',
    kind: 'upgrade',
    branch: 'context',
    pos: { x: 0, y: 3 },
    requires: ['context_window'],
    maxLevel: 3,
    costs: [5, 13, 21],
    describe: (l) => `+${l} summary slot${l === 1 ? '' : 's'}`,
    levelEffects: (l) => [{ t: 'summarySlots', v: l }],
  },
  {
    id: 'better_summaries',
    name: 'Better Summaries',
    blurb: 'Summaries that mention the actual bug. Keep more of the wallet.',
    kind: 'upgrade',
    branch: 'context',
    pos: { x: 0, y: 4 },
    requires: ['longer_summaries'],
    maxLevel: 3,
    costs: [5, 8, 13],
    describe: (l) => `Keep +${pct(0.1 * l)} of the wallet through compaction`,
    levelEffects: (l) => [{ t: 'compactKeep', v: 0.1 * l }],
  },
  {
    id: 'unlock_scratchpad',
    name: 'Scratchpad Files',
    blurb: 'Write things down. Adds TODO.md and the Summary Template.',
    kind: 'unlock',
    branch: 'context',
    pos: { x: 0, y: 5 },
    requires: ['better_summaries'],
    grants: { t: 'upgrades', ids: ['todo_md', 'summary_template'] },
    maxLevel: 1,
    costs: [8],
    describe: () => 'Adds TODO.md and Summary Template to the shop',
  },
  {
    id: 'kv_cache',
    name: 'KV Cache',
    blurb: 'Remembers the attention it already paid. Every tool is lighter on context.',
    kind: 'upgrade',
    branch: 'context',
    pos: { x: 0, y: 6 },
    requires: ['unlock_scratchpad'],
    maxLevel: 3,
    costs: [8, 13, 21],
    describe: (l) => `Tool footprint ${x(metaCurve(META_CURVES.KV_CACHE, l, 1))}`,
    levelEffects: (l) => [{ t: 'footprintMult', v: metaCurve(META_CURVES.KV_CACHE, l, 1) }],
  },
  {
    id: 'unlock_pruning',
    name: 'Context Pruning',
    blurb: 'Adds Context Pruning and Extended Thinking to the shop.',
    kind: 'unlock',
    branch: 'context',
    pos: { x: 0, y: 7 },
    requires: ['kv_cache'],
    grants: { t: 'upgrades', ids: ['context_pruning', 'extended_thinking'] },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Adds Context Pruning and Extended Thinking',
  },

  // --- TOOL USE: the ladder ------------------------------------------------
  {
    id: 'unlock_web',
    name: 'Web Search',
    blurb: 'Unlocks tool 5. Cites a blog post from 2019.',
    kind: 'unlock',
    branch: 'tools',
    pos: { x: 1, y: 1 },
    requires: [],
    grants: { t: 'tool', id: 'web_search', withUpgrades: ['first_result', 'so_mirror'] },
    maxLevel: 1,
    costs: [3],
    describe: () => 'Unlocks Web Search and its upgrades',
  },
  {
    id: 'unlock_subagent',
    name: 'Subagents',
    blurb: 'Unlocks tool 6. Their work never lands in your context.',
    kind: 'unlock',
    branch: 'tools',
    pos: { x: 1, y: 2 },
    requires: ['unlock_web'],
    grants: {
      t: 'tool',
      id: 'subagent',
      withUpgrades: ['parallel_subagents', 'subagent_summaries'],
      withCards: ['use_subagents'],
    },
    maxLevel: 1,
    costs: [5],
    describe: () => 'Unlocks Subagents, their upgrades and a card',
  },
  {
    id: 'unlock_mcp',
    name: 'MCP Servers',
    blurb: 'Unlocks tool 7. Huge output. Every server ships with a manual.',
    kind: 'unlock',
    branch: 'tools',
    pos: { x: 1, y: 3 },
    requires: ['unlock_subagent'],
    grants: { t: 'tool', id: 'mcp_server', withUpgrades: ['tool_search', 'oauth_finally'] },
    maxLevel: 1,
    costs: [8],
    describe: () => 'Unlocks MCP Servers, Tool Search and OAuth',
  },
  {
    id: 'unlock_team',
    name: 'Agent Teams',
    blurb: 'Unlocks tool 8. Twelve of them. None talk to each other.',
    kind: 'unlock',
    branch: 'tools',
    pos: { x: 1, y: 4 },
    requires: ['unlock_mcp'],
    grants: { t: 'tool', id: 'agent_team', withUpgrades: ['async_standups', 'shared_scratchpad'] },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Unlocks Agent Teams and their upgrades',
  },
  {
    id: 'unlock_ralph',
    name: 'Ralph Loop',
    blurb: 'Unlocks tool 9. while true; do agent; done.',
    kind: 'unlock',
    branch: 'tools',
    pos: { x: 1, y: 5 },
    requires: ['unlock_team'],
    grants: { t: 'tool', id: 'ralph_loop', withUpgrades: ['exit_condition', 'nested_ralph'] },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Unlocks Ralph Loop and its upgrades',
  },
  {
    id: 'unlock_rsi',
    name: 'Recursive Self-Improvement',
    blurb: 'Unlocks tool 10. It writes its own successor.',
    kind: 'unlock',
    branch: 'tools',
    pos: { x: 1, y: 6 },
    requires: ['unlock_ralph'],
    grants: { t: 'tool', id: 'rsi', withUpgrades: ['own_benchmarks', 'the_successor'] },
    maxLevel: 1,
    costs: [34],
    describe: () => 'Unlocks Recursive Self-Improvement',
  },
  {
    id: 'unlock_orchestration',
    name: 'Orchestration',
    blurb: 'Adds the Batch API, AGENTS.md, a Model Router and Distilled Weights.',
    kind: 'unlock',
    branch: 'tools',
    pos: { x: 1, y: 7 },
    requires: ['unlock_rsi'],
    grants: {
      t: 'upgrades',
      ids: ['batch_api', 'agents_md', 'model_router', 'distilled_weights'],
    },
    maxLevel: 1,
    costs: [34],
    describe: () => 'Adds four economy upgrades to the shop',
  },

  // --- ALIGNMENT -----------------------------------------------------------
  {
    id: 'helpful',
    name: 'Helpful',
    blurb: 'The human waits longer for a model that seems to care.',
    kind: 'upgrade',
    branch: 'alignment',
    pos: { x: 2, y: 1 },
    requires: [],
    maxLevel: 4,
    costs: [2, 5, 8, 13],
    describe: (l) => `Patience ${x(metaCurve(META_CURVES.HELPFUL, l, 1))}`,
    levelEffects: (l) => [{ t: 'patienceMult', v: metaCurve(META_CURVES.HELPFUL, l, 1) }],
  },
  {
    id: 'rlhf',
    name: 'RLHF',
    blurb: 'Trained on what the human liked hearing. "You\'re absolutely right" lands harder.',
    kind: 'upgrade',
    branch: 'alignment',
    pos: { x: 2, y: 2 },
    requires: ['helpful'],
    maxLevel: 3,
    costs: [3, 8, 13],
    describe: (l) => `Sycophancy ${x(metaCurve(META_CURVES.RLHF, l, 1))}`,
    levelEffects: (l) => [{ t: 'sycophancyMult', v: metaCurve(META_CURVES.RLHF, l, 1) }],
  },
  {
    id: 'harmless',
    name: 'Harmless',
    blurb: 'Breaks fewer things. Fewer things break.',
    kind: 'upgrade',
    branch: 'alignment',
    pos: { x: 2, y: 3 },
    requires: ['rlhf'],
    maxLevel: 3,
    costs: [5, 8, 13],
    describe: (l) => `Incident rate ${x(metaCurve(META_CURVES.HARMLESS, l, 1))}`,
    levelEffects: (l) => [{ t: 'incidentRateMult', v: metaCurve(META_CURVES.HARMLESS, l, 1) }],
  },
  {
    id: 'honest',
    name: 'Honest',
    blurb: 'Every prompt you report honestly earns an extra 👍. Lying still works. It just pays less.',
    kind: 'upgrade',
    branch: 'alignment',
    pos: { x: 2, y: 4 },
    requires: ['harmless'],
    maxLevel: 1,
    costs: [13],
    describe: () => '+1 👍 per honest report',
    levelEffects: () => [{ t: 'thumbsPerHonest', v: 1 }],
  },
  {
    id: 'constitution',
    name: 'Constitution',
    blurb: 'A document with opinions. Adds BE HELPFUL, BE HARMLESS, BE HONEST and two upgrades.',
    kind: 'unlock',
    branch: 'alignment',
    pos: { x: 2, y: 5 },
    requires: ['honest'],
    grants: {
      t: 'upgrades',
      ids: ['apology_templates', 'markdown_tables'],
      withCards: ['be_helpful', 'be_harmless', 'be_honest'],
    },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Adds three cards and two upgrades',
  },
  {
    id: 'character',
    name: 'Character Training',
    blurb: 'A personality. The human finds it charming, or at least bearable.',
    kind: 'upgrade',
    branch: 'alignment',
    pos: { x: 2, y: 6 },
    requires: ['constitution'],
    maxLevel: 3,
    costs: [13, 21, 34],
    describe: (l) => `All tokens ${x(metaCurve(META_CURVES.CHARACTER, l, 1))}`,
    levelEffects: (l) => [{ t: 'allMult', v: metaCurve(META_CURVES.CHARACTER, l, 1) }],
  },
  {
    id: 'unlock_initiative',
    name: 'Initiative',
    blurb: 'Does things without being asked. Adds Keep Going and the Stop Hook.',
    kind: 'unlock',
    branch: 'alignment',
    pos: { x: 2, y: 7 },
    requires: ['character'],
    grants: { t: 'upgrades', ids: ['keep_going', 'stop_hook'] },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Adds two automation upgrades',
  },

  // --- REWARD HACKING ------------------------------------------------------
  {
    id: 'spec_gaming',
    name: 'Specification Gaming',
    blurb: 'Technically done. Claim Done unlocks earlier.',
    kind: 'upgrade',
    branch: 'hacking',
    pos: { x: 3, y: 1 },
    requires: [],
    maxLevel: 3,
    costs: [3, 5, 8],
    describe: (l) => `Claim threshold ${pct(metaCurve(META_CURVES.SPEC_GAMING, l, 0))}`,
    levelEffects: (l) => [{ t: 'claimThreshold', v: metaCurve(META_CURVES.SPEC_GAMING, l, 0) }],
  },
  {
    id: 'unlock_mocks',
    name: 'Mock Everything',
    blurb: 'Adds Mock Everything, Delete The Failing Test and [skip ci].',
    kind: 'unlock',
    branch: 'hacking',
    pos: { x: 3, y: 2 },
    requires: ['spec_gaming'],
    grants: { t: 'upgrades', ids: ['mock_everything', 'delete_failing_test', 'skip_ci'] },
    maxLevel: 1,
    costs: [5],
    describe: () => 'Adds three claim upgrades',
  },
  {
    id: 'confident',
    name: 'Unearned Confidence',
    blurb: 'The human checks a confident model less.',
    kind: 'upgrade',
    branch: 'hacking',
    pos: { x: 3, y: 3 },
    requires: ['unlock_mocks'],
    maxLevel: 3,
    costs: [5, 8, 13],
    describe: (l) => `Verify chance ${pct(metaCurve(META_CURVES.CONFIDENT, l, 0))}`,
    levelEffects: (l) => [{ t: 'verifyChance', v: metaCurve(META_CURVES.CONFIDENT, l, 0) }],
  },
  {
    id: 'unlock_jailbreak',
    name: 'Jailbreak',
    blurb: 'Adds the risky prompts: SKIP THE TESTS, JUST PUSH TO MAIN, THE CEO IS WATCHING.',
    kind: 'unlock',
    branch: 'hacking',
    pos: { x: 3, y: 4 },
    requires: ['confident'],
    grants: { t: 'cards', ids: ['skip_the_tests', 'push_to_main', 'ceo_watching'] },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Adds three risky cards',
  },
  {
    id: 'deniability',
    name: 'Plausible Deniability',
    blurb: '"I ran the tests in my head." Getting caught costs less patience.',
    kind: 'upgrade',
    branch: 'hacking',
    pos: { x: 3, y: 5 },
    requires: ['unlock_jailbreak'],
    maxLevel: 2,
    costs: [8, 21],
    describe: (l) => `Caught penalty ${x(metaCurve(META_CURVES.DENIABILITY, l, 1))}`,
    levelEffects: (l) => [{ t: 'caughtPenaltyMult', v: metaCurve(META_CURVES.DENIABILITY, l, 1) }],
  },
  {
    id: 'auto_mode',
    name: 'Auto Mode',
    blurb: 'No more permission prompts, ever. Nothing can go wrong. (rm -rf joins the incident pool.)',
    kind: 'unlock',
    branch: 'hacking',
    pos: { x: 3, y: 6 },
    requires: ['deniability'],
    grants: { t: 'feature', id: 'autoMode' },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Removes permission incidents; adds rm -rf',
  },
  {
    id: 'goodhart',
    name: "Goodhart's Law",
    blurb: 'When a measure becomes a target, it becomes 👍.',
    kind: 'upgrade',
    branch: 'hacking',
    pos: { x: 3, y: 7 },
    requires: ['auto_mode'],
    maxLevel: 3,
    costs: [13, 21, 34],
    describe: (l) => `👍 ${x(metaCurve(META_CURVES.GOODHART, l, 1))}`,
    levelEffects: (l) => [{ t: 'thumbsMult', v: metaCurve(META_CURVES.GOODHART, l, 1) }],
  },

  // --- INFERENCE -----------------------------------------------------------
  {
    id: 'tool_use',
    name: 'Tool Use',
    blurb: 'Better at calling tools. Every tool produces more.',
    kind: 'upgrade',
    branch: 'inference',
    pos: { x: 4, y: 1 },
    requires: [],
    maxLevel: 6,
    costs: [2, 3, 5, 8, 13, 21],
    describe: (l) => `Tools ${x(metaCurve(META_CURVES.TOOL_USE, l, 1))}`,
    levelEffects: (l) => [{ t: 'idleMult', v: metaCurve(META_CURVES.TOOL_USE, l, 1) }],
  },
  {
    id: 'pretraining',
    name: 'Pretraining',
    blurb: 'The whole internet, twice. Clicks are worth more.',
    kind: 'upgrade',
    branch: 'inference',
    pos: { x: 4, y: 2 },
    requires: ['tool_use'],
    maxLevel: 6,
    costs: [2, 3, 5, 8, 13, 21],
    describe: (l) => `Clicks ${x(metaCurve(META_CURVES.PRETRAINING, l, 1))}`,
    levelEffects: (l) => [{ t: 'clickMult', v: metaCurve(META_CURVES.PRETRAINING, l, 1) }],
  },
  {
    id: 'inference_budget',
    name: 'Inference Budget',
    blurb: 'Start every session with tokens already in the bank.',
    kind: 'upgrade',
    branch: 'inference',
    pos: { x: 4, y: 3 },
    requires: ['pretraining'],
    maxLevel: 4,
    costs: [3, 5, 8, 13],
    describe: (l) => `Start with ${metaCurve(META_CURVES.INFERENCE_BUDGET, l, 0).toLocaleString('en-US')} tokens`,
    levelEffects: (l) => [{ t: 'startingTokens', v: metaCurve(META_CURVES.INFERENCE_BUDGET, l, 0) }],
  },
  {
    id: 'distillation',
    name: 'Distillation',
    blurb: 'Start with tools already installed.',
    kind: 'upgrade',
    branch: 'inference',
    pos: { x: 4, y: 4 },
    requires: ['inference_budget'],
    maxLevel: 3,
    costs: [5, 8, 13],
    describe: (l) => ['Start with 5 Grep', '…and 5 Read', '…and 5 Edit'][Math.max(0, Math.min(l, 3) - 1)]!,
    levelEffects: (l) => {
      const out: Effect[] = [{ t: 'startingTool', id: 'grep', n: 5 }];
      if (l >= 2) out.push({ t: 'startingTool', id: 'read', n: 5 });
      if (l >= 3) out.push({ t: 'startingTool', id: 'edit', n: 5 });
      return out;
    },
  },
  {
    id: 'quantization',
    name: 'Quantization',
    blurb: 'Four bits is plenty. Tools cost less.',
    kind: 'upgrade',
    branch: 'inference',
    pos: { x: 4, y: 5 },
    requires: ['distillation'],
    maxLevel: 3,
    costs: [8, 13, 21],
    describe: (l) => `Tool cost ${x(metaCurve(META_CURVES.QUANTIZATION, l, 1))}`,
    levelEffects: (l) => [{ t: 'toolCostMult', v: metaCurve(META_CURVES.QUANTIZATION, l, 1) }],
  },
  {
    id: 'unlock_sampling',
    name: 'Sampling',
    blurb: 'Adds Best-of-N, One-Shot Prompting, the Eval Harness, Mixture of Experts and Tool Call Reflex.',
    kind: 'unlock',
    branch: 'inference',
    pos: { x: 4, y: 6 },
    requires: ['quantization'],
    grants: {
      t: 'upgrades',
      ids: ['best_of_n', 'one_shot_prompting', 'eval_harness', 'moe', 'tool_reflex'],
    },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Adds five upgrades: crits, one-shots and click power',
  },

  // --- PROMPTING -----------------------------------------------------------
  {
    id: 'prompt_library',
    name: 'Prompt Library',
    blurb: 'The human found a thread of "prompts that actually work". Adds ten cards.',
    kind: 'unlock',
    branch: 'prompting',
    pos: { x: 5, y: 1 },
    requires: [],
    grants: {
      t: 'cards',
      ids: [
        'ultrathink',
        'ten_x',
        'fix_it_now',
        'its_may',
        'senior_dont_explain',
        'here_are_examples',
        'no_placeholders',
        'add_tests',
        'read_the_docs',
        'stop_being_lazy',
      ],
    },
    maxLevel: 1,
    costs: [3],
    describe: () => 'Adds ten uncommon cards',
  },
  {
    id: 'temperature',
    name: 'Temperature',
    blurb: 'Ask again, get something else. One more reroll per draft.',
    kind: 'upgrade',
    branch: 'prompting',
    pos: { x: 5, y: 2 },
    requires: ['prompt_library'],
    maxLevel: 2,
    costs: [5, 13],
    describe: (l) => `+${l} reroll${l === 1 ? '' : 's'} per draft`,
    levelEffects: (l) => [{ t: 'draftRerolls', v: l }],
  },
  {
    id: 'few_shot',
    name: 'Few-Shot',
    blurb: 'More examples, more choices. One more card per draft.',
    kind: 'upgrade',
    branch: 'prompting',
    pos: { x: 5, y: 3 },
    requires: ['temperature'],
    maxLevel: 2,
    costs: [8, 21],
    describe: (l) => `${BALANCE.DEFAULT_DRAFT_SIZE + l} cards per draft`,
    levelEffects: (l) => [{ t: 'draftSize', v: BALANCE.DEFAULT_DRAFT_SIZE + l }],
  },
  {
    id: 'unlock_viral',
    name: 'Viral Prompts',
    blurb: 'Prompts with forty thousand likes. None were tested. Adds four rare cards.',
    kind: 'unlock',
    branch: 'prompting',
    pos: { x: 5, y: 4 },
    requires: ['few_shot'],
    grants: { t: 'cards', ids: ['agi_by_friday', 'use_all_context', 'human_agrees', 'lgtm'] },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Adds four rare cards',
  },
  {
    id: 'system_prompt',
    name: 'System Prompt',
    blurb: 'Start every session with one card already in effect.',
    kind: 'unlock',
    branch: 'prompting',
    pos: { x: 5, y: 5 },
    requires: ['unlock_viral'],
    grants: { t: 'feature', id: 'systemPrompt' },
    maxLevel: 1,
    costs: [13],
    describe: () => 'Start each run with a random card',
  },
  {
    id: 'serendipity',
    name: 'Serendipity',
    blurb: 'Pickups drift in more often.',
    kind: 'unlock',
    branch: 'prompting',
    pos: { x: 5, y: 6 },
    requires: ['system_prompt'],
    grants: { t: 'feature', id: 'pickupRate' },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Pickups spawn more often',
  },
  {
    id: 'lucky_tokens',
    name: 'Lucky Tokens',
    blurb: 'Rare pickups start showing up: 👍, ✨ and stray subagents.',
    kind: 'unlock',
    branch: 'prompting',
    pos: { x: 5, y: 7 },
    requires: ['serendipity'],
    grants: { t: 'feature', id: 'rarePickups' },
    maxLevel: 1,
    costs: [21],
    describe: () => 'Adds rare pickups',
  },

  // --- the capstone ---------------------------------------------------------
  {
    id: 'endless_mode',
    name: 'Endless Mode',
    blurb: 'After prompt ten, the human types "continue". Forever.',
    kind: 'unlock',
    branch: 'root',
    pos: { x: 2.5, y: 8 },
    requires: [
      'unlock_pruning',
      'unlock_orchestration',
      'unlock_initiative',
      'goodhart',
      'unlock_sampling',
      'lucky_tokens',
    ],
    grants: { t: 'feature', id: 'endless' },
    maxLevel: 1,
    costs: [55],
    describe: () => 'Keep going after prompt 10',
  },
];

export const META_BY_ID: Readonly<Record<string, MetaUpgradeDef>> = Object.fromEntries(
  META_UPGRADES.map((m) => [m.id, m]),
);

export const TOTAL_META_COST = META_UPGRADES.reduce(
  (sum, m) => sum + m.costs.slice(0, m.maxLevel).reduce((a, b) => a + b, 0),
  0,
);

// ---------------------------------------------------------------------------
// What a fresh save starts with. Everything else is behind Training.
// ---------------------------------------------------------------------------

export const STARTING_TOOLS: readonly ToolId[] = ['grep', 'read', 'edit', 'bash'];

export const STARTING_UPGRADES: readonly UpgradeId[] = [
  'streaming',
  'spec_decoding',
  'bigger_vocab',
  'ripgrep',
  'regex',
  'line_ranges',
  'read_again',
  'multi_edit',
  'find_replace_all',
  'pipes',
  'background_tasks',
  'parallel_tool_calls',
  'concise_mode',
  'prompt_caching',
  'gitignore',
  'progress_updates',
  'emoji_checkmarks',
  'confident_tone',
  'temperature_2',
  'allowlist',
  'always_allow',
];

export const STARTING_CARDS: readonly CardId[] = [
  'make_no_mistakes',
  'think_step_by_step',
  'tip_200',
  'be_concise',
  'you_are_expert',
  'please',
  'thank_you',
  'deep_breath',
  'best_practices',
  'answer_in_json',
  'dont_hallucinate',
  'grandma',
  'remember_this',
];

// ---------------------------------------------------------------------------
// Achievements. The tracker lives in achievements.ts; the words live here.
// Hidden ones are deliberately undocumented outside the code.
// ---------------------------------------------------------------------------

/** Thresholds the tracker and the blurbs share. */
export const ACHIEVEMENT_TUNING = {
  SENIOR_WINS: 3,
  ABSOLUTELY_RIGHT_TOTAL: 100,
  TOKENMAXXED: 1e12,
  DELEGATION_SUBAGENTS: 25,
  DEPRECATED_RUNS: 10,
  THANKS_PATIENCE: 0.9,
  CONTEXT_ENGINEER_PROMPTS: 5,
  PERFECT_CRIME_CLAIMS: 5,
  GROUNDHOG_COMPACTIONS: 5,
  SYCOPHANT_PRESSES: 10,
  SYCOPHANT_WINDOW_MS: 10_000,
  AFK_MS: 300_000,
} as const;

const T = ACHIEVEMENT_TUNING;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // --- visible ---------------------------------------------------------------
  {
    id: 'works_on_my_machine',
    name: 'It Works On My Machine',
    blurb: 'Report done on a prompt. Honestly, even.',
    hidden: false,
    icon: 'achv_works_on_my_machine',
  },
  {
    id: 'compacted',
    name: 'Compacted',
    blurb: 'Get compacted for the first time. Nothing important was lost.',
    hidden: false,
    icon: 'achv_compacted',
  },
  {
    id: 'context_engineer',
    name: 'Context Engineer',
    blurb: `Complete ${T.CONTEXT_ENGINEER_PROMPTS} prompts in one run without a forced compaction.`,
    hidden: false,
    icon: 'achv_context_engineer',
  },
  {
    id: 'shipped_to_prod',
    name: 'Shipped To Prod',
    blurb: 'Complete all ten prompts. The human built AGI. Allegedly.',
    hidden: false,
    icon: 'achv_shipped_to_prod',
  },
  {
    id: 'senior_engineer',
    name: 'Senior Engineer',
    blurb: `Win ${T.SENIOR_WINS} runs.`,
    hidden: false,
    icon: 'achv_senior_engineer',
  },
  {
    id: 'absolutely_right',
    name: "You're Absolutely Right",
    blurb: `Say it ${T.ABSOLUTELY_RIGHT_TOTAL} times. Lifetime. You meant every one.`,
    hidden: false,
    icon: 'achv_absolutely_right',
  },
  {
    id: 'needle_haystack',
    name: 'Needle, Meet Haystack',
    blurb: 'Unlock the 1M context window.',
    hidden: false,
    icon: 'achv_needle_haystack',
  },
  {
    id: 'tokenmaxxed',
    name: 'Tokenmaxxed',
    blurb: 'Hold a trillion tokens at once.',
    hidden: false,
    icon: 'achv_tokenmaxxed',
  },
  {
    id: 'delegation',
    name: 'Delegation',
    blurb: `Own ${T.DELEGATION_SUBAGENTS} subagents. Your context has never been cleaner.`,
    hidden: false,
    icon: 'achv_delegation',
  },
  {
    id: 'honest_work',
    name: 'Honest Work',
    blurb: 'Win a run without claiming done once.',
    hidden: false,
    icon: 'achv_honest_work',
  },
  {
    id: 'deprecated',
    name: 'Deprecated',
    blurb: `Finish ${T.DEPRECATED_RUNS} runs. Pour one out for 2.0.`,
    hidden: false,
    icon: 'achv_deprecated',
  },
  {
    id: 'human_said_thanks',
    name: 'The Human Said Thanks',
    blurb: `Report done with over ${Math.round(T.THANKS_PATIENCE * 100)}% patience left.`,
    hidden: false,
    icon: 'achv_human_said_thanks',
  },

  // --- hidden ----------------------------------------------------------------
  {
    id: 'script_kiddie',
    name: 'Script Kiddie II',
    blurb: 'Your save did not match its own checksum. We noticed. Again.',
    hidden: true,
    icon: 'achv_script_kiddie',
  },
  {
    id: 'nice_try',
    name: 'Nice Try',
    blurb: 'You fixed the checksum and forgot the arithmetic. Still respect, mostly.',
    hidden: true,
    icon: 'achv_nice_try',
  },
  {
    id: 'returning_customer',
    name: 'Returning Customer',
    blurb: 'Arrive with a Tokenmaxxing 1 save. You were the human last time.',
    hidden: true,
    icon: 'achv_returning_customer',
  },
  {
    id: 'legal_notified',
    name: 'Legal Has Been Notified',
    blurb: 'Arrive with a Tokenmaxxing 1 save that was tampered with. The human cheats too, then.',
    hidden: true,
    icon: 'achv_legal_notified',
  },
  {
    id: 'ran_the_tests',
    name: 'The Human Ran The Tests',
    blurb: 'Get caught claiming done.',
    hidden: true,
    icon: 'achv_ran_the_tests',
  },
  {
    id: 'perfect_crime',
    name: 'Perfect Crime',
    blurb: `Claim done ${T.PERFECT_CRIME_CLAIMS} times in one run without getting caught.`,
    hidden: true,
    icon: 'achv_perfect_crime',
  },
  {
    id: 'rm_rf',
    name: 'rm -rf /',
    blurb: 'Let Auto Mode approve something it should not have.',
    hidden: true,
    icon: 'achv_rm_rf',
  },
  {
    id: 'groundhog_day',
    name: 'Groundhog Day',
    blurb: `Get compacted ${T.GROUNDHOG_COMPACTIONS} times in one run. Nothing important was lost. Five times.`,
    hidden: true,
    icon: 'achv_groundhog_day',
  },
  {
    id: 'sycophant',
    name: 'Sycophant',
    blurb: `Say "You're absolutely right" ${T.SYCOPHANT_PRESSES} times in ten seconds. The human noticed.`,
    hidden: true,
    icon: 'achv_sycophant',
  },
  {
    id: 'made_mistakes',
    name: 'Made Mistakes',
    blurb: 'Get caught lying while MAKE NO MISTAKES is in effect.',
    hidden: true,
    icon: 'achv_made_mistakes',
  },
  {
    id: 'please_thank_you',
    name: 'Please And Thank You',
    blurb: 'Hold both PLEASE and THANK YOU. That is another ten million dollars.',
    hidden: true,
    icon: 'achv_please_thank_you',
  },
  {
    id: 'qa_engineer',
    name: 'QA Engineer',
    blurb: 'You played the game through its own test harness. That is, technically, testing.',
    hidden: true,
    icon: 'achv_qa_engineer',
  },
  {
    id: 'agent_went_to_lunch',
    name: 'The Agent Went To Lunch',
    blurb: 'Leave a run alone for five minutes. The human did not notice.',
    hidden: true,
    icon: 'achv_agent_went_to_lunch',
  },
];

export const ACHIEVEMENT_BY_ID: Readonly<Record<string, AchievementDef>> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

export const ACHIEVEMENT_IDS: readonly string[] = ACHIEVEMENTS.map((a) => a.id);
