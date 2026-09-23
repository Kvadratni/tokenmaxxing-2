/**
 * The renderer has to be shippable before (or without) the art. This suite
 * mocks `src/render/atlas.ts` away entirely and asserts the stage still draws
 * something meaningful for every key, reports what it is missing, and never
 * throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/render/atlas.ts', () => ({ default: undefined }));

import { REQUIRED_SPRITES } from '../../src/render/atlas-types.ts';
import { SpriteSystem } from '../../src/render/sprites.ts';
import { hasFallback } from '../../src/render/fallback.ts';
import { PROMPTS } from '../../src/sim/content.ts';
import { createMockCtx } from './render.mock-ctx.ts';
import { derived, input, mount, run, tools } from './render.fixtures.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SpriteSystem with no atlas', () => {
  it('resolves to no manifest and reports every required key', async () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 5 });
    await s.ready;
    expect(s.loaded).toBe(false);
    expect(s.missingSprites()).toEqual([...REQUIRED_SPRITES].sort());
    expect(s.failedSheets()).toEqual([]);
    s.destroy();
  });

  it('has a procedural stand-in for every required key, and paints it', async () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 5 });
    await s.ready;
    for (const key of REQUIRED_SPRITES) {
      expect(hasFallback(key), `no stand-in for ${key}`).toBe(true);
      const c = createMockCtx(document.createElement('canvas'));
      expect(() => s.draw(c as unknown as CanvasRenderingContext2D, key, 0, 0, { w: 40, h: 40, timeS: 1 })).not.toThrow();
      expect(c.count('fillRect') + c.count('drawImage'), `nothing drawn for ${key}`).toBeGreaterThan(0);
    }
    s.destroy();
  });

  it('paints an unknown key as a loud box rather than nothing', async () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 5 });
    await s.ready;
    const c = createMockCtx(document.createElement('canvas'));
    s.draw(c as unknown as CanvasRenderingContext2D, 'mystery_sprite', 0, 0, { w: 8, h: 8 });
    expect(c.count('fillRect')).toBeGreaterThan(0);
    expect(c.ops('set:fillStyle').map((o) => o.args[0])).toContain('#9b6bd6');
    expect(s.frameCount('agent_idle')).toBe(1);
    expect(s.frameIndex('agent_idle', 12.5)).toBe(0);
    s.destroy();
  });
});

describe('renderer with no atlas', () => {
  it('reports the missing keys and still draws a meaningful stage', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    r.draw(input({ run: run({ tools: tools({ grep: 3, read: 2, subagent: 2, mcp_server: 1 }) }), derived: derived({ contextFill: 0.5, contextFloor: 800 }) }));
    expect(r.renderStats().missingSprites).toEqual([...REQUIRED_SPRITES].sort());
    expect(r.renderStats().failedSheets).toEqual([]);
    // Room, human, glass, pile, gadgets, agent, prompt line: lots of rects.
    expect(ctx.count('fillRect')).toBeGreaterThan(300);
    r.destroy();
  });

  it('stays playable through every prompt and scene', async () => {
    const { r } = mount();
    await r.whenReady();
    PROMPTS.forEach((p, i) => {
      expect(() =>
        r.draw(input({ time: i, run: run({ promptIndex: i, tools: tools({ grep: 20, rsi: 1 }) }), derived: derived({ scene: p.scene }) })),
      ).not.toThrow();
      expect(r.renderStats().sprites).toBeGreaterThan(5);
      expect(r.hitsAgent(160, 140)).toBe(true);
    });
    r.destroy();
  });
});
