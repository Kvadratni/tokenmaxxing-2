#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenes } from './scenes.mjs';
import { buildObjects } from './objects.mjs';
import { Canvas, makeRng, writePNG } from './pixel.mjs';

const SCENE_ORDER = Object.freeze([
  'scene_bedroom',
  'scene_coworking',
  'scene_openplan',
  'scene_datacenter',
  'scene_orbital',
]);

const CLUTTER_ORDER = Object.freeze([
  'clutter_duck',
  'clutter_mug',
  'clutter_monitor',
  'clutter_terminal',
  'clutter_swarm',
  'clutter_loop',
  'clutter_rack',
  'clutter_fleet',
  'clutter_gpuwall',
  'clutter_agi',
]);

const OBJECT_ORDER = Object.freeze(['laptop', 'dev_idle', 'dev_type', ...CLUTTER_ORDER]);
const EXPECTED_FRAMES = Object.freeze({
  laptop: 3,
  dev_idle: 2,
  dev_type: 2,
  clutter_duck: 1,
  clutter_mug: 1,
  clutter_monitor: 1,
  clutter_terminal: 3,
  clutter_swarm: 3,
  clutter_loop: 3,
  clutter_rack: 1,
  clutter_fleet: 2,
  clutter_gpuwall: 3,
  clutter_agi: 3,
});

const TYPES_PATH = fileURLToPath(new URL('../../src/render/atlas-types.ts', import.meta.url));
const SCENES_PATH = fileURLToPath(new URL('../../public/sprites/scenes.png', import.meta.url));
const OBJECTS_PATH = fileURLToPath(new URL('../../public/sprites/objects.png', import.meta.url));
const ATLAS_PATH = fileURLToPath(new URL('../../src/render/atlas.ts', import.meta.url));

function requiredSprites() {
  const source = readFileSync(TYPES_PATH, 'utf8');
  const block = source.match(/export const REQUIRED_SPRITES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!block) throw new Error('Could not extract REQUIRED_SPRITES from atlas-types.ts');
  const names = Array.from(block[1].matchAll(/'([^']+)'/g), (match) => match[1]);
  if (names.length < 17) throw new Error(`Only extracted ${names.length} REQUIRED_SPRITES entries`);
  return names;
}

function assertCanvas(canvas, name, w, h, opaque = false) {
  if (!(canvas instanceof Canvas)) throw new TypeError(`${name} is not a Canvas`);
  if (canvas.w !== w || canvas.h !== h) {
    throw new Error(`${name} must be ${w}x${h}, got ${canvas.w}x${canvas.h}`);
  }
  if (opaque) {
    for (let offset = 3; offset < canvas.data.length; offset += 4) {
      if (canvas.data[offset] !== 255) throw new Error(`${name} contains a non-opaque pixel`);
    }
  }
}

function buildSceneSheet(scenes) {
  const sheet = new Canvas(320, 900);
  const sprites = {};
  SCENE_ORDER.forEach((name, index) => {
    const scene = scenes[name];
    assertCanvas(scene, name, 320, 180, true);
    const frame = { x: 0, y: index * 180, w: 320, h: 180 };
    sheet.blit(scene, frame.x, frame.y);
    sprites[name] = { sheet: 'scenes', frames: [frame] };
  });
  return { sheet, sprites };
}

