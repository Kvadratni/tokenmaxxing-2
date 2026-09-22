/**
 * Scene composition and the public `Renderer` implementation.
 *
 * Draw order: backdrop -> desk clutter -> dev -> laptop -> particles -> overlays.
 * `handle()` never touches sim state; it appends to a bounded queue that
 * `draw()` drains, so all visual work happens inside a frame.
 */
import { AGENT_BY_ID, AGENT_TIERS, PICKUP_BY_ID, currentScene } from '../sim/content.ts';
import type { GameEvent, RenderInput, Renderer, SceneKey } from '../sim/types.ts';
import { CLUTTER_SLOTS, LAPTOP_RECT } from './atlas-types.ts';
import { getBackdrop, paintBackdrop } from './backdrop.ts';
import type { ViewMetrics, ViewportOptions } from './canvas.ts';
import { Viewport, hitsLaptop } from './canvas.ts';
import { Effects, effectsSettings } from './effects.ts';
import { DEV_ANCHOR, DEV_RECT, H, LAPTOP_ART, LAPTOP_SCREEN_CENTER, W } from './layout.ts';
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
import type { SpriteSystemOptions } from './sprites.ts';
import { SpriteSystem } from './sprites.ts';
import { consumeTextOps, drawText, formatCompact } from './text.ts';

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
}

/** `Renderer` plus the diagnostics the QA harness and integrator need. */
export interface SceneRenderer extends Renderer {
  renderStats(): RenderStats;
  metrics(): ViewMetrics;
  /** Resolves once the atlas (or its absence) has been determined. */
  whenReady(): Promise<void>;
}

export interface RendererOptions extends ViewportOptions, SpriteSystemOptions {
  /** Hard particle ceiling. Defaults to PARTICLE_CAP (1024). */
  particleCap?: number;
}

const MAX_QUEUED_EVENTS = 256;
const SCENE_FADE_S = 0.6;
const SQUASH_S = 0.12;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

