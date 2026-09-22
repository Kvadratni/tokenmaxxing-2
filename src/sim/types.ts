/**
 * FROZEN CONTRACT — Tokenmaxxing shared types.
 *
 * Every module (sim / render / audio / ui / tests) codes against this file.
 * Additive changes only: add new fields/members, never rename or remove.
 * If you believe a breaking change is required, stop and report it instead.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export type AgentTierId =
  | 'tab_autocomplete'
  | 'copy_paste_chatbot'
  | 'agentic_ide'
  | 'cli_agent'
  | 'subagent_swarm'
  | 'ralph_loop'
  | 'multi_harness'
  | 'background_fleet'
  | 'finetune_farm'
  | 'agi';

export type UpgradeId = string;
export type AchievementId = string;
export type CardId = string;
export type IncidentId = string;
export type MetaUpgradeId = string;

// ---------------------------------------------------------------------------
// Content definitions (static data — see src/sim/content.ts)
// ---------------------------------------------------------------------------

export interface AgentTierDef {
  readonly id: AgentTierId;
  /** 1-based ladder position. */
  readonly tier: number;
  readonly name: string;
  readonly blurb: string;
  /** Cost of the first unit, before cost-scaling and modifiers. */
  readonly baseCost: number;
  /** Slop per second produced by one unit, before modifiers. */
  readonly baseRate: number;
  /** Cost multiplier per unit already owned. Standard idle curve. */
  readonly costGrowth: number;
  /** Tier is hidden until the player owns >= this many of the previous tier. */
  readonly revealAfterPrevOwned: number;
  /**
   * Hard ceiling on units of this tier. Stops the game degenerating into
   * spamming tier 1 forever and forces the player up the ladder.
   */
  readonly maxOwned: number;
  /** Desk-clutter sprite key rendered when >=1 owned. */
  readonly clutterSprite: string;
}

export type UpgradeKind = 'click' | 'agent' | 'global' | 'risk' | 'location';

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
  /**
   * Only on `kind: 'location'`. Buying it moves the whole game to this
   * backdrop — the room the player works in is something they buy, not
   * something the project number hands them.
   */
  readonly scene?: SceneKey;
}

export interface UpgradeRequirement {
  readonly minProject?: number;
  readonly agent?: { readonly id: AgentTierId; readonly owned: number };
  readonly upgrade?: UpgradeId;
}

export interface CardDef {
  readonly id: CardId;
  readonly name: string;
  readonly blurb: string;
  readonly rarity: 'common' | 'uncommon' | 'rare';
  readonly effects: readonly Effect[];
  /** Cards with the same exclusiveGroup can never both appear in one run. */
  readonly exclusiveGroup?: string;
  /** Earliest project index (0-based) at which this card may be offered. */
  readonly minProjectIndex?: number;
}

export interface IncidentDef {
  readonly id: IncidentId;
  readonly name: string;
  readonly flavor: string;
  readonly tone: 'bad' | 'good';
  /** Relative selection weight within its tone bucket. */
  readonly weight: number;
  readonly durationMs: number;
  readonly effects: readonly Effect[];
  /** If set, the incident clears early once the player accrues this many clicks. */
  readonly clearWithClicks?: number;
  /**
   * An outage: shipping is impossible while it is active, and the deadline
   * keeps running. The nastiest thing the game can do to you.
   */
  readonly blocksShip?: boolean;
  /** Earliest project index (0-based) at which this incident may fire. */
  readonly minProjectIndex?: number;
}

export interface ProjectDef {
  readonly index: number; // 0-based
  readonly name: string;
  /** Slop required to ship. */
  readonly requirement: number;
  /** Deadline in milliseconds. */
  readonly deadlineMs: number;
  /** Backdrop scene key — see SCENES. */
  readonly scene: SceneKey;
}

export type SceneKey = 'bedroom' | 'coworking' | 'openplan' | 'datacenter' | 'orbital';

/** What a one-time meta unlock adds to the game. */
export type MetaGrant =
  /**
   * Makes an agent tier purchasable at all. `withUpgrades` rides along so a
   * tier and the upgrade that boosts it arrive together — unlocking Fine-tune
   * Farm without NVLink would just be a trap.
   */
  | {
      readonly t: 'agentTier';
      readonly id: AgentTierId;
      readonly withUpgrades?: readonly UpgradeId[];
    }
  /**
   * Adds upgrades to the in-run shop pool. `withCards` rides along for the
   * cards that only make sense once the matching upgrade exists.
   */
  | {
      readonly t: 'upgrades';
      readonly ids: readonly UpgradeId[];
      readonly withCards?: readonly CardId[];
    }
  /** Adds cards to the draft pool. */
  | { readonly t: 'cards'; readonly ids: readonly CardId[] }
  /** Switches on a standalone feature. */
  | { readonly t: 'feature'; readonly id: 'endless' | 'pickupRate' | 'rarePickups' };

