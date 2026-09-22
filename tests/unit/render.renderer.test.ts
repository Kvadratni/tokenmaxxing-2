import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_SPRITES } from '../../src/render/atlas-types.ts';
import { createRenderer, type SceneRenderer } from '../../src/render/index.ts';
import type {
  AgentTierId,
  DerivedStats,
  GameEvent,
  RenderInput,
  RunState,
  Settings,
} from '../../src/sim/types.ts';
import { AGENT_TIER_IDS } from '../../src/sim/content.ts';
import { SpyResizeObserver, makeCanvas, type MockCtx } from './render.mock-ctx.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function agents(n = 0): Record<AgentTierId, number> {
  const out = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) out[id] = n;
  return out;
}

function run(over: Partial<RunState> = {}): RunState {
  return {
    slop: 500,
    projectIndex: 0,
    timeLeftMs: 90_000,
    elapsedMs: 30_000,
    agents: agents(),
    owned: [],
    cards: [],
    incidents: [],
    phase: 'running',
    draftOffer: [],
    draftRerollsLeft: 0,
    nextIncidentInMs: 20_000,
    pickup: null,
    nextPickupInMs: 999_000,
    clicks: 12,
    slopEarned: 900,
    slopSpent: 400,
    shipped: 0,
    pendingDemos: 0,
    rngState: 1,
    seed: 42,
    ...over,
  };
}

function derived(over: Partial<DerivedStats> = {}): DerivedStats {
  const zero = {} as Record<AgentTierId, number>;
  for (const id of AGENT_TIER_IDS) zero[id] = 0;
  return {
    clickPower: 5,
    idleRate: 0,
    autoClickHz: 0,
    tierRates: { ...zero },
    nextCosts: { ...zero },
    requirement: 1000,
    shipProgress: 0.5,
    deadlineProgress: 0.75,
    canShip: false,
    shipBlockedBy: null,
    headroom: {} as never,
    etaSeconds: 60,
    demosIfEndedNow: 0,
    incidentRateMult: 1,
    critChance: 0.04,
    critMult: 7,
    oneShotChance: 0,
    oneShotPayoutS: 5,
    multipliers: { click: 1, idle: 1, all: 1 },
    ...over,
  };
}

function settings(over: Partial<Settings> = {}): Settings {
  return {
    musicVolume: 0.5,
    sfxVolume: 0.5,
    reducedMotion: false,
    screenShake: true,
    showFps: false,
    ...over,
  };
}

function input(over: Partial<RenderInput> = {}): RenderInput {
  return {
    run: run(),
    derived: derived(),
    settings: settings(),
    dt: 1 / 60,
    time: 1,
    ...over,
  };
}

/** Every GameEvent variant, one of each. */
const ALL_EVENTS: readonly GameEvent[] = [
  { t: 'click', amount: 12, x: 160, y: 118, crit: false, auto: false },
  { t: 'click', amount: 840, x: 160, y: 118, crit: true, auto: false },
  { t: 'buyAgent', id: 'cli_agent', cost: 500, owned: 3 },
  { t: 'buyUpgrade', id: 'mech_keyboard', cost: 100 },
  { t: 'ship', projectIndex: 0, demos: 2, timeLeftMs: 42_000 },
  { t: 'draftOpen', offer: ['opus', 'haiku', 'sonnet'] },
  { t: 'draftPick', id: 'opus' },
  { t: 'draftReroll' },
  { t: 'incidentStart', id: 'rate_limited', tone: 'bad' },
  { t: 'incidentStart', id: 'viral_tweet', tone: 'good' },
  { t: 'incidentEnd', id: 'rate_limited' },
  { t: 'incidentProgress', id: 'merge_conflict', clicksRemaining: 4 },
  { t: 'deadlineWarn', secondsLeft: 9 },
  { t: 'runOver', won: true, demos: 7, shipped: 10 },
  { t: 'runOver', won: false, demos: 1, shipped: 2 },
  { t: 'metaBuy', id: 'cracked', level: 2, cost: 5 },
  { t: 'runStart', seed: 99 },
  { t: 'denied', reason: 'cost' },
  { t: 'denied', reason: 'locked' },
  { t: 'denied', reason: 'phase' },
];

const OriginalRO = globalThis.ResizeObserver;

beforeEach(() => {
  SpyResizeObserver.reset();
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = SpyResizeObserver;
});

