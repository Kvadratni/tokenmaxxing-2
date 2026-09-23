/**
 * Stage props: the token blocks the context pile is made of, the MCP manuals
 * under it, the compaction walls and summary scroll, the glass glare and
 * crack, and one sprite per pickup shape/accent pair in content.ts.
 *
 * Tokens are faceless on purpose. Anything with eyes is an agent.
 */
import { Canvas, PAL, bayer, flipH, glowHalo, mix, text } from './pixel.mjs';
import { buildAgent } from './agent.mjs';

const OUT = PAL.bg0;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Brightness levels, surface to deep: lit, mid, dim, deep. */
export const TOKEN_LEVELS = Object.freeze([
  { rim: '#8fe68a', fill: '#2a8a37', ring: '#c2f7bb', dot: '#2a8a37' },
  { rim: PAL.green, fill: '#1f6a2c', ring: '#7ddf78', dot: '#1f6a2c' },
  { rim: '#2f8f3a', fill: '#153f1f', ring: '#3e9c45', dot: '#153f1f' },
  { rim: '#1f5a2a', fill: '#0f2a16', ring: '#25632e', dot: '#0f2a16' },
]);

/** 7x7: an outer square, a gap, an inset ring and a dark centre. */
function token7(level) {
  const c = TOKEN_LEVELS[level];
  const rows = [
    'OOOOOOO',
    'OfffffO',
    'OfIIIfO',
    'OfIdIfO',
    'OfIIIfO',
    'OfffffO',
    'OOOOOOO',
  ];
  const cv = new Canvas(7, 7);
  rows.forEach((row, y) => {
    for (let x = 0; x < 7; x += 1) {
      const ch = row[x];
      cv.put(x, y, ch === 'O' ? c.rim : ch === 'I' ? c.ring : ch === 'd' ? c.dot : c.fill);
    }
  });
  // Lit top-left corner on the brightest level.
  if (level === 0) {
    cv.put(0, 0, PAL.white);
    cv.put(1, 0, '#e2fbdc');
    cv.put(0, 1, '#e2fbdc');
  }
  return cv;
}

/** 5x5: the same glyph, smaller, for particles and loose tokens. */
function token5(level) {
  const c = TOKEN_LEVELS[level];
  const rows = ['OOOOO', 'OIIIO', 'OIdIO', 'OIIIO', 'OOOOO'];
  const cv = new Canvas(5, 5);
  rows.forEach((row, y) => {
    for (let x = 0; x < 5; x += 1) {
      const ch = row[x];
      cv.put(x, y, ch === 'O' ? c.rim : ch === 'I' ? c.fill : c.ring);
    }
  });
  return cv;
}

/** 7x7 tokens tumbled 45 degrees-ish: a knocked-over block on the pile's surface. */
function tokenTilted(level) {
  const c = TOKEN_LEVELS[level];
  const rows = [
    '...O...',
    '..OfO..',
    '.OfIfO.',
    'OfIdIfO',
    '.OfIfO.',
    '..OfO..',
    '...O...',
  ];
  const cv = new Canvas(7, 7);
  rows.forEach((row, y) => {
    for (let x = 0; x < 7; x += 1) {
      const ch = row[x];
      if (ch === '.') continue;
      cv.put(x, y, ch === 'O' ? c.rim : ch === 'I' ? c.ring : ch === 'd' ? c.dot : c.fill);
    }
  });
  return cv;
}

// ---------------------------------------------------------------------------
// Manuals: the MCP servers' 9K tokens of documentation, stacked flat.
// ---------------------------------------------------------------------------

const BOOKS = Object.freeze([
  { cover: '#2f5f92', spine: PAL.blue, title: '#9fd0ff' },
  { cover: '#5d3f8a', spine: PAL.purple, title: '#d6c2f5' },
  { cover: '#8a6a2a', spine: PAL.amber, title: '#f5e2b0' },
  { cover: '#7a2e31', spine: '#b8474b', title: '#f0b9ba' },
  { cover: '#3c434e', spine: PAL.fg2, title: PAL.fg0 },
]);

function manual(i) {
  const b = BOOKS[i];
  const cv = new Canvas(30, 5);
  cv.rect(0, 0, 30, 5, b.cover);
  cv.hline(0, 29, 0, b.spine);
  // Page block at the right end.
  cv.rect(25, 1, 4, 3, PAL.fg0);
  cv.hline(25, 28, 2, PAL.fg1);
  cv.vline(29, 0, 4, OUT);
  cv.hline(0, 29, 4, mix(b.cover, OUT, 0.5));
  // A title band nobody reads.
  cv.hline(4, 4 + 8 + (i % 3) * 3, 2, b.title);
  cv.put(2, 2, b.title);
  return cv;
}

