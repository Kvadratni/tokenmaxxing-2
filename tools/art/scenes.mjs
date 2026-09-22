import {
  Canvas, PAL, bayer, ditherFill, ditherGradientV,
} from './pixel.mjs';

const WIDTH = 320;
const HEIGHT = 180;

// Busy marks are kept out of these rectangles. Large, low-contrast silhouettes
// may cross a calm zone, but texture, LEDs, stars, brick joints, and highlights
// are all routed around them.
const CALM_ZONES = Object.freeze([
  [104, 84, 216, 152],
  [12, 118, 60, 152],
  [42, 74, 82, 114],
  [226, 74, 266, 114],
  [262, 116, 306, 152],
  [274, 30, 314, 82],
  [6, 26, 50, 78],
  [84, 12, 236, 38],
  [140, 4, 180, 44],
]);

function isCalm(x, y) {
  return CALM_ZONES.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

function isLaptopQuiet(x, y) {
  const [x0, y0, x1, y1] = CALM_ZONES[0];
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function detailPixel(canvas, x, y, color) {
  if (!isCalm(x, y)) canvas.put(x, y, color);
}

function detailHline(canvas, x0, x1, y, color) {
  for (let x = x0; x <= x1; x += 1) detailPixel(canvas, x, y, color);
}

function addProps(canvas, sceneName, draw) {
  const props = new Canvas(canvas.w, canvas.h);
  draw(props);
  for (const [x0, y0, x1, y1] of CALM_ZONES) {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (props.alphaAt(x, y) !== 0) {
          throw new Error(`${sceneName} prop entered calm zone at ${x},${y}`);
        }
      }
    }
  }
  canvas.blit(props, 0, 0);
}

function outlinedRect(canvas, x, y, w, h, color, outline = PAL.bg0) {
  canvas.rect(x, y, w, h, outline);
  if (w > 2 && h > 2) canvas.rect(x + 1, y + 1, w - 2, h - 2, color);
}

function drawCan(canvas, x, y, color, onSide = false) {
  if (onSide) {
    outlinedRect(canvas, x, y, 9, 5, PAL.fg2);
    canvas.hline(x + 2, x + 6, y + 2, color);
    canvas.put(x + 7, y + 2, PAL.fg1);
    return;
  }
  outlinedRect(canvas, x, y, 5, 9, color);
  canvas.hline(x + 1, x + 3, y + 1, PAL.fg1);
  canvas.put(x + 2, y + 4, PAL.fg0);
}

function quad(canvas, topLeft, topRight, topY, bottomLeft, bottomRight, bottomY, color) {
  const height = Math.max(1, bottomY - topY);
  for (let y = topY; y <= bottomY; y += 1) {
    const t = (y - topY) / height;
    const left = Math.round(topLeft + (bottomLeft - topLeft) * t);
    const right = Math.round(topRight + (bottomRight - topRight) * t);
    canvas.hline(left, right, y, color);
  }
}

function lightPixel(canvas, x, y, intensity, core, mid = PAL.fg2, edge = PAL.line) {
  if (intensity <= 0 || isLaptopQuiet(x, y)) return;
  const threshold = bayer(x, y, 8);
  const coreCoverage = Math.max(0, Math.min(1, (intensity - 0.78) / 0.22));
  const midCoverage = Math.max(0, Math.min(1, (intensity - 0.22) / 0.78));
  if (threshold < coreCoverage) canvas.put(x, y, core);
  else if (threshold < midCoverage) canvas.put(x, y, mid);
  else if (threshold < intensity) canvas.put(x, y, edge);
}

// Light pools use a fine Bayer matrix and three neighboring value steps. The
// spatial ramp is solid beside the source, then loses coverage continuously
// until the far edge is untouched.
function ditheredLightQuad(
  canvas, topLeft, topRight, topY, bottomLeft, bottomRight, bottomY,
  core, mid = PAL.fg2, edge = PAL.line,
) {
  const height = Math.max(1, bottomY - topY);
  for (let y = topY; y <= bottomY; y += 1) {
    const t = (y - topY) / height;
    const left = Math.round(topLeft + (bottomLeft - topLeft) * t);
    const right = Math.round(topRight + (bottomRight - topRight) * t);
    const center = (left + right) / 2;
    const halfWidth = Math.max(1, (right - left) / 2);
    for (let x = left; x <= right; x += 1) {
      const lateral = Math.abs(x - center) / halfWidth;
      const distance = Math.min(1, t + lateral * 0.22);
      lightPixel(canvas, x, y, (1 - distance) ** 1.65, core, mid, edge);
    }
  }
}

function ditheredLightRadial(canvas, cx, cy, radius, core, mid = PAL.fg2, edge = PAL.line) {
  const reach = Math.ceil(radius);
  for (let y = Math.max(0, cy - reach); y <= Math.min(canvas.h - 1, cy + reach); y += 1) {
    for (let x = Math.max(0, cx - reach); x <= Math.min(canvas.w - 1, cx + reach); x += 1) {
      const distance = Math.hypot(x - cx, y - cy) / radius;
      if (distance <= 1) lightPixel(canvas, x, y, (1 - distance) ** 1.65, core, mid, edge);
    }
  }
}

function drawDesk(canvas, surface = PAL.bg3, front = PAL.bg2) {
  // A broad, quiet foreground plane gives every composited prop a firm baseline.
  canvas.hline(12, 307, 136, PAL.bg0);
  quad(canvas, 14, 305, 137, 3, 316, 152, surface);
  canvas.hline(17, 302, 138, PAL.line);
  canvas.hline(3, 316, 153, PAL.bg0);
  canvas.rect(7, 154, 306, 9, front);
  canvas.hline(7, 312, 154, PAL.line);
  canvas.hline(7, 312, 162, PAL.bg0);

  // The green laptop bounce is deliberately only a handful of ordered pixels.
  for (let y = 140; y <= 148; y += 2) {
    for (let x = 122; x <= 198; x += 1) {
      const falloff = Math.abs(x - 160) / 76 + (y - 140) / 40;
      if (falloff < 0.72 && bayer(x, y, 8) < 0.055) canvas.put(x, y, PAL.green2);
    }
  }

  canvas.rect(27, 163, 9, 17, PAL.bg0);
  canvas.vline(35, 164, 179, PAL.line);
  canvas.rect(284, 163, 9, 17, PAL.bg0);
  canvas.vline(284, 164, 179, PAL.line);
}

