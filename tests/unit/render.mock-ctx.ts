/**
 * Test support for the RENDER unit suites.
 *
 * happy-dom has no real 2D context (`canvas.getContext('2d')` returns null), so
 * the renderer would otherwise degrade to its no-op path and assert nothing.
 * This module builds a `CanvasRenderingContext2D` stand-in that records every
 * call and property write in order, plus a canvas whose bounding rect tracks the
 * CSS size the renderer applies.
 */

export interface MockCall {
  readonly op: string;
  readonly args: readonly unknown[];
}

export interface MockCtx {
  readonly calls: MockCall[];
  /** Every recorded call with this op name. */
  ops(op: string): MockCall[];
  count(op: string): number;
  reset(): void;
  [key: string]: unknown;
}

const RECORD_LIMIT = 400_000;

const METHODS = [
  'save',
  'restore',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'arcTo',
  'rect',
  'ellipse',
  'fill',
  'stroke',
  'clip',
  'clearRect',
  'fillRect',
  'strokeRect',
  'translate',
  'scale',
  'rotate',
  'transform',
  'setTransform',
  'resetTransform',
  'drawImage',
  'putImageData',
  'setLineDash',
  'fillText',
  'strokeText',
] as const;

const PROPS: Readonly<Record<string, unknown>> = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  filter: 'none',
};

export function createMockCtx(canvas: HTMLCanvasElement): MockCtx {
  const calls: MockCall[] = [];
  const record = (op: string, args: readonly unknown[]): void => {
    if (calls.length < RECORD_LIMIT) calls.push({ op, args });
  };

  const ctx = {
    canvas,
    calls,
    ops(op: string): MockCall[] {
      return calls.filter((c) => c.op === op);
    },
    count(op: string): number {
      let n = 0;
      for (const c of calls) if (c.op === op) n++;
      return n;
    },
    reset(): void {
      calls.length = 0;
    },
    createImageData(w: number, h: number) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' };
    },
    getImageData(_x: number, _y: number, w: number, h: number) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' };
    },
    measureText(text: string) {
      return { width: text.length * 6 };
    },
    createLinearGradient() {
      return { addColorStop(): void {} };
    },
    createRadialGradient() {
      return { addColorStop(): void {} };
    },
    createPattern() {
      return null;
    },
  } as unknown as MockCtx;

  for (const name of METHODS) {
    ctx[name] = (...args: unknown[]): void => record(name, args);
  }

  const store = new Map<string, unknown>(Object.entries(PROPS));
  for (const key of Object.keys(PROPS)) {
    Object.defineProperty(ctx, key, {
      get: () => store.get(key),
      set: (v: unknown) => {
        store.set(key, v);
        record(`set:${key}`, [v]);
      },
      enumerable: true,
      configurable: true,
    });
  }

  return ctx;
}

export interface MockCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: MockCtx;
  readonly host: HTMLElement;
  /** How many times `getBoundingClientRect()` has been read on the canvas. */
  rectReads: () => number;
}

export interface MockCanvasOptions {
  left?: number;
  top?: number;
  /** Return null from getContext, exercising the headless degradation path. */
  noContext?: boolean;
  /** Attach the canvas to a host element inside document.body. */
  attach?: boolean;
}

/**
 * A canvas whose `getBoundingClientRect()` reflects whatever CSS size the
 * renderer applied — that is what makes `toScene()` round-trip assertions real.
 */
export function makeCanvas(opts: MockCanvasOptions = {}): MockCanvas {
  const left = opts.left ?? 0;
  const top = opts.top ?? 0;
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  if (opts.attach !== false) {
    host.appendChild(canvas);
    document.body.appendChild(host);
  }

  const ctx = createMockCtx(canvas);
  let reads = 0;
  const target = canvas as unknown as {
    getContext: (id: string) => unknown;
    getBoundingClientRect: () => DOMRect;
  };
  target.getContext = () => (opts.noContext ? null : ctx);
  target.getBoundingClientRect = (): DOMRect => {
    reads++;
    const w = parseFloat(canvas.style.width || '') || canvas.width || 0;
    const h = parseFloat(canvas.style.height || '') || canvas.height || 0;
    return {
      x: left,
      y: top,
      left,
      top,
      right: left + w,
      bottom: top + h,
      width: w,
      height: h,
      toJSON: () => ({}),
    } as DOMRect;
  };

  return { canvas, ctx, host, rectReads: () => reads };
}

/** Records observe/disconnect so `destroy()` can be proven to detach. */
export class SpyResizeObserver {
  static instances: SpyResizeObserver[] = [];
  observed = 0;
  unobserved = 0;
  disconnected = 0;
  constructor(readonly cb: unknown) {
    SpyResizeObserver.instances.push(this);
  }
  observe(): void {
    this.observed++;
  }
  unobserve(): void {
    this.unobserved++;
  }
  disconnect(): void {
    this.disconnected++;
  }
  static reset(): void {
    SpyResizeObserver.instances = [];
  }
}