function packObjects(objects) {
  const width = 256;
  const padding = 1;
  const placements = [];
  const sprites = {};
  let cursorX = padding;
  let cursorY = padding;
  let shelfHeight = 0;

  for (const name of OBJECT_ORDER) {
    const animation = objects[name];
    if (!animation || !Array.isArray(animation.frames)) throw new Error(`Missing object ${name}`);
    if (animation.frames.length !== EXPECTED_FRAMES[name]) {
      throw new Error(`${name} must have ${EXPECTED_FRAMES[name]} frames`);
    }
    const frames = [];
    for (let index = 0; index < animation.frames.length; index += 1) {
      const canvas = animation.frames[index];
      if (!(canvas instanceof Canvas) || canvas.w < 1 || canvas.h < 1) {
        throw new Error(`${name} frame ${index} is not a non-empty Canvas`);
      }
      if (canvas.w + padding * 2 > width) {
        throw new Error(`${name} frame ${index} is too wide for the ${width}px object sheet`);
      }
      if (cursorX + canvas.w + padding > width) {
        cursorX = padding;
        cursorY += shelfHeight + padding;
        shelfHeight = 0;
      }
      const rect = { x: cursorX, y: cursorY, w: canvas.w, h: canvas.h };
      frames.push(rect);
      placements.push({ name, index, rect, canvas });
      cursorX += canvas.w + padding;
      shelfHeight = Math.max(shelfHeight, canvas.h);
    }
    sprites[name] = animation.fps === undefined
      ? { sheet: 'objects', frames }
      : { sheet: 'objects', frames, fps: animation.fps };
  }

  const usedHeight = cursorY + shelfHeight + padding;
  const height = Math.ceil(usedHeight / 4) * 4;
  for (let left = 0; left < placements.length; left += 1) {
    const a = placements[left];
    if (a.rect.x < padding || a.rect.y < padding
      || a.rect.x + a.rect.w > width - padding
      || a.rect.y + a.rect.h > height - padding) {
      throw new Error(`${a.name} frame ${a.index} lies outside the padded object sheet`);
    }
    for (let right = left + 1; right < placements.length; right += 1) {
      const b = placements[right];
      const overlaps = a.rect.x < b.rect.x + b.rect.w && a.rect.x + a.rect.w > b.rect.x
        && a.rect.y < b.rect.y + b.rect.h && a.rect.y + a.rect.h > b.rect.y;
      if (overlaps) throw new Error(`${a.name} frame ${a.index} overlaps ${b.name} frame ${b.index}`);
    }
  }

  const sheet = new Canvas(width, height);
  for (const placement of placements) sheet.blit(placement.canvas, placement.rect.x, placement.rect.y);
  return { sheet, sprites };
}

const formatFrame = (frame) => `{ x: ${frame.x}, y: ${frame.y}, w: ${frame.w}, h: ${frame.h} }`;

function generateAtlas(required, sprites) {
  const lines = [
    '// GENERATED BY tools/art/build-art.mjs — do not edit by hand.',
    '// Run `npm run art` to regenerate.',
    "import type { AtlasManifest } from './atlas-types.ts';",
    '',
    'const manifest: AtlasManifest = {',
    '  sheets: {',
    "    scenes: new URL('../../public/sprites/scenes.png', import.meta.url).href,",
    "    objects: new URL('../../public/sprites/objects.png', import.meta.url).href,",
    '  },',
    '  sprites: {',
  ];

  for (const name of required) {
    const sprite = sprites[name];
    if (!sprite || sprite.frames.length === 0) throw new Error(`Missing required sprite ${name}`);
    const frames = sprite.frames.map(formatFrame);
    const fps = sprite.fps === undefined ? '' : `, fps: ${sprite.fps}`;
    const inline = `    ${name}: { sheet: '${sprite.sheet}', frames: [${frames.join(', ')}]${fps} },`;
    if (inline.length <= 100) {
      lines.push(inline);
      continue;
    }
    lines.push(`    ${name}: {`, `      sheet: '${sprite.sheet}',`, '      frames: [');
    for (const frame of frames) lines.push(`        ${frame},`);
    lines.push('      ],');
    if (sprite.fps !== undefined) lines.push(`      fps: ${sprite.fps},`);
    lines.push('    },');
  }
  lines.push('  },', '};', '', 'export default manifest;', '');
  return lines.join('\n');
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
  const rng = makeRng('tokenmaxxing-art-v1');
  const required = requiredSprites();
  const scenes = buildScenes(rng);
  const objects = buildObjects(rng);
  const sceneResult = buildSceneSheet(scenes);
  const objectResult = packObjects(objects);
  const sprites = { ...sceneResult.sprites, ...objectResult.sprites };
  const unexpected = Object.keys(sprites).filter((name) => !required.includes(name));
  if (unexpected.length > 0) throw new Error(`Unexpected sprites: ${unexpected.join(', ')}`);
  const atlasSource = generateAtlas(required, sprites);

  const scenesPNG = writePNG(SCENES_PATH, sceneResult.sheet);
  const objectsPNG = writePNG(OBJECTS_PATH, objectResult.sheet);
  mkdirSync(dirname(ATLAS_PATH), { recursive: true });
  writeFileSync(ATLAS_PATH, atlasSource);

  const frameCount = Object.values(sprites).reduce((sum, sprite) => sum + sprite.frames.length, 0);
  console.log(
    `art: 2 sheets, ${required.length} sprites, ${frameCount} frames -> `
      + `public/sprites/scenes.png (${scenesPNG.w}x${scenesPNG.h}, ${formatKB(scenesPNG.bytes)}), `
      + `public/sprites/objects.png (${objectsPNG.w}x${objectsPNG.h}, ${formatKB(objectsPNG.bytes)}), `
      + 'src/render/atlas.ts',
  );
}

main();
