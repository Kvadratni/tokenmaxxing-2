/**
 * Tool gadgets: what each owned tool looks like floating around the agent.
 *
 * Keys are exactly `ToolDef.gadget` (`gadget_<id>`), enumerated from
 * content.ts by build-art.mjs, plus a greyed `gadget_<id>_off` for when an
 * incident halts the tool. Same outline-and-flat-light language as the icons,
 * a size up.
 */
import { Canvas, PAL, bayer, glowHalo, mix } from './pixel.mjs';
import { buildAgent } from './agent.mjs';

const OUT = PAL.bg0;

/** A small canvas with a 1px dark outline added around whatever `draw` paints. */
function outlined(w, h, draw) {
  const shape = new Canvas(w, h);
  draw(shape);
  const cv = shape.clone();
  cv.outline(OUT, 255, false);
  cv.blit(shape, 0, 0);
  return cv;
}

function grep() {
  return outlined(18, 18, (cv) => {
    // Handle down to the lower left.
    for (let i = 0; i < 6; i += 1) {
      cv.rect(2 + i, 14 - i, 2, 2, i < 2 ? PAL.fg2 : PAL.blue);
    }
    // Lens ring.
    cv.disc(11, 7, 5.4, PAL.fg1);
    cv.disc(11, 7, 3.9, '#12304f');
    cv.disc(11, 7, 3, '#1b4a78');
    cv.put(9, 5, PAL.white);
    cv.put(10, 4, PAL.white);
    cv.put(9, 6, '#9fd0ff');
    cv.put(13, 10, PAL.fg0);
    cv.put(15, 7, PAL.fg2);
    cv.put(14, 9, PAL.fg2);
  });
}

function read() {
  return outlined(15, 18, (cv) => {
    cv.rect(1, 1, 12, 16, PAL.fg0);
    cv.rect(10, 1, 3, 3, PAL.fg2);
    cv.put(10, 1, PAL.fg1);
    cv.put(12, 3, PAL.fg1);
    cv.put(11, 1, [0, 0, 0, 0]);
    cv.put(12, 1, [0, 0, 0, 0]);
    cv.put(12, 2, [0, 0, 0, 0]);
    for (let r = 0; r < 6; r += 1) {
      const len = [7, 9, 6, 9, 8, 5][r];
      cv.hline(3, 3 + len - 1, 5 + r * 2, r === 0 ? PAL.fg2 : PAL.line);
    }
    cv.vline(1, 1, 16, PAL.white);
  });
}

function editFrame(frame) {
  return outlined(18, 18, (cv) => {
    // Pencil, tip at the lower left, eraser at the upper right.
    for (let i = 0; i < 10; i += 1) {
      const x = 4 + i;
      const y = 12 - i;
      cv.put(x, y, PAL.amber);
      cv.put(x + 1, y, PAL.amber);
      cv.put(x, y + 1, mix(PAL.amber, PAL.bg0, 0.35));
      cv.put(x + 1, y - 1, '#f5d27a');
    }
    // Ferrule and eraser.
    cv.put(13, 3, PAL.fg1);
    cv.put(14, 2, PAL.fg1);
    cv.put(14, 3, PAL.fg2);
    cv.put(15, 1, PAL.red);
    cv.put(16, 1, PAL.red);
    cv.put(15, 2, PAL.red);
    cv.put(16, 0, '#f08a8a');
    // Sharpened wood and graphite.
    cv.put(3, 13, '#c9a27a');
    cv.put(4, 13, '#c9a27a');
    cv.put(3, 12, '#c9a27a');
    cv.put(2, 14, PAL.bg3);
    // The line it is writing, one frame longer.
    const len = frame === 0 ? 3 : 6;
    for (let i = 0; i < len; i += 1) cv.put(2 + i, 16, PAL.green);
  });
}