afterEach(() => {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = OriginalRO;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mount(opts: { reducedMotion?: boolean; noContext?: boolean } = {}): {
  r: SceneRenderer;
  ctx: MockCtx;
  rectReads: () => number;
} {
  const mc = makeCanvas({ noContext: opts.noContext ?? false });
  const r = createRenderer(mc.canvas, {
    measure: () => ({ w: 1280, h: 720 }),
    dpr: () => 1, sheetTimeoutMs: 5,
  });
  return { r, ctx: mc.ctx, rectReads: mc.rectReads };
}

// ---------------------------------------------------------------------------

describe('headless safety', () => {
  it('does not throw when getContext returns null', () => {
    const mc = makeCanvas({ noContext: true });
    let r: SceneRenderer | null = null;
    expect(() => {
      r = createRenderer(mc.canvas, { measure: () => ({ w: 800, h: 600 }), dpr: () => 1, sheetTimeoutMs: 5, });
    }).not.toThrow();
    const rr = r as unknown as SceneRenderer;
    expect(() => rr.draw(input())).not.toThrow();
    for (const e of ALL_EVENTS) expect(() => rr.handle(e)).not.toThrow();
    expect(() => rr.resize()).not.toThrow();
    // Coordinate maths still works so the game stays clickable.
    expect(rr.metrics().scale).toBe(2);
    expect(rr.hitsLaptop(160, 118)).toBe(true);
    expect(rr.renderStats().particles).toBe(0);
    rr.destroy();
  });
});

describe('draw()', () => {
  it('renders a frame with no atlas and no exceptions', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    expect(() => r.draw(input())).not.toThrow();
    expect(ctx.count('fillRect')).toBeGreaterThan(50);
    expect(ctx.count('save')).toBeGreaterThan(0);
    expect(ctx.count('restore')).toBe(ctx.count('save'));
    expect(ctx.count('setTransform')).toBeGreaterThan(0);
    r.destroy();
  });

  it('reports no missing sprites now that the atlas declares every required key', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input());
    expect(r.renderStats().missingSprites).toEqual([]);
    r.destroy();
  });

  it('seeds every required key as missing before the atlas resolves', () => {
    // Synchronous: `whenReady()` has not been awaited, so nothing is known yet
    // and the renderer must assume it has no art at all.
    const { r } = mount();
    const missing = r.renderStats().missingSprites;
    for (const key of REQUIRED_SPRITES) {
      expect(missing, `expected ${key} to be reported missing`).toContain(key);
    }
    // ...and it still draws, using procedural stand-ins.
    expect(() => r.draw(input())).not.toThrow();
    r.destroy();
  });

  it('falls back to procedural art when the sheets cannot be decoded', async () => {
    // happy-dom has no image loader, so every sheet times out.
    const { r, ctx } = mount();
    await r.whenReady();
    expect(r.renderStats().failedSheets.length).toBeGreaterThan(0);
    r.draw(input({ run: run({ agents: agents(2) }) }));
    // Procedural stand-ins are rects, not blits.
    expect(ctx.count('fillRect')).toBeGreaterThan(100);
    r.destroy();
  });

  it('survives every project index, phase and scene', async () => {
    const { r } = mount();
    await r.whenReady();
    const phases = ['running', 'drafting', 'shipped', 'won', 'lost'] as const;
    for (let i = 0; i < 14; i++) {
      for (const phase of phases) {
        expect(() =>
          r.draw(
            input({
              run: run({ projectIndex: i, phase, agents: agents(3) }),
              time: i * 0.3,
            }),
          ),
        ).not.toThrow();
      }
    }
    r.destroy();
  });

  it('draws desk clutter only for owned tiers, and caps the visual stack', async () => {
    const { r, ctx } = mount();
    await r.whenReady();

    r.draw(input({ run: run({ agents: agents(0) }) }));
    const none = r.renderStats().sprites;

    ctx.reset();
    r.draw(input({ run: run({ agents: agents(1) }), time: 2 }));
    const one = r.renderStats().sprites;

    ctx.reset();
    r.draw(input({ run: run({ agents: agents(500) }), time: 3 }));
    const many = r.renderStats().sprites;

    expect(one).toBeGreaterThan(none);
    expect(many).toBeGreaterThan(one);
    // 10 tiers, at most 4 copies each, plus backdrop + dev + laptop.
    expect(many).toBeLessThanOrEqual(10 * 4 + 8);
    r.destroy();
  });

  it('never reads getBoundingClientRect inside draw()', async () => {
    const { r, rectReads } = mount();
    await r.whenReady();
    r.draw(input());
    const before = rectReads();
    for (let i = 0; i < 30; i++) r.draw(input({ time: i / 60 }));
    expect(rectReads()).toBe(before);
    // resize() is allowed to measure.
    r.resize();
    expect(rectReads()).toBeGreaterThan(before);
    r.destroy();
  });

  it('handles extreme and degenerate inputs', async () => {
    const { r } = mount();
    await r.whenReady();
    expect(() => r.draw(input({ dt: 0, time: 0 }))).not.toThrow();
    expect(() => r.draw(input({ dt: 100, time: 1e6 }))).not.toThrow();
    expect(() => r.draw(input({ dt: Number.NaN, time: Number.NaN }))).not.toThrow();
    expect(() =>
      r.draw(input({ derived: derived({ idleRate: 1e30, deadlineProgress: 0 }) })),
    ).not.toThrow();
    expect(() =>
      r.draw(input({ run: run({ timeLeftMs: 0, phase: 'lost' }), time: 5 })),
    ).not.toThrow();
    r.destroy();
  });

  it('draws the perf HUD only when showFps is on', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    r.draw(input({ settings: settings({ showFps: false }) }));
    const off = ctx.count('fillRect');
    ctx.reset();
    r.draw(input({ settings: settings({ showFps: true }), time: 2 }));
    const on = ctx.count('fillRect');
    expect(on).toBeGreaterThan(off);
    r.destroy();
  });

  it('reports live stats', async () => {
    const { r } = mount();
    await r.whenReady();
    r.handle({ t: 'ship', projectIndex: 0, demos: 1, timeLeftMs: 1000 });
    r.draw(input());
    const s = r.renderStats();
    expect(s.particles).toBeGreaterThan(100);
    expect(s.sprites).toBeGreaterThan(0);
    expect(s.drawCalls).toBeGreaterThan(0);
    expect(s.fps).toBeGreaterThan(0);
    r.destroy();
  });
});

