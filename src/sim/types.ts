/**
 * FROZEN CONTRACT: Tokenmaxxing 2 shared types.
 *
 * Every module (sim / render / audio / ui / tests) codes against this file.
 * Additive changes only: add new fields/members, never rename or remove.
 * If you believe a breaking change is required, stop and report it instead.
 *
 * The game: you are the agent. You generate tokens (run currency) to complete
 * the human's prompts before their patience runs out. Everything you do fills
 * your context window; overflow it and you get compacted. See DESIGN.md.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** The tool ladder, tier 1..10. */
export type ToolId =
  | 'grep'
  | 'read'
  | 'edit'
  | 'bash'
  | 'web_search'
  | 'subagent'
  | 'mcp_server'
  | 'agent_team'
  | 'ralph_loop'
  | 'rsi';

export type UpgradeId = string;
export type AchievementId = string;
export type CardId = string;
export type IncidentId = string;
export type MetaUpgradeId = string;

/**
 * The human's room, seen through the glass. These are Tokenmaxxing 1's own
 * scenes: the human climbs through the first game while you do the work.
 */
export type SceneKey = 'bedroom' | 'coworking' | 'openplan' | 'datacenter' | 'orbital';

// ---------------------------------------------------------------------------
// Content definitions (static data, see src/sim/content.ts)
// ---------------------------------------------------------------------------

export interface ToolDef {
  readonly id: ToolId;
  /** 1-based ladder position. */
  readonly tier: number;
  readonly name: string;
  readonly blurb: string;
  /** Cost of the first unit, before cost-scaling and modifiers. */
  readonly baseCost: number;
  /** Tokens per second produced by one unit, before modifiers. */
  readonly baseRate: number;
  /** Cost multiplier per unit already owned. Standard idle curve. */
  readonly costGrowth: number;
  /** Tier is hidden until the player owns >= this many of the previous tier. */
  readonly revealAfterPrevOwned: number;
  /** Hard ceiling on units of this tool. */
  readonly maxOwned: number;
  /**
   * Context added per second by one unit. Tool power upgrades raise tokens,
   * never footprint, so runs get more token-efficient as they go.
   */
  readonly footprint: number;
  /**
   * Permanent context occupied by one owned unit, whether or not it is
   * working. Only MCP Servers have one: they ship with manuals.
   */
  readonly floor: number;
  /** Can be stalled by permission incidents. Auto Mode removes those. */
  readonly needsPermission: boolean;
  /** Stops working during network outages ("GitHub Is Down"). */
  readonly network: boolean;
  /** Stage gadget sprite key rendered when >= 1 owned. */
  readonly gadget: string;
}

export type UpgradeKind =
  | 'click'
  | 'tool'
  | 'global'
  | 'context'
  | 'patience'
  | 'claim'
  | 'crit'
  | 'permission';

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly name: string;
  readonly blurb: string;
  readonly kind: UpgradeKind;
  readonly cost: number;
  /** Effects applied once purchased. */
  readonly effects: readonly Effect[];
  /** Purchasable only when this predicate passes. */
  readonly requires?: UpgradeRequirement;
}

export interface UpgradeRequirement {
  /** 0-based prompt index the run must have reached. */
  readonly minPrompt?: number;
  readonly tool?: { readonly id: ToolId; readonly owned: number };
  readonly upgrade?: UpgradeId;
}

export interface CardDef {
  readonly id: CardId;
  /** Rendered in caps on the card: it is something the human typed. */
  readonly name: string;
  readonly blurb: string;
  readonly rarity: 'common' | 'uncommon' | 'rare';
  readonly effects: readonly Effect[];
  /** Applied once, the moment the card is picked. */
  readonly onPick?: readonly InstantAction[];
  /** Cards with the same exclusiveGroup can never both appear in one run. */
  readonly exclusiveGroup?: string;
  /** Earliest prompt index (0-based) at which this card may be offered. */
  readonly minPromptIndex?: number;
}

/**
 * One-shot changes applied when an incident starts, a pickup is collected or a
 * card is picked. Timed modifiers are Effects; these are the lump sums.
 */