function drawBedroomProps(canvas) {
  // A broken fairy-light strand survives only in the gaps between landing zones.
  canvas.line(51, 19, 66, 22, PAL.bg0);
  canvas.line(66, 22, 83, 19, PAL.bg0);
  canvas.line(237, 19, 254, 22, PAL.bg0);
  canvas.line(254, 22, 273, 18, PAL.bg0);
  for (const [x, y] of [[54, 20], [62, 21], [72, 21], [81, 19], [240, 20], [249, 21], [259, 21], [269, 19]]) {
    canvas.put(x, y, PAL.amber);
    if (x === 72 || x === 259) canvas.put(x, y + 1, PAL.fg0);
  }

  // Sticky notes orbit the unseen central monitor without entering its quiet silhouette.
  for (const [x, y, color] of [
    [91, 86, PAL.amber], [97, 92, PAL.blue], [92, 100, PAL.red],
    [218, 87, PAL.green], [221, 96, PAL.amber], [218, 105, PAL.purple],
  ]) outlinedRect(canvas, x, y, 5, 5, color);

  // A tiny shelf pet has become the room's only cheerful witness.
  canvas.hline(7, 36, 94, PAL.bg0);
  canvas.hline(9, 34, 93, PAL.fg2);
  canvas.disc(21, 86, 6, PAL.bg0);
  canvas.disc(21, 87, 4, PAL.purple);
  canvas.disc(17, 82, 2, PAL.bg0);
  canvas.disc(25, 82, 2, PAL.bg0);
  canvas.put(19, 86, PAL.white);
  canvas.put(23, 86, PAL.white);
  canvas.put(21, 89, PAL.amber);

  // Laundry slumps over the bed's outer edge in three mismatched garments.
  canvas.disc(88, 123, 8, PAL.bg0);
  canvas.disc(95, 125, 7, PAL.bg0);
  canvas.disc(84, 128, 5, PAL.bg0);
  canvas.disc(88, 123, 6, PAL.fg2);
  canvas.disc(95, 125, 5, PAL.blue);
  canvas.disc(84, 128, 3, PAL.purple);
  canvas.hline(89, 96, 128, PAL.bg3);

  // Three cans, a ramen cup, and a fork make the desk feel actively abandoned.
  drawCan(canvas, 86, 128, PAL.blue);
  drawCan(canvas, 97, 130, PAL.red);
  drawCan(canvas, 92, 168, PAL.blue, true);
  canvas.put(95, 170, PAL.green);

  canvas.rect(242, 128, 9, 2, PAL.bg0);
  quad(canvas, 242, 250, 130, 244, 248, 137, PAL.bg0);
  quad(canvas, 244, 248, 130, 245, 247, 135, PAL.fg1);
  canvas.hline(244, 248, 132, PAL.red);
  canvas.line(249, 128, 254, 121, PAL.bg0);
  canvas.line(250, 128, 255, 121, PAL.fg0);
  canvas.put(253, 120, PAL.fg0);
  canvas.put(255, 122, PAL.fg0);

  // The old pizza box is wedged against a desk leg, not hero-sized.
  quad(canvas, 70, 79, 154, 64, 77, 169, PAL.bg0);
  quad(canvas, 71, 77, 156, 66, 75, 167, PAL.fg2);
  canvas.line(70, 159, 75, 164, PAL.red);
  canvas.line(68, 165, 74, 166, PAL.amber);
  canvas.put(70, 165, PAL.red);

  // Cables spill through the narrow channel beside the central composite.
  canvas.line(218, 140, 224, 147, PAL.bg0);
  canvas.line(224, 147, 218, 154, PAL.bg0);
  canvas.line(218, 154, 225, 160, PAL.bg0);
  canvas.line(221, 141, 225, 145, PAL.fg2);
  canvas.line(225, 145, 221, 151, PAL.fg2);
  canvas.put(224, 160, PAL.blue);

  // A dead plant at the desk's far edge is all stem, no green.
  canvas.line(314, 128, 310, 119, PAL.bg0);
  canvas.line(314, 128, 318, 117, PAL.bg0);
  canvas.line(314, 126, 309, 123, PAL.bg0);
  canvas.line(313, 127, 310, 120, PAL.fg2);
  canvas.line(315, 127, 318, 118, PAL.fg2);
  canvas.put(308, 122, PAL.amber);
  canvas.put(319, 117, PAL.amber);
  outlinedRect(canvas, 310, 129, 9, 8, PAL.bg3);
  canvas.hline(312, 317, 132, PAL.red);
}

function drawBedroom() {
  const canvas = new Canvas(WIDTH, HEIGHT, PAL.bg0);

  // Ceiling, wall, and low skirting: the smallest and darkest room.
  quad(canvas, 0, 319, 0, 13, 306, 15, PAL.bg1);
  canvas.line(0, 0, 13, 15, PAL.bg3);
  canvas.line(319, 0, 306, 15, PAL.bg3);
  canvas.hline(13, 306, 15, PAL.line);
  ditherGradientV(canvas, 0, 16, WIDTH, 68, PAL.bg1, PAL.bg2, 8);
  canvas.rect(0, 84, WIDTH, 48, PAL.bg2);
  canvas.hline(0, 319, 130, PAL.line);
  canvas.rect(0, 131, WIDTH, 6, PAL.bg1);

  // Cold window, offset from the upper-left clutter landing zone.
  canvas.rect(52, 25, 52, 54, PAL.bg0);
  canvas.frame(53, 26, 50, 52, PAL.line);
  ditherGradientV(canvas, 56, 29, 44, 45, PAL.bg0, PAL.bg1, 8);
  ditherFill(canvas, 56, 29, 44, 45, PAL.bg0, PAL.blue, 0.075, 8);
  canvas.vline(77, 29, 73, PAL.line);
  canvas.hline(56, 99, 51, PAL.line);
  canvas.disc(89, 38, 5, PAL.fg1);
  canvas.put(87, 36, PAL.fg0);
  canvas.rect(56, 62, 9, 12, PAL.bg1);
  canvas.rect(66, 57, 7, 17, PAL.bg2);
  canvas.rect(79, 64, 6, 10, PAL.bg1);
  canvas.rect(87, 54, 12, 20, PAL.bg2);
  for (const [x, y] of [[59, 65], [69, 61], [70, 66], [91, 58], [95, 62]]) {
    detailPixel(canvas, x, y, PAL.amber);
  }
  ditheredLightQuad(canvas, 63, 93, 76, 44, 105, 122, PAL.blue, PAL.fg2, PAL.line);

  // Faded poster, high enough to stay behind neither laptop nor clutter.
  canvas.rect(233, 42, 38, 35, PAL.bg0);
  canvas.rect(235, 44, 34, 31, PAL.bg1);
  canvas.hline(239, 264, 49, PAL.red);
  canvas.hline(241, 260, 51, PAL.bg3);
  canvas.tri(241, 69, 251, 55, 260, 69, PAL.line);
  canvas.hline(244, 257, 69, PAL.amber);
  canvas.put(236, 45, PAL.fg2);
  canvas.put(268, 74, PAL.fg2);

  // An unmade bed intrudes from the left as broad, rumpled value shapes.
  canvas.rect(0, 105, 91, 32, PAL.bg0);
  canvas.hline(0, 75, 101, PAL.line);
  canvas.rect(0, 102, 75, 30, PAL.bg3);
  canvas.rect(4, 99, 34, 13, PAL.fg2);
  canvas.hline(6, 35, 100, PAL.fg1);
  canvas.tri(35, 111, 73, 102, 75, 131, PAL.bg2);
  canvas.tri(0, 115, 47, 110, 74, 131, PAL.line);
  detailHline(canvas, 3, 26, 126, PAL.fg2);
  canvas.rect(0, 132, 89, 5, PAL.bg1);

  // Warm pool and lamp are the sole saturated key light. The carpet is laid
  // in before the desk so the apron and feet retain their crisp silhouette.
  ditheredLightRadial(canvas, 287, 104, 39, PAL.amber, PAL.fg2, PAL.line);
  canvas.rect(0, 155, WIDTH, 25, PAL.bg1);
  ditherFill(canvas, 0, 155, WIDTH, 25, PAL.bg1, PAL.bg2, 0.045, 8);

  drawDesk(canvas, PAL.bg3, PAL.bg2);
  ditheredLightQuad(canvas, 275, 299, 138, 252, 316, 150, PAL.amber, PAL.fg2, PAL.line);

  canvas.hline(275, 300, 88, PAL.bg0);
  canvas.tri(273, 101, 279, 89, 297, 101, PAL.bg0);
  canvas.tri(276, 99, 281, 91, 294, 99, PAL.amber);
  canvas.hline(276, 296, 102, PAL.line);
  canvas.rect(285, 103, 3, 34, PAL.bg0);
  canvas.vline(288, 104, 136, PAL.amber);
  canvas.hline(279, 296, 136, PAL.bg0);
  canvas.hline(282, 293, 135, PAL.line);
  canvas.put(286, 94, PAL.white);

  // Carpet clutter stays deliberately close to the dark floor values.
  canvas.line(109, 163, 122, 176, PAL.bg2);
  canvas.line(122, 176, 140, 168, PAL.bg0);
  canvas.ring(146, 173, 5, PAL.bg2);
  canvas.ring(155, 173, 5, PAL.bg2);
  canvas.line(160, 174, 188, 166, PAL.bg0);
  canvas.line(188, 166, 207, 173, PAL.bg2);
  canvas.rect(207, 171, 17, 5, PAL.bg2);
  canvas.frame(207, 171, 17, 5, PAL.bg0);
  canvas.put(210, 173, PAL.green);
  canvas.rect(52, 168, 9, 7, PAL.bg2);
  canvas.hline(53, 60, 168, PAL.bg0);
  canvas.line(61, 170, 64, 172, PAL.bg2);
  canvas.line(64, 172, 61, 174, PAL.bg2);

  addProps(canvas, 'bedroom', drawBedroomProps);

  return canvas;
}

