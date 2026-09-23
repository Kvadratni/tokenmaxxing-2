/**
 * The UI icon sheet: one 16x16 cell per id the UI can ask for.
 *
 * The id list is enumerated from content.ts (see ./content.mjs), never typed
 * out here: tool_<id>, upg_<id>, card_<id>, meta_<id>, pickup_<id>, every
 * achievement's `icon` field, and ui_thumbs / ui_context / ui_patience /
 * ui_compact / ui_claim. Each family module under ./icons/ maps full icon ids
 * to drawers. A missing drawer, a rule-breaking icon or two icons that are
 * reskins of one another fail the build.
 *
 * Outputs public/sprites/icons.png and src/render/icon-map.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Canvas, PAL, makeRng, writePNG } from './pixel.mjs';
import { ICON_SIZE } from './icons/kit.mjs';
import { iconIds } from './content.mjs';

export const ICON_COLS = 16;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PNG_PATH = resolve(ROOT, 'public/sprites/icons.png');
const MAP_PATH = resolve(ROOT, 'src/render/icon-map.ts');

/** Family -> [module, export name]. Loaded one by one so a broken family is isolated. */
const FAMILY_MODULES = Object.freeze({
  tool: ['./icons/tools.mjs', 'TOOL_ICONS'],
  upg: ['./icons/upgrades.mjs', 'UPGRADE_ICONS'],
  card: ['./icons/cards.mjs', 'CARD_ICONS'],
  meta: ['./icons/meta.mjs', 'META_ICONS'],
  pickup: ['./icons/pickups.mjs', 'PICKUP_ICONS'],
  achv: ['./icons/achievements.mjs', 'ACHIEVEMENT_ICONS'],
  ui: ['./icons/ui.mjs', 'UI_ICONS'],
});

async function loadDrawers(problems) {
  const out = {};
  for (const [family, [path, name]] of Object.entries(FAMILY_MODULES)) {
    try {
      const mod = await import(new URL(path, import.meta.url).href);
      out[family] = mod[name] ?? {};
      if (!mod[name]) problems.push(`${path} does not export ${name}`);
    } catch (error) {
      out[family] = {};
      problems.push(`${path} failed to load: ${error.message}`);
    }
  }
  return out;
}

const paletteColors = new Set(
  Object.values(PAL).map((hex) => hex.slice(1).match(/../g).map((p) => Number.parseInt(p, 16)).join(',')),
);

/** Throws when an icon breaks the house rules (see icons/kit.mjs). */
export function validateIcon(id, canvas) {
  if (!(canvas instanceof Canvas) || canvas.w !== ICON_SIZE || canvas.h !== ICON_SIZE) {
    throw new Error(`${id} is not a ${ICON_SIZE}x${ICON_SIZE} canvas`);
  }
  let opaque = 0;
  const colors = new Set();
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const [r, g, b, a] = canvas.get(x, y);
      if (a === 0) continue;
      opaque += 1;
      if (x === 0 || y === 0 || x === ICON_SIZE - 1 || y === ICON_SIZE - 1) {
        throw new Error(`${id} breaks the 1px transparent margin at ${x},${y}`);
      }
      if (a !== 255 || !paletteColors.has(`${r},${g},${b}`)) {
        throw new Error(`${id} uses a non-palette pixel at ${x},${y} (${r},${g},${b},${a})`);
      }
      colors.add(`${r},${g},${b}`);
    }
  }
  if (opaque < 12) throw new Error(`${id} is (nearly) empty`);
  if (colors.size > 4) throw new Error(`${id} uses ${colors.size} colours; at most 4`);
}

function mask(canvas) {
  const bits = new Uint8Array(ICON_SIZE * ICON_SIZE);
  for (let i = 0; i < bits.length; i += 1) bits[i] = canvas.data[i * 4 + 3] ? 1 : 0;
  return bits;
}

/**
 * Internal structure: 1 wherever a pixel differs from its right or lower
 * neighbour. Two reskins (same drawing, other colours) share this exactly;
 * two different drawings that happen to be round do not.
 */
function edges(canvas) {
  const bits = new Uint8Array(ICON_SIZE * ICON_SIZE);
  const key = (x, y) => {
    const i = (y * ICON_SIZE + x) * 4;
    return canvas.data[i + 3] ? (canvas.data[i] << 16) | (canvas.data[i + 1] << 8) | canvas.data[i + 2] : -1;
  };
  for (let y = 0; y < ICON_SIZE - 1; y += 1) {
    for (let x = 0; x < ICON_SIZE - 1; x += 1) {
      const k = key(x, y);
      bits[y * ICON_SIZE + x] = k !== key(x + 1, y) || k !== key(x, y + 1) ? 1 : 0;
    }
  }
  return bits;
}

function iou(a, b) {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) inter += 1;
    if (a[i] || b[i]) union += 1;
  }
  return union === 0 ? 1 : inter / union;
}

/**
 * Reskin check. The same silhouette with the same internal drawing is an
 * error: that is a reskin, whatever the colours. A near match on both counts
 * is returned so it can be looked at.
 */