// ---------------------------------------------------------------------------
// Compaction: the walls, the summary scroll.
// ---------------------------------------------------------------------------

export const WALL_SIZE = Object.freeze({ w: 64, h: 164 });

/** The left wall. It slams in from the left bezel, chevrons pointing inward. */
function wallLeft() {
  const { w, h } = WALL_SIZE;
  const cv = new Canvas(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const t = bayer(x, y, 4);
      let color = x < 6 ? PAL.bg1 : PAL.bg2;
      if (x > w - 9) color = PAL.bg3;
      if ((y % 26 === 0 || y % 26 === 1) && x < w - 8) color = PAL.bg1;
      if (y % 26 === 2 && x < w - 8) color = PAL.line;
      if (x > 8 && x < w - 12 && y % 26 > 4 && y % 26 < 22 && t < 0.12) color = PAL.bg3;
      cv.put(x, y, color);
    }
  }
  // Rivets.
  for (let y = 7; y < h; y += 26) {
    for (const x of [4, w - 14]) {
      cv.put(x, y, PAL.fg2);
      cv.put(x, y + 13, PAL.fg2);
    }
  }
  // The leading edge: hot orange, a red LED strip just behind it.
  cv.vline(w - 1, 0, h - 1, '#f08a3c');
  cv.vline(w - 2, 0, h - 1, PAL.red);
  for (let y = 0; y < h; y += 1) if (bayer(w - 3, y, 4) < 0.5) cv.put(w - 3, y, '#7a1f1f');
  for (let y = 12; y < h - 12; y += 9) cv.rect(w - 7, y, 2, 5, y % 18 < 9 ? PAL.red : '#7a1f1f');
  // Chevrons, big and pointing at the pile.
  const chevron = (cy) => {
    for (let k = 0; k < 2; k += 1) {
      const x0 = 18 + k * 12;
      for (let i = 0; i < 9; i += 1) {
        cv.rect(x0 + i, cy - 9 + i, 3, 1, PAL.red);
        cv.rect(x0 + i, cy + 9 - i, 3, 1, PAL.red);
      }
    }
  };
  chevron(Math.round(h * 0.34));
  chevron(Math.round(h * 0.66));
  cv.vline(0, 0, h - 1, OUT);
  return cv;
}