describe('handle()', () => {
  it('accepts every GameEvent variant without throwing', async () => {
    const { r } = mount();
    await r.whenReady();
    for (const e of ALL_EVENTS) {
      expect(() => r.handle(e), `handle failed for ${e.t}`).not.toThrow();
      expect(() => r.draw(input({ time: Math.random() * 10 }))).not.toThrow();
    }
    r.destroy();
  });

  it('never mutates the event it is given', async () => {
    const { r } = mount();
    await r.whenReady();
    const snapshots = ALL_EVENTS.map((e) => JSON.stringify(e));
    for (const e of ALL_EVENTS) r.handle(Object.freeze({ ...e }) as GameEvent);
    r.draw(input());
    ALL_EVENTS.forEach((e, i) => {
      expect(JSON.stringify(e)).toBe(snapshots[i]);
    });
    r.destroy();
  });

  it('is inert after destroy()', async () => {
    const { r } = mount();
    await r.whenReady();
    r.destroy();
    for (const e of ALL_EVENTS) expect(() => r.handle(e)).not.toThrow();
    expect(() => r.draw(input())).not.toThrow();
    expect(r.renderStats().particles).toBe(0);
  });

  it('bounds the queue so an un-drawn renderer cannot leak', async () => {
    const { r } = mount();
    await r.whenReady();
    for (let i = 0; i < 5000; i++) r.handle({ t: 'denied', reason: 'cost' });
    expect(() => r.draw(input())).not.toThrow();
    r.destroy();
  });

  it('does not spawn particles before the first draw', async () => {
    const { r } = mount();
    await r.whenReady();
    r.handle({ t: 'ship', projectIndex: 0, demos: 1, timeLeftMs: 1 });
    expect(r.renderStats().particles).toBe(0);
    r.draw(input());
    expect(r.renderStats().particles).toBeGreaterThan(0);
    r.destroy();
  });
});

