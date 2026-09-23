/**
 * THE HUMAN, seen from inside the screen.
 *
 * A huge hooded silhouette on the far side of the glass: hood up, face mostly
 * shadow, lit from below by the screen (that is, by us), eyes catching the
 * green. Deliberately never specific: no lips, no facial hair, no make-up, no
 * age lines, hair reduced to a few strands under the hood.
 *
 * Everything is authored in 320x180 scene space and cropped afterwards, so
 * each layer's atlas frame carries its own origin and the renderer only has to
 * stack them: body, then eyes, then either the mug hand or the typing arms.
 */
import {
  Canvas, bayer, cropFrames, ellipseHalf, flipH, mix, stamp,
} from './pixel.mjs';

const W = 320;
const H = 180;

export const HUMAN_COLORS = Object.freeze({
  hoodDeep: '#0d1015',
  hoodDark: '#14181f',
  hood: '#1a1f28',
  hoodMid: '#212834',
  hoodRim: '#2c3542',
  hoodRimHi: '#3a4453',
  hoodGreen: '#1c3325',
  hoodGreenHi: '#27482f',
  hair: '#0f0f12',
  hairHi: '#25232a',
  skinDeep: '#1a1616',
  skinShadow: '#231d1c',
  skin: '#2e2522',
  skinLit: '#3a2d28',
  skinGreen: '#2f4433',
  skinGreenHi: '#3b5a3f',
  lash: '#08090b',
  white: '#262b28',
  whiteLit: '#323a34',
  ridge: '#2b2320',
  iris: '#1d6a2e',
  irisHi: '#4ec94e',
  glint: '#c4f7bc',
  bag: '#1f1918',
  mouth: '#120e0e',
  string: '#363f4c',
  stringTip: '#55606e',
  flush: '#3a1f20',
  mug: '#2b313b',
  mugLit: '#4a5260',
  mugHi: '#6b7482',
  mugDark: '#1b1f26',
  coffee: '#1a120d',
  steam: '#4f5966',
  chair: '#1b1f27',
  chairLit: '#2d343f',
  chairHi: '#414a58',
});

const C = HUMAN_COLORS;

/** Where the face sits in scene space. The renderer reads these too. */
export const HUMAN_GEOMETRY = Object.freeze({
  hood: { cx: 160, cy: 60, rx: 90, ry: 96 },
  shoulders: { cx: 160, cy: 214, rx: 176, ry: 118 },
  face: { cx: 160, cy: 62, rx: 43, ry: 50 },
  eyes: { y: 54, left: 139, right: 181 },
});

const G = HUMAN_GEOMETRY;

function inEllipse(x, y, e) {
  const dx = (x - e.cx) / e.rx;
  const dy = (y - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
}

/** Normalised distance from an ellipse centre: 1 on the rim. */
function ellipseDist(x, y, e) {
  const dx = (x - e.cx) / e.rx;
  const dy = (y - e.cy) / e.ry;
  return Math.sqrt(dx * dx + dy * dy);
}

function inSilhouette(x, y) {
  return inEllipse(x, y, G.hood) || inEllipse(x, y, G.shoulders);
}

/** The face opening: wide at the cheekbones, narrowing into the collar. */
function faceHalf(y) {
  const f = G.face;
  const top = f.cy - f.ry;
  const bottom = f.cy + f.ry;
  if (y < top || y > bottom) return -1;
  if (y <= f.cy) return ellipseHalf(f.cy, f.rx, f.ry, y);
  const t = (y - f.cy) / f.ry;
  return f.rx * (1 - t * t * 0.55) * Math.sqrt(Math.max(0, 1 - t ** 4));
}

function inFace(x, y) {
  const half = faceHalf(y);
  return half >= 0 && Math.abs(x - G.face.cx) <= half;
}

/** Normalised position inside the opening: 0 at the centre line, 1 at the rim. */
function faceSide(x, y) {
  const half = faceHalf(y);
  return half <= 0 ? 1 : Math.abs(x - G.face.cx) / half;
}

/** The jaw line: the face ends here and the neck's shadow begins. */
function jawY(x) {
  const u = (x - G.face.cx) / 30;
  return Math.round(100 - u * u * 18);
}

/** Lower edge of the hair under the hood, per column: bangs, ragged. */
function hairBottom(x) {
  const dx = x - G.face.cx;
  const side = Math.abs(dx);
  const strand = [0, 4, 7, 3, 1, 6, 2, 8, 3, 0, 5, 2, 6, 1][Math.abs(Math.floor(dx + 70)) % 14];
  const base = 30 + Math.max(0, side - 22) * 0.7;
  return Math.round(base + strand);
}

/** Distance (in pixels, up to `reach`) from each pixel to the face opening. */
function faceDistanceField(reach) {
  const out = new Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (inFace(x, y)) { out[y * W + x] = 0; continue; }
      if (Math.abs(x - G.face.cx) > G.face.rx + reach + 1) continue;
      let best = Infinity;
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          if (inFace(x + dx, y + dy)) best = Math.min(best, Math.hypot(dx, dy));
        }
      }
      if (best <= reach) out[y * W + x] = best;
    }
  }
  return out;
}

