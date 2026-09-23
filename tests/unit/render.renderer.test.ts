/**
 * The renderer as a whole: never throws, reads only its input, reports its
 * stats, respects reduced motion and screen shake, and cleans up after itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_SPRITES } from '../../src/render/atlas-types.ts';
import { createRenderer, type SceneRenderer } from '../../src/render/index.ts';
import type { GameEvent, RunPhase } from '../../src/sim/types.ts';
import { PROMPTS } from '../../src/sim/content.ts';
import { SpyResizeObserver, makeCanvas } from './render.mock-ctx.ts';
import { ALL_EVENTS, derived, incident, input, mount, play, run, settings, tools } from './render.fixtures.ts';

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

describe('headless safety', () => {
  it('does not throw when getContext returns null, and stays clickable', () => {
    const { r } = mount({ noContext: true });
    expect(() => r.draw(input())).not.toThrow();
    for (const e of ALL_EVENTS) expect(() => r.handle(e)).not.toThrow();
    expect(() => r.draw(input({ time: 2 }))).not.toThrow();
    expect(() => r.resize()).not.toThrow();
    expect(r.metrics().scale).toBe(4);
    expect(r.hitsAgent(160, 140)).toBe(true);
    r.destroy();
  });
});

describe('draw()', () => {
  it('renders a full frame from procedural art, balanced save/restore', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    expect(() => r.draw(input({ run: run({ tools: tools({ grep: 2, bash: 1 }) }) }))).not.toThrow();
    expect(ctx.count('fillRect')).toBeGreaterThan(100);
    expect(ctx.count('restore')).toBe(ctx.count('save'));
    expect(ctx.count('setTransform')).toBeGreaterThan(0);
    r.destroy();
  });

  it('reports no missing sprites in a normal frame: the atlas declares every key', async () => {
    const { r } = mount();
    await r.whenReady();
    play(r, 0, 1, (t) =>
      input({
        time: t,
        run: run({ tools: tools({ grep: 3, read: 2, edit: 1, bash: 1, subagent: 2, mcp_server: 1 }), pickup: { id: 'rubber_duck', x: 80, y: 60, vx: 10, baseY: 60, ageS: 1, remainingMs: 4000 } }),
        derived: derived({ contextFill: 0.5, contextFloor: 800 }),
      }),
    );
    expect(r.renderStats().missingSprites).toEqual([]);
    r.destroy();
  });

  it('seeds every required key as missing until the atlas resolves', () => {
    const { r } = mount();
    const missing = r.renderStats().missingSprites;
    for (const key of REQUIRED_SPRITES) expect(missing).toContain(key);
    expect(() => r.draw(input())).not.toThrow();
    r.destroy();
  });

  it('falls back to procedural art when the sheets cannot be decoded', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    expect(r.renderStats().failedSheets.length).toBeGreaterThan(0);
    r.draw(input({ run: run({ tools: tools({ grep: 2 }) }) }));
    expect(ctx.count('fillRect')).toBeGreaterThan(100);
    r.destroy();
  });

  it('survives every prompt, phase and scene', async () => {
    const { r } = mount();
    await r.whenReady();
    const phases: RunPhase[] = ['running', 'compacting', 'drafting', 'reported', 'won', 'lost'];
    for (let i = 0; i < PROMPTS.length + 4; i++) {
      for (const phase of phases) {
        const scene = PROMPTS[Math.min(i, PROMPTS.length - 1)]!.scene;
        expect(() =>
          r.draw(input({ run: run({ promptIndex: i, phase, tools: tools({ grep: 3, rsi: 1 }) }), derived: derived({ scene }), time: i + 0.1 })),
        ).not.toThrow();
      }
    }
    r.destroy();
  });

  it('draws a gadget for each owned tool, and more sprites for more tools', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ time: 1, derived: derived({ contextFill: 0 }) }));
    const none = r.renderStats().sprites;
    r.draw(input({ time: 2, run: run({ tools: tools({ grep: 1, read: 1, edit: 1, bash: 1, web_search: 1 }) }), derived: derived({ contextFill: 0 }) }));
    const five = r.renderStats().sprites;
    expect(five - none).toBe(5);
    r.destroy();
  });

  it('never reads getBoundingClientRect inside draw()', async () => {
    const { r, rectReads } = mount();
    await r.whenReady();
    r.draw(input());
    const before = rectReads();
    for (let i = 0; i < 30; i++) r.draw(input({ time: 1 + i / 60 }));
    expect(rectReads()).toBe(before);
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
      r.draw(input({ derived: derived({ contextFill: Number.NaN, patienceProgress: -4, contextMax: 0, contextFloor: 1e12 }) })),
    ).not.toThrow();
    expect(() => r.draw(input({ run: run({ patienceMs: 0, phase: 'lost', tools: tools({ subagent: 10_000 }) }), time: 5 }))).not.toThrow();
    r.destroy();
  });

  it('never mutates the run or the derived stats it is given', async () => {
    const { r } = mount();
    await r.whenReady();
    const i = input({ run: run({ tools: tools({ grep: 4 }), incidents: [incident('lunch')] }), derived: derived({ contextFill: 0.7 }) });
    const snapshot = JSON.stringify(i);
    Object.freeze(i.run);
    Object.freeze(i.derived);
    for (const e of ALL_EVENTS) r.handle(e);
    play(r, 1, 2, (t) => ({ ...i, time: t }));
    expect(JSON.stringify(i)).toBe(snapshot);
    r.destroy();
  });

  it('draws the perf HUD only when showFps is on', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    r.draw(input({ settings: settings({ showFps: false }) }));
    const off = ctx.count('fillRect');
    ctx.reset();
    r.draw(input({ settings: settings({ showFps: true }), time: 1.02 }));
    expect(ctx.count('fillRect')).toBeGreaterThan(off);
    r.destroy();
  });

  it('reports live stats', async () => {
    const { r } = mount();
    await r.whenReady();
    r.handle({ t: 'report', promptIndex: 0, thumbs: 1, patienceLeft: 0.5 });
    r.draw(input());
    const s = r.renderStats();
    expect(s.particles).toBeGreaterThan(100);
    expect(s.sprites).toBeGreaterThan(0);
    expect(s.drawCalls).toBeGreaterThan(0);
    expect(s.fps).toBeGreaterThan(0);
    expect(s.stage.agent).toBe('idle');
    r.destroy();
  });
});

describe('handle()', () => {
  it('accepts every GameEvent variant without throwing', async () => {
    const { r } = mount();
    await r.whenReady();
    let t = 1;
    for (const e of ALL_EVENTS) {
      expect(() => r.handle(e), `handle failed for ${e.t}`).not.toThrow();
      t += 0.05;
      expect(() => r.draw(input({ time: t }))).not.toThrow();
    }
    r.destroy();
  });

  it('never mutates the event it is given', async () => {
    const { r } = mount();
    await r.whenReady();
    const snapshots = ALL_EVENTS.map((e) => JSON.stringify(e));
    for (const e of ALL_EVENTS) r.handle(Object.freeze({ ...e }) as GameEvent);
    r.draw(input());
    ALL_EVENTS.forEach((e, i) => expect(JSON.stringify(e)).toBe(snapshots[i]));
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

  it('bounds the queue so an undrawn renderer cannot leak', async () => {
    const { r } = mount();
    await r.whenReady();
    for (let i = 0; i < 5000; i++) r.handle({ t: 'denied', reason: 'cost' });
    expect(() => r.draw(input())).not.toThrow();
    r.destroy();
  });
});

describe('reduced motion and screen shake', () => {
  function burst(reducedMotion: boolean, screenShake = true): { particles: number; translates: number; glitch: number } {
    const mc = makeCanvas();
    const r = createRenderer(mc.canvas, { measure: () => ({ w: 1280, h: 720 }), dpr: () => 1, sheetTimeoutMs: 5 });
    const s = settings({ reducedMotion, screenShake });
    r.handle({ t: 'report', promptIndex: 0, thumbs: 1, patienceLeft: 0.4 });
    r.handle({ t: 'incidentStart', id: 'wait_stop', tone: 'bad' });
    r.handle({ t: 'click', amount: 50, x: 160, y: 140, crit: true, auto: false });
    r.draw(input({ settings: s, time: 0 }));
    const particles = r.renderStats().particles;
    let translates = 0;
    let glitch = 0;
    for (let f = 1; f < 25; f++) {
      mc.ctx.reset();
      r.draw(input({ settings: s, time: f / 60, run: run({ incidents: [incident('wait_stop')] }) }));
      translates += mc.ctx.ops('translate').filter((c) => c.args[0] !== 0 || c.args[1] !== 0).length;
      glitch += mc.ctx.ops('drawImage').filter((c) => c.args[0] === mc.canvas).length;
    }
    r.destroy();
    return { particles, translates, glitch };
  }

  it('cuts particles by ~80%, and suppresses shake and the glitch', () => {
    const normal = burst(false);
    const reduced = burst(true);
    expect(normal.particles).toBeGreaterThan(150);
    expect(reduced.particles).toBeLessThan(normal.particles * 0.35);
    expect(reduced.particles).toBeGreaterThan(0);
    expect(normal.translates).toBeGreaterThan(0);
    expect(reduced.translates).toBe(0);
    expect(normal.glitch).toBeGreaterThan(0);
    expect(reduced.glitch).toBe(0);
  });

  it('screenShake: false holds the camera still on its own', () => {
    const still = burst(false, false);
    expect(still.translates).toBe(0);
    expect(still.particles).toBeGreaterThan(150);
  });

  it('types the prompt out, or all at once with reduced motion', async () => {
    const text = PROMPTS[2]!.text;
    const typed = mount();
    await typed.r.whenReady();
    typed.r.draw(input({ time: 1, run: run({ promptIndex: 2 }) }));
    typed.r.draw(input({ time: 1.2, run: run({ promptIndex: 2 }) }));
    const partial = typed.r.renderStats().stage;
    expect(partial.promptLine).toBe(text);
    expect(partial.promptShown).toBeGreaterThan(0);
    expect(partial.promptShown).toBeLessThan(text.length);
    typed.r.destroy();

    const instant = mount();
    await instant.r.whenReady();
    instant.r.draw(input({ time: 1, settings: settings({ reducedMotion: true }), run: run({ promptIndex: 2 }) }));
    expect(instant.r.renderStats().stage.promptShown).toBe(text.length);
    instant.r.destroy();
  });

  it('still renders the whole stage with reduced motion on', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    r.draw(input({ settings: settings({ reducedMotion: true }), run: run({ tools: tools({ grep: 4, subagent: 3 }) }) }));
    expect(r.renderStats().sprites).toBeGreaterThan(10);
    expect(ctx.count('fillRect')).toBeGreaterThan(50);
    r.destroy();
  });
});

describe('lifecycle', () => {
  it('attaches a ResizeObserver and window listeners, then detaches them', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { r } = mount();
    const observer = SpyResizeObserver.instances.at(-1);
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
    expect(observer?.disconnected).toBe(1);
    expect(() => r.resize()).not.toThrow();
    expect(() => r.draw(input())).not.toThrow();
    expect(() => r.toScene(0, 0)).not.toThrow();
  });

  it('survives without ResizeObserver, and with a detached canvas', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    const a = makeCanvas();
    const r1: SceneRenderer = createRenderer(a.canvas, { measure: () => ({ w: 640, h: 360 }), dpr: () => 1, sheetTimeoutMs: 5 });
    expect(r1.metrics().scale).toBe(2);
    expect(() => r1.draw(input())).not.toThrow();
    r1.destroy();
    const b = makeCanvas({ attach: false });
    const r2 = createRenderer(b.canvas, { measure: () => ({ w: 960, h: 540 }), dpr: () => 1, sheetTimeoutMs: 5 });
    expect(r2.metrics().scale).toBe(3);
    expect(() => r2.draw(input())).not.toThrow();
    r2.destroy();
  });

  it('accepts the contract option shape { atlasBase }', () => {
    const { canvas } = makeCanvas();
    const r = createRenderer(canvas, { atlasBase: '/sprites/' });
    expect(() => r.draw(input())).not.toThrow();
    r.destroy();
  });
});
