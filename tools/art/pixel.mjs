import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Buffer } from 'node:buffer';

export const PAL = Object.freeze({
  bg0: '#14161a', bg1: '#1e2127', bg2: '#252a31', bg3: '#2f353e', line: '#3c434e',
  fg2: '#6b7482', fg1: '#9aa4b2', fg0: '#d7dee8', green: '#4ec94e', green2: '#2f8f3a',
  amber: '#e8b34a', red: '#e5484d', blue: '#4a9de8', purple: '#9b6bd6', white: '#f2f6fb',
});

export const BAYER2 = Object.freeze([0, 2, 3, 1]);
export const BAYER4 = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
export const BAYER8 = Object.freeze([
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
]);

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const rounded = (value) => {
  const result = Math.round(Number(value));
  return Number.isFinite(result) ? result : null;
};

/** Convert a supported color value to an RGBA byte array. */
export function toRGBA(color, alpha = 255) {
  let value = color;
  if (typeof value === 'string' && Object.hasOwn(PAL, value)) value = PAL[value];
  let rgba;
  if (typeof value === 'string') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
      throw new Error(`Unknown color "${value}"; expected a PAL key or #rrggbb[aa]`);
    }
    rgba = [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
      value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255];
  } else if (Array.isArray(value) && (value.length === 3 || value.length === 4)) {
    rgba = [clampByte(value[0]), clampByte(value[1]), clampByte(value[2]),
      value.length === 4 ? clampByte(value[3]) : 255];
  } else {
    throw new Error('Invalid color; expected a PAL key, #rrggbb[aa], or RGB(A) array');
  }
  rgba[3] = Math.round(rgba[3] * clampByte(alpha) / 255);
  return rgba;
}

/** Linearly interpolate between two supported colors. */
export function mix(a, b, t) {
  const left = toRGBA(a);
  const right = toRGBA(b);
  const amount = clamp01(t);
  return left.map((channel, i) => Math.round(channel + (right[i] - channel) * amount));
}

const box = (cv, x, y, w, h) => {
  const px = rounded(x); const py = rounded(y); const pw = rounded(w); const ph = rounded(h);
  if (px === null || py === null || pw === null || ph === null || pw <= 0 || ph <= 0) return null;
  const x0 = Math.max(0, px); const y0 = Math.max(0, py);
  const x1 = Math.min(cv.w, px + pw); const y1 = Math.min(cv.h, py + ph);
  return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
};

const lineCode = (x, y, w, h) => (x < 0 ? 1 : x >= w ? 2 : 0) | (y < 0 ? 4 : y >= h ? 8 : 0);
const clipLine = (x0, y0, x1, y1, w, h) => {
  let a = lineCode(x0, y0, w, h); let b = lineCode(x1, y1, w, h);
  while (true) {
    if (!(a | b)) return [x0, y0, x1, y1];
    if (a & b) return null;
    const code = a || b;
    let x; let y;
    if (code & 8) {
      x = x0 + (x1 - x0) * (h - 1 - y0) / (y1 - y0);
      y = h - 1;
    } else if (code & 4) {
      x = x0 + (x1 - x0) * -y0 / (y1 - y0);
      y = 0;
    } else if (code & 2) {
      y = y0 + (y1 - y0) * (w - 1 - x0) / (x1 - x0);
      x = w - 1;
    } else {
      y = y0 + (y1 - y0) * -x0 / (x1 - x0);
      x = 0;
    }
    if (code === a) {
      x0 = x; y0 = y; a = lineCode(x0, y0, w, h);
    } else {
      x1 = x; y1 = y; b = lineCode(x1, y1, w, h);
    }
  }
};

