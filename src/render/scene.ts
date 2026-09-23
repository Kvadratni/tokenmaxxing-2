/**
 * The stage, and the public `Renderer`.
 *
 * Inside the laptop screen, from the agent's side. Back to front:
 *   1. through the glass: the human's room (game 1's scenes, dimmed);
 *   2. the human, a hooded silhouette with green-lit eyes, reacting;
 *   3. the glass: scanlines, a reflection, cracks when "wait stop";
 *   4. the agent's side: the bezel floor, the manuals, the token pile (the
 *      context bar), the gadgets for owned tools, the agent itself;
 *   5. pickups, particles, stamps, the compaction walls, the prompt line;
 *   6. full-frame effects: flashes, the glitch, the patience vignette.
 *
 * `handle()` never touches sim state: it queues, and `draw()` drains the
 * queue, so every visual change happens inside a frame. The renderer reads
 * only RenderInput and content.ts.
 */
import { BALANCE, INCIDENT_BY_ID, PICKUP_BY_ID, TOOLS, promptAt } from '../sim/content.ts';
import type { GameEvent, RenderInput, Renderer, SceneKey, ToolId } from '../sim/types.ts';
import { AGENT_RECT, pickupSprite } from './atlas-types.ts';
import type { AgentState } from './agent.ts';
import { drawAgent, selectAgent } from './agent.ts';
import type { ViewMetrics, ViewportOptions } from './canvas.ts';
import { Viewport, hitsAgent } from './canvas.ts';
import { Effects, effectsSettings } from './effects.ts';
import { drawGadgets, gadgetCentre } from './gadgets.ts';
import {
  drawBubble,
  drawCrack,
  drawFloorLights,
  drawFrame,
  drawGlassSheen,
  drawPromptLine,
  drawRoom,
  drawSideBezels,
} from './glass.ts';
import type { HumanView } from './human.ts';
import { drawHuman, isHumanIncident, isPermissionIncident, selectHuman } from './human.ts';
import { AGENT_CORE, AGENT_HANDS, AGENT_X, FLOOR_Y, GLASS, H, W } from './layout.ts';
import { PALETTE } from './palette.ts';
import {
  C_AMBER,
  C_BLUE,
  C_GREEN,
  C_PURPLE,
  C_RED,
  C_WHITE,
  PARTICLE_CAP,
  ParticleSystem,
} from './particles.ts';
import { PileLayer, drawSurfaceGlints, pileHeightAt, pileTopY } from './pile.ts';
import type { SpriteSystemOptions } from './sprites.ts';
import { SpriteSystem } from './sprites.ts';
import { consumeTextOps, drawText, formatCompact, formatContextShort, isSupported, measureText } from './text.ts';

/**
 * The stage's own lines. They are the effects DESIGN.md and the build brief
 * specify, not content (content.ts has the names and blurbs these echo).
 */
export const STAGE_TEXT = {
  crit: 'NAILED IT!',
  oneShot: 'ONE-SHOT!',
  report: 'DONE',
  lgtm: 'LGTM',
  caught: 'THE HUMAN RAN THE TESTS',
  compactForced: 'CONTEXT FULL - COMPACTING',
  compactManual: '/COMPACT',
  dropped: '(CONTENTS TOO LARGE TO INCLUDE)',
  compacted: (before: number, after: number): string =>
    `Compacted ${formatContextShort(before)} -> ${formatContextShort(after)}. Nothing important.`,
} as const;

/** What the stage is showing right now. Exposed for tests and the QA harness. */
export interface StageStats {
  human: HumanView['state'];
  humanMood: HumanView['mood'];
  agent: AgentState;
  /** The fill the pile is drawn at (it eases toward derived.contextFill). */
  pileFill: number;
  /** Scene y of the pile's peak. */
  pileTopY: number;
  compacting: boolean;
  /** The terminal line along the bottom (the whole text, typed or not). */
  promptLine: string;
  /** How many characters of it are typed out so far. */
  promptShown: number;
  stamp: 'lgtm' | 'caught' | null;
  bubble: string | null;
  crack: boolean;
}

export interface RenderStats {
  fps: number;
  /** Live particles at the end of the last frame. */
  particles: number;
  /** Sprite draw requests issued last frame (atlas blits + procedural stand-ins). */
  sprites: number;
  /** Approximate canvas draw ops last frame. */
  drawCalls: number;
  /** Sprite keys the atlas does not provide. Empty once the art lands. */
  missingSprites: string[];
  /** Atlas sheets that failed to decode. Non-empty means broken art. */
  failedSheets: string[];
  stage: StageStats;
}

/** `Renderer` plus the diagnostics the QA harness and integrator need. */
export interface SceneRenderer extends Renderer {
  renderStats(): RenderStats;
  metrics(): ViewMetrics;
  /** Resolves once the atlas (or its absence) has been determined. */
  whenReady(): Promise<void>;
}