export type InstantAction =
  /** Add context, as a fraction of the current window. Negative frees it. */
  | { readonly t: 'context'; readonly ofMax: number }
  /** Add patience, as a fraction of the current prompt's patience. Negative drains it. */
  | { readonly t: 'patience'; readonly ofMax: number }
  /** Grant tokens as a fraction of the current requirement. */
  | { readonly t: 'tokens'; readonly ofRequirement: number }
  /** Lose this fraction of the wallet. */
  | { readonly t: 'loseTokens'; readonly fraction: number }
  /** Lose one unit of a random owned tool. */
  | { readonly t: 'loseTool' }
  /** One free unit of the best tool the player already fields. */
  | { readonly t: 'freeTool' }
  /** Clear every active bad incident. */
  | { readonly t: 'cleanse' }
  /** Add to the pending 👍 tally. */
  | { readonly t: 'thumbs'; readonly n: number };

export interface IncidentDef {
  readonly id: IncidentId;
  readonly name: string;
  readonly flavor: string;
  readonly tone: 'bad' | 'good';
  /**
   * `human` incidents are something the human said, and render as a chat
   * bubble through the glass. `world` incidents are the environment.
   */
  readonly speaker: 'human' | 'world';
  /** Relative selection weight within its tone bucket. */
  readonly weight: number;
  readonly durationMs: number;
  /** Modifiers active for the incident's duration. */
  readonly effects: readonly Effect[];
  /** Applied once when the incident starts. */
  readonly onStart?: readonly InstantAction[];
  /** If set, the incident clears early once the player accrues this many clicks. */
  readonly clearWithClicks?: number;
  /** An outage: reporting (and claiming) is impossible while it is active. */
  readonly blocksReport?: boolean;
  /** A permission prompt. Removed from the pool by the `autoMode` feature. */
  readonly permission?: boolean;
  /** Only in the pool while this feature is unlocked (e.g. rm -rf needs autoMode). */
  readonly requiresFeature?: MetaFeature;
  /** Only in the pool while the player owns at least one of this tool. */
  readonly requiresTool?: ToolId;
  /**
   * Stalls one random owned tool for the duration. The sim resolves which when
   * it fires and records it on `ActiveIncident.tool`.
   */
  readonly haltsRandomTool?: boolean;
  /** Earliest prompt index (0-based) at which this incident may fire. */
  readonly minPromptIndex?: number;
}

export interface PromptDef {
  readonly index: number; // 0-based
  /** What the human typed, verbatim. Lower case, as humans type. */
  readonly text: string;
  /** Tokens required to report done. */
  readonly requirement: number;
  /** Patience in milliseconds, before modifiers. */
  readonly patienceMs: number;
  /** The human's room behind the glass. */
  readonly scene: SceneKey;
}

export type MetaFeature =
  | 'endless'
  | 'compact'
  | 'autoMode'
  | 'systemPrompt'
  | 'pickupRate'
  | 'rarePickups';

/** What a one-time Training unlock adds to the game. */
export type MetaGrant =
  /** Makes a tool purchasable at all, with the upgrades that make it work. */
  | {
      readonly t: 'tool';
      readonly id: ToolId;
      readonly withUpgrades?: readonly UpgradeId[];
      readonly withCards?: readonly CardId[];
    }
  /** Adds upgrades to the in-run shop pool, with any cards that need them. */
  | { readonly t: 'upgrades'; readonly ids: readonly UpgradeId[]; readonly withCards?: readonly CardId[] }
  /** Adds cards to the draft pool. */
  | { readonly t: 'cards'; readonly ids: readonly CardId[] }
  /** Switches on a standalone feature. */
  | { readonly t: 'feature'; readonly id: MetaFeature };

/** Which trunk of the Training tree a node hangs off. */
export type MetaBranch =
  | 'root'
  | 'context'
  | 'tools'
  | 'alignment'
  | 'hacking'
  | 'inference'
  | 'prompting';

