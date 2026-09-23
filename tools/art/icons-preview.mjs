#!/usr/bin/env node
/**
 * Labelled, 4x previews of the icon sheet, for eyeballing.
 *
 *   node tools/art/icons-preview.mjs              every icon -> artifacts/stage/icons.png
 *   node tools/art/icons-preview.mjs upg          one family -> artifacts/stage/icons-upg.png
 *   node tools/art/icons-preview.mjs legacy       game 1's drawers, by game 1 id
 *
 * Families: tool, upg, card, meta, pickup, achv, ui. Missing drawers show as
 * red placeholders here (the real build refuses them), and every problem is
 * listed on stdout.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Canvas, PAL, makeRng, text, textWidth, writePNG } from './pixel.mjs';
import { buildIcons } from './icons.mjs';
import { LEGACY_IDS, legacy } from './icons/legacy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCALE = 4;
const COLS = 8;
const CELL_W = 124;
const CELL_H = 84;

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

/** Grid of labelled cells; each icon also shown at 1x, which is how the UI sees it. */
export function previewSheet(cells) {
  const rows = Math.max(1, Math.ceil(cells.length / COLS));
  const out = new Canvas(COLS * CELL_W, rows * CELL_H);
  checkerboard(out);
  cells.forEach((cell, index) => {
    const x = (index % COLS) * CELL_W;
    const y = Math.floor(index / COLS) * CELL_H;
    out.frame(x, y, CELL_W, CELL_H, PAL.line);
    out.rect(x, y + 68, CELL_W, 16, PAL.bg0);
    blitNearest(out, cell.canvas, x + 8, y + 2, SCALE);
    out.blit(cell.canvas, x + 8 + 16 * SCALE + 10, y + 26);
    const label = cell.id.length > 30 ? `${cell.id.slice(0, 29)}~` : cell.id;
    text(out, x + Math.max(2, Math.floor((CELL_W - textWidth(label)) / 2)), y + 74, label, PAL.fg0);
  });
  return out;
}

async function main() {
  const which = process.argv[2] ?? 'all';
  let cells;
  if (which === 'legacy') {
    cells = LEGACY_IDS.map((id) => ({ id, canvas: legacy(id)(makeRng(`legacy:${id}`)) }));
  } else {
    const built = await buildIcons({ partial: true });
    cells = which === 'all' ? built.cells : built.cells.filter((c) => c.family === which);
    const relevant = which === 'all'
      ? built.problems
      : built.problems.filter((p) => cells.some((c) => p.includes(c.id)));
    for (const p of relevant) process.stdout.write(`problem: ${p}\n`);
    const near = built.near.filter((n) => which === 'all' || cells.some((c) => c.id === n.a || c.id === n.b));
    for (const n of near) process.stdout.write(`near-twin: ${n.a} ~ ${n.b} (${Math.round(n.iou * 100)}%)\n`);
  }
  const name = which === 'all' ? 'icons' : `icons-${which}`;
  const path = resolve(ROOT, `artifacts/stage/${name}.png`);
  const png = writePNG(path, previewSheet(cells));
  process.stdout.write(`${cells.length} icons -> artifacts/stage/${name}.png (${png.w}x${png.h})\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  });
}
