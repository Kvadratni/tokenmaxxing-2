/**
 * The atlas path. happy-dom has no image loader, so `Image` is stubbed with one
 * that resolves at once: that switches the SpriteSystem from procedural
 * stand-ins to real sheet blits, which is what ships.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../../src/render/atlas.ts';
import {
  AGENT_BOX,
  GADGET_SPRITES,
  PICKUP_SPRITES,
  REQUIRED_SPRITES,
  ROOM_SPRITES,
  pickupSprite,
} from '../../src/render/atlas-types.ts';
import { SpriteSystem, rebaseSheetUrl } from '../../src/render/sprites.ts';
import { createRenderer } from '../../src/render/index.ts';
import { AGENT_ORIGIN } from '../../src/render/layout.ts';
import { PICKUPS, TOOLS } from '../../src/sim/content.ts';
import { createMockCtx, makeCanvas, type MockCall } from './render.mock-ctx.ts';
import { derived, input, play, run, settings, tools } from './render.fixtures.ts';

class FakeImage {
  static requested: string[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 512;
  height = 1024;
  private value = '';
  get src(): string {
    return this.value;
  }
  set src(v: string) {
    this.value = v;
    FakeImage.requested.push(v);
    setTimeout(() => this.onload?.(), 0);
  }
}

const OriginalImage = globalThis.Image;
beforeAll(() => {
  (globalThis as { Image: unknown }).Image = FakeImage;
});
afterAll(() => {
  (globalThis as { Image: unknown }).Image = OriginalImage;
});
afterEach(() => {
  document.body.innerHTML = '';
});

async function loaded(): Promise<SpriteSystem> {
  const s = new SpriteSystem({ sheetTimeoutMs: 2000 });
  await s.ready;
  return s;
}

/** Source rect of a 9-arg drawImage call. */
const srcRect = (c: MockCall): string => c.args.slice(1, 5).join(',');
const rectOf = (key: string, i = 0): string => {
  const f = manifest.sprites[key]!.frames[i]!;
  return [f.x, f.y, f.w, f.h].join(',');
};

describe('atlas contract', () => {
  it('declares every required sprite, on a real sheet', () => {
    for (const key of REQUIRED_SPRITES) {
      const def = manifest.sprites[key];
      expect(def, `atlas is missing ${key}`).toBeDefined();
      expect(def!.frames.length).toBeGreaterThan(0);
      expect(manifest.sheets[def!.sheet], `${key} points at an unknown sheet`).toBeTruthy();
    }
    expect(Object.keys(manifest.sprites).sort()).toEqual([...REQUIRED_SPRITES].sort());
  });

  it('ships the sheets it names', () => {
    for (const url of Object.values(manifest.sheets)) {
      // The bundler rewrites the URL (public/ is served from the root); the
      // file itself lives under public/sprites.
      const name = /sprites\/([\w-]+\.png)/.exec(url)?.[1];
      expect(name, url).toBeDefined();
      expect(existsSync(resolve(process.cwd(), 'public/sprites', name!)), url).toBe(true);
    }
  });

  it('has a gadget, and a greyed twin, for every tool in content', () => {
    for (const t of TOOLS) {
      expect(manifest.sprites[t.gadget], t.gadget).toBeDefined();
      expect(manifest.sprites[`${t.gadget}_off`], `${t.gadget}_off`).toBeDefined();
    }
    expect(GADGET_SPRITES).toHaveLength(TOOLS.length * 2);
  });

  it('has art for every pickup shape and accent in content', () => {
    for (const p of PICKUPS) expect(manifest.sprites[pickupSprite(p.shape, p.accent)], p.id).toBeDefined();
    expect(PICKUP_SPRITES.length).toBeGreaterThan(0);
  });

  it('rooms are whole 320x180 scenes', () => {
    for (const key of ROOM_SPRITES) {
      const f = manifest.sprites[key]!.frames[0]!;
      expect([f.w, f.h]).toEqual([320, 180]);
    }
  });

  it('every agent frame shares one box, so states swap without jumping', () => {
    for (const key of REQUIRED_SPRITES.filter((k) => k.startsWith('agent_') && k !== 'agent_mini' && k !== 'agent_team')) {
      for (const f of manifest.sprites[key]!.frames) expect([f.w, f.h], key).toEqual([AGENT_BOX.w, AGENT_BOX.h]);
    }
  });

  it('human layers carry their scene-space origin', () => {
    for (const key of REQUIRED_SPRITES.filter((k) => k.startsWith('human_'))) {
      const f = manifest.sprites[key]!.frames[0]!;
      expect(f.ox ?? 0, key).toBeGreaterThanOrEqual(0);
      expect((f.ox ?? 0) + f.w, key).toBeLessThanOrEqual(320);
    }
    // Four moods, three frames each: open, blink, looking down.
    for (const mood of ['tired', 'impatient', 'furious', 'suspicious']) {
      expect(manifest.sprites[`human_eyes_${mood}`]!.frames).toHaveLength(3);
    }
  });

  it('multi-frame sprites declare a frame rate and share a size', () => {
    for (const [key, def] of Object.entries(manifest.sprites)) {
      if (def.frames.length < 2) continue;
      expect(def.fps, key).toBeGreaterThan(0);
      const { w, h } = def.frames[0]!;
      for (const f of def.frames) expect([f.w, f.h], key).toEqual([w, h]);
    }
  });
});

