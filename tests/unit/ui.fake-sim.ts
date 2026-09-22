/**
 * Test double for `SimApi`, plus DOM helpers shared by the ui.*.test.ts files.
 *
 * Deliberately does NOT import the real sim: the UI must be provable against
 * the contract in `src/sim/types.ts` alone. (Static content from
 * `src/sim/content.ts` is fair game — every module reads it.)
 */
import { vi } from 'vitest';
import {
  AGENT_TIERS,
  AGENT_TIER_IDS,
  projectDeadlineMs,
  projectRequirement,
  UPGRADE_BY_ID,
} from '../../src/sim/content.ts';
import type {
  ActiveIncident,
  AgentTierDef,
  AgentTierId,
  DerivedStats,
  EventSink,
  MetaState,
  RunState,
  Settings,
  UpgradeDef,
} from '../../src/sim/types.ts';

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

export function makeRun(over: Partial<RunState> = {}): RunState {
  const agents = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) agents[id] = 0;
  return {
    slop: 0,
    projectIndex: 0,
    timeLeftMs: 120_000,
    elapsedMs: 0,
    agents,
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
    slopEarned: 0,
    slopSpent: 0,
    shipped: 0,
    pendingDemos: 0,
    rngState: 1,
    seed: 1234,
    ...over,
  };
}

export function makeMeta(over: Partial<MetaState> = {}): MetaState {
  return {
    demos: 0,
    levels: {},
    bestProject: -1,
    runs: 0,
    wins: 0,
    totalDemosEarned: 0,
    version: 1,
    achievements: {},
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

export function makeDerived(run: RunState, over: Partial<DerivedStats> = {}): DerivedStats {
  const requirement = projectRequirement(run.projectIndex);
  const deadline = projectDeadlineMs(run.projectIndex);
  const tierRates = {} as Record<AgentTierId, number>;
  const nextCosts = {} as Record<AgentTierId, number>;
  let idleRate = 0;
  for (const t of AGENT_TIERS) {
    const owned = run.agents[t.id] ?? 0;
    const rate = owned * t.baseRate;
    tierRates[t.id] = rate;
    idleRate += rate;
    nextCosts[t.id] = Math.ceil(t.baseCost * Math.pow(t.costGrowth, owned));
  }
  const missing = Math.max(0, requirement - run.slop);
  return {
    clickPower: 1,
    idleRate,
    autoClickHz: 0,
    tierRates,
    nextCosts,
    requirement,
    shipProgress: Math.max(0, Math.min(1, run.slop / requirement)),
    deadlineProgress: Math.max(0, Math.min(1, run.timeLeftMs / deadline)),
    canShip: run.slop >= requirement,
    shipBlockedBy: null,
    headroom: {} as never,
    etaSeconds: idleRate > 0 ? missing / idleRate : Infinity,
    demosIfEndedNow: run.pendingDemos,
    incidentRateMult: 1,
    critChance: 0.04,
    critMult: 7,
    oneShotChance: 0,
    oneShotPayoutS: 5,
    multipliers: { click: 1, idle: 1, all: 1 },
    ...over,
  };
}

export interface FakeSimInit {
  run?: RunState;
  meta?: MetaState;
  derived?: Partial<DerivedStats>;
  visibleTiers?: readonly AgentTierDef[];
  upgrades?: readonly UpgradeDef[];
  /** What `buyAgent` / `buyUpgrade` / `ship` etc. report back. */
  succeed?: boolean;
}

export function makeFakeSim(init: FakeSimInit = {}) {
  const run = init.run ?? makeRun();
  const meta = init.meta ?? makeMeta();
  let derivedOver: Partial<DerivedStats> = init.derived ?? {};
  let visible: readonly AgentTierDef[] = init.visibleTiers ?? AGENT_TIERS.slice(0, 3);
  let upgrades: readonly UpgradeDef[] = init.upgrades ?? [];
  const ok = init.succeed ?? true;

  return {
    run,
    meta,
    derived: vi.fn((): DerivedStats => makeDerived(run, derivedOver)),
    tick: vi.fn((_dtMs: number): void => undefined),
    click: vi.fn((_x: number, _y: number): number => 1),
    collectPickup: vi.fn((_x: number, _y: number) => false),
    buyAgent: vi.fn((_id: AgentTierId, _count?: number): boolean => ok),
    buyUpgrade: vi.fn((_id: string): boolean => ok),
    ship: vi.fn((): boolean => ok),
    pickCard: vi.fn((_id: string): boolean => ok),
    rerollDraft: vi.fn((): boolean => ok),
    buyMeta: vi.fn((_id: string): boolean => ok),
    endRun: vi.fn((_won: boolean): void => undefined),
    startRun: vi.fn((_seed?: number): void => undefined),
    availableUpgrades: vi.fn((): readonly UpgradeDef[] => upgrades),
    visibleTiers: vi.fn((): readonly AgentTierDef[] => visible),
    subscribe: vi.fn((_sink: EventSink): (() => void) => () => undefined),

    // --- test-only knobs ---
    setDerived(d: Partial<DerivedStats>): void {
      derivedOver = d;
    },
    setVisibleTiers(t: readonly AgentTierDef[]): void {
      visible = t;
    },
    setUpgrades(ids: readonly string[]): void {
      const out: UpgradeDef[] = [];
      for (const id of ids) {
        const def = UPGRADE_BY_ID[id];
        if (def !== undefined) out.push(def);
      }
      upgrades = out;
    },
  };
}

export type FakeSim = ReturnType<typeof makeFakeSim>;

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

export function isHidden(node: HTMLElement | null): boolean {
  return node === null || node.hasAttribute('hidden');
}

export function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