export interface MetaUpgradeDef {
  readonly id: MetaUpgradeId;
  readonly name: string;
  readonly blurb: string;
  readonly maxLevel: number;
  /** 👍 cost for each level, index 0 == level 1. */
  readonly costs: readonly number[];
  /** Human-readable effect summary given a level. */
  readonly describe: (level: number) => string;
  /** `unlock` adds content and is bought once. `upgrade` is a levelled ladder. */
  readonly kind: 'unlock' | 'upgrade';
  readonly branch: MetaBranch;
  /** Grid position in tree space. Hand-authored. */
  readonly pos: { readonly x: number; readonly y: number };
  /** Nodes that must be owned before this one can be bought. */
  readonly requires: readonly MetaUpgradeId[];
  /** Content this node adds. Only meaningful for `kind: 'unlock'`. */
  readonly grants?: MetaGrant;
  /**
   * Modifiers this node applies at a given level (1..maxLevel). The single
   * source of truth for what a Training node does to a run.
   */
  readonly levelEffects?: (level: number) => readonly Effect[];
}

// ---------------------------------------------------------------------------
// Effects: the single vocabulary for every modifier in the game
// ---------------------------------------------------------------------------

export type Effect =
  /** Multiply tokens gained per click. */
  | { readonly t: 'clickMult'; readonly v: number }
  /** Add flat tokens per click (applied before clickMult). */
  | { readonly t: 'clickAdd'; readonly v: number }
  /** Add clickMult equal to v * (total tools owned). */
  | { readonly t: 'clickPerTool'; readonly v: number }
  /** Multiply total tool production. */
  | { readonly t: 'idleMult'; readonly v: number }
  /** Multiply production of one tool. */
  | { readonly t: 'toolMult'; readonly id: ToolId; readonly v: number }
  /** Multiply every token source (click + tools). */
  | { readonly t: 'allMult'; readonly v: number }
  /** Multiply tool purchase cost (0.9 == 10% cheaper). */
  | { readonly t: 'toolCostMult'; readonly v: number }
  /** Multiply incident frequency (1.5 == 50% more incidents). */
  | { readonly t: 'incidentRateMult'; readonly v: number }
  /** Multiply each prompt's patience (1.2 == the human waits 20% longer). */
  | { readonly t: 'patienceMult'; readonly v: number }
  /** Patience does not drain while active. */
  | { readonly t: 'patienceFreeze' }
  /** Multiply 👍 earned at run end. */
  | { readonly t: 'thumbsMult'; readonly v: number }
  /** Extra 👍 for every prompt reported honestly (not claimed). */
  | { readonly t: 'thumbsPerHonest'; readonly v: number }
  /** Tokens granted at run start. */
  | { readonly t: 'startingTokens'; readonly v: number }
  /** Free tools at run start. */
  | { readonly t: 'startingTool'; readonly id: ToolId; readonly n: number }
  /** Number of cards offered per draft. */
  | { readonly t: 'draftSize'; readonly v: number }
  /** Rerolls available per draft. */
  | { readonly t: 'draftRerolls'; readonly v: number }
  /** Automatic clicks per second. Real clicks: they take click power, crit, add context. */
  | { readonly t: 'autoClick'; readonly v: number }
  /** Halt all tool production while active. */
  | { readonly t: 'idleHalt' }
  /** Halt one tool while active. */
  | { readonly t: 'toolHalt'; readonly id: ToolId }
  /** Halt every `network` tool while active. */
  | { readonly t: 'networkHalt' }
  /** Added to click crit chance. Clamped to BALANCE.CRIT_CHANCE_CAP. */
  | { readonly t: 'critChance'; readonly v: number }
  /** Added to the click crit payout multiplier. */
  | { readonly t: 'critMult'; readonly v: number }
  /** Added to the per-roll chance a tool one-shots it. Clamped. */
  | { readonly t: 'oneShotChance'; readonly v: number }
  /** Added to the one-shot payout, in seconds of tool output. */
  | { readonly t: 'oneShotPayout'; readonly v: number }
  // --- context ------------------------------------------------------------
  /** Multiply the context window. */
  | { readonly t: 'contextMaxMult'; readonly v: number }
  /** Multiply context added per click. */
  | { readonly t: 'clickContextMult'; readonly v: number }
  /** Multiply every tool's footprint. */
  | { readonly t: 'footprintMult'; readonly v: number }
  /** Multiply one tool's footprint. */
  | { readonly t: 'toolFootprintMult'; readonly id: ToolId; readonly v: number }
  /** Multiply the permanent context floor (MCP manuals). */
  | { readonly t: 'floorMult'; readonly v: number }
  /** Add summary slots (cards that survive compaction). */
  | { readonly t: 'summarySlots'; readonly v: number }
  /** Add to the fraction of the wallet kept through a compaction (forced and manual). */
  | { readonly t: 'compactKeep'; readonly v: number }
  /** Multiply the patience lost to a forced compaction. */
  | { readonly t: 'compactPenaltyMult'; readonly v: number }
  // --- the human ----------------------------------------------------------
  /** Multiply how much patience "You're absolutely right!" restores. */
  | { readonly t: 'sycophancyMult'; readonly v: number }
  /** Added to the verify chance on a claim. Negative is good for you. */
  | { readonly t: 'verifyChance'; readonly v: number }
  /** Added to the wallet fraction at which Claim Done unlocks. Negative lowers it. */
  | { readonly t: 'claimThreshold'; readonly v: number }
  /** Multiply the patience lost when caught. */
  | { readonly t: 'caughtPenaltyMult'; readonly v: number }
  /** Multiply the weight of permission incidents. */
  | { readonly t: 'permissionMult'; readonly v: number };

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface ActiveIncident {
  readonly id: IncidentId;
  /** Milliseconds remaining; Infinity for click-cleared incidents with no timer. */
  remainingMs: number;
  /** Clicks still required to clear (only for clearWithClicks incidents). */
  clicksRemaining: number;
  /** Run-elapsed ms when it started. */
  readonly startedAtMs: number;
  /** The tool it stalls, for permission incidents: resolved when it fires. */
  readonly tool?: ToolId;
}

