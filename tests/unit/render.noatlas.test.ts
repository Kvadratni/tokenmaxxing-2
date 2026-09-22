/**
 * The renderer has to be shippable before the art is. This suite mocks
 * `src/render/atlas.ts` away entirely and asserts the game still draws, still
 * reports what it is missing, and never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/render/atlas.ts', () => ({ default: undefined }));

import { REQUIRED_SPRITES } from '../../src/render/atlas-types.ts';
import { SpriteSystem } from '../../src/render/sprites.ts';
import { createRenderer } from '../../src/render/index.ts';
import type { RenderInput } from '../../src/sim/types.ts';
import { AGENT_TIER_IDS } from '../../src/sim/content.ts';
import { createMockCtx, makeCanvas } from './render.mock-ctx.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

function frame(agentCount: number, over: Partial<RenderInput> = {}): RenderInput {
  const perTier = {} as Record<string, number>;
  for (const id of AGENT_TIER_IDS) perTier[id] = agentCount;
  return {
    run: {
      slop: 1,
      projectIndex: 2,
      timeLeftMs: 30_000,
      elapsedMs: 0,
      agents: perTier as RenderInput['run']['agents'],
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
      idleRate: 100,
      autoClickHz: 0,
      tierRates: perTier as RenderInput['derived']['tierRates'],
      nextCosts: perTier as RenderInput['derived']['nextCosts'],
      requirement: 100,
      shipProgress: 0.2,
      deadlineProgress: 0.5,
      canShip: false,
      shipBlockedBy: null,
      headroom: {} as never,
      etaSeconds: 5,
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

describe('SpriteSystem with no atlas', () => {
  it('resolves to no manifest and reports every required key', async () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 5 });
    await s.ready;
    expect(s.loaded).toBe(false);
    expect(s.missingSprites()).toEqual([...REQUIRED_SPRITES].sort());
    expect(s.failedSheets()).toEqual([]);
    s.destroy();
  });

  it('still paints something for every required key', async () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 5 });
    await s.ready;
    for (const key of REQUIRED_SPRITES) {
      const c = createMockCtx(document.createElement('canvas'));
      expect(() => s.draw(c as unknown as CanvasRenderingContext2D, key, 10, 10, {
        w: 40,
        h: 40,
        timeS: 1,
      })).not.toThrow();
      expect(c.count('fillRect'), `nothing drawn for ${key}`).toBeGreaterThan(0);
    }
    s.destroy();
  });

  it('records unknown keys as missing on first request', async () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 5 });
    await s.ready;
    const c = createMockCtx(document.createElement('canvas'));
    s.draw(c as unknown as CanvasRenderingContext2D, 'clutter_nonsense', 0, 0, { w: 8, h: 8 });
    // With no manifest at all we cannot distinguish "typo" from "not built yet",
    // so the required-key seed is the whole story.
    expect(s.missingSprites()).toEqual([...REQUIRED_SPRITES].sort());
    s.destroy();
  });

  it('frameIndex and frameCount degrade to a single static frame', async () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 5 });
    await s.ready;
    expect(s.frameCount('laptop')).toBe(1);
    expect(s.frameIndex('laptop', 12.5)).toBe(0);
    expect(s.frameIndex('nope', -3)).toBe(0);
    s.destroy();
  });
});

describe('renderer with no atlas', () => {
  it('renderStats().missingSprites lists the expected keys and draw() completes', async () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 1280, h: 720 }),
      dpr: () => 1,
      sheetTimeoutMs: 5,
    });
    await r.whenReady();

    expect(() => r.draw(frame(3))).not.toThrow();
    expect(r.renderStats().missingSprites).toEqual([...REQUIRED_SPRITES].sort());
    expect(r.renderStats().failedSheets).toEqual([]);
    // A meaningful screenshot: backdrop, desk, clutter, dev, laptop, HUD.
    expect(mc.ctx.count('fillRect')).toBeGreaterThan(300);
    r.destroy();
  });

  it('remains playable across every scene with no art at all', async () => {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, {
      measure: () => ({ w: 960, h: 540 }),
      dpr: () => 1,
      sheetTimeoutMs: 5,
    });
    await r.whenReady();
    for (let i = 0; i < 10; i++) {
      const f = frame(20, { time: i });
      expect(() =>
        r.draw({ ...f, run: { ...f.run, projectIndex: i } }),
      ).not.toThrow();
      expect(r.renderStats().sprites).toBeGreaterThan(10);
    }
    r.destroy();
  });
});
