import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Canvas, PAL, makeRng, text, writePNG } from './pixel.mjs';

const ICON_SIZE = 16;
const ICON_COLS = 8;
const ICON_ROWS = 14;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const diamond = (cv, cx, cy, radius, color) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const span = radius - Math.abs(dy);
    cv.hline(cx - span, cx + span, cy + dy, color);
  }
};

const knockedBox = (cv, x, y, w, h, color) => {
  cv.rect(x + 1, y, w - 2, h, color);
  cv.rect(x, y + 1, w, h - 2, color);
};

const polyline = (cv, points, color) => {
  for (let index = 1; index < points.length; index += 1) {
    cv.line(...points[index - 1], ...points[index], color);
  }
};

const outlined = (body, details = null, underlay = null, diagonals = false) => {
  const canvas = new Canvas(ICON_SIZE, ICON_SIZE);
  if (underlay) underlay(canvas);
  const shape = new Canvas(ICON_SIZE, ICON_SIZE);
  body(shape);
  shape.outline(PAL.bg0, 255, diagonals);
  for (let index = 0; index < ICON_SIZE; index += 1) {
    shape.put(index, 0, [0, 0, 0, 0]);
    shape.put(index, ICON_SIZE - 1, [0, 0, 0, 0]);
    shape.put(0, index, [0, 0, 0, 0]);
    shape.put(ICON_SIZE - 1, index, [0, 0, 0, 0]);
  }
  for (let index = 1; index < ICON_SIZE - 1; index += 1) {
    if (shape.alphaAt(index, 1)) shape.put(index, 1, PAL.bg0);
    if (shape.alphaAt(index, ICON_SIZE - 2)) shape.put(index, ICON_SIZE - 2, PAL.bg0);
    if (shape.alphaAt(1, index)) shape.put(1, index, PAL.bg0);
    if (shape.alphaAt(ICON_SIZE - 2, index)) shape.put(ICON_SIZE - 2, index, PAL.bg0);
  }
  canvas.blit(shape, 0, 0);
  if (details) details(canvas);
  return canvas;
};

const drawTabAutocomplete = () => outlined(
  (cv) => knockedBox(cv, 2, 3, 12, 10, PAL.bg3),
  (cv) => {
    cv.hline(4, 11, 4, PAL.bg0);
    text(cv, 3, 5, 'TAB', PAL.fg0, 255, 0);
    cv.hline(6, 10, 11, PAL.green);
    cv.put(10, 10, PAL.green);
    cv.put(11, 11, PAL.green);
  },
);

const drawCopyPasteChatbot = () => outlined(
  (cv) => {
    knockedBox(cv, 3, 2, 8, 10, PAL.fg2);
    knockedBox(cv, 6, 5, 8, 9, PAL.green2);
  },
  (cv) => {
    cv.hline(5, 8, 4, PAL.bg0);
    cv.hline(8, 11, 7, PAL.green);
    cv.hline(8, 11, 9, PAL.green);
    cv.hline(8, 10, 11, PAL.green);
    cv.put(12, 12, PAL.green);
  },
);

const drawAgenticIde = () => outlined(
  (cv) => {
    cv.rect(3, 3, 10, 3, PAL.bg2);
    cv.rect(3, 6, 10, 4, PAL.bg3);
    cv.rect(3, 10, 7, 3, PAL.bg3);
  },
  (cv) => {
    cv.hline(3, 12, 5, PAL.bg0);
    for (const x of [4, 6, 8]) cv.put(x, 4, PAL.green);
    cv.rect(7, 7, 2, 3, PAL.green);
  },
);

const drawCliAgent = () => outlined(
  (cv) => {
    cv.rect(2, 2, 12, 10, PAL.bg3);
    cv.rect(4, 12, 2, 2, PAL.bg3);
    cv.rect(10, 12, 2, 2, PAL.bg3);
  },
  (cv) => {
    cv.rect(3, 3, 10, 8, PAL.bg0);
    polyline(cv, [[4, 5], [6, 7], [4, 9]], PAL.green);
    cv.hline(8, 11, 9, PAL.green);
  },
);

const drawSubagentSwarm = () => outlined(
  (cv) => {
    diamond(cv, 8, 3, 1, PAL.green);
    diamond(cv, 4, 7, 1, PAL.green2);
    diamond(cv, 10, 7, 1, PAL.green2);
    diamond(cv, 6, 11, 1, PAL.green2);
    diamond(cv, 12, 11, 1, PAL.green2);
  },
  (cv) => {
    cv.put(8, 3, PAL.white);
    cv.put(4, 7, PAL.green);
    cv.put(10, 7, PAL.green);
  },
);

const drawRalphLoop = () => outlined(
  (cv) => {
    cv.hline(5, 10, 3, PAL.green2);
    cv.line(4, 4, 3, 6, PAL.green2);
    cv.vline(3, 6, 9, PAL.green2);
    cv.line(4, 11, 6, 13, PAL.green2);
    cv.hline(6, 10, 13, PAL.green2);
    cv.line(11, 12, 13, 10, PAL.green2);
    cv.vline(13, 6, 10, PAL.green2);
    cv.tri(10, 2, 13, 3, 11, 5, PAL.green);
  },
  (cv) => {
    cv.rect(7, 7, 3, 3, PAL.green);
    cv.put(8, 7, PAL.white);
  },
);

const drawMultiHarness = () => outlined(
  (cv) => {
    cv.rect(7, 2, 2, 4, PAL.fg2);
    cv.hline(2, 13, 5, PAL.fg2);
    cv.rect(2, 6, 2, 6, PAL.green);
    cv.rect(7, 6, 2, 8, PAL.green);
    cv.rect(12, 6, 2, 5, PAL.green);
  },
);

const drawBackgroundFleet = () => outlined(
  (cv) => {
    cv.rect(7, 2, 2, 2, PAL.fg2);
    cv.rect(6, 3, 4, 11, PAL.fg2);
    for (const y of [3, 5, 7, 9, 11, 13]) cv.hline(4, 11, y, PAL.fg2);
  },
  (cv) => {
    for (const y of [3, 5, 7, 9, 11, 13]) cv.put(10, y, PAL.green);
  },
);

const drawFinetuneFarm = (rng) => outlined(
  (cv) => {
    for (const y of [3, 7, 11]) knockedBox(cv, 2, y, 12, 3, PAL.purple);
  },
  (cv) => {
    for (const y of [4, 8, 12]) {
      cv.put(4, y, PAL.green);
      cv.put(5, y, rng.chance(0.5) ? PAL.green : PAL.green2);
      cv.hline(8, 11, y, PAL.bg0);
      cv.put(12, y, PAL.green);
    }
  },
  (cv) => {
    cv.put(1, 4, PAL.green2);
    cv.put(14, 8, PAL.purple);
    cv.put(1, 12, PAL.purple);
  },
);

const drawAgi = (rng) => outlined(
  (cv) => {
    cv.hline(7, 9, 2, PAL.bg3);
    cv.hline(6, 10, 3, PAL.bg3);
    cv.rect(5, 4, 7, 9, PAL.bg3);
    cv.hline(4, 12, 13, PAL.bg3);
  },
  (cv) => {
    cv.hline(6, 10, 7, PAL.purple);
    cv.hline(7, 9, 8, PAL.white);
    cv.put(8, 8, PAL.bg0);
    cv.vline(6, 10, 12, PAL.purple);
  },
  (cv) => {
    for (const [x, y] of [[3, 4], [13, 5], [2, 9], [13, 11], [4, 14], [11, 2]]) {
      if (rng.chance(0.75)) cv.put(x, y, PAL.purple);
    }
  },
);

const drawMechKeyboard = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 6, 12, 8, PAL.bg3);
    knockedBox(cv, 4, 2, 4, 5, PAL.amber);
  },
  (cv) => {
    for (const y of [8, 11]) {
      for (const x of [3, 7, 11]) knockedBox(cv, x, y, 3, 2, x === 7 && y === 8 ? PAL.amber : PAL.fg2);
    }
    cv.hline(5, 6, 3, PAL.fg2);
  },
);

const drawVimMotions = () => outlined(
  (cv) => knockedBox(cv, 2, 3, 12, 10, PAL.bg3),
  (cv) => {
    cv.hline(4, 11, 4, PAL.amber);
    text(cv, 3, 6, ':WQ', PAL.amber, 255, 0);
    cv.hline(5, 10, 12, PAL.fg2);
  },
);

const drawMacros = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 5, 5, 7, PAL.bg3);
    cv.hline(7, 10, 8, PAL.amber);
    cv.line(7, 7, 11, 4, PAL.amber);
    cv.line(7, 9, 11, 12, PAL.amber);
    cv.tri(10, 2, 14, 3, 11, 6, PAL.amber);
    cv.tri(10, 6, 14, 8, 10, 10, PAL.amber);
    cv.tri(10, 10, 14, 13, 10, 14, PAL.amber);
  },
  (cv) => {
    cv.rect(3, 7, 2, 3, PAL.amber);
    cv.put(4, 7, PAL.fg0);
  },
);

const drawEmacsPinky = () => outlined(
  (cv) => {
    knockedBox(cv, 9, 9, 5, 4, PAL.bg3);
    cv.rect(3, 10, 6, 3, PAL.amber);
    cv.rect(5, 8, 5, 3, PAL.amber);
    cv.rect(8, 5, 2, 5, PAL.amber);
    cv.put(11, 5, PAL.red);
    cv.put(12, 4, PAL.red);
    cv.put(13, 5, PAL.red);
    cv.put(12, 6, PAL.red);
  },
  (cv) => {
    cv.hline(4, 8, 11, PAL.bg3);
    cv.vline(9, 6, 9, PAL.bg3);
    cv.hline(10, 12, 10, PAL.amber);
  },
);

