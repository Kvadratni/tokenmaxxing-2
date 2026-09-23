/**
 * THE AGENT, the player: a text cursor that grew legs.
 *
 * A tall glowing block about twice as tall as it is wide, terminal green with
 * a lighter dithered core, two square white eyes near the top, stick arms and
 * short stick legs, and a soft dithered halo. Every state shares one sprite box
 * and one baseline (the feet), so the renderer can swap states without the
 * character jumping.
 */
import { Canvas, PAL, bayer, glowHalo, mix } from './pixel.mjs';

/** Sprite box shared by every full-size agent frame. */
export const AGENT_BOX = Object.freeze({ w: 36, h: 50 });
/** Where the feet land inside the box, and the body's rest geometry. */
export const AGENT_FEET = Object.freeze({ x: 18, y: 45 });
const REST = Object.freeze({ w: 14, h: 28 });

export const AGENT_PALETTES = Object.freeze({
  normal: {
    outline: '#1b5424',
    shade: PAL.green2,
    fill: PAL.green,
    core: '#7ddf78',
    hi: '#b4f3ae',
    limb: PAL.green,
    limbDark: '#1b5424',
    glow: PAL.green2,
    eye: PAL.white,
  },
  panic: {
    outline: '#9e2a2a',
    shade: '#c07a26',
    fill: PAL.amber,
    core: '#f3cf78',
    hi: '#fff0bf',
    limb: '#f08a3c',
    limbDark: '#9e2a2a',
    glow: PAL.red,
    eye: PAL.white,
  },
  dazed: {
    outline: '#1d4a26',
    shade: '#2f7a3a',
    fill: '#46b048',
    core: '#6cc868',
    hi: '#9adf94',
    limb: '#46b048',
    limbDark: '#1d4a26',
    glow: '#2a6a33',
    eye: PAL.white,
  },
});

const DARK = '#10281a';

/** The block itself: rounded corners, shaded flank, lit edge, a lighter core. */
function drawBody(cv, x, y, w, h, pal, opts = {}) {
  const coreBottom = Math.round(h * 0.6);
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const cx = px - x;
      const cy = py - y;
      const corner = (cx === 0 || cx === w - 1) && (cy === 0 || cy === h - 1);
      if (corner) continue;
      if (opts.holes?.(px, py)) continue;
      const t = bayer(px, py, 4);
      const edge = cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1;
      let color = pal.fill;
      if (edge) color = pal.outline;
      else if (cy === 1 || cx === 1) color = pal.hi;
      else if (cx === w - 2) color = pal.shade;
      else if (cx === w - 3) color = t < 0.5 ? pal.shade : pal.fill;
      else if (cx >= 3 && cx <= w - 5 && cy >= 3) {
        // The cursor's glow: a lighter core that thins out down the body.
        if (cy < coreBottom) color = pal.core;
        else if (cy < coreBottom + 5 && t < 1 - (cy - coreBottom) / 5) color = pal.core;
      }
      if (!edge && cy > h - 6 && color === pal.fill && t < (cy - (h - 6)) / 7) color = pal.shade;
      cv.put(px, py, color);
    }
  }
}

function eyesSquare(cv, bx, by, w, pal, dy = 0, dx = 0) {
  const ey = by + 6 + dy;
  const l = bx + 3 + dx;
  const r = bx + w - 5 + dx;
  cv.rect(l, ey, 2, 2, pal.eye);
  cv.rect(r, ey, 2, 2, pal.eye);
}

function eyesBlink(cv, bx, by, w, pal) {
  const ey = by + 7;
  cv.hline(bx + 3, bx + 4, ey, pal.eye);
  cv.hline(bx + w - 5, bx + w - 4, ey, pal.eye);
}

/** Happy closed eyes: ^ ^. */
function eyesHappy(cv, bx, by, w, pal) {
  const ey = by + 6;
  for (const x0 of [bx + 2, bx + w - 6]) {
    cv.put(x0, ey + 1, pal.eye);
    cv.put(x0 + 1, ey, pal.eye);
    cv.put(x0 + 2, ey, pal.eye);
    cv.put(x0 + 3, ey + 1, pal.eye);
  }
}