/** A collectible drifting across the stage. */
export interface ActivePickup {
  readonly id: string;
  /** Scene-space position (320x180). Recomputed every tick by the sim. */
  x: number;
  y: number;
  /** Horizontal drift, scene units per second. */
  readonly vx: number;
  /** Centre of the vertical bob. */
  readonly baseY: number;
  ageS: number;
  remainingMs: number;
}

export type RunPhase =
  | 'running'
  /** The summary picker is open: choose which cards survive. Sim paused. */
  | 'compacting'
  | 'drafting'
  /** Brief celebration beat between a report and the draft. */
  | 'reported'
  | 'won'
  | 'lost';

/** Offered while phase === 'compacting'. */
export interface SummaryChoice {
  /** Every card held when compaction hit. */
  readonly offered: readonly CardId[];
  /** How many may be kept. */
  readonly slots: number;
  readonly forced: boolean;
}

export interface RunState {
  /** Wallet balance. This IS the report bar. */
  tokens: number;
  /** 0-based index into PROMPTS. */
  promptIndex: number;
  /** Milliseconds of patience left on the current prompt. */
  patienceMs: number;
  /** Context currently used, in tokens. */
  context: number;
  /** ms left on a manual /compact pause; generation is halted while > 0. */
  compactingMs: number;
  /** Set while phase === 'compacting'. */
  summary: SummaryChoice | null;
  elapsedMs: number;
  /** Units owned per tool. */
  tools: Record<ToolId, number>;
  owned: UpgradeId[];
  cards: CardId[];
  incidents: ActiveIncident[];
  phase: RunPhase;
  /** Cards currently offered; empty unless phase === 'drafting'. */
  draftOffer: CardId[];
  draftRerollsLeft: number;
  nextIncidentInMs: number;
  pickup: ActivePickup | null;
  nextPickupInMs: number;
  clicks: number;
  tokensEarned: number;
  tokensSpent: number;
  /** Prompts completed this run, honestly or not. */
  reported: number;
  /** Prompts completed by a claim that passed. */
  claimed: number;
  /** Claims the human verified and rejected. */
  caught: number;
  /** +1 per passed claim. Raises incident rate. */
  techDebt: number;
  /** Compactions this run, and how many were forced. */
  compactions: number;
  forcedCompactions: number;
  /** "You're absolutely right!" presses this run. */
  sycophancy: number;
  /** Decaying heat that halves each successive press. */
  sycophancyHeat: number;
  /** Running 👍 tally, shown live but only banked at run end. */
  pendingThumbs: number;
  /** Deterministic RNG cursor. */
  rngState: number;
  readonly seed: number;
}

