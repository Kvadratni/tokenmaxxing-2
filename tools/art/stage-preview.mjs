#!/usr/bin/env node
/**
 * Headless stage previews: runs the real renderer (src/render) against a tiny
 * Canvas2D stand-in that paints into a pixel buffer, with the real atlas
 * sheets decoded from public/sprites, and writes PNGs of named moments to
 * artifacts/stage/.
 *
 *   npx vite-node tools/art/stage-preview.mjs            every scenario
 *   npx vite-node tools/art/stage-preview.mjs panic      one of them
 *   npx vite-node tools/art/stage-preview.mjs --no-atlas the procedural fallback
 *
 * vite-node, not node: the renderer finds its atlas through import.meta.glob.
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Canvas, writePNG } from './pixel.mjs';
import { createRenderer } from '../../src/render/index.ts';
import { SCENARIOS, SETTINGS } from './stage-scenarios.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const W = 320;
const H = 180;

// ---------------------------------------------------------------------------
// PNG decode (RGBA8, as written by pixel.mjs)
// ---------------------------------------------------------------------------

function decodePNG(path) {
  const buf = readFileSync(path);
  let off = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let p = 0;
      if (ft === 1) p = a;
      else if (ft === 2) p = b;
      else if (ft === 3) p = (a + b) >> 1;
      else if (ft === 4) {
        const e = a + b - c;
        const pa = Math.abs(e - a);
        const pb = Math.abs(e - b);
        const pc = Math.abs(e - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = (row[i] + p) & 255;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------
// A Canvas2D stand-in: scale + translate transforms, fillRect, drawImage.
// ---------------------------------------------------------------------------

function parseColor(style) {
  if (typeof style !== 'string') return [255, 0, 255, 1];
  if (style[0] === '#') {
    const h = style.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(style);
  if (m) {
    const p = m[1].split(',').map((s) => Number(s.trim()));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return [255, 0, 255, 1];
}

class PixelCtx {
  constructor(canvas, w, h) {
    this.canvas = canvas;
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.t = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.fillStyle = '#000000';
    this.globalAlpha = 1;
    this.imageSmoothingEnabled = false;
    this.globalCompositeOperation = 'source-over';
  }
  save() {
    this.stack.push({ t: [...this.t], fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.t = s.t;
    this.fillStyle = s.fillStyle;
    this.globalAlpha = s.globalAlpha;
  }
  setTransform(a, b, c, d, e, f) {
    this.t = [a, b, c, d, e, f];
  }
  resetTransform() {
    this.t = [1, 0, 0, 1, 0, 0];
  }
  translate(x, y) {
    const [a, b, c, d, e, f] = this.t;
    this.t = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(sx, sy) {
    const [a, b, c, d, e, f] = this.t;
    this.t = [a * sx, b * sx, c * sy, d * sy, e, f];
  }
  map(x, y) {
    const [a, , , d, e, f] = this.t;
    return [a * x + e, d * y + f];
  }
  blend(i, r, g, b, a) {
    if (a <= 0) return;
    const d = this.data;
    if (a >= 1) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
      return;
    }
    d[i] = d[i] * (1 - a) + r * a;
    d[i + 1] = d[i + 1] * (1 - a) + g * a;
    d[i + 2] = d[i + 2] * (1 - a) + b * a;
    d[i + 3] = Math.min(255, d[i + 3] + 255 * a);
  }
  fillRect(x, y, w, h) {
    const [x0, y0] = this.map(x, y);
    const [x1, y1] = this.map(x + w, y + h);
    const [r, g, b, a0] = parseColor(this.fillStyle);
    const a = a0 * this.globalAlpha;
    const lx = Math.max(0, Math.round(Math.min(x0, x1)));
    const rx = Math.min(this.w, Math.round(Math.max(x0, x1)));
    const ty = Math.max(0, Math.round(Math.min(y0, y1)));
    const by = Math.min(this.h, Math.round(Math.max(y0, y1)));
    for (let py = ty; py < by; py++) for (let px = lx; px < rx; px++) this.blend((py * this.w + px) * 4, r, g, b, a);
  }
  clearRect(x, y, w, h) {
    const [x0, y0] = this.map(x, y);
    const [x1, y1] = this.map(x + w, y + h);
    for (let py = Math.max(0, Math.round(y0)); py < Math.min(this.h, Math.round(y1)); py++) {
      for (let px = Math.max(0, Math.round(x0)); px < Math.min(this.w, Math.round(x1)); px++) {
        this.data.fill(0, (py * this.w + px) * 4, (py * this.w + px) * 4 + 4);
      }
    }
  }
  drawImage(img, ...args) {
    const src = img?.__pixels ?? (img?.__ctx ? { width: img.__ctx.w, height: img.__ctx.h, data: img.__ctx.data } : null);
    if (!src) return;
    let sx = 0;
    let sy = 0;
    let sw = src.width;
    let sh = src.height;
    let dx;
    let dy;
    let dw;
    let dh;
    if (args.length === 2) [dx, dy] = args;
    else if (args.length === 4) [dx, dy, dw, dh] = args;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    dw ??= sw;
    dh ??= sh;
    if (img?.__ctx === this) return; // self-blit (the glitch tear): skipped here
    const [x0, y0] = this.map(dx, dy);
    const [x1, y1] = this.map(dx + dw, dy + dh);
    const tw = x1 - x0;
    const th = y1 - y0;
    if (tw <= 0 || th <= 0) return;
    const alpha = this.globalAlpha;
    for (let py = Math.max(0, Math.round(y0)); py < Math.min(this.h, Math.round(y1)); py++) {
      const v = Math.floor(sy + ((py + 0.5 - y0) / th) * sh);
      if (v < 0 || v >= src.height) continue;
      for (let px = Math.max(0, Math.round(x0)); px < Math.min(this.w, Math.round(x1)); px++) {
        const u = Math.floor(sx + ((px + 0.5 - x0) / tw) * sw);
        if (u < 0 || u >= src.width) continue;
        const si = (v * src.width + u) * 4;
        const a = (src.data[si + 3] / 255) * alpha;
        if (a > 0) this.blend((py * this.w + px) * 4, src.data[si], src.data[si + 1], src.data[si + 2], a);
      }
    }
  }
  // Unused by the renderer's hot paths, present so nothing throws.
  beginPath() {}
  closePath() {}
  fill() {}
  stroke() {}
  clip() {}
  rect() {}
  moveTo() {}
  lineTo() {}
  setLineDash() {}
  fillText() {}
  measureText(text) {
    return { width: String(text).length * 6 };
  }
  createImageData(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData() {}
}

function makeCanvas() {
  const canvas = {
    width: W,
    height: H,
    style: {},
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 }),
  };
  const ctx = new PixelCtx(canvas, W, H);
  canvas.__ctx = ctx;
  canvas.getContext = () => ctx;
  return { canvas, ctx };
}

async function loadSheet(url) {
  const path = url.startsWith('file:') ? fileURLToPath(url) : resolve(ROOT, url.replace(/^\//, ''));
  const png = decodePNG(path);
  return { __pixels: png, width: png.width, height: png.height };
}

async function render(name, scenario, noAtlas) {
  const { canvas, ctx } = makeCanvas();
  const r = createRenderer(canvas, {
    measure: () => ({ w: W, h: H }),
    dpr: () => 1,
    sheetTimeoutMs: 50,
    loadImage: noAtlas ? async () => null : loadSheet,
  });
  await r.whenReady();
  const dt = 1 / 60;
  const events = [...scenario.events].sort((a, b) => a[0] - b[0]);
  for (let t = 0; t <= scenario.at + 1e-9; t += dt) {
    while (events.length && events[0][0] <= t) r.handle(events.shift()[1]);
    const pre = scenario.before && events.some(([, e]) => e.t === 'compactStart');
    const d = pre ? { ...scenario.derived, contextFill: scenario.before.contextFill } : scenario.derived;
    const rr = pre ? { ...scenario.run, context: scenario.before.context } : scenario.run;
    r.draw({ run: rr, derived: d, settings: SETTINGS, dt, time: t });
  }
  const stats = r.renderStats();
  r.destroy();
  const out = new Canvas(W, H);
  out.data.set(ctx.data);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  const big = new Canvas(W * 3, H * 3);
  for (let y = 0; y < H * 3; y++) {
    for (let x = 0; x < W * 3; x++) {
      const si = (Math.floor(y / 3) * W + Math.floor(x / 3)) * 4;
      big.data.set(out.data.subarray(si, si + 4), (y * W * 3 + x) * 4);
    }
  }
  const file = `artifacts/stage/stage-${name}${noAtlas ? '-noatlas' : ''}.png`;
  writePNG(resolve(ROOT, file), big);
  const s = stats.stage;
  process.stdout.write(
    `${file}: human=${s.human}/${s.humanMood} agent=${s.agent} pile=${s.pileFill.toFixed(2)} `
      + `line="${s.promptLine}" stamp=${s.stamp} bubble=${s.bubble} missing=${stats.missingSprites.length} `
      + `failed=${stats.failedSheets.join(',')}\n`,
  );
}

const args = process.argv.slice(2);
const noAtlas = args.includes('--no-atlas');
const only = args.filter((a) => !a.startsWith('--'));
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  if (only.length && !only.includes(name)) continue;
  await render(name, scenario, noAtlas);
}