function drawBrickWall(canvas) {
  for (let y = 28, row = 0; y <= 112; y += 10, row += 1) {
    detailHline(canvas, 0, 319, y, PAL.line);
    const offset = row % 2 === 0 ? 8 : 25;
    for (let x = offset; x < 320; x += 34) {
      for (let py = y - 9; py < y; py += 1) detailPixel(canvas, x, py, PAL.line);
    }
  }
  for (let y = 34; y < 111; y += 20) {
    for (let x = (y / 2) % 31; x < 320; x += 47) detailPixel(canvas, x, y, PAL.fg2);
  }
}

function drawPendant(canvas, x, cordEnd, wide = 12) {
  canvas.vline(x, 0, cordEnd - 3, PAL.bg0);
  canvas.put(x, cordEnd - 2, PAL.line);
  canvas.tri(x - wide, cordEnd + 7, x - 4, cordEnd - 1, x + wide, cordEnd + 7, PAL.bg0);
  canvas.hline(x - wide, x + wide, cordEnd + 7, PAL.line);
  canvas.hline(x - 4, x + 5, cordEnd + 5, PAL.amber);
  canvas.put(x, cordEnd + 6, PAL.white);
}

function drawEdgeLaptop(canvas, x, y, flip = false) {
  const left = x;
  canvas.rect(left, y, 35, 22, PAL.bg0);
  canvas.rect(left + 2, y + 2, 31, 17, PAL.bg1);
  ditherFill(canvas, left + 3, y + 3, 29, 15, PAL.bg1, PAL.blue, 0.13, 8);
  canvas.hline(left - 3, left + 38, y + 22, PAL.bg0);
  canvas.hline(left, left + 35, y + 21, PAL.line);
  canvas.put(flip ? left + 4 : left + 30, y + 4, PAL.white);
}

function drawCoworkingProps(canvas) {
  // Sticker constellations make the edge laptops unmistakably borrowed machines.
  for (const [x, y, color] of [
    [3, 116, PAL.red], [8, 122, PAL.amber], [4, 128, PAL.green],
    [308, 117, PAL.purple], [313, 123, PAL.amber], [309, 129, PAL.green],
  ]) outlinedRect(canvas, x, y, 3, 3, color);

  // A block-only hiring placard: corporate enthusiasm without readable type.
  outlinedRect(canvas, 85, 57, 18, 16, PAL.fg1);
  canvas.rect(88, 60, 12, 3, PAL.red);
  canvas.rect(88, 65, 8, 2, PAL.bg3);
  canvas.rect(88, 69, 11, 2, PAL.blue);

  // The commuter bicycle fits in the slim wall gap between sprite anchors.
  canvas.ring(89, 111, 5, PAL.bg0);
  canvas.ring(97, 111, 5, PAL.bg0);
  canvas.ring(89, 111, 4, PAL.fg1);
  canvas.ring(97, 111, 4, PAL.fg1);
  canvas.line(89, 111, 93, 103, PAL.bg0);
  canvas.line(93, 103, 97, 111, PAL.bg0);
  canvas.line(89, 111, 96, 110, PAL.bg0);
  canvas.line(93, 103, 96, 110, PAL.blue);
  canvas.line(93, 103, 99, 101, PAL.fg2);
  canvas.hline(97, 102, 100, PAL.bg0);
  canvas.line(87, 103, 93, 103, PAL.red);

  // Drinks occupy opposite ends of the communal table.
  drawCan(canvas, 98, 128, PAL.blue);
  outlinedRect(canvas, 218, 125, 6, 12, PAL.green2);
  canvas.rect(220, 122, 2, 4, PAL.bg0);
  canvas.put(220, 127, PAL.fg1);
  canvas.hline(219, 222, 132, PAL.amber);

  // A branded tote hangs off the chair; its logo is a single color block.
  canvas.line(98, 120, 101, 124, PAL.bg0);
  canvas.line(101, 124, 103, 120, PAL.bg0);
  outlinedRect(canvas, 96, 124, 8, 12, PAL.fg2);
  canvas.rect(98, 127, 4, 3, PAL.purple);

  // A bean bag is squeezed into the far corner, safely beyond the right anchor.
  canvas.disc(315, 130, 8, PAL.bg0);
  canvas.ellipse(315, 132, 6, 5, PAL.purple);
  canvas.hline(311, 319, 135, PAL.bg3);
  canvas.put(312, 128, PAL.fg1);

  // Business cards and the neglected ping-pong paddle finish the performative fun.
  outlinedRect(canvas, 86, 132, 13, 5, PAL.fg0);
  canvas.hline(89, 98, 130, PAL.bg0);
  canvas.hline(90, 98, 131, PAL.fg2);
  canvas.disc(221, 123, 4, PAL.bg0);
  canvas.disc(221, 123, 3, PAL.red);
  canvas.line(223, 126, 225, 135, PAL.bg0);
  canvas.line(222, 126, 224, 134, PAL.fg1);
}

