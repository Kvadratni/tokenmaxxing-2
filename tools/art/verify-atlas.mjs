#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePNGSize } from './pixel.mjs';

const TYPES_PATH = fileURLToPath(new URL('../../src/render/atlas-types.ts', import.meta.url));
const ATLAS_PATH = fileURLToPath(new URL('../../src/render/atlas.ts', import.meta.url));

function parseTypes(source, failures) {
  const requiredBlock = source.match(/export const REQUIRED_SPRITES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  const required = requiredBlock
    ? Array.from(requiredBlock[1].matchAll(/'([^']+)'/g), (match) => match[1])
    : [];
  if (required.length < 17) failures.push(`atlas-types parse found only ${required.length} required sprites`);

  const slotsBlock = source.match(/export const CLUTTER_SLOTS[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  const slots = {};
  if (slotsBlock) {
    const pattern = /(clutter_\w+):\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*maxW:\s*(-?\d+),\s*maxH:\s*(-?\d+)\s*\}/g;
    for (const match of slotsBlock[1].matchAll(pattern)) {
      slots[match[1]] = { x: Number(match[2]), y: Number(match[3]), maxW: Number(match[4]), maxH: Number(match[5]) };
    }
  }
  if (Object.keys(slots).length < 10) {
    failures.push(`atlas-types parse found only ${Object.keys(slots).length} clutter slots`);
  }

  const laptopMatch = source.match(/export const LAPTOP_RECT\s*=\s*\{[^}]*?w:\s*(\d+),\s*h:\s*(\d+)\s*\}/);
  const laptop = laptopMatch ? { w: Number(laptopMatch[1]), h: Number(laptopMatch[2]) } : null;
  if (!laptop) failures.push('atlas-types parse could not extract LAPTOP_RECT dimensions');
  return { required, slots, laptop };
}

function balancedBlock(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  return null;
}

function parseAtlas(source, failures) {
  const sheetsMatch = source.match(/sheets:\s*\{([\s\S]*?)\n\s{2}\},\s*\n\s{2}sprites:/);
  const sheets = {};
  if (sheetsMatch) {
    const pattern = /^\s*([A-Za-z_]\w*):\s*new URL\('([^']+)',\s*import\.meta\.url\)\.href,/gm;
    for (const match of sheetsMatch[1].matchAll(pattern)) sheets[match[1]] = match[2];
  }
  if (Object.keys(sheets).length === 0) failures.push('atlas parse found no declared sheets');

  const spritesStart = source.match(/\n  sprites:\s*\{/);
  const spritesBody = spritesStart
    ? balancedBlock(source, spritesStart.index + spritesStart[0].lastIndexOf('{'))
    : null;
  const sprites = {};
  if (spritesBody !== null) {
    const property = /^\s{4}([A-Za-z_]\w*):\s*\{/gm;
    for (const match of spritesBody.matchAll(property)) {
      const openIndex = match.index + match[0].lastIndexOf('{');
      const body = balancedBlock(spritesBody, openIndex);
      if (body === null) continue;
      const sheetMatch = body.match(/sheet:\s*'([^']+)'/);
      const framesMatch = body.match(/frames:\s*\[([\s\S]*?)\]/);
      const frames = [];
      if (framesMatch) {
        const framePattern = /\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*w:\s*(-?\d+),\s*h:\s*(-?\d+)\s*\}/g;
        for (const frame of framesMatch[1].matchAll(framePattern)) {
          frames.push({ x: Number(frame[1]), y: Number(frame[2]), w: Number(frame[3]), h: Number(frame[4]) });
        }
      }
      const fpsMatch = body.match(/fps:\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/);
      sprites[match[1]] = {
        sheet: sheetMatch?.[1],
        frames,
        fps: fpsMatch ? Number(fpsMatch[1]) : undefined,
      };
    }
  }
  if (Object.keys(sprites).length < 17) {
    failures.push(`atlas parse found only ${Object.keys(sprites).length} sprites`);
  }
  return { sheets, sprites };
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x
  && a.y < b.y + b.h && a.y + a.h > b.y;

function verify() {
  const failures = [];
  const types = parseTypes(readFileSync(TYPES_PATH, 'utf8'), failures);
  const atlas = parseAtlas(readFileSync(ATLAS_PATH, 'utf8'), failures);
  const sheetSizes = {};

  for (const [key, relativePath] of Object.entries(atlas.sheets)) {
    try {
      const filePath = fileURLToPath(new URL(relativePath, pathToFileURL(ATLAS_PATH)));
      sheetSizes[key] = decodePNGSize(filePath);
    } catch (error) {
      failures.push(`sheet ${key} could not be read: ${error.message}`);
    }
  }

  for (const name of types.required) {
    const sprite = atlas.sprites[name];
    if (!sprite) failures.push(`required sprite ${name} is missing`);
    else if (sprite.frames.length === 0) failures.push(`required sprite ${name} has no frames`);
  }

  for (const [name, sprite] of Object.entries(atlas.sprites)) {
    if (!Object.hasOwn(atlas.sheets, sprite.sheet)) {
      failures.push(`${name} uses undeclared sheet ${String(sprite.sheet)}`);
    }
    const size = sheetSizes[sprite.sheet];
    sprite.frames.forEach((frame, index) => {
      if (frame.w <= 0 || frame.h <= 0) failures.push(`${name} frame ${index} has non-positive dimensions`);
      if (size && (frame.x < 0 || frame.y < 0
        || frame.x + frame.w > size.w || frame.y + frame.h > size.h)) {
        failures.push(
          `${name} frame ${index} (${frame.x},${frame.y},${frame.w},${frame.h}) `
            + `lies outside ${sprite.sheet} (${size.w}x${size.h})`,
        );
      }
    });

    if (sprite.frames.length > 1 && !(sprite.fps > 0)) {
      failures.push(`${name} has ${sprite.frames.length} frames but no positive fps`);
    }
    if (sprite.frames.length === 1 && sprite.fps !== undefined) {
      failures.push(`${name} has one frame but declares fps ${sprite.fps}`);
    }
    const first = sprite.frames[0];
    if (first && sprite.frames.some((frame) => frame.w !== first.w || frame.h !== first.h)) {
      failures.push(`${name} frames do not share identical dimensions`);
    }
  }

  for (const sheet of Object.keys(atlas.sheets)) {
    const frames = [];
    for (const [name, sprite] of Object.entries(atlas.sprites)) {
      if (sprite.sheet !== sheet) continue;
      sprite.frames.forEach((frame, index) => frames.push({ name, index, frame }));
    }
    for (let left = 0; left < frames.length; left += 1) {
      for (let right = left + 1; right < frames.length; right += 1) {
        const a = frames[left];
        const b = frames[right];
        if (overlaps(a.frame, b.frame)) {
          failures.push(`${a.name} frame ${a.index} overlaps ${b.name} frame ${b.index} on ${sheet}`);
        }
      }
    }
  }

  for (const [name, slot] of Object.entries(types.slots)) {
    const sprite = atlas.sprites[name];
    if (sprite) {
      sprite.frames.forEach((frame, index) => {
        if (frame.w !== slot.maxW || frame.h !== slot.maxH) {
          failures.push(
            `${name} frame ${index} is ${frame.w}x${frame.h}; expected ${slot.maxW}x${slot.maxH}`,
          );
        }
      });
    }
    if (slot.x + slot.maxW > 320 || slot.y + slot.maxH > 180 || slot.x < 0 || slot.y < 0) {
      failures.push(`${name} slot (${slot.x},${slot.y},${slot.maxW},${slot.maxH}) exceeds the 320x180 scene`);
    }
  }

  const laptop = atlas.sprites.laptop;
  if (laptop && types.laptop) {
    laptop.frames.forEach((frame, index) => {
      if (frame.w !== 64 || frame.h !== 44
        || frame.w !== types.laptop.w || frame.h !== types.laptop.h) {
        failures.push(`${'laptop'} frame ${index} is ${frame.w}x${frame.h}; expected 64x44 and LAPTOP_RECT`);
      }
    });
  }
  for (const name of ['dev_idle', 'dev_type']) {
    atlas.sprites[name]?.frames.forEach((frame, index) => {
      if (frame.w !== 24 || frame.h !== 28) failures.push(`${name} frame ${index} is not 24x28`);
    });
  }
  for (const name of types.required.filter((key) => key.startsWith('scene_'))) {
    atlas.sprites[name]?.frames.forEach((frame, index) => {
      if (frame.w !== 320 || frame.h !== 180) failures.push(`${name} frame ${index} is not 320x180`);
    });
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exit(1);
  }

  const frameCount = Object.values(atlas.sprites).reduce((sum, sprite) => sum + sprite.frames.length, 0);
  console.log(
    `verify-atlas: OK — ${Object.keys(atlas.sprites).length} sprites, `
      + `${frameCount} frames, ${Object.keys(atlas.sheets).length} sheets`,
  );
}

verify();