export class Canvas {
  constructor(w, h, fillColor = null) {
    this.w = rounded(w);
    this.h = rounded(h);
    if (this.w === null || this.h === null || this.w < 0 || this.h < 0) {
      throw new RangeError('Canvas dimensions must be finite, non-negative integers');
    }
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
    if (fillColor !== null) this.fill(fillColor);
  }
  set(x, y, color, alpha = 255) {
    const px = rounded(x);
    const py = rounded(y);
    if (px === null || py === null || px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    const src = toRGBA(color, alpha);
    const offset = (py * this.w + px) * 4;
    const srcA = src[3] / 255;
    const dstA = this.data[offset + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) {
      this.data.fill(0, offset, offset + 4);
      return;
    }
    for (let i = 0; i < 3; i += 1) {
      this.data[offset + i] = Math.round(
        (src[i] * srcA + this.data[offset + i] * dstA * (1 - srcA)) / outA,
      );
    }
    this.data[offset + 3] = Math.round(outA * 255);
  }
  put(x, y, color, alpha = 255) {
    const px = rounded(x);
    const py = rounded(y);
    if (px === null || py === null || px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    const rgba = toRGBA(color, alpha);
    this.data.set(rgba, (py * this.w + px) * 4);
  }
  get(x, y) {
    const px = rounded(x);
    const py = rounded(y);
    if (px === null || py === null || px < 0 || py < 0 || px >= this.w || py >= this.h) {
      return [0, 0, 0, 0];
    }
    return Array.from(this.data.slice((py * this.w + px) * 4, (py * this.w + px) * 4 + 4));
  }
  alphaAt(x, y) {
    const px = rounded(x);
    const py = rounded(y);
    return px === null || py === null || px < 0 || py < 0 || px >= this.w || py >= this.h
      ? 0 : this.data[(py * this.w + px) * 4 + 3];
  }
  fill(color, alpha = 255) {
    const rgba = toRGBA(color, alpha);
    for (let i = 0; i < this.data.length; i += 4) this.data.set(rgba, i);
  }
  clear() {
    this.data.fill(0);
  }
  rect(x, y, w, h, color, alpha = 255) {
    const bounds = box(this, x, y, w, h);
    if (!bounds) return;
    for (let py = bounds[1]; py < bounds[3]; py += 1) {
      for (let px = bounds[0]; px < bounds[2]; px += 1) this.set(px, py, color, alpha);
    }
  }
  frame(x, y, w, h, color, alpha = 255) {
    const px = rounded(x); const py = rounded(y); const pw = rounded(w); const ph = rounded(h);
    if (px === null || py === null || pw === null || ph === null || pw <= 0 || ph <= 0) return;
    this.hline(px, px + pw - 1, py, color, alpha);
    if (ph > 1) this.hline(px, px + pw - 1, py + ph - 1, color, alpha);
    this.vline(px, py, py + ph - 1, color, alpha);
    if (pw > 1) this.vline(px + pw - 1, py, py + ph - 1, color, alpha);
  }
  hline(x0, x1, y, color, alpha = 255) {
    let left = rounded(x0); let right = rounded(x1); const py = rounded(y);
    if (left === null || right === null || py === null || py < 0 || py >= this.h) return;
    if (left > right) [left, right] = [right, left];
    left = Math.max(0, left); right = Math.min(this.w - 1, right);
    for (let x = left; x <= right; x += 1) this.set(x, py, color, alpha);
  }
  vline(x, y0, y1, color, alpha = 255) {
    const px = rounded(x); let top = rounded(y0); let bottom = rounded(y1);
    if (px === null || top === null || bottom === null || px < 0 || px >= this.w) return;
    if (top > bottom) [top, bottom] = [bottom, top];
    top = Math.max(0, top); bottom = Math.min(this.h - 1, bottom);
    for (let y = top; y <= bottom; y += 1) this.set(px, y, color, alpha);
  }
  line(x0, y0, x1, y1, color, alpha = 255) {
    const values = [x0, y0, x1, y1].map(rounded);
    if (values.some((value) => value === null) || this.w === 0 || this.h === 0) return;
    const clipped = clipLine(...values, this.w, this.h);
    if (!clipped) return;
    [x0, y0, x1, y1] = clipped.map(Math.round);
    const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.set(x0, y0, color, alpha);
      if (x0 === x1 && y0 === y1) break;
      const twice = error * 2;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }
  disc(cx, cy, r, color, alpha = 255) {
    const x = rounded(cx); const y = rounded(cy); const radius = Number(r);
    if (x === null || y === null || !Number.isFinite(radius) || radius < 0) return;
    const reach = Math.ceil(radius);
    const limit = radius * radius + radius * 0.5;
    for (let py = Math.max(0, y - reach); py <= Math.min(this.h - 1, y + reach); py += 1) {
      for (let px = Math.max(0, x - reach); px <= Math.min(this.w - 1, x + reach); px += 1) {
        if ((px - x) ** 2 + (py - y) ** 2 <= limit) this.set(px, py, color, alpha);
      }
    }
  }
  ring(cx, cy, r, color, alpha = 255) {
    const centerX = rounded(cx); const centerY = rounded(cy); const radius = rounded(r);
    if (centerX === null || centerY === null || radius === null || radius < 0) return;
    let x = radius; let y = 0; let decision = 1 - radius;
    const drawn = new Set();
    while (x >= y) {
      const points = [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]];
      for (const [dx, dy] of points) {
        const key = `${dx},${dy}`;
        if (!drawn.has(key)) { this.set(centerX + dx, centerY + dy, color, alpha); drawn.add(key); }
      }
      y += 1;
      if (decision < 0) decision += 2 * y + 1;
      else { x -= 1; decision += 2 * (y - x) + 1; }
    }
  }
  ellipse(cx, cy, rx, ry, color, alpha = 255) {
    const x = rounded(cx); const y = rounded(cy); const radiusX = rounded(rx); const radiusY = rounded(ry);
    if ([x, y, radiusX, radiusY].some((value) => value === null) || radiusX < 0 || radiusY < 0) return;
    if (radiusY === 0) { this.hline(x - radiusX, x + radiusX, y, color, alpha); return; }
    if (radiusX === 0) { this.vline(x, y - radiusY, y + radiusY, color, alpha); return; }
    const top = Math.max(0, y - radiusY); const bottom = Math.min(this.h - 1, y + radiusY);
    for (let py = top; py <= bottom; py += 1) {
      const span = Math.floor(radiusX * Math.sqrt(Math.max(0, 1 - ((py - y) / radiusY) ** 2)));
      this.hline(x - span, x + span, py, color, alpha);
    }
  }
  tri(x0, y0, x1, y1, x2, y2, color, alpha = 255) {
    const vertices = [[x0, y0], [x1, y1], [x2, y2]].map(([x, y]) => [rounded(x), rounded(y)]);
    if (vertices.flat().some((value) => value === null)) return;
    const minY = Math.max(0, Math.min(...vertices.map((point) => point[1])));
    const maxY = Math.min(this.h - 1, Math.max(...vertices.map((point) => point[1])));
    for (let y = minY; y <= maxY; y += 1) {
      const hits = [];
      for (let i = 0; i < 3; i += 1) {
        const [ax, ay] = vertices[i]; const [bx, by] = vertices[(i + 1) % 3];
        if (ay === by) { if (y === ay) hits.push(ax, bx); }
        else if (y >= Math.min(ay, by) && y <= Math.max(ay, by)) hits.push(ax + (y - ay) * (bx - ax) / (by - ay));
      }
      if (hits.length) this.hline(Math.ceil(Math.min(...hits)), Math.floor(Math.max(...hits)), y, color, alpha);
    }
  }
  blit(src, dx, dy, alpha = 255) {
    const targetX = rounded(dx); const targetY = rounded(dy);
    if (targetX === null || targetY === null || !src || !Number.isInteger(src.w) || !Number.isInteger(src.h)) return;
    const left = Math.max(0, -targetX); const top = Math.max(0, -targetY);
    const right = Math.min(src.w, this.w - targetX); const bottom = Math.min(src.h, this.h - targetY);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) this.set(targetX + x, targetY + y, src.get(x, y), alpha);
    }
  }
  sub(x, y, w, h) {
    const sourceX = rounded(x); const sourceY = rounded(y); const width = rounded(w); const height = rounded(h);
    const result = new Canvas(Math.max(0, width ?? 0), Math.max(0, height ?? 0));
    if (sourceX === null || sourceY === null) return result;
    for (let py = 0; py < result.h; py += 1) {
      for (let px = 0; px < result.w; px += 1) result.put(px, py, this.get(sourceX + px, sourceY + py));
    }
    return result;
  }
  clone() {
    const result = new Canvas(this.w, this.h);
    result.data.set(this.data);
    return result;
  }
  mapPixels(fn) {
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        const replacement = fn(x, y, this.get(x, y));
        if (Array.isArray(replacement)) this.put(x, y, replacement);
      }
    }
  }
  outline(color, alpha = 255, diagonals = false) {
    const snapshot = this.data.slice();
    const offsets = diagonals
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [-1, 0], [1, 0], [0, 1]];
    const oldAlpha = (x, y) => x < 0 || y < 0 || x >= this.w || y >= this.h
      ? 0 : snapshot[(y * this.w + x) * 4 + 3];
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        if (oldAlpha(x, y) !== 0) continue;
        if (offsets.some(([dx, dy]) => oldAlpha(x + dx, y + dy) >= 128)) this.put(x, y, color, alpha);
      }
    }
  }
  shadeRegion(x, y, w, h, color, t, matrix = 4) {
    const bounds = box(this, x, y, w, h);
    if (!bounds) return;
    const amount = clamp01(t);
    for (let py = bounds[1]; py < bounds[3]; py += 1) {
      for (let px = bounds[0]; px < bounds[2]; px += 1) {
        if (this.alphaAt(px, py) !== 0 && bayer(px, py, matrix) < amount) this.set(px, py, color);
      }
    }
  }
}