export function createRenderer(
  canvas: HTMLCanvasElement,
  options: RendererOptions = {},
): SceneRenderer {
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

  const queue: GameEvent[] = [];
  let destroyed = false;

  let time = 0;
  let lastClickS = -99;
  let clickEnergy = 0;
  let squashStartS = -99;
  let curScene: SceneKey | null = null;
  let prevScene: SceneKey | null = null;
  let sceneFade = 1;
  let moteAcc = 0;
  let fpsAvg = 60;
  let reduced = false;

  // Per-tier payout clocks. Each idle helper announces what it produced on its
  // own cadence, the way the laptop announces a click — so the desk visibly
  // earns instead of the number just climbing in the HUD.
  const tierAcc = new Float32Array(AGENT_TIERS.length);
  const tierFlash = new Float32Array(AGENT_TIERS.length);

  const stats: RenderStats = {
    fps: 60,
    particles: 0,
    sprites: 0,
    drawCalls: 0,
    missingSprites: [],
    failedSheets: [],
  };
  let drawCalls = 0;

  /** Reduced motion trims particle counts by ~80%. */
  const n = (count: number): number => (reduced ? Math.max(1, Math.round(count * 0.2)) : count);

  // -- event -> visuals ------------------------------------------------------

  function apply(e: GameEvent): void {
    switch (e.t) {
      case 'click': {
        squashStartS = time;
        lastClickS = time;
        clickEnergy = Math.min(12, clickEnergy + 1.6);
        const x = clamp(e.x, 12, W - 12);
        const y = clamp(e.y, 14, H - 8);
        const label = `+${formatCompact(e.amount)} SLOP`;
        if (e.crit) {
          particles.spawnText(x, y - 8, label, {
            color: C_AMBER,
            scale: 2,
            ttl: 1.3,
            vy: -26,
            shake: 1.5,
          });
          particles.burstSparks(x, y, n(14));
          fx.shake(0.13);
        } else {
          particles.spawnText(x, y - 4, label, { color: C_GREEN, scale: 1 });
        }
        break;
      }
      case 'oneShot': {
        // Reads as the *room* producing it, not the laptop: the burst comes
        // from the agents, so it rises from the desk clutter rather than from
        // wherever the cursor happened to be.
        const x = W / 2;
        const y = H * 0.42;
        particles.spawnText(x, y, `ONE-SHOT +${formatCompact(e.amount)}`, {
          color: C_GREEN,
          scale: 2,
          ttl: 1.5,
          vy: -20,
          shake: 1,
        });
        particles.burstSparks(x, y + 6, n(18), C_GREEN);
        fx.flash(PALETTE.green, 0.05, 0.22);
        break;
      }
      case 'buyAgent': {
        const def = AGENT_BY_ID[e.id];
        const slot = def ? CLUTTER_SLOTS[def.clutterSprite] : undefined;
        const cx = slot ? slot.x + slot.maxW / 2 : W / 2;
        const cy = slot ? slot.y + slot.maxH / 2 : H / 2;
        particles.burstSparks(cx, cy, n(14), C_GREEN);
        particles.spawnText(cx, cy - 6, `x${formatCompact(e.owned)}`, { color: C_WHITE });
        fx.flash(PALETTE.green, 0.06, 0.18);
        break;
      }
      case 'buyUpgrade':
        particles.burstSparks(LAPTOP_SCREEN_CENTER.x, LAPTOP_SCREEN_CENTER.y, n(20), C_BLUE);
        fx.flash(PALETTE.blue, 0.08, 0.22);
        break;
      case 'ship': {
        particles.burstConfetti(LAPTOP_SCREEN_CENTER.x, LAPTOP_SCREEN_CENTER.y + 4, n(220));
        particles.spawnText(W / 2, 62, 'SHIPPED', { color: C_WHITE, scale: 2, ttl: 1.8, vy: -10 });
        if (e.demos > 0) {
          particles.spawnText(W / 2, 78, `+${e.demos} DEMOS`, {
            color: C_AMBER,
            scale: 1,
            ttl: 1.8,
            vy: -8,
          });
        }
        fx.shake(0.85);
        fx.flash(PALETTE.green, 0.42, 0.4);
        break;
      }
      case 'draftOpen':
        fx.flash(PALETTE.purple, 0.16, 0.35);
        particles.burstSparks(W / 2, H / 2, n(24), C_PURPLE);
        break;
      case 'draftPick':
        particles.burstSparks(W / 2, H / 2, n(30), C_PURPLE);
        fx.flash(PALETTE.purple, 0.12, 0.25);
        break;
      case 'draftReroll':
        particles.burstSparks(W / 2, H / 2, n(12), C_BLUE);
        break;
      case 'incidentStart':
        if (e.tone === 'bad') {
          particles.burstShards(LAPTOP_SCREEN_CENTER.x, LAPTOP_SCREEN_CENTER.y, n(34));
          fx.shake(0.5);
          fx.glitch(0.42, 7);
          fx.flash(PALETTE.red, 0.3, 0.25);
        } else {
          particles.burstSparks(LAPTOP_SCREEN_CENTER.x, LAPTOP_SCREEN_CENTER.y, n(46), C_AMBER);
          fx.flash(PALETTE.amber, 0.24, 0.4);
        }
        break;
      case 'incidentEnd':
        fx.flash(PALETTE.green, 0.12, 0.3);
        break;
      case 'incidentProgress':
        particles.burstSparks(LAPTOP_SCREEN_CENTER.x, LAPTOP_SCREEN_CENTER.y, n(4), C_RED);
        break;
      case 'deadlineWarn':
        fx.flash(PALETTE.red, 0.22, 0.3);
        fx.shake(0.16);
        break;
      case 'runOver':
        if (e.won) {
          particles.burstConfetti(W / 2, H / 2, n(320));
          fx.shake(0.9);
        } else {
          fx.shake(0.7);
          fx.flash(PALETTE.blue, 0.4, 0.6);
        }
        break;
      case 'pickupSpawn':
        particles.burstSparks(e.x, e.y, n(10), C_AMBER);
        break;
      case 'pickupCollect': {
        const def = PICKUP_BY_ID[e.id];
        const col = def?.accent === 'red' ? C_RED : def?.accent === 'purple' ? C_PURPLE : C_AMBER;
        particles.burstSparks(e.x, e.y, n(34), col);
        particles.spawnText(e.x, e.y - 8, def?.label.toUpperCase() ?? 'BONUS', {
          color: C_WHITE,
          scale: 1,
          ttl: 1.4,
          vy: -16,
        });
        fx.flash(PALETTE.amber, 0.22, 0.3);
        fx.shake(0.2);
        break;
      }
      case 'metaBuy':
        particles.burstSparks(W / 2, H / 2, n(26), C_AMBER);
        fx.flash(PALETTE.amber, 0.16, 0.3);
        break;
      case 'runStart':
        particles.clear();
        fx.reset();
        moteAcc = 0;
        clickEnergy = 0;
        squashStartS = -99;
        lastClickS = -99;
        break;
      case 'denied':
        fx.flash(PALETTE.red, 0.14, 0.14);
        break;
      default:
        break;
    }
  }

  // -- drawing ---------------------------------------------------------------

  function blitBackdrop(c: CanvasRenderingContext2D, scene: SceneKey, alpha: number): void {
    if (alpha <= 0) return;
    const prev = c.globalAlpha;
    if (alpha !== 1) c.globalAlpha = prev * alpha;
    if (!sprites.tryDraw(c, `scene_${scene}`, 0, 0, { stretch: true, w: W, h: H, timeS: time })) {
      const pre = getBackdrop(scene);
      if (pre) {
        c.drawImage(pre, 0, 0, W, H);
        drawCalls++;
      } else {
        paintBackdrop(c, scene);
        drawCalls += 40;
      }
    }
    c.globalAlpha = prev;
  }

  function drawClutter(c: CanvasRenderingContext2D, input: RenderInput): void {
    for (let i = 0; i < AGENT_TIERS.length; i++) {
      const tier = AGENT_TIERS[i]!;
      const owned = input.run.agents?.[tier.id] ?? 0;
      if (owned <= 0) continue;
      const slot = CLUTTER_SLOTS[tier.clutterSprite];
      if (!slot) continue;
      // A 1px integer bob, phase-offset per tier, so the desk breathes without
      // ever landing on a half-pixel.
      const bob = reduced ? 0 : Math.round(Math.sin(time * 1.6 + i * 1.1));
      // Brief lift the instant this helper pays out.
      const pulse = tierFlash[i] ?? 0;
      const lift = pulse > 0 ? Math.round(pulse * 2) : 0;
      const y = slot.y + bob - lift;
      // Density read: up to three ghosted copies stacked behind the real one.
      const extra = Math.min(3, Math.floor(Math.log2(owned)));
      for (let k = extra; k >= 1; k--) {
        sprites.draw(c, tier.clutterSprite, slot.x - k * 3, y - k * 2, {
          w: slot.maxW,
          h: slot.maxH,
          timeS: time + k * 0.37,
          alpha: 0.45 - k * 0.09,
        });
      }
      sprites.draw(c, tier.clutterSprite, slot.x, y, {
        w: slot.maxW,
        h: slot.maxH,
        timeS: time,
        alpha: 1,
      });
      if (pulse > 0) {
        // Green wash over the sprite box on payout — reads as "this one just
        // produced" without needing a second sprite.
        c.save();
        c.globalAlpha = pulse * 0.28;
        c.fillStyle = PALETTE.green;
        c.fillRect(slot.x, y, slot.maxW, slot.maxH);
        c.restore();
        drawCalls++;
      }
      if (owned >= 16) {
        drawText(
          c,
          `x${formatCompact(owned)}`,
          slot.x + slot.maxW / 2,
          y + slot.maxH + 1,
          PALETTE.fg1,
          { align: 'center', shadow: PALETTE.bg0 },
        );
      }
    }
  }

  /**
   * The drifting collectible. Drawn procedurally rather than from the atlas so
   * a new pickup type needs no art round-trip: shape + accent is enough to read
   * at 320x180, and the halo is what actually catches the eye.
   */
  function drawPickup(c: CanvasRenderingContext2D, input: RenderInput): void {
    const p = input.run.pickup;
    if (!p) return;
    const def = PICKUP_BY_ID[p.id];
    if (!def) return;
    const accent = (PALETTE as Record<string, string>)[def.accent] ?? PALETTE.amber;
    const x = Math.round(p.x);
    const y = Math.round(p.y);

    // Pulsing halo — the "click me" signal, and it fades as time runs out.
    const urgency = clamp(p.remainingMs / 2500, 0, 1);
    const pulse = 0.55 + 0.45 * Math.sin(p.ageS * 6);
    const rare = def.rare === true;
    const haloA =
      (reduced ? 0.35 : 0.25 + 0.35 * pulse) * (0.35 + 0.65 * urgency) * (rare ? 1.35 : 1);
    c.save();
    c.globalAlpha = Math.min(1, haloA);
    c.fillStyle = rare ? PALETTE.white : accent;
    for (let r = rare ? 14 : 11; r >= 7; r -= 2) {
      c.fillRect(x - r, y - r + 2, r * 2, r * 2 - 4);
      c.fillRect(x - r + 2, y - r, r * 2 - 4, r * 2);
    }
    c.restore();
    drawCalls += 3;

    c.save();
    c.fillStyle = accent;
    switch (def.shape) {
      case 'can':
        c.fillRect(x - 3, y - 6, 6, 12);
        c.fillStyle = PALETTE.fg0;
        c.fillRect(x - 3, y - 2, 6, 2);
        c.fillStyle = PALETTE.line;
        c.fillRect(x - 3, y - 7, 6, 1);
        break;
      case 'cup':
        c.fillRect(x - 4, y - 5, 8, 10);
        c.fillStyle = PALETTE.fg0;
        c.fillRect(x - 5, y - 6, 10, 2);
        break;
      case 'box':
        c.fillRect(x - 6, y - 4, 12, 8);
        c.fillStyle = PALETTE.bg0;
        c.fillRect(x - 1, y - 4, 2, 8);
        break;
      case 'chip':
        c.fillRect(x - 6, y - 4, 12, 8);
        c.fillStyle = PALETTE.bg0;
        c.fillRect(x - 4, y - 2, 8, 4);
        c.fillStyle = PALETTE.green;
        c.fillRect(x - 7, y - 3, 1, 2);
        c.fillRect(x + 6, y - 3, 1, 2);
        break;
      case 'star':
        c.fillRect(x - 1, y - 7, 2, 14);
        c.fillRect(x - 7, y - 1, 14, 2);
        c.fillStyle = PALETTE.white;
        c.fillRect(x - 1, y - 1, 2, 2);
        break;
      case 'clock':
        c.fillRect(x - 6, y - 6, 12, 12);
        c.fillStyle = PALETTE.bg0;
        c.fillRect(x - 4, y - 4, 8, 8);
        c.fillStyle = PALETTE.fg0;
        c.fillRect(x - 1, y - 3, 2, 4);
        c.fillRect(x - 1, y - 1, 4, 2);
        break;
      case 'wrench':
        c.fillRect(x - 1, y - 6, 3, 11);
        c.fillRect(x - 4, y - 7, 4, 4);
        c.fillRect(x + 1, y - 7, 3, 3);
        c.fillStyle = PALETTE.fg0;
        c.fillRect(x - 1, y + 3, 3, 2);
        break;
      case 'badge':
        c.fillRect(x - 5, y - 6, 10, 12);
        c.fillStyle = PALETTE.bg0;
        c.fillRect(x - 3, y - 4, 6, 3);
        c.fillStyle = PALETTE.fg0;
        c.fillRect(x - 3, y, 6, 1);
        c.fillRect(x - 3, y + 2, 4, 1);
        break;
      case 'bubble':
      default:
        c.fillRect(x - 6, y - 5, 12, 8);
        c.fillRect(x - 4, y + 3, 3, 3);
        c.fillStyle = PALETTE.bg0;
        c.fillRect(x - 4, y - 3, 8, 1);
        c.fillRect(x - 4, y - 1, 5, 1);
        break;
    }
    c.restore();
    drawCalls += 4;

    // A last-second flash so a pickup never quietly disappears.
    if (p.remainingMs < 1800 && Math.floor(p.ageS * 8) % 2 === 0 && !reduced) {
      c.save();
      c.globalAlpha = 0.8;
      c.fillStyle = PALETTE.white;
      c.fillRect(x - 8, y - 8, 16, 1);
      c.fillRect(x - 8, y + 7, 16, 1);
      c.restore();
      drawCalls += 2;
    }
  }

  function drawLaptop(c: CanvasRenderingContext2D, glow: number): void {
    // Halo behind the lid: concentric 1px frames with corners clipped, so the
    // alpha builds a soft falloff instead of a flat green box.
    const s = LAPTOP_ART.screen;
    const prev = c.globalAlpha;
    c.fillStyle = PALETTE.green;
    const rings = 6;
    for (let i = rings; i >= 1; i--) {
      c.globalAlpha = glow * 0.075 * (1 - (i - 1) / rings);
      const x = s.x - i * 2;
      const y = s.y - i * 2;
      const w = s.w + i * 4;
      const h = s.h + i * 4;
      c.fillRect(x + 2, y, w - 4, 1);
      c.fillRect(x + 2, y + h - 1, w - 4, 1);
      c.fillRect(x, y + 2, 1, h - 4);
      c.fillRect(x + w - 1, y + 2, 1, h - 4);
      drawCalls += 4;
    }
    c.globalAlpha = prev;

    const since = time - squashStartS;
    let frame = 0;
    if (since >= 0 && since < SQUASH_S) {
      const p = 1 - easeOutQuad(since / SQUASH_S);
      frame = p > 0.6 ? 2 : p > 0.25 ? 1 : 0;
    }
    sprites.draw(c, 'laptop', LAPTOP_RECT.x, LAPTOP_RECT.y, {
      frame,
      timeS: time,
      w: LAPTOP_RECT.w,
      h: LAPTOP_RECT.h,
      extra: glow,
    });
  }

  function drawHud(c: CanvasRenderingContext2D): void {
    const missing = stats.missingSprites.length;
    drawText(c, `FPS ${Math.round(fpsAvg)}`, 3, 3, fpsAvg >= 55 ? PALETTE.green : PALETTE.amber, {
      shadow: PALETTE.bg0,
    });
    drawText(c, `PAR ${particles.count}`, 3, 10, PALETTE.fg1, { shadow: PALETTE.bg0 });
    drawText(c, `DRW ${stats.drawCalls}`, 3, 17, PALETTE.fg1, { shadow: PALETTE.bg0 });
    if (missing > 0) {
      drawText(c, `NOATLAS ${missing}`, 3, 24, PALETTE.amber, { shadow: PALETTE.bg0 });
    }
  }

  function draw(input: RenderInput): void {
    if (destroyed) return;
    const c = ctx;
    if (!c) return;

    time = input.time;
    const dt = clamp(input.dt, 0, 0.1);
    if (input.dt > 0.0005) fpsAvg += (1 / input.dt - fpsAvg) * 0.08;

    const settings = effectsSettings(input.settings);
    reduced = settings.reducedMotion;
    fx.applySettings(settings);

    for (let i = 0; i < queue.length; i++) apply(queue[i]!);
    queue.length = 0;

    // The room is whatever the player has bought, not whatever project they
    // happen to be on. Cross-fades on purchase.
    const scene = currentScene(input.run.owned ?? []);
    if (curScene === null) {
      curScene = scene;
      sceneFade = 1;
    } else if (scene !== curScene) {
      prevScene = curScene;
      curScene = scene;
      sceneFade = 0;
    }
    if (sceneFade < 1) sceneFade = Math.min(1, sceneFade + dt / SCENE_FADE_S);
    if (sceneFade >= 1) prevScene = null;

    // Ambient code motes, log-scaled off idle production and capped.
    const idle = input.derived?.idleRate ?? 0;
    const moteRate = idle > 0 ? Math.min(26, Math.log10(1 + idle) * 7) : 0;
    moteAcc = Math.min(8, moteAcc + moteRate * dt * (reduced ? 0.2 : 1));
    const moteRoom = particles.capacity * 0.75;
    while (moteAcc >= 1) {
      moteAcc -= 1;
      if (particles.count < moteRoom) {
        particles.spawnMote(LAPTOP_SCREEN_CENTER.x, LAPTOP_SCREEN_CENTER.y);
      }
    }

    // Idle helpers pay out visibly. Each owned tier banks its own production
    // and, on its own staggered cadence, floats the amount off its sprite —
    // the same feedback the laptop gives a click, so idle income reads as
    // *earned* rather than as a number quietly ticking up in the HUD.
    const tierRates = input.derived?.tierRates;
    if (tierRates && (input.run.phase === 'running' || input.run.phase === 'shipped')) {
      for (let i = 0; i < AGENT_TIERS.length; i++) {
        const tier = AGENT_TIERS[i]!;
        if (tierFlash[i]! > 0) tierFlash[i] = Math.max(0, tierFlash[i]! - dt * 4);
        if ((input.run.agents?.[tier.id] ?? 0) <= 0) continue;
        const rate = tierRates[tier.id] ?? 0;
        if (rate <= 0) continue;
        const slot = CLUTTER_SLOTS[tier.clutterSprite];
        if (!slot) continue;

        // Stagger so ten tiers never fire on the same frame.
        const interval = (reduced ? 2.6 : 1.5) + i * 0.17;
        tierAcc[i] = tierAcc[i]! + dt;
        if (tierAcc[i]! < interval) continue;
        const gained = rate * tierAcc[i]!;
        tierAcc[i] = 0;
        tierFlash[i] = 1;
        if (particles.count >= moteRoom) continue;

        const cx = slot.x + slot.maxW / 2;
        const cy = slot.y + slot.maxH / 2;
        particles.spawnText(cx, cy - 2, `+${formatCompact(gained)}`, {
          color: C_GREEN,
          scale: 1,
          ttl: 1,
          vy: -13,
        });
        if (!reduced) particles.spawnMote(cx, cy);
      }
    }

    clickEnergy = Math.max(0, clickEnergy - dt * 3.2);
    particles.update(dt);
    fx.update(dt, time);

    const phase = input.run.phase;
    fx.setWash(phase === 'lost' ? 'lose' : phase === 'won' ? 'win' : 'none');

    // ---- compose ----
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
    if (ox !== 0 || oy !== 0) {
      // Fill the gutter the shake would otherwise expose.
      blitBackdrop(c, curScene, 1);
    }
    c.save();
    if (ox !== 0 || oy !== 0) c.translate(ox, oy);

    if (prevScene !== null) blitBackdrop(c, prevScene, 1);
    blitBackdrop(c, curScene, prevScene !== null ? sceneFade : 1);

    drawClutter(c, input);
    drawPickup(c, input);

    const rate = idle + (input.derived?.clickPower ?? 0) * clickEnergy;
    const typeHz = 2.2 + Math.min(10, clickEnergy * 1.4 + Math.log10(1 + idle) * 1.6);
    const typing = ((time * typeHz) | 0) % 2 === 1 || time - lastClickS < 0.09;
    const devKey = typing ? 'dev_type' : 'dev_idle';
    // Anchor from the sprite's own size so resized art stays centred on the
    // laptop with its shoulders tucked behind the lid.
    const devSize = sprites.frameSize(devKey) ?? { w: DEV_RECT.w, h: DEV_RECT.h };
    sprites.draw(
      c,
      devKey,
      Math.round(DEV_ANCHOR.cx - devSize.w / 2),
      Math.round(DEV_ANCHOR.baseY - devSize.h),
      { w: devSize.w, h: devSize.h, timeS: time },
    );

    const glowHz = 0.55 + Math.min(3.2, Math.log10(1 + rate) * 0.55);
    const glow = 0.3 + (0.5 + 0.5 * Math.sin(time * glowHz * TAU)) * 0.4;
    drawLaptop(c, glow);

    drawCalls += particles.draw(c, time);
    c.restore();

    // Overlays are not shaken — readability beats spectacle.
    c.globalAlpha = 1;
    drawCalls += fx.drawVignette(
      c,
      input.derived?.deadlineProgress ?? 1,
      (input.run.timeLeftMs ?? 0) / 1000,
      time,
    );
    drawCalls += fx.drawFlashes(c);
    drawCalls += fx.drawGlitch(c, canvas, viewport.metrics.pixelScale, time);
    drawCalls += fx.drawWash(c, time);

    stats.fps = Math.round(fpsAvg);
    stats.particles = particles.count;
    stats.sprites = sprites.consumeRequests();
    stats.missingSprites = sprites.missingSprites();
    drawCalls += sprites.consumeOps() + consumeTextOps();
    stats.drawCalls = drawCalls;

    if (input.settings?.showFps) {
      drawHud(c);
      consumeTextOps();
    }
    c.globalAlpha = 1;
  }

  // -- public surface --------------------------------------------------------

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
    hitsLaptop,
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
        particles: stats.particles,
        sprites: stats.sprites,
        drawCalls: stats.drawCalls,
        missingSprites: sprites.missingSprites(),
        failedSheets: sprites.failedSheets(),
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
