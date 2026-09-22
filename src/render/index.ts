/**
 * Public surface of the renderer.
 *
 * `createRenderer(canvas)` returns a `Renderer` (from src/sim/types.ts) widened
 * with `renderStats()`, `metrics()` and `whenReady()`. It never throws — a host
 * without a 2D context degrades to coordinate maths plus a no-op `draw()`.
 */
export { createRenderer } from './scene.ts';
export type { RenderStats, RendererOptions, SceneRenderer } from './scene.ts';

export {
  CSS_VAR_PREFIX,
  PALETTE,
  PALETTE_KEYS,
  hexToRgb,
  mix,
  paletteCss,
  rgba,
  shade,
} from './palette.ts';
export type { PaletteKey, Rgb } from './palette.ts';

export {
  CHAR_ADVANCE,
  GLYPH_H,
  GLYPH_W,
  LINE_HEIGHT,
  SUPPORTED_CHARS,
  clearTextCache,
  drawText,
  formatCompact,
  glyphRows,
  isSupported,
  measureText,
  textHeight,
} from './text.ts';
export type { TextOptions } from './text.ts';

export { MAX_DPR, computeScale, createSurface, hitsLaptop } from './canvas.ts';
export type { ScaleResult, ViewMetrics, ViewportOptions } from './canvas.ts';

export { PARTICLE_CAP, ParticleSystem } from './particles.ts';
export { SpriteSystem } from './sprites.ts';
export { SCENE_KEYS, paintBackdrop, sceneAccent } from './backdrop.ts';
export {
  DESK_TOP,
  DEV_ANCHOR,
  DEV_RECT,
  LAPTOP_ART,
  LAPTOP_SCREEN_CENTER,
} from './layout.ts';