/**
 * The contract's `{ atlasBase? }` plus test and tooling hooks. `atlasBase`
 * (from SpriteSystemOptions) re-points the sheet URLs, e.g. at '/sprites/'.
 */
export interface RendererOptions extends ViewportOptions, SpriteSystemOptions {
  /** Hard particle ceiling. Defaults to PARTICLE_CAP (1024). */
  particleCap?: number;
}

const MAX_QUEUED_EVENTS = 256;
const SCENE_FADE_S = 0.8;
const TYPE_CPS = 30;
const COMPACT_S = { slam: 0.22, hold: 0.9, open: 1.35, crushed: 0.9, text: 0.45, textHold: 4.6, banner: 1.7 };
const DAZED_S = 3.2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const easeIn = (t: number): number => t * t * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const finite = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * What a collected pickup says as it pops. Its label, unless the 3x5 font
 * cannot draw it (the 👍 and ✨ pickups), in which case its id's words.
 */
function pickupWords(id: string, label: string | undefined): string {
  const text = (label ?? '').toUpperCase();
  if (text && [...text].every((ch) => isSupported(ch))) return text;
  return id.replace(/_/g, ' ').toUpperCase();
}

/** A human incident's words for the bubble: the quote, without its quotes. */
function bubbleFor(id: string): { text: string; kind: 'speech' | 'note' } | null {
  const def = INCIDENT_BY_ID[id];
  if (!def || def.speaker !== 'human') return null;
  const quoted = /^"(.*)"$/.exec(def.name.trim());
  return quoted ? { text: quoted[1] ?? '', kind: 'speech' } : { text: def.name, kind: 'note' };
}

interface Compaction {
  t0: number;
  forced: boolean;
  before: number;
  after: number | null;
  fillBefore: number;
  fillAfter: number | null;
  slammed: boolean;
  scattered: boolean;
}