const drawNeuralInterface = () => outlined(
  (cv) => {
    cv.disc(7, 6, 4, PAL.amber);
    cv.rect(4, 8, 5, 5, PAL.amber);
    cv.hline(8, 10, 5, PAL.amber);
    cv.put(11, 6, PAL.amber);
    cv.put(10, 7, PAL.amber);
    cv.hline(10, 13, 9, PAL.fg2);
  },
  (cv) => {
    cv.rect(3, 5, 4, 5, PAL.bg0);
    cv.put(9, 5, PAL.bg0);
    cv.put(10, 9, PAL.bg0);
    cv.put(7, 6, PAL.fg0);
    cv.rect(11, 8, 2, 3, PAL.amber);
    cv.put(13, 9, PAL.fg0);
  },
);

const drawPromptCaching = () => outlined(
  (cv) => {
    cv.ellipse(8, 4, 5, 2, PAL.blue);
    cv.rect(3, 4, 11, 8, PAL.blue);
    cv.ellipse(8, 12, 5, 2, PAL.blue);
  },
  (cv) => {
    cv.hline(4, 12, 6, PAL.bg2);
    cv.hline(4, 12, 10, PAL.bg2);
    polyline(cv, [[9, 5], [6, 9], [9, 9], [7, 13], [12, 8], [9, 8]], PAL.white);
  },
);

const drawBiggerContext = () => outlined(
  (cv) => {
    cv.frame(4, 4, 8, 9, PAL.blue);
    cv.hline(2, 5, 8, PAL.blue);
    cv.hline(11, 13, 8, PAL.blue);
    cv.tri(1, 8, 4, 6, 4, 10, PAL.blue);
    cv.tri(14, 8, 11, 6, 11, 10, PAL.blue);
  },
  (cv) => {
    cv.hline(6, 10, 6, PAL.fg0);
    cv.hline(6, 9, 9, PAL.fg2);
    cv.hline(6, 10, 11, PAL.fg2);
  },
);

const drawModelRouter = () => outlined(
  (cv) => {
    cv.hline(2, 7, 8, PAL.blue);
    cv.disc(8, 8, 1, PAL.blue);
    cv.line(9, 7, 12, 4, PAL.blue);
    cv.hline(9, 13, 8, PAL.blue);
    cv.line(9, 9, 12, 12, PAL.blue);
    cv.tri(12, 2, 14, 4, 12, 6, PAL.blue);
    cv.tri(12, 6, 14, 8, 12, 10, PAL.blue);
    cv.tri(12, 10, 14, 12, 12, 14, PAL.blue);
  },
  (cv) => cv.put(8, 8, PAL.white),
);

const drawMcpServers = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 9, 12, 4, PAL.blue);
    for (const x of [3, 7, 11]) {
      cv.rect(x, 3, 3, 4, PAL.fg2);
      cv.vline(x + 1, 7, 9, PAL.fg2);
    }
  },
  (cv) => {
    for (const x of [4, 8, 12]) {
      cv.put(x, 4, PAL.blue);
      cv.put(x, 10, PAL.bg0);
      cv.put(x, 12, PAL.white);
    }
  },
);

const drawClaudeMd = () => outlined(
  (cv) => {
    cv.rect(3, 2, 8, 12, PAL.fg2);
    cv.tri(11, 2, 14, 5, 11, 5, PAL.fg0);
    cv.rect(11, 5, 3, 9, PAL.fg2);
  },
  (cv) => {
    cv.line(11, 2, 11, 5, PAL.bg0);
    cv.line(11, 5, 14, 5, PAL.bg0);
    cv.hline(5, 11, 7, PAL.fg0);
    cv.hline(5, 10, 9, PAL.fg0);
    cv.hline(5, 12, 11, PAL.fg0);
  },
);

const drawSpeculativeDecoding = () => outlined(
  (cv) => {
    cv.hline(2, 10, 10, PAL.blue);
    cv.tri(9, 7, 14, 10, 9, 13, PAL.blue);
    cv.hline(3, 5, 5, PAL.fg2);
    cv.hline(7, 9, 5, PAL.fg2);
    cv.tri(9, 2, 14, 5, 9, 8, PAL.fg2);
  },
  (cv) => {
    cv.put(2, 5, PAL.blue);
    cv.put(6, 5, PAL.blue);
    cv.put(11, 5, PAL.white);
    cv.hline(3, 7, 10, PAL.white);
  },
);

const drawDistillation = () => outlined(
  (cv) => {
    cv.hline(4, 8, 2, PAL.fg2);
    cv.vline(5, 3, 6, PAL.fg2);
    cv.vline(7, 3, 6, PAL.fg2);
    cv.tri(5, 6, 2, 11, 10, 11, PAL.fg2);
    cv.hline(10, 12, 7, PAL.fg2);
    cv.vline(12, 7, 10, PAL.fg2);
    cv.rect(10, 11, 4, 3, PAL.fg2);
  },
  (cv) => {
    cv.hline(4, 8, 10, PAL.blue);
    cv.hline(3, 9, 11, PAL.blue);
    cv.put(12, 9, PAL.blue);
    cv.hline(11, 12, 12, PAL.blue);
  },
);

const drawMuscleMemory = () => outlined(
  (cv) => {
    knockedBox(cv, 4, 4, 10, 9, PAL.bg3);
    cv.hline(1, 3, 7, PAL.green);
    cv.hline(2, 3, 10, PAL.green);
  },
  (cv) => {
    cv.line(7, 7, 9, 5, PAL.green);
    cv.line(9, 5, 11, 7, PAL.green);
    cv.vline(11, 7, 9, PAL.green);
    cv.line(11, 9, 9, 11, PAL.green);
    cv.line(9, 11, 7, 9, PAL.green);
    cv.tri(6, 7, 9, 7, 7, 9, PAL.green);
  },
);

const drawSubagentSharding = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 2, 5, 5, PAL.green2);
    knockedBox(cv, 9, 2, 5, 5, PAL.green2);
    knockedBox(cv, 2, 9, 5, 5, PAL.green2);
    knockedBox(cv, 9, 9, 5, 5, PAL.green2);
  },
  (cv) => {
    cv.put(4, 4, PAL.green);
    cv.hline(11, 12, 4, PAL.green);
    cv.put(4, 11, PAL.green);
    cv.put(3, 12, PAL.green);
    cv.put(5, 12, PAL.green);
    for (const [x, y] of [[11, 11], [12, 11], [11, 12], [12, 12]]) cv.put(x, y, PAL.green);
  },
);

const drawGpuInterconnect = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 4, 5, 9, PAL.purple);
    knockedBox(cv, 10, 4, 4, 9, PAL.purple);
    cv.rect(6, 6, 5, 4, PAL.fg2);
  },
  (cv) => {
    cv.disc(4, 8, 1, PAL.bg0);
    cv.disc(12, 8, 1, PAL.bg0);
    cv.hline(7, 10, 7, PAL.white);
    cv.hline(7, 10, 9, PAL.purple);
  },
);

const drawYoloMode = () => outlined(
  (cv) => cv.tri(8, 2, 2, 13, 14, 13, PAL.red),
  (cv) => {
    cv.tri(8, 5, 4, 12, 12, 12, PAL.bg2);
    polyline(cv, [[9, 5], [6, 9], [9, 9], [7, 12]], PAL.amber);
  },
);

const drawSkipPermissions = () => outlined(
  (cv) => {
    knockedBox(cv, 4, 7, 9, 7, PAL.red);
    cv.vline(5, 4, 8, PAL.red);
    cv.hline(6, 8, 3, PAL.red);
    cv.put(9, 4, PAL.red);
    cv.put(11, 2, PAL.red);
    cv.put(12, 3, PAL.red);
  },
  (cv) => {
    cv.rect(6, 9, 5, 3, PAL.bg2);
    cv.put(8, 10, PAL.fg0);
    cv.put(11, 3, PAL.bg0);
  },
);

const drawCiGate = () => outlined(
  (cv) => {
    cv.hline(5, 11, 2, PAL.fg2);
    cv.rect(4, 3, 9, 6, PAL.fg2);
    cv.tri(4, 8, 12, 8, 8, 14, PAL.fg2);
  },
  (cv) => {
    cv.line(6, 8, 8, 10, PAL.green);
    cv.line(8, 10, 11, 6, PAL.green);
    cv.put(8, 12, PAL.green2);
  },
);

const drawOpus = () => outlined(
  (cv) => {
    cv.ring(8, 9, 4, PAL.purple);
    cv.tri(4, 5, 4, 2, 7, 5, PAL.purple);
    cv.tri(7, 5, 8, 1, 9, 5, PAL.purple);
    cv.tri(9, 5, 12, 2, 12, 5, PAL.purple);
  },
  (cv) => {
    text(cv, 7, 7, 'O', PAL.fg0, 255, 0);
    cv.hline(5, 11, 5, PAL.fg2);
  },
);