function drawCoworking() {
  const canvas = new Canvas(WIDTH, HEIGHT, PAL.bg1);

  canvas.rect(0, 0, WIDTH, 20, PAL.bg0);
  ditherGradientV(canvas, 0, 20, WIDTH, 107, PAL.bg2, PAL.bg3, 8);
  canvas.rect(0, 113, WIDTH, 24, PAL.bg2);
  drawBrickWall(canvas);
  canvas.hline(0, 319, 19, PAL.line);
  canvas.hline(0, 319, 126, PAL.line);
  canvas.rect(0, 127, WIDTH, 10, PAL.bg1);

  ditheredLightQuad(canvas, 57, 71, 43, 38, 90, 102, PAL.amber, PAL.fg2, PAL.line);
  ditheredLightQuad(canvas, 153, 167, 45, 138, 182, 80, PAL.amber, PAL.fg2, PAL.line);
  ditheredLightQuad(canvas, 249, 263, 43, 232, 284, 102, PAL.amber, PAL.fg2, PAL.line);
  drawPendant(canvas, 64, 38, 13);
  drawPendant(canvas, 160, 40, 12);
  drawPendant(canvas, 256, 38, 13);

  // Whiteboard: the rising chart is concentrated in its left half so the
  // right-hand clutter landing zone remains a broad, calm plane.
  canvas.rect(219, 45, 88, 34, PAL.bg0);
  canvas.rect(221, 47, 84, 30, PAL.fg1);
  canvas.hline(226, 274, 72, PAL.fg2);
  canvas.vline(227, 54, 72, PAL.fg2);
  canvas.line(231, 68, 239, 66, PAL.blue);
  canvas.line(239, 66, 247, 62, PAL.blue);
  canvas.line(247, 62, 255, 63, PAL.blue);
  canvas.line(255, 63, 265, 55, PAL.blue);
  canvas.put(263, 55, PAL.white);
  canvas.put(264, 54, PAL.white);
  canvas.hline(279, 298, 52, PAL.bg3);
  canvas.hline(284, 300, 57, PAL.bg3);
  canvas.hline(279, 294, 62, PAL.bg3);
  canvas.rect(266, 78, 21, 2, PAL.bg0);

  // Monstera silhouette and pot at the extreme left.
  canvas.rect(20, 95, 3, 30, PAL.line);
  canvas.line(21, 103, 10, 87, PAL.green2);
  canvas.line(22, 106, 35, 87, PAL.green2);
  canvas.line(21, 111, 7, 103, PAL.green2);
  canvas.line(22, 113, 38, 105, PAL.green2);
  for (const [x, y, rx, ry] of [
    [9, 85, 8, 4], [36, 85, 8, 4], [7, 101, 8, 4], [39, 103, 9, 4], [22, 91, 6, 9],
  ]) {
    canvas.ellipse(x, y, rx, ry, PAL.bg0);
    canvas.ellipse(x, y, Math.max(1, rx - 1), Math.max(1, ry - 1), PAL.green2);
  }
  canvas.tri(11, 117, 34, 117, 29, 136, PAL.bg0);
  canvas.tri(14, 119, 31, 119, 27, 135, PAL.amber);
  canvas.hline(12, 33, 117, PAL.line);

  // The broad rug edge turns the under-desk strip into a floor without making
  // it a new focal plane.
  canvas.rect(0, 155, WIDTH, 25, PAL.bg1);
  canvas.rect(42, 168, 236, 12, PAL.bg0);
  canvas.hline(42, 277, 168, PAL.bg2);
  ditherFill(canvas, 43, 169, 234, 11, PAL.bg0, PAL.bg1, 0.16, 8);

  drawDesk(canvas, PAL.bg3, PAL.bg2);

  // Other workers are implied by edge screens and chair backs, never by a
  // noisy central silhouette behind the player.
  drawEdgeLaptop(canvas, 1, 112, false);
  drawEdgeLaptop(canvas, 284, 112, true);
  canvas.hline(2, 37, 136, PAL.blue);
  canvas.hline(285, 318, 136, PAL.blue);
  canvas.rect(71, 121, 24, 16, PAL.bg1);
  canvas.frame(71, 121, 24, 16, PAL.line);
  canvas.rect(226, 121, 23, 16, PAL.bg1);
  canvas.frame(226, 121, 23, 16, PAL.line);

  // Chair feet, a soft bag, and rug tassels complete the occupied floor.
  canvas.line(83, 163, 70, 176, PAL.bg2);
  canvas.line(83, 163, 98, 176, PAL.bg2);
  canvas.hline(66, 73, 176, PAL.bg2);
  canvas.hline(95, 102, 176, PAL.bg2);
  canvas.line(238, 163, 226, 176, PAL.bg2);
  canvas.line(238, 163, 252, 176, PAL.bg2);
  canvas.hline(222, 230, 176, PAL.bg2);
  canvas.hline(249, 256, 176, PAL.bg2);
  canvas.rect(258, 169, 16, 9, PAL.bg0);
  canvas.rect(260, 170, 12, 7, PAL.bg2);
  canvas.line(262, 169, 264, 166, PAL.bg2);
  canvas.hline(264, 269, 166, PAL.bg2);
  canvas.line(269, 166, 271, 169, PAL.bg2);
  for (const x of [48, 56, 264, 272]) canvas.put(x, 179, PAL.bg2);

  addProps(canvas, 'coworking', drawCoworkingProps);

  return canvas;
}

function drawOfficeDesk(canvas, x0, x1, y, scaleColor = PAL.bg2) {
  canvas.hline(x0, x1, y, PAL.line);
  canvas.rect(x0 + 2, y + 1, Math.max(1, x1 - x0 - 3), 4, scaleColor);
  const center = Math.round((x0 + x1) / 2);
  const monitorW = Math.max(8, Math.round((x1 - x0) * 0.34));
  const monitorH = Math.max(5, Math.round(monitorW * 0.5));
  canvas.rect(center - Math.floor(monitorW / 2), y - monitorH, monitorW, monitorH, PAL.bg0);
  canvas.rect(center - Math.floor(monitorW / 2) + 1, y - monitorH + 1, monitorW - 2, monitorH - 2, PAL.bg1);
  canvas.vline(center, y - 1, y + 2, PAL.line);
  canvas.hline(x0 + 4, x0 + 8, y + 1, PAL.fg2);
}

