/**
 * happy-dom has no 2D context, so by default every offscreen pre-render in the
 * renderer silently degrades to immediate mode, and the paths that actually
 * ship go untested. This suite patches `HTMLCanvasElement.prototype.getContext`
 * so `createSurface()` succeeds, which switches on the pile cache, the frame
 * and scanline caches, the fallback room backdrops, the glyph cache, the
 * confetti sheet and the baked vignette.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SCENE_KEYS, clearBackdropCache, getBackdrop, paintBackdrop } from '../../src/render/backdrop.ts';
import { createSurface } from '../../src/render/canvas.ts';
import { resetVignette } from '../../src/render/effects.ts';
import { resetGlassCache } from '../../src/render/glass.ts';
import { ParticleSystem, resetConfettiSheet } from '../../src/render/particles.ts';
import { clearTextCache, drawText, measureText } from '../../src/render/text.ts';
import { createRenderer } from '../../src/render/index.ts';
import { createMockCtx, makeCanvas, type MockCtx } from './render.mock-ctx.ts';
import { derived, input, run } from './render.fixtures.ts';

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
  resetGlassCache();
  document.body.innerHTML = '';
});

function ctxOf(c: HTMLCanvasElement): MockCtx {
  return contexts.get(c)!;
}

function mountSurfaces(): { r: ReturnType<typeof createRenderer>; mc: ReturnType<typeof makeCanvas> } {
  const mc = makeCanvas();
  const r = createRenderer(mc.canvas, { measure: () => ({ w: 640, h: 360 }), dpr: () => 1, sheetTimeoutMs: 5 });
  return { r, mc };
}

describe('offscreen surfaces are available', () => {
  it('createSurface succeeds under the patch', () => {
    const s = createSurface(8, 8);
    expect(s).not.toBeNull();
    expect(s?.canvas.width).toBe(8);
  });
});

describe('fallback room backdrops', () => {
  it('paints every scene into a cached 320x180 surface, once', () => {
    for (const scene of SCENE_KEYS) {
      const c = getBackdrop(scene);
      expect(c, `no backdrop for ${scene}`).not.toBeNull();
      expect([c?.width, c?.height]).toEqual([320, 180]);
      const painted = ctxOf(c!).count('fillRect');
      expect(painted).toBeGreaterThan(100);
      expect(getBackdrop(scene)).toBe(c);
      expect(ctxOf(c!).count('fillRect')).toBe(painted);
    }
  });

  it('every scene paints a distinct backdrop', () => {
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
});

describe('the pile is cached', () => {
  it('repaints only when its shape changes, and blits otherwise', () => {
    const { r, mc } = mountSurfaces();
    const f = (t: number, fill: number) => input({ time: t, derived: derived({ contextFill: fill }) });
    r.draw(f(1, 0.5));
    // The pile cache is the 320-wide surface drawn with a 9-argument drawImage.
    const pileBlits = (): HTMLCanvasElement[] =>
      mc.ctx
        .ops('drawImage')
        .filter((c) => c.args.length === 9 && (c.args[0] as HTMLCanvasElement).height === 159)
        .map((c) => c.args[0] as HTMLCanvasElement);
    const surface = pileBlits()[0];
    expect(surface, 'pile was not drawn from a cache surface').toBeDefined();
    const painted = ctxOf(surface!).count('fillRect');
    expect(painted).toBeGreaterThan(50);
    for (let i = 1; i < 20; i++) r.draw(f(1 + i / 60, 0.5));
    expect(ctxOf(surface!).count('fillRect')).toBe(painted);
    r.draw(f(2, 0.8));
    for (let i = 1; i < 90; i++) r.draw(f(2 + i / 60, 0.8));
    expect(ctxOf(surface!).count('fillRect')).toBeGreaterThan(painted);
    r.destroy();
  });
});

describe('glyph cache', () => {
  it('bakes strings once and blits them thereafter', () => {
    const c = createMockCtx(document.createElement('canvas'));
    const target = c as unknown as CanvasRenderingContext2D;
    const w = drawText(target, 'TOKENS', 4, 4, '#4ec94e');
    expect(w).toBe(measureText('TOKENS'));
    expect(c.count('drawImage')).toBe(1);
    expect(c.count('fillRect')).toBe(0);
    drawText(target, 'TOKENS', 4, 4, '#4ec94e');
    expect(c.count('drawImage')).toBe(2);
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
    for (const call of c.ops('drawImage')) {
      expect(Number(call.args[3])).toBe(8);
      expect(Number(call.args[4])).toBe(8);
    }
  });
});

describe('the patience vignette', () => {
  it('bakes a full-scene alpha ramp and blits it when patience runs low', () => {
    const { r, mc } = mountSurfaces();
    const fullScene = (): number =>
      mc.ctx.ops('drawImage').filter((c) => {
        const src = c.args[0] as HTMLCanvasElement | undefined;
        return src?.width === 320 && src?.height === 180 && c.args.length === 5;
      }).length;
    r.draw(input({ time: 1, derived: derived({ patienceProgress: 0.9 }) }));
    const calm = fullScene();
    mc.ctx.reset();
    r.draw(input({ time: 2, run: run({ patienceMs: 3000 }), derived: derived({ patienceProgress: 0.05 }) }));
    expect(fullScene()).toBeGreaterThan(calm);
    r.destroy();
  });
});

describe('full frame under the browser-shaped paths', () => {
  it('renders every phase and effect without throwing', () => {
    const { r } = mountSurfaces();
    r.handle({ t: 'report', promptIndex: 0, thumbs: 2, patienceLeft: 0.4 });
    r.handle({ t: 'incidentStart', id: 'wait_stop', tone: 'bad' });
    r.handle({ t: 'compactStart', forced: true, kept: 1, lost: 1 });
    for (let i = 0; i < 90; i++) {
      expect(() =>
        r.draw(
          input({
            time: i / 60,
            run: run({ promptIndex: i % 10, phase: i > 80 ? 'won' : i > 70 ? 'lost' : 'running' }),
            derived: derived({ contextFill: (i % 30) / 30 }),
          }),
        ),
      ).not.toThrow();
    }
    expect(r.renderStats().drawCalls).toBeGreaterThan(0);
    r.destroy();
  });
});
