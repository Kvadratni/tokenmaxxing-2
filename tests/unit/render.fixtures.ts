/**
 * Shared fixtures for the STAGE suites: complete RunState / DerivedStats /
 * Settings objects built from content.ts, one of every GameEvent, and a
 * mounted renderer on the recording mock context.
 */
import { TOOL_IDS } from '../../src/sim/content.ts';
import type {
  ActiveIncident,
  DerivedStats,
  GameEvent,
  RenderInput,
  RunState,
  Settings,
  ToolId,
} from '../../src/sim/types.ts';
import { createRenderer, type SceneRenderer } from '../../src/render/index.ts';
import type { RendererOptions } from '../../src/render/scene.ts';
import { makeCanvas, type MockCtx } from './render.mock-ctx.ts';

export function perTool<T>(v: T): Record<ToolId, T> {
  const out = {} as Record<ToolId, T>;
  for (const id of TOOL_IDS) out[id] = v;
  return out;
}

export function tools(over: Partial<Record<ToolId, number>> = {}): Record<ToolId, number> {
  return { ...perTool(0), ...over };
}

export function run(over: Partial<RunState> = {}): RunState {
  return {
    tokens: 420,
    promptIndex: 0,
    patienceMs: 100_000,
    context: 800,
    compactingMs: 0,
    summary: null,
    elapsedMs: 20_000,
    tools: tools(),
    owned: [],
    cards: [],
    incidents: [],
    phase: 'running',
    draftOffer: [],
    draftRerollsLeft: 0,
    nextIncidentInMs: 30_000,
    pickup: null,
    nextPickupInMs: 30_000,
    clicks: 40,
    tokensEarned: 900,
    tokensSpent: 400,
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
    seed: 1,
    ...over,
  };
}

export function derived(over: Partial<DerivedStats> = {}): DerivedStats {
  return {
    clickPower: 3,
    idleRate: 12,
    autoClickHz: 0,
    toolRates: perTool(2),
    toolHalted: perTool(false),
    toolFootprint: perTool(1),
    toolCostMult: 1,
    nextCosts: perTool(100),
    headroom: perTool(60),
    requirement: 100,
    reportProgress: 0.4,
    reportState: 'working',
    reportBlockedBy: null,
    claimThreshold: 0.5,
    verifyChance: 0.4,
    patienceProgress: 0.9,
    patienceMaxMs: 120_000,
    patienceFrozen: false,
    sycophancyPower: 0.06,
    contextMax: 8000,
    contextFloor: 0,
    contextFill: 0.1,
    contextRate: 10,
    clickContext: 24,
    secondsToCompaction: 200,
    summarySlots: 1,
    compactKeepForced: 0.25,
    compactKeepManual: 0.5,
    canCompact: false,
    etaSeconds: 20,
    thumbsIfEndedNow: 0,
    incidentRateMult: 1,
    critChance: 0.04,
    critMult: 7,
    oneShotChance: 0,
    oneShotPayoutS: 5,
    scene: 'bedroom',
    modelVersion: '2.0',
    multipliers: { click: 1, idle: 1, all: 1 },
    ...over,
  };
}

export function settings(over: Partial<Settings> = {}): Settings {
  return {
    musicVolume: 0.5,
    sfxVolume: 0.5,
    reducedMotion: false,
    screenShake: true,
    showFps: false,
    ...over,
  };
}

export function input(over: Partial<RenderInput> = {}): RenderInput {
  return { run: run(), derived: derived(), settings: settings(), dt: 1 / 60, time: 1, ...over };
}

export function incident(id: string, over: Partial<ActiveIncident> = {}): ActiveIncident {
  return { id, remainingMs: 8000, clicksRemaining: 0, startedAtMs: 0, ...over };
}

/** One of every GameEvent variant (and both halves of the interesting ones). */
export const ALL_EVENTS: readonly GameEvent[] = [
  { t: 'click', amount: 12, x: 160, y: 140, crit: false, auto: false },
  { t: 'click', amount: 840, x: 160, y: 140, crit: true, auto: false },
  { t: 'click', amount: 12, x: 160, y: 140, crit: false, auto: true },
  { t: 'oneShot', amount: 5000, seconds: 5 },
  { t: 'buyTool', id: 'grep', cost: 40, owned: 3 },
  { t: 'buyUpgrade', id: 'streaming', cost: 60 },
  { t: 'toolLost', id: 'bash', owned: 2 },
  { t: 'report', promptIndex: 0, thumbs: 2, patienceLeft: 0.6 },
  { t: 'claim', promptIndex: 1, caught: false, verifyChance: 0.4, spent: 90 },
  { t: 'claim', promptIndex: 1, caught: true, verifyChance: 0.4, spent: 90 },
  { t: 'compactStart', forced: true, kept: 100, lost: 300 },
  { t: 'compactStart', forced: false, kept: 200, lost: 200 },
  { t: 'compactEnd', keptCards: ['please'], droppedCards: ['thank_you'] },
  { t: 'sycophancy', restored: 0.06, heat: 1 },
  { t: 'draftOpen', offer: ['please', 'thank_you', 'grandma'] },
  { t: 'draftPick', id: 'please' },
  { t: 'draftReroll' },
  { t: 'incidentStart', id: 'wait_stop', tone: 'bad' },
  { t: 'incidentStart', id: 'lunch', tone: 'good' },
  { t: 'incidentStart', id: 'bash_permission', tone: 'bad', tool: 'bash' },
  { t: 'incidentEnd', id: 'wait_stop' },
  { t: 'incidentProgress', id: 'continue', clicksRemaining: 4 },
  { t: 'pickupSpawn', id: 'golden_token', x: 60, y: 60 },
  { t: 'pickupCollect', id: 'golden_token', x: 60, y: 60 },
  { t: 'pickupExpire', id: 'golden_token' },
  { t: 'patienceWarn', secondsLeft: 9 },
  { t: 'contextWarn', fill: 0.8 },
  { t: 'contextWarn', fill: 0.95 },
  { t: 'runOver', won: true, thumbs: 12, reported: 10 },
  { t: 'runOver', won: false, thumbs: 2, reported: 3 },
  { t: 'metaBuy', id: 'helpful', level: 1, cost: 3 },
  { t: 'runStart', seed: 99 },
  { t: 'achievement', id: 'compacted' },
  { t: 'legacyImport', verdict: 'clean', gift: 5, cheater: false },
  { t: 'denied', reason: 'cost' },
  { t: 'denied', reason: 'thumbs' },
  { t: 'denied', reason: 'locked' },
  { t: 'denied', reason: 'phase' },
];

export interface Mounted {
  r: SceneRenderer;
  ctx: MockCtx;
  canvas: HTMLCanvasElement;
  rectReads: () => number;
}

/** A renderer on the recording mock context. happy-dom has no image loader, so sheets fail fast. */
export function mount(opts: { noContext?: boolean; options?: RendererOptions } = {}): Mounted {
  const mc = makeCanvas({ noContext: opts.noContext ?? false });
  const r = createRenderer(mc.canvas, {
    measure: () => ({ w: 1280, h: 720 }),
    dpr: () => 1,
    sheetTimeoutMs: 5,
    ...opts.options,
  });
  return { r, ctx: mc.ctx, canvas: mc.canvas, rectReads: mc.rectReads };
}

/** Step the renderer frame by frame at 60 fps from `from` to `to` seconds. */
export function play(r: SceneRenderer, from: number, to: number, frame: (t: number) => RenderInput): void {
  for (let t = from; t <= to + 1e-9; t += 1 / 60) r.draw(frame(t));
}