const drawHaiku = () => outlined(
  (cv) => {
    cv.hline(5, 9, 4, PAL.fg0);
    cv.hline(4, 10, 8, PAL.blue);
    cv.hline(5, 9, 12, PAL.fg0);
  },
  (cv) => {
    cv.put(3, 3, PAL.blue);
    cv.put(11, 7, PAL.fg2);
    cv.put(4, 13, PAL.blue);
  },
);

const drawSonnet = () => outlined(
  (cv) => {
    cv.ellipse(8, 6, 5, 3, PAL.purple);
    cv.line(4, 13, 11, 3, PAL.fg2);
    cv.rect(3, 11, 3, 3, PAL.fg2);
  },
  (cv) => {
    cv.line(5, 11, 10, 4, PAL.fg0);
    cv.line(7, 7, 11, 5, PAL.bg0);
    cv.line(6, 9, 4, 7, PAL.bg0);
  },
);

const drawOpenWeights = () => outlined(
  (cv) => {
    cv.rect(3, 7, 8, 6, PAL.purple);
    cv.vline(4, 4, 7, PAL.purple);
    cv.hline(5, 8, 3, PAL.purple);
    cv.put(10, 4, PAL.purple);
    cv.rect(9, 10, 5, 4, PAL.fg2);
    cv.rect(11, 8, 2, 3, PAL.fg2);
  },
  (cv) => {
    cv.rect(5, 9, 4, 2, PAL.bg0);
    cv.put(7, 10, PAL.fg0);
    cv.hline(10, 13, 12, PAL.purple);
  },
);

const drawMonorepo = () => outlined(
  (cv) => knockedBox(cv, 2, 2, 12, 12, PAL.purple),
  (cv) => {
    for (const [x, y] of [[4, 4], [9, 4], [4, 9], [9, 9]]) {
      cv.rect(x, y, 3, 3, PAL.bg0);
      cv.put(x + 1, y + 1, PAL.blue);
    }
  },
);

const drawMicroservices = () => outlined(
  (cv) => {
    for (const [x, y] of [[2, 2], [10, 2], [2, 10], [10, 10]]) knockedBox(cv, x, y, 4, 4, PAL.blue);
    cv.line(5, 5, 10, 10, PAL.fg2);
    cv.line(11, 5, 5, 11, PAL.fg2);
  },
  (cv) => {
    for (const [x, y] of [[3, 3], [11, 3], [3, 11], [11, 11]]) cv.put(x, y, PAL.purple);
  },
);

const drawVibeCoding = () => outlined(
  (cv) => {
    cv.rect(2, 6, 5, 5, PAL.purple);
    cv.rect(9, 6, 5, 5, PAL.purple);
    cv.hline(7, 9, 7, PAL.purple);
    cv.line(2, 6, 4, 4, PAL.purple);
    cv.line(14, 6, 12, 4, PAL.purple);
  },
  (cv) => {
    cv.line(3, 7, 6, 10, PAL.blue);
    cv.line(10, 7, 13, 10, PAL.blue);
    cv.put(4, 7, PAL.white);
    cv.put(11, 7, PAL.white);
  },
);

const drawRubberDuck = () => outlined(
  (cv) => {
    cv.ellipse(7, 10, 5, 3, PAL.amber);
    cv.disc(9, 6, 3, PAL.amber);
    cv.rect(12, 6, 2, 2, PAL.red);
  },
  (cv) => {
    cv.put(10, 5, PAL.bg0);
    cv.put(10, 4, PAL.white);
    cv.line(4, 9, 7, 11, PAL.white);
    cv.hline(11, 13, 7, PAL.red);
  },
);

const drawTestCoverage = () => outlined(
  (cv) => knockedBox(cv, 3, 2, 10, 12, PAL.fg2),
  (cv) => {
    for (const y of [5, 8, 11]) {
      cv.line(4, y, 5, y + 1, PAL.green);
      cv.line(5, y + 1, 7, y - 1, PAL.green);
      cv.hline(9, 11, y, PAL.fg0);
    }
  },
);

const drawObservability = () => outlined(
  (cv) => {
    for (const [x, y] of [[8, 2], [4, 3], [12, 3], [2, 7], [14, 7], [4, 12], [12, 12], [8, 14]]) {
      cv.put(x, y, PAL.blue);
    }
    cv.ellipse(8, 8, 6, 3, PAL.blue);
  },
  (cv) => {
    cv.ellipse(8, 8, 4, 1, PAL.bg0);
    cv.disc(8, 8, 1, PAL.fg0);
    cv.put(8, 8, PAL.bg0);
  },
);

const drawScopeNegotiation = () => outlined(
  (cv) => {
    knockedBox(cv, 3, 6, 10, 5, PAL.fg2);
    cv.hline(1, 4, 8, PAL.blue);
    cv.hline(12, 14, 8, PAL.blue);
    cv.tri(1, 8, 4, 6, 4, 10, PAL.blue);
    cv.tri(14, 8, 11, 6, 11, 10, PAL.blue);
  },
  (cv) => {
    for (const x of [5, 7, 9, 11]) cv.vline(x, 7, x % 4 === 1 ? 9 : 8, PAL.bg0);
  },
);

const drawTechnicalDebt = () => outlined(
  (cv) => {
    cv.rect(3, 10, 10, 4, PAL.fg2);
    cv.rect(4, 6, 9, 4, PAL.fg2);
    cv.rect(6, 2, 7, 4, PAL.fg2);
  },
  (cv) => {
    cv.hline(4, 11, 11, PAL.purple);
    cv.hline(5, 11, 7, PAL.purple);
    polyline(cv, [[9, 3], [8, 6], [10, 8], [8, 11], [9, 13]], PAL.red);
  },
);

const drawShipItFriday = () => outlined(
  (cv) => {
    cv.tri(5, 3, 14, 7, 4, 12, PAL.fg0);
    cv.hline(1, 4, 7, PAL.blue);
    cv.hline(2, 5, 10, PAL.blue);
  },
  (cv) => {
    cv.line(5, 4, 8, 8, PAL.bg0);
    cv.line(8, 8, 5, 11, PAL.bg0);
    cv.hline(8, 12, 7, PAL.purple);
  },
);

const drawPromptEngineering = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 2, 12, 9, PAL.blue);
    cv.tri(4, 10, 7, 10, 4, 14, PAL.blue);
    cv.disc(9, 8, 2, PAL.fg2);
    cv.line(5, 12, 11, 6, PAL.fg2);
  },
  (cv) => {
    cv.put(10, 7, PAL.bg0);
    cv.line(6, 11, 9, 8, PAL.fg0);
    cv.put(5, 12, PAL.fg0);
  },
);

const drawChinchilla = () => outlined(
  (cv) => {
    cv.disc(7, 9, 4, PAL.fg2);
    cv.disc(5, 5, 2, PAL.fg2);
    cv.disc(9, 5, 2, PAL.fg2);
    cv.ellipse(11, 9, 3, 2, PAL.fg2);
    cv.line(4, 11, 2, 13, PAL.fg2);
  },
  (cv) => {
    cv.put(6, 8, PAL.bg0);
    cv.put(10, 8, PAL.bg0);
    cv.put(11, 10, PAL.purple);
    cv.hline(5, 7, 12, PAL.bg0);
    cv.put(4, 5, PAL.purple);
    cv.put(10, 5, PAL.purple);
  },
);

const drawInfinity = (accent = PAL.blue) => outlined(
  (cv) => {
    cv.line(2, 8, 5, 5, accent);
    cv.line(5, 5, 11, 11, accent);
    cv.line(11, 11, 14, 8, accent);
    cv.line(14, 8, 11, 5, accent);
    cv.line(11, 5, 5, 11, accent);
    cv.line(5, 11, 2, 8, accent);
  },
  (cv) => {
    cv.put(5, 5, PAL.fg0);
    cv.put(11, 11, PAL.fg0);
  },
  (cv) => {
    for (const [x, y] of [[2, 5], [5, 2], [11, 2], [14, 5], [2, 11], [5, 14], [11, 14], [14, 11]]) {
      cv.put(x, y, accent);
    }
  },
);

const drawGpuCluster = () => outlined(
  (cv) => {
    for (const [x, y, color] of [[2, 2, PAL.purple], [9, 2, PAL.purple], [2, 9, PAL.purple], [9, 9, PAL.fg2]]) {
      knockedBox(cv, x, y, 5, 5, color);
    }
  },
  (cv) => {
    for (const [x, y] of [[4, 4], [11, 4], [4, 11], [11, 11]]) {
      cv.disc(x, y, 1, PAL.bg0);
    }
    cv.put(4, 4, PAL.blue);
    cv.put(11, 4, PAL.blue);
    cv.put(4, 11, PAL.blue);
  },
);

const drawRalphSupremacy = () => outlined(
  (cv) => {
    cv.ring(8, 10, 4, PAL.green2);
    cv.tri(10, 5, 14, 6, 11, 9, PAL.green);
    cv.tri(4, 5, 4, 2, 7, 5, PAL.purple);
    cv.tri(7, 5, 8, 1, 9, 5, PAL.purple);
    cv.tri(9, 5, 12, 2, 12, 5, PAL.purple);
  },
  (cv) => {
    cv.hline(5, 11, 5, PAL.purple);
    cv.put(8, 10, PAL.green);
  },
);