function bashFrame(frame) {
  return outlined(22, 17, (cv) => {
    cv.rect(1, 1, 20, 13, PAL.bg3);
    cv.hline(1, 20, 1, PAL.line);
    cv.rect(3, 3, 16, 9, '#0a0d10');
    // >_
    cv.put(5, 5, PAL.green);
    cv.put(6, 6, PAL.green);
    cv.put(7, 7, PAL.green);
    cv.put(6, 8, PAL.green);
    cv.put(5, 9, PAL.green);
    if (frame === 0) cv.hline(9, 12, 9, PAL.green);
    cv.hline(9, 11, 5, PAL.green2);
    // Stand.
    cv.rect(8, 14, 6, 2, PAL.line);
    cv.put(19, 12, PAL.green);
  });
}

function globeFrame(frame) {
  const cv = new Canvas(18, 18);
  const cx = 9;
  const cy = 9;
  const r = 6.6;
  // Continents: a fixed noise field scrolled one step per frame.
  const land = (u, v) => {
    const a = Math.sin(u * 0.9 + 1.3) + Math.sin(v * 1.3 + u * 0.4) + Math.sin((u + v) * 0.7);
    return a > 0.9;
  };
  for (let y = 0; y < 18; y += 1) {
    for (let x = 0; x < 18; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const u = dx + frame * 2.2;
      let color = PAL.blue;
      if (land(u, dy)) color = PAL.green2;
      if (d > r - 1.5 && dx > 0) color = mix(color, PAL.bg0, 0.45);
      if (dx < -2 && dy < -2 && d < r - 1 && bayer(x, y, 4) < 0.25) color = mix(color, PAL.white, 0.4);
      cv.put(x, y, color);
    }
  }
  // A meridian and the equator.
  for (let y = 3; y <= 15; y += 1) if (cv.alphaAt(cx, y)) cv.put(cx, y, mix(cv.get(cx, y), PAL.white, 0.25));
  for (let x = 3; x <= 15; x += 1) if (cv.alphaAt(x, cy)) cv.put(x, cy, mix(cv.get(x, cy), PAL.white, 0.2));
  const out = cv.clone();
  out.outline(OUT, 255, false);
  out.blit(cv, 0, 0);
  out.put(5, 5, PAL.white);
  return out;
}

function rackFrame(frame) {
  return outlined(18, 28, (cv) => {
    cv.rect(1, 1, 16, 26, PAL.bg2);
    cv.hline(1, 16, 1, PAL.line);
    cv.vline(1, 1, 26, PAL.line);
    for (let u = 0; u < 5; u += 1) {
      const y = 3 + u * 5;
      cv.rect(3, y, 12, 4, PAL.bg1);
      cv.hline(3, 14, y, PAL.bg3);
      cv.hline(5, 9, y + 2, PAL.fg2);
      const on = (u + frame) % 2 === 0;
      cv.put(13, y + 2, on ? PAL.green : PAL.green2);
      cv.put(11, y + 2, (u * 3 + frame) % 4 === 0 ? PAL.amber : PAL.bg3);
    }
    // A manual left on top, because it ships with nine thousand tokens of them.
    cv.rect(3, 0, 9, 2, PAL.purple);
    cv.hline(3, 11, 0, '#c4a5ef');
  });
}

function loopFrame(frame) {
  const cv = new Canvas(20, 20);
  const cx = 10;
  const cy = 10;
  const gapAt = frame * (Math.PI / 2);
  for (let a = 0; a < 64; a += 1) {
    const ang = (a / 64) * Math.PI * 2;
    let rel = ang - gapAt;
    rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (rel < 0.55) continue;
    for (const rr of [6, 7]) {
      const x = Math.round(cx + Math.cos(ang) * rr);
      const y = Math.round(cy + Math.sin(ang) * rr);
      cv.put(x, y, rr === 7 ? PAL.green : PAL.green2);
    }
  }
  // The arrowhead, just ahead of the gap.
  const head = gapAt + 0.55;
  const hx = cx + Math.cos(head) * 6.5;
  const hy = cy + Math.sin(head) * 6.5;
  const tx = -Math.sin(head);
  const ty = Math.cos(head);
  for (let k = -2; k <= 2; k += 1) {
    const px = Math.round(hx + Math.cos(head) * k * 0.9 - tx * (2 - Math.abs(k)) * 0.8);
    const py = Math.round(hy + Math.sin(head) * k * 0.9 - ty * (2 - Math.abs(k)) * 0.8);
    cv.put(px, py, PAL.green);
  }
  // Ralph, very small, in the middle, going round.
  cv.rect(9, 8, 3, 4, PAL.green);
  cv.put(9, 9, PAL.white);
  cv.put(11, 9, PAL.white);
  const out = cv.clone();
  out.outline(OUT, 255, false);
  out.blit(cv, 0, 0);
  return out;
}

