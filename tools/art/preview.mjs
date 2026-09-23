#!/usr/bin/env node
/**
 * A labelled contact sheet of every stage sprite, every frame, at 3x:
 * artifacts/stage/sprites.png. For eyeballing art without running the game.
 *
 *   node tools/art/preview.mjs
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, PAL, text, writePNG } from './pixel.mjs';
import { buildStageSprites } from './build-art.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARGIN = 6;
const GUTTER = 4;
const LABEL = 8;
const WIDTH = 660;

function checkerboard(canvas) {
  for (let y = 0; y < canvas.h; y += 8) {
    for (let x = 0; x < canvas.w; x += 8) canvas.rect(x, y, 8, 8, (x / 8 + y / 8) % 2 === 0 ? PAL.bg0 : PAL.bg1);
  }
}

function nearest(source, k) {
  const out = new Canvas(source.w * k, source.h * k);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const si = (Math.floor(y / k) * source.w + Math.floor(x / k)) * 4;
      out.data.set(source.data.subarray(si, si + 4), (y * out.w + x) * 4);
    }
  }
  return out;
}

async function main() {
  const { rooms, stage } = await buildStageSprites();
  const entries = [...Object.entries(rooms).map(([k, c]) => [k, { frames: [c] }]), ...Object.entries(stage)];
  // Lay rows out greedily: each sprite is a labelled strip of its frames.
  const placed = [];
  let x = MARGIN;
  let y = MARGIN;
  let row = 0;
  for (const [key, sprite] of entries) {
    const w = sprite.frames.reduce((n, f) => n + f.w + GUTTER, -GUTTER);
    const h = Math.max(...sprite.frames.map((f) => f.h)) + LABEL;
    const width = Math.max(w, key.length * 4);
    if (x + width > WIDTH - MARGIN && x > MARGIN) {
      x = MARGIN;
      y += row + GUTTER * 2;
      row = 0;
    }
    placed.push({ key, sprite, x, y });
    x += width + GUTTER * 3;
    row = Math.max(row, h);
  }
  const sheet = new Canvas(WIDTH, y + row + MARGIN);
  checkerboard(sheet);
  for (const { key, sprite, x: px, y: py } of placed) {
    text(sheet, px, py, key, PAL.fg1);
    let fx = px;
    for (const f of sprite.frames) {
      sheet.blit(f, fx, py + LABEL);
      fx += f.w + GUTTER;
    }
  }
  const out = resolve(ROOT, 'artifacts/stage/sprites.png');
  const png = writePNG(out, nearest(sheet, 2));
  process.stdout.write(`${entries.length} sprites -> artifacts/stage/sprites.png (${png.w}x${png.h})\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
