/**
 * Pooled particle system.
 *
 * Fixed-capacity struct-of-arrays. `update()` and `draw()` allocate nothing —
 * no closures, no temporary objects, no array growth. Spawning past capacity
 * recycles a live slot round-robin instead of growing, so 10,000 spawn calls in
 * one frame cost the same memory as one.
 */
import { createSurface } from './canvas.ts';
import { PALETTE } from './palette.ts';
import { GLYPH_H, GLYPH_W, drawText, glyphRows } from './text.ts';

export const PARTICLE_CAP = 1024;

/** Particle kinds. Plain consts — `isolatedModules` forbids `const enum`. */
export const P_TEXT = 0;
export const P_MOTE = 1;
export const P_CONFETTI = 2;
export const P_SHARD = 3;
export const P_SPARK = 4;
/** A token flying from where it was generated into the context pile. */
export const P_TOKEN = 5;
/** A shard of screen glass ("wait stop"). */
export const P_GLASS = 6;

/** Index -> colour, so the hot arrays can stay numeric. */
export const PARTICLE_COLORS: readonly string[] = [
  PALETTE.green,
  PALETTE.green2,
  PALETTE.amber,
  PALETTE.red,
  PALETTE.blue,
  PALETTE.purple,
  PALETTE.white,
  PALETTE.fg1,
  '#9fd0ff',
  '#7ddf78',
];
export const C_GREEN = 0;
export const C_GREEN2 = 1;
export const C_AMBER = 2;
export const C_RED = 3;
export const C_BLUE = 4;
export const C_PURPLE = 5;
export const C_WHITE = 6;
export const C_FG1 = 7;
export const C_GLASS = 8;
export const C_TOKEN = 9;

/** Glyphs used for ship confetti and ambient code motes. */
const CONFETTI_GLYPHS = '{};()</>';
const SHEET_CELL = 8;
const SHEET_ROTS = 4;

interface ConfettiSheet {
  readonly canvas: HTMLCanvasElement;
  readonly cell: number;
}

let sheet: ConfettiSheet | null | undefined;

/**
 * Bake `glyph x rotation x colour` into one small sheet. Rotations are exact
 * 90-degree bit transposes rather than `ctx.rotate`, so nothing anti-aliases.
 */
function confettiSheet(): ConfettiSheet | null {
  if (sheet !== undefined) return sheet;
  const cols = CONFETTI_GLYPHS.length * PARTICLE_COLORS.length;
  const surf = createSurface(cols * SHEET_CELL, SHEET_ROTS * SHEET_CELL);
  if (!surf) {
    sheet = null;
    return null;
  }
  const ctx = surf.ctx;
  for (let ci = 0; ci < PARTICLE_COLORS.length; ci++) {
    ctx.fillStyle = PARTICLE_COLORS[ci]!;
    for (let gi = 0; gi < CONFETTI_GLYPHS.length; gi++) {
      const rows = glyphRows(CONFETTI_GLYPHS[gi]!);
      for (let rot = 0; rot < SHEET_ROTS; rot++) {
        const srcW = rot & 1 ? GLYPH_H : GLYPH_W;
        const srcH = rot & 1 ? GLYPH_W : GLYPH_H;
        const ox = (ci * CONFETTI_GLYPHS.length + gi) * SHEET_CELL + ((SHEET_CELL - srcW) >> 1);
        const oy = rot * SHEET_CELL + ((SHEET_CELL - srcH) >> 1);
        for (let r = 0; r < GLYPH_H; r++) {
          const row = rows[r]!;
          for (let c = 0; c < GLYPH_W; c++) {
            if (!(row & (4 >> c))) continue;
            let x: number;
            let y: number;
            if (rot === 0) {
              x = c;
              y = r;
            } else if (rot === 1) {
              x = GLYPH_H - 1 - r;
              y = c;
            } else if (rot === 2) {
              x = GLYPH_W - 1 - c;
              y = GLYPH_H - 1 - r;
            } else {
              x = r;
              y = GLYPH_W - 1 - c;
            }
            ctx.fillRect(ox + x, oy + y, 1, 1);
          }
        }
      }
    }
  }
  sheet = { canvas: surf.canvas, cell: SHEET_CELL };
  return sheet;
}

/** Test hook: force the confetti sheet to be rebuilt. */
export function resetConfettiSheet(): void {
  sheet = undefined;
}

export interface TextSpawn {
  color?: number;
  scale?: number;
  vy?: number;
  ttl?: number;
  shake?: number;
}

