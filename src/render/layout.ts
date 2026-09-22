/**
 * Fixed geometry of the 320x180 scene. Everything that needs to agree on where
 * the desk edge is reads it from here.
 *
 * The numbers are derived from `CLUTTER_SLOTS` in atlas-types.ts: the duck, mug,
 * monitor and terminal slots all bottom out at y = 114..116, which pins the desk
 * surface; the swarm and loop slots run to y = 152, which pins the floor.
 */
import { SCENE_HEIGHT, SCENE_WIDTH } from '../sim/types.ts';

export const W = SCENE_WIDTH;
export const H = SCENE_HEIGHT;

/** Top edge of the desk surface. Clutter anchors sit above this line. */
export const DESK_TOP = 116;
/** Bottom of the lit desk surface band (the bit you see in perspective). */
export const DESK_SURFACE_BOTTOM = 124;
/** Bottom of the desk's front edge. */
export const DESK_FACE_BOTTOM = 130;
/** Where the wall meets the floor. */
export const FLOOR_TOP = 152;
export const DESK_LEFT = 18;
export const DESK_RIGHT = 302;

/**
 * Where the dev sits: centred on the laptop, with `baseY` the line their
 * shoulders disappear behind the lid (top edge y = 96). The scene resolves the
 * actual draw origin from the sprite's own size so ART can resize the art
 * without the dev drifting.
 */
export const DEV_ANCHOR = { cx: 160, baseY: 104 } as const;

/** Fallback box, used when the atlas has not declared a dev sprite. */
export const DEV_RECT = {
  x: DEV_ANCHOR.cx - 12,
  y: DEV_ANCHOR.baseY - 28,
  w: 24,
  h: 28,
} as const;

/**
 * Visible laptop art, inside the forgiving LAPTOP_RECT hit box (128,96,64,44).
 * The screen rect also drives the emissive halo, so it must track the sprite.
 */
export const LAPTOP_ART = {
  screen: { x: 134, y: 96, w: 52, h: 24 },
  base: { x: 128, y: 120, w: 64, h: 9 },
} as const;

/** Where ambient code motes are born — the middle of the screen. */
export const LAPTOP_SCREEN_CENTER = { x: 160, y: 108 } as const;
