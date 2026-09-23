/**
 * The token pile: the context window, drawn as the thing it is.
 *
 * Every token the agent generates lands on the stage floor. The pile's height
 * IS `derived.contextFill`: at 100% its peak reaches the top of the glass.
 * It is heaped higher on the left, the way sand piles against a wall, and
 * flattens out as it nears full so the whole screen fills just before
 * compaction. `derived.contextFloor` (the MCP manuals nobody reads) is a
 * separate flat layer of books under it.
 *
 * Geometry is pure and exported for the tests; drawing goes through a cached
 * offscreen surface where the host has one, and immediate mode otherwise.
 */
import { createSurface } from './canvas.ts';
import { FLOOR_Y, GLASS, PILE_MAX_H } from './layout.ts';
import { PALETTE } from './palette.ts';
import type { SpriteSystem } from './sprites.ts';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Stable 0..1 hash, so the pile's lumps never shimmer between frames. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Relative height of the heap across the glass, u = 0 (left wall) .. 1
 * (right wall): 1 at the left wall, a valley right of centre, a small rise
 * against the right wall. A few gentle lumps so the surface reads as blocks.
 */
export function pileProfile(u: number): number {
  const x = clamp01(u);
  const base = 1 - 0.5 * smoothstep(0, 0.6, x) + 0.16 * smoothstep(0.72, 1, x);
  const lumps = 0.035 * Math.sin(x * 19 + 0.4) + 0.02 * Math.sin(x * 47 + 1.3);
  return Math.max(0.3, Math.min(1, base + lumps * (1 - x * 0.3)));
}

/**
 * Pile height in scene pixels at scene column `x`. The peak (the left wall)
 * is exactly `fill * PILE_MAX_H`; the rest of the profile flattens toward it
 * as the window nears full, so 100% fills the glass edge to edge.
 */
export function pileHeightAt(fill: number, x: number, floorFrac = 0): number {
  const f = clamp01(fill);
  const u = (x - GLASS.x) / GLASS.w;
  const flat = smoothstep(0.82, 1, f);
  const p = pileProfile(u) + (1 - pileProfile(u)) * flat;
  const h = f * PILE_MAX_H * (u <= 0 ? 1 : p);
  return Math.max(floorHeight(floorFrac), Math.min(PILE_MAX_H, h));
}

/** Height of the pile's highest point: fill * the full height of the glass. */
export function pilePeak(fill: number): number {
  return clamp01(fill) * PILE_MAX_H;
}

/** Scene y of the pile's highest point. 0% is the floor; 100% is the top of the glass. */
export function pileTopY(fill: number): number {
  return FLOOR_Y - pilePeak(fill);
}

/** The manuals layer: the permanent context floor, as a flat stack of books. */
export function floorHeight(floorFrac: number): number {
  const f = clamp01(floorFrac);
  if (f <= 0) return 0;
  // Whole books only: a manual is either on the stack or it is not.
  return Math.min(PILE_MAX_H, Math.max(5, Math.round((f * PILE_MAX_H) / 5) * 5));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const TOKEN = 7;
const ROW_STEP = 6;
const COL_STEP = 7;

interface Slot {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly variant: number;
  readonly seed: number;
}

/** Every place a token can sit, laid out once: rows of blocks, brick-offset, jittered. */
const SLOTS: readonly Slot[] = (() => {
  const out: Slot[] = [];
  const rows = Math.ceil(PILE_MAX_H / ROW_STEP) + 1;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : 3;
    for (let x = GLASS.x - 4 + offset, c = 0; x < GLASS.x + GLASS.w; x += COL_STEP, c++) {
      const seed = hash(r * 131 + c * 17);
      const jx = Math.round((hash(seed * 91) - 0.5) * 2);
      const jy = hash(seed * 53) > 0.6 ? -1 : 0;
      const top = FLOOR_Y - TOKEN - r * ROW_STEP + jy;
      // Mostly upright blocks, some tumbled ones, a few loose small ones.
      const variant = seed > 0.9 ? 2 : seed > 0.78 ? 1 : 0;
      out.push({ x: x + jx, y: top, cx: x + jx + 3, variant, seed });
    }
  }
  // Deep rows first, so blocks nearer the surface overlap the ones below.
  return out;
})();

export const PILE_SLOT_COUNT = SLOTS.length;

const BACKING = '#0a1810';
const BOOKS_KEY = 'manual';

/** Which brightness level a token at this depth below the surface gets. */
function levelFor(depth: number): number {
  if (depth < 7) return 0;
  if (depth < 19) return 1;
  if (depth < 38) return 2;
  return 3;
}

export interface PileDrawStats {
  tokens: number;
  books: number;
}

/**
 * Paint the whole pile (books, dark backing, tokens) for `fill`. Pure paint:
 * the caller decides where (the screen or a cache surface).
 */
