import {
  Canvas, PAL, bayer, ditherFill, ditherRadial, mix, text,
} from './pixel.mjs';

const AMBER_D = mix(PAL.amber, PAL.bg1, 0.45);
const RED_D = mix(PAL.red, PAL.bg1, 0.45);
const BLUE_D = mix(PAL.blue, PAL.bg1, 0.45);
const PURPLE_D = mix(PAL.purple, PAL.bg1, 0.45);

// Keep the permitted companion shades live and named even when a particular
// desk prop does not need all four accents yet.
void RED_D;
void PURPLE_D;

function quad(canvas, topLeft, topRight, topY, bottomLeft, bottomRight, bottomY, color) {
  const height = Math.max(1, bottomY - topY);
  for (let y = topY; y <= bottomY; y += 1) {
    const t = (y - topY) / height;
    const left = Math.round(topLeft + (bottomLeft - topLeft) * t);
    const right = Math.round(topRight + (bottomRight - topRight) * t);
    canvas.hline(left, right, y, color);
  }
}

function laptopCode(rng) {
  const rows = [];
  let indent = 0;
  for (let row = 0; row < 12; row += 1) {
    if (row === 2) indent = 4;
    else if (row === 3 || row === 4) indent = 7;
    else if (row === 5) indent = 4;
    else if (row === 6 || row === 10) indent = 0;
    else if (rng.chance(0.35)) indent = rng.pick([0, 2, 4]);

    const runs = [];
    const count = rng.int(1, 3);
    let used = indent;
    for (let run = 0; run < count; run += 1) {
      const length = rng.int(2, 7);
      const gap = run === 0 ? 0 : rng.int(2, 4);
      if (used + gap + length > 31) break;
      runs.push({ gap, length, bright: rng() });
      used += gap + length;
    }
    rows.push({ indent, runs });
  }
  return rows;
}

