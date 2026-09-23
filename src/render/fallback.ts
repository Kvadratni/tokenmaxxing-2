/**
 * Procedural stand-ins for every sprite in the atlas.
 *
 * With no atlas at all the game must still be fully playable and a screenshot
 * must still say what is going on: the human behind the glass, the agent, the
 * pile, the gadgets. Each stand-in uses the real palette and the same
 * geometry as the art, only with fewer pixels. Scene-space sprites (the room,
 * the human) are painted in scene coordinates offset by (x, y), exactly where
 * their atlas frames would land.
 */
import { getBackdrop, paintBackdrop } from './backdrop.ts';
import type { SceneKey } from '../sim/types.ts';
import { PALETTE, shade } from './palette.ts';
import { drawText } from './text.ts';

type Ctx = CanvasRenderingContext2D;

/** Draw ops issued by the fallback painter since the last read. */
let ops = 0;
export function consumeFallbackOps(): number {
  const n = ops;
  ops = 0;
  return n;
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  ops++;
}

function ellipseHalf(cy: number, rx: number, ry: number, y: number): number {
  const t = (y - cy) / ry;
  return t * t > 1 ? -1 : rx * Math.sqrt(1 - t * t);
}

// ---------------------------------------------------------------------------
// The room and the human (scene space)
// ---------------------------------------------------------------------------

const ROOM_SCENES: Readonly<Record<string, SceneKey>> = {
  room_bedroom: 'bedroom',
  room_coworking: 'coworking',
  room_openplan: 'openplan',
  room_datacenter: 'datacenter',
  room_orbital: 'orbital',
};

function room(ctx: Ctx, scene: SceneKey, x: number, y: number): void {
  const pre = getBackdrop(scene);
  if (pre) {
    ctx.drawImage(pre, x, y, 320, 180);
    ops++;
  } else {
    paintBackdrop(ctx, scene);
    ops += 40;
  }
  // Behind the glass: most of the light goes.
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * 0.62;
  px(ctx, x, y, 320, 180, PALETTE.bg0);
  ctx.globalAlpha = prev;
}

const HOOD = '#1a1f28';
const HOOD_RIM = '#2c3542';
const FACE = '#1a1616';
const SKIN = '#2e2522';

function humanBody(ctx: Ctx, x: number, y: number): void {
  for (let row = 0; row < 180; row += 3) {
    const hood = ellipseHalf(60, 90, 96, row + 1);
    const shoulders = ellipseHalf(214, 176, 118, row + 1);
    const half = Math.max(hood, shoulders);
    if (half > 0) px(ctx, x + 160 - half, y + row, half * 2, 3, row < 40 ? HOOD_RIM : HOOD);
  }
  for (let row = 12; row < 112; row += 3) {
    const half = row <= 62 ? ellipseHalf(62, 43, 50, row + 1) : 43 * (1 - ((row - 62) / 50) ** 2 * 0.55);
    if (half > 0) px(ctx, x + 160 - half, y + row, half * 2, 3, row > 56 && row < 100 ? SKIN : FACE);
  }
}

const IRIS = PALETTE.green;
const LID = '#08090b';

function humanEyes(ctx: Ctx, mood: string, frame: number, x: number, y: number): void {
  for (const [i, cx] of [139, 181].entries()) {
    const ex = x + cx;
    const ey = y + 54;
    px(ctx, ex - 8, ey - 2, 16, 5, FACE);
    if (frame === 1) {
      px(ctx, ex - 7, ey, 14, 1, LID);
      continue;
    }
    const narrow = mood === 'furious' || (mood === 'suspicious' && i === 0);
    const low = frame === 2 ? 1 : 0;
    px(ctx, ex - 3, ey - (narrow ? 0 : 1) + low, 6, narrow ? 1 : 2, IRIS);
    px(ctx, ex - 7, ey - 2 + low, 14, 1, LID);
    // Brows carry the mood.
    const brow = mood === 'furious' ? (i === 0 ? 1 : -1) : mood === 'impatient' ? (i === 0 ? 0.5 : -0.5) : 0;
    const raise = mood === 'suspicious' && i === 1 ? -2 : 0;
    for (let k = 0; k < 4; k++) {
      const bx = ex - 7 + k * 4;
      const by = ey - 6 + raise + Math.round((k - 1.5) * brow);
      px(ctx, bx, by, 4, 1, '#2b2320');
    }
  }
}

