/**
 * Test double for the sim, plus DOM helpers shared by the ui.*.test.ts files.
 *
 * Deliberately does NOT import the real sim: the UI must be provable against
 * the contract in `src/sim/types.ts` (and the read-only `UISimView` in
 * `src/ui/types.ts`) alone. Static content from `src/sim/content.ts` is fair
 * game; every module reads it.
 *
 * The UI never mutates the sim, it emits `UIAction`s. `mountUI` records them
 * in `actions`, which is what most tests assert on.
 */
import { vi } from 'vitest';
import {
  BALANCE,
  META_BY_ID,
  promptAt,
  STARTING_CARDS,
  STARTING_TOOLS,
  STARTING_UPGRADES,
  TOOL_BY_ID,
  TOOL_IDS,
  TOOLS,
  UPGRADE_BY_ID,
} from '../../src/sim/content.ts';
import type {
  ActiveIncident,
  DerivedStats,
  MetaFeature,
  MetaState,
  RunState,
  Settings,
  ToolDef,
  ToolId,
  UpgradeDef,
} from '../../src/sim/types.ts';
import { createUI } from '../../src/ui/index.ts';
import { TOUR_KEY } from '../../src/ui/tour-steps.ts';
import type { UI, UIAction, UIScreen, UISimView, UIUnlocked } from '../../src/ui/types.ts';

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    musicVolume: 0.6,
    sfxVolume: 0.8,
    reducedMotion: false,
    screenShake: true,
    showFps: false,
    ...over,
  };
}

function zeroTools(): Record<ToolId, number> {
  const out = {} as Record<ToolId, number>;
  for (const id of TOOL_IDS) out[id] = 0;
  return out;
}

export function makeRun(over: Partial<RunState> = {}): RunState {
  return {
    tokens: 0,
    promptIndex: 0,
    patienceMs: promptAt(over.promptIndex ?? 0).patienceMs,
    context: 0,
    compactingMs: 0,
    summary: null,
    elapsedMs: 0,
    tools: { ...zeroTools(), ...(over.tools ?? {}) },
    owned: [],
    cards: [],
    incidents: [],
    phase: 'running',
    draftOffer: [],
    draftRerollsLeft: 0,
    nextIncidentInMs: 12_000,
    pickup: null,
    nextPickupInMs: 999_000,
    clicks: 0,
    tokensEarned: 0,
    tokensSpent: 0,
    reported: 0,
    claimed: 0,
    caught: 0,
    techDebt: 0,
    compactions: 0,
    forcedCompactions: 0,
    sycophancy: 0,
    sycophancyHeat: 0,
    pendingThumbs: 0,
    rngState: 1,
    seed: 1234,
    ...over,
  } as RunState;
}

export function makeMeta(over: Partial<MetaState> = {}): MetaState {
  return {
    thumbs: 0,
    levels: {},
    bestPrompt: -1,
    runs: 0,
    wins: 0,
    totalThumbsEarned: 0,
    version: 1,
    achievements: {},
    stats: {},
    legacy: null,
    settings: makeSettings(),
    ...over,
  };
}

export function makeIncident(id: string, over: Partial<ActiveIncident> = {}): ActiveIncident {
  return {
    id,
    remainingMs: 10_000,
    clicksRemaining: 0,
    startedAtMs: 0,
    ...over,
  };
}

