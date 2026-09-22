#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { buildScenes } from './scenes.mjs';
import { buildObjects } from './objects.mjs';
import { Canvas, makeRng, PAL, text, writePNG } from './pixel.mjs';

const SCENE_ORDER = Object.freeze([
  'scene_bedroom',
  'scene_coworking',
  'scene_openplan',
  'scene_datacenter',
  'scene_orbital',
]);

const OBJECT_ORDER = Object.freeze([
  'laptop',
  'dev_idle',
  'dev_type',
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

const MARGIN = 8;
const GUTTER = 6;
const LABEL_HEIGHT = 7;

function checkerboard(canvas) {
  for (let y = 0; y < canvas.h; y += 8) {
    for (let x = 0; x < canvas.w; x += 8) {
      canvas.rect(x, y, 8, 8, ((x / 8 + y / 8) % 2 === 0) ? PAL.bg0 : PAL.bg2);
    }
  }
}

function nearest3x(source) {
  const scale = 3;
  const output = new Canvas(source.w * scale, source.h * scale);
  for (let y = 0; y < source.h; y += 1) {
    for (let x = 0; x < source.w; x += 1) {
      const sourceOffset = (y * source.w + x) * 4;
      const pixel = source.data.subarray(sourceOffset, sourceOffset + 4);
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const targetOffset = (((y * scale + dy) * output.w) + x * scale + dx) * 4;
          output.data.set(pixel, targetOffset);
        }
      }
    }
  }
  return output;
}

function main() {
  const rng = makeRng('tokenmaxxing-art-v1');
  const scenes = buildScenes(rng);
  const objects = buildObjects(rng);

  const objectWidth = Math.max(...OBJECT_ORDER.map((name) => {
    const frames = objects[name].frames;
    return frames.reduce((sum, frame) => sum + frame.w, 0) + GUTTER * (frames.length - 1) + 2;
  }));
  const width = Math.max(320, objectWidth) + MARGIN * 2;
  const sceneHeight = SCENE_ORDER.length * (LABEL_HEIGHT + 180 + GUTTER);
  const objectHeight = OBJECT_ORDER.reduce((sum, name) => {
    const tallest = Math.max(...objects[name].frames.map((frame) => frame.h));
    return sum + LABEL_HEIGHT + tallest + 2 + GUTTER;
  }, 0);
  const composite = new Canvas(width, MARGIN + sceneHeight + objectHeight + MARGIN);
  checkerboard(composite);

  let y = MARGIN;
  for (const name of SCENE_ORDER) {
    text(composite, MARGIN, y, name, PAL.fg0);
    y += LABEL_HEIGHT;
    composite.blit(scenes[name], MARGIN, y);
    composite.frame(MARGIN + 110, y + 88, 101, 63, PAL.red);
    y += 180 + GUTTER;
  }

  for (const name of OBJECT_ORDER) {
    const frames = objects[name].frames;
    text(composite, MARGIN, y, name, PAL.fg0);
    y += LABEL_HEIGHT + 1;
    let x = MARGIN + 1;
    for (const frame of frames) {
      composite.blit(frame, x, y);
      composite.frame(x - 1, y - 1, frame.w + 2, frame.h + 2, PAL.line);
      x += frame.w + GUTTER;
    }
    y += Math.max(...frames.map((frame) => frame.h)) + 1 + GUTTER;
  }

  const preview = nearest3x(composite);
  const outputPath = fileURLToPath(new URL('../../artifacts/art-preview.png', import.meta.url));
  writePNG(outputPath, preview);
  console.log(`artifacts/art-preview.png (${preview.w}x${preview.h})`);
}

main();