function drawLaptopFrame(codeRows, frameIndex) {
  const canvas = new Canvas(64, 44);
  const geometry = [
    {
      topY: 2, baseY: 26, topLeft: 12, topRight: 51, bottomLeft: 9, bottomRight: 54,
      baseLeft: 5, baseRight: 58, bloom: 26, bloomFloor: 0.64, bezelGlow: 0.14, bright: 0.34,
    },
    {
      topY: 5, baseY: 27, topLeft: 10, topRight: 53, bottomLeft: 7, bottomRight: 56,
      baseLeft: 3, baseRight: 60, bloom: 28, bloomFloor: 0.57, bezelGlow: 0.22, bright: 0.55,
    },
    {
      topY: 8, baseY: 28, topLeft: 8, topRight: 55, bottomLeft: 5, bottomRight: 58,
      baseLeft: 1, baseRight: 62, bloom: 30, bloomFloor: 0.49, bezelGlow: 0.34, bright: 0.84,
    },
  ][frameIndex];

  const screenCenterY = Math.round((geometry.topY + geometry.baseY) / 2);
  const glow = new Canvas(64, geometry.baseY + 3);
  ditherRadial(
    glow, 32, screenCenterY, geometry.bloom, PAL.green, PAL.bg0, 4,
    { ease: (t) => geometry.bloomFloor + (1 - geometry.bloomFloor) * t },
  );
  canvas.blit(glow, 0, 0);

  // The contact shadow owns the shared y=42 baseline on every frame.
  for (let x = Math.max(1, geometry.baseLeft - 2); x <= Math.min(62, geometry.baseRight + 2); x += 1) {
    if (bayer(x, 42, 4) < 0.42) canvas.put(x, 42, PAL.bg1);
  }
  canvas.hline(geometry.baseLeft + 2, geometry.baseRight - 2, 41, PAL.bg0);

  // Lid: dark silhouette, two-pixel bezel, inner seam, then glass.
  quad(
    canvas,
    geometry.topLeft, geometry.topRight, geometry.topY,
    geometry.bottomLeft, geometry.bottomRight, geometry.baseY,
    PAL.bg0,
  );
  quad(
    canvas,
    geometry.topLeft + 1, geometry.topRight - 1, geometry.topY + 1,
    geometry.bottomLeft + 1, geometry.bottomRight - 1, geometry.baseY - 1,
    PAL.bg3,
  );
  quad(
    canvas,
    geometry.topLeft + 2, geometry.topRight - 2, geometry.topY + 2,
    geometry.bottomLeft + 2, geometry.bottomRight - 2, geometry.baseY - 2,
    PAL.line,
  );
  quad(
    canvas,
    geometry.topLeft + 3, geometry.topRight - 3, geometry.topY + 3,
    geometry.bottomLeft + 3, geometry.bottomRight - 3, geometry.baseY - 3,
    PAL.bg0,
  );

  for (let x = geometry.topLeft + 2; x <= geometry.topRight - 2; x += 1) {
    if (bayer(x, geometry.topY + 1, 4) < geometry.bezelGlow) {
      canvas.put(x, geometry.topY + 1, PAL.green);
    }
  }
  for (let y = geometry.topY + 3; y <= geometry.baseY - 3; y += 1) {
    const t = (y - geometry.topY) / (geometry.baseY - geometry.topY);
    const left = Math.round(geometry.topLeft + (geometry.bottomLeft - geometry.topLeft) * t) + 1;
    if (bayer(left, y, 4) < geometry.bezelGlow) canvas.put(left, y, PAL.green);
  }

  const screenLeft = geometry.topLeft + 3;
  const screenRight = geometry.topRight - 3;
  const tabY = geometry.topY + 3;
  canvas.hline(screenLeft, screenRight, tabY, PAL.fg2);
  canvas.hline(screenLeft + 4, screenLeft + 7, tabY, PAL.bg2);
  canvas.hline(screenLeft + 12, screenLeft + 15, tabY, PAL.bg2);

  const firstCodeY = tabY + 2;
  const lastCodeY = geometry.baseY - 3;
  const visibleRows = Math.floor((lastCodeY - firstCodeY) / 2) + 1;
  const scroll = frameIndex;
  for (let visible = 0; visible < visibleRows; visible += 1) {
    const row = codeRows[visible + scroll];
    const y = firstCodeY + visible * 2;
    let x = screenLeft + 1 + row.indent;
    for (const run of row.runs) {
      x += run.gap;
      const right = Math.min(screenRight - 1, x + run.length - 1);
      if (x <= right) canvas.hline(x, right, y, run.bright < geometry.bright ? PAL.green : PAL.green2);
      x = right + 1;
    }
    if (visible === visibleRows - 1) {
      const cursorX = Math.min(screenRight - 2, Math.max(screenLeft + 2, x + 1));
      canvas.rect(cursorX, y, 2, 1, PAL.green);
    }
  }

  if (frameIndex === 2) {
    canvas.put(screenLeft + 4, tabY + 3, PAL.white);
    canvas.put(screenLeft + 5, tabY + 4, PAL.white);
    canvas.put(screenLeft + 7, tabY + 5, PAL.white);
  }

  // Keyboard deck and front lip retain their controls while the shell widens.
  quad(
    canvas,
    geometry.bottomLeft - 1, geometry.bottomRight + 1, geometry.baseY,
    geometry.baseLeft, geometry.baseRight, 40,
    PAL.bg0,
  );
  quad(
    canvas,
    geometry.bottomLeft, geometry.bottomRight, geometry.baseY + 1,
    geometry.baseLeft + 2, geometry.baseRight - 2, 38,
    PAL.bg3,
  );

  canvas.hline(geometry.bottomLeft + 1, geometry.bottomRight - 1, geometry.baseY + 1, PAL.green2);
  if (frameIndex === 2) {
    canvas.hline(geometry.bottomLeft + 2, geometry.bottomRight - 2, geometry.baseY + 2, PAL.green);
  }

  const keyRows = frameIndex === 2 ? 4 : 5;
  for (let row = 0; row < keyRows; row += 1) {
    const y = geometry.baseY + 3 + row;
    const inset = 7 + Math.floor(row / 2);
    const left = geometry.baseLeft + inset;
    const right = geometry.baseRight - inset;
    for (let x = left + (row % 2); x <= right; x += 4) {
      canvas.hline(x, Math.min(x + 2, right), y, PAL.line);
    }
  }
  canvas.hline(25, 38, 34, PAL.line);

  canvas.rect(26, 35, 12, 4, PAL.line);
  canvas.rect(27, 35, 10, 3, PAL.bg2);
  canvas.hline(28, 35, 35, PAL.bg3);

  canvas.hline(geometry.baseLeft + 1, geometry.baseRight - 1, 39, PAL.bg2);
  canvas.hline(geometry.baseLeft + 2, geometry.baseRight - 2, 39, PAL.fg2);
  canvas.hline(geometry.baseLeft + 2, geometry.baseRight - 2, 40, PAL.bg2);
  canvas.put(53, 40, PAL.green);
  canvas.put(52, 40, PAL.green2);

  return canvas;
}

export function buildLaptop(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildLaptop requires a deterministic rng');
  const codeRows = laptopCode(rng);
  return { frames: [0, 1, 2].map((frame) => drawLaptopFrame(codeRows, frame)), fps: 12 };
}