function drawHood(cv) {
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!inSilhouette(x, y)) continue;
      const inHood = inEllipse(x, y, G.hood);
      const t = bayer(x, y, 8);
      // Lit from the upper left by the room; the right flank falls away.
      const lx = (x - 160) / 170;
      const ly = (y - 70) / 130;
      const form = lx * 0.6 + ly * 0.3;
      let color = C.hood;
      if (form > 0.22 + t * 0.22) color = C.hoodDark;
      else if (form < -0.3 - t * 0.2) color = C.hoodMid;
      if (inHood) {
        const d = ellipseDist(x, y, G.hood);
        if (d > 0.955 && x < 158) {
          const rim = (160 - x) / 90 + (40 - y) / 120;
          if (rim > 0.1 + t * 0.7) color = d > 0.985 ? C.hoodRimHi : C.hoodRim;
        }
      }
      cv.put(x, y, color);
    }
  }

  // Soft drape folds running from the hood down onto each shoulder.
  const folds = [
    { x0: 100, y0: 70, x1: 76, y1: 150, c: C.hoodDark },
    { x0: 108, y0: 96, x1: 96, y1: 170, c: C.hoodDark },
    { x0: 222, y0: 72, x1: 246, y1: 150, c: C.hoodDeep },
    { x0: 212, y0: 100, x1: 228, y1: 172, c: C.hoodDeep },
    { x0: 92, y0: 40, x1: 84, y1: 92, c: C.hoodMid },
  ];
  for (const f of folds) {
    const steps = Math.max(Math.abs(f.x1 - f.x0), Math.abs(f.y1 - f.y0));
    for (let s = 0; s <= steps; s += 1) {
      const k = s / steps;
      const x = Math.round(f.x0 + (f.x1 - f.x0) * k + Math.sin(k * 3.1) * 3);
      const y = Math.round(f.y0 + (f.y1 - f.y0) * k);
      const fade = Math.sin(k * Math.PI);
      if (inSilhouette(x, y) && bayer(x, y, 4) < fade * 0.9) cv.put(x, y, f.c);
      if (inSilhouette(x + 1, y) && bayer(x + 1, y, 4) < fade * 0.4) cv.put(x + 1, y, f.c);
    }
  }

  // The hood's padded rim around the face: a thick, slightly lighter roll.
  const dist = faceDistanceField(9);
  for (let y = 0; y < 132; y += 1) {
    for (let x = 96; x < 226; x += 1) {
      const gap = dist[y * W + x];
      if (gap === undefined || gap <= 0 || gap > 9 || !inSilhouette(x, y)) continue;
      const t = bayer(x, y, 4);
      if (gap <= 2) cv.put(x, y, C.hoodDark);
      else if (gap <= 6 && t < 0.6) cv.put(x, y, x < 160 ? C.hoodRim : C.hoodMid);
      else if (gap > 7 && t < 0.45) cv.put(x, y, C.hoodDark);
    }
  }

  // Where the hood drapes over the shoulders: a shadow crease on each side.
  for (let y = 96; y < 150; y += 1) {
    for (let x = 50; x < 270; x += 1) {
      if (!inSilhouette(x, y) || inEllipse(x, y, G.hood)) continue;
      const d = ellipseDist(x, y, G.hood);
      if (d < 1.06 && bayer(x, y, 4) < 0.75) cv.put(x, y, C.hoodDeep);
    }
  }
}

