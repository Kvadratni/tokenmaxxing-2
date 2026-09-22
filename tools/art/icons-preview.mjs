import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Canvas, PAL, text, textWidth, writePNG } from './pixel.mjs';
import { buildIcons } from './icons.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCALE = 4;
const COLS = 8;
const CELL_W = 112;
const CELL_H = 84;
const ICON_PX = 16 * SCALE;

function checkerboard(canvas) {
  canvas.fill(PAL.bg1);
  for (let y = 0; y < canvas.h; y += 8) {
    for (let x = 0; x < canvas.w; x += 8) {
      if ((x / 8 + y / 8) % 2 === 0) canvas.rect(x, y, 8, 8, PAL.bg2);
    }
  }
}

function blitNearest(canvas, source, dx, dy, scale) {
  for (let y = 0; y < source.h; y += 1) {
    for (let x = 0; x < source.w; x += 1) {
      const color = source.get(x, y);
      if (color[3] !== 0) canvas.rect(dx + x * scale, dy + y * scale, scale, scale, color);
    }
  }
}

function familyColor(index) {
  if (index < 10) return PAL.green;
  if (index < 28) return index < 15 ? PAL.amber : index < 25 ? PAL.blue : index < 27 ? PAL.red : PAL.fg0;
  if (index < 50) return index % 2 === 0 ? PAL.purple : PAL.blue;
  return PAL.amber;
}

export function buildIconsPreview() {
  const { cells } = buildIcons();
  const rows = Math.ceil(cells.length / COLS);
  const preview = new Canvas(COLS * CELL_W, rows * CELL_H);
  checkerboard(preview);

  cells.forEach((cell, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const x = col * CELL_W;
    const y = row * CELL_H;
    preview.frame(x, y, CELL_W, CELL_H, PAL.line);
    preview.rect(x, y + 68, CELL_W, 16, PAL.bg0);
    preview.rect(x + 1, y + 68, 2, 15, familyColor(index));
    blitNearest(preview, cell.canvas, x + Math.floor((CELL_W - ICON_PX) / 2), y + 2, SCALE);
    const labelX = x + Math.floor((CELL_W - textWidth(cell.id)) / 2);
    text(preview, labelX, y + 74, cell.id, PAL.fg0);
  });

  return preview;
}

function writePreview() {
  const canvas = buildIconsPreview();
  const output = join(ROOT, 'artifacts/icons-preview.png');
  writePNG(output, canvas);
  console.log(`icons preview: ${canvas.w}x${canvas.h} -> artifacts/icons-preview.png`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writePreview();
