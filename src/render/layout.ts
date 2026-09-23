/**
 * Fixed geometry of the 320x180 stage: the inside of the laptop screen, seen
 * from the agent's side. Back to front: the glass (and the human's room
 * through it), the bezel floor the agent stands on, and the prompt line.
 */
import { SCENE_HEIGHT, SCENE_WIDTH } from '../sim/types.ts';
import { AGENT_BOX, AGENT_FEET } from './atlas-types.ts';

export const W = SCENE_WIDTH;
export const H = SCENE_HEIGHT;

/** The screen glass: the back wall. The room and the human are behind it. */
export const GLASS = { x: 6, y: 4, w: 308, h: 154 } as const;
/** Top of the bezel floor, and the base of the token pile. */
export const FLOOR_Y = GLASS.y + GLASS.h;
/** Where the agent's (and every standing gadget's) feet land. */
export const FEET_Y = FLOOR_Y + 5;
/** The prompt line along the bottom: "> fix the typo in the readme". */
export const BAND = { x: 0, y: 168, w: W, h: 12 } as const;
/** The token pile at 100% context reaches exactly the top of the glass. */
export const PILE_MAX_H = FLOOR_Y - GLASS.y;

/** The agent stands centre stage. */
export const AGENT_X = 160;
/** Top-left of the agent's sprite box. */
export const AGENT_ORIGIN = { x: AGENT_X - AGENT_FEET.x, y: FEET_Y - AGENT_FEET.y } as const;
/** Where the agent's hands are, for things it holds (the SUMMARY scroll). */
export const AGENT_HANDS = { x: AGENT_X, y: AGENT_ORIGIN.y + AGENT_BOX.h - 22 } as const;
/** Where click tokens leave from: the agent's middle. */
export const AGENT_CORE = { x: AGENT_X, y: AGENT_ORIGIN.y + 24 } as const;

/** The human's face in scene space (matches tools/art/human.mjs). */
export const HUMAN_FACE = { x: 160, y: 55 } as const;
/** Where a speech bubble from the human sits on the glass, and what its tail points at. */
export const BUBBLE_ANCHOR = { x: 58, y: 34, tailX: 110, tailY: 60 } as const;

/**
 * Gadget slots around the agent. Floating tools hover in an arc; subagents,
 * the team and the MCP rack stand on the floor. Coordinates are the centre of
 * the gadget; standing ones are anchored by their feet at FEET_Y.
 */
export interface GadgetSlot {
  readonly x: number;
  readonly y: number;
  readonly standing: boolean;
}

export const GADGET_SLOTS: Readonly<Record<string, GadgetSlot>> = {
  grep: { x: 116, y: 124, standing: false },
  read: { x: 99, y: 100, standing: false },
  edit: { x: 222, y: 99, standing: false },
  bash: { x: 205, y: 124, standing: false },
  web_search: { x: 124, y: 78, standing: false },
  subagent: { x: 132, y: FEET_Y, standing: true },
  mcp_server: { x: 256, y: FEET_Y, standing: true },
  agent_team: { x: 66, y: FEET_Y, standing: true },
  ralph_loop: { x: 160, y: 104, standing: false },
  rsi: { x: 197, y: 76, standing: false },
};

/** Up to this many subagents stand on the floor; more are implied. */
export const MAX_VISIBLE_SUBAGENTS = 5;
/** Floor spots for the subagent minis, nearest the agent first. */
export const SUBAGENT_SPOTS: readonly number[] = [132, 188, 118, 202, 104];

/** Where a halted tool's gadget shows the "allow?" marker, relative to its slot. */
export const PERMISSION_MARK_DY = -14;