/** Which trunk of the meta tree a node hangs off. */
export type MetaBranch = 'root' | 'headcount' | 'automation' | 'capital' | 'process' | 'risk';

export interface MetaUpgradeDef {
  readonly id: MetaUpgradeId;
  readonly name: string;
  readonly blurb: string;
  readonly maxLevel: number;
  /** Demo cost for each level, index 0 == level 1. */
  readonly costs: readonly number[];
  /** Human-readable effect summary given a level. */
  readonly describe: (level: number) => string;

  // --- tree placement ----------------------------------------------------
  /**
   * `unlock` adds content and is bought once. `upgrade` is the levelled
   * +% ladder. Both live in the same tree; only the node art differs.
   */
  readonly kind: 'unlock' | 'upgrade';
  readonly branch: MetaBranch;
  /** Grid position in tree space. Hand-authored — auto-layout reads worse. */
  readonly pos: { readonly x: number; readonly y: number };
  /** Nodes that must be owned before this one can be bought. */
  readonly requires: readonly MetaUpgradeId[];
  /** Content this node adds. Only meaningful for `kind: 'unlock'`. */
  readonly grants?: MetaGrant;
}

// ---------------------------------------------------------------------------
// Effects — the single vocabulary for every modifier in the game
// ---------------------------------------------------------------------------

export type Effect =
  /** Multiply slop gained per click. */
  | { readonly t: 'clickMult'; readonly v: number }
  /** Add flat slop per click (applied before clickMult). */
  | { readonly t: 'clickAdd'; readonly v: number }
  /** Multiply total idle production. */
  | { readonly t: 'idleMult'; readonly v: number }
  /** Multiply production of one agent tier. */
  | { readonly t: 'tierMult'; readonly id: AgentTierId; readonly v: number }
  /** Multiply every source of slop (click + idle). */
  | { readonly t: 'allMult'; readonly v: number }
  /** Multiply agent purchase cost (0.9 == 10% cheaper). */
  | { readonly t: 'agentCostMult'; readonly v: number }
  /** Multiply incident frequency (1.5 == 50% more incidents). */
  | { readonly t: 'incidentRateMult'; readonly v: number }
  /** Multiply project deadline length. */
  | { readonly t: 'deadlineMult'; readonly v: number }
  /** Add clickMult equal to v * (total agents owned). */
  | { readonly t: 'clickPerAgent'; readonly v: number }
  /**
   * Automatic clicks per second. These are *real* clicks — they take click
   * power, can crit, and count down click-clearable incidents — so an idle
   * build genuinely plays itself instead of being a separate income channel.
   */
  | { readonly t: 'autoClick'; readonly v: number }
  /** Halt idle production entirely while active. */
  | { readonly t: 'idleHalt' }
  /** Multiply Demos earned at run end. */
  | { readonly t: 'demoMult'; readonly v: number }
  /** Slop granted at run start. */
  | { readonly t: 'startingSlop'; readonly v: number }
  /** Free agents of a tier at run start. */
  | { readonly t: 'startingAgent'; readonly id: AgentTierId; readonly n: number }
  /** Number of cards offered per draft. */
  | { readonly t: 'draftSize'; readonly v: number }
  /** Rerolls available per draft. */
  | { readonly t: 'draftRerolls'; readonly v: number }
  /**
   * Added to the chance a click crits. Additive, not multiplicative, so five
   * sources of "+5% crit" read as +25% rather than compounding into certainty.
   * The total is clamped to `BALANCE.CRIT_CHANCE_CAP`.
   */
  | { readonly t: 'critChance'; readonly v: number }
  /** Added to the crit payout multiplier. */
  | { readonly t: 'critMult'; readonly v: number }
  /**
   * Added to the chance an agent one-shots the task on a given roll — the idle
   * counterpart to a click crit. Zero until something unlocks it. Clamped to
   * `BALANCE.ONE_SHOT_CHANCE_CAP`.
   */
  | { readonly t: 'oneShotChance'; readonly v: number }
  /** Added to the one-shot payout, measured in seconds of idle output. */
  | { readonly t: 'oneShotPayout'; readonly v: number };

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface ActiveIncident {
  readonly id: IncidentId;
  /** Milliseconds remaining; Infinity for click-cleared incidents with no timer. */
  remainingMs: number;
  /** Clicks still required to clear (only for clearWithClicks incidents). */
  clicksRemaining: number;
  /** Wall-clock ms when it started, relative to run elapsed. */
  readonly startedAtMs: number;
}

