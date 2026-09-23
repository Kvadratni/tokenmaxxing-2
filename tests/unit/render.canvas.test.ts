import { afterEach, describe, expect, it } from 'vitest';
import { MAX_DPR, computeScale } from '../../src/render/canvas.ts';
import { createRenderer } from '../../src/render/index.ts';
import { AGENT_RECT } from '../../src/render/atlas-types.ts';
import { SCENE_HEIGHT, SCENE_WIDTH } from '../../src/sim/types.ts';
import { makeCanvas } from './render.mock-ctx.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('computeScale — integer scaling', () => {
  interface Row {
    readonly name: string;
    readonly w: number;
    readonly h: number;
    readonly dpr: number;
    readonly scale: number;
    readonly backingW: number;
    readonly backingH: number;
  }

  const table: readonly Row[] = [
    { name: 'exact fit', w: 320, h: 180, dpr: 1, scale: 1, backingW: 320, backingH: 180 },
    { name: '720p @1x', w: 1280, h: 720, dpr: 1, scale: 4, backingW: 1280, backingH: 720 },
    { name: '720p @2x', w: 1280, h: 720, dpr: 2, scale: 4, backingW: 2560, backingH: 1440 },
    { name: '720p @3x', w: 1280, h: 720, dpr: 3, scale: 4, backingW: 3840, backingH: 2160 },
    { name: 'height bound', w: 1920, h: 400, dpr: 1, scale: 2, backingW: 640, backingH: 360 },
    { name: 'ultrawide', w: 3440, h: 1440, dpr: 1, scale: 8, backingW: 2560, backingH: 1440 },
    { name: 'super ultrawide', w: 5120, h: 1440, dpr: 2, scale: 8, backingW: 5120, backingH: 2880 },
    { name: 'off-grid 1000x1000', w: 1000, h: 1000, dpr: 2, scale: 3, backingW: 1920, backingH: 1080 },
    // Sub-scene sizes must clamp to 1, never 0.
    { name: 'sub-320 width', w: 200, h: 400, dpr: 1, scale: 1, backingW: 320, backingH: 180 },
    { name: 'sub-180 height', w: 900, h: 100, dpr: 1, scale: 1, backingW: 320, backingH: 180 },
    { name: 'tiny', w: 1, h: 1, dpr: 1, scale: 1, backingW: 320, backingH: 180 },
    { name: 'zero', w: 0, h: 0, dpr: 1, scale: 1, backingW: 320, backingH: 180 },
    { name: 'phone portrait', w: 390, h: 844, dpr: 3, scale: 1, backingW: 960, backingH: 540 },
  ];

  for (const row of table) {
    it(`${row.name}: ${row.w}x${row.h} @${row.dpr}x -> scale ${row.scale}`, () => {
      const r = computeScale(row.w, row.h, row.dpr);
      expect(r.scale).toBe(row.scale);
      expect(r.cssW).toBe(SCENE_WIDTH * row.scale);
      expect(r.cssH).toBe(SCENE_HEIGHT * row.scale);
      expect(r.backingW).toBe(row.backingW);
      expect(r.backingH).toBe(row.backingH);
      expect(r.pixelScale).toBe(row.scale * Math.min(MAX_DPR, row.dpr));
    });
  }

  it('never produces a fractional or zero scale', () => {
    for (let w = 0; w <= 4000; w += 17) {
      for (let h = 0; h <= 2200; h += 23) {
        const r = computeScale(w, h, 1);
        expect(Number.isInteger(r.scale)).toBe(true);
        expect(r.scale).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('clamps absurd and invalid device pixel ratios', () => {
    expect(computeScale(1280, 720, 10).dpr).toBe(MAX_DPR);
    expect(computeScale(1280, 720, 0).dpr).toBe(1);
    expect(computeScale(1280, 720, -3).dpr).toBe(1);
    expect(computeScale(1280, 720, Number.NaN).dpr).toBe(1);
    expect(computeScale(Number.NaN, Number.NaN, Number.NaN).scale).toBe(1);
    expect(computeScale(Infinity, Infinity, 1).scale).toBeGreaterThanOrEqual(1);
  });

  it('backing size is always an integer number of device pixels', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.5, 3, 4]) {
      for (const scale of [1, 2, 3, 5, 8]) {
        const r = computeScale(SCENE_WIDTH * scale, SCENE_HEIGHT * scale, dpr);
        expect(Number.isInteger(r.backingW)).toBe(true);
        expect(Number.isInteger(r.backingH)).toBe(true);
      }
    }
  });
});