export function distinctness(cells) {
  const errors = [];
  const near = [];
  const masks = cells.map((c) => mask(c.canvas));
  const lines = cells.map((c) => edges(c.canvas));
  for (let a = 0; a < cells.length; a += 1) {
    for (let b = a + 1; b < cells.length; b += 1) {
      const shape = iou(masks[a], masks[b]);
      if (shape < 0.85) continue;
      const detail = iou(lines[a], lines[b]);
      if (shape === 1 && detail === 1) {
        errors.push(`${cells[a].id} and ${cells[b].id} are the same drawing (a reskin)`);
      } else if (shape >= 0.9 && detail >= 0.75) {
        near.push({ a: cells[a].id, b: cells[b].id, iou: Math.min(shape, detail) });
      }
    }
  }
  return { errors, near };
}

/** Placeholder for previews of a half-finished family. Never shipped. */
function placeholder() {
  const cv = new Canvas(ICON_SIZE, ICON_SIZE);
  cv.frame(2, 2, 12, 12, PAL.red);
  cv.line(2, 2, 13, 13, PAL.red);
  return cv;
}

/**
 * Build every cell in sheet order. With `partial`, missing or broken drawers
 * become red placeholders (for previews while a family is being drawn);
 * without it, they throw.
 */
export async function buildIcons({ partial = false } = {}) {
  const { families } = await iconIds();
  const cells = [];
  const problems = [];
  const DRAWERS = await loadDrawers(problems);
  for (const { family, ids } of families) {
    const table = DRAWERS[family];
    for (const id of ids) {
      // Each icon gets its own seeded rng, so editing one never reshuffles another.
      const rng = makeRng(`tokenmaxxing2-icon:${id}`);
      let canvas;
      try {
        const draw = table?.[id];
        if (typeof draw !== 'function') throw new Error(`${id} has no drawer in icons/${family}`);
        canvas = draw(rng);
        validateIcon(id, canvas);
      } catch (error) {
        if (!partial) problems.push(error.message);
        canvas = placeholder();
        if (partial) problems.push(error.message);
      }
      cells.push({ id, family, canvas });
    }
  }
  const extraKeys = [];
  for (const [family, table] of Object.entries(DRAWERS)) {
    const wanted = new Set(families.find((f) => f.family === family)?.ids ?? []);
    for (const key of Object.keys(table ?? {})) if (!wanted.has(key)) extraKeys.push(`${family}:${key}`);
  }
  if (extraKeys.length) problems.push(`drawers for ids that content does not have: ${extraKeys.join(', ')}`);
  const { errors, near } = distinctness(cells.filter((c) => !problems.some((p) => p.startsWith(c.id))));
  if (!partial) problems.push(...errors);
  if (problems.length && !partial) throw new Error(`icon sheet has problems:\n  ${problems.join('\n  ')}`);

  const rows = Math.ceil(cells.length / ICON_COLS);
  const sheet = new Canvas(ICON_SIZE * ICON_COLS, ICON_SIZE * rows);
  cells.forEach((cell, index) => {
    cell.col = index % ICON_COLS;
    cell.row = Math.floor(index / ICON_COLS);
    sheet.blit(cell.canvas, cell.col * ICON_SIZE, cell.row * ICON_SIZE);
  });
  return { sheet, cells, rows, cols: ICON_COLS, near, problems: partial ? [...problems, ...errors] : [] };
}

function iconMapSource(cells, rows) {
  const entries = cells.map(({ id, col, row }) => `  ${id}: [${col}, ${row}],`).join('\n');
  return `// GENERATED BY tools/art/icons.mjs. Do not edit by hand; run \`npm run art\`.
/**
 * The UI icon sheet. One 16x16 cell per id; the UI looks icons up by the
 * content convention only: tool_<id>, upg_<id>, card_<id>, meta_<id>,
 * pickup_<id>, each achievement's \`icon\`, and the ui_* HUD glyphs.
 */
export const ICON_SIZE = ${ICON_SIZE};
export const ICON_COLS = ${ICON_COLS};
export const ICON_ROWS = ${rows};
export const ICON_SHEET = new URL('../../public/sprites/icons.png', import.meta.url).href;
/** id -> [col, row] in the 16px grid. */
export const ICONS: Readonly<Record<string, readonly [number, number]>> = {
${entries}
};
/** Every id on the sheet, in sheet order. */
export const ICON_IDS: readonly string[] = Object.keys(ICONS);
export function iconPos(id: string): readonly [number, number] | null {
  return ICONS[id] ?? null;
}
`;
}

export async function writeIcons() {
  const { sheet, cells, rows, near } = await buildIcons();
  const png = writePNG(PNG_PATH, sheet);
  mkdirSync(dirname(MAP_PATH), { recursive: true });
  writeFileSync(MAP_PATH, iconMapSource(cells, rows));
  process.stdout.write(
    `icons: ${cells.length} cells -> public/sprites/icons.png (${png.w}x${png.h}), src/render/icon-map.ts\n`,
  );
  if (near.length) {
    process.stdout.write(`icons: ${near.length} near-identical silhouette pair(s) to eyeball:\n`);
    for (const n of near) process.stdout.write(`  ${n.a} ~ ${n.b} (${Math.round(n.iou * 100)}%)\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeIcons().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