/**
 * A collectible drifting across the scene. Click it before it leaves and it
 * grants a short, loud buff. Which one shows up depends on the room you bought,
 * so upgrading your location changes what falls out of the ceiling.
 */
export interface ActivePickup {
  readonly id: string;
  /** Scene-space position (320x180). Recomputed every tick by the sim. */
  x: number;
  y: number;
  /** Horizontal drift, scene units per second. Sign is the travel direction. */
  readonly vx: number;
  /** Centre of the vertical bob. */
  readonly baseY: number;
  /** Seconds since it spawned — drives the bob and the renderer's animation. */
  ageS: number;
  /** ms before it drifts off screen for good. */
  remainingMs: number;
}

export type RunPhase =
  | 'running'
  | 'drafting'
  | 'shipped' // brief celebration beat between projects
  | 'won'
  | 'lost';

export interface RunState {
  /** Wallet balance. This IS the ship bar. */
  slop: number;
  /** 0-based index into PROJECTS. */
  projectIndex: number;
  /** Milliseconds left on the current deadline. */
  timeLeftMs: number;
  /** Total ms elapsed this run. */
  elapsedMs: number;
  /** Units owned per agent tier. */
  agents: Record<AgentTierId, number>;
  owned: UpgradeId[];
  cards: CardId[];
  incidents: ActiveIncident[];
  phase: RunPhase;
  /** Cards currently offered; empty unless phase === 'drafting'. */
  draftOffer: CardId[];
  draftRerollsLeft: number;
  /** ms until the next incident roll. */
  nextIncidentInMs: number;
  /** The collectible currently on screen, if any. */
  pickup: ActivePickup | null;
  /** ms until the next collectible drifts in. */
  nextPickupInMs: number;
  clicks: number;
  slopEarned: number;
  slopSpent: number;
  /** Projects successfully shipped this run. */
  shipped: number;
  /** Running Demos tally, shown live but only banked at run end. */
  pendingDemos: number;
  /** Deterministic RNG cursor. */
  rngState: number;
  readonly seed: number;
}

export interface MetaState {
  demos: number;
  levels: Record<MetaUpgradeId, number>;
  /** Highest project index ever shipped (for unlock gating / stats). */
  bestProject: number;
  runs: number;
  wins: number;
  totalDemosEarned: number;
  /** Schema version for save migrations. */
  version: number;
  /**
   * id -> the run number it was earned on. A run number rather than a
   * timestamp because the sim has no wall clock and must stay deterministic.
   */
  achievements: Record<AchievementId, number>;
  settings: Settings;
}

/**
 * How a save looked when it was loaded. `clean` covers the ordinary case *and*
 * a legacy save with no signature at all — an unsigned save predates signing
 * and must never be treated as tampering, or every existing player gets
 * accused on their next load.
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

export interface DerivedStats {
  /** Slop per click, all modifiers applied. */
  clickPower: number;
  /** Slop per second from agents, all modifiers applied, incidents included. */
  idleRate: number;
  /** Automatic clicks per second. 0 means the player is clicking by hand. */
  autoClickHz: number;
  /** Per-tier contribution to idleRate (post-modifier). */
  tierRates: Record<AgentTierId, number>;
  /** Cost of buying one more of each tier. */
  nextCosts: Record<AgentTierId, number>;
  /** Requirement of the current project. */
  requirement: number;
  /** slop / requirement, clamped to [0, 1]. */
  shipProgress: number;
  /** timeLeftMs / deadlineMs, clamped to [0, 1]. */
  deadlineProgress: number;
  /** True when slop >= requirement AND no outage is blocking the deploy. */
  canShip: boolean;
  /** Name of the outage blocking shipping, or null. */
  shipBlockedBy: string | null;
  /** Units of each tier still purchasable before hitting its cap. */
  headroom: Record<AgentTierId, number>;
  /** Seconds of idle production needed to reach the requirement; Infinity if unreachable. */
  etaSeconds: number;
  /** Demos this run would bank if it ended right now. */
  demosIfEndedNow: number;
  incidentRateMult: number;
  /** Chance a click crits, clamped. */
  critChance: number;
  /** Payout multiplier on a critting click. */
  critMult: number;
  /** Chance an agent one-shots it, per roll. 0 means the mechanic is locked. */
  oneShotChance: number;
  /** Seconds of idle output granted by a one-shot. */
  oneShotPayoutS: number;
  /** Aggregate multipliers, for the stats readout. */
  multipliers: { click: number; idle: number; all: number };
}

