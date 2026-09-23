/**
 * The human's room, seen from inside the screen.
 *
 * These are Tokenmaxxing 1's five scene backdrops, painted by scenes.mjs and
 * not altered in any way, then pushed "behind the glass": darkened, cooled a
 * little toward the screen's blue-green, and broken up with an ordered dither
 * so the room reads as far away and out of focus rather than as a flat
 * darkened copy. The human and everything on the agent's side are drawn over
 * this at runtime.
 */
import { Canvas, bayer } from './pixel.mjs';
import { buildScenes } from './scenes.mjs';

export const ROOM_KEYS = Object.freeze(['bedroom', 'coworking', 'openplan', 'datacenter', 'orbital']);

/** The dark the glass pulls every colour toward. */
const GLASS_DARK = [16, 20, 26];
/** A faint cool cast, the colour of a screen seen edge-on. */
const GLASS_TINT = [24, 44, 48];

function dimPixel(r, g, b, x, y) {
  // Keep hue, lose most of the light. Bright accents (lamps, LEDs, windows)
  // survive as dim embers, which is what sells the distance.
  const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
  const keep = 0.34 + lum * 0.16;
  let nr = r * keep;
  let ng = g * keep;
  let nb = b * keep;
  // Desaturate a touch toward grey, then cool it.
  const grey = (nr + ng + nb) / 3;
  nr = nr * 0.78 + grey * 0.22;
  ng = ng * 0.78 + grey * 0.22;
  nb = nb * 0.78 + grey * 0.22;
  nr = nr * 0.86 + GLASS_TINT[0] * 0.14;
  ng = ng * 0.86 + GLASS_TINT[1] * 0.14;
  nb = nb * 0.86 + GLASS_TINT[2] * 0.14;
  // Ordered dither toward the glass dark: a quarter of the pixels drop a step,
  // so flat walls pick up the chunky texture of the concept art.
  const t = bayer(x, y, 4);
  if (t < 0.25) {
    nr = nr * 0.55 + GLASS_DARK[0] * 0.45;
    ng = ng * 0.55 + GLASS_DARK[1] * 0.45;
    nb = nb * 0.55 + GLASS_DARK[2] * 0.45;
  } else if (t > 0.9 && lum > 0.45) {
    // The brightest pixels keep a sparkle so light sources still read.
    nr = Math.min(255, nr * 1.25);
    ng = Math.min(255, ng * 1.25);
    nb = Math.min(255, nb * 1.25);
  }
  return [Math.round(nr), Math.round(ng), Math.round(nb), 255];
}

/** Darken one opaque 320x180 scene into its through-the-glass version. */
export function dimRoom(scene) {
  const out = new Canvas(scene.w, scene.h);
  for (let y = 0; y < scene.h; y += 1) {
    for (let x = 0; x < scene.w; x += 1) {
      const i = (y * scene.w + x) * 4;
      const px = dimPixel(scene.data[i], scene.data[i + 1], scene.data[i + 2], x, y);
      out.data[i] = px[0];
      out.data[i + 1] = px[1];
      out.data[i + 2] = px[2];
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/** `room_<scene>` -> the dimmed 320x180 canvas, one per game 1 scene. */
export function buildRooms(rng) {
  const scenes = buildScenes(rng);
  const rooms = {};
  for (const key of ROOM_KEYS) {
    const scene = scenes[`scene_${key}`];
    if (!scene) throw new Error(`scenes.mjs did not paint scene_${key}`);
    rooms[`room_${key}`] = dimRoom(scene);
  }
  return rooms;
}