describe('resize applies the computed geometry to the element', () => {
  it('sets backing store and CSS size independently', () => {
    const { canvas } = makeCanvas();
    const r = createRenderer(canvas, { measure: () => ({ w: 1000, h: 1000 }), dpr: () => 2, sheetTimeoutMs: 5, });
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(canvas.style.width).toBe('960px');
    expect(canvas.style.height).toBe('540px');
    expect(canvas.style.imageRendering).toBe('pixelated');
    expect(r.metrics().scale).toBe(3);
    r.destroy();
  });

  it('re-fits when the host changes size', () => {
    const { canvas } = makeCanvas();
    let w = 640;
    const r = createRenderer(canvas, { measure: () => ({ w, h: 4000 }), dpr: () => 1, sheetTimeoutMs: 5, });
    expect(r.metrics().scale).toBe(2);
    w = 1600;
    r.resize();
    expect(r.metrics().scale).toBe(5);
    expect(canvas.width).toBe(1600);
    r.destroy();
  });
});

describe('toScene / hitsAgent', () => {
  const cx = AGENT_RECT.x + AGENT_RECT.w / 2;
  const cy = AGENT_RECT.y + AGENT_RECT.h / 2;

  for (const scale of [1, 2, 3, 4, 6]) {
    it(`round-trips the agent's centre at scale ${scale}`, () => {
      const { canvas } = makeCanvas({ left: 37, top: 11 });
      const r = createRenderer(canvas, {
        measure: () => ({ w: SCENE_WIDTH * scale, h: SCENE_HEIGHT * scale }),
        dpr: () => 1, sheetTimeoutMs: 5,
      });
      expect(r.metrics().scale).toBe(scale);

      const p = r.toScene(37 + cx * scale, 11 + cy * scale);
      expect(p.x).toBeCloseTo(cx, 6);
      expect(p.y).toBeCloseTo(cy, 6);
      expect(r.hitsAgent(p.x, p.y)).toBe(true);
      r.destroy();
    });
  }

  it('misses just outside every edge of the rect', () => {
    const { canvas } = makeCanvas();
    const r = createRenderer(canvas, { measure: () => ({ w: 1280, h: 720 }), dpr: () => 1, sheetTimeoutMs: 5, });
    const { x, y, w, h } = AGENT_RECT;

    expect(r.hitsAgent(x, y)).toBe(true);
    expect(r.hitsAgent(x + w - 0.01, y + h - 0.01)).toBe(true);

    expect(r.hitsAgent(x - 0.5, cy)).toBe(false);
    expect(r.hitsAgent(x + w, cy)).toBe(false);
    expect(r.hitsAgent(x + w + 0.5, cy)).toBe(false);
    expect(r.hitsAgent(cx, y - 0.5)).toBe(false);
    expect(r.hitsAgent(cx, y + h)).toBe(false);
    expect(r.hitsAgent(-1000, -1000)).toBe(false);
    expect(r.hitsAgent(Number.NaN, Number.NaN)).toBe(false);
    r.destroy();
  });

  it('accounts for the canvas offset in the page', () => {
    const { canvas } = makeCanvas({ left: 120, top: 64 });
    const r = createRenderer(canvas, { measure: () => ({ w: 640, h: 360 }), dpr: () => 1, sheetTimeoutMs: 5, });
    // scale 2, origin (120, 64)
    expect(r.toScene(120, 64)).toEqual({ x: 0, y: 0 });
    expect(r.toScene(120 + 200, 64 + 100)).toEqual({ x: 100, y: 50 });
    r.destroy();
  });
});