function humanMug(ctx: Ctx, frame: number, x: number, y: number): void {
  px(ctx, x + 276, y + 140, 24, 40, HOOD);
  px(ctx, x + 236, y + 110, 30, 36, '#2b313b');
  px(ctx, x + 236, y + 110, 4, 36, '#4a5260');
  px(ctx, x + 238, y + 108, 26, 3, '#1a120d');
  px(ctx, x + 230, y + 117, 6, 16, '#2b313b');
  px(ctx, x + 258, y + 118, 12, 20, SKIN);
  for (let i = 0; i < 3; i++) px(ctx, x + 242 + i * 7, y + 98 - ((frame + i) % 3) * 2, 1, 6, '#4f5966');
}

function humanTyping(ctx: Ctx, frame: number, x: number, y: number): void {
  const lift = frame === 0 ? [0, 3] : [3, 0];
  for (let i = 0; i < 8; i++) {
    px(ctx, x + 70 + i * 6, y + 124 + lift[0]! + i * 7, 22, 8, '#212834');
    px(ctx, x + 228 - i * 6, y + 124 + lift[1]! + i * 7, 22, 8, '#212834');
  }
}

function humanChair(ctx: Ctx, x: number, y: number): void {
  px(ctx, x + 130, y + 70, 60, 80, '#15181e');
  px(ctx, x + 130, y + 70, 60, 2, '#343c49');
  px(ctx, x + 130, y + 70, 3, 80, '#262c36');
  px(ctx, x + 116, y + 128, 10, 4, '#262c36');
  px(ctx, x + 194, y + 128, 10, 4, '#262c36');
}

// ---------------------------------------------------------------------------
// The agent (sprite box 36x50, feet at 18,45)
// ---------------------------------------------------------------------------

interface AgentLook {
  fill: string;
  edge: string;
  core: string;
}

const LOOK_NORMAL: AgentLook = { fill: PALETTE.green, edge: '#1b5424', core: '#7ddf78' };
const LOOK_PANIC: AgentLook = { fill: PALETTE.amber, edge: '#9e2a2a', core: '#f3cf78' };
const LOOK_DAZED: AgentLook = { fill: '#46b048', edge: '#1d4a26', core: '#6cc868' };

function agentBody(ctx: Ctx, x: number, y: number, look: AgentLook, w = 14, h = 28, dy = 0): { bx: number; by: number } {
  const bx = x + 18 - Math.floor(w / 2);
  const by = y + 45 - 6 - h + dy;
  // Halo.
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * 0.25;
  px(ctx, bx - 3, by - 2, w + 6, h + 4, look === LOOK_PANIC ? PALETTE.red : PALETTE.green2);
  ctx.globalAlpha = prev;
  // Limbs.
  px(ctx, bx - 3, by + 11, 1, 10, look.fill);
  px(ctx, bx + w + 2, by + 11, 1, 10, look.fill);
  px(ctx, bx + 4, by + h, 1, 6, look.fill);
  px(ctx, bx + w - 5, by + h, 1, 6, look.fill);
  // Block.
  px(ctx, bx, by, w, h, look.edge);
  px(ctx, bx + 1, by + 1, w - 2, h - 2, look.fill);
  px(ctx, bx + 3, by + 3, w - 7, Math.round(h * 0.55), look.core);
  return { bx, by };
}

