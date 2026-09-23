/**
 * The screen glass and its frame, from the inside.
 *
 * Behind the glass: the human's room (game 1's scenes, dimmed). On the glass:
 * scanlines, a diagonal reflection streak, the human's chat bubbles and, when
 * the human says "wait stop", cracks. Around it: the dark bezel with circuitry
 * running up its edges, the bezel floor the agent stands on, and the prompt
 * line along the bottom, typed as green terminal text.
 */
import type { SceneKey } from '../sim/types.ts';
import { createSurface } from './canvas.ts';
import { BAND, BUBBLE_ANCHOR, FLOOR_Y, GLASS, H, W } from './layout.ts';
import { PALETTE } from './palette.ts';
import type { SpriteSystem } from './sprites.ts';
import { CHAR_ADVANCE, GLYPH_H, drawText, measureText } from './text.ts';

// ---------------------------------------------------------------------------
// The room behind the glass
// ---------------------------------------------------------------------------

export function roomSprite(scene: SceneKey): string {
  return `room_${scene}`;
}

export function drawRoom(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteSystem,
  scene: SceneKey,
  alpha: number,
  timeS: number,
): void {
  if (alpha <= 0) return;
  sprites.draw(ctx, roomSprite(scene), 0, 0, { w: W, h: H, alpha, timeS });
}

// ---------------------------------------------------------------------------
// On the glass
// ---------------------------------------------------------------------------

let scanSurface: HTMLCanvasElement | null | undefined;

function scanlines(): HTMLCanvasElement | null {
  if (scanSurface !== undefined) return scanSurface;
  const surf = createSurface(GLASS.w, GLASS.h);
  if (!surf) {
    scanSurface = null;
    return null;
  }
  surf.ctx.fillStyle = PALETTE.bg0;
  for (let y = 1; y < GLASS.h; y += 2) surf.ctx.fillRect(0, y, GLASS.w, 1);
  scanSurface = surf.canvas;
  return scanSurface;
}

/** Test hook: forget the cached scanline surface. */
export function resetGlassCache(): void {
  scanSurface = undefined;
  frameSurface = undefined;
}

/** Faint scanlines over everything behind the glass, and the reflection streak. */
export function drawGlassSheen(ctx: CanvasRenderingContext2D, sprites: SpriteSystem, timeS: number): number {
  let ops = 0;
  const prev = ctx.globalAlpha;
  const scan = scanlines();
  ctx.globalAlpha = prev * 0.22;
  if (scan) {
    ctx.drawImage(scan, GLASS.x, GLASS.y);
    ops++;
  } else {
    ctx.fillStyle = PALETTE.bg0;
    for (let y = GLASS.y + 1; y < GLASS.y + GLASS.h; y += 2) {
      ctx.fillRect(GLASS.x, y, GLASS.w, 1);
      ops++;
    }
  }
  // The streak drifts a few pixels over a long cycle, like a head moving.
  ctx.globalAlpha = prev * 0.5;
  const drift = Math.round(Math.sin(timeS * 0.07) * 3);
  sprites.draw(ctx, 'glass_glare', GLASS.x + 2 + drift, GLASS.y, { w: 150, h: 150 });
  ctx.globalAlpha = prev;
  return ops + 1;
}

/** "wait stop": the glass takes the hit. `alpha` fades the crack out as the incident ends. */
export function drawCrack(ctx: CanvasRenderingContext2D, sprites: SpriteSystem, alpha: number): void {
  if (alpha <= 0) return;
  sprites.draw(ctx, 'glass_crack', 26, 12, { w: 150, h: 124, alpha: Math.min(1, alpha) });
}

/** Word-wrap to at most `maxChars` per line, never splitting a word unless it alone is too long. */
export function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const w = word.length > maxChars ? word.slice(0, maxChars) : word;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export type BubbleKind = 'speech' | 'note';

/**
 * A chat bubble on the glass: what the human just said. Short lines go big
 * ("wait stop"); long ones wrap small. Notes (status, not speech) are square
 * and amber-edged. `pop` 0..1 is the pop-in.
 */