function drawOpenPlanProps(canvas) {
  // The meeting-room glass is the one cheerful surface: three kanban colors.
  for (const [x, y, color] of [
    [114, 59, PAL.amber], [120, 59, PAL.amber], [126, 65, PAL.amber], [116, 72, PAL.amber],
    [145, 59, PAL.blue], [151, 66, PAL.blue], [157, 59, PAL.blue], [163, 71, PAL.blue],
    [190, 59, PAL.green], [196, 65, PAL.green], [202, 59, PAL.green], [190, 72, PAL.green],
  ]) outlinedRect(canvas, x, y, 4, 4, color, PAL.line);

  // A slogan reduced to one illegible, overconfident word block.
  outlinedRect(canvas, 220, 56, 27, 17, PAL.fg1);
  canvas.rect(224, 60, 19, 6, PAL.red);
  canvas.hline(225, 241, 68, PAL.bg3);

  // The half-deflated balloon never made it back to the party cupboard.
  canvas.disc(94, 60, 6, PAL.bg0);
  canvas.ellipse(94, 59, 4, 5, PAL.amber);
  canvas.tri(92, 65, 96, 65, 94, 68, PAL.bg0);
  canvas.line(94, 68, 98, 84, PAL.fg2);
  canvas.line(98, 84, 95, 91, PAL.fg2);
  canvas.put(92, 57, PAL.white);

  // A tiny foosball table in the back is mostly rods and bright player pixels.
  outlinedRect(canvas, 84, 82, 19, 12, PAL.bg3);
  canvas.hline(87, 100, 85, PAL.fg2);
  canvas.hline(87, 100, 89, PAL.fg2);
  for (const [x, y, color] of [[89, 85, PAL.red], [96, 85, PAL.blue], [92, 89, PAL.blue], [99, 89, PAL.red]]) {
    canvas.put(x, y, color);
    canvas.put(x, y + 1, color);
  }
  canvas.line(87, 93, 85, 98, PAL.bg0);
  canvas.line(100, 93, 102, 98, PAL.bg0);

  // Conference lanyards dangle from the right-hand monitor.
  canvas.line(268, 84, 271, 95, PAL.bg0);
  canvas.line(273, 84, 271, 95, PAL.bg0);
  canvas.line(269, 84, 271, 94, PAL.amber);
  canvas.line(272, 84, 271, 94, PAL.purple);
  outlinedRect(canvas, 269, 95, 5, 6, PAL.blue);

  // Hoodie sleeves sag around a chair back, with a tiny brand block at center.
  canvas.disc(93, 118, 6, PAL.bg0);
  canvas.disc(93, 118, 4, PAL.purple);
  canvas.tri(84, 132, 89, 119, 94, 125, PAL.bg0);
  canvas.tri(102, 132, 97, 119, 92, 125, PAL.bg0);
  quad(canvas, 88, 98, 120, 85, 101, 136, PAL.bg0);
  quad(canvas, 90, 96, 121, 88, 98, 134, PAL.blue);
  canvas.rect(90, 124, 6, 4, PAL.fg0);
  canvas.hline(89, 97, 133, PAL.purple);

  // The printer's red light is the brightest thing on its empty desk.
  outlinedRect(canvas, 286, 98, 16, 12, PAL.fg2);
  canvas.rect(289, 100, 10, 3, PAL.bg1);
  canvas.put(299, 101, PAL.red);
  outlinedRect(canvas, 289, 108, 13, 5, PAL.fg0);
  canvas.hline(291, 299, 110, PAL.fg1);

  // Required safety gear and the unconvincing plastic plant flank the room.
  canvas.rect(309, 88, 7, 3, PAL.bg0);
  canvas.disc(312, 94, 5, PAL.bg0);
  canvas.rect(309, 92, 7, 11, PAL.red);
  canvas.hline(310, 314, 96, PAL.fg1);
  canvas.line(315, 89, 318, 93, PAL.bg0);
  canvas.line(6, 128, 2, 117, PAL.bg0);
  canvas.line(6, 128, 10, 117, PAL.bg0);
  canvas.line(6, 126, 6, 113, PAL.bg0);
  canvas.line(6, 126, 3, 118, PAL.green);
  canvas.line(7, 126, 9, 118, PAL.green);
  outlinedRect(canvas, 2, 128, 9, 9, PAL.purple);

  // One mug remains after everyone else has gone home.
  outlinedRect(canvas, 218, 128, 7, 9, PAL.fg1);
  canvas.ring(225, 132, 3, PAL.bg0);
  canvas.put(220, 130, PAL.bg0);
}

function drawOpenPlan() {
  const canvas = new Canvas(WIDTH, HEIGHT, PAL.bg1);

  // Ceiling grid and evenly flat fluorescent panels.
  canvas.rect(0, 0, WIDTH, 55, PAL.bg2);
  canvas.hline(0, 319, 54, PAL.line);
  canvas.line(0, 17, 126, 54, PAL.line);
  canvas.line(320, 17, 194, 54, PAL.line);
  canvas.line(0, 42, 105, 54, PAL.line);
  canvas.line(320, 42, 215, 54, PAL.line);
  canvas.hline(0, 71, 17, PAL.line);
  canvas.hline(249, 319, 17, PAL.line);
  canvas.hline(0, 103, 41, PAL.line);
  canvas.hline(217, 319, 41, PAL.line);
  quad(canvas, 23, 80, 8, 42, 91, 19, PAL.fg1);
  quad(canvas, 240, 297, 8, 229, 278, 19, PAL.fg1);
  quad(canvas, 110, 131, 45, 114, 133, 50, PAL.fg2);
  quad(canvas, 189, 210, 45, 187, 206, 50, PAL.fg2);
  detailHline(canvas, 31, 76, 9, PAL.fg0);
  detailHline(canvas, 245, 290, 9, PAL.fg0);

  // Back wall and glass meeting room.
  ditherGradientV(canvas, 0, 55, WIDTH, 41, PAL.bg2, PAL.bg1, 8);
  ditheredLightQuad(canvas, 36, 68, 55, 25, 82, 91, PAL.fg1, PAL.fg2, PAL.bg3);
  ditheredLightQuad(canvas, 252, 284, 55, 238, 295, 91, PAL.fg1, PAL.fg2, PAL.bg3);
  canvas.rect(107, 52, 106, 34, PAL.line);
  canvas.rect(110, 55, 100, 28, PAL.bg0);
  ditherFill(canvas, 111, 56, 98, 26, PAL.bg0, PAL.blue, 0.045, 8);
  canvas.vline(134, 55, 82, PAL.line);
  canvas.vline(186, 55, 82, PAL.line);
  canvas.rect(137, 59, 47, 19, PAL.fg1);
  canvas.hline(141, 178, 64, PAL.fg2);
  canvas.line(142, 74, 151, 71, PAL.line);
  canvas.line(151, 71, 160, 72, PAL.line);
  canvas.line(160, 72, 176, 65, PAL.line);
  canvas.put(177, 64, PAL.white);
  canvas.rect(198, 66, 4, 12, PAL.bg2);
  canvas.put(199, 67, PAL.green);

  // Carpet band. Its central runway stays untextured for the laptop and score.
  canvas.rect(0, 96, WIDTH, 41, PAL.bg2);
  for (const y of [108, 121, 133]) {
    detailHline(canvas, 0, 319, y, PAL.line);
  }
  canvas.line(0, 96, 73, 136, PAL.line);
  canvas.line(319, 96, 247, 136, PAL.line);
  canvas.line(60, 96, 91, 136, PAL.line);
  canvas.line(260, 96, 229, 136, PAL.line);

  // Repeated desks become flatter and darker toward the back.
  drawOfficeDesk(canvas, 18, 82, 94, PAL.bg1);
  drawOfficeDesk(canvas, 238, 302, 94, PAL.bg1);
  drawOfficeDesk(canvas, 5, 92, 111, PAL.bg2);
  drawOfficeDesk(canvas, 228, 315, 111, PAL.bg2);
  drawOfficeDesk(canvas, 0, 99, 132, PAL.bg3);
  drawOfficeDesk(canvas, 221, 319, 132, PAL.bg3);
  for (const [x, y] of [[33, 86], [64, 86], [255, 86], [286, 86], [26, 102], [294, 102]]) {
    detailPixel(canvas, x, y, PAL.green2);
  }

  canvas.rect(0, 155, WIDTH, 25, PAL.bg1);
  drawDesk(canvas, PAL.bg3, PAL.bg2);
  canvas.hline(31, 96, 139, PAL.fg2);
  canvas.hline(224, 289, 139, PAL.fg2);

  // Foreground carpet tiles resume below the desk apron at low contrast.
  canvas.line(73, 163, 58, 179, PAL.bg2);
  canvas.line(247, 163, 262, 179, PAL.bg2);
  canvas.vline(160, 163, 179, PAL.bg2);
  canvas.hline(0, 319, 171, PAL.bg2);
  for (const [x, y] of [[19, 166], [102, 176], [207, 166], [299, 176]]) {
    canvas.hline(x, x + 5, y, PAL.bg0);
  }

  addProps(canvas, 'openplan', drawOpenPlanProps);

  return canvas;
}