describe('reduced motion', () => {
  function shipFrames(reducedMotion: boolean): { particles: number; translates: number } {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1, sheetTimeoutMs: 5,
    });
    const s = settings({ reducedMotion, screenShake: true });
    r.handle({ t: 'ship', projectIndex: 0, demos: 3, timeLeftMs: 20_000 });
    r.handle({ t: 'incidentStart', id: 'rate_limited', tone: 'bad' });
    r.draw(input({ settings: s, time: 0, dt: 1 / 60 }));
    const particles = r.renderStats().particles;
    let translates = 0;
    for (let f = 1; f < 25; f++) {
      mc.ctx.reset();
      r.draw(input({ settings: s, time: f / 60, dt: 1 / 60 }));
      translates += mc.ctx
        .ops('translate')
        .filter((c) => c.args[0] !== 0 || c.args[1] !== 0).length;
    }
    r.destroy();
    return { particles, translates };
  }

  it('cuts particle spawn by roughly 80% and suppresses shake', () => {
    const normal = shipFrames(false);
    const reduced = shipFrames(true);

    expect(normal.particles).toBeGreaterThan(200);
    expect(reduced.particles).toBeLessThan(normal.particles * 0.35);
    expect(reduced.particles).toBeGreaterThan(0); // still readable, just calmer

    expect(normal.translates).toBeGreaterThan(0);
    expect(reduced.translates).toBe(0);
  });

  it('screenShake: false suppresses shake on its own', () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1, sheetTimeoutMs: 5,
    });
    const s = settings({ reducedMotion: false, screenShake: false });
    r.handle({ t: 'ship', projectIndex: 0, demos: 1, timeLeftMs: 1 });
    let translates = 0;
    for (let f = 0; f < 25; f++) {
      mc.ctx.reset();
      r.draw(input({ settings: s, time: f / 60, dt: 1 / 60 }));
      translates += mc.ctx
        .ops('translate')
        .filter((c) => c.args[0] !== 0 || c.args[1] !== 0).length;
    }
    // Particles still fly — only the camera holds still.
    expect(r.renderStats().particles).toBeGreaterThan(100);
    expect(translates).toBe(0);
    r.destroy();
  });

  it('suppresses the incident glitch', () => {
    const selfBlits = (reducedMotion: boolean): number => {
      const mc = makeCanvas();
      const r = createRenderer(mc.canvas, {
        measure: () => ({ w: 1280, h: 720 }),
        dpr: () => 1,
        sheetTimeoutMs: 5,
      });
      const s = settings({ reducedMotion, screenShake: true });
      r.handle({ t: 'incidentStart', id: 'rate_limited', tone: 'bad' });
      let n = 0;
      for (let f = 0; f < 20; f++) {
        mc.ctx.reset();
        r.draw(input({ settings: s, time: f / 60, dt: 1 / 60 }));
        // The glitch tears the frame by re-blitting the canvas onto itself.
        n += mc.ctx.ops('drawImage').filter((c) => c.args[0] === mc.canvas).length;
      }
      r.destroy();
      return n;
    };
    expect(selfBlits(false)).toBeGreaterThan(0);
    expect(selfBlits(true)).toBe(0);
  });

  it('still renders the full scene with reduced motion on', async () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1, sheetTimeoutMs: 5,
    });
    await r.whenReady();
    r.draw(input({ settings: settings({ reducedMotion: true }), run: run({ agents: agents(4) }) }));
    expect(r.renderStats().sprites).toBeGreaterThan(10);
    expect(mc.ctx.count('fillRect')).toBeGreaterThan(50);
    r.destroy();
  });
});

describe('lifecycle', () => {
  it('attaches a ResizeObserver and window listeners, then detaches them', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { r } = mount();

    const observer = SpyResizeObserver.instances.at(-1);
    expect(observer).toBeDefined();
    expect(observer?.observed).toBe(1);
    const added = add.mock.calls.filter((c) => c[0] === 'resize').length;
    expect(added).toBeGreaterThan(0);

    r.destroy();
    expect(observer?.disconnected).toBe(1);
    expect(remove.mock.calls.filter((c) => c[0] === 'resize').length).toBe(added);
  });

  it('destroy() is idempotent', () => {
    const { r } = mount();
    const observer = SpyResizeObserver.instances.at(-1);
    r.destroy();
    r.destroy();
    r.destroy();
    expect(observer?.disconnected).toBe(1);
    expect(() => r.resize()).not.toThrow();
    expect(() => r.draw(input())).not.toThrow();
    expect(() => r.toScene(0, 0)).not.toThrow();
  });

  it('survives without ResizeObserver in the host', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 640, h: 360 }), dpr: () => 1, sheetTimeoutMs: 5, });
    expect(r.metrics().scale).toBe(2);
    expect(() => r.draw(input())).not.toThrow();
    expect(() => r.destroy()).not.toThrow();
  });

  it('survives a detached canvas with no parent element', () => {
    const mc = makeCanvas({ attach: false });
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 960, h: 540 }), dpr: () => 1, sheetTimeoutMs: 5, });
    expect(r.metrics().scale).toBe(3);
    expect(() => r.draw(input())).not.toThrow();
    r.destroy();
  });
});