describe('SpriteSystem with loaded sheets', () => {
  it('reports a clean bill of health', async () => {
    const s = await loaded();
    expect(s.loaded).toBe(true);
    expect(s.missingSprites()).toEqual([]);
    expect(s.failedSheets()).toEqual([]);
    s.destroy();
  });

  it('blits the declared frame rect, offset by its scene-space origin', async () => {
    const s = await loaded();
    const c = createMockCtx(document.createElement('canvas'));
    expect(s.tryDraw(c as unknown as CanvasRenderingContext2D, 'human_body', 0, 0)).toBe(true);
    const call = c.ops('drawImage')[0]!;
    const f = manifest.sprites['human_body']!.frames[0]!;
    expect(srcRect(call)).toBe(rectOf('human_body'));
    expect(call.args[5]).toBe(f.ox ?? 0);
    expect(call.args[6]).toBe(f.oy ?? 0);
    s.destroy();
  });

  it('fetches the sheets from atlasBase when one is given', async () => {
    expect(rebaseSheetUrl('http://x/assets/stage-1a2b.png?v=3', '/sprites')).toBe('/sprites/stage-1a2b.png');
    expect(rebaseSheetUrl('http://x/stage.png', undefined)).toBe('http://x/stage.png');
    FakeImage.requested = [];
    const s = new SpriteSystem({ sheetTimeoutMs: 2000, atlasBase: '/sprites/' });
    await s.ready;
    expect(FakeImage.requested.length).toBe(Object.keys(manifest.sheets).length);
    for (const src of FakeImage.requested) expect(src).toMatch(/^\/sprites\/[\w-]+\.png$/);
    expect(s.missingSprites()).toEqual([]);
    s.destroy();
  });

  it('picks variant frames explicitly and clamps out-of-range ones', async () => {
    const s = await loaded();
    const c = createMockCtx(document.createElement('canvas'));
    const ctx = c as unknown as CanvasRenderingContext2D;
    s.tryDraw(ctx, 'token', 0, 0, { frame: 2 });
    s.tryDraw(ctx, 'token', 0, 0, { frame: 99 });
    s.tryDraw(ctx, 'token', 0, 0, { frame: Number.NaN });
    const rects = c.ops('drawImage').map(srcRect);
    const n = manifest.sprites['token']!.frames.length;
    expect(rects[0]).toBe(rectOf('token', 2));
    expect(rects[1]).toBe(rectOf('token', n - 1));
    expect(rects[2]).toBe(rectOf('token', 0));
    s.destroy();
  });
});

