/**
 * Full-frame effects: screenshake, colour flashes, the incident glitch, the
 * deadline vignette and the win / loss washes.
 *
 * Every motion-heavy effect here is gated on `Settings.reducedMotion` and
 * `Settings.screenShake`. With reduced motion on, shake and glitch are disabled
 * outright — the game stays fully readable, it just stops moving.
 */
import type { Settings } from '../sim/types.ts';
import { createSurface } from './canvas.ts';
import { H, W } from './layout.ts';
import { PALETTE, hexToRgb, rgba } from './palette.ts';
import { drawText } from './text.ts';

const MAX_FLASHES = 6;
const MAX_SHAKE_PX = 7;

interface Flash {
  color: string;
  peak: number;
  life: number;
  ttl: number;
}

export interface EffectsSettings {
  readonly reducedMotion: boolean;
  readonly screenShake: boolean;
}

export function effectsSettings(s: Settings | undefined): EffectsSettings {
  return {
    reducedMotion: s?.reducedMotion === true,
    screenShake: s?.screenShake !== false,
  };
}

/** Cheap deterministic noise in [-1, 1]. */
function noise(t: number): number {
  const s = Math.sin(t * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

let vignetteSurface: HTMLCanvasElement | null | undefined;

function vignette(): HTMLCanvasElement | null {
  if (vignetteSurface !== undefined) return vignetteSurface;
  const surf = createSurface(W, H);
  if (!surf || typeof surf.ctx.createImageData !== 'function') {
    vignetteSurface = null;
    return null;
  }
  const ctx = surf.ctx;
  const { r, g, b } = hexToRgb(PALETTE.red);
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const cx = W / 2;
  const cy = H / 2;
  const rx = W * 0.5;
  const ry = H * 0.5;
  let p = 0;
  for (let y = 0; y < H; y++) {
    const dy = (y - cy) / ry;
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / rx;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Ramp from the middle out, quantised to 16 steps so it stays chunky.
      let a = (d - 0.42) / 0.62;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      a = Math.round(a * a * 16) / 16;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = Math.round(a * 255);
      p += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  vignetteSurface = surf.canvas;
  return vignetteSurface;
}

/** Test hook: drop the cached vignette surface. */
export function resetVignette(): void {
  vignetteSurface = undefined;
}

export class Effects {
  private trauma = 0;
  private readonly flashes: Flash[] = [];
  private glitchLife = 0;
  private glitchTtl = 0;
  private glitchAmp = 0;
  private shakeX = 0;
  private shakeY = 0;
  /** 0 = none, 1 = full. Set by `setWash`. */
  private washT = 0;
  private washKind: 'none' | 'win' | 'lose' = 'none';
  private settings: EffectsSettings = { reducedMotion: false, screenShake: true };

  constructor() {
    for (let i = 0; i < MAX_FLASHES; i++) this.flashes.push({ color: '', peak: 0, life: 0, ttl: 1 });
  }

  applySettings(s: EffectsSettings): void {
    this.settings = s;
    if (s.reducedMotion || !s.screenShake) {
      this.trauma = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (s.reducedMotion) {
      this.glitchLife = 0;
    }
  }

  /** Add shake energy. Trauma is squared on read, so small hits stay small. */
  shake(amount: number): void {
    if (this.settings.reducedMotion || !this.settings.screenShake) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  flash(color: string, peak: number, durationS: number): void {
    let slot = this.flashes.find((f) => f.life <= 0);
    if (!slot) {
      slot = this.flashes.reduce((a, b) => (a.life / a.ttl < b.life / b.ttl ? a : b));
    }
    slot.color = color;
    slot.peak = this.settings.reducedMotion ? peak * 0.5 : peak;
    slot.ttl = Math.max(0.016, durationS);
    slot.life = slot.ttl;
  }

  glitch(durationS: number, amplitude: number): void {
    if (this.settings.reducedMotion) return;
    this.glitchTtl = Math.max(0.016, durationS);
    this.glitchLife = this.glitchTtl;
    this.glitchAmp = amplitude;
  }

  setWash(kind: 'none' | 'win' | 'lose'): void {
    if (kind === this.washKind) return;
    this.washKind = kind;
    this.washT = kind === 'none' ? 0 : 0;
  }

  reset(): void {
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.glitchLife = 0;
    this.washKind = 'none';
    this.washT = 0;
    for (const f of this.flashes) f.life = 0;
  }

  update(dt: number, timeS: number): void {
    const step = dt > 0.1 ? 0.1 : dt;
    this.trauma = Math.max(0, this.trauma - step * 1.9);
    if (this.trauma > 0) {
      const mag = this.trauma * this.trauma * MAX_SHAKE_PX;
      this.shakeX = Math.round(noise(timeS * 37.1) * mag);
      this.shakeY = Math.round(noise(timeS * 53.7 + 11.3) * mag);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    for (const f of this.flashes) if (f.life > 0) f.life = Math.max(0, f.life - step);
    if (this.glitchLife > 0) this.glitchLife = Math.max(0, this.glitchLife - step);
    if (this.washKind !== 'none') this.washT = Math.min(1, this.washT + step * 1.6);
  }

  /** Whole-pixel translate to apply before drawing the scene. */
  get offsetX(): number {
    return this.shakeX;
  }
  get offsetY(): number {
    return this.shakeY;
  }
  get glitchActive(): boolean {
    return this.glitchLife > 0 && !this.settings.reducedMotion;
  }

  /**
   * Red deadline vignette. Ramps in below 25% of the deadline and pulses on the
   * beat once under `warnSeconds`.
   */
  drawVignette(
    ctx: CanvasRenderingContext2D,
    deadlineProgress: number,
    secondsLeft: number,
    timeS: number,
  ): number {
    const danger = Math.max(0, Math.min(1, (0.25 - deadlineProgress) / 0.25));
    if (danger <= 0) return 0;
    let a = 0.22 + danger * 0.5;
    if (secondsLeft < 10) {
      const beat = this.settings.reducedMotion ? 0.5 : Math.abs(Math.sin(timeS * Math.PI * 1.6));
      a += beat * 0.28;
    }
    const v = vignette();
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = Math.min(0.95, a);
    if (v) {
      ctx.drawImage(v, 0, 0, W, H);
    } else {
      ctx.fillStyle = rgba(PALETTE.red, 0.35);
      ctx.fillRect(0, 0, W, 6);
      ctx.fillRect(0, H - 6, W, 6);
      ctx.fillRect(0, 0, 6, H);
      ctx.fillRect(W - 6, 0, 6, H);
    }
    ctx.globalAlpha = prev;
    return 1;
  }

  drawFlashes(ctx: CanvasRenderingContext2D): number {
    let ops = 0;
    const prev = ctx.globalAlpha;
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      const a = (f.life / f.ttl) * f.peak;
      if (a <= 0.004) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, W, H);
      ops++;
    }
    ctx.globalAlpha = prev;
    return ops;
  }

  /**
   * Chromatic-ish tear. Re-blits horizontal bands of the freshly drawn frame
   * with an x offset and lays a red/blue fringe over them. `pixelScale` maps
   * scene units to the canvas backing store for the self-blit.
   */
  drawGlitch(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    pixelScale: number,
    timeS: number,
  ): number {
    if (!this.glitchActive) return 0;
    const t = this.glitchLife / this.glitchTtl;
    const amp = this.glitchAmp * t;
    if (amp < 0.5) return 0;
    let ops = 0;
    const bands = 5;
    const prevAlpha = ctx.globalAlpha;
    for (let b = 0; b < bands; b++) {
      const n = noise(timeS * 61 + b * 3.7);
      const by = Math.floor(((b + 0.5) / bands) * H + n * 12);
      const bh = 4 + Math.floor(Math.abs(n) * 9);
      if (by < 0 || by + bh > H) continue;
      const dx = Math.round(n * amp);
      if (dx === 0) continue;
      if (pixelScale > 0 && canvas.width > 0) {
        try {
          ctx.drawImage(
            canvas,
            0,
            Math.round(by * pixelScale),
            Math.round(W * pixelScale),
            Math.round(bh * pixelScale),
            dx,
            by,
            W,
            bh,
          );
          ops++;
        } catch {
          /* self-blit unsupported; the fringe below still sells it */
        }
      }
      ctx.globalAlpha = 0.3 * t;
      ctx.fillStyle = PALETTE.red;
      ctx.fillRect(dx - 2, by, W, 1);
      ctx.fillStyle = PALETTE.blue;
      ctx.fillRect(dx + 2, by + bh - 1, W, 1);
      ops += 2;
    }
    ctx.globalAlpha = prevAlpha;
    return ops;
  }

  /** SIGKILL blue-screen on loss, golden wash on win. */
  drawWash(ctx: CanvasRenderingContext2D, timeS: number): number {
    if (this.washKind === 'none' || this.washT <= 0) return 0;
    let ops = 0;
    const t = this.washT;
    const prev = ctx.globalAlpha;
    if (this.washKind === 'lose') {
      ctx.globalAlpha = 0.82 * t;
      ctx.fillStyle = '#1b3a6b';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ops++;
      const boxW = 150;
      const boxH = 46;
      const bx = Math.round((W - boxW) / 2);
      const by = Math.round((H - boxH) / 2) - 6;
      ctx.fillStyle = PALETTE.bg0;
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.fillStyle = PALETTE.blue;
      ctx.fillRect(bx, by, boxW, 1);
      ctx.fillRect(bx, by + boxH - 1, boxW, 1);
      ctx.fillRect(bx, by, 1, boxH);
      ctx.fillRect(bx + boxW - 1, by, 1, boxH);
      ops += 5;
      drawText(ctx, 'SIGKILL', W / 2, by + 10, PALETTE.white, {
        scale: 4,
        align: 'center',
        shadow: PALETTE.red,
      });
      drawText(ctx, 'DEADLINE MISSED', W / 2, by + 34, PALETTE.fg1, { scale: 1, align: 'center' });
      ops += 2;
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(timeS * 3);
      ctx.globalAlpha = (0.2 + pulse * 0.12) * t;
      ctx.fillStyle = PALETTE.amber;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ops++;
      // Dark shadow: white-on-gold has no contrast without it.
      drawText(ctx, 'DEMO DAY', W / 2, H / 2 - 16, PALETTE.white, {
        scale: 4,
        align: 'center',
        shadow: PALETTE.bg0,
      });
      drawText(ctx, 'YOU SHIPPED EVERYTHING', W / 2, H / 2 + 12, PALETTE.white, {
        scale: 1,
        align: 'center',
        shadow: PALETTE.bg0,
      });
      ops += 2;
    }
    ctx.globalAlpha = prev;
    return ops;
  }
}