const drawSwarmSupremacy = () => outlined(
  (cv) => {
    diamond(cv, 8, 7, 1, PAL.purple);
    diamond(cv, 5, 10, 1, PAL.blue);
    diamond(cv, 8, 10, 1, PAL.purple);
    diamond(cv, 11, 10, 1, PAL.blue);
    diamond(cv, 8, 13, 1, PAL.purple);
    cv.tri(4, 5, 4, 2, 7, 5, PAL.purple);
    cv.tri(7, 5, 8, 1, 9, 5, PAL.purple);
    cv.tri(9, 5, 12, 2, 12, 5, PAL.purple);
  },
  (cv) => {
    cv.hline(5, 11, 5, PAL.purple);
    cv.put(8, 7, PAL.white);
  },
);

const drawGrowthHacking = () => outlined(
  (cv) => {
    cv.hline(2, 6, 5, PAL.red);
    cv.hline(10, 14, 5, PAL.red);
    cv.line(3, 13, 6, 10, PAL.green2);
    cv.line(6, 10, 8, 11, PAL.green2);
    cv.line(8, 11, 11, 7, PAL.green2);
    cv.line(11, 7, 12, 3, PAL.green2);
    cv.tri(10, 4, 13, 1, 14, 5, PAL.green);
  },
  (cv) => {
    cv.put(7, 4, PAL.red);
    cv.put(9, 6, PAL.red);
    cv.put(5, 6, PAL.red);
  },
);

const drawPairProgramming = () => outlined(
  (cv) => {
    cv.disc(4, 5, 2, PAL.fg2);
    cv.rect(2, 8, 5, 5, PAL.fg2);
    cv.disc(9, 5, 2, PAL.purple);
    cv.rect(7, 8, 5, 5, PAL.purple);
    knockedBox(cv, 10, 7, 4, 5, PAL.blue);
  },
  (cv) => {
    cv.put(4, 5, PAL.bg0);
    cv.put(9, 5, PAL.bg0);
    cv.hline(11, 12, 8, PAL.bg0);
  },
);

const drawCrunchTime = () => outlined(
  (cv) => {
    cv.hline(3, 13, 2, PAL.fg2);
    cv.hline(3, 13, 13, PAL.fg2);
    cv.line(4, 3, 7, 7, PAL.fg2);
    cv.line(12, 3, 9, 7, PAL.fg2);
    cv.line(7, 8, 4, 12, PAL.fg2);
    cv.line(9, 8, 12, 12, PAL.fg2);
    cv.tri(5, 10, 11, 10, 8, 13, PAL.red);
  },
  (cv) => {
    cv.hline(5, 11, 3, PAL.red);
    cv.tri(6, 4, 10, 4, 8, 7, PAL.red);
    cv.put(8, 8, PAL.red);
  },
);

const drawSeedFunding = () => outlined(
  (cv) => {
    cv.hline(6, 10, 2, PAL.amber);
    cv.line(6, 3, 4, 6, PAL.amber);
    cv.line(10, 3, 12, 6, PAL.amber);
    cv.ellipse(8, 10, 5, 4, PAL.amber);
  },
  (cv) => {
    cv.hline(6, 10, 4, PAL.fg0);
    text(cv, 7, 7, '$', PAL.bg0, 255, 0);
  },
);

const drawCracked = () => outlined(
  (cv) => {
    knockedBox(cv, 3, 4, 10, 9, PAL.amber);
    for (const [x0, y0, x1, y1] of [[2, 3, 1, 2], [8, 2, 8, 1], [13, 3, 14, 2], [14, 8, 14, 8]]) {
      cv.line(x0, y0, x1, y1, PAL.red);
    }
  },
  (cv) => {
    polyline(cv, [[8, 4], [6, 7], [9, 8], [6, 12]], PAL.bg0);
    cv.hline(4, 11, 5, PAL.fg0);
  },
);

const drawFounderMode = () => outlined(
  (cv) => {
    cv.tri(8, 2, 5, 10, 11, 10, PAL.amber);
    cv.rect(6, 7, 5, 5, PAL.amber);
    cv.tri(5, 8, 2, 12, 6, 11, PAL.amber);
    cv.tri(11, 8, 14, 12, 10, 11, PAL.amber);
    cv.tri(6, 12, 10, 12, 8, 14, PAL.red);
  },
  (cv) => {
    cv.disc(8, 6, 1, PAL.bg0);
    cv.put(8, 5, PAL.white);
    cv.vline(8, 11, 13, PAL.red);
  },
);

const drawScopeNegotiator = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 3, 10, 11, PAL.fg2);
    cv.rect(4, 2, 2, 3, PAL.amber);
    cv.rect(8, 2, 2, 3, PAL.amber);
    cv.hline(9, 13, 9, PAL.amber);
    cv.tri(11, 6, 14, 9, 11, 12, PAL.amber);
  },
  (cv) => {
    cv.hline(3, 10, 6, PAL.bg0);
    cv.rect(4, 8, 2, 2, PAL.amber);
    cv.put(8, 9, PAL.fg0);
  },
);

const drawIncubator = () => outlined(
  (cv) => cv.ellipse(8, 8, 4, 6, PAL.fg0),
  (cv) => {
    cv.vline(6, 5, 10, PAL.amber);
    cv.put(7, 4, PAL.white);
    cv.hline(6, 10, 12, PAL.amber);
  },
  (cv) => {
    for (const [x, y] of [[3, 4], [12, 4], [2, 8], [13, 8], [4, 13], [12, 12]]) cv.put(x, y, PAL.amber);
  },
);

const drawPromptLibrary = () => outlined(
  (cv) => {
    cv.rect(3, 4, 3, 8, PAL.amber);
    cv.rect(6, 3, 4, 9, PAL.fg2);
    cv.rect(10, 5, 3, 7, PAL.amber);
    cv.rect(2, 12, 12, 2, PAL.fg2);
  },
  (cv) => {
    cv.vline(4, 5, 10, PAL.fg0);
    cv.vline(8, 4, 10, PAL.amber);
    cv.vline(11, 6, 10, PAL.fg0);
  },
);

const drawRerollToken = () => outlined(
  (cv) => knockedBox(cv, 2, 2, 12, 12, PAL.amber),
  (cv) => {
    cv.line(5, 6, 7, 4, PAL.bg0);
    cv.line(7, 4, 10, 5, PAL.bg0);
    cv.tri(9, 3, 12, 6, 8, 6, PAL.bg0);
    cv.line(11, 8, 9, 11, PAL.bg0);
    cv.line(9, 11, 6, 10, PAL.bg0);
    cv.tri(7, 9, 4, 10, 6, 13, PAL.bg0);
    cv.put(4, 4, PAL.fg0);
    cv.put(12, 12, PAL.fg0);
  },
);

const drawTechnicalCofounder = () => outlined(
  (cv) => {
    cv.disc(5, 5, 2, PAL.fg2);
    cv.rect(3, 8, 5, 5, PAL.fg2);
    cv.disc(10, 5, 2, PAL.amber);
    cv.rect(8, 8, 5, 5, PAL.amber);
    cv.disc(12, 10, 2, PAL.fg2);
    cv.line(8, 14, 13, 9, PAL.fg2);
  },
  (cv) => {
    cv.put(5, 5, PAL.bg0);
    cv.put(10, 5, PAL.bg0);
    cv.put(13, 9, PAL.bg0);
    cv.line(9, 13, 12, 10, PAL.fg0);
  },
);

const drawHypeMachine = () => outlined(
  (cv) => {
    cv.tri(3, 6, 11, 3, 11, 11, PAL.amber);
    cv.rect(2, 6, 4, 5, PAL.amber);
    cv.line(5, 10, 7, 14, PAL.fg2);
    cv.line(12, 5, 14, 3, PAL.amber);
    cv.hline(12, 14, 7, PAL.amber);
    cv.line(12, 9, 14, 11, PAL.amber);
  },
  (cv) => {
    cv.vline(5, 7, 9, PAL.fg0);
    cv.hline(8, 10, 7, PAL.bg0);
  },
);

const drawEndlessMode = () => outlined(
  (cv) => {
    cv.line(2, 8, 5, 5, PAL.amber);
    cv.line(5, 5, 11, 11, PAL.amber);
    cv.line(11, 11, 14, 8, PAL.amber);
    cv.line(14, 8, 11, 5, PAL.amber);
    cv.line(11, 5, 5, 11, PAL.amber);
    cv.line(5, 11, 2, 8, PAL.amber);
    cv.line(3, 12, 1, 9, PAL.fg2);
    cv.line(4, 13, 2, 14, PAL.fg2);
    cv.line(13, 12, 15, 9, PAL.fg2);
    cv.line(12, 13, 14, 14, PAL.fg2);
  },
  (cv) => {
    cv.put(5, 5, PAL.fg0);
    cv.put(11, 11, PAL.fg0);
  },
);

const drawLocCoworking = () => outlined(
  (cv) => {
    // A compact shared desk gives the plant a clear room-scale counterpart.
    cv.rect(8, 7, 6, 3, PAL.blue);
    cv.vline(9, 9, 13, PAL.blue);
    cv.vline(13, 9, 13, PAL.blue);
    cv.tri(2, 10, 6, 10, 5, 14, PAL.blue);
    cv.vline(4, 5, 10, PAL.green2);
    cv.line(4, 7, 2, 5, PAL.green2);
    cv.line(4, 7, 7, 5, PAL.green2);
    cv.line(4, 8, 2, 8, PAL.green2);
    cv.line(4, 6, 5, 3, PAL.green2);
  },
  (cv) => cv.put(10, 8, PAL.amber),
);

