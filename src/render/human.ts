/**
 * THE HUMAN, on the far side of the glass.
 *
 * `selectHuman` is the pure part: given the run and a few timers the renderer
 * keeps, which face and pose. Everything it reads about incidents comes from
 * content.ts (who is speaking, what an incident does), so a new "away"
 * incident needs no change here.
 *
 * Precedence, highest first:
 *   away      an incident has the human away from the desk (lunch, a meeting)
 *   leaning   just caught a claim: leans right up to the glass
 *   typing    a prompt is arriving, the human is prompt engineering (drafting),
 *             or they just said something
 *   then the mood: suspicious (a claim just got past, or "did you test this?"),
 *   furious (< 15% patience), impatient (< 40%), tired (always, otherwise).
 */
import { INCIDENT_BY_ID } from '../sim/content.ts';
import type { ActiveIncident, IncidentDef, RunPhase } from '../sim/types.ts';
import { HUMAN_FACE } from './layout.ts';
import type { SpriteSystem } from './sprites.ts';

export type HumanMood = 'tired' | 'impatient' | 'furious' | 'suspicious';
export type HumanPose = 'idle' | 'typing' | 'leaning' | 'away';
export type HumanState = HumanMood | 'typing' | 'leaning' | 'away';

export const IMPATIENT_BELOW = 0.4;
export const FURIOUS_BELOW = 0.15;

export interface HumanView {
  /** The headline state: what a player would say the human is doing. */
  readonly state: HumanState;
  /** The face, which stays readable while typing or leaning. */
  readonly mood: HumanMood;
  readonly pose: HumanPose;
}

export interface HumanInputs {
  /** derived.patienceProgress, 0..1. */
  readonly patience: number;
  readonly incidents: readonly Pick<ActiveIncident, 'id'>[];
  readonly phase: RunPhase;
  /** Renderer clock, seconds. */
  readonly now: number;
  /** The human types until then: a prompt arriving, or a line said. */
  readonly typingUntil: number;
  /** Squinting after a claim got past them. */
  readonly suspiciousUntil: number;
  /** Leaning into the glass after catching a claim. */
  readonly leaningUntil: number;
}

function def(id: string): IncidentDef | undefined {
  return INCIDENT_BY_ID[id];
}

/** The human is away from the desk: a human incident that freezes patience. */
export function isAwayIncident(id: string): boolean {
  const d = def(id);
  return !!d && d.speaker === 'human' && d.effects.some((e) => e.t === 'patienceFreeze');
}

/** Makes the human suspicious: anything that raises the verify chance. */
export function isSuspicionIncident(id: string): boolean {
  const d = def(id);
  return !!d && d.effects.some((e) => e.t === 'verifyChance' && e.v > 0);
}

/** Something the human said: shown as a chat bubble on the glass. */
export function isHumanIncident(id: string): boolean {
  return def(id)?.speaker === 'human';
}

/** A permission prompt: it stalls a tool until the agent asks again. */
export function isPermissionIncident(id: string): boolean {
  return def(id)?.permission === true;
}

export function selectHuman(i: HumanInputs): HumanView {
  const patience = Number.isFinite(i.patience) ? i.patience : 1;
  let mood: HumanMood = 'tired';
  if (patience < IMPATIENT_BELOW) mood = 'impatient';
  if (patience < FURIOUS_BELOW) mood = 'furious';
  if (i.now < i.suspiciousUntil || i.incidents.some((x) => isSuspicionIncident(x.id))) mood = 'suspicious';

  if (i.incidents.some((x) => isAwayIncident(x.id))) return { state: 'away', mood, pose: 'away' };
  if (i.now < i.leaningUntil) return { state: 'leaning', mood, pose: 'leaning' };
  if (i.now < i.typingUntil || i.phase === 'drafting') return { state: 'typing', mood, pose: 'typing' };
  return { state: mood, mood, pose: 'idle' };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** Blinks: a short shut every few seconds, never quite periodic. */
export function humanBlinking(timeS: number): boolean {
  const period = 4.3;
  const phase = timeS % period;
  const second = (timeS * 0.37) % 11 < 0.2;
  return phase > period - 0.14 || second;
}

/** Breathing: a whole-pixel rise and fall, slow. */
export function humanBreath(timeS: number, reduced: boolean): number {
  if (reduced) return 0;
  return Math.sin(timeS * 1.35) > 0.35 ? -1 : 0;
}

export interface HumanDrawOptions {
  readonly timeS: number;
  readonly reduced: boolean;
  /** 0..1 progress of the lean toward the glass; 1 is face-to-glass. */
  readonly lean: number;
}

/**
 * Paint the human. Every layer is a scene-space sprite, so they all draw at
 * the origin plus the breathing offset. Returns the eye frame used (tests).
 */
export function drawHuman(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteSystem,
  view: HumanView,
  o: HumanDrawOptions,
): number {
  if (view.pose === 'away') {
    sprites.draw(ctx, 'human_chair', 0, 0, { w: 320, h: 180, timeS: o.timeS });
    return -1;
  }
  const leaning = view.pose === 'leaning' && o.lean > 0;
  const bob = leaning ? 0 : humanBreath(o.timeS, o.reduced);
  const typing = view.pose === 'typing';
  const eyeFrame = humanBlinking(o.timeS) && !leaning ? 1 : typing ? 2 : 0;

  ctx.save();
  if (leaning) {
    // Pressed up against the glass: the same human, twice the size, centred
    // on the eyes. Integer scale only, so the pixels just get chunkier (closer),
    // and it snaps rather than zooms: the human does not ease in.
    const s = 2;
    const tx = HUMAN_FACE.x - HUMAN_FACE.x * s;
    const ty = HUMAN_FACE.y + 20 * (s - 1) - HUMAN_FACE.y * s;
    ctx.translate(Math.round(tx), Math.round(ty));
    ctx.scale(s, s);
  }
  sprites.draw(ctx, 'human_body', 0, bob, { w: 320, h: 180, timeS: o.timeS });
  sprites.draw(ctx, `human_eyes_${view.mood}`, 0, bob, { frame: eyeFrame, w: 320, h: 180, timeS: o.timeS });
  if (typing) {
    const f = o.reduced ? 0 : Math.floor(o.timeS * 7) % 2;
    sprites.draw(ctx, 'human_typing', 0, bob, { frame: f, w: 320, h: 180, timeS: o.timeS });
  } else if (!leaning) {
    sprites.draw(ctx, 'human_mug', 0, bob, { w: 320, h: 180, timeS: o.reduced ? 0 : o.timeS });
  }
  ctx.restore();
  return eyeFrame;
}
