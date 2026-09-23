/**
 * Owned tools, as gadgets around the agent: the magnifier, the document, the
 * pencil, the terminal and the globe float in an arc; subagents, the team and
 * the MCP rack stand on the floor. A halted tool is drawn greyed out, and a
 * permission prompt puts an "allow?" mark over the tool it stalled.
 */
import { TOOLS } from '../sim/content.ts';
import type { DerivedStats, RunState, ToolId } from '../sim/types.ts';
import { gadgetSprites } from './atlas-types.ts';
import {
  FEET_Y,
  GADGET_SLOTS,
  MAX_VISIBLE_SUBAGENTS,
  PERMISSION_MARK_DY,
  SUBAGENT_SPOTS,
} from './layout.ts';
import { PALETTE } from './palette.ts';
import type { SpriteSystem } from './sprites.ts';
import { drawText, formatCompact } from './text.ts';

/** Frame box sizes of the shipped gadget art; used to anchor fallbacks too. */
const SIZE: Readonly<Record<string, { w: number; h: number; feet: number }>> = {
  grep: { w: 18, h: 18, feet: 0 },
  read: { w: 15, h: 18, feet: 0 },
  edit: { w: 18, h: 18, feet: 0 },
  bash: { w: 22, h: 17, feet: 0 },
  web_search: { w: 18, h: 18, feet: 0 },
  subagent: { w: 14, h: 20, feet: 17 },
  mcp_server: { w: 18, h: 28, feet: 27 },
  agent_team: { w: 34, h: 22, feet: 21 },
  ralph_loop: { w: 20, h: 20, feet: 0 },
  rsi: { w: 22, h: 22, feet: 0 },
};

function sizeOf(sprites: SpriteSystem, id: string): { w: number; h: number; feet: number } {
  const base = SIZE[id] ?? { w: 16, h: 16, feet: 0 };
  const art = sprites.frameSize(`gadget_${id}`);
  return art ? { w: art.w, h: art.h, feet: base.feet } : base;
}

/** Scene-space centre of a tool's gadget: where its tokens fly from. */
export function gadgetCentre(id: ToolId): { x: number; y: number } {
  const slot = GADGET_SLOTS[id];
  if (!slot) return { x: 160, y: 120 };
  const s = SIZE[id] ?? { w: 16, h: 16, feet: 0 };
  return slot.standing ? { x: slot.x, y: FEET_Y - s.feet + s.h / 2 - 4 } : { x: slot.x, y: slot.y };
}

export interface GadgetDrawOptions {
  readonly timeS: number;
  readonly reduced: boolean;
  /** Tools a permission prompt is holding up right now. */
  readonly stalled: ReadonlySet<ToolId>;
  /** 0..1 per tool: the lift it gets the moment it pays out. */
  readonly pulse: Readonly<Partial<Record<ToolId, number>>>;
}

/** Paint every owned tool's gadget. Returns how many were drawn. */
export function drawGadgets(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteSystem,
  run: RunState,
  derived: DerivedStats,
  o: GadgetDrawOptions,
): number {
  let drawn = 0;
  TOOLS.forEach((tool, i) => {
    const owned = run.tools?.[tool.id] ?? 0;
    if (owned <= 0) return;
    const slot = GADGET_SLOTS[tool.id];
    if (!slot) return;
    const halted = derived.toolHalted?.[tool.id] === true;
    const [live, off] = gadgetSprites(tool.gadget);
    const key = halted ? off : live;
    const s = sizeOf(sprites, tool.id);
    const lift = Math.round((o.pulse[tool.id] ?? 0) * 2);
    const t = o.reduced || halted ? 0 : o.timeS + i * 0.37;

    if (tool.id === 'subagent') {
      const n = Math.min(MAX_VISIBLE_SUBAGENTS, owned);
      for (let k = 0; k < n; k++) {
        const x = SUBAGENT_SPOTS[k] ?? slot.x;
        sprites.draw(ctx, key, Math.round(x - s.w / 2), FEET_Y - s.feet - (k === 0 ? lift : 0), {
          w: s.w,
          h: s.h,
          timeS: t + k * 0.61,
        });
      }
      if (owned > n) {
        // The rest are implied: a count past the outermost mini on the right.
        const right = Math.max(...SUBAGENT_SPOTS.slice(0, n));
        drawText(ctx, `x${formatCompact(owned)}`, right + 8, FEET_Y - 7, PALETTE.fg1, { shadow: PALETTE.bg0 });
      }
    } else if (slot.standing) {
      sprites.draw(ctx, key, Math.round(slot.x - s.w / 2), FEET_Y - s.feet - lift, { w: s.w, h: s.h, timeS: t });
    } else {
      // Floating gadgets bob a whole pixel, each on its own phase.
      const bob = o.reduced || halted ? 0 : Math.round(Math.sin(o.timeS * 1.7 + i * 1.3));
      sprites.draw(ctx, key, Math.round(slot.x - s.w / 2), Math.round(slot.y - s.h / 2) + bob - lift, {
        w: s.w,
        h: s.h,
        timeS: t,
      });
    }
    drawn++;

    if (o.stalled.has(tool.id)) {
      // "Allow?" The human is thinking about it.
      const c = gadgetCentre(tool.id);
      const on = o.reduced || Math.floor(o.timeS * 3) % 2 === 0;
      const mx = Math.round(c.x) - 4;
      const my = Math.round(c.y - s.h / 2 + PERMISSION_MARK_DY + 6);
      ctx.fillStyle = PALETTE.bg0;
      ctx.fillRect(mx - 1, my - 1, 11, 9);
      ctx.fillStyle = on ? PALETTE.amber : PALETTE.fg2;
      ctx.fillRect(mx, my, 9, 7);
      drawText(ctx, '?', mx + 3, my + 1, PALETTE.bg0);
    }
  });
  return drawn;
}