const drawLocOpenplan = () => outlined(
  (cv) => {
    // One repeated desk motif steps toward the foreground under a flat panel.
    cv.rect(4, 2, 8, 2, PAL.fg2);
    for (const [x, y] of [[9, 5], [6, 8], [3, 11]]) {
      cv.hline(x, x + 4, y, PAL.blue);
      cv.put(x + 1, y - 1, PAL.blue);
      cv.put(x + 3, y - 1, PAL.blue);
      cv.put(x, y + 1, PAL.blue);
      cv.put(x + 4, y + 1, PAL.blue);
    }
  },
  (cv) => cv.put(5, 11, PAL.amber),
);

const drawLocDatacenter = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 2, 5, 12, PAL.blue);
    knockedBox(cv, 9, 2, 5, 12, PAL.blue);
  },
  (cv) => {
    for (const [x, y, color] of [
      [4, 4, PAL.green], [5, 7, PAL.amber], [3, 10, PAL.green],
      [11, 4, PAL.amber], [12, 7, PAL.green], [10, 10, PAL.green],
    ]) cv.put(x, y, color);
    cv.vline(7, 4, 12, PAL.bg0);
    cv.vline(8, 4, 12, PAL.bg0);
  },
);

const drawLocOrbital = () => outlined(
  (cv) => {
    polyline(cv, [[2, 13], [2, 8], [4, 5], [7, 3], [10, 3], [13, 6], [14, 9], [14, 13]], PAL.purple);
    cv.ellipse(8, 15, 6, 5, PAL.blue);
  },
  (cv) => {
    cv.put(5, 7, PAL.amber);
    cv.put(11, 5, PAL.amber);
    cv.hline(4, 12, 13, PAL.purple);
  },
);

const drawAutoclicker = () => outlined(
  (cv) => {
    // A tall mouse is pinned by the green clamp spanning its shoulders.
    cv.hline(7, 9, 5, PAL.fg2);
    cv.hline(6, 10, 6, PAL.fg2);
    cv.rect(5, 7, 7, 6, PAL.fg2);
    cv.hline(6, 10, 13, PAL.fg2);
    cv.hline(4, 12, 2, PAL.green);
    cv.rect(5, 3, 7, 2, PAL.green);
    cv.vline(5, 5, 7, PAL.green);
    cv.vline(11, 5, 7, PAL.green);
  },
  (cv) => {
    cv.vline(8, 5, 8, PAL.bg0);
    cv.put(8, 6, PAL.green);
  },
  (cv) => {
    cv.line(2, 2, 3, 3, PAL.green);
    cv.hline(1, 3, 6, PAL.green);
  },
);

const drawCronJob = () => outlined(
  (cv) => {
    cv.disc(8, 8, 4, PAL.fg2);
    polyline(cv, [[4, 5], [5, 3], [11, 3], [13, 5]], PAL.green);
    cv.tri(11, 5, 14, 5, 13, 8, PAL.green);
  },
  (cv) => {
    cv.disc(8, 8, 2, PAL.bg0);
    cv.vline(8, 6, 8, PAL.green);
    cv.hline(8, 10, 8, PAL.green);
  },
);

const drawCiOnPush = () => outlined(
  (cv) => {
    cv.vline(3, 3, 12, PAL.fg2);
    cv.line(3, 10, 6, 8, PAL.fg2);
    for (const [x, y] of [[3, 3], [3, 12], [6, 8]]) cv.disc(x, y, 1, PAL.fg2);
    cv.hline(7, 9, 8, PAL.green);
    cv.tri(8, 6, 11, 8, 8, 10, PAL.green);
    cv.disc(12, 8, 2, PAL.fg2);
    for (const [x, y] of [[12, 5], [12, 11], [9, 8], [14, 8]]) cv.put(x, y, PAL.fg2);
  },
  (cv) => {
    for (const [x, y] of [[3, 3], [3, 12], [6, 8]]) cv.put(x, y, PAL.green);
    cv.put(12, 8, PAL.bg0);
  },
);

const drawHeadlessLoop = () => outlined(
  (cv) => {
    // The broad, low base reads as a shut laptop instead of a monitor.
    cv.hline(5, 11, 10, PAL.fg2);
    cv.hline(4, 12, 11, PAL.fg2);
    cv.hline(3, 13, 12, PAL.fg2);
    cv.hline(4, 12, 13, PAL.fg2);
    polyline(cv, [[3, 7], [3, 5], [5, 3], [10, 3], [12, 5]], PAL.green);
    cv.tri(10, 4, 14, 5, 11, 7, PAL.green);
  },
  (cv) => {
    cv.hline(5, 11, 11, PAL.bg0);
    cv.put(11, 12, PAL.green);
  },
);

const drawDaemonMode = () => outlined(
  (cv) => {
    // Horn tips breach the frame just enough to give the terminal its own mask.
    cv.rect(3, 4, 10, 2, PAL.bg3);
    cv.rect(2, 6, 12, 7, PAL.bg3);
    cv.hline(4, 11, 13, PAL.bg3);
    cv.tri(3, 5, 4, 2, 7, 7, PAL.green);
    cv.tri(9, 7, 11, 2, 13, 5, PAL.green);
  },
  (cv) => {
    cv.hline(3, 12, 5, PAL.bg0);
    cv.rect(3, 6, 10, 6, PAL.bg0);
    cv.put(4, 5, PAL.green);
    cv.tri(4, 8, 6, 6, 7, 9, PAL.green);
    cv.tri(9, 9, 10, 6, 12, 8, PAL.green);
    cv.rect(5, 8, 7, 3, PAL.green);
    cv.put(4, 9, PAL.green);
    cv.put(12, 9, PAL.green);
    cv.put(7, 9, PAL.bg0);
    cv.put(10, 9, PAL.bg0);
    cv.hline(8, 9, 10, PAL.bg0);
  },
);

const drawAfkFarming = () => outlined(
  (cv) => {
    // The angled back and asymmetric arm keep the chair visibly unoccupied.
    cv.hline(5, 8, 3, PAL.fg2);
    cv.hline(4, 8, 4, PAL.fg2);
    cv.rect(4, 5, 5, 4, PAL.fg2);
    cv.hline(5, 11, 9, PAL.fg2);
    cv.hline(6, 10, 10, PAL.fg2);
    cv.vline(11, 6, 9, PAL.fg2);
    cv.hline(10, 12, 6, PAL.fg2);
    cv.vline(8, 10, 12, PAL.fg2);
    cv.line(8, 12, 5, 14, PAL.fg2);
    cv.line(8, 12, 12, 14, PAL.fg2);
  },
  (cv) => cv.put(10, 9, PAL.green),
  (cv) => {
    cv.put(11, 2, PAL.green);
    cv.put(13, 4, PAL.green);
    cv.put(12, 7, PAL.green);
  },
);

const drawIdleHands = () => outlined(
  (cv) => {
    // Four stepped fingers extend right from a wide wrist and palm.
    cv.rect(2, 10, 5, 4, PAL.amber);
    cv.rect(5, 8, 6, 6, PAL.amber);
    cv.rect(8, 5, 6, 2, PAL.amber);
    cv.rect(9, 7, 5, 2, PAL.amber);
    cv.rect(10, 9, 4, 2, PAL.amber);
    cv.rect(9, 11, 4, 2, PAL.amber);
  },
  (cv) => {
    cv.vline(6, 10, 12, PAL.fg0);
    cv.hline(10, 13, 7, PAL.bg0);
    cv.hline(11, 13, 9, PAL.bg0);
  },
  (cv) => {
    cv.line(9, 2, 10, 3, PAL.amber);
    cv.line(13, 2, 14, 3, PAL.amber);
  },
);

const drawKeyboardShortcuts = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 2, 7, 6, PAL.fg2);
    knockedBox(cv, 8, 8, 6, 6, PAL.amber);
  },
  (cv) => {
    cv.hline(3, 7, 6, PAL.bg0);
    cv.hline(9, 12, 12, PAL.bg0);
    cv.hline(6, 10, 8, PAL.fg0);
    cv.vline(8, 6, 10, PAL.fg0);
  },
);

const drawSnackDrawer = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 3, 7, 8, PAL.fg2);
    cv.hline(7, 13, 5, PAL.fg2);
    cv.rect(7, 6, 7, 5, PAL.fg2);
    cv.vline(3, 10, 13, PAL.fg2);
    cv.vline(12, 10, 13, PAL.fg2);
  },
  (cv) => {
    cv.hline(3, 7, 5, PAL.bg0);
    cv.rect(8, 6, 5, 3, PAL.bg0);
    cv.rect(8, 5, 2, 4, PAL.amber);
    cv.put(8, 6, PAL.fg0);
    polyline(cv, [[10, 8], [11, 7], [12, 8], [13, 7]], PAL.amber);
    cv.hline(9, 12, 10, PAL.amber);
  },
);

const drawInsurance = () => outlined(
  (cv) => {
    cv.hline(3, 12, 3, PAL.blue);
    cv.rect(3, 4, 10, 5, PAL.blue);
    cv.hline(4, 11, 9, PAL.blue);
    cv.hline(5, 10, 10, PAL.blue);
    cv.hline(6, 9, 11, PAL.blue);
    cv.hline(7, 8, 12, PAL.blue);
  },
  (cv) => {
    cv.vline(8, 5, 10, PAL.fg0);
    cv.hline(5, 11, 8, PAL.fg0);
    cv.vline(11, 4, 7, PAL.fg2);
  },
);