function agent(ctx: Ctx, key: string, frame: number, x: number, y: number): void {
  if (key === 'agent_squash') {
    const w = frame === 0 ? 17 : 12;
    const h = frame === 0 ? 23 : 31;
    const { bx, by } = agentBody(ctx, x, y, LOOK_NORMAL, w, h, frame === 0 ? 1 : 0);
    px(ctx, bx + 3, by + 5, 2, 2, PALETTE.white);
    px(ctx, bx + w - 5, by + 5, 2, 2, PALETTE.white);
    return;
  }
  const look = key === 'agent_panic' ? LOOK_PANIC : key === 'agent_dazed' ? LOOK_DAZED : LOOK_NORMAL;
  const { bx, by } = agentBody(ctx, x, y, look, 14, 28, key === 'agent_grovel' ? frame : 0);
  const eyeH = key === 'agent_idle' && frame === 1 ? 1 : key === 'agent_panic' ? 3 : 2;
  const eyeY = by + (key === 'agent_idle' && frame === 1 ? 7 : 6);
  if (key === 'agent_dazed') {
    px(ctx, bx + 2, by + 5, 3, 3, PALETTE.white);
    px(ctx, bx + 3, by + 6, 1, 1, look.fill);
    px(ctx, bx + 9, by + 5, 3, 3, PALETTE.white);
    px(ctx, bx + 10, by + 6, 1, 1, look.fill);
    px(ctx, bx + 10, by, 4, 4, PALETTE.bg0);
  } else {
    px(ctx, bx + 3, eyeY, 2, eyeH, PALETTE.white);
    px(ctx, bx + 9, eyeY, 2, eyeH, PALETTE.white);
  }
  if (key === 'agent_panic') {
    px(ctx, bx + 5, by + 11, 4, 3, '#7a1f1f');
    px(ctx, x + 3 + frame * 2, y + 8, 2, 2, PALETTE.red);
    px(ctx, x + 30 - frame, y + 12, 2, 2, PALETTE.amber);
  } else if (key === 'agent_sweat') {
    px(ctx, bx + 4, by + 12, 6, 1, '#10281a');
    px(ctx, bx + 15, by + 2 + frame * 3, 2, 3, PALETTE.blue);
    px(ctx, bx - 8, by + 4, 3, 4, look.fill);
    px(ctx, bx + 11, by + 14, 8, 8, PALETTE.bg3);
    px(ctx, bx + 13, by + 16, 4, 4, PALETTE.red);
  } else if (key === 'agent_wait') {
    px(ctx, bx + 15, by - 8, 7, 9, PALETTE.fg0);
    px(ctx, bx + 17, by - 6, 3, 1, PALETTE.bg0);
    px(ctx, bx + 18, by - 3, 1, 2, PALETTE.bg0);
  } else if (key === 'agent_grovel') {
    px(ctx, bx + 5, by + 13, 4, 3, look.fill);
    px(ctx, x + 4, y + 8, 1, 3, PALETTE.amber);
    px(ctx, x + 3, y + 9, 3, 1, PALETTE.amber);
  }
}

function mini(ctx: Ctx, x: number, y: number, frame: number, body: string = PALETTE.green): void {
  const bob = frame === 1 ? 1 : 0;
  px(ctx, x, y + bob, 6, 11, '#1b5424');
  px(ctx, x + 1, y + 1 + bob, 4, 9, body);
  px(ctx, x + 1, y + 3 + bob, 1, 2, PALETTE.white);
  px(ctx, x + 4, y + 3 + bob, 1, 2, PALETTE.white);
  px(ctx, x + 1, y + 11, 1, 3, body);
  px(ctx, x + 4, y + 11, 1, 3, body);
}

// ---------------------------------------------------------------------------
// Gadgets
// ---------------------------------------------------------------------------