export class ParticleSystem {
  readonly capacity: number;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private readonly ttl: Float32Array;
  private readonly size: Float32Array;
  private readonly rot: Float32Array;
  private readonly vrot: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly seed: Float32Array;
  private readonly kind: Uint8Array;
  private readonly color: Uint8Array;
  private readonly glyph: Uint8Array;
  private readonly alive: Uint8Array;
  private readonly label: (string | null)[];
  /** Flight targets and arc height, for P_TOKEN. */
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;

  private readonly free: Int32Array;
  private freeTop: number;
  private live = 0;
  private stealCursor = 0;

  /** Lifetime counters — the pool-reuse assertions in the tests read these. */
  spawned = 0;
  recycled = 0;

  constructor(capacity: number = PARTICLE_CAP) {
    const cap = Math.max(1, Math.floor(capacity));
    this.capacity = cap;
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.ttl = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.vrot = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.seed = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.color = new Uint8Array(cap);
    this.glyph = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    this.label = new Array<string | null>(cap).fill(null);
    this.tx = new Float32Array(cap);
    this.ty = new Float32Array(cap);
    this.sx = new Float32Array(cap);
    this.sy = new Float32Array(cap);
    this.free = new Int32Array(cap);
    for (let i = 0; i < cap; i++) {
      this.free[i] = cap - 1 - i;
      // Per-slot low-discrepancy jitter. Fixed at construction so spawners can
      // read it immediately after alloc() — and deterministic, no Math.random.
      this.seed[i] = (i * 0.6180339887498949) % 1;
    }
    this.freeTop = cap;
  }

  get count(): number {
    return this.live;
  }

  /** Backing-array length. Must never change — the pool is allocated once. */
  get poolSize(): number {
    return this.px.length;
  }

  private alloc(): number {
    if (this.freeTop > 0) {
      this.freeTop--;
      const i = this.free[this.freeTop]!;
      this.alive[i] = 1;
      this.live++;
      this.spawned++;
      return i;
    }
    // Saturated: evict round-robin. O(1), and visually the oldest-ish particle.
    const i = this.stealCursor;
    this.stealCursor = (this.stealCursor + 1) % this.capacity;
    this.label[i] = null;
    this.spawned++;
    this.recycled++;
    return i;
  }

  private release(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.label[i] = null;
    this.live--;
    if (this.freeTop < this.capacity) {
      this.free[this.freeTop] = i;
      this.freeTop++;
    }
  }

  clear(): void {
    this.alive.fill(0);
    this.label.fill(null);
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i;
    this.freeTop = this.capacity;
    this.live = 0;
    this.stealCursor = 0;
  }

  private init(i: number, kind: number, x: number, y: number, ttl: number): void {
    this.kind[i] = kind;
    this.px[i] = x;
    this.py[i] = y;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.ttl[i] = ttl;
    this.life[i] = ttl;
    this.size[i] = 1;
    this.rot[i] = 0;
    this.vrot[i] = 0;
    this.grav[i] = 0;
    this.drag[i] = 0;
    this.glyph[i] = 0;
    this.label[i] = null;
  }

  // -- spawners ------------------------------------------------------------

  spawnText(x: number, y: number, text: string, o?: TextSpawn): void {
    const i = this.alloc();
    this.init(i, P_TEXT, x, y, o?.ttl ?? 0.95);
    this.label[i] = text;
    this.color[i] = o?.color ?? C_GREEN;
    this.size[i] = o?.scale ?? 1;
    this.vy[i] = o?.vy ?? -22;
    this.drag[i] = 1.2;
    this.vrot[i] = o?.shake ?? 0;
  }

  spawnMote(x: number, y: number, colorIdx = C_GREEN2): void {
    const i = this.alloc();
    const s = this.seed[i]!;
    this.init(i, P_MOTE, x + (s - 0.5) * 26, y, 1.1 + s * 0.9);
    this.color[i] = colorIdx;
    this.vx[i] = (s - 0.5) * 9;
    this.vy[i] = -10 - s * 14;
    this.size[i] = s > 0.7 ? 2 : 1;
    this.glyph[i] = Math.floor(s * CONFETTI_GLYPHS.length) % CONFETTI_GLYPHS.length;
  }