/** Return the normalized threshold from a supported Bayer matrix. */
export function bayer(x, y, matrix = 4) {
  const tables = { 2: BAYER2, 4: BAYER4, 8: BAYER8 };
  const n = Number(matrix);
  const table = tables[n];
  if (!table) throw new Error(`Unsupported Bayer matrix size: ${matrix}`);
  const px = ((rounded(x) ?? 0) % n + n) % n;
  const py = ((rounded(y) ?? 0) % n + n) % n;
  return table[py * n + px] / (n * n);
}

/** Fill a rectangle with a two-color ordered dither. */
export function ditherFill(cv, x, y, w, h, colorA, colorB, t, matrix = 4) {
  const bounds = box(cv, x, y, w, h);
  if (!bounds) return;
  const amount = clamp01(t);
  for (let py = bounds[1]; py < bounds[3]; py += 1) {
    for (let px = bounds[0]; px < bounds[2]; px += 1) cv.put(px, py, bayer(px, py, matrix) < amount ? colorB : colorA);
  }
}

/** Draw a vertical ordered-dither gradient. */
export function ditherGradientV(cv, x, y, w, h, colorTop, colorBottom, matrix = 4, opts = {}) {
  const originY = rounded(y); const height = rounded(h); const bounds = box(cv, x, y, w, h);
  if (!bounds || originY === null || height === null) return;
  for (let py = bounds[1]; py < bounds[3]; py += 1) {
    let t = height === 1 ? 0 : (py - originY) / (height - 1);
    if (typeof opts.ease === 'function') t = opts.ease(t);
    t = clamp01(t);
    for (let px = bounds[0]; px < bounds[2]; px += 1) cv.put(px, py, bayer(px, py, matrix) < t ? colorBottom : colorTop);
  }
}

