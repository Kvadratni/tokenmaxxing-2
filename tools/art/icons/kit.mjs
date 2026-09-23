/**
 * The icon kit: shared helpers for every 16x16 icon family.
 *
 * House style, inherited from Tokenmaxxing 1 and enforced by ../icons.mjs:
 *   - 16x16 cells with a 1px transparent margin;
 *   - opaque pixels only, from the palette only (PAL);
 *   - at most 4 colours per icon, the bg0 outline counting as one;
 *   - a bg0 outline around the silhouette (use `outlined`);
 *   - a distinct silhouette per id: no two icons may share an alpha mask, and
 *     near-twins are reported so they can be redrawn.
 *
 * A family module exports `{ [contentId]: (rng) => Canvas }`.
 */
import { Canvas, PAL, text } from '../pixel.mjs';

export { Canvas, PAL, text };
export const ICON_SIZE = 16;

export const diamond = (cv, cx, cy, radius, color) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const span = radius - Math.abs(dy);
    cv.hline(cx - span, cx + span, cy + dy, color);
  }
};

/** A rect with its four corner pixels knocked out. */
export const knockedBox = (cv, x, y, w, h, color) => {
  cv.rect(x + 1, y, w - 2, h, color);
  cv.rect(x, y + 1, w, h - 2, color);
};

export const polyline = (cv, points, color) => {
  for (let index = 1; index < points.length; index += 1) {
    cv.line(...points[index - 1], ...points[index], color);
  }
};

/**
 * The house icon: `body` paints the silhouette, which gets a bg0 outline and a
 * clean 1px margin; `details` paints on top; `underlay` paints behind.
 */
export const outlined = (body, details = null, underlay = null, diagonals = false) => {
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

/** Paint an ASCII picture: each character maps through `colors`; `.` is empty. */
export const pixels = (cv, x, y, rows, colors) => {
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      const color = colors[row[c]];
      if (color) cv.put(x + c, y + r, color);
    }
  });
};

/**
 * The whole icon as one ASCII picture, outlined for you. `rows` must be 16
 * strings of 16 characters; keep row/column 0 and 15 empty (`.`).
 */
export const art = (rows, colors, details = null) => outlined(
  (cv) => pixels(cv, 0, 0, rows, colors),
  details,
);

/** The token glyph (a square, an inset ring, a dark heart), tokens never have eyes. */
export const tokenGlyph = (cv, x, y, size, rim, ring) => {
  cv.rect(x, y, size, size, rim);
  cv.rect(x + 1, y + 1, size - 2, size - 2, PAL.bg0);
  if (size >= 5) {
    cv.rect(x + 2, y + 2, size - 4, size - 4, ring);
    if (size >= 7) cv.rect(x + 3, y + 3, size - 6, size - 6, PAL.bg0);
  }
};

/** A tiny agent: green block, two white eyes. Anything with eyes is an agent. */
export const agentGlyph = (cv, x, y, w, h, body = PAL.green) => {
  cv.rect(x, y, w, h, body);
  const eyeY = y + Math.max(1, Math.floor(h / 4));
  cv.put(x + 1, eyeY, PAL.white);
  cv.put(x + w - 2, eyeY, PAL.white);
};