function drawChest(cv) {
  const collarY = G.face.cy + G.face.ry;
  // Zip line down the front, a few teeth catching the light.
  for (let y = collarY + 2; y < H; y += 1) {
    cv.put(160, y, C.hoodDeep);
    if (y % 3 === 0) cv.put(161, y, C.hoodRim);
  }
  // Screen light spilling onto the chest: sparse green dither.
  for (let y = collarY - 6; y < H; y += 1) {
    for (let x = 108; x < 212; x += 1) {
      if (!inSilhouette(x, y) || inFace(x, y)) continue;
      const d = Math.hypot((x - 160) / 52, (y - collarY) / 80);
      if (d < 1 && bayer(x, y, 8) < (1 - d) * 0.2) cv.put(x, y, C.hoodGreen);
    }
  }
  // Drawstrings, slightly uneven like every real pair.
  const strings = [
    { x0: 146, y0: collarY - 2, sway: -1, len: 30 },
    { x0: 174, y0: collarY - 2, sway: 1, len: 25 },
  ];
  for (const s of strings) {
    for (let i = 0; i < s.len; i += 1) {
      const x = s.x0 + Math.round(Math.sin(i / 10) * s.sway * 1.5);
      cv.put(x, s.y0 + i, C.string);
    }
    const tipX = s.x0 + Math.round(Math.sin(s.len / 10) * s.sway * 1.5);
    cv.rect(tipX, s.y0 + s.len, 1, 3, C.stringTip);
  }
}

function drawFace(cv) {
  const f = G.face;
  const top = f.cy - f.ry;
  const bottom = f.cy + f.ry;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = f.cx - f.rx; x <= f.cx + f.rx; x += 1) {
      if (!inFace(x, y)) continue;
      const t = bayer(x, y, 8);
      const v = (y - top) / (bottom - top);
      const side = faceSide(x, y);
      // Recessed under the hood: the top is lost in shadow, the screen lights
      // the lower face from below, the cheeks turn away from it.
      const light = v * 1.05 - side * side * 0.9 - 0.08;
      // Banded, with only a thin dithered seam between bands: a gradient you
      // can count, and no checkerboard that could read as stubble.
      const d = (t - 0.5) * 0.05;
      let color = C.hoodDeep;
      if (light > 0.16 + d) color = C.skinDeep;
      if (light > 0.32 + d) color = C.skinShadow;
      if (light > 0.5 + d) color = C.skin;
      if (light > 0.7 + d) color = C.skinLit;
      if (side > 0.86 || (side > 0.78 && t < 0.5)) color = C.hoodDeep;
      cv.put(x, y, color);
    }
  }

  // Below the jaw: the neck, down in the collar's shadow. A clean shape, so
  // the light on the chin never reads as a beard.
  for (let y = top; y <= bottom; y += 1) {
    for (let x = f.cx - f.rx; x <= f.cx + f.rx; x += 1) {
      if (!inFace(x, y) || y <= jawY(x)) continue;
      const neck = Math.abs(x - f.cx) <= 11 - Math.max(0, y - 104) * 0.3;
      cv.put(x, y, neck && y < bottom - 1 ? C.skinDeep : C.hoodDeep);
    }
  }
  // The jaw edge itself catches a thin line of screen light.
  for (let x = f.cx - 26; x <= f.cx + 26; x += 1) {
    const y = jawY(x);
    if (inFace(x, y) && bayer(x, y, 4) < 0.7 - Math.abs(x - f.cx) / 40) cv.put(x, y, C.skinGreen);
  }

  // Hair under the hood: bangs with a ragged lower edge, a few strands lit.
  for (let x = f.cx - f.rx; x <= f.cx + f.rx; x += 1) {
    const hb = hairBottom(x);
    for (let y = top; y <= hb; y += 1) {
      if (!inFace(x, y)) continue;
      cv.put(x, y, C.hair);
    }
  }
  // A few strands catching the light, falling from under the hood.
  const strands = [[128, 22, 1], [136, 18, -1], [146, 16, 1], [157, 15, -1], [166, 15, 1], [176, 17, -1], [186, 20, 1], [193, 24, -1]];
  for (const [sx, sy, dir] of strands) {
    const len = hairBottom(sx) - sy - 1;
    for (let i = 0; i < len; i += 1) {
      const x = sx + Math.round((i / len) * 3 * dir);
      const y = sy + i;
      if (inFace(x, y) && bayer(x, y, 4) < 0.7) cv.put(x, y, C.hairHi);
    }
  }

  // Eye sockets: shadow pools the eyes sit in.
  for (const cx of [G.eyes.left, G.eyes.right]) {
    for (let y = G.eyes.y - 6; y <= G.eyes.y + 6; y += 1) {
      for (let x = cx - 11; x <= cx + 11; x += 1) {
        const d = Math.hypot((x - cx) / 11, (y - G.eyes.y) / 6);
        if (d > 1 || y <= hairBottom(x)) continue;
        cv.put(x, y, d > 0.75 && bayer(x, y, 4) < 0.5 ? C.skinShadow : C.skinDeep);
      }
    }
  }

  // Nose: a lit bridge edge, a shadow side, the tip catching the screen.
  const nx = f.cx;
  for (let y = 62; y <= 74; y += 1) {
    cv.put(nx - 1, y, y > 68 ? C.skinLit : C.skin);
    if (y > 63) cv.put(nx + 1, y, C.skinDeep);
    if (y > 64) cv.put(nx + 2, y, C.skinShadow);
  }
  cv.hline(nx - 2, nx + 1, 75, C.skinLit);
  cv.put(nx - 1, 76, C.skinGreen);
  cv.put(nx, 76, C.skinGreen);
  cv.put(nx - 4, 77, C.skinDeep);
  cv.put(nx - 3, 77, C.skinShadow);
  cv.put(nx + 2, 77, C.skinShadow);
  cv.put(nx + 3, 77, C.skinDeep);
  cv.hline(nx - 3, nx + 2, 78, C.skinShadow);

  // Mouth: a flat line. Tired, not sad, not smiling.
  cv.hline(nx - 7, nx + 6, 87, C.mouth);
  cv.hline(nx - 5, nx + 4, 88, C.skinLit);
  cv.put(nx - 8, 88, C.skinShadow);
  cv.put(nx + 7, 88, C.skinShadow);

  // Screen light: rim highlights on the planes that face us, green-tinted.
  const glints = [
    [nx - 6, 89], [nx - 4, 89], [nx + 2, 89], [nx + 4, 89],
    [nx - 3, 94], [nx - 1, 95], [nx + 1, 95], [nx - 2, 96], [nx, 96], [nx + 2, 94],
    [nx - 18, 72], [nx - 17, 74], [nx + 17, 72], [nx + 16, 74],
  ];
  for (const [x, y] of glints) if (inFace(x, y)) cv.put(x, y, C.skinGreen);
  cv.put(nx - 1, 96, C.skinGreenHi);
  cv.put(nx, 97, C.skinGreen);
}