function gadget(ctx: Ctx, tool: string, frame: number, x: number, y: number, off: boolean): void {
  const c = (color: string): string => (off ? shade(PALETTE.fg2, 0.8) : color);
  switch (tool) {
    case 'grep':
      px(ctx, x + 6, y + 1, 10, 10, c(PALETTE.fg1));
      px(ctx, x + 8, y + 3, 6, 6, c(PALETTE.blue));
      px(ctx, x + 2, y + 11, 5, 3, c(PALETTE.blue));
      break;
    case 'read':
      px(ctx, x + 1, y + 1, 12, 16, c(PALETTE.fg0));
      for (let r = 0; r < 6; r++) px(ctx, x + 3, y + 4 + r * 2, 7, 1, c(PALETTE.line));
      break;
    case 'edit':
      for (let i = 0; i < 10; i++) px(ctx, x + 4 + i, y + 12 - i, 2, 2, c(PALETTE.amber));
      px(ctx, x + 14, y + 1, 2, 2, c(PALETTE.red));
      px(ctx, x + 2, y + 16, frame === 0 ? 3 : 6, 1, c(PALETTE.green));
      break;
    case 'bash':
      px(ctx, x + 1, y + 1, 20, 13, c(PALETTE.bg3));
      px(ctx, x + 3, y + 3, 16, 9, '#0a0d10');
      px(ctx, x + 5, y + 5, 2, 5, c(PALETTE.green));
      if (frame === 0) px(ctx, x + 9, y + 9, 4, 1, c(PALETTE.green));
      px(ctx, x + 8, y + 14, 6, 2, c(PALETTE.line));
      break;
    case 'web_search':
      px(ctx, x + 3, y + 3, 12, 12, c(PALETTE.blue));
      px(ctx, x + 5 + (frame % 2) * 2, y + 5, 4, 3, c(PALETTE.green2));
      px(ctx, x + 3, y + 9, 12, 1, c(PALETTE.fg1));
      break;
    case 'subagent':
      mini(ctx, x + 4, y + 3, frame, c(PALETTE.green));
      break;
    case 'mcp_server':
      px(ctx, x + 1, y + 1, 16, 26, c(PALETTE.bg2));
      for (let u = 0; u < 5; u++) {
        px(ctx, x + 3, y + 3 + u * 5, 12, 4, c(PALETTE.bg1));
        px(ctx, x + 13, y + 5 + u * 5, 1, 1, c((u + frame) % 2 ? PALETTE.green2 : PALETTE.green));
      }
      break;
    case 'agent_team':
      for (const [i, [mx, my]] of [[3, 6], [10, 3], [17, 7], [24, 4], [13, 9]].entries()) {
        mini(ctx, x + mx!, y + my!, (frame + i) % 2, c(PALETTE.green));
      }
      break;
    case 'ralph_loop':
      px(ctx, x + 4, y + 3, 12, 2, c(PALETTE.green));
      px(ctx, x + 4, y + 15, 12, 2, c(PALETTE.green));
      px(ctx, x + 3, y + 4, 2, 12, c(PALETTE.green));
      px(ctx, x + 15, y + 4, 2, 12, c(PALETTE.green));
      px(ctx, x + 9 + (frame % 2), y + 8, 3, 4, c(PALETTE.green2));
      break;
    case 'rsi':
    default:
      px(ctx, x + 6, y + 6, 10, 10, c(PALETTE.purple));
      px(ctx, x + 8, y + 8, 6, 6, c('#c4a5ef'));
      px(ctx, x + 10, y + 10, 2, 2, c(PALETTE.white));
      px(ctx, x + 2 + frame, y + 10, 1, 1, c(PALETTE.white));
      break;
  }
}

// ---------------------------------------------------------------------------
// Props and pickups
// ---------------------------------------------------------------------------

const TOKEN_RIMS = ['#8fe68a', PALETTE.green, '#2f8f3a', '#1f5a2a'];
const TOKEN_FILLS = ['#2a8a37', '#1f6a2c', '#153f1f', '#0f2a16'];
const BOOK_COLORS = ['#2f5f92', '#5d3f8a', '#8a6a2a', '#7a2e31', '#3c434e'];