const drawUnlockLucky = () => outlined(
  (cv) => {
    for (const [x, y] of [[6, 6], [10, 6], [6, 10], [10, 10]]) cv.disc(x, y, 2, PAL.green);
    cv.line(9, 11, 11, 13, PAL.green2);
  },
  (cv) => {
    cv.put(8, 8, PAL.green2);
    cv.put(5, 5, PAL.white);
  },
);

const drawFlowState = () => outlined(
  (cv) => {
    polyline(cv, [[2, 8], [4, 8], [5, 7], [7, 7], [8, 8], [10, 8], [11, 7], [13, 7]], PAL.amber);
    cv.put(8, 8, PAL.amber);
  },
  (cv) => cv.put(8, 8, PAL.white),
);

const drawHyperfocus = () => outlined(
  (cv) => {
    cv.vline(8, 2, 5, PAL.amber);
    cv.vline(8, 11, 13, PAL.amber);
    cv.hline(2, 5, 8, PAL.amber);
    cv.hline(11, 13, 8, PAL.amber);
    cv.put(8, 8, PAL.amber);
  },
  (cv) => cv.put(8, 8, PAL.white),
);

const drawBeginnersLuck = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 4, 9, 9, PAL.amber);
    diamond(cv, 12, 3, 1, PAL.amber);
  },
  (cv) => {
    cv.disc(6, 8, 1, PAL.bg0);
    cv.put(12, 3, PAL.white);
  },
);

const drawInTheZone = () => outlined(
  (cv) => {
    polyline(cv, [[3, 9], [3, 6], [5, 3], [8, 2], [11, 3], [13, 6], [13, 9]], PAL.amber);
    cv.rect(2, 8, 3, 5, PAL.amber);
    cv.rect(11, 8, 3, 5, PAL.amber);
    polyline(cv, [[6, 8], [7, 9], [6, 10]], PAL.amber);
    polyline(cv, [[10, 8], [9, 9], [10, 10]], PAL.amber);
  },
  (cv) => {
    polyline(cv, [[6, 8], [7, 9], [6, 10]], PAL.white);
    polyline(cv, [[10, 8], [9, 9], [10, 10]], PAL.white);
  },
);

const drawOverclocked = () => outlined(
  (cv) => {
    knockedBox(cv, 3, 6, 10, 8, PAL.amber);
    for (const x of [4, 6, 8, 10]) cv.vline(x, x % 4 === 0 ? 3 : 4, 6, PAL.amber);
    cv.hline(1, 3, 9, PAL.amber);
    cv.hline(12, 14, 11, PAL.amber);
    cv.vline(6, 13, 14, PAL.amber);
    cv.vline(10, 13, 14, PAL.amber);
    polyline(cv, [[10, 6], [11, 3], [12, 4], [13, 2]], PAL.red);
  },
  (cv) => {
    cv.rect(5, 8, 6, 4, PAL.bg0);
    cv.hline(6, 10, 9, PAL.red);
    cv.put(8, 9, PAL.white);
  },
);

const drawOneShot = () => outlined(
  (cv) => {
    cv.ring(7, 9, 4, PAL.blue);
    cv.disc(7, 9, 1, PAL.blue);
    cv.line(7, 9, 13, 3, PAL.green);
    cv.tri(7, 9, 8, 6, 10, 8, PAL.green);
    cv.line(11, 3, 13, 5, PAL.green);
  },
  (cv) => cv.put(7, 9, PAL.green),
);

const drawEvalHarness = () => outlined(
  (cv) => knockedBox(cv, 2, 2, 12, 12, PAL.blue),
  (cv) => {
    for (const y of [5, 8]) {
      cv.line(4, y, 5, y + 1, PAL.green);
      cv.line(5, y + 1, 7, y - 1, PAL.green);
      cv.hline(9, 11, y, PAL.bg0);
    }
    cv.line(4, 10, 6, 12, PAL.red);
    cv.line(6, 10, 4, 12, PAL.red);
    cv.hline(9, 11, 11, PAL.bg0);
  },
);

const drawBestOfN = () => outlined(
  (cv) => {
    cv.hline(5, 10, 3, PAL.blue);
    cv.hline(3, 11, 6, PAL.blue);
    cv.rect(2, 9, 12, 2, PAL.green);
    cv.hline(4, 10, 13, PAL.blue);
  },
);

const drawFirstTry = () => outlined(
  (cv) => knockedBox(cv, 2, 3, 12, 10, PAL.blue),
  (cv) => {
    cv.rect(3, 4, 10, 8, PAL.bg0);
    polyline(cv, [[4, 6], [6, 8], [4, 10]], PAL.blue);
    polyline(cv, [[8, 8], [9, 10], [12, 6]], PAL.green);
  },
);

const drawTemperatureZero = () => outlined(
  (cv) => {
    cv.rect(5, 3, 4, 8, PAL.blue);
    cv.disc(7, 11, 3, PAL.blue);
    cv.vline(12, 3, 7, PAL.blue);
    cv.hline(10, 14, 5, PAL.blue);
    cv.line(10, 3, 14, 7, PAL.blue);
    cv.line(14, 3, 10, 7, PAL.blue);
  },
  (cv) => {
    cv.rect(6, 4, 2, 6, PAL.bg0);
    cv.put(7, 10, PAL.white);
    cv.put(12, 5, PAL.white);
  },
);

const drawAchvFirstShip = () => outlined(
  (cv) => {
    cv.rect(3, 4, 10, 3, PAL.bg3);
    cv.rect(2, 7, 12, 7, PAL.fg2);
  },
  (cv) => {
    cv.hline(3, 12, 7, PAL.bg0);
    cv.vline(8, 8, 13, PAL.bg3);
    polyline(cv, [[6, 5], [7, 6], [10, 3]], PAL.green);
  },
);

const drawAchvSeriesA = () => outlined(
  (cv) => {
    cv.ellipse(3, 12, 2, 1, PAL.amber);
    cv.ellipse(7, 12, 2, 1, PAL.amber);
    cv.ellipse(7, 9, 2, 1, PAL.amber);
    cv.ellipse(12, 12, 2, 1, PAL.amber);
    cv.ellipse(12, 9, 2, 1, PAL.amber);
    cv.ellipse(12, 6, 2, 1, PAL.amber);
    diamond(cv, 12, 3, 1, PAL.amber);
  },
  (cv) => {
    for (const [x0, x1, y] of [[2, 4, 12], [6, 8, 9], [11, 13, 6]]) cv.hline(x0, x1, y, PAL.fg0);
    cv.put(12, 3, PAL.white);
  },
);

const drawAchvDemoDay = () => outlined(
  (cv) => {
    cv.tri(8, 2, 3, 12, 13, 12, PAL.amber);
    cv.rect(5, 8, 7, 3, PAL.blue);
    cv.rect(7, 10, 3, 3, PAL.blue);
    cv.rect(4, 13, 9, 1, PAL.blue);
  },
  (cv) => cv.hline(6, 10, 9, PAL.fg0),
);

const drawAchvFullStack = () => outlined(
  (cv) => {
    cv.rect(4, 2, 8, 2, PAL.green);
    cv.rect(2, 4, 12, 2, PAL.amber);
    cv.rect(3, 6, 10, 2, PAL.fg2);
    cv.rect(1, 8, 14, 2, PAL.green);
    cv.rect(4, 10, 9, 3, PAL.amber);
  },
);

const drawAchvVertical = () => outlined(
  (cv) => {
    cv.vline(8, 3, 12, PAL.green2);
    for (const y of [3, 6, 9, 12]) cv.disc(8, y, 1, PAL.green);
  },
  (cv) => {
    for (const y of [3, 6, 9, 12]) cv.put(8, y, PAL.fg0);
  },
);

const drawAchvHellaslop = () => outlined(
  (cv) => {
    cv.hline(3, 13, 5, PAL.fg2);
    cv.hline(4, 12, 6, PAL.fg2);
    cv.rect(4, 7, 9, 6, PAL.fg2);
    cv.hline(5, 11, 13, PAL.fg2);
    cv.hline(4, 12, 4, PAL.green);
    cv.hline(3, 13, 5, PAL.green);
    cv.vline(3, 5, 8, PAL.green);
    cv.vline(13, 5, 9, PAL.green);
    cv.hline(2, 5, 12, PAL.green2);
    cv.hline(10, 14, 13, PAL.green2);
  },
  (cv) => {
    cv.put(6, 5, PAL.green2);
    cv.vline(11, 5, 8, PAL.green2);
  },
);

const drawAchvFriday = () => outlined(
  (cv) => {
    cv.rect(3, 5, 10, 9, PAL.fg0);
    cv.tri(9, 10, 13, 10, 13, 14, PAL.amber);
    cv.tri(7, 5, 9, 1, 11, 5, PAL.red);
    cv.tri(8, 5, 9, 3, 10, 5, PAL.amber);
  },
  (cv) => {
    cv.hline(3, 12, 7, PAL.amber);
    cv.line(9, 10, 13, 10, PAL.bg0);
    cv.line(9, 10, 13, 14, PAL.bg0);
  },
);

const drawAchvNoHands = () => outlined(
  (cv) => {
    knockedBox(cv, 2, 10, 12, 4, PAL.fg2);
    cv.rect(3, 5, 3, 3, PAL.amber);
    cv.rect(10, 5, 3, 3, PAL.amber);
    cv.vline(2, 3, 6, PAL.amber);
    cv.vline(4, 2, 5, PAL.amber);
    cv.vline(6, 3, 6, PAL.amber);
    cv.vline(9, 3, 6, PAL.amber);
    cv.vline(11, 2, 5, PAL.amber);
    cv.vline(13, 3, 6, PAL.amber);
  },
  (cv) => {
    for (const x of [3, 6, 9, 12]) cv.put(x, 12, PAL.bg0);
  },
);