function drawHoodRim(cv) {
  // The very edge of the opening, lit green from below by the screen.
  const f = G.face;
  for (let y = f.cy - f.ry - 2; y <= f.cy + f.ry + 2; y += 1) {
    for (let x = f.cx - f.rx - 3; x <= f.cx + f.rx + 3; x += 1) {
      if (inFace(x, y)) continue;
      let near = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inFace(x + dx, y + dy)) near = true;
      if (!near) continue;
      const low = (y - (f.cy - f.ry)) / (f.ry * 2);
      const t = bayer(x, y, 4);
      if (low > 0.5 && t < low * 0.9) cv.put(x, y, low > 0.8 && t < 0.4 ? C.hoodGreenHi : C.hoodGreen);
    }
  }
}

/** The hood, the face and the chest: everything but the eyes and hands. */
export function drawHumanBody() {
  const cv = new Canvas(W, H);
  drawHood(cv);
  drawChest(cv);
  drawFace(cv);
  drawHoodRim(cv);
  return cv;
}

// ---------------------------------------------------------------------------
// Eyes. One template per mood for the left eye, mirrored for the right.
// ---------------------------------------------------------------------------

const EYE_COLORS = Object.freeze({
  B: C.hair,
  b: C.hairHi,
  l: C.lash,
  L: C.skinShadow,
  w: C.white,
  W: C.whiteLit,
  i: C.iris,
  I: C.irisHi,
  g: C.glint,
  s: C.skinDeep,
  m: C.bag,
  f: C.flush,
  k: C.hoodDeep,
  r: C.ridge,
});

