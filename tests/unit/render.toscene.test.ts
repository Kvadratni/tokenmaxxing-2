/**
 * Pointer coordinates -> scene coordinates.
 *
 * This was broken on every touchscreen in game 1. `toScene` read a cached
 * origin that is only refreshed on *resize*, but an element can move without
 * resizing: on a viewport too narrow for the stage the canvas gets offset (left
 * went to -125 on a phone) at the same size. Every tap then mapped tens of
 * scene pixels away from where it landed, the click target's hit test failed,
 * and tapping produced nothing. The agent inherits the fix.
 *
 * The existing @mobile e2e project could not catch it — at 390px the stage fits,
 * so the origin stays correct, and `click()` dispatches mouse events anyway. So
 * the invariant is asserted here instead: the mapping must follow the canvas
 * when it moves, not when it resizes.
 */
import { describe, expect, it } from 'vitest';
import { Viewport } from '../../src/render/canvas.ts';
import { AGENT_RECT } from '../../src/render/atlas-types.ts';
import { hitsAgent } from '../../src/render/canvas.ts';
import { SCENE_HEIGHT, SCENE_WIDTH } from '../../src/sim/types.ts';

/** A canvas whose on-screen box we control, without any real layout. */
function canvasAt(left: number, top: number, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const rect = {
    left,
    top,
    right: left + SCENE_WIDTH * scale,
    bottom: top + SCENE_HEIGHT * scale,
    width: SCENE_WIDTH * scale,
    height: SCENE_HEIGHT * scale,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
  c.getBoundingClientRect = (): DOMRect => rect as DOMRect;
  return c;
}

/** Move the canvas without changing its size — the case that broke. */
function moveTo(c: HTMLCanvasElement, left: number, top: number, scale: number): void {
  const moved = canvasAt(left, top, scale);
  c.getBoundingClientRect = moved.getBoundingClientRect.bind(moved);
}

describe('toScene', () => {
  it('maps the centre of an unoffset canvas to the centre of the scene', () => {
    const c = canvasAt(0, 0, 3);
    const v = new Viewport(c, null);
    const p = v.toScene((SCENE_WIDTH * 3) / 2, (SCENE_HEIGHT * 3) / 2);
    expect(p.x).toBeCloseTo(SCENE_WIDTH / 2, 6);
    expect(p.y).toBeCloseTo(SCENE_HEIGHT / 2, 6);
    v.destroy();
  });

  it('accounts for a negative offset, as happens on a narrow viewport', () => {
    // The measured phone case: 640x360 stage, left edge pushed off screen.
    const c = canvasAt(-125, 103.9375, 2);
    const v = new Viewport(c, null);
    const p = v.toScene(195, 380);
    // The middle of the agent, which is what the player tapped.
    expect(p.x).toBeCloseTo(160, 1);
    expect(p.y).toBeCloseTo(138, 1);
    expect(p.x).toBeGreaterThanOrEqual(AGENT_RECT.x);
    expect(p.x).toBeLessThanOrEqual(AGENT_RECT.x + AGENT_RECT.w);
    expect(p.y).toBeGreaterThanOrEqual(AGENT_RECT.y);
    expect(p.y).toBeLessThanOrEqual(AGENT_RECT.y + AGENT_RECT.h);
    expect(hitsAgent(p.x, p.y)).toBe(true);
    v.destroy();
  });

  it('follows the canvas when it MOVES without resizing', () => {
    // The actual regression. A cached origin survives a move, because a move
    // fires no resize — so the mapping silently drifts by the offset.
    const c = canvasAt(0, 0, 2);
    const v = new Viewport(c, null);
    const before = v.toScene(320, 180);
    expect(before.x).toBeCloseTo(160, 6);

    moveTo(c, -125, 40, 2);
    const after = v.toScene(320 - 125, 180 + 40);
    expect(after.x, 'mapping did not follow the move').toBeCloseTo(160, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    v.destroy();
  });

  it('survives a detached canvas without producing NaN', () => {
    const c = document.createElement('canvas');
    // jsdom's default rect is all zeros — the degenerate case.
    const v = new Viewport(c, null);
    const p = v.toScene(100, 100);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    v.destroy();
  });
});