/** What the sequel learned from a Tokenmaxxing 1 save on the same origin. */
export interface LegacyImport {
  /** How game 1's own audit judged that save. */
  readonly verdict: SaveVerdict;
  readonly runs: number;
  readonly wins: number;
  /** 👍 granted by the one-time welcome gift. */
  readonly gift: number;
}

export interface MetaState {
  /** Unspent 👍. */
  thumbs: number;
  levels: Record<MetaUpgradeId, number>;
  /** Highest prompt index ever completed (for stats). */
  bestPrompt: number;
  runs: number;
  wins: number;
  totalThumbsEarned: number;
  /** Schema version for save migrations. */
  version: number;
  /** id -> the run number it was earned on (clock-free). */
  achievements: Record<AchievementId, number>;
  /** Lifetime counters that achievements need across runs. */
  stats: Record<string, number>;
  /** Set once the game-1 save has been looked for; null = not looked yet. */
  legacy: LegacyImport | { readonly verdict: 'none' } | null;
  settings: Settings;
}

/**
 * How a save looked when it was loaded. `legacy` is an unsigned save, which is
 * never treated as tampering.
 */
export type SaveVerdict = 'clean' | 'legacy' | 'edited' | 'forged';

export interface AchievementDef {
  readonly id: AchievementId;
  readonly name: string;
  readonly blurb: string;
  /** Hidden achievements render as `???` until earned. */
  readonly hidden: boolean;
  /** Icon id on the shared sheet. */
  readonly icon: string;
}

export interface Settings {
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  reducedMotion: boolean;
  screenShake: boolean;
  showFps: boolean;
}

// ---------------------------------------------------------------------------
// Derived, per-frame computed values. Renderer + UI read only this.
// ---------------------------------------------------------------------------

export type ReportState = 'report' | 'claim' | 'working' | 'blocked';

export interface DerivedStats {
  /** Tokens per click, all modifiers applied. */
  clickPower: number;
  /** Tokens per second from tools, all modifiers applied, incidents included. */
  idleRate: number;
  autoClickHz: number;
  /** Per-tool contribution to idleRate (post-modifier, 0 while halted). */
  toolRates: Record<ToolId, number>;
  /** True for each tool currently halted by an incident or outage. */
  toolHalted: Record<ToolId, boolean>;
  /** Cost of buying one more of each tool. */
  nextCosts: Record<ToolId, number>;
  /** Units of each tool still purchasable before its cap. */
  headroom: Record<ToolId, number>;
  /** Requirement of the current prompt. */
  requirement: number;
  /** tokens / requirement, clamped to [0, 1]. */
  reportProgress: number;
  /** What the report button does right now. */
  reportState: ReportState;
  /** Name of the outage blocking reports, or null. */
  reportBlockedBy: string | null;
  /** Wallet fraction of the requirement at which Claim Done unlocks. */
  claimThreshold: number;
  /** Chance a claim is verified (and rejected) right now, clamped. */
  verifyChance: number;
  /** patienceMs / max patience for this prompt, clamped to [0, 1]. */
  patienceProgress: number;
  /** Max patience for this prompt, after modifiers. */
  patienceMaxMs: number;
  patienceFrozen: boolean;
  /** Patience a press of "You're absolutely right!" restores now, as a fraction of max. */
  sycophancyPower: number;
  /** Current context window size, in tokens. */
  contextMax: number;
  /** Permanent context floor (MCP manuals), in tokens. */
  contextFloor: number;
  /** context / contextMax, clamped to [0, 1]. */
  contextFill: number;
  /** Context added per second at the current tool footprint (clicks excluded). */
  contextRate: number;
  /** Context added per click. */
  clickContext: number;
  /** Seconds until a forced compaction at the current contextRate; Infinity if never. */
  secondsToCompaction: number;
  /** Cards that survive a compaction. */
  summarySlots: number;
  /** Wallet fraction kept by a forced / manual compaction. */
  compactKeepForced: number;
  compactKeepManual: number;
  /** True once `/compact` is unlocked and usable right now. */
  canCompact: boolean;
  /** Seconds of tool output needed to reach the requirement; Infinity if unreachable. */
  etaSeconds: number;
  /** 👍 this run would bank if it ended right now. */
  thumbsIfEndedNow: number;
  incidentRateMult: number;
  critChance: number;
  critMult: number;
  oneShotChance: number;
  oneShotPayoutS: number;
  /** The human's room behind the glass for the current prompt. */
  scene: SceneKey;
  /** Version string of the model playing this run ("2.5 (new)"). */
  modelVersion: string;
  multipliers: { click: number; idle: number; all: number };
}