function drawDevFrame(mode, frameIndex) {
  const canvas = new Canvas(24, 28);
  const body = new Canvas(24, 28);
  const breath = mode === 'idle' && frameIndex === 1 ? 1 : 0;
  const bob = mode === 'type' && frameIndex === 1 ? 1 : 0;
  const shift = breath + bob;

  // Chair is deliberately visible on the shadow side and beneath the seat.
  canvas.rect(3, 18, 3, 9, PAL.bg0);
  canvas.vline(4, 19, 25, PAL.line);
  canvas.hline(5, 20, 26, PAL.bg0);
  canvas.hline(6, 19, 26, PAL.line);
  canvas.hline(7, 18, 27, PAL.bg0);

  // Hooded head, ear cup, torso and asymmetric seated slouch.
  body.hline(10, 14, 4 + shift, PAL.bg2);
  body.hline(8, 16, 5 + shift, PAL.bg2);
  body.rect(8, 6 + shift, 9, 6, PAL.bg2);
  body.hline(9, 15, 12 + shift, PAL.bg2);
  body.rect(16, 7 + shift, 3, 4, PAL.bg2);

  body.hline(8, 16, 12 + shift, PAL.bg2);
  body.hline(6, 18, 13 + shift, PAL.bg2);
  body.rect(5, 14 + shift, 15, 8, PAL.bg2);
  body.hline(4, 20, 22, PAL.bg2);
  body.rect(4, 23, 17, 4, PAL.bg2);

  const leftHandY = mode === 'type' ? (frameIndex === 0 ? 17 : 19) : 22 + breath;
  const rightHandY = mode === 'type' ? (frameIndex === 0 ? 20 : 17) : 23 + breath;
  body.rect(3, mode === 'type' ? 15 + shift : 17 + shift, 4, Math.max(2, leftHandY - 14 - shift), PAL.bg2);
  body.rect(18, mode === 'type' ? 16 + shift : 18 + shift, 4, Math.max(2, rightHandY - 15 - shift), PAL.bg2);
  body.rect(2, leftHandY, 3, 2, PAL.fg2);
  body.rect(20, rightHandY, 2, 2, PAL.fg2);

  body.outline(PAL.bg0, 255, false);
  canvas.blit(body, 0, 0);

  // Far-side folds and the hood seam stay on the grey ramp.
  canvas.vline(5, 16 + shift, 23, PAL.bg1);
  canvas.vline(6, 15 + shift, 21, PAL.bg1);
  canvas.hline(9, 14, 10 + shift, PAL.line);
  canvas.put(8, 11 + shift, PAL.line);
  canvas.hline(10, 12, 18 + shift, PAL.line);
  canvas.hline(9, 11, 23, PAL.line);
  canvas.hline(10, 11, 24, PAL.line);

  // Hair at the nape, hands, headphone band/cup, and screen-side rim.
  canvas.put(10, 13 + shift, PAL.fg2);
  canvas.put(11, 13 + shift, PAL.fg2);
  canvas.put(13, 13 + shift, PAL.fg2);
  canvas.rect(2, leftHandY, 3, 2, PAL.fg2);
  canvas.rect(20, rightHandY, 2, 2, PAL.fg2);

  canvas.hline(9, 15, 2 + shift, PAL.bg0);
  canvas.put(8, 3 + shift, PAL.bg0);
  canvas.put(16, 3 + shift, PAL.bg0);
  canvas.hline(10, 14, 3 + shift, PAL.line);
  canvas.put(9, 4 + shift, PAL.line);
  canvas.put(15, 4 + shift, PAL.line);
  canvas.rect(16, 7 + shift, 3, 4, PAL.bg2);
  canvas.vline(18, 8 + shift, 10 + shift, PAL.line);
  canvas.put(17, 9 + shift, PAL.green);

  const rim = breath ? PAL.green2 : PAL.green;
  canvas.vline(16, 5 + shift, 7 + shift, rim);
  canvas.vline(17, 11 + shift, 13 + shift, rim);
  canvas.put(18, 14 + shift, rim);
  canvas.vline(19, 15 + shift, 19 + shift, rim);
  canvas.put(20, 20 + shift, rim);

  return canvas;
}

export function buildDev(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildDev requires a deterministic rng');
  return {
    idle: { frames: [drawDevFrame('idle', 0), drawDevFrame('idle', 1)], fps: 2 },
    type: { frames: [drawDevFrame('type', 0), drawDevFrame('type', 1)], fps: 8 },
  };
}

