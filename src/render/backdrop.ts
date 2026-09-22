/**
 * Procedural scene backdrops.
 *
 * These are static, so each one is painted once into an offscreen 320x180
 * surface and blitted afterwards — the hot loop never redraws scene geometry.
 * Where no offscreen surface is available (headless test environments) we fall
 * back to immediate-mode painting, which is slow but correct.
 */
import type { SceneKey } from '../sim/types.ts';
import { createSurface } from './canvas.ts';
import {
  DESK_FACE_BOTTOM,
  DESK_LEFT,
  DESK_RIGHT,
  DESK_SURFACE_BOTTOM,
  DESK_TOP,
  FLOOR_TOP,
  H,
  W,
} from './layout.ts';
import { PALETTE, mix, shade } from './palette.ts';

type Ctx = CanvasRenderingContext2D;

export const SCENE_KEYS: readonly SceneKey[] = [
  'bedroom',
  'coworking',
  'openplan',
  'datacenter',
  'orbital',
];

interface SceneStyle {
  readonly wallTop: string;
  readonly wallBottom: string;
  readonly accent: string;
  readonly floor: string;
  readonly deskTop: string;
  readonly deskFace: string;
}

const STYLES: Readonly<Record<SceneKey, SceneStyle>> = {
  bedroom: {
    wallTop: '#241d2b',
    wallBottom: '#332a3d',
    accent: PALETTE.purple,
    floor: '#3a2f28',
    deskTop: '#4a3a2c',
    deskFace: '#33271e',
  },
  coworking: {
    wallTop: '#20262a',
    wallBottom: '#33302a',
    accent: PALETTE.amber,
    floor: '#2a2622',
    deskTop: '#54432f',
    deskFace: '#3a2e20',
  },
  openplan: {
    wallTop: '#1a2029',
    wallBottom: '#2a333f',
    accent: PALETTE.blue,
    floor: '#242a33',
    deskTop: '#3c434e',
    deskFace: '#2a303a',
  },
  datacenter: {
    wallTop: '#0f1518',
    wallBottom: '#16232a',
    accent: PALETTE.green,
    floor: '#1a2226',
    deskTop: '#2f353e',
    deskFace: '#20262c',
  },
  orbital: {
    wallTop: '#07070d',
    wallBottom: '#12122a',
    accent: PALETTE.blue,
    floor: '#1a1d2b',
    deskTop: '#39405a',
    deskFace: '#252b3d',
  },
};

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function hash(n: number): number {
  const s = Math.sin(n * 91.7) * 21753.13;
  return s - Math.floor(s);
}

/** Banded vertical blend with a 1px checkerboard seam — a gradient you can count. */
function ditherBand(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  top: string,
  bottom: string,
  steps: number,
): void {
  const bandH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const y0 = Math.floor(y + i * bandH);
    const y1 = Math.floor(y + (i + 1) * bandH);
    rect(ctx, x, y0, w, y1 - y0, mix(top, bottom, t));
    if (i < steps - 1) {
      ctx.fillStyle = mix(top, bottom, (i + 0.5) / (steps - 1));
      for (let dx = i & 1; dx < w; dx += 2) ctx.fillRect(x + dx, y1 - 1, 1, 1);
    }
  }
}