// 19 wide x 12 tall; the eye centre is column 9, row 7. `r` is the brow
// ridge catching a little light, which is what makes a dark brow readable on
// a face this deep in shadow.
const EYES = Object.freeze({
  tired: {
    open: [
      '...rrrrrrrrrrrrr...',
      '..rBBBBBBBBBBBBBBr.',
      '...bBBBBBBBBBBBBb..',
      '...................',
      '...sssssssssssss...',
      '..sLLLLLLLLLLLLLs..',
      '.slllllllllllllllss',
      '.swwWWiiIIIiiwwwws.',
      '.swwWiiIgIgIiiwwws.',
      '..swwwiiIgIiiwwws..',
      '...sssmmmmmmmsss...',
      '.....mmmmmmmmm.....',
    ],
    down: [
      '...rrrrrrrrrrrrr...',
      '..rBBBBBBBBBBBBBBr.',
      '...bBBBBBBBBBBBBb..',
      '...................',
      '...sssssssssssss...',
      '..sLLLLLLLLLLLLLs..',
      '.sLLLLLLLLLLLLLLLs.',
      '.slllllllllllllllss',
      '.swwWiiIgIgIiiwwws.',
      '..swwwiiIIIiiwwws..',
      '...sssmmmmmmmsss...',
      '.....mmmmmmmmm.....',
    ],
  },
  impatient: {
    open: [
      '..rrrrrrrrrrrr.....',
      '.rBBBBBBBBBBBBrr...',
      '..bBBBBBBBBBBBBBr..',
      '.............BBBr..',
      '..sssssssssssssss..',
      '.slllllllllllllllss',
      '.swwwWiiIIIiiwwwws.',
      '.swwWiiIgIgIiiwwws.',
      '.swwwiiIIgIIiiwwws.',
      '..swwwwiiiiiwwwws..',
      '...ssmmmmmmmmmss...',
      '...................',
    ],
    down: [
      '..rrrrrrrrrrrr.....',
      '.rBBBBBBBBBBBBrr...',
      '..bBBBBBBBBBBBBBr..',
      '.............BBBr..',
      '..sssssssssssssss..',
      '.sLLLLLLLLLLLLLLLs.',
      '.slllllllllllllllss',
      '.swwWiiIgIgIiiwwws.',
      '.swwwiiIIgIIiiwwws.',
      '..swwwwiiiiiwwwws..',
      '...ssmmmmmmmmmss...',
      '...................',
    ],
  },
  furious: {
    open: [
      '.rrr...............',
      '.rBBBrr............',
      '..rBBBBBrr.........',
      '....bBBBBBBrr......',
      '..sss..bBBBBBBBr...',
      '.slllllllllllBBBBs.',
      '.swwwWiiIgIgIiwwss.',
      '.swwwiiIIgIIiiwwss.',
      '.fsllllllllllllllf.',
      '..fsssssssssssssf..',
      '...ffmmmmmmmmmff...',
      '...................',
    ],
    down: [
      '.rrr...............',
      '.rBBBrr............',
      '..rBBBBBrr.........',
      '....bBBBBBBrr......',
      '..sss..bBBBBBBBr...',
      '.sLLLLLLLLLLLBBBBs.',
      '.slllllllllllllllss',
      '.swwwiiIgIgIiiwwss.',
      '.fsllllllllllllllf.',
      '..fsssssssssssssf..',
      '...ffmmmmmmmmmff...',
      '...................',
    ],
  },
});