export function buildDuck(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildDuck requires a deterministic rng');
  const canvas = new Canvas(12, 12);
  const duck = new Canvas(12, 12);

  canvas.hline(2, 9, 11, PAL.bg2);
  duck.put(3, 6, AMBER_D);
  duck.hline(2, 4, 7, AMBER_D);
  duck.hline(4, 8, 6, PAL.amber);
  duck.hline(3, 9, 7, PAL.amber);
  duck.hline(3, 9, 8, AMBER_D);
  duck.hline(4, 8, 9, AMBER_D);
  duck.disc(7, 4, 2, PAL.amber);
  duck.rect(9, 4, 2, 2, PAL.red);
  duck.put(9, 5, RED_D);
  duck.outline(PAL.bg0, 255, false);
  canvas.blit(duck, 0, 0);

  canvas.hline(5, 8, 7, PAL.amber);
  canvas.put(8, 4, PAL.bg0);
  canvas.put(8, 3, PAL.white);
  canvas.put(6, 2, PAL.white);

  return { frames: [canvas] };
}

export function buildMug(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildMug requires a deterministic rng');
  const canvas = new Canvas(12, 12);
  const mug = new Canvas(12, 12);

  // Two detached steam wisps fade by ordered omission at their top ends.
  canvas.put(5, 1, PAL.fg2);
  canvas.put(5, 2, PAL.fg2);
  canvas.put(4, 3, PAL.fg2);
  if (bayer(7, 1, 4) < 0.6) canvas.put(7, 1, PAL.fg2);
  canvas.put(8, 2, PAL.fg2);
  canvas.put(8, 3, PAL.fg2);

  mug.rect(3, 5, 6, 6, PAL.fg2);
  mug.hline(4, 7, 4, PAL.fg1);
  mug.put(3, 5, PAL.fg1);
  mug.put(8, 5, PAL.fg1);
  mug.rect(9, 6, 2, 4, PAL.fg2);
  mug.put(10, 7, PAL.bg0);
  mug.put(10, 8, PAL.bg0);
  mug.outline(PAL.bg0, 255, false);
  canvas.blit(mug, 0, 0);

  canvas.hline(4, 7, 4, PAL.fg1);
  canvas.hline(4, 7, 5, PAL.bg0);
  canvas.hline(5, 6, 5, PAL.fg2);
  canvas.vline(3, 6, 9, PAL.line);
  canvas.vline(8, 6, 9, PAL.fg1);
  canvas.hline(4, 7, 10, PAL.fg2);

  return { frames: [canvas] };
}

export function buildMonitor(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildMonitor requires a deterministic rng');
  const canvas = new Canvas(40, 40);

  const glow = new Canvas(40, 25);
  ditherRadial(
    glow, 20, 13, 19, BLUE_D, PAL.bg0, 4,
    { ease: (t) => 0.68 + t * 0.32 },
  );
  ditherRadial(
    glow, 20, 13, 17, PAL.blue, PAL.bg0, 4,
    { ease: (t) => 0.76 + t * 0.24 },
  );
  canvas.blit(glow, 0, 0);

  // A one-pixel ordered halo hugs the panel so the radial bloom reads at 1x.
  for (let y = 3; y <= 23; y += 1) {
    const t = (y - 2) / 22;
    const left = Math.round(5 + (3 - 5) * t) - 1;
    const right = Math.round(34 + (36 - 34) * t) + 1;
    if (bayer(left, y, 4) < 0.38) canvas.put(left, y, BLUE_D);
    if (bayer(right, y, 4) < 0.38) canvas.put(right, y, PAL.blue);
  }
  for (let x = 6; x <= 33; x += 1) {
    if (bayer(x, 1, 4) < 0.28) canvas.put(x, 1, BLUE_D);
  }

  // Slightly skewed panel: the left edge starts one pixel higher.
  quad(canvas, 5, 34, 2, 3, 36, 24, PAL.bg0);
  quad(canvas, 6, 33, 3, 4, 35, 23, PAL.bg3);
  quad(canvas, 7, 32, 4, 5, 34, 22, PAL.line);
  quad(canvas, 8, 31, 5, 6, 33, 21, PAL.bg0);
  for (let x = 8; x <= 31; x += 1) {
    if (bayer(x, 3, 4) < 0.2) canvas.put(x, 3, PAL.blue);
  }

  // IDE chrome: sidebar, gutter, and compact code strokes.
  canvas.rect(7, 6, 4, 15, PAL.bg2);
  canvas.rect(11, 6, 3, 15, PAL.bg1);
  canvas.put(8, 8, PAL.fg2);
  canvas.put(8, 12, PAL.fg2);
  canvas.put(8, 16, PAL.fg2);
  for (const y of [7, 9, 11, 13, 15, 17, 19]) canvas.put(12, y, PAL.fg2);

  const code = [
    [7, 15, 19, PAL.blue, 22, 27, PAL.fg1],
    [9, 17, 24, PAL.fg2, 26, 30, PAL.fg1],
    [11, 15, 20, PAL.amber, 22, 31, PAL.fg1],
    [13, 18, 29, PAL.fg2],
    [15, 15, 22, PAL.blue, 24, 29, PAL.fg1],
    [17, 16, 27, PAL.green],
    [19, 18, 24, PAL.amber, 26, 31, PAL.fg2],
  ];
  for (const [y, x0, x1, color0, x2, x3, color1] of code) {
    canvas.hline(x0, x1, y, color0);
    if (x2 !== undefined) canvas.hline(x2, x3, y, color1);
  }

  // Neck and base sit behind the panel and land on y=39.
  canvas.rect(17, 23, 6, 13, PAL.bg0);
  canvas.rect(18, 23, 4, 12, PAL.bg3);
  canvas.vline(21, 24, 34, PAL.line);
  canvas.ellipse(20, 36, 9, 3, PAL.bg0);
  canvas.ellipse(20, 36, 8, 2, PAL.bg3);
  canvas.hline(13, 27, 37, PAL.bg2);
  canvas.hline(14, 26, 39, PAL.bg0);

  return { frames: [canvas] };
}

