#!/usr/bin/env node
/**
 * `npm run art`: regenerate every sheet and manifest the game ships.
 *
 *   public/sprites/rooms.png   the human's five rooms, seen through the glass
 *   public/sprites/stage.png   the human, the agent, gadgets, props, pickups
 *   public/sprites/icons.png   the 16x16 UI icon sheet
 *   src/render/atlas.ts        manifest for rooms + stage (generated)
 *   src/render/icon-map.ts     manifest for the icon sheet (generated)
 *
 * The sprite list is not written down here: it comes from REQUIRED_SPRITES in
 * src/render/atlas-types.ts, which derives gadget and pickup keys from
 * content.ts. Anything required but not painted, or painted but not
 * required, fails the build.
 *
 * Needs a Node that can import TypeScript directly (22.18+ or 23.6+).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, makeRng, writePNG } from './pixel.mjs';
import { ROOM_KEYS, buildRooms } from './rooms.mjs';
import { buildHuman } from './human.mjs';
import { AGENT_BOX, AGENT_FEET, buildAgent } from './agent.mjs';
import { buildGadgets } from './gadgets.mjs';
import { buildPickups, buildProps, pickupSpriteKey } from './props.mjs';
import { writeIcons } from './icons.mjs';
import { loadContent, loadRenderContract } from './content.mjs';

const ROOMS_PATH = fileURLToPath(new URL('../../public/sprites/rooms.png', import.meta.url));
const STAGE_PATH = fileURLToPath(new URL('../../public/sprites/stage.png', import.meta.url));
const ATLAS_PATH = fileURLToPath(new URL('../../src/render/atlas.ts', import.meta.url));

const STAGE_SHEET_W = 512;

/** Every stage sprite, as { key: { frames: Canvas[], fps?, ox?, oy? } }. */
export async function buildStageSprites() {
  const content = await loadContent();
  const rng = makeRng('tokenmaxxing2-art-v1');
  const agent = buildAgent();
  const gadgets = buildGadgets(content.TOOLS.map((t) => t.id));
  for (const t of content.TOOLS) {
    if (!gadgets[t.gadget]) throw new Error(`tool ${t.id} names gadget ${t.gadget}, which was not painted`);
  }
  const pickups = buildPickups(content.PICKUPS);
  for (const p of content.PICKUPS) {
    if (!pickups[pickupSpriteKey(p.shape, p.accent)]) throw new Error(`pickup ${p.id} has no sprite`);
  }
  return {
    rooms: buildRooms(rng),
    stage: { ...buildHuman(), ...agent, ...gadgets, ...buildProps(), ...pickups },
  };
}

function assertFrames(key, sprite) {
  if (!sprite || !Array.isArray(sprite.frames) || sprite.frames.length === 0) {
    throw new Error(`${key} has no frames`);
  }
  const { w, h } = sprite.frames[0];
  sprite.frames.forEach((f, i) => {
    if (!(f instanceof Canvas) || f.w < 1 || f.h < 1) throw new Error(`${key} frame ${i} is empty`);
    if (f.w !== w || f.h !== h) throw new Error(`${key} frame ${i} is ${f.w}x${f.h}, expected ${w}x${h}`);
  });
}

/** Shelf-pack every frame, tallest first, 1px apart. */
function packStage(stage) {
  const items = [];
  for (const [key, sprite] of Object.entries(stage)) {
    assertFrames(key, sprite);
    sprite.frames.forEach((canvas, index) => items.push({ key, index, canvas }));
  }
  items.sort((a, b) => b.canvas.h - a.canvas.h || b.canvas.w - a.canvas.w || a.key.localeCompare(b.key));
  const pad = 1;
  let x = pad;
  let y = pad;
  let shelf = 0;
  const rects = new Map();
  for (const item of items) {
    if (item.canvas.w + pad * 2 > STAGE_SHEET_W) throw new Error(`${item.key} is wider than the stage sheet`);
    if (x + item.canvas.w + pad > STAGE_SHEET_W) {
      x = pad;
      y += shelf + pad;
      shelf = 0;
    }
    rects.set(`${item.key}#${item.index}`, { x, y, w: item.canvas.w, h: item.canvas.h });
    x += item.canvas.w + pad;
    shelf = Math.max(shelf, item.canvas.h);
  }
  const height = Math.ceil((y + shelf + pad) / 4) * 4;
  const sheet = new Canvas(STAGE_SHEET_W, height);
  for (const item of items) {
    const r = rects.get(`${item.key}#${item.index}`);
    sheet.blit(item.canvas, r.x, r.y);
  }
  const sprites = {};
  for (const [key, sprite] of Object.entries(stage)) {
    const frames = sprite.frames.map((_, i) => {
      const r = rects.get(`${key}#${i}`);
      return sprite.ox || sprite.oy ? { ...r, ox: sprite.ox ?? 0, oy: sprite.oy ?? 0 } : r;
    });
    sprites[key] = { sheet: 'stage', frames, fps: sprite.fps };
  }
  return { sheet, sprites };
}

