/**
 * A 3x5 bit-packed bitmap font.
 *
 * `ctx.fillText` is unusable at 320x180 — the browser hints and anti-aliases
 * glyphs into grey mush that fights the pixel art. Every character the scene
 * draws goes through here instead. Glyphs are authored as 5 rows of 3 cells and
 * packed at module load into a `Uint16Array` (3 bits per row, 15 bits total,
 * MSB = leftmost pixel of the top row).
 *
 * The font is small-caps: lowercase reuses the uppercase glyph, which is what
 * every legible 3x5 face does.
 */
import { createSurface } from './canvas.ts';

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const GLYPH_GAP = 1;
/** Horizontal step from one glyph origin to the next, at scale 1. */
export const CHAR_ADVANCE = GLYPH_W + GLYPH_GAP;
/** Vertical step between text baselines, at scale 1. */
export const LINE_HEIGHT = GLYPH_H + 2;

const FIRST_CODE = 32;
const LAST_CODE = 126;
const TABLE_SIZE = LAST_CODE - FIRST_CODE + 1;

/** rows are top-to-bottom, `#` lit, `.` clear. */
const GLYPH_SRC: Readonly<Record<string, string>> = {
  ' ': '.../.../.../.../...',
  '0': '.#./#.#/#.#/#.#/.#.',
  '1': '.#./##./.#./.#./###',
  '2': '###/..#/###/#../###',
  '3': '###/..#/.##/..#/###',
  '4': '#.#/#.#/###/..#/..#',
  '5': '###/#../###/..#/###',
  '6': '###/#../###/#.#/###',
  '7': '###/..#/..#/..#/..#',
  '8': '###/#.#/###/#.#/###',
  '9': '###/#.#/###/..#/###',
  A: '.#./#.#/###/#.#/#.#',
  B: '##./#.#/##./#.#/##.',
  C: '.##/#../#../#../.##',
  D: '##./#.#/#.#/#.#/##.',
  E: '###/#../##./#../###',
  F: '###/#../##./#../#..',
  G: '.##/#../#.#/#.#/.##',
  H: '#.#/#.#/###/#.#/#.#',
  I: '###/.#./.#./.#./###',
  J: '..#/..#/..#/#.#/.#.',
  K: '#.#/#.#/##./#.#/#.#',
  L: '#../#../#../#../###',
  M: '#.#/###/###/#.#/#.#',
  N: '#.#/##./###/.##/#.#',
  O: '###/#.#/#.#/#.#/###',
  P: '###/#.#/###/#../#..',
  Q: '###/#.#/#.#/###/..#',
  R: '##./#.#/##./#.#/#.#',
  S: '.##/#../.#./..#/##.',
  T: '###/.#./.#./.#./.#.',
  U: '#.#/#.#/#.#/#.#/###',
  V: '#.#/#.#/#.#/#.#/.#.',
  W: '#.#/#.#/###/###/#.#',
  X: '#.#/#.#/.#./#.#/#.#',
  Y: '#.#/#.#/.#./.#./.#.',
  Z: '###/..#/.#./#../###',
  '+': '.../.#./###/.#./...',
  '-': '.../.../###/.../...',
  '.': '.../.../.../.../.#.',
  ',': '.../.../.../.#./#..',
  ':': '.../.#./.../.#./...',
  ';': '.../.#./.../.#./#..',
  '/': '..#/..#/.#./#../#..',
  '\\': '#../#../.#./..#/..#',
  '%': '#.#/..#/.#./#../#.#',
  '!': '.#./.#./.#./.../.#.',
  '?': '###/..#/.#./.../.#.',
  $: '.##/##./###/.##/##.',
  '(': '..#/.#./.#./.#./..#',
  ')': '#../.#./.#./.#./#..',
  '[': '.##/.#./.#./.#./.##',
  ']': '##./.#./.#./.#./##.',
  '{': '..#/.#./##./.#./..#',
  '}': '#../.#./.##/.#./#..',
  '<': '..#/.#./#../.#./..#',
  '>': '#../.#./..#/.#./#..',
  '=': '.../###/.../###/...',
  '*': '#.#/.#./###/.#./#.#',
  '#': '#.#/###/#.#/###/#.#',
  _: '.../.../.../.../###',
  "'": '.#./.#./.../.../...',
  '"': '#.#/#.#/.../.../...',
  '|': '.#./.#./.#./.#./.#.',
  '^': '.#./#.#/.../.../...',
  '~': '.../.##/##./.../...',
  '@': '###/#.#/###/#../.##',
  '&': '##./##./###/#.#/.##',
};