// ---------------------------------------------------------------------------
// Events — sim emits, audio/render/ui consume. Never mutate state from handlers.
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
  /**
   * An agent nailed it first try: a burst worth `seconds` of idle output. The
   * idle-side counterpart to a critting click, so it gets its own event rather
   * than being folded silently into the tick.
   */
  | { readonly t: 'oneShot'; readonly amount: number; readonly seconds: number }
  | { readonly t: 'buyAgent'; readonly id: AgentTierId; readonly cost: number; readonly owned: number }
  | { readonly t: 'buyUpgrade'; readonly id: UpgradeId; readonly cost: number }
  | { readonly t: 'ship'; readonly projectIndex: number; readonly demos: number; readonly timeLeftMs: number }
  | { readonly t: 'draftOpen'; readonly offer: readonly CardId[] }
  | { readonly t: 'draftPick'; readonly id: CardId }
  | { readonly t: 'draftReroll' }
  | { readonly t: 'incidentStart'; readonly id: IncidentId; readonly tone: 'bad' | 'good' }
  | { readonly t: 'incidentEnd'; readonly id: IncidentId }
  | { readonly t: 'incidentProgress'; readonly id: IncidentId; readonly clicksRemaining: number }
  | { readonly t: 'pickupSpawn'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly t: 'pickupCollect'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly t: 'pickupExpire'; readonly id: string }
  | { readonly t: 'deadlineWarn'; readonly secondsLeft: number }
  | { readonly t: 'runOver'; readonly won: boolean; readonly demos: number; readonly shipped: number }
  | { readonly t: 'metaBuy'; readonly id: MetaUpgradeId; readonly level: number; readonly cost: number }
  | { readonly t: 'runStart'; readonly seed: number }
  | { readonly t: 'achievement'; readonly id: AchievementId }
  /**
   * `cost` is slop, `demos` is the meta currency. They are separate reasons
   * because a shared one made the Demos shop report "not enough slop".
   */
  | { readonly t: 'denied'; readonly reason: 'cost' | 'demos' | 'locked' | 'phase' };

export type EventSink = (e: GameEvent) => void;

// ---------------------------------------------------------------------------
// Public sim surface. Everything the app needs, nothing it doesn't.
// ---------------------------------------------------------------------------

export interface SimApi {
  readonly run: RunState;
  readonly meta: MetaState;
  /** Recomputed on demand; cheap enough to call once per frame. */
  derived(): DerivedStats;
  /** Advance the simulation. dtMs is clamped internally against tab-throttling. */
  tick(dtMs: number): void;
  /** Register a click at scene coordinates (320x180 space). */
  click(x: number, y: number): number;
  /**
   * Try to collect the on-screen pickup at these scene coordinates. Returns
   * true when one was taken, so the host can skip the laptop click.
   */
  collectPickup(x: number, y: number): boolean;
  buyAgent(id: AgentTierId, count?: number): boolean;
  buyUpgrade(id: UpgradeId): boolean;
  ship(): boolean;
  pickCard(id: CardId): boolean;
  rerollDraft(): boolean;
  /** Purchase a meta upgrade between runs. */
  buyMeta(id: MetaUpgradeId): boolean;
  /** Abandon the current run and bank its Demos. */
  endRun(won: boolean): void;
  /** Begin a fresh run using the current meta state. */
  startRun(seed?: number): void;
  /** Upgrades currently visible in the shop (requirements met, not owned). */
  availableUpgrades(): readonly UpgradeDef[];
  /** Agent tiers currently visible in the shop. */
  visibleTiers(): readonly AgentTierDef[];
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
  /** Draw one frame. */
  draw(input: RenderInput): void;
  /** Feed a game event so the renderer can spawn particles / shake / popups. */
  handle(e: GameEvent): void;
  /** Convert a DOM pointer event to 320x180 scene coordinates. */
  toScene(clientX: number, clientY: number): { x: number; y: number };
  /** True when the point is inside the laptop hit box. */
  hitsLaptop(x: number, y: number): boolean;
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
  /** Cross-fade the music layer to match the current scene. */
  setScene(scene: SceneKey): void;
  /** Ramp musical intensity 0..1 as the deadline burns down. */
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
  | 'ship'
  | 'draftOpen'
  | 'draftPick'
  | 'reroll'
  | 'incidentBad'
  | 'incidentGood'
  | 'incidentClear'
  | 'warn'
  | 'lose'
  | 'win'
  | 'uiHover'
  | 'metaBuy'
  | 'achievement';