/** The compacted context, rolled up and labelled. */
function scroll() {
  const cv = new Canvas(38, 13);
  // Paper body.
  cv.rect(4, 2, 30, 9, PAL.fg0);
  cv.hline(4, 33, 2, PAL.white);
  cv.hline(4, 33, 10, PAL.fg1);
  // Rolled ends.
  for (const x of [1, 33]) {
    cv.rect(x, 1, 4, 11, PAL.fg1);
    cv.vline(x, 2, 10, PAL.fg2);
    cv.put(x + 2, 5, PAL.fg2);
    cv.put(x + 1, 6, PAL.fg2);
    cv.put(x + 2, 7, PAL.fg2);
  }
  text(cv, 5, 4, 'SUMMARY', PAL.bg0);
  const out = cv.clone();
  out.outline(OUT, 255, false);
  out.blit(cv, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// The glass
// ---------------------------------------------------------------------------

/** A diagonal reflection streak: one broad soft band, one thin sharp one. */
function glare() {
  const w = 150;
  const h = 150;
  const cv = new Canvas(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // Distance along the anti-diagonal, so bands run lower-left to upper-right.
      const d = x + y;
      const t = bayer(x, y, 4);
      const fade = Math.max(0, 1 - Math.hypot(x - 20, y - 20) / 190);
      const broad = d > 40 && d < 78 ? 0.12 : 0;
      const thin = d > 92 && d < 97 ? 0.28 : 0;
      if (t < (broad + thin) * fade) cv.put(x, y, thin > 0 ? PAL.fg0 : PAL.fg1);
    }
  }
  return cv;
}

/** "wait stop": the screen takes the hit. Radial cracks from an impact point. */
function crack() {
  const w = 150;
  const h = 124;
  const cx = 64;
  const cy = 58;
  const cv = new Canvas(w, h);
  const hash = (n) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const rays = 11;
  for (let r = 0; r < rays; r += 1) {
    let ang = (r / rays) * Math.PI * 2 + hash(r) * 0.4;
    let x = cx;
    let y = cy;
    const len = 34 + hash(r + 9) * 34;
    for (let s = 0; s < len; s += 1) {
      ang += (hash(r * 31 + s) - 0.5) * 0.35;
      x += Math.cos(ang);
      y += Math.sin(ang);
      cv.put(Math.round(x), Math.round(y), s < len * 0.7 ? PAL.white : '#9fd0ff');
      if (s < 10) cv.put(Math.round(x) + 1, Math.round(y), '#9fd0ff');
      // Spurs.
      if (s > 8 && s % 11 === 5) {
        let bx = x;
        let by = y;
        const bang = ang + (hash(s + r) > 0.5 ? 0.9 : -0.9);
        for (let k = 0; k < 7; k += 1) {
          bx += Math.cos(bang);
          by += Math.sin(bang);
          cv.put(Math.round(bx), Math.round(by), '#9fd0ff');
        }
      }
    }
  }
  // Concentric fracture rings, broken.
  for (const rr of [9, 17]) {
    for (let a = 0; a < 90; a += 1) {
      const ang = (a / 90) * Math.PI * 2;
      if (hash(a * 3 + rr) < 0.35) continue;
      const wob = rr + (hash(a + rr * 7) - 0.5) * 2;
      cv.put(Math.round(cx + Math.cos(ang) * wob), Math.round(cy + Math.sin(ang) * wob * 0.9), '#9fd0ff');
    }
  }
  // The shattered centre.
  cv.disc(cx, cy, 3.5, '#cfe8ff');
  cv.disc(cx, cy, 1.5, PAL.white);
  return cv;
}

// ---------------------------------------------------------------------------
// Pickups, one per shape/accent pair.
// ---------------------------------------------------------------------------

function accentColor(accent) {
  return PAL[accent] ?? PAL.amber;
}

function withOutline(cv) {
  const out = cv.clone();
  out.outline(OUT, 255, false);
  out.blit(cv, 0, 0);
  return out;
}

const PICKUP_DRAWERS = Object.freeze({
  token(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(12, 12);
    cv.rect(1, 1, 10, 10, col);
    cv.rect(3, 3, 6, 6, mix(col, PAL.bg0, 0.45));
    cv.rect(4, 4, 4, 4, mix(col, PAL.white, 0.45));
    cv.rect(5, 5, 2, 2, mix(col, PAL.bg0, 0.45));
    cv.hline(1, 10, 1, mix(col, PAL.white, 0.55));
    cv.put(1, 1, PAL.white);
    return withOutline(cv);
  },
  chip(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(14, 12);
    for (const y of [3, 6, 9]) {
      cv.put(1, y, PAL.fg1);
      cv.put(12, y, PAL.fg1);
    }
    for (const x of [4, 7, 10]) {
      cv.put(x, 1, PAL.fg1);
      cv.put(x, 10, PAL.fg1);
    }
    cv.rect(2, 2, 10, 8, col);
    cv.rect(4, 4, 6, 4, mix(col, PAL.bg0, 0.55));
    cv.hline(5, 8, 5, PAL.white);
    cv.hline(5, 7, 6, mix(col, PAL.white, 0.5));
    return withOutline(cv);
  },
  bubble(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(14, 12);
    cv.rect(1, 1, 12, 7, col);
    cv.put(1, 1, [0, 0, 0, 0]);
    cv.put(12, 1, [0, 0, 0, 0]);
    cv.rect(3, 8, 3, 1, col);
    cv.rect(3, 9, 2, 1, col);
    cv.put(3, 10, col);
    const ink = accent === 'white' ? PAL.bg3 : mix(col, PAL.bg0, 0.6);
    if (accent === 'white') {
      // "thanks!": three words' worth of dots and a bang.
      cv.hline(3, 7, 4, ink);
      cv.vline(10, 3, 4, ink);
      cv.put(10, 6, ink);
    } else {
      // An accepted answer: a tick.
      cv.put(4, 4, ink);
      cv.put(5, 5, ink);
      cv.put(6, 6, ink);
      cv.put(7, 5, ink);
      cv.put(8, 4, ink);
      cv.put(9, 3, ink);
    }
    return withOutline(cv);
  },
  duck(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(14, 12);
    cv.rect(1, 5, 10, 5, col);
    cv.rect(2, 10, 8, 1, mix(col, PAL.bg0, 0.4));
    cv.rect(6, 1, 5, 5, col);
    cv.rect(11, 3, 2, 2, '#e07b39');
    cv.put(9, 2, PAL.bg0);
    cv.hline(2, 6, 6, mix(col, PAL.white, 0.4));
    cv.put(1, 4, col);
    return withOutline(cv);
  },
  book(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(12, 14);
    cv.rect(1, 1, 9, 12, col);
    cv.vline(1, 1, 12, mix(col, PAL.bg0, 0.4));
    cv.rect(10, 2, 1, 10, PAL.fg0);
    cv.hline(3, 8, 4, mix(col, PAL.white, 0.6));
    cv.hline(3, 7, 6, mix(col, PAL.white, 0.35));
    cv.hline(2, 9, 12, PAL.fg0);
    return withOutline(cv);
  },
  bug(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(14, 12);
    for (const y of [4, 6, 8]) {
      cv.put(1, y + (y === 6 ? 0 : 1), PAL.fg2);
      cv.put(2, y, PAL.fg2);
      cv.put(11, y, PAL.fg2);
      cv.put(12, y + (y === 6 ? 0 : 1), PAL.fg2);
    }
    cv.rect(3, 3, 8, 7, col);
    cv.rect(5, 1, 4, 2, PAL.bg3);
    cv.put(4, 0, PAL.fg2);
    cv.put(9, 0, PAL.fg2);
    cv.vline(7, 3, 9, mix(col, PAL.bg0, 0.55));
    cv.put(5, 5, PAL.bg0);
    cv.put(9, 6, PAL.bg0);
    cv.put(4, 3, mix(col, PAL.white, 0.5));
    return withOutline(cv);
  },
  thumb(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(13, 14);
    cv.rect(5, 1, 3, 5, col);
    cv.rect(3, 5, 7, 7, col);
    cv.rect(1, 6, 2, 6, mix(col, PAL.bg0, 0.4));
    for (const y of [6, 8, 10]) cv.hline(7, 10, y, mix(col, PAL.bg0, 0.35));
    cv.put(5, 1, mix(col, PAL.white, 0.5));
    cv.vline(3, 5, 11, mix(col, PAL.white, 0.35));
    return withOutline(cv);
  },
  star(accent) {
    const col = accentColor(accent);
    const cv = new Canvas(15, 15);
    cv.vline(7, 1, 13, col);
    cv.hline(1, 13, 7, col);
    cv.rect(6, 4, 3, 7, col);
    cv.rect(4, 6, 7, 3, col);
    cv.rect(7, 6, 1, 3, PAL.white);
    cv.put(6, 7, PAL.white);
    cv.put(8, 7, PAL.white);
    // A second, small sparkle.
    cv.put(12, 2, col);
    cv.put(11, 2, mix(col, PAL.white, 0.5));
    cv.put(13, 2, mix(col, PAL.white, 0.5));
    cv.put(12, 1, mix(col, PAL.white, 0.5));
    cv.put(12, 3, mix(col, PAL.white, 0.5));
    return withOutline(cv);
  },
  mini_agent() {
    const agent = buildAgent();
    return agent.agent_mini.frames[0].clone();
  },
});

export function pickupSpriteKey(shape, accent) {
  return `pk_${shape}_${accent}`;
}

/** One sprite per distinct (shape, accent) in `pickups`. */
export function buildPickups(pickups) {
  const out = {};
  for (const p of pickups) {
    const key = pickupSpriteKey(p.shape, p.accent);
    if (out[key]) continue;
    const draw = PICKUP_DRAWERS[p.shape];
    if (!draw) throw new Error(`props.mjs has no pickup drawer for shape ${p.shape}`);
    out[key] = { frames: [draw(p.accent)] };
  }
  return out;
}

export function buildProps() {
  const wall = wallLeft();
  const glowy = token7(0).clone();
  glowHalo(glowy, PAL.green2, 1, 0.5);
  return {
    token: { frames: [token7(0), token7(1), token7(2), token7(3)] },
    token_small: { frames: [token5(0), token5(1), token5(2), token5(3)] },
    token_tilt: { frames: [tokenTilted(0), tokenTilted(1), tokenTilted(2), tokenTilted(3)] },
    manual: { frames: [0, 1, 2, 3, 4].map(manual) },
    wall_left: { frames: [wall] },
    wall_right: { frames: [flipH(wall)] },
    scroll_summary: { frames: [scroll()] },
    glass_glare: { frames: [glare()] },
    glass_crack: { frames: [crack()] },
  };
}
