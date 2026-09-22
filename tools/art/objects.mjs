import { Canvas, PAL, bayer } from './pixel.mjs';
import {
  buildDev, buildDuck, buildLaptop, buildMonitor, buildMug, buildTerminal,
} from './obj-desk.mjs';

// Must stay in sync with CLUTTER_SLOTS in src/render/atlas-types.ts.
const CLUTTER_SIZES = Object.freeze({
  clutter_duck: Object.freeze({ maxW: 12, maxH: 12 }),
  clutter_mug: Object.freeze({ maxW: 12, maxH: 12 }),
  clutter_monitor: Object.freeze({ maxW: 40, maxH: 40 }),
  clutter_terminal: Object.freeze({ maxW: 40, maxH: 40 }),
  clutter_swarm: Object.freeze({ maxW: 48, maxH: 34 }),
  clutter_loop: Object.freeze({ maxW: 44, maxH: 36 }),
  clutter_rack: Object.freeze({ maxW: 40, maxH: 52 }),
  clutter_fleet: Object.freeze({ maxW: 44, maxH: 52 }),
  clutter_gpuwall: Object.freeze({ maxW: 152, maxH: 26 }),
  clutter_agi: Object.freeze({ maxW: 40, maxH: 40 }),
});

function drawDrone(canvas, x, y, frameIndex, droneIndex) {
  const rotorPhase = (frameIndex + droneIndex) % 3;
  const rotorColor = rotorPhase === 1 ? PAL.fg1 : PAL.fg2;
  const leftRotor = x - 2;
  const rightRotor = x + 6;

  if (rotorPhase === 0) {
    canvas.hline(leftRotor - 1, leftRotor + 1, y, rotorColor);
    canvas.hline(rightRotor - 1, rightRotor + 1, y, rotorColor);
  } else if (rotorPhase === 1) {
    canvas.put(leftRotor, y - 1, rotorColor);
    canvas.put(leftRotor, y + 1, rotorColor);
    canvas.put(rightRotor, y - 1, rotorColor);
    canvas.put(rightRotor, y + 1, rotorColor);
  } else {
    canvas.hline(leftRotor - 1, leftRotor + 1, y, PAL.line);
    canvas.hline(rightRotor - 1, rightRotor + 1, y, PAL.line);
    canvas.put(leftRotor, y, PAL.fg2);
    canvas.put(rightRotor, y, PAL.fg2);
  }

  canvas.line(leftRotor, y + 1, x, y + 2, PAL.line);
  canvas.line(rightRotor, y + 1, x + 4, y + 2, PAL.line);
  canvas.rect(x, y + 1, 5, 4, PAL.bg0);
  canvas.hline(x + 1, x + 3, y + 2, PAL.bg3);
  canvas.hline(x + 1, x + 3, y + 3, PAL.bg2);
  canvas.put(x + 2, y + 2, PAL.green);
}

