/**
 * Canvas plumbing: scale fitting, DPR handling and pointer -> scene
 * coordinate maths.
 *
 * The scene is always exactly SCENE_WIDTH x SCENE_HEIGHT logical pixels. Below
 * 2x DPR the canvas is an *integer* multiple of that, so every scene pixel
 * lands on a whole number of device pixels: the difference between crisp
 * pixel art and a shimmering mess. At 2x and up there are device pixels to
 * spare, and the UI (src/ui/scale.ts) sizes the stage box at a fractional
 * `--px`; the canvas then fills that box exactly, so the DOM hit box laid over
 * the agent in `--px` units lands on the agent the canvas draws.
 */
import { SCENE_HEIGHT, SCENE_WIDTH } from '../sim/types.ts';
import { AGENT_RECT } from './atlas-types.ts';
import { PALETTE } from './palette.ts';

export interface ScaleResult {
  /**
   * CSS pixels per scene pixel. Always >= 1; a whole number below 2x DPR, the
   * exact fit of the host box at 2x DPR and above.
   */
  readonly scale: number;
  /** Device pixel ratio actually used (clamped, finite). */
  readonly dpr: number;
  /** Device pixels per scene pixel == scale * dpr. */
  readonly pixelScale: number;
  /** CSS size applied to the canvas element. */
  readonly cssW: number;
  readonly cssH: number;
  /** Backing store size (canvas.width / canvas.height). */
  readonly backingW: number;
  readonly backingH: number;
}

/** Largest DPR we will back a canvas at. Beyond this the memory cost dwarfs the gain. */
export const MAX_DPR = 4;

/** At and above this DPR the canvas takes the exact (fractional) fit. Matches src/ui/scale.ts. */
export const FRACTIONAL_MIN_DPR = 2;

/** Round a CSS length to 1/1000 px, so 320 * (864 / 320) is 864, not 863.9999. */
const cssRound = (v: number): number => Math.round(v * 1000) / 1000;

/** Pure, testable core of the fitting maths. */
export function computeScale(availW: number, availH: number, dprRaw: number): ScaleResult {
  const dpr =
    Number.isFinite(dprRaw) && dprRaw > 0 ? Math.min(MAX_DPR, Math.max(0.5, dprRaw)) : 1;
  const w = Number.isFinite(availW) && availW > 0 ? availW : 0;
  const h = Number.isFinite(availH) && availH > 0 ? availH : 0;
  const fit = Math.min(w / SCENE_WIDTH, h / SCENE_HEIGHT);
  // Never zero, never below 1. Below 2x DPR, whole numbers only; at 2x and
  // up, the exact fit, so the canvas fills the stage box the UI sized.
  let scale = 1;
  if (Number.isFinite(fit)) scale = dpr >= FRACTIONAL_MIN_DPR ? Math.max(1, fit) : Math.max(1, Math.floor(fit));
  const pixelScale = scale * dpr;
  return {
    scale,
    dpr,
    pixelScale,
    cssW: cssRound(SCENE_WIDTH * scale),
    cssH: cssRound(SCENE_HEIGHT * scale),
    backingW: Math.round(SCENE_WIDTH * pixelScale),
    backingH: Math.round(SCENE_HEIGHT * pixelScale),
  };
}

export interface ViewMetrics extends ScaleResult {
  /** Cached canvas bounding-box origin in client coordinates. */
  readonly left: number;
  readonly top: number;
}

export interface Measurement {
  readonly w: number;
  readonly h: number;
}

export interface ViewportOptions {
  /** Override the available-space probe (tests, embedded hosts). */
  measure?: () => Measurement;
  /** Override the device pixel ratio probe. */
  dpr?: () => number;
  /** Fired after every applied resize. */
  onResize?: (m: ViewMetrics) => void;
}

const IDENTITY: ViewMetrics = {
  scale: 1,
  dpr: 1,
  pixelScale: 1,
  cssW: SCENE_WIDTH,
  cssH: SCENE_HEIGHT,
  backingW: SCENE_WIDTH,
  backingH: SCENE_HEIGHT,
  left: 0,
  top: 0,
};

/**
 * Owns the display canvas element: sizing, transform, listener lifecycle and
 * the cached bounding rect that `toScene()` reads. Nothing here may be called
 * from inside `draw()` — measuring forces layout.
 */
export class Viewport {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly opts: ViewportOptions;
  private m: ViewMetrics = IDENTITY;
  private ro: ResizeObserver | null = null;
  private mql: MediaQueryList | null = null;
  private observedHost: Element | null = null;
  private disposed = false;

  private readonly onWindowResize = (): void => {
    this.resize();
  };
  private readonly onDprChange = (): void => {
    this.watchDpr();
    this.resize();
  };

