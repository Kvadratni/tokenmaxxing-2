/**
 * The token pile IS the context bar: its height tracks derived.contextFill,
 * and at 100% it reaches the top of the glass. derived.contextFloor is a
 * separate flat layer of manuals under it.
 */
import { describe, expect, it } from 'vitest';
import {
  floorHeight,
  paintPile,
  pileHeightAt,
  pilePeak,
  pileProfile,
  pileTopY,
} from '../../src/render/pile.ts';
import { FLOOR_Y, GLASS, PILE_MAX_H } from '../../src/render/layout.ts';
import { SpriteSystem } from '../../src/render/sprites.ts';
import { derived, input, mount, play, run } from './render.fixtures.ts';
import { createMockCtx } from './render.mock-ctx.ts';

describe('pile geometry', () => {
  it('is empty at 0% and reaches exactly the top of the glass at 100%', () => {
    expect(pilePeak(0)).toBe(0);
    expect(pileTopY(0)).toBe(FLOOR_Y);
    expect(pilePeak(1)).toBe(PILE_MAX_H);
    expect(pileTopY(1)).toBe(GLASS.y);
  });

  it('the peak height is proportional to contextFill', () => {
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(pilePeak(f)).toBeCloseTo(f * PILE_MAX_H, 6);
      expect(pileTopY(f)).toBeCloseTo(FLOOR_Y - f * PILE_MAX_H, 6);
    }
  });

  it('rises monotonically with fill at every column', () => {
    for (let x = GLASS.x; x < GLASS.x + GLASS.w; x += 11) {
      let prev = -1;
      for (let f = 0; f <= 1.0001; f += 0.02) {
        const h = pileHeightAt(f, x);
        expect(h, `column ${x} at ${f.toFixed(2)}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = h;
      }
    }
  });

  it('is heaped higher on the left, as in the concept', () => {
    const left = pileHeightAt(0.5, GLASS.x + 4);
    const middle = pileHeightAt(0.5, GLASS.x + GLASS.w * 0.55);
    const right = pileHeightAt(0.5, GLASS.x + GLASS.w - 4);
    expect(left).toBeGreaterThan(middle);
    expect(left).toBeGreaterThan(right);
    expect(pileProfile(0)).toBe(1);
    expect(pileProfile(0.55)).toBeLessThan(0.7);
  });

  it('fills the glass edge to edge at 100%, never overflowing it', () => {
    for (let x = GLASS.x; x < GLASS.x + GLASS.w; x += 7) {
      expect(pileHeightAt(1, x)).toBeCloseTo(PILE_MAX_H, 6);
      expect(pileHeightAt(1.7, x)).toBeLessThanOrEqual(PILE_MAX_H);
    }
  });

  it('tolerates garbage input', () => {
    expect(pilePeak(Number.NaN)).toBe(0);
    expect(pilePeak(-3)).toBe(0);
    expect(pileTopY(9)).toBe(GLASS.y);
    expect(Number.isFinite(pileHeightAt(Number.NaN, Number.NaN))).toBe(true);
  });

  it('draws the context floor as a flat stack of whole books', () => {
    expect(floorHeight(0)).toBe(0);
    expect(floorHeight(0.001)).toBe(5);
    expect(floorHeight(0.2) % 5).toBe(0);
    expect(floorHeight(0.2)).toBeCloseTo(0.2 * PILE_MAX_H, -1);
    // The pile never dips below the manuals it sits on.
    for (let x = GLASS.x; x < GLASS.x + GLASS.w; x += 13) {
      expect(pileHeightAt(0.2, x, 0.2)).toBeGreaterThanOrEqual(floorHeight(0.2));
    }
  });
});

describe('pile painting', () => {
  function paint(fill: number, floor = 0): { tokens: number; books: number; manualCalls: number } {
    const s = new SpriteSystem({ sheetTimeoutMs: 1 });
    const c = createMockCtx(document.createElement('canvas'));
    const stats = { tokens: 0, books: 0 };
    paintPile(c as unknown as CanvasRenderingContext2D, s, fill, floor, stats);
    s.destroy();
    return { ...stats, manualCalls: c.count('fillRect') };
  }

  it('paints more tokens the fuller the window', () => {
    const counts = [0, 0.1, 0.4, 0.8, 1].map((f) => paint(f).tokens);
    expect(counts[0]).toBe(0);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
  });

  it('paints manuals only when there is a context floor', () => {
    expect(paint(0.4, 0).books).toBe(0);
    expect(paint(0.4, 0.15).books).toBeGreaterThan(0);
  });
});

describe('the renderer draws the pile at contextFill', () => {
  it('settles on the derived fill and reports it', async () => {
    const { r } = mount();
    await r.whenReady();
    for (const fill of [0.1, 0.55, 0.92]) {
      play(r, 0, 2, (t) => input({ derived: derived({ contextFill: fill }), time: 10 * fill + t }));
      const s = r.renderStats().stage;
      expect(s.pileFill).toBeCloseTo(fill, 2);
      expect(s.pileTopY).toBeCloseTo(pileTopY(fill), 0);
    }
    r.destroy();
  });

  it('eases toward a new fill rather than jumping', async () => {
    const { r } = mount();
    await r.whenReady();
    play(r, 0, 1, (t) => input({ derived: derived({ contextFill: 0.2 }), time: t }));
    r.draw(input({ derived: derived({ contextFill: 0.8 }), time: 1.02, dt: 1 / 60 }));
    const mid = r.renderStats().stage.pileFill;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    r.destroy();
  });

  it('snaps on the very first frame', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ run: run(), derived: derived({ contextFill: 0.6 }) }));
    expect(r.renderStats().stage.pileFill).toBeCloseTo(0.6, 6);
    r.destroy();
  });
});
