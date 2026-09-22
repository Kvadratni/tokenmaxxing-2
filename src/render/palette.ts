/**
 * Single source of colour truth for the whole game.
 *
 * RENDER draws with these; UI imports the same constants and injects
 * `paletteCss()` into a <style> so the DOM chrome matches the canvas exactly.
 * Nothing else in the codebase should hard-code a hex value.
 */

export const PALETTE = {
  bg0: '#14161a',
  bg1: '#1e2127',
  bg2: '#252a31',
  bg3: '#2f353e',
  line: '#3c434e',
  fg2: '#6b7482',
  fg1: '#9aa4b2',
  fg0: '#d7dee8',
  green: '#4ec94e',
  green2: '#2f8f3a',
  amber: '#e8b34a',
  red: '#e5484d',
  blue: '#4a9de8',
  purple: '#9b6bd6',
  white: '#f2f6fb',
} as const;

export type PaletteKey = keyof typeof PALETTE;

export const PALETTE_KEYS = Object.keys(PALETTE) as PaletteKey[];

/** CSS custom-property prefix. `--tm-green`, `--tm-green-rgb`, ... */
export const CSS_VAR_PREFIX = '--tm-';

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const rgbCache = new Map<string, Rgb>();

/** Parse `#rgb` / `#rrggbb`. Unparseable input degrades to mid-grey. */
export function hexToRgb(hex: string): Rgb {
  const cached = rgbCache.get(hex);
  if (cached) return cached;
  let r = 128;
  let g = 128;
  let b = 128;
  const h = hex.charCodeAt(0) === 35 /* # */ ? hex.slice(1) : hex;
  if (h.length === 3) {
    r = parseInt(h[0]! + h[0]!, 16);
    g = parseInt(h[1]! + h[1]!, 16);
    b = parseInt(h[2]! + h[2]!, 16);
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    r = 128;
    g = 128;
    b = 128;
  }
  const out: Rgb = { r, g, b };
  rgbCache.set(hex, out);
  return out;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const hex2 = (v: number): string => {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  return (n < 16 ? '0' : '') + n.toString(16);
};

/** `#rrggbb` -> `rgba(r,g,b,a)`. Accepts a palette key or a raw hex string. */
export function rgba(color: PaletteKey | string, alpha: number): string {
  const hex = (PALETTE as Record<string, string>)[color] ?? color;
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

/** Linear blend between two colours. `t = 0` -> a, `t = 1` -> b. */
export function mix(a: PaletteKey | string, b: PaletteKey | string, t: number): string {
  const ca = hexToRgb((PALETTE as Record<string, string>)[a] ?? a);
  const cb = hexToRgb((PALETTE as Record<string, string>)[b] ?? b);
  const k = clamp01(t);
  return `#${hex2(ca.r + (cb.r - ca.r) * k)}${hex2(ca.g + (cb.g - ca.g) * k)}${hex2(ca.b + (cb.b - ca.b) * k)}`;
}

/** Multiply a colour's channels — cheap "brighter"/"darker" for procedural art. */
export function shade(color: PaletteKey | string, factor: number): string {
  const { r, g, b } = hexToRgb((PALETTE as Record<string, string>)[color] ?? color);
  return `#${hex2(r * factor)}${hex2(g * factor)}${hex2(b * factor)}`;
}

/**
 * A `:root { ... }` block declaring every palette entry as a CSS custom
 * property, plus an `-rgb` triple companion for `rgb(var(--tm-x-rgb) / 40%)`.
 */
export function paletteCss(selector = ':root'): string {
  const lines: string[] = [`${selector} {`];
  for (const key of PALETTE_KEYS) {
    const hex = PALETTE[key];
    const { r, g, b } = hexToRgb(hex);
    lines.push(`  ${CSS_VAR_PREFIX}${key}: ${hex};`);
    lines.push(`  ${CSS_VAR_PREFIX}${key}-rgb: ${r}, ${g}, ${b};`);
  }
  lines.push('}');
  return lines.join('\n');
}