function drawSwarmFrame(frameIndex) {
  const canvas = new Canvas(48, 34);

  // A broad, low landing pad anchors the otherwise deliberately loose cloud.
  canvas.hline(13, 34, 27, PAL.bg0);
  canvas.hline(8, 39, 28, PAL.bg0);
  canvas.hline(4, 43, 29, PAL.bg0);
  canvas.hline(2, 45, 30, PAL.bg0);
  canvas.hline(5, 42, 31, PAL.bg0);
  canvas.hline(10, 37, 32, PAL.bg0);
  canvas.hline(9, 38, 29, PAL.bg3);
  canvas.hline(6, 41, 30, PAL.line);
  canvas.hline(10, 37, 31, PAL.bg2);
  canvas.hline(21, 26, 29, PAL.green2);
  canvas.hline(19, 28, 30, PAL.green2);
  canvas.hline(22, 25, 31, PAL.green2);

  const positions = [[5, 4], [18, 3], [33, 5], [11, 13], [27, 12], [37, 15], [20, 21]];
  const drift = [
    [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
    [[-1, 1], [1, 0], [0, 1], [1, -1], [-1, 0], [0, -1], [1, 0]],
    [[1, 0], [0, 1], [-1, -1], [0, 1], [1, 0], [-1, 1], [-1, -1]],
  ][frameIndex];

  positions.forEach(([x, y], index) => {
    drawDrone(canvas, x + drift[index][0], y + drift[index][1], frameIndex, index);
  });
  return canvas;
}

function drawLoopFrame(frameIndex) {
  const canvas = new Canvas(44, 36);

  // The tether has sagged into a permanent coil beside the machine.
  canvas.line(34, 29, 41, 29, PAL.bg0);
  canvas.line(41, 29, 42, 31, PAL.bg0);
  canvas.line(42, 31, 39, 34, PAL.bg0);
  canvas.line(39, 34, 34, 34, PAL.bg0);
  canvas.line(34, 34, 32, 32, PAL.bg0);
  canvas.line(37, 30, 41, 31, PAL.fg2);
  canvas.line(40, 33, 35, 33, PAL.line);

  // Squat housing, green-lit vents, and a heavy floor base.
  canvas.hline(9, 34, 4, PAL.bg0);
  canvas.hline(6, 37, 5, PAL.bg0);
  canvas.rect(4, 6, 35, 24, PAL.bg0);
  canvas.rect(5, 7, 33, 22, PAL.bg3);
  canvas.vline(6, 9, 26, PAL.line);
  canvas.vline(36, 9, 26, PAL.bg2);
  for (const y of [11, 15, 19, 23]) {
    canvas.put(3, y, PAL.green2);
    canvas.put(39, y, PAL.green2);
    canvas.hline(6, 9, y, PAL.green2);
    canvas.put(10, y, PAL.green);
    canvas.hline(34, 36, y, PAL.green2);
  }

  canvas.rect(2, 28, 38, 6, PAL.bg0);
  canvas.rect(4, 29, 34, 3, PAL.bg3);
  canvas.hline(7, 34, 32, PAL.line);
  canvas.rect(6, 33, 7, 2, PAL.bg0);
  canvas.rect(29, 33, 7, 2, PAL.bg0);
  canvas.put(36, 30, PAL.amber);

  // A thick flywheel leaves a dark outer outline and turns thirty degrees per frame.
  const cx = 22;
  const cy = 16;
  canvas.disc(cx, cy, 12, PAL.bg0);
  canvas.disc(cx, cy, 10, PAL.line);
  canvas.disc(cx, cy, 8, PAL.bg0);
  canvas.disc(cx, cy, 7, PAL.bg1);
  canvas.ring(cx, cy, 9, PAL.fg2);
  const angle = frameIndex * Math.PI / 6;
  for (let spoke = 0; spoke < 4; spoke += 1) {
    const spokeAngle = angle + spoke * Math.PI / 2;
    canvas.line(
      cx,
      cy,
      cx + Math.round(Math.cos(spokeAngle) * 7),
      cy + Math.round(Math.sin(spokeAngle) * 7),
      PAL.fg2,
    );
  }
  canvas.disc(cx, cy, 2, PAL.bg0);
  canvas.put(cx, cy, PAL.line);
  canvas.put(cx - 6, cy - 7, PAL.fg1);
  canvas.put(cx - 5, cy - 8, PAL.white);

  return canvas;
}

function drawRackUnit(canvas, y, index) {
  canvas.rect(11, y, 21, 7, PAL.bg0);
  canvas.rect(12, y + 1, 19, 5, PAL.bg2);
  canvas.vline(13, y + 2, y + 4, PAL.line);
  for (let x = 16; x <= 24; x += 2) {
    canvas.put(x, y + 2, PAL.bg0);
    canvas.put(x + 1, y + 4, PAL.line);
  }
  canvas.put(27, y + 2, index === 2 ? PAL.amber : PAL.green);
  canvas.put(29, y + 2, index === 1 ? PAL.amber : PAL.green2);
  canvas.hline(26, 29, y + 4, PAL.fg2);
}

function drawRack() {
  const canvas = new Canvas(40, 52);

  // Grey cable spaghetti exits the back-right before the open door and chassis are layered in.
  canvas.line(32, 16, 37, 18, PAL.bg0);
  canvas.line(37, 18, 35, 25, PAL.bg0);
  canvas.line(35, 25, 38, 29, PAL.bg0);
  canvas.line(33, 21, 38, 23, PAL.line);
  canvas.line(38, 23, 36, 34, PAL.bg0);
  canvas.line(34, 28, 38, 37, PAL.fg2);
  canvas.line(38, 37, 35, 43, PAL.bg0);

  // The mesh door is swung toward the viewer on the left hinge.
  for (let y = 12; y <= 42; y += 1) {
    const edge = y < 16 ? 2 + Math.floor((16 - y) / 2) : y > 39 ? 2 + Math.floor((y - 39) / 2) : 2;
    canvas.hline(edge, 9, y, PAL.bg0);
    if (y > 12 && y < 42) canvas.hline(edge + 1, 8, y, PAL.bg2);
  }
  canvas.line(9, 8, 2, 12, PAL.bg0);
  canvas.line(2, 42, 9, 46, PAL.bg0);
  canvas.vline(2, 13, 41, PAL.bg0);
  for (let y = 15; y <= 39; y += 3) {
    for (let x = 4 + (y % 2); x <= 7; x += 2) canvas.put(x, y, PAL.line);
  }

  // Short 19-inch cabinet with four clearly separated 1U faces.
  canvas.hline(11, 31, 5, PAL.bg0);
  canvas.rect(8, 6, 27, 41, PAL.bg0);
  canvas.rect(9, 7, 25, 39, PAL.bg3);
  canvas.hline(11, 31, 7, PAL.fg2);
  canvas.vline(9, 9, 44, PAL.line);
  canvas.vline(33, 9, 44, PAL.bg2);
  [10, 18, 26, 34].forEach((y, index) => drawRackUnit(canvas, y, index));
  canvas.hline(11, 31, 43, PAL.line);
  canvas.hline(12, 30, 45, PAL.bg2);

  // Two large castors make the rack outline broad and low.
  canvas.rect(11, 46, 5, 3, PAL.bg0);
  canvas.rect(28, 46, 5, 3, PAL.bg0);
  canvas.disc(13, 49, 1, PAL.bg0);
  canvas.disc(30, 49, 1, PAL.bg0);
  canvas.put(13, 49, PAL.fg2);
  canvas.put(30, 49, PAL.fg2);

  return canvas;
}

function drawFleetBlade(canvas, y, index, frameIndex) {
  canvas.rect(10, y, 26, 4, PAL.bg0);
  canvas.rect(11, y + 1, 24, 2, PAL.bg2);
  for (let x = 13 + (index % 2); x <= 28; x += 3) canvas.put(x, y + 1, PAL.line);
  for (let x = 12 + ((index + 1) % 2); x <= 27; x += 3) canvas.put(x, y + 2, PAL.bg0);

  const greenOn = (index + frameIndex * 3) % 4 !== 0;
  const amberOn = (index + frameIndex) % 5 === 2;
  canvas.put(32, y + 1, greenOn ? PAL.green : PAL.line);
  canvas.put(34, y + 1, amberOn ? PAL.amber : PAL.bg1);
}

function drawFleetFrame(frameIndex) {
  const canvas = new Canvas(44, 52);

  // Sparse cold-aisle spill sits behind the uninterrupted tower silhouette.
  for (let y = 7; y <= 47; y += 3) {
    if (bayer(4, y + frameIndex, 4) < 0.35) canvas.put(4, y, PAL.blue);
    if (bayer(39, y + frameIndex, 4) < 0.35) canvas.put(39, y, PAL.blue);
  }

  // A U-shaped lifting handle immediately separates this tower from the rack.
  canvas.hline(17, 27, 1, PAL.bg0);
  canvas.vline(17, 1, 5, PAL.bg0);
  canvas.vline(27, 1, 5, PAL.bg0);
  canvas.hline(18, 26, 2, PAL.line);
  canvas.put(18, 4, PAL.fg2);
  canvas.put(26, 4, PAL.fg2);

  canvas.hline(9, 34, 4, PAL.bg0);
  canvas.rect(6, 5, 33, 44, PAL.bg0);
  canvas.rect(7, 6, 31, 42, PAL.bg3);
  canvas.rect(8, 7, 3, 39, PAL.bg1);
  canvas.rect(36, 7, 2, 39, PAL.bg2);
  canvas.vline(7, 8, 45, PAL.line);
  for (let y = 9; y <= 44; y += 6) canvas.put(7, y, PAL.blue);
  for (let blade = 0; blade < 8; blade += 1) drawFleetBlade(canvas, 7 + blade * 5, blade, frameIndex);
  canvas.hline(9, 36, 47, PAL.line);

  canvas.rect(9, 48, 7, 3, PAL.bg0);
  canvas.rect(30, 48, 7, 3, PAL.bg0);
  canvas.hline(10, 15, 49, PAL.fg2);
  canvas.hline(31, 36, 49, PAL.fg2);

  return canvas;
}

function drawFan(canvas, cx, cy, frameIndex, fanIndex) {
  canvas.disc(cx, cy, 3, PAL.bg0);
  canvas.disc(cx, cy, 2, PAL.bg1);
  const angle = (frameIndex * 2 + fanIndex) * Math.PI / 6;
  for (let blade = 0; blade < 3; blade += 1) {
    const bladeAngle = angle + blade * Math.PI * 2 / 3;
    canvas.put(
      cx + Math.round(Math.cos(bladeAngle) * 2),
      cy + Math.round(Math.sin(bladeAngle) * 2),
      PAL.fg2,
    );
  }
  canvas.put(cx, cy, PAL.line);
}

function drawGpuWallFrame(frameIndex) {
  const canvas = new Canvas(152, 26);

  // Purple points beneath and between cards make the backlight spill without soft alpha.
  for (let x = 2; x <= 149; x += 1) {
    if (bayer(x + frameIndex, 22, 4) < 0.42) canvas.put(x, 22, PAL.purple);
    if (bayer(x + frameIndex, 24, 4) < 0.22) canvas.put(x, 24, PAL.purple);
  }

  canvas.hline(2, 149, 1, PAL.bg0);
  for (let card = 0; card < 10; card += 1) {
    const x = 2 + card * 15;
    canvas.rect(x, 2, 14, 17, PAL.bg0);
    canvas.rect(x + 1, 3, 12, 15, PAL.bg3);
    canvas.hline(x + 2, x + 11, 3, PAL.line);
    canvas.vline(x + 1, 5, 16, PAL.bg2);
    drawFan(canvas, x + 4, 10, frameIndex, card * 2);
    drawFan(canvas, x + 10, 10, frameIndex, card * 2 + 1);
    canvas.hline(x + 3, x + 10, 16, PAL.line);
    canvas.put(x + 2, 17, PAL.purple);
    canvas.put(x + 11, 17, PAL.purple);
  }

  // Shared power rail visually binds all ten cards into one wide machine.
  canvas.rect(1, 18, 150, 6, PAL.bg0);
  canvas.rect(2, 19, 148, 4, PAL.bg3);
  canvas.hline(3, 148, 19, PAL.line);
  canvas.hline(4, 147, 22, PAL.bg2);
  for (let card = 0; card < 10; card += 1) {
    const x = 7 + card * 15;
    canvas.put(x, 20, (card + frameIndex) % 4 === 0 ? PAL.green2 : PAL.green);
    canvas.put(x + 2, 20, PAL.line);
  }
  canvas.put(3, 19, PAL.white);
  canvas.put(148, 19, PAL.fg1);

  return canvas;
}

function drawAgiFrame(frameIndex) {
  const canvas = new Canvas(40, 40);

  // The aura is deliberately ordered and sparse: an electrical stain, not a soft cloud.
  const density = [0.14, 0.2, 0.28][frameIndex];
  for (let y = 1; y <= 38; y += 1) {
    for (let x = 1; x <= 38; x += 1) {
      const distance = Math.hypot((x - 20) / 1.05, y - 19);
      const outsideSlab = x < 10 || x > 30 || y < 3 || y > 34;
      if (outsideSlab && distance < 19 && bayer(x + frameIndex, y, 4) < density * (1 - distance / 24)) {
        canvas.put(x, y, PAL.purple);
      }
    }
  }

  // Three floor tethers read as restraint cables once the slab and plinth cover their roots.
  canvas.line(13, 29, 10, 34, PAL.bg0);
  canvas.line(10, 34, 4, 37, PAL.bg0);
  canvas.line(27, 29, 31, 34, PAL.bg0);
  canvas.line(31, 34, 36, 37, PAL.bg0);
  canvas.line(19, 31, 17, 37, PAL.line);
  canvas.put(5, 37, PAL.fg2);
  canvas.put(35, 37, PAL.fg2);

  // Asymmetric slab shading keeps the monolith black while preserving its volume at 1x.
  canvas.hline(14, 26, 3, PAL.bg0);
  canvas.hline(12, 28, 4, PAL.bg0);
  canvas.rect(10, 5, 21, 28, PAL.bg0);
  canvas.rect(12, 5, 16, 26, PAL.bg1);
  canvas.vline(28, 6, 30, PAL.bg2);
  canvas.vline(29, 7, 31, PAL.line);
  for (let y = 7; y <= 29; y += 5) canvas.put(13, y, PAL.bg2);

  // One eye, no face: its hot white core cools to purple over the three frames.
  canvas.hline(14, 27, 14, PAL.line);
  if (frameIndex === 0) {
    canvas.hline(15, 26, 15, PAL.fg0);
    canvas.hline(18, 22, 15, PAL.white);
    canvas.put(15, 15, PAL.purple);
    canvas.put(26, 15, PAL.purple);
  } else if (frameIndex === 1) {
    canvas.hline(14, 27, 15, PAL.purple);
    canvas.hline(18, 23, 15, PAL.fg0);
    canvas.hline(20, 21, 15, PAL.white);
  } else {
    canvas.hline(13, 28, 14, PAL.purple);
    canvas.hline(14, 27, 15, PAL.purple);
    canvas.hline(19, 22, 15, PAL.fg0);
  }

  canvas.hline(12, 29, 31, PAL.bg0);
  canvas.hline(9, 32, 32, PAL.bg0);
  canvas.rect(8, 33, 25, 5, PAL.bg0);
  canvas.hline(10, 31, 33, PAL.line);
  canvas.hline(11, 30, 34, PAL.bg3);
  canvas.hline(6, 35, 38, PAL.bg0);
  canvas.hline(11, 30, 37, PAL.bg2);

  return canvas;
}

function buildNewClutter() {
  return {
    clutter_swarm: { frames: [0, 1, 2].map(drawSwarmFrame), fps: 6 },
    clutter_loop: { frames: [0, 1, 2].map(drawLoopFrame), fps: 10 },
    clutter_rack: { frames: [drawRack()] },
    clutter_fleet: { frames: [0, 1].map(drawFleetFrame), fps: 4 },
    clutter_gpuwall: { frames: [0, 1, 2].map(drawGpuWallFrame), fps: 8 },
    clutter_agi: { frames: [0, 1, 2].map(drawAgiFrame), fps: 5 },
  };
}

/** Build the desk objects and transparent-background clutter animations. */
export function buildObjects(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildObjects requires a deterministic rng');

  const laptop = buildLaptop(rng);
  const dev = buildDev(rng);
  const objects = {
    laptop,
    dev_idle: dev.idle,
    dev_type: dev.type,
    clutter_duck: buildDuck(rng),
    clutter_mug: buildMug(rng),
    clutter_monitor: buildMonitor(rng),
    clutter_terminal: buildTerminal(rng),
    ...buildNewClutter(),
  };

  for (const [name, slot] of Object.entries(CLUTTER_SIZES)) {
    for (const [frameIndex, frame] of objects[name].frames.entries()) {
      if (!(frame instanceof Canvas) || frame.w !== slot.maxW || frame.h !== slot.maxH) {
        throw new Error(
          `${name} frame ${frameIndex} must be ${slot.maxW}x${slot.maxH}`,
        );
      }
    }
  }
  return objects;
}