/** Dizzy spirals where the eyes were. */
function eyesSpiral(cv, bx, by, w, pal, frame) {
  const ey = by + 5;
  const spiral = frame === 0
    ? ['###', '#.#', '#.#', '..#']
    : ['###', '#..', '#.#', '###'];
  for (const x0 of [bx + 2, bx + w - 5]) {
    spiral.forEach((row, r) => {
      for (let c = 0; c < 3; c += 1) if (row[c] === '#') cv.put(x0 + c, ey + r, pal.eye);
    });
  }
}

/** A stick limb from point to point, with a dark edge on the outer side. */
function limb(cv, pts, pal, outerSide = -1) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      if (cv.alphaAt(x + outerSide, y) === 0) cv.put(x + outerSide, y, pal.limbDark);
      cv.put(x, y, pal.limb);
    }
  }
}

function legs(cv, bx, by, w, h, pal, tap = 0) {
  const top = by + h;
  const lx = bx + 4;
  const rx = bx + w - 5;
  const len = AGENT_FEET.y - top;
  limb(cv, [[lx, top], [lx, top + len - 1]], pal, -1);
  cv.put(lx - 1, top + len - 1, pal.limb);
  limb(cv, [[rx, top], [rx, top + len - 1 - tap]], pal, 1);
  cv.put(rx + 1, top + len - 1 - tap, pal.limb);
}

/** Relaxed arms: out a little, then straight down. */
function armsRelaxed(cv, bx, by, w, pal, swing = 0) {
  const sy = by + 11;
  limb(cv, [[bx - 1, sy], [bx - 3, sy + 3], [bx - 3 - swing, sy + 10]], pal, -1);
  limb(cv, [[bx + w, sy], [bx + w + 2, sy + 3], [bx + w + 2 + swing, sy + 10]], pal, 1);
}

function placeBody(w, h, dy = 0) {
  const bx = AGENT_FEET.x - Math.floor(w / 2);
  const by = AGENT_FEET.y - 6 - h + dy;
  return { bx, by };
}

/**
 * One agent frame, built in layers so the halo comes from the body alone and
 * the stick limbs stay crisp on top of it: glow, then limbs, then the block,
 * then the face and props.
 */