function token(ctx: Ctx, size: number, level: number, x: number, y: number): void {
  const l = Math.max(0, Math.min(3, level));
  px(ctx, x, y, size, size, TOKEN_RIMS[l]!);
  if (size >= 5) px(ctx, x + 1, y + 1, size - 2, size - 2, TOKEN_FILLS[l]!);
  if (size >= 7) px(ctx, x + 3, y + 3, 1, 1, TOKEN_RIMS[l]!);
}

function wall(ctx: Ctx, x: number, y: number, left: boolean): void {
  const w = 64;
  const h = 164;
  px(ctx, x, y, w, h, PALETTE.bg2);
  const edge = left ? x + w - 3 : x;
  px(ctx, edge, y, 3, h, PALETTE.red);
  for (let k = 0; k < 2; k++) {
    const cy = y + Math.round(h * (k === 0 ? 0.34 : 0.66));
    for (let i = 0; i < 8; i++) {
      const cx = left ? x + 20 + i : x + w - 23 - i;
      px(ctx, cx, cy - 8 + i, 2, 1, PALETTE.red);
      px(ctx, cx, cy + 8 - i, 2, 1, PALETTE.red);
    }
  }
}

function pickup(ctx: Ctx, shape: string, accent: string, x: number, y: number): void {
  const col = (PALETTE as Record<string, string>)[accent] ?? PALETTE.amber;
  switch (shape) {
    case 'token':
      px(ctx, x + 1, y + 1, 10, 10, col);
      px(ctx, x + 3, y + 3, 6, 6, PALETTE.bg0);
      px(ctx, x + 4, y + 4, 4, 4, col);
      break;
    case 'chip':
      px(ctx, x + 2, y + 2, 10, 8, col);
      px(ctx, x + 4, y + 4, 6, 4, PALETTE.bg0);
      break;
    case 'bubble':
      px(ctx, x + 1, y + 1, 12, 7, col);
      px(ctx, x + 3, y + 8, 2, 3, col);
      px(ctx, x + 3, y + 4, 7, 1, PALETTE.bg3);
      break;
    case 'duck':
      px(ctx, x + 1, y + 5, 10, 5, col);
      px(ctx, x + 6, y + 1, 5, 5, col);
      px(ctx, x + 11, y + 3, 2, 2, '#e07b39');
      break;
    case 'book':
      px(ctx, x + 1, y + 1, 9, 12, col);
      px(ctx, x + 10, y + 2, 1, 10, PALETTE.fg0);
      break;
    case 'bug':
      px(ctx, x + 3, y + 3, 8, 7, col);
      px(ctx, x + 1, y + 5, 12, 1, PALETTE.fg2);
      px(ctx, x + 5, y + 1, 4, 2, PALETTE.bg3);
      break;
    case 'thumb':
      px(ctx, x + 5, y + 1, 3, 5, col);
      px(ctx, x + 3, y + 5, 7, 7, col);
      break;
    case 'star':
      px(ctx, x + 7, y + 1, 1, 13, col);
      px(ctx, x + 1, y + 7, 13, 1, col);
      px(ctx, x + 6, y + 5, 3, 5, col);
      break;
    case 'mini_agent':
    default:
      mini(ctx, x + 4, y + 3, 0, col);
      break;
  }
}

function glare(ctx: Ctx, x: number, y: number): void {
  for (let i = 0; i < 40; i++) {
    px(ctx, x + 40 + i * 2 - i * 2 + i, y + 60 - i, 2, 1, PALETTE.fg1);
    if (i < 28) px(ctx, x + 95 - i, y + i + 2 - 2 * i + 30, 1, 1, PALETTE.fg0);
  }
}