/** Draw a horizontal ordered-dither gradient. */
export function ditherGradientH(cv, x, y, w, h, colorLeft, colorRight, matrix = 4, opts = {}) {
  const originX = rounded(x); const width = rounded(w); const bounds = box(cv, x, y, w, h);
  if (!bounds || originX === null || width === null) return;
  for (let px = bounds[0]; px < bounds[2]; px += 1) {
    let t = width === 1 ? 0 : (px - originX) / (width - 1);
    if (typeof opts.ease === 'function') t = opts.ease(t);
    t = clamp01(t);
    for (let py = bounds[1]; py < bounds[3]; py += 1) cv.put(px, py, bayer(px, py, matrix) < t ? colorRight : colorLeft);
  }
}

/** Draw a circular ordered-dither glow without changing pixels outside its radius. */
export function ditherRadial(cv, cx, cy, r, colorIn, colorOut, matrix = 4, opts = {}) {
  const centerX = rounded(cx); const centerY = rounded(cy); const radius = Number(r);
  if (centerX === null || centerY === null || !Number.isFinite(radius) || radius < 0) return;
  const reach = Math.ceil(radius);
  for (let y = Math.max(0, centerY - reach); y <= Math.min(cv.h - 1, centerY + reach); y += 1) {
    for (let x = Math.max(0, centerX - reach); x <= Math.min(cv.w - 1, centerX + reach); x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance > radius) continue;
      let t = radius === 0 ? 0 : clamp01(distance / radius);
      if (typeof opts.ease === 'function') t = clamp01(opts.ease(t));
      if (bayer(x, y, matrix) >= t) cv.put(x, y, colorIn);
      else if (opts.fillOut && opts.only !== 'in') cv.put(x, y, colorOut);
    }
  }
}