function coreFrame(frame) {
  const cv = new Canvas(22, 22);
  const cx = 11;
  const cy = 11;
  const pulse = [0, 1, 0.5][frame];
  cv.disc(cx, cy, 5.2 + pulse * 0.6, PAL.purple);
  cv.disc(cx, cy, 3.4, '#c4a5ef');
  cv.disc(cx, cy, 1.6, PAL.white);
  // Two rings of orbiting bits.
  for (let i = 0; i < 3; i += 1) {
    const ang = frame * 0.9 + (i / 3) * Math.PI * 2;
    cv.put(Math.round(cx + Math.cos(ang) * 8.5), Math.round(cy + Math.sin(ang) * 4), PAL.white);
    cv.put(Math.round(cx + Math.cos(-ang * 1.3) * 5), Math.round(cy + Math.sin(-ang * 1.3) * 8.5), '#c4a5ef');
  }
  const out = cv.clone();
  glowHalo(out, mix(PAL.purple, PAL.bg0, 0.3), 3, 0.35 + pulse * 0.15);
  out.blit(cv, 0, 0);
  return out;
}

/** Desaturate to the dark greys, keeping the silhouette and its detail. */
export function greyOut(src) {
  const levels = [PAL.bg1, PAL.bg3, PAL.line, PAL.fg2, PAL.fg1];
  const out = new Canvas(src.w, src.h);
  for (let y = 0; y < src.h; y += 1) {
    for (let x = 0; x < src.w; x += 1) {
      const [r, g, b, a] = src.get(x, y);
      if (a === 0) continue;
      const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
      const idx = Math.min(levels.length - 1, Math.floor(lum * levels.length * 0.95));
      out.put(x, y, levels[idx]);
    }
  }
  return out;
}

/** `gadget_<tool id>` -> { frames, fps } for every tool, plus the `_off` variants. */
export function buildGadgets(toolIds) {
  const agent = buildAgent();
  const makers = {
    grep: () => ({ frames: [grep()] }),
    read: () => ({ frames: [read()] }),
    edit: () => ({ frames: [editFrame(0), editFrame(1)], fps: 3 }),
    bash: () => ({ frames: [bashFrame(0), bashFrame(1)], fps: 2 }),
    web_search: () => ({ frames: [0, 1, 2, 3].map(globeFrame), fps: 4 }),
    subagent: () => ({ frames: agent.agent_mini.frames, fps: agent.agent_mini.fps }),
    mcp_server: () => ({ frames: [rackFrame(0), rackFrame(1)], fps: 2 }),
    agent_team: () => ({ frames: agent.agent_team.frames, fps: agent.agent_team.fps }),
    ralph_loop: () => ({ frames: [0, 1, 2, 3].map(loopFrame), fps: 8 }),
    rsi: () => ({ frames: [0, 1, 2].map(coreFrame), fps: 4 }),
  };
  const out = {};
  for (const id of toolIds) {
    const make = makers[id];
    if (!make) throw new Error(`gadgets.mjs has no gadget for tool ${id}`);
    const g = make();
    out[`gadget_${id}`] = g;
    out[`gadget_${id}_off`] = { frames: [greyOut(g.frames[0])] };
  }
  return out;
}