function crack(ctx: Ctx, x: number, y: number): void {
  const cx = x + 64;
  const cy = y + 58;
  for (let r = 0; r < 9; r++) {
    const ang = (r / 9) * Math.PI * 2 + 0.3;
    for (let s = 2; s < 40; s += 2) {
      px(ctx, cx + Math.cos(ang + s * 0.01) * s, cy + Math.sin(ang) * s, 2, 1, r % 2 ? PALETTE.white : '#9fd0ff');
    }
  }
  px(ctx, cx - 2, cy - 2, 5, 5, '#cfe8ff');
}

function scroll(ctx: Ctx, x: number, y: number): void {
  px(ctx, x + 1, y + 1, 36, 11, PALETTE.bg0);
  px(ctx, x + 4, y + 2, 30, 9, PALETTE.fg0);
  px(ctx, x + 1, y + 1, 4, 11, PALETTE.fg1);
  px(ctx, x + 33, y + 1, 4, 11, PALETTE.fg1);
  drawText(ctx, 'SUMMARY', x + 5, y + 4, PALETTE.bg0, { cache: false });
  ops++;
}

/** True when a procedural stand-in exists for `key`. */
export function hasFallback(key: string): boolean {
  return (
    key in ROOM_SCENES ||
    key.startsWith('human_') ||
    key.startsWith('agent_') ||
    key.startsWith('gadget_') ||
    key.startsWith('pk_') ||
    ['token', 'token_small', 'token_tilt', 'manual', 'wall_left', 'wall_right', 'scroll_summary', 'glass_glare', 'glass_crack'].includes(key)
  );
}

/**
 * Paint the stand-in for `key`. Unknown keys get an obviously-wrong purple box,
 * so a typo is loud rather than invisible, and never a crash.
 */
export function drawFallbackSprite(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: number,
  timeS: number,
  extra: number,
): void {
  void timeS;
  void extra;
  const scene = ROOM_SCENES[key];
  if (scene) return room(ctx, scene, x, y);
  if (key === 'human_body') return humanBody(ctx, x, y);
  if (key.startsWith('human_eyes_')) return humanEyes(ctx, key.slice('human_eyes_'.length), frame, x, y);
  if (key === 'human_mug') return humanMug(ctx, frame, x, y);
  if (key === 'human_typing') return humanTyping(ctx, frame, x, y);
  if (key === 'human_chair') return humanChair(ctx, x, y);
  if (key === 'agent_mini') return mini(ctx, x + 4, y + 3, frame);
  if (key === 'agent_team') return gadget(ctx, 'agent_team', frame, x, y, false);
  if (key.startsWith('agent_')) return agent(ctx, key, frame, x, y);
  if (key.startsWith('gadget_')) {
    const off = key.endsWith('_off');
    const tool = key.slice('gadget_'.length, off ? -'_off'.length : undefined);
    return gadget(ctx, tool, frame, x, y, off);
  }
  if (key.startsWith('pk_')) {
    const rest = key.slice(3);
    const cut = rest.lastIndexOf('_');
    return pickup(ctx, rest.slice(0, cut), rest.slice(cut + 1), x, y);
  }
  switch (key) {
    case 'token':
    case 'token_tilt':
      return token(ctx, 7, frame, x, y);
    case 'token_small':
      return token(ctx, 5, frame, x, y);
    case 'manual':
      px(ctx, x, y, Math.max(8, w), 5, BOOK_COLORS[Math.abs(frame) % BOOK_COLORS.length]!);
      px(ctx, x + Math.max(8, w) - 5, y + 1, 4, 3, PALETTE.fg0);
      return;
    case 'wall_left':
      return wall(ctx, x, y, true);
    case 'wall_right':
      return wall(ctx, x, y, false);
    case 'scroll_summary':
      return scroll(ctx, x, y);
    case 'glass_glare':
      return glare(ctx, x, y);
    case 'glass_crack':
      return crack(ctx, x, y);
    default:
      px(ctx, x, y, Math.max(4, w), Math.max(4, h), PALETTE.purple);
      px(ctx, x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2), PALETTE.bg0);
  }
}