const drawAchvFirefighter = () => outlined(
  (cv) => {
    cv.hline(6, 9, 3, PAL.red);
    cv.hline(4, 11, 4, PAL.red);
    cv.rect(3, 5, 10, 5, PAL.red);
    cv.hline(2, 14, 9, PAL.red);
    cv.hline(3, 13, 10, PAL.red);
    cv.rect(3, 10, 3, 3, PAL.red);
    cv.hline(11, 14, 11, PAL.red);
  },
  (cv) => {
    cv.rect(5, 5, 2, 3, PAL.amber);
    cv.put(6, 6, PAL.fg0);
    cv.hline(6, 12, 9, PAL.bg0);
  },
);

const drawAchvTokenmaxxed = () => outlined(
  (cv) => {
    cv.vline(8, 6, 13, PAL.green2);
    cv.line(8, 9, 4, 12, PAL.green2);
    cv.line(8, 9, 12, 12, PAL.green2);
    cv.line(8, 6, 5, 8, PAL.green2);
    cv.line(8, 6, 11, 8, PAL.green2);
    for (const [x, y] of [[8, 6], [5, 8], [11, 8], [4, 12], [8, 13], [12, 12]]) cv.disc(x, y, 1, PAL.green);
    cv.tri(5, 4, 5, 1, 8, 4, PAL.amber);
    cv.tri(7, 4, 8, 1, 9, 4, PAL.amber);
    cv.tri(8, 4, 11, 1, 11, 4, PAL.amber);
  },
  (cv) => cv.hline(5, 11, 4, PAL.amber),
);

const drawAchvScriptKiddie = () => outlined(
  (cv) => {
    cv.put(8, 2, PAL.purple);
    cv.hline(7, 9, 3, PAL.purple);
    cv.hline(6, 10, 4, PAL.purple);
    cv.rect(5, 5, 7, 4, PAL.purple);
    cv.hline(6, 10, 9, PAL.purple);
    cv.rect(7, 10, 3, 2, PAL.purple);
    cv.hline(4, 12, 12, PAL.purple);
    cv.hline(2, 14, 13, PAL.purple);
  },
  (cv) => {
    cv.put(7, 7, PAL.green2);
    cv.put(9, 7, PAL.green2);
  },
);

const drawAchvNiceTry = () => outlined(
  (cv) => {
    cv.hline(5, 6, 4, PAL.fg0);
    cv.hline(4, 6, 5, PAL.fg0);
    cv.hline(4, 6, 6, PAL.fg0);
    cv.hline(3, 6, 7, PAL.fg0);
    cv.hline(4, 6, 8, PAL.fg0);
    cv.hline(3, 5, 9, PAL.fg0);
    cv.hline(2, 5, 10, PAL.fg0);
    cv.hline(2, 4, 11, PAL.fg0);
    cv.hline(1, 4, 12, PAL.fg0);
    cv.hline(10, 11, 4, PAL.fg0);
    cv.hline(10, 12, 5, PAL.fg0);
    cv.hline(10, 12, 6, PAL.fg0);
    cv.hline(10, 13, 7, PAL.fg0);
    cv.hline(10, 12, 8, PAL.fg0);
    cv.hline(11, 13, 9, PAL.fg0);
    cv.hline(11, 14, 10, PAL.fg0);
    cv.hline(12, 14, 11, PAL.fg0);
    cv.hline(12, 15, 12, PAL.fg0);
  },
  null,
  (cv) => {
    cv.line(2, 4, 3, 2, PAL.amber);
    cv.line(13, 2, 14, 4, PAL.amber);
  },
);

const drawAchvRubberDuck = () => outlined(
  (cv) => {
    cv.put(2, 5, PAL.amber);
    cv.hline(2, 3, 6, PAL.amber);
    cv.hline(3, 4, 7, PAL.amber);
    cv.hline(4, 5, 8, PAL.amber);
    cv.hline(5, 9, 9, PAL.amber);
    cv.hline(4, 11, 10, PAL.amber);
    cv.hline(4, 11, 11, PAL.amber);
    cv.hline(5, 10, 12, PAL.amber);
    cv.hline(6, 9, 13, PAL.amber);
    cv.hline(9, 11, 4, PAL.amber);
    cv.hline(8, 11, 5, PAL.amber);
    cv.hline(8, 11, 6, PAL.amber);
    cv.hline(9, 10, 7, PAL.amber);
    cv.vline(9, 7, 9, PAL.amber);
    cv.tri(11, 5, 13, 6, 11, 7, PAL.red);
  },
  (cv) => cv.put(10, 5, PAL.bg0),
);

const drawAchvOneShotWonder = () => outlined(
  (cv) => {
    cv.ring(8, 8, 4, PAL.blue);
    cv.line(2, 2, 13, 13, PAL.green);
    cv.line(2, 4, 4, 2, PAL.green);
    cv.line(1, 3, 3, 1, PAL.green);
    cv.line(10, 13, 13, 13, PAL.green);
    cv.line(13, 10, 13, 13, PAL.green);
  },
  (cv) => cv.put(8, 8, PAL.green),
);

const drawAchvTechnicalDebt = () => outlined(
  (cv) => {
    cv.hline(2, 8, 6, PAL.fg2);
    cv.hline(2, 7, 7, PAL.fg2);
    cv.hline(2, 8, 8, PAL.fg2);
    cv.hline(11, 14, 8, PAL.fg2);
    cv.hline(12, 14, 9, PAL.fg2);
    cv.hline(11, 14, 10, PAL.fg2);
  },
  (cv) => {
    cv.hline(3, 6, 7, PAL.amber);
    cv.hline(12, 13, 9, PAL.amber);
  },
);

const drawAchvSigkill = () => outlined(
  (cv) => {
    cv.hline(7, 9, 3, PAL.fg2);
    cv.hline(6, 10, 4, PAL.fg2);
    cv.rect(5, 5, 7, 6, PAL.fg2);
    cv.rect(3, 11, 11, 2, PAL.fg2);
    cv.rect(2, 13, 13, 1, PAL.fg2);
  },
  (cv) => polyline(cv, [[9, 6], [7, 7], [9, 8], [7, 10]], PAL.red),
);

const drawAchvNoMistakes = () => outlined(
  (cv) => {
    cv.hline(6, 10, 2, PAL.amber);
    cv.put(5, 3, PAL.amber);
    cv.put(11, 3, PAL.amber);
    cv.hline(4, 12, 7, PAL.blue);
    cv.hline(5, 11, 8, PAL.blue);
    cv.rect(5, 9, 7, 2, PAL.blue);
    cv.hline(6, 10, 11, PAL.blue);
    cv.hline(7, 9, 12, PAL.blue);
    cv.put(8, 13, PAL.blue);
  },
  (cv) => {
    cv.line(6, 9, 8, 11, PAL.fg0);
    cv.line(8, 11, 11, 8, PAL.fg0);
  },
);

const drawAchvAbsolutelyRight = () => outlined(
  (cv) => {
    cv.hline(6, 8, 3, PAL.amber);
    cv.hline(5, 9, 4, PAL.amber);
    cv.hline(5, 9, 5, PAL.amber);
    cv.hline(5, 8, 6, PAL.amber);
    cv.hline(5, 7, 7, PAL.amber);
    cv.rect(5, 8, 3, 2, PAL.amber);
    cv.rect(2, 10, 4, 4, PAL.fg2);
    cv.hline(8, 13, 10, PAL.amber);
    cv.hline(5, 13, 11, PAL.amber);
    cv.hline(5, 12, 12, PAL.amber);
    cv.hline(5, 11, 13, PAL.amber);
  },
  (cv) => cv.vline(5, 11, 12, PAL.bg0),
);

const drawAchvAfk = () => outlined(
  (cv) => {
    cv.hline(10, 12, 2, PAL.fg2);
    cv.rect(10, 3, 4, 6, PAL.fg2);
    cv.hline(5, 12, 9, PAL.fg2);
    cv.hline(4, 11, 10, PAL.fg2);
    cv.vline(8, 10, 12, PAL.fg2);
    cv.line(8, 12, 4, 13, PAL.fg2);
    cv.line(8, 12, 12, 13, PAL.fg2);
    cv.put(3, 13, PAL.fg2);
    cv.put(13, 13, PAL.fg2);
  },
);

const drawAchvRalph = () => outlined(
  (cv) => {
    polyline(cv, [[2, 8], [5, 4], [8, 7], [11, 4], [14, 8], [11, 12], [8, 9], [5, 12], [2, 8]], PAL.green);
    polyline(cv, [[2, 9], [5, 5], [8, 8], [11, 5], [14, 9], [11, 13], [8, 10], [5, 13], [2, 9]], PAL.green2);
  },
  null,
  null,
  true,
);

