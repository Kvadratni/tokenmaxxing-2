/**
 * FROZEN CONTRACT — sprite atlas shape.
 *
 * ART owns `src/render/atlas.ts`, which must default-export an `AtlasManifest`
 * satisfying this interface. RENDER imports only from this file plus the
 * manifest, so the two can be built in parallel.
 */

export interface SpriteFrame {
  /** Pixel rect inside the sheet. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Draw origin offset, in pixels, relative to the placement point. */
  readonly ox?: number;
  readonly oy?: number;
}

export interface SpriteDef {
  /** Key into AtlasManifest.sheets. */
  readonly sheet: string;
  /** One entry per animation frame; a static sprite has exactly one. */
  readonly frames: readonly SpriteFrame[];
  /** Frames per second for multi-frame sprites. */
  readonly fps?: number;
}

export interface AtlasManifest {
  /** sheet key -> URL resolvable by the bundler (use `new URL(..., import.meta.url)`). */
  readonly sheets: Readonly<Record<string, string>>;
  readonly sprites: Readonly<Record<string, SpriteDef>>;
}

/**
 * Sprite keys the renderer expects. ART must provide every one of these.
 * RENDER must degrade gracefully (procedural fallback) if any is missing, so a
 * partial atlas never blanks the screen.
 */
export const REQUIRED_SPRITES = [
  // backdrops — full 320x180 scenes
  'scene_bedroom',
  'scene_coworking',
  'scene_openplan',
  'scene_datacenter',
  'scene_orbital',
  // the click target, 3 squash frames (rest / mid / squashed)
  'laptop',
  // desk clutter, one per agent tier, drawn as the tier is owned
  'clutter_duck',
  'clutter_mug',
  'clutter_monitor',
  'clutter_terminal',
  'clutter_swarm',
  'clutter_loop',
  'clutter_rack',
  'clutter_fleet',
  'clutter_gpuwall',
  'clutter_agi',
  // the dev sprite at the desk, 2-frame idle typing loop
  'dev_idle',
  'dev_type',
] as const;

export type RequiredSprite = (typeof REQUIRED_SPRITES)[number];

/**
 * Where each clutter sprite sits in the 320x180 scene. Owned by RENDER for
 * layout purposes but declared here so ART can size sprites to fit.
 * Values are top-left anchors.
 */
export const CLUTTER_SLOTS: Readonly<Record<string, { x: number; y: number; maxW: number; maxH: number }>> = {
  clutter_duck: { x: 118, y: 104, maxW: 12, maxH: 12 },
  clutter_mug: { x: 196, y: 104, maxW: 12, maxH: 12 },
  clutter_monitor: { x: 226, y: 74, maxW: 40, maxH: 40 },
  clutter_terminal: { x: 42, y: 74, maxW: 40, maxH: 40 },
  clutter_swarm: { x: 12, y: 118, maxW: 48, maxH: 34 },
  clutter_loop: { x: 262, y: 116, maxW: 44, maxH: 36 },
  clutter_rack: { x: 274, y: 30, maxW: 40, maxH: 52 },
  clutter_fleet: { x: 6, y: 26, maxW: 44, maxH: 52 },
  clutter_gpuwall: { x: 84, y: 12, maxW: 152, maxH: 26 },
  clutter_agi: { x: 140, y: 4, maxW: 40, maxH: 40 },
};

/** Laptop hit box in scene space. */
export const LAPTOP_RECT = { x: 128, y: 96, w: 64, h: 44 } as const;