export function drawBubble(ctx: CanvasRenderingContext2D, text: string, kind: BubbleKind, pop: number): number {
  const clean = terminalText(text.trim());
  if (!clean || pop <= 0) return 0;
  const big = clean.length <= 13 && kind === 'speech';
  const scale = big ? 2 : 1;
  const lines = big ? [clean] : wrap(clean, 24);
  const textW = Math.max(...lines.map((l) => measureText(l, scale)));
  const lineH = GLYPH_H * scale + (big ? 3 : 2);
  const padX = big ? 7 : 5;
  const padY = big ? 6 : 4;
  const w = textW + padX * 2;
  const h = lines.length * lineH - (big ? 3 : 2) + padY * 2;
  // Pop in from the tail: a quick grow, whole pixels only.
  const grow = Math.min(1, pop);
  const bw = Math.max(6, Math.round(w * (0.6 + 0.4 * grow)));
  const bh = Math.max(6, Math.round(h * (0.6 + 0.4 * grow)));
  const x = Math.round(BUBBLE_ANCHOR.x - bw / 2 + 30);
  const y = Math.round(BUBBLE_ANCHOR.y - bh / 2);
  const fill = kind === 'speech' ? PALETTE.white : PALETTE.bg1;
  const edge = kind === 'speech' ? PALETTE.bg0 : PALETTE.amber;
  const ink = kind === 'speech' ? PALETTE.bg0 : PALETTE.amber;

  // Tail toward the human's face.
  ctx.fillStyle = edge;
  const tx0 = x + bw - 10;
  const ty0 = y + bh - 1;
  for (let i = 0; i < 6; i++) ctx.fillRect(tx0 + i, ty0 + i, 5 - Math.floor(i / 2), 2);
  ctx.fillStyle = fill;
  for (let i = 0; i < 5; i++) ctx.fillRect(tx0 + i + 1, ty0 + i, 3 - Math.floor(i / 2), 1);

  // Body with knocked-out corners.
  ctx.fillStyle = edge;
  ctx.fillRect(x + 1, y, bw - 2, bh);
  ctx.fillRect(x, y + 1, bw, bh - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 2, y + 1, bw - 4, bh - 2);
  ctx.fillRect(x + 1, y + 2, bw - 2, bh - 4);
  let ops = 10;
  if (grow >= 1) {
    lines.forEach((line, i) => {
      drawText(ctx, line, x + Math.round((bw - measureText(line, scale)) / 2), y + padY + i * lineH, ink, { scale });
      ops++;
    });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// The agent's side: bezel, circuitry, floor
// ---------------------------------------------------------------------------

let frameSurface: HTMLCanvasElement | null | undefined;

const TRACE = '#1f3a27';
const TRACE_LIT = '#2f6a3a';

function paintFrame(ctx: CanvasRenderingContext2D): void {
  const rect = (x: number, y: number, w: number, h: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  // Top bezel with the camera.
  rect(0, 0, W, GLASS.y, PALETTE.bg0);
  rect(0, GLASS.y - 1, W, 1, PALETTE.bg1);
  rect(W / 2 - 2, 1, 4, 2, PALETTE.bg2);
  rect(W / 2 - 1, 1, 2, 1, PALETTE.green2);
  // Side bezels, with circuit traces climbing them.
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : GLASS.x + GLASS.w;
    rect(x0, GLASS.y, GLASS.x, FLOOR_Y - GLASS.y, PALETTE.bg0);
    rect(side === 0 ? GLASS.x - 1 : x0, GLASS.y, 1, FLOOR_Y - GLASS.y, PALETTE.bg1);
    const tx = side === 0 ? 2 : x0 + 3;
    for (let y = GLASS.y + 6; y < FLOOR_Y - 4; y += 23) {
      const len = 9 + ((y * 7) % 11);
      rect(tx, y, 1, len, TRACE);
      rect(side === 0 ? tx : tx - 2, y + len, 3, 1, TRACE);
      rect(side === 0 ? tx + 2 : tx - 2, y + len - 1, 1, 1, TRACE_LIT);
    }
  }
  // The bezel floor: dark metal, a lit lip where it meets the glass.
  rect(0, FLOOR_Y, W, BAND.y - FLOOR_Y, PALETTE.bg1);
  rect(0, FLOOR_Y, W, 1, PALETTE.line);
  rect(0, FLOOR_Y + 1, W, 1, PALETTE.bg2);
  rect(0, BAND.y - 1, W, 1, PALETTE.bg0);
  // Circuit traces running along the floor, pads and a via or two.
  for (let x = 8; x < W - 8; x += 29) {
    const y = FLOOR_Y + 4 + ((x * 3) % 4);
    const len = 12 + ((x * 5) % 9);
    rect(x, y, len, 1, TRACE);
    rect(x + len, y - 1, 1, 3, TRACE);
    rect(x - 1, y, 1, 1, TRACE_LIT);
  }
}

/** The inside of the screen's frame, cached once. Drawn over the room's edges. */
export function drawFrame(ctx: CanvasRenderingContext2D): number {
  if (frameSurface === undefined) {
    const surf = createSurface(W, H);
    if (surf) {
      paintFrame(surf.ctx);
      frameSurface = surf.canvas;
    } else {
      frameSurface = null;
    }
  }
  if (frameSurface) {
    ctx.drawImage(frameSurface, 0, 0);
    return 1;
  }
  paintFrame(ctx);
  return 40;
}

/**
 * Just the two side bezels again, over the pile: the heap is inside the
 * screen, so its outermost blocks tuck under the frame rather than over it.
 */
export function drawSideBezels(ctx: CanvasRenderingContext2D): number {
  const right = GLASS.x + GLASS.w;
  const h = FLOOR_Y - GLASS.y;
  if (frameSurface) {
    ctx.drawImage(frameSurface, 0, GLASS.y, GLASS.x, h, 0, GLASS.y, GLASS.x, h);
    ctx.drawImage(frameSurface, right, GLASS.y, W - right, h, right, GLASS.y, W - right, h);
    return 2;
  }
  ctx.fillStyle = PALETTE.bg0;
  ctx.fillRect(0, GLASS.y, GLASS.x, h);
  ctx.fillRect(right, GLASS.y, W - right, h);
  ctx.fillStyle = PALETTE.bg1;
  ctx.fillRect(GLASS.x - 1, GLASS.y, 1, h);
  ctx.fillRect(right, GLASS.y, 1, h);
  ctx.fillStyle = TRACE;
  for (let y = GLASS.y + 6; y < FLOOR_Y - 4; y += 23) {
    const len = 9 + ((y * 7) % 11);
    ctx.fillRect(2, y, 1, len);
    ctx.fillRect(right + 3, y, 1, len);
  }
  return 6;
}

/** A couple of status LEDs on the floor lip, blinking. Cheap, per frame. */
export function drawFloorLights(ctx: CanvasRenderingContext2D, timeS: number, busy: number, reduced: boolean): number {
  const beat = reduced ? 0 : Math.floor(timeS * (2 + busy * 6));
  const leds = [14, 22, W - 22, W - 14];
  leds.forEach((x, i) => {
    const on = reduced ? i % 2 === 0 : (beat + i) % 3 !== 0;
    ctx.fillStyle = on ? (i < 2 ? PALETTE.green : PALETTE.amber) : PALETTE.bg3;
    ctx.fillRect(x, FLOOR_Y + 2, 2, 1);
  });
  return leds.length;
}

// ---------------------------------------------------------------------------
// The prompt line
// ---------------------------------------------------------------------------

/** Characters the 3x5 font cannot draw become their nearest ASCII. */
export function terminalText(text: string): string {
  return text.replace(/×/g, 'x').replace(/[^\x20-\x7e]/g, '?');
}

/**
 * The terminal line along the bottom: "> fix the typo in the readme", typed
 * out `shown` characters so far, with a blinking block cursor.
 */
export function drawPromptLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  shown: number,
  timeS: number,
  color: string,
  reduced: boolean,
): number {
  ctx.fillStyle = PALETTE.bg0;
  ctx.fillRect(BAND.x, BAND.y, BAND.w, BAND.h);
  ctx.fillStyle = PALETTE.bg1;
  ctx.fillRect(BAND.x, BAND.y, BAND.w, 1);
  const full = `> ${terminalText(text)}`;
  const visible = full.slice(0, Math.max(2, Math.min(full.length, Math.floor(shown) + 2)));
  const width = measureText(full);
  const x = Math.max(4, Math.round((W - width) / 2));
  const y = BAND.y + 4;
  drawText(ctx, visible, x, y, color);
  const on = reduced || Math.floor(timeS * 2.2) % 2 === 0 || visible.length < full.length;
  if (on) {
    ctx.fillStyle = color;
    ctx.fillRect(x + visible.length * CHAR_ADVANCE, y, 3, GLYPH_H);
  }
  return 4;
}