function packRooms(rooms) {
  const sheet = new Canvas(320, 180 * ROOM_KEYS.length);
  const sprites = {};
  ROOM_KEYS.forEach((k, i) => {
    const key = `room_${k}`;
    const room = rooms[key];
    if (!room || room.w !== 320 || room.h !== 180) throw new Error(`${key} must be 320x180`);
    sheet.blit(room, 0, i * 180);
    sprites[key] = { sheet: 'rooms', frames: [{ x: 0, y: i * 180, w: 320, h: 180 }] };
  });
  return { sheet, sprites };
}

const formatFrame = (f) => {
  const off = f.ox !== undefined || f.oy !== undefined ? `, ox: ${f.ox ?? 0}, oy: ${f.oy ?? 0}` : '';
  return `{ x: ${f.x}, y: ${f.y}, w: ${f.w}, h: ${f.h}${off} }`;
};

function atlasSource(required, sprites) {
  const lines = [
    '// GENERATED BY tools/art/build-art.mjs. Do not edit by hand.',
    '// Run `npm run art` to regenerate.',
    "import type { AtlasManifest } from './atlas-types.ts';",
    '',
    'const manifest: AtlasManifest = {',
    '  sheets: {',
    "    rooms: new URL('../../public/sprites/rooms.png', import.meta.url).href,",
    "    stage: new URL('../../public/sprites/stage.png', import.meta.url).href,",
    '  },',
    '  sprites: {',
  ];
  for (const key of required) {
    const s = sprites[key];
    const frames = s.frames.map(formatFrame);
    // Variant sets (tokens, books) get fps 1: frames are picked explicitly.
    const fps = s.frames.length > 1 ? `, fps: ${s.fps ?? 1}` : '';
    const inline = `    ${key}: { sheet: '${s.sheet}', frames: [${frames.join(', ')}]${fps} },`;
    if (inline.length <= 100) {
      lines.push(inline);
      continue;
    }
    lines.push(`    ${key}: {`, `      sheet: '${s.sheet}',`, '      frames: [');
    for (const f of frames) lines.push(`        ${f},`);
    lines.push('      ],');
    if (s.frames.length > 1) lines.push(`      fps: ${s.fps ?? 1},`);
    lines.push('    },');
  }
  lines.push('  },', '};', '', 'export default manifest;', '');
  return lines.join('\n');
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function main() {
  const contract = await loadRenderContract();
  const required = [...contract.REQUIRED_SPRITES];
  if (contract.AGENT_BOX.w !== AGENT_BOX.w || contract.AGENT_BOX.h !== AGENT_BOX.h
    || contract.AGENT_FEET.x !== AGENT_FEET.x || contract.AGENT_FEET.y !== AGENT_FEET.y) {
    throw new Error('AGENT_BOX / AGENT_FEET disagree between agent.mjs and atlas-types.ts');
  }
  const built = await buildStageSprites();
  const rooms = packRooms(built.rooms);
  const stage = packStage(built.stage);
  const sprites = { ...rooms.sprites, ...stage.sprites };

  const missing = required.filter((k) => !sprites[k]);
  const extra = Object.keys(sprites).filter((k) => !required.includes(k));
  if (missing.length) throw new Error(`art is missing required sprites: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`art painted sprites nobody requires: ${extra.join(', ')}`);

  const roomsPNG = writePNG(ROOMS_PATH, rooms.sheet);
  const stagePNG = writePNG(STAGE_PATH, stage.sheet);
  mkdirSync(dirname(ATLAS_PATH), { recursive: true });
  writeFileSync(ATLAS_PATH, atlasSource(required, sprites));
  const frames = Object.values(sprites).reduce((n, s) => n + s.frames.length, 0);
  process.stdout.write(
    `art: ${required.length} sprites, ${frames} frames -> `
      + `rooms.png ${roomsPNG.w}x${roomsPNG.h} (${kb(roomsPNG.bytes)}), `
      + `stage.png ${stagePNG.w}x${stagePNG.h} (${kb(stagePNG.bytes)}), src/render/atlas.ts\n`,
  );
  if (!process.argv.includes('--stage-only')) await writeIcons();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`art: ${error.stack ?? error}\n`);
    process.exit(1);
  });
}