/** Suspicious is lopsided: one eye narrowed to a slit, the other brow up. */
const SUSPICIOUS = Object.freeze({
  left: {
    open: [
      '...................',
      '...................',
      '..rrrrrrrrrrrrrrr..',
      '.rBBBBBBBBBBBBBBBr.',
      '...sssssssBBBBBBs..',
      '.sLLLLLLLLLLLLLLLs.',
      '.slllllllllllllllss',
      '.swwwwWiiIgIgIiwws.',
      '.slllllllllllllllls',
      '...sssmmmmmmmsss...',
      '...................',
      '...................',
    ],
    down: [
      '...................',
      '...................',
      '..rrrrrrrrrrrrrrr..',
      '.rBBBBBBBBBBBBBBBr.',
      '...sssssssBBBBBBs..',
      '.sLLLLLLLLLLLLLLLs.',
      '.sLLLLLLLLLLLLLLLs.',
      '.slllllllllllllllss',
      '.swwwwWiiIgIgIilss.',
      '...sssmmmmmmmsss...',
      '...................',
      '...................',
    ],
  },
  right: {
    open: [
      '....rrrrrrrrrrr....',
      '..rrBBBBBBBBBBBrr..',
      '.rBB...........BBr.',
      '...................',
      '..sssssssssssssss..',
      '.sslllllllllllllls.',
      '.swwwwWiiIIIiiwwws.',
      '.swwwWiiIgIgIiwwws.',
      '.swwwwiiIIgIIiwwws.',
      '..swwwwwiiiiiwwws..',
      '...ssmmmmmmmmmss...',
      '...................',
    ],
    down: [
      '....rrrrrrrrrrr....',
      '..rrBBBBBBBBBBBrr..',
      '.rBB...........BBr.',
      '...................',
      '..sssssssssssssss..',
      '.sLLLLLLLLLLLLLLLs.',
      '.sslllllllllllllls.',
      '.swwwWiiIgIgIiwwws.',
      '.swwwwiiIIgIIiwwws.',
      '..swwwwwiiiiiwwws..',
      '...ssmmmmmmmmmss...',
      '...................',
    ],
  },
});

/** A closed eye keeps its mood's brow rows and shuts the lid. */
function blinkOf(rows) {
  const out = rows.slice();
  out[5] = '..sLLLLLLLLLLLLLs..';
  out[6] = '.sLLLLLLLLLLLLLLLs.';
  out[7] = '.sLLLLLLLLLLLLLLLs.';
  out[8] = '..slllllllllllll...';
  out[9] = '...sssssssssssss...';
  return out;
}

function mirrorRows(rows) {
  return rows.map((row) => row.padEnd(19, '.').split('').reverse().join(''));
}

function paintEyes(leftRows, rightRows) {
  const cv = new Canvas(W, H);
  const y = G.eyes.y - 7;
  stamp(cv, G.eyes.left - 9, y, leftRows, EYE_COLORS);
  stamp(cv, G.eyes.right - 9, y, rightRows, EYE_COLORS);
  return cv;
}

export const HUMAN_MOODS = Object.freeze(['tired', 'impatient', 'furious', 'suspicious']);

/** Three frames per mood: open, blink, looking down at the keyboard. */
export function drawHumanEyes(mood) {
  if (mood === 'suspicious') {
    const L = SUSPICIOUS.left;
    const R = SUSPICIOUS.right;
    return [
      paintEyes(L.open, R.open),
      paintEyes(blinkOf(L.open), blinkOf(R.open)),
      paintEyes(L.down, R.down),
    ];
  }
  const e = EYES[mood];
  if (!e) throw new Error(`unknown human mood ${mood}`);
  return [
    paintEyes(e.open, mirrorRows(e.open)),
    paintEyes(blinkOf(e.open), mirrorRows(blinkOf(e.open))),
    paintEyes(e.down, mirrorRows(e.down)),
  ];
}

// ---------------------------------------------------------------------------
// The mug hand, the typing arms and the empty chair.
// ---------------------------------------------------------------------------

const MUG = Object.freeze({ x: 236, y: 110, w: 30, h: 36 });

/**
 * A hoodie sleeve along a polyline. Outlined in the hood's deepest shadow so
 * it separates from the body behind it; `screenLit` adds the green light the
 * screen throws on forearms reaching toward it.
 */
function drawSleeve(cv, points, width, screenLit = false) {
  const sleeve = new Canvas(cv.w, cv.h);
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s += 1) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      for (let dx = -width; dx <= width; dx += 1) {
        for (let dy = -width; dy <= width; dy += 1) {
          if (dx * dx + dy * dy > width * width) continue;
          const px = Math.round(x + dx);
          const py = Math.round(y + dy);
          const t = bayer(px, py, 4);
          let color = C.hoodMid;
          if (dx < -width * 0.6) color = t < 0.6 ? C.hoodRim : C.hoodMid;
          else if (dx > width * 0.45) color = C.hoodDark;
          if (screenLit && dy > width * 0.55 && t < 0.55) color = C.hoodGreen;
          sleeve.put(px, py, color);
        }
      }
    }
  }
  sleeve.outline(C.hoodDeep, 255, false);
  cv.blit(sleeve, 0, 0);
}