function knockedRect(canvas, x, y, w, h, color) {
  canvas.rect(x + 1, y, w - 2, h, color);
  canvas.rect(x, y + 1, w, h - 2, color);
}

function drawTerminalFrame(frameIndex) {
  const canvas = new Canvas(40, 40);

  // Full CRT silhouette, rounded front, and the three-pixel deep side face.
  canvas.hline(5, 33, 5, PAL.bg0);
  canvas.hline(3, 36, 6, PAL.bg0);
  canvas.rect(2, 7, 37, 29, PAL.bg0);
  canvas.hline(3, 36, 36, PAL.bg0);
  canvas.hline(5, 34, 37, PAL.bg0);
  knockedRect(canvas, 3, 7, 33, 29, PAL.bg3);
  canvas.rect(35, 9, 3, 25, PAL.bg2);
  canvas.vline(35, 10, 33, PAL.line);
  canvas.hline(6, 32, 7, PAL.line);

  // Recessed glass and asymmetrical inner bevel.
  knockedRect(canvas, 5, 8, 28, 20, PAL.bg0);
  canvas.hline(7, 30, 9, PAL.fg2);
  canvas.vline(6, 10, 25, PAL.fg2);
  canvas.hline(7, 30, 26, PAL.bg1);
  canvas.vline(31, 10, 25, PAL.bg1);
  ditherFill(canvas, 7, 10, 24, 16, PAL.bg0, PAL.green2, frameIndex === 2 ? 0.13 : 0.08, 4);
  for (let y = 11; y <= 25; y += 2) {
    for (let x = 7; x <= 30; x += 2) canvas.put(x, y, PAL.bg0);
  }

  const lines = frameIndex === 2
    ? [['SLOP OK', 10], ['> _', 16], ['42 TPS', 21]]
    : [['> RUN', 10], ['SLOP OK', 16], ['> _', 21]];
  for (const [line, y] of lines) text(canvas, 8, y, line, PAL.green, 255, 0);

  const cursorY = frameIndex === 2 ? 20 : 25;
  if (frameIndex !== 1) canvas.rect(14, cursorY, 2, 1, PAL.green);

  // Curved-glass streak: a short diagonal rather than a flat shine.
  canvas.put(8, 11, PAL.white);
  canvas.put(9, 12, PAL.white);
  canvas.put(10, 12, PAL.white);
  canvas.put(11, 13, PAL.white);

  // Controls, grille, and nameplate below the tube.
  for (const y of [29, 31, 33]) {
    canvas.hline(7, 10, y, PAL.line);
    canvas.hline(12, 15, y, PAL.line);
    canvas.hline(17, 20, y, PAL.line);
  }
  canvas.put(29, 32, PAL.green);
  canvas.put(28, 32, PAL.green2);
  canvas.hline(26, 28, 34, PAL.fg2);
  canvas.hline(6, 33, 38, PAL.bg1);
  canvas.hline(9, 30, 39, PAL.bg0);

  return canvas;
}

export function buildTerminal(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildTerminal requires a deterministic rng');
  return { frames: [0, 1, 2].map(drawTerminalFrame), fps: 4 };
}
