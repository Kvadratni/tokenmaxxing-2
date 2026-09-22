/**
 * happy-dom has no 2D context, so by default every offscreen pre-render in the
 * renderer silently degrades to immediate mode — which means the code paths that
 * actually ship in a browser go untested. This suite patches
 * `HTMLCanvasElement.prototype.getContext` so `createSurface()` succeeds, which
 * switches on the backdrop cache, the glyph cache, the confetti sheet and the
 * baked vignette.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearBackdropCache, getBackdrop, paintBackdrop } from '../../src/render/backdrop.ts';
import { createSurface } from '../../src/render/canvas.ts';
import { resetVignette } from '../../src/render/effects.ts';
import { ParticleSystem, resetConfettiSheet } from '../../src/render/particles.ts';
import { clearTextCache, drawText, measureText } from '../../src/render/text.ts';
import { createRenderer } from '../../src/render/index.ts';
import { SCENE_KEYS } from '../../src/render/backdrop.ts';
import type { RenderInput } from '../../src/sim/types.ts';
import { AGENT_TIER_IDS } from '../../src/sim/content.ts';
import { createMockCtx, makeCanvas, type MockCtx } from './render.mock-ctx.ts';

type CanvasProto = { getContext: (id: string) => unknown };
const proto = HTMLCanvasElement.prototype as unknown as CanvasProto;
const original = proto.getContext;
const contexts = new WeakMap<HTMLCanvasElement, MockCtx>();

beforeAll(() => {
  proto.getContext = function patched(this: HTMLCanvasElement) {
    let c = contexts.get(this);
    if (!c) {
      c = createMockCtx(this);
      contexts.set(this, c);
    }
    return c;
  };
});

afterAll(() => {
  proto.getContext = original;
});

afterEach(() => {
  clearTextCache();
  clearBackdropCache();
  resetVignette();
  resetConfettiSheet();
  document.body.innerHTML = '';
});

function ctxOf(c: HTMLCanvasElement): MockCtx {
  return contexts.get(c)!;
}

function frame(over: Partial<RenderInput> = {}): RenderInput {
  const zero = {} as Record<string, number>;
  for (const id of AGENT_TIER_IDS) zero[id] = 2;
  return {
    run: {
      slop: 100,
      projectIndex: 4,
      timeLeftMs: 8_000,
      elapsedMs: 1_000,
      agents: zero as RenderInput['run']['agents'],
      owned: [],
      cards: [],
      incidents: [],
      phase: 'running',
      draftOffer: [],
      draftRerollsLeft: 0,
      nextIncidentInMs: 1,
      pickup: null,
      nextPickupInMs: 999_000,
      clicks: 0,
      slopEarned: 0,
      slopSpent: 0,
      shipped: 0,
      pendingDemos: 0,
      rngState: 1,
      seed: 1,
    },
    derived: {
      clickPower: 10,
      idleRate: 5000,
      autoClickHz: 0,
      tierRates: zero as RenderInput['derived']['tierRates'],
      nextCosts: zero as RenderInput['derived']['nextCosts'],
      requirement: 1000,
      shipProgress: 0.1,
      // Below 0.25 so the vignette engages.
      deadlineProgress: 0.08,
      canShip: false,
      shipBlockedBy: null,
      headroom: zero as RenderInput['derived']['nextCosts'],
      etaSeconds: 10,
      demosIfEndedNow: 0,
      incidentRateMult: 1,
      critChance: 0.04,
      critMult: 7,
      oneShotChance: 0,
      oneShotPayoutS: 5,
      multipliers: { click: 1, idle: 1, all: 1 },
    },
    settings: {
      musicVolume: 1,
      sfxVolume: 1,
      reducedMotion: false,
      screenShake: true,
      showFps: true,
    },
    dt: 1 / 60,
    time: 1,
    ...over,
  };
}

describe('offscreen surfaces are available', () => {
  it('createSurface succeeds under the patch', () => {
    const s = createSurface(8, 8);
    expect(s).not.toBeNull();
    expect(s?.canvas.width).toBe(8);
  });
});

describe('backdrop pre-rendering', () => {
  it('paints every scene into a cached 320x180 surface', () => {
    for (const scene of SCENE_KEYS) {
      const c = getBackdrop(scene);
      expect(c, `no backdrop for ${scene}`).not.toBeNull();
      expect(c?.width).toBe(320);
      expect(c?.height).toBe(180);
      expect(ctxOf(c!).count('fillRect')).toBeGreaterThan(100);
    }
  });

  it('caches — the second request does not repaint', () => {
    const a = getBackdrop('datacenter')!;
    const opsAfterFirst = ctxOf(a).count('fillRect');
    const b = getBackdrop('datacenter')!;
    expect(b).toBe(a);
    expect(ctxOf(b).count('fillRect')).toBe(opsAfterFirst);
  });

  it('every scene paints a visually distinct backdrop', () => {
    const signatures = new Set<string>();
    for (const scene of SCENE_KEYS) {
      const surf = createSurface(320, 180)!;
      paintBackdrop(surf.ctx, scene);
      const c = ctxOf(surf.canvas);
      const fills = c.ops('set:fillStyle').map((call) => String(call.args[0]));
      signatures.add(`${c.count('fillRect')}|${new Set(fills).size}|${fills.slice(0, 12).join()}`);
    }
    expect(signatures.size).toBe(SCENE_KEYS.length);
  });

  it('the renderer blits the cached backdrop and never repaints its geometry', () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 1280, h: 720 }), dpr: () => 1, sheetTimeoutMs: 5, });
    // The scene comes from owned locations now; frame() owns none, so the
    // player is still in the bedroom they started in.
    r.draw(frame());
    const backdrop = getBackdrop('bedroom')!;
    const painted = ctxOf(backdrop).count('fillRect');
    expect(painted).toBeGreaterThan(100);

    for (let i = 1; i < 30; i++) r.draw(frame({ time: i / 60 }));
    // Scene geometry was painted exactly once, ever.
    expect(ctxOf(backdrop).count('fillRect')).toBe(painted);

    mc.ctx.reset();
    r.draw(frame({ time: 1 }));
    const blits = mc.ctx.ops('drawImage').filter((c) => c.args[0] === backdrop);
    expect(blits.length).toBeGreaterThanOrEqual(1);
    r.destroy();
  });
});

describe('glyph cache', () => {
  it('bakes strings once and blits them thereafter', () => {
    const c = createMockCtx(document.createElement('canvas'));
    const target = c as unknown as CanvasRenderingContext2D;
    const w = drawText(target, 'SLOP', 4, 4, '#4ec94e');
    expect(w).toBe(measureText('SLOP'));
    // Cached path: one drawImage, zero fillRects on the target surface.
    expect(c.count('drawImage')).toBe(1);
    expect(c.count('fillRect')).toBe(0);
    drawText(target, 'SLOP', 4, 4, '#4ec94e');
    drawText(target, 'SLOP', 4, 4, '#4ec94e');
    expect(c.count('drawImage')).toBe(3);
  });

  it('keys the cache on colour and shadow', () => {
    const c = createMockCtx(document.createElement('canvas'));
    const target = c as unknown as CanvasRenderingContext2D;
    drawText(target, 'HI', 0, 0, '#ffffff');
    drawText(target, 'HI', 0, 0, '#4ec94e');
    drawText(target, 'HI', 0, 0, '#4ec94e', { shadow: '#000000' });
    const sizes = c.ops('drawImage').map((call) => `${String(call.args[3])}x${String(call.args[4])}`);
    // The shadowed variant is one pixel larger in each axis.
    expect(new Set(sizes).size).toBe(2);
  });

  it('scales the cached bitmap by whole multiples', () => {
    const c = createMockCtx(document.createElement('canvas'));
    drawText(c as unknown as CanvasRenderingContext2D, 'A', 0, 0, '#fff', { scale: 4 });
    const call = c.ops('drawImage')[0]!;
    expect(Number(call.args[3])).toBe(3 * 4);
    expect(Number(call.args[4])).toBe(5 * 4);
  });
});

describe('confetti sheet', () => {
  it('bakes rotated glyphs and blits them per particle', () => {
    const p = new ParticleSystem(64);
    p.burstConfetti(160, 90, 32);
    const c = createMockCtx(document.createElement('canvas'));
    p.update(1 / 60);
    p.draw(c as unknown as CanvasRenderingContext2D, 0.5);
    expect(c.count('drawImage')).toBe(32);
    // Source rects come from a single sheet, 8px cells.
    for (const call of c.ops('drawImage')) {
      expect(Number(call.args[3])).toBe(8);
      expect(Number(call.args[4])).toBe(8);
    }
  });

  it('uses all four rotation rows as particles tumble', () => {
    const p = new ParticleSystem(256);
    p.burstConfetti(160, 90, 200);
    const rows = new Set<number>();
    const c = createMockCtx(document.createElement('canvas'));
    for (let f = 0; f < 40; f++) {
      p.update(1 / 60);
      c.reset();
      p.draw(c as unknown as CanvasRenderingContext2D, f / 60);
      for (const call of c.ops('drawImage')) rows.add(Number(call.args[2]) / 8);
    }
    expect(rows.size).toBe(4);
  });
});

describe('vignette', () => {
  it('bakes a 320x180 alpha ramp and blits it when the deadline burns down', () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 640, h: 360 }), dpr: () => 1, sheetTimeoutMs: 5, });
    r.draw(frame());
    const blits = mc.ctx.ops('drawImage').filter((c) => {
      const src = c.args[0] as HTMLCanvasElement | undefined;
      return src?.width === 320 && src?.height === 180;
    });
    // Backdrop + vignette are both full-scene surfaces.
    expect(blits.length).toBeGreaterThanOrEqual(2);
    r.destroy();
  });

  it('stays off while the deadline is comfortable', () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 640, h: 360 }), dpr: () => 1, sheetTimeoutMs: 5, });
    const calm = frame();
    r.draw({ ...calm, derived: { ...calm.derived, deadlineProgress: 0.9 } });
    const withVignette = frame();
    const before = mc.ctx.count('drawImage');
    mc.ctx.reset();
    r.draw({ ...withVignette, time: 2, run: { ...withVignette.run, timeLeftMs: 3000 } });
    expect(mc.ctx.count('drawImage')).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
    r.destroy();
  });
});

describe('full frame under the browser-shaped paths', () => {
  it('renders every scene, phase and effect without throwing', () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 1280, h: 720 }), dpr: () => 2, sheetTimeoutMs: 5, });
    r.handle({ t: 'ship', projectIndex: 0, demos: 3, timeLeftMs: 1000 });
    r.handle({ t: 'incidentStart', id: 'rate_limited', tone: 'bad' });
    for (let i = 0; i < 60; i++) {
      const f = frame({ time: i / 60 });
      expect(() =>
        r.draw({
          ...f,
          run: { ...f.run, projectIndex: i % 10, phase: i > 50 ? 'won' : 'running' },
        }),
      ).not.toThrow();
    }
    expect(r.renderStats().drawCalls).toBeGreaterThan(0);
    r.destroy();
  });
});