function layers(pal, glow = 0.42) {
  const body = new Canvas(AGENT_BOX.w, AGENT_BOX.h);
  const limbs = new Canvas(AGENT_BOX.w, AGENT_BOX.h);
  const over = new Canvas(AGENT_BOX.w, AGENT_BOX.h);
  return {
    body,
    limbs,
    over,
    done() {
      const halo = body.clone();
      glowHalo(halo, mix(pal.glow, PAL.bg0, 0.15), 4, glow);
      const inner = body.clone();
      glowHalo(inner, pal.glow, 1, 0.5);
      const out = new Canvas(AGENT_BOX.w, AGENT_BOX.h);
      out.blit(halo, 0, 0);
      out.blit(inner, 0, 0);
      out.blit(limbs, 0, 0);
      out.blit(body, 0, 0);
      out.blit(over, 0, 0);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function idleFrame(blink) {
  const pal = AGENT_PALETTES.normal;
  const L = layers(pal);
  const { w, h } = REST;
  const { bx, by } = placeBody(w, h);
  armsRelaxed(L.limbs, bx, by, w, pal);
  legs(L.limbs, bx, by, w, h, pal);
  drawBody(L.body, bx, by, w, h, pal);
  if (blink) eyesBlink(L.over, bx, by, w, pal);
  else eyesSquare(L.over, bx, by, w, pal);
  return L.done();
}

/** Squash on the click, stretch on the rebound. */
function squashFrame(kind) {
  const pal = AGENT_PALETTES.normal;
  const L = layers(pal, kind === 'squash' ? 0.55 : 0.42);
  const w = kind === 'squash' ? 17 : 12;
  const h = kind === 'squash' ? 23 : 31;
  const { bx, by } = placeBody(w, h, kind === 'squash' ? 1 : 0);
  const sy = by + (kind === 'squash' ? 8 : 12);
  if (kind === 'squash') {
    limb(L.limbs, [[bx - 1, sy], [bx - 5, sy + 2], [bx - 6, sy + 6]], pal, -1);
    limb(L.limbs, [[bx + w, sy], [bx + w + 4, sy + 2], [bx + w + 5, sy + 6]], pal, 1);
  } else {
    limb(L.limbs, [[bx - 1, sy], [bx - 2, sy + 4], [bx - 2, sy + 11]], pal, -1);
    limb(L.limbs, [[bx + w, sy], [bx + w + 1, sy + 4], [bx + w + 1, sy + 11]], pal, 1);
  }
  legs(L.limbs, bx, by, w, h, pal);
  drawBody(L.body, bx, by, w, h, pal);
  eyesSquare(L.over, bx, by, w, pal, kind === 'squash' ? -1 : 0);
  return L.done();
}

/** Context over 90%: amber, red-edged, hands on head, mouth open, glitching. */
function panicFrame(frame) {
  const pal = AGENT_PALETTES.panic;
  const L = layers(pal, 0.55);
  const { w, h } = REST;
  const jitter = frame === 1 ? 1 : 0;
  const { bx: bx0, by } = placeBody(w, h);
  const bx = bx0 + jitter;
  // Hands clamped to the top of the head.
  limb(L.limbs, [[bx - 1, by + 11], [bx - 4, by + 7], [bx - 3, by + 2], [bx + 1, by]], pal, -1);
  limb(L.limbs, [[bx + w, by + 11], [bx + w + 3, by + 7], [bx + w + 2, by + 2], [bx + w - 2, by]], pal, 1);
  legs(L.limbs, bx, by, w, h, pal);
  drawBody(L.body, bx, by, w, h, pal);
  // Eyes wide, mouth an O.
  L.over.rect(bx + 3, by + 5, 2, 3, pal.eye);
  L.over.rect(bx + w - 5, by + 5, 2, 3, pal.eye);
  L.over.rect(bx + 5, by + 11, 4, 3, '#7a1f1f');
  L.over.rect(bx + 6, by + 12, 2, 1, '#3a0e0e');
  // A torn scanline across the body.
  const tear = by + (frame === 0 ? 17 : 22);
  for (let x = bx + 1; x < bx + w - 1; x += 1) L.over.put(x + (frame === 0 ? 2 : -2), tear, pal.hi);
  const out = L.done();
  // Glitch pixels shed off the block, different on each frame.
  const bits = frame === 0
    ? [[3, 8, 2], [30, 12, 2], [6, 30, 1], [31, 26, 1], [27, 5, 1], [2, 20, 1]]
    : [[5, 4, 1], [29, 8, 2], [2, 27, 2], [32, 22, 1], [8, 14, 1], [28, 34, 1]];
  bits.forEach(([x, y, sz], i) => out.rect(x, y, sz, sz, i % 2 ? PAL.amber : PAL.red));
  return out;
}

/** A claim is possible: thumbs up, sweat, the failing test hidden behind its back. */
function sweatFrame(frame) {
  const pal = AGENT_PALETTES.normal;
  const L = layers(pal);
  const { w, h } = REST;
  const { bx, by } = placeBody(w, h);
  // The sign with the red X, held behind on the right: it goes in the limb
  // layer so the body hides most of it.
  const sx = bx + w - 3;
  const sy = by + 14;
  L.limbs.rect(sx, sy, 9, 9, PAL.bg0);
  L.limbs.rect(sx + 1, sy + 1, 7, 7, PAL.bg3);
  for (let i = 0; i < 5; i += 1) {
    L.limbs.put(sx + 2 + i, sy + 2 + i, PAL.red);
    L.limbs.put(sx + 6 - i, sy + 2 + i, PAL.red);
  }
  // Thumbs up on the left: elbow out, fist up by the head.
  limb(L.limbs, [[bx - 1, by + 12], [bx - 4, by + 14], [bx - 6, by + 10], [bx - 6, by + 8]], pal, -1);
  L.limbs.rect(bx - 8, by + 5, 3, 3, pal.limb);
  L.limbs.put(bx - 7, by + 3, pal.limb);
  L.limbs.put(bx - 7, by + 4, pal.limb);
  L.limbs.put(bx - 9, by + 6, pal.limbDark);
  L.limbs.put(bx - 9, by + 7, pal.limbDark);
  legs(L.limbs, bx, by, w, h, pal);
  drawBody(L.body, bx, by, w, h, pal);
  eyesSquare(L.over, bx, by, w, pal);
  // A too-wide smile.
  L.over.hline(bx + 4, bx + w - 5, by + 12, DARK);
  L.over.put(bx + 3, by + 11, DARK);
  L.over.put(bx + w - 4, by + 11, DARK);
  // One bead of sweat, sliding down.
  const dy = frame === 0 ? 0 : 3;
  const dx = bx + w + 1;
  L.over.put(dx + 1, by + 1 + dy, PAL.blue);
  L.over.rect(dx, by + 2 + dy, 3, 2, PAL.blue);
  L.over.put(dx + 1, by + 4 + dy, PAL.blue);
  L.over.put(dx, by + 2 + dy, PAL.white);
  return L.done();
}

/** Just compacted: pixels missing, spiral eyes, arms out to hold the summary. */
function dazedFrame(frame) {
  const pal = AGENT_PALETTES.dazed;
  const L = layers(pal, 0.3);
  const { w, h } = REST;
  const { bx, by } = placeBody(w, h);
  const holes = (x, y) => {
    const cx = x - bx;
    const cy = y - by;
    // A chunk bitten from the upper right, and scattered dropouts.
    if (cx > w - 6 && cy < 7 && cx - (w - 6) + (6 - cy) > 3) return true;
    const k = (cx * 7 + cy * 13 + frame * 5) % 19;
    return cy > 3 && cx > 1 && cx < w - 2 && k === 0;
  };
  limb(L.limbs, [[bx - 1, by + 12], [bx - 3, by + 16], [bx + 2, by + 19]], pal, -1);
  limb(L.limbs, [[bx + w, by + 12], [bx + w + 2, by + 16], [bx + w - 3, by + 19]], pal, 1);
  legs(L.limbs, bx, by, w, h, pal);
  drawBody(L.body, bx, by, w, h, pal, { holes });
  eyesSpiral(L.over, bx, by, w, pal, frame);
  L.over.hline(bx + 5, bx + 8, by + 12, DARK);
  const out = L.done();
  // The lost pixels drifting away, greying out as they go.
  const bits = frame === 0
    ? [[bx + w + 1, by - 1, PAL.fg2], [bx + w + 4, by - 4, PAL.line], [bx + w, by + 3, pal.fill], [bx + w + 6, by + 1, PAL.bg3], [bx + w + 2, by - 7, PAL.line]]
    : [[bx + w + 2, by - 3, PAL.fg2], [bx + w + 5, by - 7, PAL.line], [bx + w + 2, by + 1, pal.fill], [bx + w + 7, by - 2, PAL.bg3], [bx + w + 3, by - 10, PAL.bg3]];
  for (const [x, y, c] of bits) out.rect(x, y, 2, 2, c);
  return out;
}

/** A permission prompt has a tool stalled: foot tapping, holding up a "?". */
function waitFrame(frame) {
  const pal = AGENT_PALETTES.normal;
  const L = layers(pal);
  const { w, h } = REST;
  const { bx, by } = placeBody(w, h);
  // Hand on hip.
  limb(L.limbs, [[bx - 1, by + 11], [bx - 4, by + 15], [bx - 1, by + 19]], pal, -1);
  // The other arm up, holding a little "allow?" card.
  limb(L.limbs, [[bx + w, by + 11], [bx + w + 3, by + 6], [bx + w + 3, by + 1]], pal, 1);
  const cx = bx + w + 1;
  const cy = by - 8;
  L.over.rect(cx, cy, 7, 9, PAL.bg0);
  L.over.rect(cx + 1, cy + 1, 5, 7, PAL.fg0);
  L.over.hline(cx + 2, cx + 4, cy + 2, PAL.bg0);
  L.over.put(cx + 4, cy + 3, PAL.bg0);
  L.over.put(cx + 3, cy + 4, PAL.bg0);
  L.over.put(cx + 3, cy + 6, PAL.bg0);
  legs(L.limbs, bx, by, w, h, pal, frame === 1 ? 2 : 0);
  drawBody(L.body, bx, by, w, h, pal);
  // Looking up and over at the human.
  eyesSquare(L.over, bx, by, w, pal, -1, 1);
  L.over.hline(bx + 5, bx + 8, by + 12, DARK);
  return L.done();
}

/** "You're absolutely right!": hands clasped, eyes shut with joy, sparkles. */
function grovelFrame(frame) {
  const pal = AGENT_PALETTES.normal;
  const L = layers(pal, 0.5);
  const { w, h } = REST;
  const { bx, by } = placeBody(w, h, frame);
  legs(L.limbs, bx, by, w, h, pal);
  drawBody(L.body, bx, by, w, h, pal);
  // Both arms fold in across the front and meet at the chest.
  limb(L.over, [[bx - 1, by + 11], [bx - 2, by + 15], [bx + 4, by + 17], [bx + 6, by + 15]], pal, -1);
  limb(L.over, [[bx + w, by + 11], [bx + w + 1, by + 15], [bx + w - 5, by + 17], [bx + w - 7, by + 15]], pal, 1);
  L.over.rect(bx + 5, by + 13, 4, 3, pal.limb);
  L.over.hline(bx + 5, bx + 8, by + 16, pal.limbDark);
  eyesHappy(L.over, bx, by, w, pal);
  const out = L.done();
  const sparkles = frame === 0 ? [[4, 8], [30, 14], [8, 2]] : [[2, 12], [31, 6], [28, 20]];
  for (const [x, y] of sparkles) {
    out.put(x, y, PAL.amber);
    out.put(x - 1, y, PAL.amber);
    out.put(x + 1, y, PAL.amber);
    out.put(x, y - 1, PAL.amber);
    out.put(x, y + 1, PAL.amber);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mini agents: subagents, the team, the free-subagent pickup.
// ---------------------------------------------------------------------------

export const MINI_BOX = Object.freeze({ w: 14, h: 20 });

function drawMini(cv, x, y, frame, pal = AGENT_PALETTES.normal) {
  const w = 6;
  const h = 11;
  const bob = frame === 1 ? 1 : 0;
  const by = y + bob;
  // Legs.
  cv.vline(x + 1, by + h, y + h + 3, pal.limb);
  cv.vline(x + w - 2, by + h, y + h + 3, pal.limb);
  // Arms.
  cv.vline(x - 1, by + 5, by + 8, pal.limb);
  cv.vline(x + w, by + 5, by + 8, pal.limb);
  for (let py = by; py < by + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const cx = px - x;
      const cy = py - by;
      if ((cx === 0 || cx === w - 1) && (cy === 0 || cy === h - 1)) continue;
      const edge = cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1;
      let color = edge ? pal.outline : cx === 1 ? pal.hi : cx === w - 2 ? pal.shade : pal.fill;
      if (!edge && cx > 1 && cx < w - 2 && cy > 1 && cy < 6) color = pal.core;
      cv.put(px, py, color);
    }
  }
  // Eyes: one pixel each. They are agents, so they have them.
  const blink = frame === 2;
  if (blink) {
    cv.put(x + 1, by + 4, pal.eye);
    cv.put(x + 4, by + 4, pal.eye);
  } else {
    cv.put(x + 1, by + 3, pal.eye);
    cv.put(x + 4, by + 3, pal.eye);
    cv.put(x + 1, by + 4, pal.eye);
    cv.put(x + 4, by + 4, pal.eye);
  }
}

function miniFrame(frame) {
  const cv = new Canvas(MINI_BOX.w, MINI_BOX.h);
  drawMini(cv, 4, 3, frame);
  glowHalo(cv, mix(PAL.green2, PAL.bg0, 0.2), 2, 0.4);
  return cv;
}

/** Agent Team: a huddle of minis, none of them talking to each other. */
function teamFrame(frame) {
  const cv = new Canvas(34, 22);
  const spots = [[3, 6], [10, 3], [17, 7], [24, 4], [13, 9]];
  spots.forEach(([x, y], i) => drawMini(cv, x, y, (frame + i) % 3 === 0 ? 1 : 0));
  glowHalo(cv, mix(PAL.green2, PAL.bg0, 0.2), 2, 0.35);
  return cv;
}

/** Every agent sprite. Full-size frames share AGENT_BOX and the feet line. */
export function buildAgent() {
  return {
    agent_idle: { frames: [idleFrame(false), idleFrame(true)], fps: 1 },
    agent_squash: { frames: [squashFrame('squash'), squashFrame('stretch')], fps: 12 },
    agent_panic: { frames: [panicFrame(0), panicFrame(1)], fps: 10 },
    agent_sweat: { frames: [sweatFrame(0), sweatFrame(1)], fps: 3 },
    agent_dazed: { frames: [dazedFrame(0), dazedFrame(1)], fps: 4 },
    agent_wait: { frames: [waitFrame(0), waitFrame(1)], fps: 3 },
    agent_grovel: { frames: [grovelFrame(0), grovelFrame(1)], fps: 6 },
    agent_mini: { frames: [miniFrame(0), miniFrame(1), miniFrame(2)], fps: 3 },
    agent_team: { frames: [teamFrame(0), teamFrame(1)], fps: 3 },
  };
}

export { mix };