/** Drawn in place of any character the font does not know. Never throws. */
const PLACEHOLDER_BITS = pack('###/###/#.#/###/###');

function pack(src: string): number {
  const rows = src.split('/');
  let bits = 0;
  for (let r = 0; r < GLYPH_H; r++) {
    const row = rows[r] ?? '...';
    let v = 0;
    for (let c = 0; c < GLYPH_W; c++) {
      if (row[c] === '#') v |= 4 >> c;
    }
    bits |= v << (12 - r * 3);
  }
  return bits;
}

const PACKED = new Uint16Array(TABLE_SIZE);
const KNOWN = new Uint8Array(TABLE_SIZE);

for (const [ch, src] of Object.entries(GLYPH_SRC)) {
  const code = ch.charCodeAt(0);
  if (code < FIRST_CODE || code > LAST_CODE) continue;
  PACKED[code - FIRST_CODE] = pack(src);
  KNOWN[code - FIRST_CODE] = 1;
}
// Small caps: a-z borrow A-Z.
for (let code = 97; code <= 122; code++) {
  const upper = code - 32 - FIRST_CODE;
  PACKED[code - FIRST_CODE] = PACKED[upper]!;
  KNOWN[code - FIRST_CODE] = 1;
}

/** Every character with a hand-authored glyph, including space. */
export const SUPPORTED_CHARS: string = (() => {
  let out = '';
  for (let i = 0; i < TABLE_SIZE; i++) if (KNOWN[i]) out += String.fromCharCode(i + FIRST_CODE);
  return out;
})();

export function isSupported(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (!Number.isFinite(code)) return false;
  const i = code - FIRST_CODE;
  return i >= 0 && i < TABLE_SIZE && KNOWN[i] === 1;
}

/** Packed 15-bit glyph. Unsupported characters return the placeholder box. */
export function glyphBits(code: number): number {
  const i = code - FIRST_CODE;
  if (i < 0 || i >= TABLE_SIZE || !KNOWN[i]) return PLACEHOLDER_BITS;
  return PACKED[i]!;
}

/** Five 3-bit row masks, top to bottom. Handy for tests and sheet baking. */
export function glyphRows(ch: string): number[] {
  const bits = glyphBits(ch.charCodeAt(0));
  const rows: number[] = [];
  for (let r = 0; r < GLYPH_H; r++) rows.push((bits >> (12 - r * 3)) & 7);
  return rows;
}

/** Rendered width in scene pixels (no trailing inter-glyph gap). */
export function measureText(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  return (text.length * CHAR_ADVANCE - GLYPH_GAP) * Math.max(1, Math.floor(scale));
}