export function createRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): SceneRenderer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx && typeof ctx.fillRect !== 'function') ctx = null;

  const viewport = new Viewport(canvas, ctx, options);
  const sprites = new SpriteSystem(options);
  const particles = new ParticleSystem(options.particleCap ?? PARTICLE_CAP);
  const fx = new Effects();
  const pile = new PileLayer(sprites);

  const queue: GameEvent[] = [];
  let destroyed = false;

  // Clocks and memory. Everything here is visual state only.
  let time = 0;
  let fpsAvg = 60;
  let reduced = false;
  let curScene: SceneKey | null = null;
  let prevScene: SceneKey | null = null;
  let sceneFade = 1;
  let shownFill = -1;
  let lastContext = 0;
  let lastContextMax: number = BALANCE.BASE_CONTEXT;
  let lastPrompt = -1;
  let promptT0 = -99;
  let lastClickS = -99;
  let lastAutoTextS = -99;
  let typingUntil = -99;
  let suspiciousUntil = -99;
  let leaningUntil = -99;
  let dazedUntil = -99;
  let grovelUntil = -99;
  let panicUntil = -99;
  let stampKind: 'lgtm' | 'caught' | null = null;
  let stampT0 = -99;
  let crackT0 = -99;
  let bubbleId: string | null = null;
  let bubbleT0 = -99;
  let compaction: Compaction | null = null;
  let bandText: string | null = null;
  let bandT0 = -99;
  let bandUntil = -99;
  const toolAcc = new Float32Array(TOOLS.length);
  const toolPulse: Partial<Record<ToolId, number>> = {};
  let current: RenderInput | null = null;

  const stage: StageStats = {
    human: 'tired',
    humanMood: 'tired',
    agent: 'idle',
    pileFill: 0,
    pileTopY: FLOOR_Y,
    compacting: false,
    promptLine: '',
    promptShown: 0,
    stamp: null,
    bubble: null,
    crack: false,
  };
  const stats: RenderStats = {
    fps: 60,
    particles: 0,
    sprites: 0,
    drawCalls: 0,
    missingSprites: [],
    failedSheets: [],
    stage,
  };
  let drawCalls = 0;

  /** Reduced motion trims particle counts by ~80%. */
  const n = (count: number): number => (reduced ? Math.max(1, Math.round(count * 0.2)) : count);

  /** A landing spot on the pile's surface, favouring the high left side. */
  function pileSpot(seed: number): { x: number; y: number } {
    const u = hash(seed);
    const x = GLASS.x + 6 + Math.round(u * u * (GLASS.w - 12));
    const fill = Math.max(0.02, shownFill);
    const y = FLOOR_Y - pileHeightAt(fill, x) + 2;
    return { x, y: Math.min(FLOOR_Y - 2, y) };
  }

  function flyTokens(x: number, y: number, count: number, seed: number): void {
    for (let i = 0; i < count; i++) {
      const spot = pileSpot(seed * 31 + i * 7 + time * 13);
      particles.spawnToken(x + (hash(seed + i) - 0.5) * 6, y, spot.x, spot.y);
    }
  }

  // -- events -> visuals ----------------------------------------------------

  function apply(e: GameEvent): void {
    const input = current;
    switch (e.t) {
      case 'click': {
        lastClickS = time;
        if (e.auto && time - lastAutoTextS < 0.3) {
          flyTokens(AGENT_CORE.x, AGENT_CORE.y, 1, e.x + e.y);
          break;
        }
        if (e.auto) lastAutoTextS = time;
        flyTokens(AGENT_CORE.x, AGENT_CORE.y, e.crit ? n(8) : reduced ? 1 : 2, e.x * 3 + e.y);
        const label = `+${formatCompact(e.amount)}`;
        if (e.crit) {
          particles.spawnText(AGENT_X, AGENT_CORE.y - 26, STAGE_TEXT.crit, {
            color: C_AMBER,
            scale: 2,
            ttl: 1.2,
            vy: -24,
            shake: 1.5,
          });
          particles.spawnText(AGENT_X, AGENT_CORE.y - 12, label, { color: C_AMBER, scale: 1, ttl: 1 });
          particles.burstSparks(AGENT_X, AGENT_CORE.y - 6, n(16));
          fx.shake(0.14);
        } else {
          particles.spawnText(AGENT_X + 14, AGENT_CORE.y - 14, label, { color: C_GREEN, scale: 1, ttl: 0.8 });
        }
        break;
      }
      case 'oneShot': {
        particles.spawnText(AGENT_X, 96, STAGE_TEXT.oneShot, { color: C_GREEN, scale: 2, ttl: 1.4, vy: -18, shake: 1 });
        particles.spawnText(AGENT_X, 110, `+${formatCompact(e.amount)}`, { color: C_GREEN, scale: 1, ttl: 1.4, vy: -14 });
        let k = 0;
        for (const tool of TOOLS) {
          if ((input?.run.tools?.[tool.id] ?? 0) <= 0) continue;
          const c = gadgetCentre(tool.id);
          flyTokens(c.x, c.y, n(3), k++ * 17);
        }
        if (k === 0) flyTokens(AGENT_CORE.x, AGENT_CORE.y, n(8), 5);
        fx.flash(PALETTE.green, 0.08, 0.25);
        break;
      }
      case 'buyTool': {
        const c = gadgetCentre(e.id);
        particles.burstSparks(c.x, c.y, n(14), C_GREEN);
        particles.spawnText(c.x, c.y - 12, `x${formatCompact(e.owned)}`, { color: C_WHITE, ttl: 0.9 });
        toolPulse[e.id] = 1;
        fx.flash(PALETTE.green, 0.05, 0.16);
        break;
      }
      case 'buyUpgrade':
        particles.burstSparks(AGENT_CORE.x, AGENT_CORE.y, n(18), C_BLUE);
        fx.flash(PALETTE.blue, 0.07, 0.2);
        break;
      case 'toolLost': {
        // rm -rf took one. It goes out in red.
        const c = gadgetCentre(e.id);
        particles.burstShards(c.x, c.y, n(16));
        particles.spawnText(c.x, c.y - 12, '-1', { color: C_RED, ttl: 1.1 });
        toolPulse[e.id] = 1;
        fx.shake(0.3);
        fx.flash(PALETTE.red, 0.14, 0.25);
        break;
      }
      case 'report':
        particles.burstConfetti(AGENT_X, AGENT_CORE.y - 4, n(180));
        particles.spawnText(AGENT_X, 90, STAGE_TEXT.report, { color: C_GREEN, scale: 3, ttl: 1.6, vy: -10 });
        if (e.thumbs > 0) {
          particles.spawnText(AGENT_X, 108, `+${e.thumbs} THUMBS UP`, { color: C_AMBER, scale: 1, ttl: 1.6, vy: -8 });
        }
        fx.shake(0.4);
        fx.flash(PALETTE.green, 0.25, 0.4);
        break;
      case 'claim':
        stampT0 = time;
        if (e.caught) {
          stampKind = 'caught';
          leaningUntil = time + 2.8;
          panicUntil = time + 2.2;
          suspiciousUntil = time + 6;
          fx.flash(PALETTE.red, 0.32, 0.45);
          fx.shake(0.55);
        } else {
          stampKind = 'lgtm';
          suspiciousUntil = time + 4;
          fx.flash(PALETTE.green, 0.12, 0.3);
          fx.shake(0.22);
        }
        break;
      case 'compactStart': {
        const max = input?.derived.contextMax ?? lastContextMax;
        const before = e.forced ? Math.max(lastContext, max) : lastContext;
        compaction = {
          t0: time,
          forced: e.forced,
          before,
          after: null,
          fillBefore: e.forced ? 1 : clamp(shownFill, 0, 1),
          fillAfter: null,
          slammed: false,
          scattered: false,
        };
        dazedUntil = time + DAZED_S;
        bandText = null;
        break;
      }
      case 'compactEnd':
        if (e.droppedCards.length > 0) {
          particles.spawnText(AGENT_X, AGENT_HANDS.y - 18, STAGE_TEXT.dropped, { color: C_WHITE, ttl: 2, vy: -8 });
        }
        break;
      case 'sycophancy':
        grovelUntil = time + 0.9;
        particles.burstSparks(AGENT_X, AGENT_CORE.y - 12, n(10), C_AMBER);
        break;
      case 'draftOpen':
        fx.flash(PALETTE.purple, 0.12, 0.3);
        particles.burstSparks(W / 2, 60, n(20), C_PURPLE);
        break;
      case 'draftPick':
        particles.burstSparks(W / 2, 60, n(26), C_PURPLE);
        fx.flash(PALETTE.purple, 0.1, 0.22);
        break;
      case 'draftReroll':
        particles.burstSparks(W / 2, 60, n(12), C_BLUE);
        break;
      case 'incidentStart': {
        if (isHumanIncident(e.id)) {
          typingUntil = Math.max(typingUntil, time + 1.1);
          bubbleId = e.id;
          bubbleT0 = time + 0.35;
        }
        if (e.id === 'wait_stop') {
          crackT0 = time;
          particles.burstGlass(90, 70, n(46));
          fx.shake(0.75);
          fx.flash(PALETTE.white, 0.25, 0.18);
        }
        if (e.tone === 'bad') {
          particles.burstShards(AGENT_CORE.x, AGENT_CORE.y - 10, n(18));
          fx.shake(0.3);
          fx.glitch(0.35, 6);
          fx.flash(PALETTE.red, 0.24, 0.25);
        } else {
          particles.burstSparks(AGENT_CORE.x, AGENT_CORE.y - 10, n(30), C_AMBER);
          fx.flash(PALETTE.amber, 0.16, 0.35);
        }
        break;
      }
      case 'incidentEnd':
        fx.flash(PALETTE.green, 0.08, 0.25);
        break;
      case 'incidentProgress':
        particles.burstSparks(AGENT_CORE.x, AGENT_CORE.y - 8, n(4), C_RED);
        break;
      case 'pickupSpawn':
        particles.burstSparks(e.x, e.y, n(10), C_AMBER);
        break;
      case 'pickupCollect': {
        const def = PICKUP_BY_ID[e.id];
        const col = def?.accent === 'red' ? C_RED : def?.accent === 'purple' ? C_PURPLE : def?.accent === 'blue' ? C_BLUE : C_AMBER;
        particles.burstSparks(e.x, e.y, n(30), col);
        particles.spawnText(clamp(e.x, 40, W - 40), e.y - 10, pickupWords(e.id, def?.label), {
          color: C_WHITE,
          ttl: 1.3,
          vy: -16,
        });
        fx.flash(PALETTE.amber, 0.16, 0.25);
        fx.shake(0.15);
        break;
      }
      case 'pickupExpire':
        break;
      case 'patienceWarn':
        fx.flash(PALETTE.red, 0.18, 0.3);
        fx.shake(0.14);
        break;
      case 'contextWarn':
        fx.flash(e.fill >= 0.95 ? PALETTE.red : PALETTE.amber, 0.14, 0.3);
        break;
      case 'runOver':
        if (e.won) {
          particles.burstConfetti(W / 2, H / 2, n(300));
          fx.shake(0.8);
        } else {
          fx.shake(0.6);
        }
        break;
      case 'metaBuy':
        particles.burstSparks(W / 2, H / 2, n(24), C_AMBER);
        fx.flash(PALETTE.amber, 0.14, 0.3);
        break;
      case 'runStart':
        particles.clear();
        fx.reset();
        compaction = null;
        stampKind = null;
        bandText = null;
        crackT0 = -99;
        bubbleId = null;
        lastPrompt = -1;
        shownFill = -1;
        lastClickS = -99;
        dazedUntil = grovelUntil = panicUntil = -99;
        suspiciousUntil = leaningUntil = -99;
        break;
      case 'denied':
        fx.flash(PALETTE.red, 0.1, 0.12);
        break;
      default:
        break;
    }
  }

  // -- per-frame state ------------------------------------------------------

  function trackPrompt(input: RenderInput): void {
    const idx = input.run.promptIndex ?? 0;
    if (idx !== lastPrompt) {
      lastPrompt = idx;
      promptT0 = time;
      const len = promptAt(Math.max(0, idx)).text.length;
      typingUntil = Math.max(typingUntil, time + len / TYPE_CPS + 0.5);
    }
  }

  function updateCompaction(input: RenderInput): void {
    const c = compaction;
    if (!c) return;
    const t = time - c.t0;
    if (c.after === null) {
      // The sim has already reset the window by the time the event is drawn.
      const now = finite(input.run.context, 0);
      const floor = finite(input.derived.contextFloor, 0);
      const max = Math.max(1, finite(input.derived.contextMax, lastContextMax));
      c.after = now < c.before * 0.9 ? now : floor + BALANCE.SUMMARY_FRACTION * max;
      c.fillAfter = clamp(c.after / max, 0, 1);
    }
    if (!c.slammed && (t >= COMPACT_S.slam || reduced)) {
      c.slammed = true;
      fx.shake(c.forced ? 0.6 : 0.35);
      fx.flash(PALETTE.red, c.forced ? 0.18 : 0.08, 0.25);
    }
    if (!c.scattered && t >= COMPACT_S.slam) {
      c.scattered = true;
      // The crushed context rolls itself up into the agent's hands.
      for (let i = 0; i < n(26); i++) {
        const spot = pileSpot(i * 13 + 7);
        particles.spawnToken(spot.x, spot.y, AGENT_HANDS.x + (hash(i) - 0.5) * 20, AGENT_HANDS.y, {
          ttl: 0.45 + hash(i + 3) * 0.3,
          arc: hash(i + 5) * 6,
        });
      }
    }
    if (bandText === null && t >= COMPACT_S.text && c.after !== null) {
      bandText = STAGE_TEXT.compacted(c.before, c.after);
      bandT0 = time;
      bandUntil = time + COMPACT_S.textHold;
    }
    if (t > COMPACT_S.textHold + 1) compaction = null;
  }

  /** The fill the pile is drawn at: eases to the truth, crushed during compaction. */
  function pileFill(target: number, dt: number): number {
    const c = compaction;
    if (c && c.fillAfter !== null) {
      const t = time - c.t0;
      if (reduced) return t < 0.3 ? c.fillBefore : target;
      if (t < COMPACT_S.slam) return c.fillBefore;
      if (t < COMPACT_S.crushed) {
        const k = easeOut((t - COMPACT_S.slam) / (COMPACT_S.crushed - COMPACT_S.slam));
        return c.fillBefore + (c.fillAfter - c.fillBefore) * k;
      }
    }
    if (shownFill < 0) return target;
    const k = Math.min(1, dt * (reduced ? 12 : 6));
    return shownFill + (target - shownFill) * k;
  }

  /** How far in the compaction walls are, 0 (tucked into the bezel) .. 1 (closed). */
  function wallClose(): number {
    const c = compaction;
    if (!c) return 0;
    const t = time - c.t0;
    if (reduced) return t < 0.6 ? 1 : 0;
    if (t < COMPACT_S.slam) return easeIn(t / COMPACT_S.slam);
    if (t < COMPACT_S.hold) return 1;
    if (t < COMPACT_S.open) return 1 - easeOut((t - COMPACT_S.hold) / (COMPACT_S.open - COMPACT_S.hold));
    return 0;
  }

  function payouts(input: RenderInput, dt: number): void {
    const phase = input.run.phase;
    const live = phase === 'running' || phase === 'reported';
    for (let i = 0; i < TOOLS.length; i++) {
      const tool = TOOLS[i]!;
      const p = toolPulse[tool.id] ?? 0;
      if (p > 0) toolPulse[tool.id] = Math.max(0, p - dt * 4);
      if (!live || (input.run.tools?.[tool.id] ?? 0) <= 0) continue;
      if (input.derived.toolHalted?.[tool.id]) continue;
      const rate = input.derived.toolRates?.[tool.id] ?? 0;
      if (rate <= 0) continue;
      const interval = (reduced ? 2.8 : 1.5) + i * 0.17;
      toolAcc[i] = toolAcc[i]! + dt;
      if (toolAcc[i]! < interval) continue;
      toolAcc[i] = 0;
      toolPulse[tool.id] = 1;
      if (particles.count > particles.capacity * 0.7) continue;
      const c = gadgetCentre(tool.id);
      flyTokens(c.x, c.y, 1, i * 29 + time);
    }
  }

  // -- drawing --------------------------------------------------------------

  function drawPickup(c: CanvasRenderingContext2D, input: RenderInput): void {
    const p = input.run.pickup;
    if (!p) return;
    const def = PICKUP_BY_ID[p.id];
    if (!def) return;
    const accent = (PALETTE as Record<string, string>)[def.accent] ?? PALETTE.amber;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    // Pulsing halo, the "click me", fading as it runs out.
    const urgency = clamp(p.remainingMs / 2500, 0, 1);
    const pulse = 0.55 + 0.45 * Math.sin(p.ageS * 6);
    const rare = def.rare === true;
    const haloA = (reduced ? 0.3 : 0.2 + 0.3 * pulse) * (0.35 + 0.65 * urgency) * (rare ? 1.3 : 1);
    c.save();
    c.globalAlpha = Math.min(1, haloA);
    c.fillStyle = rare ? PALETTE.white : accent;
    for (let r = rare ? 13 : 10; r >= 7; r -= 3) {
      c.fillRect(x - r, y - r + 2, r * 2, r * 2 - 4);
      c.fillRect(x - r + 2, y - r, r * 2 - 4, r * 2);
    }
    c.restore();
    drawCalls += 4;
    const key = pickupSprite(def.shape, def.accent);
    const size = sprites.frameSize(key) ?? { w: 14, h: 14 };
    sprites.draw(c, key, x - Math.floor(size.w / 2), y - Math.floor(size.h / 2), { w: size.w, h: size.h, timeS: time });
    if (p.remainingMs < 1800 && Math.floor(p.ageS * 8) % 2 === 0 && !reduced) {
      c.fillStyle = PALETTE.white;
      c.fillRect(x - 8, y - 9, 16, 1);
      c.fillRect(x - 8, y + 8, 16, 1);
      drawCalls += 2;
    }
  }

  function drawWalls(c: CanvasRenderingContext2D): number {
    const k = wallClose();
    if (k <= 0) return 0;
    const leftX = Math.round(-64 + (GLASS.x + 64) * k);
    const rightX = Math.round(W - (GLASS.x + 64) * k);
    sprites.draw(c, 'wall_left', leftX, GLASS.y, { w: 64, h: 164 });
    sprites.draw(c, 'wall_right', rightX, GLASS.y, { w: 64, h: 164 });
    return 2;
  }

  function drawStamp(c: CanvasRenderingContext2D): number {
    if (!stampKind) return 0;
    const t = time - stampT0;
    const life = stampKind === 'lgtm' ? 1.8 : 2.8;
    if (t > life) {
      stampKind = null;
      return 0;
    }
    const fade = t > life - 0.4 ? (life - t) / 0.4 : 1;
    const prev = c.globalAlpha;
    c.globalAlpha = prev * clamp(fade, 0, 1);
    let ops = 0;
    if (stampKind === 'lgtm') {
      // Slams onto the glass: big, then settles, in whole-pixel steps.
      const scale = reduced || t > 0.12 ? 3 : t > 0.06 ? 4 : 5;
      const text = STAGE_TEXT.lgtm;
      const tw = measureText(text, scale);
      const bw = tw + 16;
      const bh = 5 * scale + 12;
      const bx = Math.round(W / 2 - bw / 2);
      const by = Math.round(60 - bh / 2);
      c.fillStyle = PALETTE.green;
      c.fillRect(bx, by, bw, bh);
      c.fillStyle = PALETTE.bg0;
      c.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
      c.fillStyle = PALETTE.green2;
      c.fillRect(bx + 4, by + 4, bw - 8, bh - 8);
      drawText(c, text, W / 2, by + 6, PALETTE.white, { scale, align: 'center', shadow: PALETTE.bg0 });
      ops += 4;
    } else {
      const text = STAGE_TEXT.caught;
      const y = 122;
      c.fillStyle = PALETTE.bg0;
      c.fillRect(0, y - 4, W, 18);
      c.fillStyle = PALETTE.red;
      c.fillRect(0, y - 4, W, 1);
      c.fillRect(0, y + 13, W, 1);
      const shake = reduced ? 0 : Math.round(Math.sin(t * 60) * (t < 0.3 ? 2 : 0));
      drawText(c, text, W / 2 + shake, y, PALETTE.red, { scale: 2, align: 'center', shadow: PALETTE.bg0 });
      ops += 4;
    }
    c.globalAlpha = prev;
    return ops;
  }

  function drawBanner(c: CanvasRenderingContext2D): number {
    const cmp = compaction;
    if (!cmp) return 0;
    const t = time - cmp.t0;
    if (t > COMPACT_S.banner) return 0;
    if (!reduced && t > 0.3 && Math.floor(t * 5) % 4 === 3) return 0;
    const text = cmp.forced ? STAGE_TEXT.compactForced : STAGE_TEXT.compactManual;
    const y = GLASS.y + 5;
    c.fillStyle = PALETTE.bg0;
    c.fillRect(GLASS.x + 8, y, GLASS.w - 16, 13);
    c.fillStyle = PALETTE.amber;
    c.fillRect(GLASS.x + 8, y, GLASS.w - 16, 1);
    c.fillRect(GLASS.x + 8, y + 12, GLASS.w - 16, 1);
    // Hazard stripes at both ends.
    for (let i = 0; i < 5; i++) {
      c.fillRect(GLASS.x + 12 + i * 5, y + 3, 2, 7);
      c.fillRect(GLASS.x + GLASS.w - 14 - i * 5, y + 3, 2, 7);
    }
    drawText(c, text, W / 2, y + 4, PALETTE.amber, { align: 'center' });
    return 14;
  }

  function drawHud(c: CanvasRenderingContext2D): void {
    drawText(c, `FPS ${Math.round(fpsAvg)}`, 8, 8, fpsAvg >= 55 ? PALETTE.green : PALETTE.amber, { shadow: PALETTE.bg0 });
    drawText(c, `PAR ${particles.count}`, 8, 15, PALETTE.fg1, { shadow: PALETTE.bg0 });
    drawText(c, `DRW ${stats.drawCalls}`, 8, 22, PALETTE.fg1, { shadow: PALETTE.bg0 });
    const missing = stats.missingSprites.length;
    if (missing > 0) drawText(c, `NOATLAS ${missing}`, 8, 29, PALETTE.amber, { shadow: PALETTE.bg0 });
  }

  function draw(input: RenderInput): void {
    if (destroyed) return;
    current = input;
    time = finite(input.time, time);
    const dt = clamp(finite(input.dt, 0), 0, 0.1);
    if (input.dt > 0.0005 && Number.isFinite(input.dt)) fpsAvg += (1 / input.dt - fpsAvg) * 0.08;

    const settings = effectsSettings(input.settings);
    reduced = settings.reducedMotion;
    fx.applySettings(settings);

    const run = input.run;
    const derived = input.derived;
    trackPrompt(input);
    for (let i = 0; i < queue.length; i++) apply(queue[i]!);
    queue.length = 0;
    updateCompaction(input);

    // The room follows the prompt: the human climbs through game 1.
    const scene: SceneKey = derived?.scene ?? promptAt(Math.max(0, run.promptIndex ?? 0)).scene;
    if (curScene === null) {
      curScene = scene;
      sceneFade = 1;
    } else if (scene !== curScene) {
      prevScene = curScene;
      curScene = scene;
      sceneFade = reduced ? 1 : 0;
    }
    if (sceneFade < 1) sceneFade = Math.min(1, sceneFade + dt / SCENE_FADE_S);
    if (sceneFade >= 1) prevScene = null;

    const fill = clamp(finite(derived?.contextFill, 0), 0, 1);
    const max = Math.max(1, finite(derived?.contextMax, lastContextMax));
    const floorFrac = clamp(finite(derived?.contextFloor, 0) / max, 0, 1);
    shownFill = clamp(pileFill(fill, dt), 0, 1);
    lastContext = finite(run.context, lastContext);
    lastContextMax = max;

    // Who is doing what.
    const incidents = run.incidents ?? [];
    const human = selectHuman({
      patience: finite(derived?.patienceProgress, 1),
      incidents,
      phase: run.phase,
      now: time,
      typingUntil,
      suspiciousUntil,
      leaningUntil,
    });
    const agentState = selectAgent({
      fill,
      reportState: derived?.reportState ?? 'working',
      incidents,
      phase: run.phase,
      compactingMs: finite(run.compactingMs, 0),
      now: time,
      dazedUntil,
      grovelUntil,
      panicUntil,
    });
    const stalled = new Set<ToolId>();
    for (const inc of incidents) {
      if (!isPermissionIncident(inc.id)) continue;
      if (inc.tool) stalled.add(inc.tool);
      for (const eff of INCIDENT_BY_ID[inc.id]?.effects ?? []) if (eff.t === 'toolHalt') stalled.add(eff.id);
    }
    const speaking = [...incidents].reverse().find((i) => isHumanIncident(i.id));
    if (!speaking) bubbleId = null;
    else if (speaking.id !== bubbleId) {
      bubbleId = speaking.id;
      bubbleT0 = time;
    }
    const waitStop = incidents.find((i) => i.id === 'wait_stop');
    if (waitStop && crackT0 < 0) crackT0 = time;
    if (!waitStop) crackT0 = -99;

    payouts(input, dt);
    particles.update(dt);
    fx.update(dt, time);
    fx.setWash(run.phase === 'lost' ? 'lose' : run.phase === 'won' ? 'win' : 'none');

    // ---- compose ----
    const c = ctx;
    if (!c) {
      recordStats(human, agentState);
      return;
    }
    drawCalls = 0;
    consumeTextOps();
    sprites.consumeOps();
    sprites.consumeRequests();

    viewport.applyBaseTransform();
    c.globalAlpha = 1;
    c.fillStyle = PALETTE.bg0;
    c.fillRect(0, 0, W, H);
    drawCalls++;

    const ox = fx.offsetX;
    const oy = fx.offsetY;
    c.save();
    if (ox !== 0 || oy !== 0) c.translate(ox, oy);

    // 1. Through the glass.
    if (prevScene !== null) drawRoom(c, sprites, prevScene, 1, time);
    drawRoom(c, sprites, curScene, prevScene !== null ? sceneFade : 1, time);
    // 2. The human.
    drawHuman(c, sprites, human, { timeS: time, reduced, lean: human.pose === 'leaning' ? 1 : 0 });
    // 3. The glass itself.
    drawCalls += drawGlassSheen(c, sprites, time);
    if (crackT0 >= 0 && waitStop) {
      const fade = waitStop.remainingMs < 1000 ? waitStop.remainingMs / 1000 : 1;
      drawCrack(c, sprites, fade);
    }
    // 4. The agent's side.
    drawCalls += drawFrame(c);
    drawCalls += drawFloorLights(c, time, clamp(fill, 0, 1), reduced);
    drawCalls += pile.draw(c, shownFill, floorFrac);
    drawCalls += drawSurfaceGlints(c, shownFill, floorFrac, time, reduced);
    drawCalls += drawSideBezels(c);
    drawGadgets(c, sprites, run, derived, { timeS: time, reduced, stalled, pulse: toolPulse });
    drawAgent(c, sprites, agentState, { timeS: time, reduced, sinceClick: time - lastClickS });
    drawCalls += drawWalls(c);
    // 5. Things in front.
    drawPickup(c, input);
    if (bubbleId) {
      const b = bubbleFor(bubbleId);
      const pop = reduced ? 1 : clamp((time - bubbleT0) / 0.12, 0, 1);
      if (b) drawCalls += drawBubble(c, b.text, b.kind, pop);
    }
    drawCalls += particles.draw(c, time);
    drawCalls += drawStamp(c);
    drawCalls += drawBanner(c);
    c.restore();

    // The prompt line never shakes: it is the one thing you must be able to read.
    const promptText = promptAt(Math.max(0, run.promptIndex ?? 0)).text;
    let line = promptText;
    let shown = reduced ? Infinity : (time - promptT0) * TYPE_CPS;
    let color: string = PALETTE.green;
    if (bandText !== null && time < bandUntil) {
      line = bandText;
      shown = reduced ? Infinity : (time - bandT0) * TYPE_CPS * 1.6;
      color = PALETTE.green;
    }
    drawCalls += drawPromptLine(c, line, shown, time, color, reduced);
    stage.promptLine = line;
    stage.promptShown = Math.max(0, Math.min(line.length, Math.floor(shown)));

    // 6. Full-frame effects, never shaken.
    c.globalAlpha = 1;
    const patienceS = finite(run.patienceMs, 99_000) / 1000;
    drawCalls += fx.drawVignette(c, finite(derived?.patienceProgress, 1), patienceS, time, BALANCE.WARN_AT_SECONDS);
    drawCalls += fx.drawFlashes(c);
    drawCalls += fx.drawGlitch(c, canvas, viewport.metrics.pixelScale, time);
    drawCalls += fx.drawWash(c, time);

    stats.sprites = sprites.consumeRequests();
    drawCalls += sprites.consumeOps() + consumeTextOps();
    stats.drawCalls = drawCalls;
    recordStats(human, agentState);
    if (input.settings?.showFps) {
      drawHud(c);
      consumeTextOps();
    }
    c.globalAlpha = 1;
  }

  function recordStats(human: HumanView, agentState: AgentState): void {
    stats.fps = Math.round(fpsAvg);
    stats.particles = particles.count;
    stats.missingSprites = sprites.missingSprites();
    stage.human = human.state;
    stage.humanMood = human.mood;
    stage.agent = agentState;
    stage.pileFill = shownFill;
    stage.pileTopY = pileTopY(shownFill);
    stage.compacting = compaction !== null && wallClose() > 0;
    stage.stamp = stampKind;
    stage.bubble = bubbleId ? (bubbleFor(bubbleId)?.text ?? null) : null;
    stage.crack = crackT0 >= 0;
  }

  // -- public surface -------------------------------------------------------

  const renderer: SceneRenderer = {
    draw,
    handle(e: GameEvent): void {
      if (destroyed) return;
      if (queue.length >= MAX_QUEUED_EVENTS) queue.shift();
      queue.push(e);
    },
    toScene(clientX: number, clientY: number) {
      return viewport.toScene(clientX, clientY);
    },
    hitsAgent,
    resize(): void {
      if (destroyed) return;
      viewport.resize();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      queue.length = 0;
      viewport.destroy();
      sprites.destroy();
      particles.clear();
      fx.reset();
    },
    renderStats(): RenderStats {
      return {
        fps: stats.fps,
        particles: destroyed ? 0 : particles.count,
        sprites: stats.sprites,
        drawCalls: stats.drawCalls,
        missingSprites: sprites.missingSprites(),
        failedSheets: sprites.failedSheets(),
        stage: { ...stage },
      };
    },
    metrics(): ViewMetrics {
      return viewport.metrics;
    },
    whenReady(): Promise<void> {
      return sprites.ready;
    },
  };

  return renderer;
}

/** The agent's hit box, re-exported for hosts that import the renderer only. */
export { AGENT_RECT };