  constructor(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D | null,
    opts: ViewportOptions = {},
  ) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.opts = opts;
    this.attach();
    this.resize();
  }

  get metrics(): ViewMetrics {
    return this.m;
  }

  private host(): Element | null {
    return this.canvas.parentElement;
  }

  private measure(): Measurement {
    if (this.opts.measure) return this.opts.measure();
    const host = this.host();
    if (host) {
      const r = host.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        return { w: host.clientWidth, h: host.clientHeight };
      }
    }
    if (typeof window !== 'undefined' && window.innerWidth > 0) {
      return { w: window.innerWidth, h: window.innerHeight };
    }
    return { w: SCENE_WIDTH, h: SCENE_HEIGHT };
  }

  private currentDpr(): number {
    if (this.opts.dpr) return this.opts.dpr();
    return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  }

  private attach(): void {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', this.onWindowResize, { passive: true });
      window.addEventListener('orientationchange', this.onWindowResize, { passive: true });
    }
    const host = this.host();
    if (host && typeof ResizeObserver === 'function') {
      try {
        this.ro = new ResizeObserver(this.onWindowResize);
        this.ro.observe(host);
        this.observedHost = host;
      } catch {
        this.ro = null;
      }
    }
    this.watchDpr();
  }

  private watchDpr(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.unwatchDpr();
    try {
      const q = window.matchMedia(`(resolution: ${this.currentDpr()}dppx)`);
      if (typeof q.addEventListener === 'function') {
        q.addEventListener('change', this.onDprChange);
        this.mql = q;
      }
    } catch {
      this.mql = null;
    }
  }

  private unwatchDpr(): void {
    const q = this.mql;
    if (q && typeof q.removeEventListener === 'function') {
      q.removeEventListener('change', this.onDprChange);
    }
    this.mql = null;
  }

  /** Re-fit the canvas. Safe to call as often as you like; cheap when nothing changed. */
  resize(): void {
    if (this.disposed) return;
    const { w, h } = this.measure();
    const s = computeScale(w, h, this.currentDpr());
    const c = this.canvas;

    if (c.width !== s.backingW) c.width = s.backingW;
    if (c.height !== s.backingH) c.height = s.backingH;

    const style = c.style;
    if (style) {
      const cw = `${s.cssW}px`;
      const ch = `${s.cssH}px`;
      if (style.width !== cw) style.width = cw;
      if (style.height !== ch) style.height = ch;
      // Nearest-neighbour upscaling if the browser ever has to resample.
      style.imageRendering = 'pixelated';
      style.display = 'block';
      // Centre inside whatever box the host gives us; the gutter shows bg0.
      style.margin = 'auto';
      style.backgroundColor = PALETTE.bg0;
      style.touchAction = 'manipulation';
    }

    // Cache the client rect exactly once per resize — never inside draw().
    let left = 0;
    let top = 0;
    if (typeof c.getBoundingClientRect === 'function') {
      const r = c.getBoundingClientRect();
      left = r.left;
      top = r.top;
    }

    this.m = { ...s, left, top };
    this.applyBaseTransform();
    this.opts.onResize?.(this.m);
  }

  /** Reset the context so one unit == one scene pixel. Call at the top of every frame. */
  applyBaseTransform(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = this.m.pixelScale;
    ctx.setTransform(p, 0, 0, p, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  /**
   * Client (pointer-event) coordinates -> 320x180 scene coordinates.
   *
   * Measured live rather than read from the cached metrics. The cache is
   * refreshed on resize, but an element can *move* without ever resizing: on a
   * viewport too narrow for the stage, the canvas gets offset (left went to
   * -125 on a phone) while its size is unchanged. The stale origin then sent
   * every tap tens of scene pixels away from where it landed, so the click
   * target's hit test failed and touch input did nothing at all (game 1 found
   * this the hard way; the agent inherits the fix).
   *
   * This runs once per pointer event and never inside `draw()`, so the layout
   * read costs nothing that matters.
   */
  toScene(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const measured = r.width > 0 && r.height > 0;
    const s = measured ? r.width / SCENE_WIDTH : this.m.scale || 1;
    const left = measured ? r.left : this.m.left;
    const top = measured ? r.top : this.m.top;
    return { x: (clientX - left) / (s || 1), y: (clientY - top) / (s || 1) };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this.onWindowResize);
      window.removeEventListener('orientationchange', this.onWindowResize);
    }
    if (this.ro) {
      try {
        if (this.observedHost) this.ro.unobserve(this.observedHost);
        this.ro.disconnect();
      } catch {
        /* observer already torn down */
      }
      this.ro = null;
      this.observedHost = null;
    }
    this.unwatchDpr();
  }
}

/**
 * True when the scene-space point is inside the agent's hit box (half-open
 * rect). NaN and infinities never hit.
 */
export function hitsAgent(x: number, y: number): boolean {
  return (
    x >= AGENT_RECT.x &&
    x < AGENT_RECT.x + AGENT_RECT.w &&
    y >= AGENT_RECT.y &&
    y < AGENT_RECT.y + AGENT_RECT.h
  );
}

/**
 * Allocate an offscreen drawing surface for pre-rendering. Returns null in
 * environments without a real 2D context (jsdom / happy-dom), where every
 * caller falls back to immediate-mode drawing.
 */
export function createSurface(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  if (!(w > 0) || !(h > 0)) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w);
    canvas.height = Math.ceil(h);
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.fillRect !== 'function') return null;
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  } catch {
    return null;
  }
}
