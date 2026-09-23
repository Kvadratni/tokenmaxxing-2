/**
 * THE AGENT: the cursor block, centre stage, and the thing you click.
 *
 * `selectAgent` picks the state; `drawAgent` paints it with the click bounce
 * on top. Precedence, highest first:
 *   dazed     just compacted (or compacting right now): pixels missing
 *   grovel    just said "You're absolutely right!"
 *   panic     context over 90%, or just got caught lying
 *   waiting   a permission prompt has one of its tools stalled
 *   sweating  a claim is possible (the report button reads CLAIM DONE)
 *   idle      blinking, bouncing when clicked
 */
import type { ActiveIncident, ReportState, RunPhase } from '../sim/types.ts';
import { isPermissionIncident } from './human.ts';
import { AGENT_HANDS, AGENT_ORIGIN } from './layout.ts';
import { AGENT_BOX } from './atlas-types.ts';
import { PALETTE } from './palette.ts';
import type { SpriteSystem } from './sprites.ts';

export type AgentState = 'idle' | 'panic' | 'sweating' | 'dazed' | 'waiting' | 'grovel';

export const PANIC_ABOVE = 0.9;

export interface AgentInputs {
  /** derived.contextFill, 0..1. */
  readonly fill: number;
  readonly reportState: ReportState;
  readonly incidents: readonly Pick<ActiveIncident, 'id'>[];
  readonly phase: RunPhase;
  /** run.compactingMs: a manual /compact is still running. */
  readonly compactingMs: number;
  readonly now: number;
  readonly dazedUntil: number;
  readonly grovelUntil: number;
  readonly panicUntil: number;
}

export function selectAgent(i: AgentInputs): AgentState {
  if (i.now < i.dazedUntil || i.compactingMs > 0 || i.phase === 'compacting') return 'dazed';
  if (i.now < i.grovelUntil) return 'grovel';
  if (i.fill > PANIC_ABOVE || i.now < i.panicUntil) return 'panic';
  if (i.incidents.some((x) => isPermissionIncident(x.id))) return 'waiting';
  if (i.reportState === 'claim') return 'sweating';
  return 'idle';
}

const SPRITE: Readonly<Record<AgentState, string>> = {
  idle: 'agent_idle',
  panic: 'agent_panic',
  sweating: 'agent_sweat',
  dazed: 'agent_dazed',
  waiting: 'agent_wait',
  grovel: 'agent_grovel',
};

export function agentSprite(state: AgentState): string {
  return SPRITE[state];
}

/** Blink: shut for a beat every ~3 s, out of step with the human's. */
export function agentBlinking(timeS: number): boolean {
  return timeS % 3.1 > 2.97;
}

/** Seconds a click bounce lasts: squash, stretch, settle. */
export const BOUNCE_S = 0.2;

/**
 * The bounce, as (squash frame or -1, vertical hop in px) at `since` seconds
 * after a click. Squash frames only apply in the idle pose; every other pose
 * just hops.
 */
export function bounceAt(since: number, reduced: boolean): { squash: number; hop: number } {
  if (!(since >= 0) || since >= BOUNCE_S) return { squash: -1, hop: 0 };
  if (reduced) return { squash: since < 0.08 ? 0 : -1, hop: 0 };
  if (since < 0.06) return { squash: 0, hop: 0 };
  if (since < 0.13) return { squash: 1, hop: -2 };
  return { squash: -1, hop: -1 };
}

export interface AgentDrawOptions {
  readonly timeS: number;
  readonly reduced: boolean;
  /** Seconds since the last click, or a big number. */
  readonly sinceClick: number;
}

/** Paint the agent in its state. Returns the sprite key drawn (tests read it). */
export function drawAgent(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteSystem,
  state: AgentState,
  o: AgentDrawOptions,
): string {
  const b = bounceAt(o.sinceClick, o.reduced);
  let key = SPRITE[state];
  let frame: number | undefined;
  if (state === 'idle') {
    if (b.squash >= 0) {
      key = 'agent_squash';
      frame = b.squash;
    } else {
      frame = agentBlinking(o.timeS) ? 1 : 0;
    }
  }
  const x = AGENT_ORIGIN.x;
  const y = AGENT_ORIGIN.y + b.hop;
  sprites.draw(ctx, key, x, y, { frame, timeS: o.reduced ? 0 : o.timeS, w: AGENT_BOX.w, h: AGENT_BOX.h });

  if (state === 'panic' && !o.reduced) {
    // Extra glitch pixels, re-rolled a few times a second: the block is
    // coming apart at 90% context.
    const step = Math.floor(o.timeS * 9);
    ctx.fillStyle = step % 2 ? PALETTE.red : PALETTE.amber;
    for (let i = 0; i < 4; i++) {
      const hx = hash(step * 7 + i * 13);
      const hy = hash(step * 11 + i * 5);
      ctx.fillRect(Math.round(x + 2 + hx * (AGENT_BOX.w - 4)), Math.round(y + 4 + hy * 36), 1 + (i % 2), 1);
    }
  }
  if (state === 'dazed') {
    // It is holding what is left of its memory.
    sprites.draw(ctx, 'scroll_summary', AGENT_HANDS.x - 19, AGENT_HANDS.y - 6, { w: 38, h: 13 });
  }
  return key;
}

function hash(n: number): number {
  const s = Math.sin(n * 91.3 + 7.1) * 24634.6345;
  return s - Math.floor(s);
}