function aisleEdge(y) {
  const t = Math.max(0, Math.min(1, (y - 45) / 93));
  return Math.round(132 - t * 58);
}

function drawRackWall(canvas, side) {
  const left = side === 'left';
  if (left) quad(canvas, 0, 132, 43, 0, 74, 138, PAL.bg0);
  else quad(canvas, 188, 319, 43, 246, 319, 138, PAL.bg0);

  const posts = left ? [20, 49, 78, 106] : [300, 271, 242, 214];
  for (let i = 0; i < posts.length; i += 1) {
    const xTop = posts[i];
    const xBottom = left ? Math.max(4, xTop - i * 8) : Math.min(315, xTop + i * 8);
    canvas.line(xTop, 44, xBottom, 137, i % 2 === 0 ? PAL.line : PAL.bg2);
  }

  for (const y of [52, 65, 80, 98, 119, 137]) {
    const edge = aisleEdge(y);
    if (left) canvas.line(0, y + 2, edge, y, PAL.line);
    else canvas.line(319, y + 2, 319 - edge, y, PAL.line);
  }

  // Bay faces and fan silhouettes stay on the outer thirds.
  const bays = left
    ? [[5, 58, 39, 16], [47, 69, 35, 20], [7, 91, 50, 23], [59, 105, 35, 25]]
    : [[276, 58, 39, 16], [238, 69, 35, 20], [263, 91, 50, 23], [226, 105, 35, 25]];
  for (const [x, y, w, h] of bays) {
    canvas.rect(x, y, w, h, PAL.bg1);
    canvas.frame(x, y, w, h, PAL.line);
    if (w >= 38 && !isCalm(x + Math.floor(w / 2), y + Math.floor(h / 2))) {
      canvas.ring(x + Math.floor(w / 2), y + Math.floor(h / 2), Math.min(6, Math.floor(h / 3)), PAL.bg3);
      canvas.disc(x + Math.floor(w / 2), y + Math.floor(h / 2), 1, PAL.line);
    }
  }

  const xStart = left ? 8 : 232;
  const xEnd = left ? 112 : 312;
  for (let y = 49; y <= 132; y += 5) {
    for (let x = xStart + ((y / 5) % 3) * 4; x <= xEnd; x += 13) {
      const edge = aisleEdge(y);
      const onRack = left ? x < edge - 4 : x > 319 - edge + 4;
      if (!onRack || isCalm(x, y)) continue;
      const selector = (x + y * 3) % 11;
      canvas.put(x, y, selector < 7 ? PAL.green : PAL.amber);
      if (selector === 0) canvas.put(x + (left ? 1 : -1), y, PAL.red);
    }
  }
}

function drawDataCenterProps(canvas) {
  // The open lower rack shows a few bright guts and its displaced door.
  outlinedRect(canvas, 8, 92, 32, 22, PAL.bg1);
  for (const y of [96, 101, 106, 111]) {
    canvas.hline(11, 36, y, PAL.line);
    canvas.put(14 + (y % 3) * 5, y, PAL.green);
    canvas.put(31 - (y % 4) * 3, y, y === 101 ? PAL.red : PAL.blue);
  }
  quad(canvas, 1, 7, 94, 3, 7, 113, PAL.bg0);
  canvas.vline(5, 96, 111, PAL.bg3);
  canvas.put(5, 103, PAL.fg2);

  // A hard hat and clipboard are the only signs of an actual technician.
  canvas.disc(102, 65, 7, PAL.bg0);
  canvas.ellipse(102, 65, 6, 4, PAL.amber);
  canvas.rect(95, 65, 15, 4, PAL.bg0);
  canvas.hline(97, 108, 66, PAL.amber);
  canvas.vline(102, 60, 64, PAL.fg1);
  canvas.put(85, 45, PAL.fg2);
  outlinedRect(canvas, 84, 47, 12, 14, PAL.fg1);
  canvas.rect(87, 50, 6, 2, PAL.blue);
  canvas.hline(87, 92, 55, PAL.bg3);
  canvas.hline(87, 90, 58, PAL.bg3);

  // A thermos has been forgotten on the nearest rack top.
  canvas.rect(309, 83, 5, 3, PAL.bg0);
  outlinedRect(canvas, 307, 85, 9, 12, PAL.fg2);
  canvas.hline(309, 313, 89, PAL.blue);
  canvas.put(309, 94, PAL.fg0);

  // High-contrast warning tape marks one bay without spilling into its anchor.
  canvas.rect(268, 96, 52, 10, PAL.bg0);
  for (let x = 269; x <= 317; x += 8) {
    canvas.line(x, 104, Math.min(319, x + 7), 97, PAL.red);
    canvas.line(x + 1, 104, Math.min(319, x + 8), 97, PAL.fg0);
  }

  // Cable spools are color-coded, because someone once had a system.
  for (const [x, color] of [[54, PAL.blue], [69, PAL.red]]) {
    canvas.disc(x, 170, 7, PAL.bg0);
    canvas.ring(x, 170, 5, color);
    canvas.disc(x, 170, 2, PAL.bg0);
    canvas.hline(x - 6, x + 6, 176, PAL.line);
  }
  canvas.line(74, 173, 83, 177, PAL.red);

  // Rolling toolbox, drawer open; saturated red earns its place on the floor.
  outlinedRect(canvas, 242, 161, 20, 14, PAL.red);
  canvas.hline(245, 258, 166, PAL.bg0);
  canvas.rect(247, 166, 14, 5, PAL.bg0);
  canvas.rect(248, 167, 12, 3, PAL.fg2);
  canvas.put(251, 168, PAL.white);
  canvas.put(246, 176, PAL.bg0);
  canvas.put(258, 176, PAL.bg0);

  // A KVM cart and tiny CRT look wildly domestic in the cold aisle.
  outlinedRect(canvas, 181, 157, 22, 15, PAL.line);
  outlinedRect(canvas, 184, 159, 16, 10, PAL.bg1);
  canvas.rect(187, 161, 10, 5, PAL.blue);
  canvas.put(188, 162, PAL.white);
  canvas.vline(186, 171, 176, PAL.bg0);
  canvas.vline(198, 171, 176, PAL.bg0);
  canvas.hline(183, 201, 176, PAL.bg0);
  canvas.put(184, 178, PAL.fg2);
  canvas.put(200, 178, PAL.fg2);

  // One mismatched office chair has migrated into the machine room.
  canvas.rect(88, 158, 12, 10, PAL.bg0);
  canvas.rect(90, 159, 8, 8, PAL.purple);
  canvas.vline(94, 168, 175, PAL.fg2);
  canvas.line(94, 173, 86, 178, PAL.bg0);
  canvas.line(94, 173, 102, 178, PAL.bg0);
  canvas.hline(84, 89, 178, PAL.fg2);
  canvas.hline(100, 103, 178, PAL.fg2);

  // The suppression bottle crowds the extreme corner, just beyond the anchor.
  canvas.disc(313, 114, 5, PAL.bg0);
  canvas.rect(308, 114, 11, 22, PAL.bg0);
  canvas.rect(310, 115, 8, 20, PAL.red);
  canvas.hline(311, 317, 120, PAL.fg1);
  canvas.line(313, 109, 319, 106, PAL.bg0);
  canvas.put(318, 106, PAL.fg2);
}