function drawMugFrame(frame) {
  const cv = new Canvas(W, H);
  const m = MUG;
  const cx = m.x + m.w / 2;
  // The sleeve climbs in from the lower right to the wrist.
  drawSleeve(cv, [[312, 196], [292, 164], [276, 144]], 12);

  // Handle, on the far (left) side: a thick C.
  for (let y = m.y + 7; y <= m.y + 25; y += 1) {
    const k = (y - (m.y + 16)) / 9;
    const out = Math.round(7 * Math.sqrt(Math.max(0, 1 - k * k)));
    cv.put(m.x - out, y, C.mugLit);
    cv.put(m.x - out + 1, y, C.mug);
    if (out > 2) cv.put(m.x - out + 2, y, C.mugDark);
  }

  // Cylinder body: lit on the left, falling into shadow on the right.
  for (let y = m.y; y < m.y + m.h; y += 1) {
    const bottomCurve = y > m.y + m.h - 3;
    for (let x = m.x; x < m.x + m.w; x += 1) {
      const u = (x - m.x) / (m.w - 1);
      if (bottomCurve && (u < 0.08 || u > 0.92)) continue;
      const t = bayer(x, y, 4);
      let color = C.mug;
      if (u < 0.12) color = C.mugLit;
      else if (u < 0.26) color = t < 0.5 ? C.mugLit : C.mug;
      else if (u > 0.78) color = C.mugDark;
      else if (u > 0.62) color = t < 0.5 ? C.mugDark : C.mug;
      cv.put(x, y, color);
    }
  }
  cv.vline(m.x + 4, m.y + 4, m.y + m.h - 6, C.mugHi);
  cv.vline(m.x + 5, m.y + 6, m.y + m.h - 10, C.mugLit);
  cv.hline(m.x + 3, m.x + m.w - 4, m.y + m.h - 1, C.mugDark);

  // Elliptical rim with coffee inside.
  for (let dx = -15; dx <= 15; dx += 1) {
    const e = Math.round(3 * Math.sqrt(Math.max(0, 1 - (dx / 15) ** 2)));
    cv.put(cx + dx, m.y - e, C.mugHi);
    cv.put(cx + dx, m.y + e, C.mugLit);
    for (let dy = -e + 1; dy < e; dy += 1) cv.put(cx + dx, m.y + dy, Math.abs(dx) > 12 ? C.mugLit : C.coffee);
  }

  // The hand, from the right: four fingers wrapped across the front.
  for (let i = 0; i < 4; i += 1) {
    const fy = m.y + 9 + i * 6;
    const reach = 10 - Math.abs(i - 1.5) * 1.2;
    const fx0 = Math.round(m.x + m.w - reach);
    for (let y = fy; y < fy + 5; y += 1) {
      for (let x = fx0; x <= m.x + m.w + 4; x += 1) {
        const edgeTop = y === fy;
        const tip = x < fx0 + 2;
        let color = C.skinShadow;
        if (edgeTop) color = C.skin;
        if (tip) color = y === fy + 4 ? C.skinDeep : C.skin;
        if (y === fy + 4) color = C.skinDeep;
        cv.put(x, y, color);
      }
    }
    cv.put(fx0, fy + 1, C.skinGreen);
    cv.put(fx0, fy + 2, C.skinGreen);
  }
  // Back of the hand and the wrist, into the sleeve.
  for (let y = m.y + 6; y < m.y + 34; y += 1) {
    for (let x = m.x + m.w + 3; x <= m.x + m.w + 12; x += 1) {
      const k = (y - (m.y + 6)) / 28;
      if (x > m.x + m.w + 12 - Math.round(k * 4)) continue;
      cv.put(x, y, x === m.x + m.w + 3 ? C.skin : bayer(x, y, 4) < 0.35 ? C.skin : C.skinShadow);
    }
  }
  // Thumb hooked over the rim.
  cv.rect(m.x + m.w - 9, m.y + 2, 9, 3, C.skin);
  cv.hline(m.x + m.w - 9, m.x + m.w - 2, m.y + 2, C.skinLit);
  cv.put(m.x + m.w - 10, m.y + 3, C.skinGreen);

  // Steam: three wisps, drifting up by frame.
  const wisps = [cx - 8, cx - 1, cx + 6];
  wisps.forEach((wx, i) => {
    for (let s = 0; s < 18; s += 1) {
      const y = m.y - 5 - s - ((frame * 3 + i * 2) % 6);
      const x = wx + Math.round(Math.sin((s + frame * 2 + i * 3) / 2.8) * 2);
      if (s % 6 === 5) continue;
      if (bayer(x, y, 4) < 0.8 - s * 0.04) cv.put(x, y, C.steam);
    }
  });
  return cv;
}