export function paintPile(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteSystem,
  fill: number,
  floorFrac: number,
  stats?: PileDrawStats,
): void {
  const books = floorHeight(floorFrac);
  const surface = (x: number): number => FLOOR_Y - pileHeightAt(fill, x, floorFrac);
  const peak = pileHeightAt(fill, GLASS.x, floorFrac);
  if (peak <= 0.5 && books === 0) return;

  // Dark backing between the blocks, column by column, so gaps read as depth.
  ctx.fillStyle = BACKING;
  for (let x = GLASS.x; x < GLASS.x + GLASS.w; x += 4) {
    const top = Math.round(surface(x + 2)) + 3;
    if (top < FLOOR_Y - books) ctx.fillRect(x, top, 4, FLOOR_Y - books - top);
  }

  // The manuals: a flat stack, whole books, brick-laid.
  let bookCount = 0;
  for (let row = 0; row * 5 < books; row++) {
    const y = FLOOR_Y - 5 - row * 5;
    for (let x = GLASS.x - ((row * 11) % 30), i = 0; x < GLASS.x + GLASS.w; x += 30, i++) {
      const variant = Math.floor(hash(row * 7 + i * 3) * 5) % 5;
      sprites.draw(ctx, BOOKS_KEY, x, y, { frame: variant, w: 30, h: 5 });
      bookCount++;
    }
  }

  // Tokens, deep rows first so the surface layer sits on top.
  let tokenCount = 0;
  const booksTop = FLOOR_Y - books;
  for (const s of SLOTS) {
    if (s.y + TOKEN > booksTop + 1 || s.y < GLASS.y) continue;
    const top = surface(s.cx);
    const depth = s.y + 3 - top;
    // A few blocks poke up past the line, so the heap's edge is ragged rather
    // than ruled. Deterministic per slot: the surface never shimmers.
    if (depth < -1 - Math.floor(s.seed * s.seed * 6)) continue;
    const level = levelFor(depth);
    const key = s.variant === 1 && depth < 12 ? 'token_tilt' : s.variant === 2 && depth < 12 ? 'token_small' : 'token';
    const dx = key === 'token_small' ? s.x + 1 : s.x;
    const dy = key === 'token_small' ? s.y + 2 : s.y;
    sprites.draw(ctx, key, dx, dy, { frame: level, w: key === 'token_small' ? 5 : TOKEN, h: key === 'token_small' ? 5 : TOKEN });
    tokenCount++;
  }
  if (stats) {
    stats.tokens = tokenCount;
    stats.books = bookCount;
  }
}

/**
 * The pile, cached. Repaints only when the pile actually changed shape (a
 * whole pixel of peak height, or the floor), so a frame costs one blit.
 */
export class PileLayer {
  private surf: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null | undefined;
  private key = '';
  readonly stats: PileDrawStats = { tokens: 0, books: 0 };

  constructor(private readonly sprites: SpriteSystem) {}

  /** Returns draw ops issued on `ctx`. */
  draw(ctx: CanvasRenderingContext2D, fill: number, floorFrac: number, crushLeft = 0, crushRight = 0): number {
    if (this.surf === undefined) this.surf = createSurface(GLASS.w + GLASS.x * 2, FLOOR_Y + 1);
    const q = Math.round(clamp01(fill) * PILE_MAX_H * 2);
    const key = `${q}|${floorHeight(floorFrac)}|${this.sprites.generation}`;
    const surf = this.surf;
    if (!surf) {
      paintPile(ctx, this.sprites, q / (PILE_MAX_H * 2), floorFrac, this.stats);
      return this.stats.tokens + this.stats.books;
    }
    if (key !== this.key) {
      this.key = key;
      surf.ctx.clearRect(0, 0, surf.canvas.width, surf.canvas.height);
      paintPile(surf.ctx, this.sprites, q / (PILE_MAX_H * 2), floorFrac, this.stats);
    }
    // While the walls close in, the part of the pile behind them is simply
    // not drawn: the walls are where it went.
    const x0 = Math.max(0, Math.round(crushLeft));
    const x1 = Math.min(surf.canvas.width, surf.canvas.width - Math.round(crushRight));
    if (x1 <= x0) return 0;
    ctx.drawImage(surf.canvas, x0, 0, x1 - x0, surf.canvas.height, x0, 0, x1 - x0, surf.canvas.height);
    return 1;
  }

  /** Force a repaint on the next draw (the atlas finished loading). */
  invalidate(): void {
    this.key = '';
  }
}

/** A few surface blocks catch the light each frame. Cheap: a handful of pixels. */
export function drawSurfaceGlints(
  ctx: CanvasRenderingContext2D,
  fill: number,
  floorFrac: number,
  timeS: number,
  reduced: boolean,
): number {
  if (fill <= 0.01) return 0;
  const step = reduced ? 0 : Math.floor(timeS * 6);
  ctx.fillStyle = PALETTE.white;
  let ops = 0;
  for (let i = 0; i < 5; i++) {
    const x = GLASS.x + 4 + Math.floor(hash(step * 13 + i * 7.3) * (GLASS.w - 8));
    const y = Math.round(FLOOR_Y - pileHeightAt(fill, x, floorFrac)) + 1;
    if (y >= FLOOR_Y - 1) continue;
    ctx.fillRect(x, y, 1, 1);
    ops++;
  }
  return ops;
}