/** Create a deterministic mulberry32 random-number generator with helpers. */
export function makeRng(seed) {
  let state;
  if (typeof seed === 'string') {
    state = 0x811c9dc5;
    for (let i = 0; i < seed.length; i += 1) {
      state ^= seed.charCodeAt(i);
      state = Math.imul(state, 0x01000193) >>> 0;
    }
  } else state = Number(seed) >>> 0;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, maxInclusive) => {
    let low = Math.ceil(Number(min)); let high = Math.floor(Number(maxInclusive));
    if (low > high) [low, high] = [high, low];
    return low + Math.floor(rng() * (high - low + 1));
  };
  rng.pick = (array) => array.length ? array[rng.int(0, array.length - 1)] : undefined;
  rng.chance = (p) => rng() < clamp01(p);
  rng.range = (min, max) => Number(min) + rng() * (Number(max) - Number(min));
  return rng;
}

export const FONT3X5 = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['#.#', '###', '###', '###', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '.#.', '..#'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '##.'],
  '.': ['...', '...', '...', '...', '.#.'], ',': ['...', '...', '...', '.#.', '#..'],
  ':': ['...', '.#.', '...', '.#.', '...'], ';': ['...', '.#.', '...', '.#.', '#..'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'], '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'], '\\': ['#..', '#..', '.#.', '..#', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'], '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '=': ['...', '###', '...', '###', '...'], _: ['...', '...', '...', '...', '###'],
  '*': ['...', '#.#', '.#.', '#.#', '...'], '#': ['#.#', '###', '#.#', '###', '#.#'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'], $: ['.##', '##.', '.#.', '.##', '##.'],
  '(': ['..#', '.#.', '.#.', '.#.', '..#'], ')': ['#..', '.#.', '.#.', '.#.', '#..'],
  '[': ['.##', '.#.', '.#.', '.#.', '.##'], ']': ['##.', '.#.', '.#.', '.#.', '##.'],
  "'": ['.#.', '.#.', '...', '...', '...'], '"': ['#.#', '#.#', '...', '...', '...'],
  ' ': ['...', '...', '...', '...', '...'],
};

/** Draw a string in the built-in 3x5 bitmap font and return its width. */
export function text(cv, x, y, str, color, alpha = 255, spacing = 1) {
  const chars = Array.from(String(str).toUpperCase());
  const startX = rounded(x); const startY = rounded(y); const gap = rounded(spacing) ?? 1;
  if (startX === null || startY === null) return textWidth(str, gap);
  chars.forEach((char, index) => {
    const glyph = FONT3X5[char] ?? FONT3X5[' '];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row][column] === '#') cv.set(startX + index * (3 + gap) + column, startY + row, color, alpha);
      }
    }
  });
  return textWidth(chars.join(''), gap);
}