function drawDesk(ctx: Ctx, s: SceneStyle): void {
  const w = DESK_RIGHT - DESK_LEFT;
  // Under-desk shadow first so the legs read as being in it.
  rect(ctx, DESK_LEFT, DESK_FACE_BOTTOM, w, FLOOR_TOP - DESK_FACE_BOTTOM, shade(s.floor, 0.55));
  // Legs.
  rect(ctx, DESK_LEFT + 6, DESK_FACE_BOTTOM, 8, FLOOR_TOP - DESK_FACE_BOTTOM + 2, s.deskFace);
  rect(ctx, DESK_RIGHT - 14, DESK_FACE_BOTTOM, 8, FLOOR_TOP - DESK_FACE_BOTTOM + 2, s.deskFace);
  // Surface + front edge.
  rect(ctx, DESK_LEFT, DESK_TOP, w, DESK_SURFACE_BOTTOM - DESK_TOP, s.deskTop);
  rect(ctx, DESK_LEFT, DESK_TOP, w, 1, shade(s.deskTop, 1.35));
  rect(ctx, DESK_LEFT, DESK_SURFACE_BOTTOM, w, DESK_FACE_BOTTOM - DESK_SURFACE_BOTTOM, s.deskFace);
  rect(ctx, DESK_LEFT, DESK_FACE_BOTTOM - 1, w, 1, shade(s.deskFace, 0.6));
}

function drawFloor(ctx: Ctx, s: SceneStyle, scene: SceneKey): void {
  ditherBand(ctx, 0, FLOOR_TOP, W, H - FLOOR_TOP, s.floor, shade(s.floor, 0.7), 4);
  if (scene === 'openplan' || scene === 'datacenter' || scene === 'orbital') {
    ctx.fillStyle = shade(s.floor, 1.25);
    for (let x = -20; x < W + 40; x += 24) ctx.fillRect(x, FLOOR_TOP, 1, H - FLOOR_TOP);
    for (let y = FLOOR_TOP + 8; y < H; y += 9) ctx.fillRect(0, y, W, 1);
  }
}

function paintBedroom(ctx: Ctx, s: SceneStyle): void {
  // Window onto a night city.
  rect(ctx, 214, 20, 62, 56, '#0d1020');
  rect(ctx, 212, 18, 66, 60, PALETTE.bg3);
  rect(ctx, 214, 20, 62, 56, '#0d1020');
  for (let i = 0; i < 26; i++) {
    const x = 216 + Math.floor(hash(i) * 58);
    const y = 22 + Math.floor(hash(i + 40) * 40);
    rect(ctx, x, y, 1, 1, hash(i + 90) > 0.75 ? PALETTE.amber : PALETTE.fg2);
  }
  // Skyline.
  for (let i = 0; i < 7; i++) {
    const bw = 6 + Math.floor(hash(i + 3) * 10);
    const bh = 10 + Math.floor(hash(i + 11) * 22);
    const bx = 215 + i * 9;
    rect(ctx, bx, 76 - bh, bw, bh, '#171a2c');
    if (hash(i + 21) > 0.4) rect(ctx, bx + 2, 76 - bh + 3, 2, 2, PALETTE.amber);
  }
  rect(ctx, 244, 18, 2, 60, PALETTE.bg3);
  rect(ctx, 212, 46, 66, 2, PALETTE.bg3);

  // Poster.
  rect(ctx, 40, 22, 40, 50, shade(PALETTE.purple, 0.35));
  rect(ctx, 42, 24, 36, 46, shade(PALETTE.purple, 0.55));
  rect(ctx, 48, 30, 24, 24, PALETTE.purple);
  rect(ctx, 48, 60, 24, 2, PALETTE.fg1);
  rect(ctx, 52, 65, 16, 2, PALETTE.fg2);

  // Bed corner, left.
  rect(ctx, 0, 96, 26, 56, '#3b2a3f');
  rect(ctx, 0, 96, 26, 4, '#54395c');
  rect(ctx, 0, 118, 26, 2, shade('#3b2a3f', 0.7));

  // Desk lamp glow on the wall.
  ctx.globalAlpha = 0.1;
  rect(ctx, 96, 60, 128, 56, PALETTE.amber);
  ctx.globalAlpha = 1;
  rect(ctx, 100, 92, 4, 24, PALETTE.bg3);
  rect(ctx, 94, 86, 18, 7, PALETTE.bg3);
  rect(ctx, 96, 92, 14, 2, PALETTE.amber);
  void s;
}

