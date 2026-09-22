/**
 * `palette.ts` is the single source of colour truth — UI imports the same
 * constants and injects `paletteCss()`. These assertions are the contract.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CSS_VAR_PREFIX,
  PALETTE,
  PALETTE_KEYS,
  hexToRgb,
  mix,
  paletteCss,
  rgba,
  shade,
} from '../../src/render/palette.ts';

const EXPECTED: Readonly<Record<string, string>> = {
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
};

describe('PALETTE', () => {
  it('matches the brief exactly', () => {
    expect({ ...PALETTE }).toEqual(EXPECTED);
  });

  it('exposes its keys in declaration order', () => {
    expect(PALETTE_KEYS).toEqual(Object.keys(EXPECTED));
  });

  it('every value is a 6-digit lowercase hex', () => {
    for (const key of PALETTE_KEYS) {
      expect(PALETTE[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('paletteCss', () => {
  it('emits a custom property and an rgb triple per colour', () => {
    const css = paletteCss();
    expect(css.startsWith(':root {')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
    for (const key of PALETTE_KEYS) {
      const { r, g, b } = hexToRgb(PALETTE[key]);
      expect(css).toContain(`${CSS_VAR_PREFIX}${key}: ${PALETTE[key]};`);
      expect(css).toContain(`${CSS_VAR_PREFIX}${key}-rgb: ${r}, ${g}, ${b};`);
    }
  });

  it('accepts a custom selector', () => {
    expect(paletteCss('.tm-theme').startsWith('.tm-theme {')).toBe(true);
  });

  it('declares exactly two properties per colour and nothing else', () => {
    const decls = paletteCss()
      .split('\n')
      .filter((l) => l.includes(':') && l.trim().endsWith(';'));
    expect(decls).toHaveLength(PALETTE_KEYS.length * 2);
  });
});

describe('drift guard against src/styles/palette.css', () => {
  // UI keeps a hand-written CSS copy so the DOM chrome has no coupling to the
  // renderer module graph. That is fine — but the two must never disagree.
  const path = new URL('../../src/styles/palette.css', import.meta.url).pathname;

  it('every palette entry the CSS declares matches this file exactly', () => {
    if (!existsSync(path)) return; // UI has not landed it yet
    const css = readFileSync(path, 'utf8');
    for (const key of PALETTE_KEYS) {
      const m = new RegExp(`--(?:tm-)?${key}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(css);
      if (!m) continue;
      expect(m[1]!.toLowerCase(), `--${key} has drifted from PALETTE.${key}`).toBe(PALETTE[key]);
    }
  });

  it('the CSS declares every colour in the palette', () => {
    if (!existsSync(path)) return;
    const css = readFileSync(path, 'utf8');
    for (const key of PALETTE_KEYS) {
      expect(css, `src/styles/palette.css is missing --${key}`).toMatch(
        new RegExp(`--(?:tm-)?${key}:`),
      );
    }
  });
});

describe('colour helpers', () => {
  it('hexToRgb parses long and short forms', () => {
    expect(hexToRgb('#4ec94e')).toEqual({ r: 78, g: 201, b: 78 });
    expect(hexToRgb('4ec94e')).toEqual({ r: 78, g: 201, b: 78 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('hexToRgb degrades rather than throwing', () => {
    expect(() => hexToRgb('not a colour')).not.toThrow();
    expect(hexToRgb('')).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('rgba accepts palette keys and raw hex, and clamps alpha', () => {
    expect(rgba('green', 0.5)).toBe('rgba(78,201,78,0.5)');
    expect(rgba('#4ec94e', 0.5)).toBe('rgba(78,201,78,0.5)');
    expect(rgba('red', 5)).toBe('rgba(229,72,77,1)');
    expect(rgba('red', -2)).toBe('rgba(229,72,77,0)');
  });

  it('mix interpolates and clamps t', () => {
    expect(mix('bg0', 'bg0', 0.5)).toBe('#14161a');
    expect(mix('white', 'bg0', 0)).toBe('#f2f6fb');
    expect(mix('white', 'bg0', 1)).toBe('#14161a');
    expect(mix('white', 'bg0', 5)).toBe('#14161a');
    expect(mix('white', 'bg0', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('shade brightens and darkens without overflowing', () => {
    expect(shade('white', 2)).toBe('#ffffff');
    expect(shade('white', 0)).toBe('#000000');
    expect(shade('green', 1)).toBe('#4ec94e');
  });
});