function drawDataCenter() {
  const canvas = new Canvas(WIDTH, HEIGHT, PAL.bg0);

  // Back wall and cold aisle.
  ditherGradientV(canvas, 0, 0, WIDTH, 74, PAL.bg0, PAL.bg1, 8);
  ditherGradientV(canvas, 0, 74, WIDTH, 63, PAL.bg2, PAL.bg1, 8);
  canvas.rect(137, 42, 46, 43, PAL.bg0);
  canvas.frame(137, 42, 46, 43, PAL.line);
  canvas.rect(143, 48, 34, 31, PAL.bg1);
  canvas.vline(160, 49, 78, PAL.bg2);
  canvas.hline(148, 172, 51, PAL.fg2);

  // Overhead trays converge on the far doorway, leaving the central anchor
  // mostly as a dark ceiling void.
  quad(canvas, 5, 115, 2, 42, 131, 43, PAL.bg1);
  quad(canvas, 205, 315, 2, 189, 278, 43, PAL.bg1);
  canvas.line(6, 2, 42, 43, PAL.line);
  canvas.line(114, 2, 131, 43, PAL.line);
  canvas.line(206, 2, 189, 43, PAL.line);
  canvas.line(314, 2, 278, 43, PAL.line);
  for (let y = 7; y <= 40; y += 7) {
    canvas.line(9 + y, y, 111 + Math.floor(y / 3), y, PAL.bg3);
    canvas.line(211 - Math.floor(y / 3), y, 311 - y, y, PAL.bg3);
  }
  canvas.line(28, 5, 122, 42, PAL.blue);
  canvas.line(292, 5, 198, 42, PAL.purple);

  drawRackWall(canvas, 'left');
  drawRackWall(canvas, 'right');

  // Raised-floor seams expand toward the viewer; central seams wait until the
  // gameplay-safe rectangle has ended.
  canvas.rect(0, 137, WIDTH, 43, PAL.bg1);
  canvas.line(132, 84, 89, 153, PAL.line);
  canvas.line(89, 153, 73, 179, PAL.bg2);
  canvas.line(188, 84, 231, 153, PAL.line);
  canvas.line(231, 153, 247, 179, PAL.bg2);
  detailHline(canvas, 75, 245, 104, PAL.line);
  detailHline(canvas, 54, 266, 123, PAL.line);
  canvas.hline(34, 286, 157, PAL.bg2);
  canvas.hline(12, 308, 174, PAL.bg2);
  canvas.line(104, 153, 86, 179, PAL.bg2);
  canvas.line(216, 153, 234, 179, PAL.bg2);

  drawDesk(canvas, PAL.bg3, PAL.bg1);
  canvas.hline(9, 89, 139, PAL.blue);
  canvas.hline(231, 310, 139, PAL.blue);
  for (const x of [18, 31, 47, 63, 257, 273, 289, 302]) {
    detailPixel(canvas, x, 146, x % 3 === 0 ? PAL.amber : PAL.green);
  }
  canvas.vline(80, 163, 179, PAL.bg2);
  canvas.vline(160, 163, 179, PAL.bg2);
  canvas.vline(240, 163, 179, PAL.bg2);
  canvas.rect(149, 168, 22, 7, PAL.bg0);
  canvas.frame(149, 168, 22, 7, PAL.bg2);
  canvas.hline(154, 166, 171, PAL.bg2);
  canvas.line(154, 166, 152, 169, PAL.bg2);

  addProps(canvas, 'datacenter', drawDataCenterProps);

  return canvas;
}

function drawEarthLimb(canvas) {
  for (let x = 42; x <= 278; x += 1) {
    const nx = (x - 160) / 122;
    if (Math.abs(nx) > 1) continue;
    const top = Math.round(58 + 21 * nx * nx);
    if (top > 83) continue;
    canvas.put(x, top, PAL.fg0);
    canvas.put(x, top + 1, bayer(x, top + 1, 8) < 0.58 ? PAL.fg0 : PAL.blue);
    if ((x === 82 || x === 159 || x === 237) && top + 1 < 83) canvas.put(x, top + 1, PAL.white);
    for (let y = top + 2; y <= 83; y += 1) {
      const depth = (y - top) / Math.max(1, 83 - top);
      canvas.put(x, y, bayer(x, y, 8) < 0.35 + depth * 0.34 ? PAL.blue : PAL.bg1);
    }
  }

  // Cloud strokes follow the curvature rather than forming straight bands.
  for (const [x0, x1, lift] of [[58, 104, 5], [118, 153, 10], [171, 215, 7], [226, 263, 4]]) {
    for (let x = x0; x <= x1; x += 1) {
      const nx = (x - 160) / 122;
      const y = Math.round(72 + 12 * nx * nx + Math.sin(x / 6) * 2 - lift / 4);
      if (y < 82 && bayer(x, y, 8) < 0.48) canvas.put(x, y, PAL.fg0);
    }
  }
}

function drawOrbitalRack(canvas, x, side) {
  const width = 67;
  canvas.rect(x, 48, width, 89, PAL.bg0);
  canvas.frame(x, 48, width, 89, PAL.line);
  canvas.rect(x + 5, 53, width - 10, 79, PAL.bg1);
  for (const y of [57, 72, 88, 105, 123]) {
    canvas.hline(x + 5, x + width - 6, y, PAL.line);
  }
  const innerX = side === 'left' ? x + width - 10 : x + 8;
  canvas.vline(innerX, 50, 134, PAL.purple);
  for (let y = 60; y <= 128; y += 8) {
    for (let dx = 11; dx < width - 10; dx += 12) {
      const px = x + dx + ((y / 8) % 2) * 2;
      detailPixel(canvas, px, y, (px + y) % 5 === 0 ? PAL.blue : PAL.purple);
      if ((px + y) % 13 === 0) detailPixel(canvas, px + 2, y, PAL.green);
    }
  }
  for (const [bx, by] of [[x + 3, 51], [x + width - 4, 51], [x + 3, 133], [x + width - 4, 133]]) {
    canvas.disc(bx, by, 1, PAL.fg2);
    canvas.put(bx, by, PAL.fg0);
  }
}