export function textHeight(scale = 1): number {
  return GLYPH_H * Math.max(1, Math.floor(scale));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export interface TextOptions {
  /** Integer multiplier. Fractional values are floored — pixel art has no half pixels. */
  scale?: number;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
  /** Colour of a 1px drop shadow drawn under the glyphs, or null for none. */
  shadow?: string | null;
  /** Skip the pre-rendered glyph cache (used while baking the cache itself). */
  cache?: boolean;
}

let textOps = 0;

/** Number of canvas draw ops issued by the font since the last call. Resets. */
export function consumeTextOps(): number {
  const n = textOps;
  textOps = 0;
  return n;
}

interface CacheEntry {
  readonly canvas: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
}

const CACHE_LIMIT = 128;
const cache = new Map<string, CacheEntry | null>();
let cacheUsable: boolean | null = null;

function canCache(): boolean {
  if (cacheUsable === null) cacheUsable = createSurface(1, 1) !== null;
  return cacheUsable;
}

/** Drop every pre-rendered string. Exposed for tests and low-memory hosts. */
export function clearTextCache(): void {
  cache.clear();
}

function blitGlyphs(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
): void {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const bits = glyphBits(text.charCodeAt(i));
    if (bits !== 0) {
      for (let r = 0; r < GLYPH_H; r++) {
        const row = (bits >> (12 - r * 3)) & 7;
        if (row === 0) continue;
        const ry = y + r * scale;
        let c = 0;
        while (c < GLYPH_W) {
          if (row & (4 >> c)) {
            let len = 1;
            while (c + len < GLYPH_W && row & (4 >> (c + len))) len++;
            ctx.fillRect(cx + c * scale, ry, len * scale, scale);
            textOps++;
            c += len;
          } else {
            c++;
          }
        }
      }
    }
    cx += CHAR_ADVANCE * scale;
  }
}

function bake(text: string, color: string, shadow: string | null): CacheEntry | null {
  const w = measureText(text, 1);
  const h = GLYPH_H;
  const pad = shadow ? 1 : 0;
  const surf = createSurface(w + pad, h + pad);
  if (!surf) return null;
  if (shadow) {
    surf.ctx.fillStyle = shadow;
    blitGlyphs(surf.ctx, text, 1, 1, 1);
  }
  surf.ctx.fillStyle = color;
  blitGlyphs(surf.ctx, text, 0, 0, 1);
  textOps = 0; // baking is not a frame cost
  return { canvas: surf.canvas, w: w + pad, h: h + pad };
}

function cached(text: string, color: string, shadow: string | null): CacheEntry | null {
  const key = `${color} ${shadow ?? ''} ${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const entry = bake(text, color, shadow);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, entry);
  return entry;
}

/**
 * Draw `text` and return its rendered width in scene pixels.
 * Positions are snapped to whole pixels so glyphs never straddle a pixel edge.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  opts?: TextOptions,
): number {
  if (text.length === 0) return 0;
  const scale = Math.max(1, Math.floor(opts?.scale ?? 1));
  const shadow = opts?.shadow ?? null;
  const width = measureText(text, scale);

  let px = x;
  if (opts?.align === 'center') px = x - width / 2;
  else if (opts?.align === 'right') px = x - width;

  let py = y;
  const h = GLYPH_H * scale;
  if (opts?.baseline === 'middle') py = y - h / 2;
  else if (opts?.baseline === 'bottom') py = y - h;

  px = Math.round(px);
  py = Math.round(py);

  const useCache = (opts?.cache ?? true) && text.length <= 40 && canCache();
  if (useCache) {
    const entry = cached(text, color, shadow);
    if (entry) {
      ctx.drawImage(entry.canvas, px, py, entry.w * scale, entry.h * scale);
      textOps++;
      return width;
    }
  }

  const prev = ctx.fillStyle;
  if (shadow) {
    ctx.fillStyle = shadow;
    blitGlyphs(ctx, text, px + scale, py + scale, scale);
  }
  ctx.fillStyle = color;
  blitGlyphs(ctx, text, px, py, scale);
  ctx.fillStyle = prev;
  return width;
}

// ---------------------------------------------------------------------------
// Number formatting — shared with the popups and the perf HUD
// ---------------------------------------------------------------------------

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'QA', 'QI', 'SX', 'SP', 'OC', 'NO', 'DC'];

/** `1234` -> `1.2K`. Keeps popups short enough to read in one frame. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return 'INF';
  const neg = value < 0;
  let n = Math.abs(value);
  if (n < 1000) {
    const s = n < 10 && !Number.isInteger(n) ? n.toFixed(1) : String(Math.floor(n));
    return neg ? `-${s}` : s;
  }
  let tier = 0;
  while (n >= 1000 && tier < SUFFIXES.length - 1) {
    n /= 1000;
    tier++;
  }
  const s = (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.floor(n))) + SUFFIXES[tier];
  return neg ? `-${s}` : s;
}