export function drawHumanMug() {
  return [0, 1, 2].map(drawMugFrame);
}

function drawTypingFrame(frame) {
  const cv = new Canvas(W, H);
  const lift = frame === 0 ? [0, 3] : [3, 0];
  // Forearms reach down and forward, out of the bottom of the screen: the
  // keyboard is below us, so the hands are never in view.
  drawSleeve(cv, [[78, 128 + lift[0]], [104, 160 + lift[0]], [118, 196]], 13, true);
  drawSleeve(cv, [[242, 128 + lift[1]], [216, 160 + lift[1]], [202, 196]], 13, true);
  return cv;
}

export function drawHumanTyping() {
  return [0, 1].map(drawTypingFrame);
}

/** Lunch, or a meeting: an empty office chair where the human was. */
export function drawHumanChair() {
  const cv = new Canvas(W, H);
  const cx = 160;
  // Headrest.
  for (let y = 40; y < 58; y += 1) {
    const round = y < 44 ? 44 - y : y > 54 ? y - 54 : 0;
    const half = 17 - round;
    for (let x = cx - half; x <= cx + half; x += 1) {
      const t = bayer(x, y, 4);
      cv.put(x, y, y < 42 || (x < cx - half + 3 && t < 0.7) ? C.chairHi : C.chair);
    }
  }
  cv.rect(cx - 2, 58, 4, 8, C.chairLit);
  // Backrest: a tall rounded slab, lit green from the front by the screen.
  for (let y = 66; y < 150; y += 1) {
    const top = Math.max(0, 1 - (y - 66) / 14);
    const inset = Math.round(6 * top * top) + (y > 138 ? Math.round((y - 138) * 0.8) : 0);
    const half = 32 - inset;
    for (let x = cx - half; x <= cx + half; x += 1) {
      const u = (x - (cx - half)) / (half * 2);
      const t = bayer(x, y, 4);
      let color = C.chair;
      if (u < 0.14 && t < 0.7) color = C.chairLit;
      if (u < 0.05) color = C.chairHi;
      if (y < 69 && t < 0.7) color = C.chairHi;
      if (u > 0.2 && u < 0.8 && y > 100 && t < (y - 100) / 90) color = C.hoodGreen;
      cv.put(x, y, color);
    }
  }
  // Stitching seam and lumbar ridge.
  for (let y = 76; y < 140; y += 2) cv.put(cx, y, C.chairLit);
  cv.hline(cx - 24, cx + 24, 116, C.chairLit);
  // Armrests and the seat edge peeking out.
  cv.rect(cx - 46, 126, 11, 4, C.chairHi);
  cv.rect(cx - 43, 130, 4, 22, C.chairLit);
  cv.rect(cx + 35, 126, 11, 4, C.chairHi);
  cv.rect(cx + 39, 130, 4, 22, C.chairLit);
  cv.rect(cx - 38, 148, 76, 8, C.chair);
  cv.hline(cx - 38, cx + 37, 148, C.chairHi);
  const out = cv.clone();
  out.outline(C.hoodDeep, 255, false);
  out.blit(cv, 0, 0);
  return out;
}

/**
 * Every human layer, cropped, with its scene-space origin. `frames` share one
 * size per sprite.
 */
export function buildHuman() {
  const out = {};
  const put = (key, frames, fps) => {
    const cropped = cropFrames(frames);
    out[key] = { frames: cropped.frames, ox: cropped.x, oy: cropped.y, fps };
  };
  put('human_body', [drawHumanBody()]);
  for (const mood of HUMAN_MOODS) put(`human_eyes_${mood}`, drawHumanEyes(mood), 1);
  put('human_mug', drawHumanMug(), 3);
  put('human_typing', drawHumanTyping(), 7);
  put('human_chair', [drawHumanChair()]);
  return out;
}

export { flipH, mix };
