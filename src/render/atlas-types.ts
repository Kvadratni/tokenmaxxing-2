/**
 * The sprite atlas contract, and the agent's hit box.
 *
 * tools/art/build-art.mjs generates `src/render/atlas.ts`, which must
 * default-export an `AtlasManifest` declaring every key in `REQUIRED_SPRITES`.
 * The renderer imports only this file plus the manifest, and degrades to a
 * procedural stand-in for any key the atlas lacks, so missing art never
 * blanks the stage.
 *
 * Gadget and pickup keys are derived from content.ts, so adding a tool or a
 * pickup shape to the content makes the art check fail until the art exists.
 */
import { PICKUPS, TOOLS } from '../sim/content.ts';

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
  /** One entry per animation frame (or per variant); a static sprite has exactly one. */
  readonly frames: readonly SpriteFrame[];
  /** Frames per second for animated sprites. */
  readonly fps?: number;
}

export interface AtlasManifest {
  /** sheet key -> URL resolvable by the bundler (`new URL(..., import.meta.url)`). */
  readonly sheets: Readonly<Record<string, string>>;
  readonly sprites: Readonly<Record<string, SpriteDef>>;
}

/** The human's room behind the glass, one per scene: game 1's art, dimmed. */
export const ROOM_SPRITES = [
  'room_bedroom',
  'room_coworking',
  'room_openplan',
  'room_datacenter',
  'room_orbital',
] as const;

/**
 * Human layers. All are authored in scene space: each frame carries its own
 * `ox`/`oy`, so drawing at (0, 0) puts it where it belongs.
 */
export const HUMAN_SPRITES = [
  'human_body',
  // Per mood: [open, blink, looking down at the keyboard].
  'human_eyes_tired',
  'human_eyes_impatient',
  'human_eyes_furious',
  'human_eyes_suspicious',
  'human_mug',
  'human_typing',
  'human_chair',
] as const;

/** Agent frames share one box; the feet sit at AGENT_FEET inside it. */
export const AGENT_SPRITES = [
  'agent_idle',
  'agent_squash',
  'agent_panic',
  'agent_sweat',
  'agent_dazed',
  'agent_wait',
  'agent_grovel',
  'agent_mini',
  'agent_team',
] as const;

/** Everything else on the stage. */
export const PROP_SPRITES = [
  // Pile blocks, 4 brightness levels each: lit, mid, dim, deep.
  'token',
  'token_small',
  'token_tilt',
  // The MCP manuals under the pile: 5 book variants.
  'manual',
  'wall_left',
  'wall_right',
  'scroll_summary',
  'glass_glare',
  'glass_crack',
] as const;

/** A tool's stage gadget, and its greyed-out twin for when it is halted. */
export function gadgetSprites(gadget: string): readonly [string, string] {
  return [gadget, `${gadget}_off`];
}

export const GADGET_SPRITES: readonly string[] = TOOLS.flatMap((t) => gadgetSprites(t.gadget));

/** Pickup art is keyed by what it looks like, not by what it does. */
export function pickupSprite(shape: string, accent: string): string {
  return `pk_${shape}_${accent}`;
}

export const PICKUP_SPRITES: readonly string[] = [
  ...new Set(PICKUPS.map((p) => pickupSprite(p.shape, p.accent))),
];

/** Every key the renderer draws from the atlas. ART must provide all of them. */
export const REQUIRED_SPRITES: readonly string[] = [
  ...ROOM_SPRITES,
  ...HUMAN_SPRITES,
  ...AGENT_SPRITES,
  ...PROP_SPRITES,
  ...GADGET_SPRITES,
  ...PICKUP_SPRITES,
];

/** Size of every full-size agent frame, and where its feet land inside it. */
export const AGENT_BOX = { w: 36, h: 50 } as const;
export const AGENT_FEET = { x: 18, y: 45 } as const;

/**
 * The agent's hit box in 320x180 scene space: the click target. Deliberately
 * generous (the whole character, its halo and a margin), because a missed
 * click on a clicker game feels like a bug. The DOM overlay
 * `data-testid="agent-hit"` is positioned over exactly this rect.
 */
export const AGENT_RECT = { x: 134, y: 106, w: 52, h: 60 } as const;