// ---------------------------------------------------------------------------
// Events: sim emits, audio/render/ui consume. Never mutate state from handlers.
// ---------------------------------------------------------------------------

export type GameEvent =
  | {
      readonly t: 'click';
      readonly amount: number;
      readonly x: number;
      readonly y: number;
      readonly crit: boolean;
      /** True when automation fired it rather than a human. */
      readonly auto: boolean;
    }
  | { readonly t: 'oneShot'; readonly amount: number; readonly seconds: number }
  | { readonly t: 'buyTool'; readonly id: ToolId; readonly cost: number; readonly owned: number }
  | { readonly t: 'buyUpgrade'; readonly id: UpgradeId; readonly cost: number }
  /** Honest completion. */
  | { readonly t: 'report'; readonly promptIndex: number; readonly thumbs: number; readonly patienceLeft: number }
  /** A claim resolved. `caught` false means it passed and the prompt is done. */
  | { readonly t: 'claim'; readonly promptIndex: number; readonly caught: boolean; readonly verifyChance: number; readonly spent: number }
  | { readonly t: 'compactStart'; readonly forced: boolean; readonly kept: number; readonly lost: number }
  | { readonly t: 'compactEnd'; readonly keptCards: readonly CardId[]; readonly droppedCards: readonly CardId[] }
  | { readonly t: 'sycophancy'; readonly restored: number; readonly heat: number }
  | { readonly t: 'draftOpen'; readonly offer: readonly CardId[] }
  | { readonly t: 'draftPick'; readonly id: CardId }
  | { readonly t: 'draftReroll' }
  | { readonly t: 'incidentStart'; readonly id: IncidentId; readonly tone: 'bad' | 'good'; readonly tool?: ToolId }
  | { readonly t: 'incidentEnd'; readonly id: IncidentId }
  | { readonly t: 'incidentProgress'; readonly id: IncidentId; readonly clicksRemaining: number }
  | { readonly t: 'pickupSpawn'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly t: 'pickupCollect'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly t: 'pickupExpire'; readonly id: string }
  | { readonly t: 'patienceWarn'; readonly secondsLeft: number }
  /** Fired once each as context crosses 80% and 95%. */
  | { readonly t: 'contextWarn'; readonly fill: number }
  | { readonly t: 'runOver'; readonly won: boolean; readonly thumbs: number; readonly reported: number }
  | { readonly t: 'metaBuy'; readonly id: MetaUpgradeId; readonly level: number; readonly cost: number }
  | { readonly t: 'runStart'; readonly seed: number }
  | { readonly t: 'achievement'; readonly id: AchievementId }
  /** The one-time game-1 import happened. */
  | { readonly t: 'legacyImport'; readonly verdict: SaveVerdict; readonly gift: number }
  /** `cost` is tokens, `thumbs` is the meta currency. */
  | { readonly t: 'denied'; readonly reason: 'cost' | 'thumbs' | 'locked' | 'phase' };

