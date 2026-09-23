#!/usr/bin/env node
/**
 * `npm run verify:atlas`: fail loudly if the shipped art does not cover the
 * game.
 *
 * Stage atlas (src/render/atlas.ts): every REQUIRED_SPRITES key (which derives
 * gadget and pickup keys from content.ts) is declared, on a sheet that exists,
 * with frames inside the sheet, no two frames overlapping, and animations
 * declaring a frame rate and a single frame size.
 *
 * Icon sheet (src/render/icon-map.ts): an icon for every id the UI may ask
 * for, enumerated from content.ts (tool_, upg_, card_, meta_, pickup_, each
 * achievement's icon, the ui_* glyphs), each in its own cell inside the grid,
 * and a PNG on disk of exactly that grid.
 *
 * Needs a Node that can import TypeScript directly (22.18+ or 23.6+).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePNGSize } from './pixel.mjs';
import { iconIds, loadRenderContract } from './content.mjs';

const ATLAS_URL = new URL('../../src/render/atlas.ts', import.meta.url);
const ICON_MAP_URL = new URL('../../src/render/icon-map.ts', import.meta.url);
const ICON_PNG = fileURLToPath(new URL('../../public/sprites/icons.png', import.meta.url));

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

async function verifyAtlas(failures) {
  const { REQUIRED_SPRITES } = await loadRenderContract();
  const manifest = (await import(ATLAS_URL.href)).default;
  if (!manifest?.sheets || !manifest?.sprites) {
    failures.push('src/render/atlas.ts does not default-export a manifest');
    return { sprites: 0, frames: 0, sheets: 0 };
  }
  const sizes = {};
  for (const [key, url] of Object.entries(manifest.sheets)) {
    const path = url.startsWith('file:') ? fileURLToPath(url) : url;
    if (!existsSync(path)) {
      failures.push(`sheet ${key} is missing on disk (${path})`);
      continue;
    }
    sizes[key] = decodePNGSize(path);
  }
  for (const key of REQUIRED_SPRITES) {
    const def = manifest.sprites[key];
    if (!def) failures.push(`required sprite ${key} is missing from the atlas`);
    else if (!def.frames?.length) failures.push(`required sprite ${key} has no frames`);
  }
  for (const key of Object.keys(manifest.sprites)) {
    if (!REQUIRED_SPRITES.includes(key)) failures.push(`atlas declares ${key}, which nothing requires`);
  }
  const bySheet = {};
  for (const [key, def] of Object.entries(manifest.sprites)) {
    if (!Object.hasOwn(manifest.sheets, def.sheet)) failures.push(`${key} uses undeclared sheet ${def.sheet}`);
    const size = sizes[def.sheet];
    const first = def.frames[0];
    def.frames.forEach((f, i) => {
      if (!(f.w > 0 && f.h > 0)) failures.push(`${key} frame ${i} has non-positive size`);
      if (size && (f.x < 0 || f.y < 0 || f.x + f.w > size.w || f.y + f.h > size.h)) {
        failures.push(`${key} frame ${i} (${f.x},${f.y},${f.w},${f.h}) lies outside ${def.sheet} (${size.w}x${size.h})`);
      }
      if (first && (f.w !== first.w || f.h !== first.h)) failures.push(`${key} frames differ in size`);
      (bySheet[def.sheet] ??= []).push({ key, i, f });
    });
    if (def.frames.length > 1 && !(def.fps > 0)) failures.push(`${key} has ${def.frames.length} frames but no fps`);
  }
  for (const [sheet, frames] of Object.entries(bySheet)) {
    for (let a = 0; a < frames.length; a++) {
      for (let b = a + 1; b < frames.length; b++) {
        if (overlaps(frames[a].f, frames[b].f)) {
          failures.push(`${frames[a].key}#${frames[a].i} overlaps ${frames[b].key}#${frames[b].i} on ${sheet}`);
        }
      }
    }
  }
  const frames = Object.values(manifest.sprites).reduce((n, d) => n + d.frames.length, 0);
  return { sprites: Object.keys(manifest.sprites).length, frames, sheets: Object.keys(manifest.sheets).length };
}

async function verifyIcons(failures) {
  const { all } = await iconIds();
  const map = await import(ICON_MAP_URL.href);
  const icons = map.ICONS ?? {};
  const missing = all.filter((id) => !icons[id]);
  if (missing.length) failures.push(`icon sheet is missing ${missing.length} id(s): ${missing.join(', ')}`);
  const wanted = new Set(all);
  const extra = Object.keys(icons).filter((id) => !wanted.has(id));
  if (extra.length) failures.push(`icon sheet has ids content does not know: ${extra.join(', ')}`);
  const cells = new Map();
  for (const [id, [col, row]] of Object.entries(icons)) {
    if (col < 0 || row < 0 || col >= map.ICON_COLS || row >= map.ICON_ROWS) failures.push(`${id} is outside the icon grid`);
    const cell = `${col},${row}`;
    if (cells.has(cell)) failures.push(`${id} shares cell ${cell} with ${cells.get(cell)}`);
    cells.set(cell, id);
  }
  if (!existsSync(ICON_PNG)) failures.push('public/sprites/icons.png is missing');
  else {
    const size = decodePNGSize(ICON_PNG);
    const w = map.ICON_COLS * map.ICON_SIZE;
    const h = map.ICON_ROWS * map.ICON_SIZE;
    if (size.w !== w || size.h !== h) failures.push(`icons.png is ${size.w}x${size.h}; the manifest grid is ${w}x${h}`);
  }
  return { icons: Object.keys(icons).length, expected: all.length };
}

async function main() {
  const failures = [];
  const atlas = await verifyAtlas(failures);
  const icons = await verifyIcons(failures);
  if (failures.length) {
    for (const f of failures) process.stderr.write(`FAIL: ${f}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `verify-atlas: OK. ${atlas.sprites} sprites, ${atlas.frames} frames, ${atlas.sheets} sheets; `
      + `${icons.icons}/${icons.expected} icons\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`verify-atlas: ${error.stack ?? error}\n`);
  process.exit(1);
});