function paintCoworking(ctx: Ctx, s: SceneStyle): void {
  // Exposed brick.
  for (let y = 8; y < DESK_TOP; y += 8) {
    const off = ((y / 8) & 1) * 12;
    for (let x = -12 + off; x < W; x += 24) {
      rect(ctx, x + 1, y + 1, 22, 6, shade(s.wallBottom, 1.18));
    }
  }
  // Whiteboard.
  rect(ctx, 34, 20, 76, 50, PALETTE.bg3);
  rect(ctx, 37, 23, 70, 44, PALETTE.fg0);
  for (let i = 0; i < 5; i++) {
    rect(ctx, 42, 30 + i * 7, 20 + ((i * 13) % 40), 2, i % 2 ? PALETTE.blue : PALETTE.red);
  }
  // Neon sign.
  rect(ctx, 210, 26, 72, 3, PALETTE.amber);
  rect(ctx, 210, 40, 52, 3, PALETTE.amber);
  ctx.globalAlpha = 0.14;
  rect(ctx, 202, 18, 88, 36, PALETTE.amber);
  ctx.globalAlpha = 1;
  // Sad plant.
  rect(ctx, 292, 96, 20, 20, '#6b4a2f');
  rect(ctx, 294, 98, 16, 3, '#8a6440');
  for (let i = 0; i < 6; i++) {
    const lx = 294 + i * 3;
    rect(ctx, lx, 80 + ((i * 5) % 12), 3, 18 - ((i * 5) % 12), i % 2 ? PALETTE.green2 : shade(PALETTE.green2, 0.75));
  }
}

function paintOpenplan(ctx: Ctx, s: SceneStyle): void {
  // Ceiling lights.
  for (let i = 0; i < 4; i++) {
    const x = 22 + i * 78;
    rect(ctx, x, 6, 54, 5, PALETTE.fg1);
    rect(ctx, x + 2, 11, 50, 2, PALETTE.white);
    ctx.globalAlpha = 0.07;
    rect(ctx, x - 6, 13, 66, 40, PALETTE.white);
    ctx.globalAlpha = 1;
  }
  // Distant desk pods.
  for (let i = 0; i < 5; i++) {
    const x = 6 + i * 64;
    rect(ctx, x, 74, 52, 26, shade(s.wallBottom, 0.82));
    rect(ctx, x + 4, 78, 20, 14, PALETTE.bg0);
    rect(ctx, x + 6, 80, 16, 2, PALETTE.blue);
    rect(ctx, x + 28, 78, 20, 14, PALETTE.bg0);
    rect(ctx, x + 30, 80, 16, 2, PALETTE.green2);
    rect(ctx, x, 100, 52, 2, PALETTE.line);
  }
  // Glass partition.
  rect(ctx, 0, 100, W, 2, shade(s.wallBottom, 1.3));
}

function paintDatacenter(ctx: Ctx, s: SceneStyle): void {
  // Rack corridor.
  for (let i = 0; i < 8; i++) {
    const x = i * 42;
    rect(ctx, x, 10, 36, 104, shade(s.wallBottom, 0.7));
    rect(ctx, x, 10, 36, 2, PALETTE.line);
    for (let r = 0; r < 12; r++) {
      const y = 15 + r * 8;
      rect(ctx, x + 3, y, 30, 5, PALETTE.bg1);
      const lit = hash(i * 13 + r) > 0.45;
      rect(ctx, x + 28, y + 1, 2, 2, lit ? PALETTE.green : PALETTE.bg3);
      rect(ctx, x + 24, y + 1, 2, 2, hash(i * 7 + r + 3) > 0.8 ? PALETTE.amber : PALETTE.bg3);
      rect(ctx, x + 5, y + 2, 12, 1, PALETTE.fg2);
    }
  }
  // Cold-aisle haze.
  ctx.globalAlpha = 0.08;
  rect(ctx, 0, 40, W, 76, PALETTE.blue);
  ctx.globalAlpha = 1;
}

