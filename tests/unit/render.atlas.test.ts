/**
 * The atlas blit path. happy-dom has no image loader, so `Image` is stubbed
 * with one that resolves immediately — that switches the SpriteSystem from
 * procedural stand-ins to real sheet blits, which is what actually ships.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../../src/render/atlas.ts';
import { CLUTTER_SLOTS, LAPTOP_RECT, REQUIRED_SPRITES } from '../../src/render/atlas-types.ts';
import { SpriteSystem } from '../../src/render/sprites.ts';
import { createRenderer } from '../../src/render/index.ts';
import { DEV_RECT } from '../../src/render/layout.ts';
import type { RenderInput } from '../../src/sim/types.ts';
import { AGENT_TIER_IDS } from '../../src/sim/content.ts';
import { createMockCtx, makeCanvas, type MockCall } from './render.mock-ctx.ts';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 512;
  height = 512;
  private value = '';
  get src(): string {
    return this.value;
  }
  set src(v: string) {
    this.value = v;
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

function frame(over: Partial<RenderInput> = {}): RenderInput {
  const per = {} as Record<string, number>;
  for (const id of AGENT_TIER_IDS) per[id] = 1;
  return {
    run: {
      slop: 1,
      projectIndex: 1,
      timeLeftMs: 60_000,
      elapsedMs: 0,
      agents: per as RenderInput['run']['agents'],
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
      clickPower: 1,
      idleRate: 0,
      autoClickHz: 0,
      tierRates: per as RenderInput['derived']['tierRates'],
      nextCosts: per as RenderInput['derived']['nextCosts'],
      requirement: 100,
      shipProgress: 0,
      deadlineProgress: 1,
      canShip: false,
      shipBlockedBy: null,
      headroom: per as RenderInput['derived']['nextCosts'],
      etaSeconds: 1,
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
      reducedMotion: true, // keep the frame free of particle noise
      screenShake: false,
      showFps: false,
    },
    dt: 1 / 60,
    time: 0,
    ...over,
  };
}

/** Source rect of a 9-arg drawImage call. */
const srcRect = (c: MockCall): string => c.args.slice(1, 5).join(',');