function drawOrbitalProps(canvas) {
  // A mission patch and scratched day count personalize the otherwise sterile hull.
  canvas.disc(91, 51, 7, PAL.bg0);
  canvas.disc(91, 51, 5, PAL.purple);
  canvas.tri(87, 53, 91, 47, 95, 53, PAL.blue);
  canvas.put(91, 49, PAL.white);
  for (const x of [219, 222, 225]) canvas.vline(x, 62, 69, PAL.fg2);
  for (const x of [219, 222]) canvas.vline(x, 72, 77, PAL.fg2);
  canvas.line(218, 68, 226, 63, PAL.fg1);
  canvas.line(218, 76, 224, 72, PAL.fg1);

  // A pouch and straw drift free near the window.
  outlinedRect(canvas, 91, 60, 10, 10, PAL.blue);
  canvas.tri(93, 62, 99, 62, 96, 67, PAL.fg1);
  canvas.line(99, 60, 103, 54, PAL.bg0);
  canvas.line(100, 60, 104, 54, PAL.fg0);
  canvas.put(94, 68, PAL.white);

  // The wrench gets a dark pixel halo so its silhouette survives at 1x.
  canvas.line(216, 46, 220, 49, PAL.bg0);
  canvas.line(217, 52, 220, 49, PAL.bg0);
  canvas.line(219, 50, 229, 43, PAL.bg0);
  canvas.disc(229, 43, 2, PAL.bg0);
  canvas.line(217, 47, 220, 49, PAL.fg0);
  canvas.line(218, 51, 220, 49, PAL.fg0);
  canvas.line(220, 49, 229, 43, PAL.fg1);
  canvas.put(229, 43, PAL.white);

  // The clipped helmet has collected more stickers than mission hardware should.
  canvas.disc(93, 98, 10, PAL.bg0);
  canvas.ellipse(93, 98, 8, 7, PAL.fg1);
  canvas.rect(86, 99, 15, 5, PAL.bg0);
  canvas.rect(88, 99, 11, 3, PAL.blue);
  canvas.put(89, 94, PAL.red);
  canvas.put(95, 92, PAL.amber);
  canvas.put(98, 96, PAL.green);
  canvas.line(101, 96, 103, 91, PAL.fg2);

  // Freeze-dried noodles are velcroed in a tidy, increasingly strange row.
  for (const [y, color] of [[88, PAL.red], [96, PAL.amber], [104, PAL.purple]]) {
    outlinedRect(canvas, 218, y, 8, 7, color);
    canvas.line(220, y + 2, 223, y + 4, PAL.fg0);
  }

  // A worn handrail exposes bright metal where countless hands rubbed the paint away.
  canvas.line(85, 120, 102, 120, PAL.bg0);
  canvas.line(87, 121, 100, 121, PAL.fg2);
  canvas.hline(91, 96, 121, PAL.fg0);
  canvas.rect(84, 118, 4, 8, PAL.bg0);
  canvas.rect(100, 118, 4, 8, PAL.bg0);
  canvas.put(86, 120, PAL.blue);
  canvas.put(101, 120, PAL.blue);

  // A tiny magenta grow lamp keeps one questionable plant alive.
  outlinedRect(canvas, 309, 87, 10, 5, PAL.purple);
  canvas.line(311, 92, 308, 104, PAL.bg0);
  canvas.line(317, 92, 320, 104, PAL.bg0);
  for (const [x, y] of [[309, 96], [313, 98], [317, 96], [311, 102], [318, 101]]) {
    canvas.put(x, y, PAL.purple);
  }
  canvas.line(314, 116, 310, 106, PAL.bg0);
  canvas.line(314, 116, 318, 105, PAL.bg0);
  canvas.line(314, 115, 311, 107, PAL.green2);
  canvas.line(315, 115, 318, 106, PAL.green);
  outlinedRect(canvas, 309, 116, 10, 8, PAL.fg2);
  canvas.hline(311, 317, 119, PAL.purple);

  // The oldest mug is physically bolted to the workstation.
  outlinedRect(canvas, 218, 128, 7, 9, PAL.fg1);
  canvas.ring(225, 132, 3, PAL.bg0);
  canvas.put(220, 130, PAL.bg0);
  canvas.put(219, 137, PAL.fg0);
  canvas.put(224, 137, PAL.fg0);
}

function drawOrbital() {
  const canvas = new Canvas(WIDTH, HEIGHT, PAL.bg0);

  // Ribbed hull frames a single vast, curved viewport.
  canvas.rect(0, 0, WIDTH, 16, PAL.bg2);
  canvas.ellipse(160, 49, 126, 55, PAL.line);
  canvas.ellipse(160, 49, 122, 51, PAL.bg0);
  canvas.rect(0, 84, WIDTH, 53, PAL.bg2);
  canvas.hline(38, 282, 83, PAL.line);
  canvas.hline(46, 274, 84, PAL.bg3);

  // Sparse stars: specular white is rare, most points use the cool grey ramp.
  const stars = [
    [52, 29, 'fg1'], [67, 48, 'fg2'], [82, 21, 'white'], [96, 45, 'fg1'],
    [119, 49, 'fg2'], [132, 26, 'fg1'], [190, 22, 'fg2'], [207, 47, 'white'],
    [225, 27, 'fg1'], [242, 50, 'fg2'], [258, 23, 'fg1'], [271, 43, 'white'],
    [58, 57, 'fg2'], [110, 57, 'fg1'], [220, 58, 'fg2'], [263, 61, 'fg1'],
  ];
  for (const [x, y, color] of stars) detailPixel(canvas, x, y, PAL[color]);
  canvas.put(82, 20, PAL.fg1);
  canvas.put(81, 21, PAL.fg1);
  canvas.put(207, 46, PAL.fg2);
  drawEarthLimb(canvas);

  // Hull ribs and bolted GPU stacks occupy the outer thirds.
  for (const x of [8, 24, 40, 280, 296, 312]) {
    canvas.vline(x, 17, 136, x % 32 === 8 ? PAL.line : PAL.bg3);
  }
  canvas.line(0, 18, 39, 84, PAL.line);
  canvas.line(319, 18, 281, 84, PAL.line);
  canvas.line(18, 16, 51, 83, PAL.bg3);
  canvas.line(302, 16, 269, 83, PAL.bg3);
  drawOrbitalRack(canvas, 0, 'left');
  drawOrbitalRack(canvas, 253, 'right');

  // Two restrained shafts frame, rather than wash over, the play area.
  ditheredLightQuad(canvas, 65, 77, 48, 72, 94, 128, PAL.blue, PAL.fg2, PAL.line);
  ditheredLightQuad(canvas, 243, 255, 48, 226, 248, 128, PAL.purple, PAL.fg2, PAL.line);
  ditheredLightRadial(canvas, 56, 111, 32, PAL.blue, PAL.fg2, PAL.line);
  ditheredLightRadial(canvas, 264, 111, 32, PAL.purple, PAL.fg2, PAL.line);

  canvas.rect(0, 155, WIDTH, 25, PAL.bg1);
  drawDesk(canvas, PAL.bg3, PAL.bg1);
  ditheredLightQuad(canvas, 34, 78, 138, 24, 90, 150, PAL.blue, PAL.fg2, PAL.line);
  ditheredLightQuad(canvas, 242, 286, 138, 230, 296, 150, PAL.purple, PAL.fg2, PAL.line);
  canvas.hline(8, 93, 138, PAL.blue);
  canvas.hline(227, 311, 138, PAL.purple);

  // Ribbed deck plates and two recessed lights finish the lower silhouette.
  canvas.hline(0, 319, 166, PAL.bg2);
  canvas.hline(0, 319, 176, PAL.bg0);
  for (const x of [18, 62, 106, 150, 194, 238, 282]) {
    canvas.line(x, 163, x - 6, 179, PAL.bg2);
  }
  for (const x of [48, 264]) {
    canvas.rect(x, 170, 9, 3, PAL.bg0);
    canvas.hline(x + 2, x + 6, 171, PAL.bg3);
  }

  addProps(canvas, 'orbital', drawOrbitalProps);

  return canvas;
}

/** Build the five opaque 320x180 room backdrops used by the scene atlas. */
export function buildScenes(rng) {
  if (typeof rng !== 'function') throw new TypeError('buildScenes requires a deterministic rng');

  return {
    scene_bedroom: drawBedroom(),
    scene_coworking: drawCoworking(),
    scene_openplan: drawOpenPlan(),
    scene_datacenter: drawDataCenter(),
    scene_orbital: drawOrbital(),
  };
}