/** A plausible `DerivedStats` for `run`, with the base game's numbers. */
export function makeDerived(run: RunState, over: Partial<DerivedStats> = {}): DerivedStats {
  const prompt = promptAt(run.promptIndex);
  const requirement = prompt.requirement;
  const toolRates = {} as Record<ToolId, number>;
  const toolFootprint = {} as Record<ToolId, number>;
  const toolHalted = {} as Record<ToolId, boolean>;
  const nextCosts = {} as Record<ToolId, number>;
  const headroom = {} as Record<ToolId, number>;
  let idleRate = 0;
  let contextRate = 0;
  for (const t of TOOLS) {
    const owned = run.tools[t.id] ?? 0;
    const rate = owned * t.baseRate;
    toolRates[t.id] = rate;
    toolFootprint[t.id] = t.footprint;
    toolHalted[t.id] = false;
    idleRate += rate;
    contextRate += owned * t.footprint;
    nextCosts[t.id] = Math.round(t.baseCost * Math.pow(t.costGrowth, owned));
    headroom[t.id] = Math.max(0, t.maxOwned - owned);
  }
  const contextMax = over.contextMax ?? BALANCE.BASE_CONTEXT;
  const claimThreshold = over.claimThreshold ?? BALANCE.CLAIM_THRESHOLD;
  const progress = Math.max(0, Math.min(1, run.tokens / requirement));
  const missing = Math.max(0, requirement - run.tokens);
  return {
    clickPower: BALANCE.BASE_CLICK,
    idleRate,
    autoClickHz: 0,
    toolRates,
    toolFootprint,
    toolHalted,
    nextCosts,
    headroom,
    toolCostMult: 1,
    requirement,
    reportProgress: progress,
    reportState: run.tokens >= requirement ? 'report' : progress >= claimThreshold ? 'claim' : 'working',
    reportBlockedBy: null,
    claimThreshold,
    verifyChance: BALANCE.VERIFY_BASE,
    patienceProgress: Math.max(0, Math.min(1, run.patienceMs / prompt.patienceMs)),
    patienceMaxMs: prompt.patienceMs,
    patienceFrozen: false,
    sycophancyPower: BALANCE.SYCOPHANCY_BASE,
    contextMax,
    contextFloor: 0,
    contextFill: Math.max(0, Math.min(1, run.context / contextMax)),
    contextRate,
    clickContext: BALANCE.CTX_PER_CLICK,
    secondsToCompaction: contextRate > 0 ? (contextMax - run.context) / contextRate : Infinity,
    summarySlots: BALANCE.BASE_SUMMARY_SLOTS,
    compactKeepForced: BALANCE.COMPACT_KEEP_FORCED,
    compactKeepManual: BALANCE.COMPACT_KEEP_MANUAL,
    canCompact: false,
    etaSeconds: idleRate > 0 ? missing / idleRate : Infinity,
    thumbsIfEndedNow: run.pendingThumbs,
    incidentRateMult: 1,
    critChance: BALANCE.CRIT_CHANCE,
    critMult: BALANCE.CRIT_MULT,
    oneShotChance: 0,
    oneShotPayoutS: BALANCE.ONE_SHOT_BASE_PAYOUT_S,
    scene: prompt.scene,
    modelVersion: '2.0',
    multipliers: { click: 1, idle: 1, all: 1 },
    ...over,
  };
}

/** What a fresh save has unlocked, plus any extra features asked for. */
export function makeUnlocked(features: readonly MetaFeature[] = [], tools: readonly ToolId[] = STARTING_TOOLS): UIUnlocked {
  return {
    tools: new Set<ToolId>(tools),
    upgrades: new Set<string>(STARTING_UPGRADES),
    cards: new Set<string>(STARTING_CARDS),
    features: new Set<MetaFeature>(features),
  };
}

export interface FakeSimInit {
  run?: RunState;
  meta?: MetaState;
  visibleTools?: readonly ToolDef[];
  lockedTools?: readonly ToolDef[];
  upgrades?: readonly string[];
  unlocked?: UIUnlocked;
}

export function makeFakeSim(init: FakeSimInit = {}) {
  const run = init.run ?? makeRun();
  const meta = init.meta ?? makeMeta();
  let visible: readonly ToolDef[] = init.visibleTools ?? TOOLS.slice(0, 3);
  let locked: readonly ToolDef[] = init.lockedTools ?? TOOLS.slice(3, 6);
  let upgrades: readonly UpgradeDef[] = (init.upgrades ?? []).map((id) => UPGRADE_BY_ID[id]!).filter(Boolean);
  let unlocked: UIUnlocked = init.unlocked ?? makeUnlocked();
  let costOver: ((id: string) => number) | null = null;

  const sim = {
    run,
    meta,
    visibleTools: vi.fn((): readonly ToolDef[] => visible),
    lockedTools: vi.fn((): readonly ToolDef[] => locked),
    availableUpgrades: vi.fn((): readonly UpgradeDef[] => upgrades),
    unlocked: vi.fn((): UIUnlocked => unlocked),
    metaCost: vi.fn((id: string): number => {
      if (costOver) return costOver(id);
      const def = META_BY_ID[id];
      if (!def) return Infinity;
      const level = meta.levels[id] ?? 0;
      return level >= def.maxLevel ? Infinity : (def.costs[level] ?? Infinity);
    }),

    // --- test-only knobs ---
    setVisibleTools(ids: readonly ToolId[]): void {
      visible = ids.map((id) => TOOL_BY_ID[id]);
    },
    setLockedTools(ids: readonly ToolId[]): void {
      locked = ids.map((id) => TOOL_BY_ID[id]);
    },
    setUpgrades(ids: readonly string[]): void {
      upgrades = ids.map((id) => UPGRADE_BY_ID[id]!).filter(Boolean);
    },
    setUnlocked(u: UIUnlocked): void {
      unlocked = u;
    },
    setMetaCost(fn: (id: string) => number): void {
      costOver = fn;
    },
  };
  // Structural check: the double really is a `UISimView`.
  const view: UISimView = sim;
  void view;
  return sim;
}