describe('atlas contract', () => {
  it('the shipped manifest declares every required sprite with a real sheet', () => {
    for (const key of REQUIRED_SPRITES) {
      const def = manifest.sprites[key];
      expect(def, `atlas is missing ${key}`).toBeDefined();
      expect(def!.frames.length).toBeGreaterThan(0);
      expect(manifest.sheets[def!.sheet], `${key} points at unknown sheet`).toBeTruthy();
    }
  });

  it('the laptop has the three squash frames the renderer expects', () => {
    expect(manifest.sprites['laptop']!.frames).toHaveLength(3);
  });

  it('clutter art fits inside its slot', () => {
    for (const [key, slot] of Object.entries(CLUTTER_SLOTS)) {
      for (const f of manifest.sprites[key]?.frames ?? []) {
        expect(f.w, `${key} too wide`).toBeLessThanOrEqual(slot.maxW);
        expect(f.h, `${key} too tall`).toBeLessThanOrEqual(slot.maxH);
      }
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

  it('blits the frame rect declared in the manifest', async () => {
    const s = await loaded();
    const c = createMockCtx(document.createElement('canvas'));
    const drew = s.tryDraw(c as unknown as CanvasRenderingContext2D, 'clutter_duck', 118, 104);
    expect(drew).toBe(true);
    const call = c.ops('drawImage')[0]!;
    const f = manifest.sprites['clutter_duck']!.frames[0]!;
    expect(srcRect(call)).toBe([f.x, f.y, f.w, f.h].join(','));
    expect(call.args[5]).toBe(118);
    expect(call.args[6]).toBe(104);
    // Natural size, not stretched to the slot.
    expect(call.args[7]).toBe(f.w);
    expect(call.args[8]).toBe(f.h);
    s.destroy();
  });

  it('stretches only when asked — the full-scene backdrops', async () => {
    const s = await loaded();
    const c = createMockCtx(document.createElement('canvas'));
    s.tryDraw(c as unknown as CanvasRenderingContext2D, 'scene_orbital', 0, 0, {
      stretch: true,
      w: 320,
      h: 180,
    });
    const call = c.ops('drawImage')[0]!;
    expect(call.args[7]).toBe(320);
    expect(call.args[8]).toBe(180);
    s.destroy();
  });

  it('advances animation frames from fps and clamps out-of-range indices', async () => {
    const s = await loaded();
    const n = manifest.sprites['clutter_swarm']!.frames.length;
    const fps = manifest.sprites['clutter_swarm']!.fps ?? 8;
    expect(s.frameCount('clutter_swarm')).toBe(n);
    expect(s.frameIndex('clutter_swarm', 0)).toBe(0);
    expect(s.frameIndex('clutter_swarm', 1 / fps)).toBe(1 % n);
    expect(s.frameIndex('clutter_swarm', 1000)).toBeLessThan(n);
    expect(s.frameIndex('clutter_swarm', -5)).toBeGreaterThanOrEqual(0);

    const c = createMockCtx(document.createElement('canvas'));
    s.tryDraw(c as unknown as CanvasRenderingContext2D, 'laptop', 0, 0, { frame: 99 });
    s.tryDraw(c as unknown as CanvasRenderingContext2D, 'laptop', 0, 0, { frame: -3 });
    s.tryDraw(c as unknown as CanvasRenderingContext2D, 'laptop', 0, 0, { frame: Number.NaN });
    const frames = manifest.sprites['laptop']!.frames;
    const rects = c.ops('drawImage').map(srcRect);
    expect(rects[0]).toBe([frames[2]!.x, frames[2]!.y, frames[2]!.w, frames[2]!.h].join(','));
    expect(rects[1]).toBe([frames[0]!.x, frames[0]!.y, frames[0]!.w, frames[0]!.h].join(','));
    expect(rects[2]).toBe(rects[1]);
    s.destroy();
  });

  it('restores globalAlpha after an alpha-modulated blit', async () => {
    const s = await loaded();
    const c = createMockCtx(document.createElement('canvas'));
    c.globalAlpha = 0.75;
    s.tryDraw(c as unknown as CanvasRenderingContext2D, 'clutter_mug', 0, 0, { alpha: 0.4 });
    expect(c.globalAlpha).toBe(0.75);
    s.destroy();
  });
});

describe('renderer with loaded sheets', () => {
  it('draws the scene from the atlas and reports no missing art', async () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1,
      sheetTimeoutMs: 2000,
    });
    await r.whenReady();
    mc.ctx.reset();
    r.draw(frame());

    const stats = r.renderStats();
    expect(stats.missingSprites).toEqual([]);
    expect(stats.failedSheets).toEqual([]);

    const rects = mc.ctx.ops('drawImage').map(srcRect);
    // projectIndex 1 == the bedroom scene.
    const bed = manifest.sprites['scene_bedroom']!.frames[0]!;
    expect(rects).toContain([bed.x, bed.y, bed.w, bed.h].join(','));
    // Every tier owns one, so every clutter sprite is on screen.
    for (const key of Object.keys(CLUTTER_SLOTS)) {
      const f = manifest.sprites[key]!.frames[0]!;
      expect(rects.some((s) => s.startsWith(`${f.x},${f.y},`)), `${key} not blitted`).toBe(true);
    }
    r.destroy();
  });

  it('anchors the dev and laptop where the layout says', async () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1,
      sheetTimeoutMs: 2000,
    });
    await r.whenReady();
    mc.ctx.reset();
    r.draw(frame());

    const dests = mc.ctx.ops('drawImage').map((c) => `${String(c.args[5])},${String(c.args[6])}`);
    expect(dests).toContain(`${DEV_RECT.x},${DEV_RECT.y}`);
    expect(dests).toContain(`${LAPTOP_RECT.x},${LAPTOP_RECT.y}`);
    r.destroy();
  });

  it('plays the laptop squash on click and settles back to the rest frame', async () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1,
      sheetTimeoutMs: 2000,
    });
    await r.whenReady();
    const frames = manifest.sprites['laptop']!.frames;
    const laptopFrame = (): number => {
      const call = mc.ctx
        .ops('drawImage')
        .find((c) => c.args[5] === LAPTOP_RECT.x && c.args[6] === LAPTOP_RECT.y);
      const sx = Number(call?.args[1]);
      return frames.findIndex((f) => f.x === sx);
    };

    r.draw(frame({ time: 0 }));
    mc.ctx.reset();
    r.draw(frame({ time: 0.5 }));
    expect(laptopFrame()).toBe(0);

    r.handle({ t: 'click', amount: 1, x: 160, y: 118, crit: false, auto: false });
    mc.ctx.reset();
    r.draw(frame({ time: 1 }));
    expect(laptopFrame()).toBe(2); // fully squashed on the click frame

    mc.ctx.reset();
    r.draw(frame({ time: 1.06 }));
    expect(laptopFrame()).toBeLessThan(2); // easing back out

    mc.ctx.reset();
    r.draw(frame({ time: 1.4 }));
    expect(laptopFrame()).toBe(0); // settled
    r.destroy();
  });

  it('cross-fades between scenes when a location is bought', async () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1,
      sheetTimeoutMs: 2000,
    });
    await r.whenReady();
    const bed = manifest.sprites['scene_bedroom']!.frames[0]!;
    const cow = manifest.sprites['scene_coworking']!.frames[0]!;

    // The room follows what the player owns, not the project number.
    const f0 = frame({ time: 0 });
    r.draw({ ...f0, run: { ...f0.run, owned: [] } }); // bedroom

    mc.ctx.reset();
    const f1 = frame({ time: 0.02, dt: 0.02 });
    r.draw({ ...f1, run: { ...f1.run, owned: ['loc_coworking'] } }); // coworking
    const midFade = mc.ctx.ops('drawImage').map(srcRect);
    // Both backdrops are on screen during the fade.
    expect(midFade).toContain([bed.x, bed.y, bed.w, bed.h].join(','));
    expect(midFade).toContain([cow.x, cow.y, cow.w, cow.h].join(','));

    // Run the fade out; only the new scene remains.
    for (let i = 0; i < 60; i++) {
      const f = frame({ time: 0.02 + i / 60, dt: 1 / 60 });
      r.draw({ ...f, run: { ...f.run, owned: ['loc_coworking'] } });
    }
    mc.ctx.reset();
    const fEnd = frame({ time: 3 });
    r.draw({ ...fEnd, run: { ...fEnd.run, owned: ['loc_coworking'] } });
    const settled = mc.ctx.ops('drawImage').map(srcRect);
    expect(settled).toContain([cow.x, cow.y, cow.w, cow.h].join(','));
    expect(settled).not.toContain([bed.x, bed.y, bed.w, bed.h].join(','));
    r.destroy();
  });
});