/** Measure a string rendered in the built-in 3x5 bitmap font. */
export function textWidth(str, spacing = 1) {
  const length = Array.from(String(str)).length;
  return length === 0 ? 0 : length * 3 + (length - 1) * (rounded(spacing) ?? 1);
}

let crcTable;
/** Calculate an unsigned CRC-32 for a byte buffer. */
export function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const paeth = (left, up, upperLeft) => {
  const estimate = left + up - upperLeft;
  const dl = Math.abs(estimate - left); const du = Math.abs(estimate - up); const dul = Math.abs(estimate - upperLeft);
  return dl <= du && dl <= dul ? left : du <= dul ? up : upperLeft;
};

const filteredRow = (row, previous, type) => {
  const output = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= 4 ? row[i - 4] : 0;
    const up = previous ? previous[i] : 0;
    const upperLeft = previous && i >= 4 ? previous[i - 4] : 0;
    let predictor = 0;
    if (type === 1) predictor = left;
    else if (type === 2) predictor = up;
    else if (type === 3) predictor = Math.floor((left + up) / 2);
    else if (type === 4) predictor = paeth(left, up, upperLeft);
    output[i] = (row[i] - predictor + 256) & 0xff;
  }
  return output;
};

const chunk = (type, data = Buffer.alloc(0)) => {
  const name = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(8); const footer = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0); name.copy(header, 4);
  footer.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([header, data, footer]);
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Encode a Canvas as a deterministic 8-bit RGBA PNG buffer. */
export function encodePNG(canvas, opts = {}) {
  if (!canvas || canvas.w < 1 || canvas.h < 1 || canvas.data.length !== canvas.w * canvas.h * 4) {
    throw new Error('encodePNG requires a non-empty RGBA Canvas');
  }
  const stride = canvas.w * 4;
  const raw = Buffer.alloc((stride + 1) * canvas.h);
  let previous = null;
  for (let y = 0; y < canvas.h; y += 1) {
    const row = Buffer.from(canvas.data.subarray(y * stride, (y + 1) * stride));
    let bestType = 0; let best = filteredRow(row, previous, 0); let bestScore = Infinity;
    for (let type = 0; type <= 4; type += 1) {
      const candidate = type === 0 ? best : filteredRow(row, previous, type);
      let score = 0;
      for (const byte of candidate) score += Math.min(byte, 256 - byte);
      if (score < bestScore) { bestType = type; best = candidate; bestScore = score; }
    }
    const offset = y * (stride + 1);
    raw[offset] = bestType; best.copy(raw, offset + 1); previous = row;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.w, 0); ihdr.writeUInt32BE(canvas.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND')]);
}

/** Encode a Canvas to a PNG file and return its basic metadata. */
export function writePNG(filePath, canvas) {
  const encoded = encodePNG(canvas);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, encoded);
  return { path: filePath, bytes: encoded.length, w: canvas.w, h: canvas.h };
}

/** Read and validate the dimensions in a PNG file's IHDR chunk. */
export function decodePNGSize(filePath) {
  const data = readFileSync(filePath);
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Not a PNG file: ${filePath}`);
  }
  if (data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`PNG is missing a valid IHDR chunk: ${filePath}`);
  }
  return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
}