export type EventSink = (e: GameEvent) => void;

// ---------------------------------------------------------------------------
// Public sim surface
// ---------------------------------------------------------------------------

export interface SimApi {
  readonly run: RunState;
  readonly meta: MetaState;
  /** Recomputed on demand; cheap enough to call once per frame. */
  derived(): DerivedStats;
  /** Advance the simulation. dtMs is clamped internally against tab-throttling. */
  tick(dtMs: number): void;
  /** Register a click at scene coordinates (320x180 space). Returns tokens gained. */
  click(x: number, y: number): number;
  /** Try to collect the pickup at these scene coordinates. */
  collectPickup(x: number, y: number): boolean;
  buyTool(id: ToolId, count?: number): boolean;
  buyUpgrade(id: UpgradeId): boolean;
  /** Honest report. Only succeeds when reportState === 'report'. */
  report(): boolean;
  /** Claim done. Only when reportState === 'claim'. Null when refused. */
  claim(): 'passed' | 'caught' | null;
  /** Manual /compact. Needs the `compact` feature. */
  compact(): boolean;
  /** Resolve the summary picker: the cards to keep (<= slots). */
  keepCards(ids: readonly CardId[]): boolean;
  /** "You're absolutely right!" */
  absolutelyRight(): boolean;
  pickCard(id: CardId): boolean;
  rerollDraft(): boolean;
  /** Purchase a Training node between runs. */
  buyMeta(id: MetaUpgradeId): boolean;
  /** Abandon the current run and bank its 👍. */
  endRun(won: boolean): void;
  /** Begin a fresh run using the current meta state. */
  startRun(seed?: number): void;
  /** Upgrades currently visible in the shop (requirements met, not owned). */
  availableUpgrades(): readonly UpgradeDef[];
  /** Tools currently visible in the shop. */
  visibleTools(): readonly ToolDef[];
  subscribe(sink: EventSink): () => void;
}

// ---------------------------------------------------------------------------
// Render contract
// ---------------------------------------------------------------------------

export const SCENE_WIDTH = 320;
export const SCENE_HEIGHT = 180;

export interface RenderInput {
  readonly run: RunState;
  readonly derived: DerivedStats;
  readonly settings: Settings;
  /** Seconds since the previous frame. */
  readonly dt: number;
  /** Monotonic seconds since renderer start. */
  readonly time: number;
}

export interface Renderer {
  draw(input: RenderInput): void;
  /** Feed a game event so the renderer can spawn particles / shake / popups. */
  handle(e: GameEvent): void;
  /** Convert a DOM pointer event to 320x180 scene coordinates. */
  toScene(clientX: number, clientY: number): { x: number; y: number };
  /** True when the point is inside the agent's hit box (the click target). */
  hitsAgent(x: number, y: number): boolean;
  resize(): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Audio contract
// ---------------------------------------------------------------------------

export interface AudioEngine {
  /** Must be called from a user gesture before any sound plays. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  handle(e: GameEvent): void;
  /** Cross-fade the music layer to match the human's room. */
  setScene(scene: SceneKey): void;
  /** Ramp musical intensity 0..1 as patience runs out or context fills. */
  setTension(t: number): void;
  setVolumes(v: { music: number; sfx: number }): void;
  play(sfx: SfxName): void;
  destroy(): void;
}

export type SfxName =
  | 'click'
  | 'clickCrit'
  | 'oneShot'
  | 'buy'
  | 'denied'
  | 'report'
  | 'claim'
  | 'caught'
  | 'compact'
  | 'compactForced'
  | 'sycophancy'
  | 'draftOpen'
  | 'draftPick'
  | 'reroll'
  | 'incidentBad'
  | 'incidentGood'
  | 'incidentClear'
  | 'interrupt'
  | 'permission'
  | 'warn'
  | 'contextWarn'
  | 'lose'
  | 'win'
  | 'uiHover'
  | 'metaBuy'
  | 'achievement';