describe('renderer with loaded sheets', () => {
  function mountLoaded(): { r: ReturnType<typeof createRenderer>; mc: ReturnType<typeof makeCanvas> } {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 1280, h: 720 }), dpr: () => 1, sheetTimeoutMs: 2000 });
    return { r, mc };
  }

  it('draws the room for derived.scene, the human, and the agent at its origin', async () => {
    const { r, mc } = mountLoaded();
    await r.whenReady();
    mc.ctx.reset();
    r.draw(input({ derived: derived({ scene: 'datacenter' }) }));
    const rects = mc.ctx.ops('drawImage').map(srcRect);
    expect(rects).toContain(rectOf('room_datacenter'));
    expect(rects).toContain(rectOf('human_body'));
    const agentCall = mc.ctx.ops('drawImage').find((c) => c.args[5] === AGENT_ORIGIN.x && c.args[6] === AGENT_ORIGIN.y);
    expect(agentCall, 'agent not drawn at AGENT_ORIGIN').toBeDefined();
    expect(r.renderStats().missingSprites).toEqual([]);
    expect(r.renderStats().failedSheets).toEqual([]);
    r.destroy();
  });

  it('blits a gadget per owned tool, greyed out when halted', async () => {
    const { r, mc } = mountLoaded();
    await r.whenReady();
    mc.ctx.reset();
    const halted = { ...derived().toolHalted, bash: true };
    r.draw(input({ run: run({ tools: tools({ grep: 1, bash: 1 }) }), derived: derived({ toolHalted: halted }) }));
    const rects = mc.ctx.ops('drawImage').map(srcRect);
    const hit = (key: string): boolean => manifest.sprites[key]!.frames.some((_, i) => rects.includes(rectOf(key, i)));
    expect(hit('gadget_grep')).toBe(true);
    expect(hit('gadget_bash_off')).toBe(true);
    expect(hit('gadget_bash')).toBe(false);
    expect(hit('gadget_read')).toBe(false);
    r.destroy();
  });

  it('cross-fades the room when the scene changes', async () => {
    const { r, mc } = mountLoaded();
    await r.whenReady();
    r.draw(input({ time: 0, derived: derived({ scene: 'bedroom' }) }));
    mc.ctx.reset();
    r.draw(input({ time: 0.02, dt: 0.02, derived: derived({ scene: 'coworking' }) }));
    const mid = mc.ctx.ops('drawImage').map(srcRect);
    expect(mid).toContain(rectOf('room_bedroom'));
    expect(mid).toContain(rectOf('room_coworking'));
    play(r, 0.04, 2, (t) => input({ time: t, derived: derived({ scene: 'coworking' }) }));
    mc.ctx.reset();
    r.draw(input({ time: 2.02, derived: derived({ scene: 'coworking' }) }));
    const settled = mc.ctx.ops('drawImage').map(srcRect);
    expect(settled).toContain(rectOf('room_coworking'));
    expect(settled).not.toContain(rectOf('room_bedroom'));
    r.destroy();
  });

  it('draws the compaction walls from the atlas', async () => {
    const { r, mc } = mountLoaded();
    await r.whenReady();
    r.draw(input({ time: 1, derived: derived({ contextFill: 1 }), settings: settings({ screenShake: false }) }));
    r.handle({ t: 'compactStart', forced: true, kept: 1, lost: 1 });
    play(r, 1.02, 1.4, (t) => input({ time: t, run: run({ context: 400 }), derived: derived({ contextFill: 0.05 }) }));
    mc.ctx.reset();
    r.draw(input({ time: 1.42, run: run({ context: 400 }), derived: derived({ contextFill: 0.05 }) }));
    const rects = mc.ctx.ops('drawImage').map(srcRect);
    expect(rects).toContain(rectOf('wall_left'));
    expect(rects).toContain(rectOf('wall_right'));
    expect(rects).toContain(rectOf('scroll_summary'));
    r.destroy();
  });
});