function paintOrbital(ctx: Ctx, s: SceneStyle): void {
  // Stars.
  for (let i = 0; i < 110; i++) {
    const x = Math.floor(hash(i) * W);
    const y = Math.floor(hash(i + 300) * (FLOOR_TOP - 4));
    const b = hash(i + 700);
    rect(ctx, x, y, 1, 1, b > 0.9 ? PALETTE.white : b > 0.6 ? PALETTE.fg1 : PALETTE.fg2);
  }
  // Planet limb, bottom-right, drawn as scanline spans (no AA).
  const cx = 300;
  const cy = 168;
  const r = 96;
  for (let y = 40; y < FLOOR_TOP; y++) {
    const dy = y - cy;
    const dx2 = r * r - dy * dy;
    if (dx2 <= 0) continue;
    const dx = Math.sqrt(dx2);
    const x0 = Math.max(0, Math.floor(cx - dx));
    const x1 = Math.min(W, Math.ceil(cx + dx));
    const t = (y - 40) / (FLOOR_TOP - 40);
    rect(ctx, x0, y, x1 - x0, 1, mix('#1d4a7a', '#0e2340', t));
  }
  // Terminator glow.
  for (let y = 40; y < FLOOR_TOP; y += 3) {
    const dy = y - cy;
    const dx2 = r * r - dy * dy;
    if (dx2 <= 0) continue;
    const x0 = Math.max(0, Math.floor(cx - Math.sqrt(dx2)));
    rect(ctx, x0, y, 2, 2, PALETTE.blue);
  }
  // Viewport frame.
  rect(ctx, 0, 0, W, 6, s.deskFace);
  rect(ctx, 0, FLOOR_TOP - 6, W, 6, s.deskFace);
  for (let x = 0; x < W; x += 40) rect(ctx, x, 0, 4, FLOOR_TOP, shade(s.deskFace, 0.8));
}

const PAINTERS: Readonly<Record<SceneKey, (ctx: Ctx, s: SceneStyle) => void>> = {
  bedroom: paintBedroom,
  coworking: paintCoworking,
  openplan: paintOpenplan,
  datacenter: paintDatacenter,
  orbital: paintOrbital,
};

/** Paint a full 320x180 backdrop directly into `ctx` at the origin. */
export function paintBackdrop(ctx: CanvasRenderingContext2D, scene: SceneKey): void {
  const s = STYLES[scene] ?? STYLES.bedroom;
  rect(ctx, 0, 0, W, H, PALETTE.bg0);
  ditherBand(ctx, 0, 0, W, FLOOR_TOP, s.wallTop, s.wallBottom, 6);
  PAINTERS[scene]?.(ctx, s);
  drawFloor(ctx, s, scene);
  drawDesk(ctx, s);
  // Ambient occlusion where the wall meets the desk.
  ctx.globalAlpha = 0.35;
  rect(ctx, 0, DESK_TOP - 4, W, 4, PALETTE.bg0);
  ctx.globalAlpha = 1;
}

/** Cheap accent read used by the vignette / glow tinting. */
export function sceneAccent(scene: SceneKey): string {
  return (STYLES[scene] ?? STYLES.bedroom).accent;
}

const cache = new Map<SceneKey, HTMLCanvasElement | null>();

/**
 * Pre-rendered backdrop for `scene`, or null when the host cannot allocate an
 * offscreen surface (callers then use `paintBackdrop` directly).
 */
export function getBackdrop(scene: SceneKey): HTMLCanvasElement | null {
  const hit = cache.get(scene);
  if (hit !== undefined) return hit;
  const surf = createSurface(W, H);
  if (!surf) {
    cache.set(scene, null);
    return null;
  }
  paintBackdrop(surf.ctx, scene);
  cache.set(scene, surf.canvas);
  return surf.canvas;
}

export function clearBackdropCache(): void {
  cache.clear();
}