const drawAchvQaEngineer = () => outlined(
  (cv) => {
    // A broad side-on laptop wedge anchors the diagonal tool's silhouette.
    cv.hline(6, 12, 10, PAL.fg2);
    cv.hline(5, 13, 11, PAL.fg2);
    cv.hline(4, 14, 12, PAL.fg2);
    cv.hline(5, 14, 13, PAL.fg2);

    // Two separated jaws leave a real transparent bite after outlining.
    cv.hline(10, 13, 3, PAL.amber);
    cv.rect(9, 4, 2, 4, PAL.amber);
    cv.hline(10, 13, 8, PAL.amber);
    cv.line(3, 12, 9, 6, PAL.amber);
    cv.line(4, 13, 10, 7, PAL.amber);
  },
  (cv) => {
    cv.hline(6, 13, 12, PAL.bg3);
    cv.put(3, 12, PAL.amber);
  },
);

const ICON_DRAWERS = Object.freeze([
  ['tab_autocomplete', drawTabAutocomplete],
  ['copy_paste_chatbot', drawCopyPasteChatbot],
  ['agentic_ide', drawAgenticIde],
  ['cli_agent', drawCliAgent],
  ['subagent_swarm', drawSubagentSwarm],
  ['ralph_loop', drawRalphLoop],
  ['multi_harness', drawMultiHarness],
  ['background_fleet', drawBackgroundFleet],
  ['finetune_farm', drawFinetuneFarm],
  ['agi', drawAgi],
  ['mech_keyboard', drawMechKeyboard],
  ['vim_motions', drawVimMotions],
  ['macros', drawMacros],
  ['emacs_pinky', drawEmacsPinky],
  ['neural_interface', drawNeuralInterface],
  ['prompt_caching', drawPromptCaching],
  ['bigger_context', drawBiggerContext],
  ['model_router', drawModelRouter],
  ['mcp_servers', drawMcpServers],
  ['claude_md', drawClaudeMd],
  ['speculative_decoding', drawSpeculativeDecoding],
  ['distillation', drawDistillation],
  ['muscle_memory', drawMuscleMemory],
  ['subagent_sharding', drawSubagentSharding],
  ['gpu_interconnect', drawGpuInterconnect],
  ['yolo_mode', drawYoloMode],
  ['skip_permissions', drawSkipPermissions],
  ['ci_gate', drawCiGate],
  ['opus', drawOpus],
  ['haiku', drawHaiku],
  ['sonnet', drawSonnet],
  ['open_weights', drawOpenWeights],
  ['monorepo', drawMonorepo],
  ['microservices', drawMicroservices],
  ['vibe_coding', drawVibeCoding],
  ['rubber_duck', drawRubberDuck],
  ['test_coverage', drawTestCoverage],
  ['observability', drawObservability],
  ['scope_negotiation', drawScopeNegotiation],
  ['technical_debt', drawTechnicalDebt],
  ['ship_it_friday', drawShipItFriday],
  ['prompt_engineering', drawPromptEngineering],
  ['chinchilla', drawChinchilla],
  ['infinite_context', () => drawInfinity(PAL.blue)],
  ['gpu_cluster', drawGpuCluster],
  ['ralph_supremacy', drawRalphSupremacy],
  ['swarm_supremacy', drawSwarmSupremacy],
  ['growth_hacking', drawGrowthHacking],
  ['pair_programming', drawPairProgramming],
  ['crunch_time', drawCrunchTime],
  ['seed_funding', drawSeedFunding],
  ['cracked', drawCracked],
  ['founder_mode', drawFounderMode],
  ['scope_negotiator', drawScopeNegotiator],
  ['incubator', drawIncubator],
  ['prompt_library', drawPromptLibrary],
  ['reroll_token', drawRerollToken],
  ['technical_cofounder', drawTechnicalCofounder],
  ['hype_machine', drawHypeMachine],
  ['endless_mode', drawEndlessMode],
  ['loc_coworking', drawLocCoworking],
  ['loc_openplan', drawLocOpenplan],
  ['loc_datacenter', drawLocDatacenter],
  ['loc_orbital', drawLocOrbital],
  ['autoclicker', drawAutoclicker],
  ['cron_job', drawCronJob],
  ['ci_on_push', drawCiOnPush],
  ['headless_loop', drawHeadlessLoop],
  ['daemon_mode', drawDaemonMode],
  ['afk_farming', drawAfkFarming],
  ['idle_hands', drawIdleHands],
  ['keyboard_shortcuts', drawKeyboardShortcuts],
  ['snack_drawer', drawSnackDrawer],
  ['insurance', drawInsurance],
  ['unlock_lucky', drawUnlockLucky],
  ['flow_state', drawFlowState],
  ['hyperfocus', drawHyperfocus],
  ['beginners_luck', drawBeginnersLuck],
  ['in_the_zone', drawInTheZone],
  ['overclocked', drawOverclocked],
  ['one_shot', drawOneShot],
  ['eval_harness', drawEvalHarness],
  ['best_of_n', drawBestOfN],
  ['first_try', drawFirstTry],
  ['temperature_zero', drawTemperatureZero],
  ['achv_first_ship', drawAchvFirstShip],
  ['achv_series_a', drawAchvSeriesA],
  ['achv_demo_day', drawAchvDemoDay],
  ['achv_full_stack', drawAchvFullStack],
  ['achv_vertical', drawAchvVertical],
  ['achv_hellaslop', drawAchvHellaslop],
  ['achv_friday', drawAchvFriday],
  ['achv_no_hands', drawAchvNoHands],
  ['achv_firefighter', drawAchvFirefighter],
  ['achv_tokenmaxxed', drawAchvTokenmaxxed],
  ['achv_script_kiddie', drawAchvScriptKiddie],
  ['achv_nice_try', drawAchvNiceTry],
  ['achv_rubber_duck', drawAchvRubberDuck],
  ['achv_one_shot_wonder', drawAchvOneShotWonder],
  ['achv_technical_debt', drawAchvTechnicalDebt],
  ['achv_sigkill', drawAchvSigkill],
  ['achv_no_mistakes', drawAchvNoMistakes],
  ['achv_absolutely_right', drawAchvAbsolutelyRight],
  ['achv_afk', drawAchvAfk],
  ['achv_ralph', drawAchvRalph],
  ['achv_qa_engineer', drawAchvQaEngineer],
]);

const paletteColors = new Set(Object.values(PAL).map((hex) => hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16)).join(',')));

function validateIcon(id, canvas) {
  let opaque = 0;
  const colors = new Set();
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const [r, g, b, a] = canvas.get(x, y);
      if (a === 0) continue;
      opaque += 1;
      if (x === 0 || y === 0 || x === ICON_SIZE - 1 || y === ICON_SIZE - 1) {
        throw new Error(`${id} violates the 1px transparent margin at ${x},${y}`);
      }
      if (a !== 255 || !paletteColors.has(`${r},${g},${b}`)) {
        throw new Error(`${id} uses a non-palette pixel at ${x},${y}`);
      }
      colors.add(`${r},${g},${b}`);
    }
  }
  if (opaque === 0) throw new Error(`${id} rendered an empty icon`);
  if (colors.size > 4) throw new Error(`${id} uses ${colors.size} colors; expected at most 4`);
}

/** Build the deterministic 8x14 icon sheet and its ordered cell metadata. */
export function buildIcons() {
  if (ICON_DRAWERS.length !== 106) throw new Error(`Expected 106 icons, found ${ICON_DRAWERS.length}`);
  const rng = makeRng('tokenmaxxing-icons-v1');
  const canvas = new Canvas(ICON_SIZE * ICON_COLS, ICON_SIZE * ICON_ROWS);
  const cells = ICON_DRAWERS.map(([id, draw], index) => {
    const col = index % ICON_COLS;
    const row = Math.floor(index / ICON_COLS);
    const icon = draw(rng);
    validateIcon(id, icon);
    canvas.blit(icon, col * ICON_SIZE, row * ICON_SIZE);
    return Object.freeze({ id, col, row, canvas: icon });
  });

  for (let index = cells.length; index < ICON_COLS * ICON_ROWS; index += 1) {
    const col = index % ICON_COLS;
    const row = Math.floor(index / ICON_COLS);
    for (let y = 0; y < ICON_SIZE; y += 1) {
      for (let x = 0; x < ICON_SIZE; x += 1) {
        if (canvas.alphaAt(col * ICON_SIZE + x, row * ICON_SIZE + y) !== 0) {
          throw new Error(`Unused cell ${index} is not transparent`);
        }
      }
    }
  }

  return { canvas, cells: Object.freeze(cells) };
}

function iconMapSource(cells) {
  const entries = cells.map(({ id, col, row }) => `  ${id}: [${col}, ${row}],`).join('\n');
  return `// GENERATED BY tools/art/icons.mjs - do not edit by hand
export const ICON_SIZE = 16;
export const ICON_COLS = 8;
export const ICON_ROWS = 14;
export const ICON_SHEET = new URL('../../public/sprites/icons.png', import.meta.url).href;
/** id -> [col, row] in the 16px grid. */
export const ICONS: Readonly<Record<string, readonly [number, number]>> = {
${entries}
};
export function iconPos(id: string): readonly [number, number] | null {
  return ICONS[id] ?? null;
}
`;
}

function writeIcons() {
  const { canvas, cells } = buildIcons();
  const pngPath = join(ROOT, 'public/sprites/icons.png');
  const mapPath = join(ROOT, 'src/ui/icon-map.ts');
  writePNG(pngPath, canvas);
  mkdirSync(dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, iconMapSource(cells));
  console.log(`icons: ${cells.length} cells -> public/sprites/icons.png (${canvas.w}x${canvas.h}), src/ui/icon-map.ts`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeIcons();