  /** The ship burst. Generous by design. */
  burstConfetti(x: number, y: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.alloc();
      const s = this.seed[i]!;
      const a = (k / Math.max(1, n)) * Math.PI * 2 + s * 1.7;
      const speed = 40 + s * 130;
      this.init(i, P_CONFETTI, x, y, 1.5 + s * 1.6);
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed - 60;
      this.grav[i] = 150 + s * 90;
      this.drag[i] = 0.45;
      this.rot[i] = s * Math.PI * 2;
      this.vrot[i] = (s - 0.5) * 12;
      this.size[i] = s > 0.82 ? 2 : 1;
      this.color[i] = k % 5 === 0 ? C_AMBER : k % 3 === 0 ? C_WHITE : k % 2 === 0 ? C_GREEN : C_BLUE;
      this.glyph[i] = k % CONFETTI_GLYPHS.length;
    }
  }

  /** Incident (bad) — angry red shrapnel. */
  burstShards(x: number, y: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.alloc();
      const s = this.seed[i]!;
      const a = (k / Math.max(1, n)) * Math.PI * 2;
      const speed = 90 + s * 150;
      this.init(i, P_SHARD, x, y, 0.35 + s * 0.4);
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed * 0.6;
      this.drag[i] = 2.6;
      this.size[i] = 2 + Math.floor(s * 4);
      this.color[i] = s > 0.75 ? C_WHITE : C_RED;
    }
  }

  /** Incident (good) / purchases — gold twinkle. */
  burstSparks(x: number, y: number, n: number, colorIdx = C_AMBER): void {
    for (let k = 0; k < n; k++) {
      const i = this.alloc();
      const s = this.seed[i]!;
      const a = (k / Math.max(1, n)) * Math.PI * 2 + s;
      const speed = 14 + s * 46;
      this.init(i, P_SPARK, x, y, 0.7 + s * 0.9);
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed - 18;
      this.grav[i] = 30;
      this.drag[i] = 1.1;
      this.size[i] = s > 0.8 ? 2 : 1;
      this.color[i] = k % 4 === 0 ? C_WHITE : colorIdx;
    }
  }

  /**
   * A token flying from (x0, y0) into the pile at (x1, y1), along an arc
   * `arc` pixels high. Tokens are faceless blocks; `size` 3 or 5.
   */
  spawnToken(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    o?: { ttl?: number; arc?: number; size?: number; color?: number },
  ): void {
    const i = this.alloc();
    const s = this.seed[i]!;
    this.init(i, P_TOKEN, x0, y0, o?.ttl ?? 0.55 + s * 0.25);
    this.sx[i] = x0;
    this.sy[i] = y0;
    this.tx[i] = x1;
    this.ty[i] = y1;
    // The arc height rides in `grav` for this kind: no gravity integration.
    this.grav[i] = o?.arc ?? 18 + s * 16;
    this.size[i] = o?.size ?? (s > 0.6 ? 5 : 3);
    this.color[i] = o?.color ?? C_TOKEN;
  }

  /** "wait stop": the glass lets go. Pale shards that fall and tumble. */
  burstGlass(x: number, y: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.alloc();
      const s = this.seed[i]!;
      const a = (k / Math.max(1, n)) * Math.PI * 2 + s * 0.8;
      const speed = 30 + s * 110;
      this.init(i, P_GLASS, x, y, 0.8 + s * 0.9);
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed - 30;
      this.grav[i] = 220;
      this.drag[i] = 0.8;
      this.size[i] = 1 + Math.floor(s * 3);
      this.vrot[i] = (s - 0.5) * 14;
      this.color[i] = s > 0.55 ? C_WHITE : C_GLASS;
    }
  }

  // -- simulation ----------------------------------------------------------

  update(dt: number): void {
    if (!(dt > 0)) return;
    const step = dt > 0.1 ? 0.1 : dt;
    const cap = this.capacity;
    const alive = this.alive;
    const life = this.life;
    const px = this.px;
    const py = this.py;
    const vx = this.vx;
    const vy = this.vy;
    const grav = this.grav;
    const drag = this.drag;
    const rot = this.rot;
    const vrot = this.vrot;
    const kind = this.kind;
    for (let i = 0; i < cap; i++) {
      if (alive[i] === 0) continue;
      const l = life[i]! - step;
      if (l <= 0) {
        this.release(i);
        continue;
      }
      life[i] = l;
      if (kind[i] === P_TOKEN) {
        // Along a quadratic curve: start, a control point `arc` above the
        // midpoint, the landing spot. Eases in so it drops onto the pile.
        const u = 1 - l / this.ttl[i]!;
        const t = u * u * (3 - 2 * u);
        const cx = (this.sx[i]! + this.tx[i]!) / 2;
        const cy = Math.min(this.sy[i]!, this.ty[i]!) - grav[i]!;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        px[i] = a * this.sx[i]! + b * cx + c * this.tx[i]!;
        py[i] = a * this.sy[i]! + b * cy + c * this.ty[i]!;
        continue;
      }
      const d = drag[i]!;
      if (d !== 0) {
        const f = 1 - d * step;
        const k = f < 0 ? 0 : f;
        vx[i] = vx[i]! * k;
        vy[i] = vy[i]! * k;
      }
      vy[i] = vy[i]! + grav[i]! * step;
      px[i] = px[i]! + vx[i]! * step;
      py[i] = py[i]! + vy[i]! * step;
      if (kind[i] !== P_TEXT) rot[i] = rot[i]! + vrot[i]! * step;
    }
  }

  // -- rendering -----------------------------------------------------------

  /** Returns the number of draw ops issued. */
  draw(ctx: CanvasRenderingContext2D, timeS: number): number {
    const cap = this.capacity;
    const alive = this.alive;
    let ops = 0;
    let lastFill = '';
    let lastAlpha = -1;
    const sh = confettiSheet();
    const prevAlpha = ctx.globalAlpha;

    for (let i = 0; i < cap; i++) {
      if (alive[i] === 0) continue;
      const t = this.life[i]! / this.ttl[i]!;
      const k = this.kind[i]!;
      const x = this.px[i]!;
      const y = this.py[i]!;
      const ci = this.color[i]!;

      if (k === P_TEXT) {
        const a = t > 0.75 ? 1 : t / 0.75;
        ctx.globalAlpha = a;
        lastAlpha = -1;
        const shake = this.vrot[i]!;
        const dx = shake === 0 ? 0 : Math.round(Math.sin(timeS * 47 + this.seed[i]! * 9) * shake);
        drawText(ctx, this.label[i] ?? '', Math.round(x) + dx, Math.round(y), PARTICLE_COLORS[ci]!, {
          scale: this.size[i]! >= 2 ? 2 : 1,
          align: 'center',
          shadow: PALETTE.bg0,
        });
        ops++;
        continue;
      }

      // Alpha quantised to 1/16 so consecutive particles usually share a value.
      const a = Math.max(0, Math.min(1, t * 1.4));
      const qa = Math.round(a * 16) / 16;
      if (qa <= 0) continue;
      if (qa !== lastAlpha) {
        ctx.globalAlpha = qa;
        lastAlpha = qa;
      }

      if (k === P_CONFETTI && sh) {
        const rotIdx = ((Math.floor(this.rot[i]! / (Math.PI / 2)) % SHEET_ROTS) + SHEET_ROTS) % SHEET_ROTS;
        const cell = sh.cell;
        const sx = (ci * CONFETTI_GLYPHS.length + this.glyph[i]!) * cell;
        const sy = rotIdx * cell;
        const s = this.size[i]!;
        ctx.drawImage(
          sh.canvas,
          sx,
          sy,
          cell,
          cell,
          Math.round(x) - ((cell * s) >> 1),
          Math.round(y) - ((cell * s) >> 1),
          cell * s,
          cell * s,
        );
        ops++;
        continue;
      }

      const fill = PARTICLE_COLORS[ci]!;
      if (fill !== lastFill) {
        ctx.fillStyle = fill;
        lastFill = fill;
      }

      if (k === P_SHARD) {
        const len = this.size[i]!;
        ctx.fillRect(Math.round(x), Math.round(y), len, 1);
        ops++;
      } else if (k === P_TOKEN) {
        // A tiny token: a lit square with a dark heart. Never eyes.
        const s = this.size[i]!;
        const rx = Math.round(x) - (s >> 1);
        const ry = Math.round(y) - (s >> 1);
        ctx.fillRect(rx, ry, s, s);
        ctx.fillStyle = s >= 5 ? '#1f6a2c' : '#2a8a37';
        ctx.fillRect(rx + 1, ry + 1, s - 2, s - 2);
        if (s >= 5) {
          ctx.fillStyle = fill;
          ctx.fillRect(rx + 2, ry + 2, 1, 1);
        }
        lastFill = '';
        ops += 3;
      } else if (k === P_GLASS) {
        const s = this.size[i]!;
        const spin = ((this.rot[i]! * 2) | 0) & 1;
        ctx.fillRect(Math.round(x), Math.round(y), spin ? s + 1 : 1, spin ? 1 : s + 1);
        ops++;
      } else if (k === P_SPARK) {
        const tw = ((timeS * 18 + this.seed[i]! * 10) | 0) & 1;
        const s = this.size[i]! + tw;
        ctx.fillRect(Math.round(x), Math.round(y), s, s);
        ops++;
      } else {
        // P_MOTE, and P_CONFETTI when no offscreen sheet is available.
        const s = this.size[i]!;
        ctx.fillRect(Math.round(x), Math.round(y), s, s);
        ops++;
      }
    }

    ctx.globalAlpha = prevAlpha;
    return ops;
  }
}

/** Exposed for the confetti-glyph sheet layout test. */
export const CONFETTI_GLYPH_SET = CONFETTI_GLYPHS;