export type FakeSim = ReturnType<typeof makeFakeSim>;

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

export interface Mounted {
  ui: UI;
  root: HTMLElement;
  sim: FakeSim;
  /** Every action the UI emitted, oldest first. */
  actions: UIAction[];
  /** Overrides applied to every `frame()`'s derived stats. */
  derived: Partial<DerivedStats>;
  /** Push the current run/meta (and `derived` overrides) through `update()`. */
  frame: () => void;
  /** Advance the injected clock. */
  tick: (ms: number) => void;
  /** Actions of one type, for terse assertions. */
  sent: <T extends UIAction['t']>(t: T) => Extract<UIAction, { t: T }>[];
  /** What the UI keeps in storage: the tour's "seen". */
  storage: MemoryStorage;
}

const live: Mounted[] = [];

export interface MountOpts extends FakeSimInit {
  screen?: UIScreen;
  derived?: Partial<DerivedStats>;
  /** Apply the sim-bound actions the way a host would. Off by default. */
  onAction?: (a: UIAction, m: Mounted) => void;
  /**
   * The first-run tour opens on NEW SESSION in a browser that has never seen
   * it. Every mount marks it seen, as the e2e harness does, so the other specs
   * start on a quiet board; ui.tour asks for `'fresh'`.
   */
  tour?: 'seen' | 'fresh';
  /** The UI's storage. Default: a fresh `memoryStorage`, seeded per `tour`. */
  storage?: MemoryStorage;
}

export type MemoryStorage = Pick<Storage, 'getItem' | 'setItem'> & { readonly data: Map<string, string> };

/**
 * A Web Storage stand-in for the UI's one flag. A fresh one per mount keeps
 * tests apart, and on Node 25 the global `localStorage` is Node's own (with no
 * backing file, and no `setItem`), not happy-dom's.
 */
export function memoryStorage(init: Readonly<Record<string, string>> = {}): MemoryStorage {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
  };
}

/** Storage for a browser that has seen the tour already, or (`false`) never has. */
export function tourStorage(seen: boolean): MemoryStorage {
  return memoryStorage(seen ? { [TOUR_KEY]: '1' } : {});
}

export function mountUI(o: MountOpts = {}): Mounted {
  const storage = o.storage ?? tourStorage(o.tour !== 'fresh');
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sim = makeFakeSim(o);
  const actions: UIAction[] = [];
  let clock = 1000;
  let m: Mounted | null = null;
  const ui = createUI({
    root,
    sim,
    screen: o.screen ?? 'run',
    now: () => clock,
    storage,
    onAction: (a) => {
      actions.push(a);
      if (m && o.onAction) o.onAction(a, m);
    },
  });
  m = {
    ui,
    root,
    sim,
    actions,
    storage,
    derived: { ...(o.derived ?? {}) },
    frame: () => ui.update(sim.run, makeDerived(sim.run, m!.derived), sim.meta),
    tick: (ms: number) => {
      clock += ms;
    },
    sent: <T extends UIAction['t']>(t: T) =>
      actions.filter((a): a is Extract<UIAction, { t: T }> => a.t === t),
  };
  m.frame();
  live.push(m);
  return m;
}

/** Tear down everything `mountUI` built. Call from `afterEach`. */
export function unmountAll(): void {
  for (const m of live) {
    m.ui.destroy();
    m.root.remove();
  }
  live.length = 0;
  document.body.replaceChildren();
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function q(root: ParentNode, testid: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

export function must(root: ParentNode, testid: string): HTMLElement {
  const node = q(root, testid);
  if (node === null) throw new Error(`missing [data-testid="${testid}"]`);
  return node;
}

export function all(root: ParentNode, testid: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`));
}

export function allPrefixed(root: ParentNode, prefix: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}-"]`));
}

/** Hidden by its own `hidden` attribute or any ancestor's. */
export function isHidden(node: HTMLElement | null): boolean {
  return node === null || node.closest('[hidden]') !== null;
}

export function text(root: ParentNode, testid: string): string {
  return (must(root, testid).textContent ?? '').trim();
}

export function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
