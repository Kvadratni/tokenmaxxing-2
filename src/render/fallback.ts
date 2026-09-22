/**
 * Procedural stand-ins for every sprite in the atlas.
 *
 * These are not placeholders in the "pink checkerboard" sense — with no atlas
 * at all the game must still be fully playable and screenshots must still be
 * meaningful, so each shape is drawn in the real palette and is visually
 * distinct from its neighbours.
 */
import { LAPTOP_ART } from './layout.ts';
import { PALETTE, shade } from './palette.ts';

type Ctx = CanvasRenderingContext2D;

/** Draw ops issued by the fallback painter since the last read. */
let ops = 0;
export function consumeFallbackOps(): number {
  const n = ops;
  ops = 0;
  return n;
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  ops++;
}

/** Deterministic 0..1 hash — keeps procedural detail stable frame to frame. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------
// Laptop
// ---------------------------------------------------------------------------

/** `frame` 0 = rest, 1 = mid, 2 = squashed. */
export function drawLaptopFallback(ctx: Ctx, frame: number, glow: number): void {
  const squash = frame === 2 ? 3 : frame === 1 ? 1 : 0;
  const s = LAPTOP_ART.screen;
  const b = LAPTOP_ART.base;

  // Base / keyboard deck, widens slightly as the lid squashes down.
  px(ctx, b.x - squash, b.y + squash, b.w + squash * 2, b.h - squash * 0.5, PALETTE.bg3);
  px(ctx, b.x - squash, b.y + squash, b.w + squash * 2, 1, PALETTE.line);
  for (let i = 0; i < 5; i++) {
    px(ctx, b.x + 6 + i * 11, b.y + squash + 3, 8, 1, PALETTE.fg2);
  }

  // Lid.
  const ly = s.y + squash * 2;
  const lh = s.h - squash * 2;
  px(ctx, s.x - 1, ly - 1, s.w + 2, lh + 2, PALETTE.bg3);
  px(ctx, s.x, ly, s.w, lh, PALETTE.bg0);
  px(ctx, s.x - 1, ly - 1, s.w + 2, 1, PALETTE.line);

  // Screen contents: a few lines of "code".
  const inset = 3;
  for (let r = 0; r < 5; r++) {
    const y = ly + inset + r * 3;
    if (y > ly + lh - 3) break;
    const w = 6 + Math.floor(hash(r * 3.7) * (s.w - inset * 2 - 8));
    px(ctx, s.x + inset, y, w, 1, r % 3 === 0 ? PALETTE.green : PALETTE.green2);
  }

  // Emissive wash over the panel.
  if (glow > 0) {
    ctx.globalAlpha = Math.min(0.55, glow * 0.45);
    px(ctx, s.x, ly, s.w, lh, PALETTE.green);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Dev
// ---------------------------------------------------------------------------

/**
 * `typing` swaps the arm pose; the two states are the 2-frame atlas loop.
 * Proportional to the given box so it matches whatever size the atlas uses.
 */
export function drawDevFallback(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  typing: boolean,
): void {
  const skin = '#c98f6b';
  const hood = PALETTE.purple;
  const hoodDark = shade(PALETTE.purple, 0.62);
  const hair = shade(PALETTE.bg0, 1.6);
  const u = (f: number): number => Math.round(w * f);
  const v = (f: number): number => Math.round(h * f);

  // Hood / shoulders.
  px(ctx, x + u(0.12), y + v(0.42), u(0.76), v(0.58), hood);
  px(ctx, x + u(0.04), y + v(0.5), u(0.1), v(0.5), hoodDark);
  px(ctx, x + u(0.86), y + v(0.5), u(0.1), v(0.5), hoodDark);
  px(ctx, x + u(0.12), y + v(0.42), u(0.76), Math.max(1, v(0.05)), shade(PALETTE.purple, 1.3));

  // Head.
  px(ctx, x + u(0.25), y + v(0.08), u(0.5), v(0.36), skin);
  px(ctx, x + u(0.21), y + v(0.03), u(0.58), v(0.14), hair);
  // Glasses catching the screen light.
  px(ctx, x + u(0.27), y + v(0.22), u(0.18), Math.max(1, v(0.08)), PALETTE.bg0);
  px(ctx, x + u(0.55), y + v(0.22), u(0.18), Math.max(1, v(0.08)), PALETTE.bg0);
  px(ctx, x + u(0.29), y + v(0.23), Math.max(1, u(0.1)), 1, PALETTE.green);
  px(ctx, x + u(0.57), y + v(0.23), Math.max(1, u(0.1)), 1, PALETTE.green);

  // Arms reaching for the keyboard; the typing pose drops one a pixel.
  const dy = typing ? 1 : 0;
  px(ctx, x - u(0.06), y + v(0.66) + dy, u(0.22), v(0.16), hood);
  px(ctx, x + u(0.84), y + v(0.66) - dy, u(0.22), v(0.16), hood);
  px(ctx, x - u(0.1), y + v(0.78) + dy, u(0.16), v(0.14), skin);
  px(ctx, x + u(0.94), y + v(0.78) - dy, u(0.16), v(0.14), skin);
}

// ---------------------------------------------------------------------------
// Desk clutter
// ---------------------------------------------------------------------------

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

function blink(timeS: number, seed: number, hz: number): boolean {
  return (Math.floor(timeS * hz + seed * 7.3) & 1) === 0;
}

const CLUTTER: Readonly<Record<string, (ctx: Ctx, s: Slot, t: number) => void>> = {
  clutter_duck: (ctx, s) => {
    px(ctx, s.x + 2, s.y + 4, 8, 7, PALETTE.amber);
    px(ctx, s.x + 6, s.y + 1, 5, 5, PALETTE.amber);
    px(ctx, s.x + 10, s.y + 3, 3, 2, '#e07b39');
    px(ctx, s.x + 9, s.y + 2, 1, 1, PALETTE.bg0);
    px(ctx, s.x + 2, s.y + 10, 8, 1, shade(PALETTE.amber, 0.6));
  },
  clutter_mug: (ctx, s) => {
    px(ctx, s.x + 1, s.y + 3, 8, 8, PALETTE.fg0);
    px(ctx, s.x + 9, s.y + 5, 2, 4, PALETTE.fg1);
    px(ctx, s.x + 2, s.y + 3, 6, 2, '#5a3a26');
    px(ctx, s.x + 1, s.y + 10, 8, 1, PALETTE.fg2);
  },
  clutter_monitor: (ctx, s, t) => {
    px(ctx, s.x + 2, s.y, s.w - 4, s.h - 10, PALETTE.bg3);
    px(ctx, s.x + 4, s.y + 2, s.w - 8, s.h - 14, PALETTE.bg0);
    for (let r = 0; r < 6; r++) {
      const on = blink(t, r, 1.3);
      px(ctx, s.x + 6, s.y + 4 + r * 3, on ? 12 + r * 2 : 8, 1, PALETTE.blue);
    }
    px(ctx, s.x + s.w / 2 - 3, s.y + s.h - 10, 6, 6, PALETTE.bg3);
    px(ctx, s.x + s.w / 2 - 9, s.y + s.h - 5, 18, 3, PALETTE.line);
  },
  clutter_terminal: (ctx, s, t) => {
    px(ctx, s.x + 2, s.y + 2, s.w - 4, s.h - 8, PALETTE.bg1);
    px(ctx, s.x + 4, s.y + 4, s.w - 8, s.h - 12, PALETTE.bg0);
    for (let r = 0; r < 5; r++) {
      px(ctx, s.x + 6, s.y + 6 + r * 4, 4 + ((r * 7) % 18), 1, PALETTE.green2);
    }
    if (blink(t, 3, 2)) px(ctx, s.x + 6, s.y + 26, 3, 1, PALETTE.green);
    px(ctx, s.x + 6, s.y + s.h - 5, s.w - 12, 3, PALETTE.line);
  },
  clutter_swarm: (ctx, s, t) => {
    for (let i = 0; i < 7; i++) {
      const bx = s.x + 2 + ((i * 13) % (s.w - 10));
      const by = s.y + 4 + ((i * 9) % (s.h - 12));
      px(ctx, bx, by, 7, 7, PALETTE.bg3);
      px(ctx, bx + 1, by + 1, 5, 5, blink(t, i, 2.2) ? PALETTE.purple : shade(PALETTE.purple, 0.45));
    }
  },
  clutter_loop: (ctx, s, t) => {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const rad = Math.min(s.w, s.h) / 2 - 3;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const lit = ((a + Math.floor(t * 8)) & 3) === 0;
      px(ctx, cx + Math.cos(ang) * rad - 1, cy + Math.sin(ang) * rad - 1, 2, 2, lit ? PALETTE.green : PALETTE.green2);
    }
    px(ctx, cx - 2, cy - 1, 4, 3, PALETTE.bg3);
  },
  clutter_rack: (ctx, s, t) => {
    px(ctx, s.x, s.y, s.w, s.h, PALETTE.bg2);
    px(ctx, s.x, s.y, s.w, 1, PALETTE.line);
    for (let r = 0; r < 8; r++) {
      const y = s.y + 3 + r * 6;
      if (y > s.y + s.h - 4) break;
      px(ctx, s.x + 2, y, s.w - 4, 4, PALETTE.bg1);
      px(ctx, s.x + s.w - 7, y + 1, 2, 2, blink(t, r, 3) ? PALETTE.green : PALETTE.bg3);
      px(ctx, s.x + s.w - 11, y + 1, 2, 2, blink(t, r + 5, 1.7) ? PALETTE.amber : PALETTE.bg3);
    }
  },
  clutter_fleet: (ctx, s, t) => {
    px(ctx, s.x, s.y, s.w, s.h, PALETTE.bg1);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        const x = s.x + 3 + c * 13;
        const y = s.y + 3 + r * 10;
        if (y > s.y + s.h - 8) break;
        px(ctx, x, y, 11, 8, PALETTE.bg3);
        px(ctx, x + 1, y + 1, 9, 2, blink(t, r * 3 + c, 2.6) ? PALETTE.blue : shade(PALETTE.blue, 0.35));
        px(ctx, x + 1, y + 5, 5, 1, PALETTE.fg2);
      }
    }
    px(ctx, s.x, s.y, s.w, 1, PALETTE.line);
  },
  clutter_gpuwall: (ctx, s, t) => {
    px(ctx, s.x, s.y, s.w, s.h, PALETTE.bg1);
    const cols = Math.floor(s.w / 8);
    for (let c = 0; c < cols; c++) {
      const x = s.x + 2 + c * 8;
      px(ctx, x, s.y + 2, 6, s.h - 4, PALETTE.bg3);
      const heat = (Math.sin(t * 2 + c * 0.9) + 1) / 2;
      px(ctx, x + 1, s.y + 4, 4, 2, heat > 0.6 ? PALETTE.red : PALETTE.green2);
      px(ctx, x + 1, s.y + s.h - 7, 4, 1, PALETTE.fg2);
    }
    px(ctx, s.x, s.y, s.w, 1, PALETTE.line);
  },
  clutter_agi: (ctx, s, t) => {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const pulse = (Math.sin(t * 2.4) + 1) / 2;
    ctx.globalAlpha = 0.18 + pulse * 0.2;
    px(ctx, cx - 14, cy - 14, 28, 28, PALETTE.purple);
    ctx.globalAlpha = 1;
    px(ctx, cx - 8, cy - 8, 16, 16, shade(PALETTE.purple, 0.7));
    px(ctx, cx - 5, cy - 5, 10, 10, PALETTE.purple);
    px(ctx, cx - 2, cy - 2, 4, 4, PALETTE.white);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2 + t * 1.1;
      px(ctx, cx + Math.cos(ang) * 13 - 1, cy + Math.sin(ang) * 13 - 1, 2, 2, PALETTE.white);
    }
  },
};

/** True when a procedural stand-in exists for `key`. */
export function hasFallback(key: string): boolean {
  return (
    key in CLUTTER ||
    key === 'laptop' ||
    key === 'dev_idle' ||
    key === 'dev_type' ||
    key.startsWith('scene_')
  );
}

/**
 * Paint the stand-in for `key`. Unknown keys get a labelled magenta box so a
 * typo is loud rather than invisible.
 */
export function drawFallbackSprite(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: number,
  timeS: number,
  extra: number,
): void {
  const clutter = CLUTTER[key];
  if (clutter) {
    clutter(ctx, { x, y, w, h }, timeS);
    return;
  }
  if (key === 'laptop') {
    drawLaptopFallback(ctx, frame, extra);
    return;
  }
  if (key === 'dev_idle' || key === 'dev_type') {
    drawDevFallback(ctx, x, y, Math.max(8, w), Math.max(10, h), key === 'dev_type');
    return;
  }
  // Unknown key: an obviously-wrong box, never a crash.
  px(ctx, x, y, Math.max(4, w), Math.max(4, h), PALETTE.purple);
  px(ctx, x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2), PALETTE.bg0);
}
