/**
 * TM Pixel, the chrome's font, is compiled in memory from a bitmap table. A
 * browser silently falls back to monospace if the file is malformed, so the
 * TrueType structure is checked here: the table directory, the checksums,
 * the character map and the metrics. (It was also loaded into Chromium by
 * hand: `document.fonts` reports it `loaded`.)
 */
import { describe, expect, it } from 'vitest';
import {
  ADVANCE_PX,
  buildPixelFont,
  installPixelFont,
  PIXEL_FONT_CHARS,
  PIXEL_FONT_FAMILY,
  PIXELS_PER_EM,
} from '../../src/ui/pixel-font.ts';

interface Table {
  offset: number;
  length: number;
  checksum: number;
}

function tables(buf: ArrayBuffer): Map<string, Table> {
  const v = new DataView(buf);
  const n = v.getUint16(4);
  const out = new Map<string, Table>();
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
    out.set(tag, { checksum: v.getUint32(at + 4), offset: v.getUint32(at + 8), length: v.getUint32(at + 12) });
  }
  return out;
}

function sum(buf: ArrayBuffer, offset: number, length: number): number {
  const bytes = new Uint8Array(buf, offset, length);
  let s = 0;
  for (let i = 0; i < Math.ceil(length / 4) * 4; i += 4) {
    const w = ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    s = (s + (w >>> 0)) >>> 0;
  }
  return s;
}

/** Glyph id for a code point, read back out of the format-4 cmap. */
function glyphOf(buf: ArrayBuffer, code: number): number {
  const v = new DataView(buf);
  const cmap = tables(buf).get('cmap')!;
  const count = v.getUint16(cmap.offset + 2);
  let sub = -1;
  for (let i = 0; i < count; i++) {
    const rec = cmap.offset + 4 + i * 8;
    if (v.getUint16(rec) === 3 && v.getUint16(rec + 2) === 1) sub = cmap.offset + v.getUint32(rec + 4);
  }
  expect(sub, 'no Windows BMP subtable').toBeGreaterThan(0);
  expect(v.getUint16(sub)).toBe(4);
  const segX2 = v.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  for (let i = 0; i < segX2 / 2; i++) {
    const end = v.getUint16(ends + i * 2);
    const start = v.getUint16(starts + i * 2);
    if (code >= start && code <= end) return (code + v.getUint16(deltas + i * 2)) & 0xffff;
  }
  return 0;
}

describe('TM Pixel', () => {
  const font = buildPixelFont();
  const t = tables(font);

  it('has the tables a TrueType font needs, in tag order', () => {
    const tags = [...t.keys()];
    for (const tag of ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']) {
      expect(tags, tag).toContain(tag);
    }
    expect(tags).toEqual([...tags].sort());
  });

  it('checksums every table, and the whole file sums to the magic number', () => {
    for (const [tag, rec] of t) {
      if (tag === 'head') continue; // checksummed with its adjustment zeroed
      expect(sum(font, rec.offset, rec.length), tag).toBe(rec.checksum);
      expect(rec.offset % 4, `${tag} is 4-byte aligned`).toBe(0);
      expect(rec.offset + rec.length).toBeLessThanOrEqual(font.byteLength);
    }
    expect(sum(font, 0, font.byteLength)).toBe(0xb1b0afba);
  });

  it('has a sane head and an 8-pixel em', () => {
    const v = new DataView(font);
    const head = t.get('head')!.offset;
    expect(v.getUint32(head + 12)).toBe(0x5f0f3cf5);
    const upem = v.getUint16(head + 18);
    expect(upem % PIXELS_PER_EM).toBe(0);
    expect(v.getInt16(head + 50), 'long loca').toBe(1);
  });

  it('maps every character it claims, and nothing else, to a glyph', () => {
    const v = new DataView(font);
    const numGlyphs = v.getUint16(t.get('maxp')!.offset + 4);
    expect(numGlyphs).toBe([...PIXEL_FONT_CHARS].length + 1);
    for (const ch of PIXEL_FONT_CHARS) {
      const g = glyphOf(font, ch.codePointAt(0)!);
      expect(g, JSON.stringify(ch)).toBeGreaterThan(0);
      expect(g).toBeLessThan(numGlyphs);
    }
    expect(glyphOf(font, '👍'.charCodeAt(0))).toBe(0);
  });

  it('covers the text the chrome and the content actually use', () => {
    const needed = "TOKENS 184.20K PROMPT 3/10 \"ok do it\" CONTEXT WINDOW × · … — → ✓ ⚠ ● ▋ YOU'RE ABSOLUTELY RIGHT ’";
    for (const ch of needed) expect(PIXEL_FONT_CHARS.includes(ch), JSON.stringify(ch)).toBe(true);
    for (let c = 32; c < 127; c++) expect(PIXEL_FONT_CHARS.includes(String.fromCharCode(c)), String(c)).toBe(true);
  });

  it('is monospaced: every glyph advances the same six pixels', () => {
    const v = new DataView(font);
    const upem = v.getUint16(t.get('head')!.offset + 18);
    const numGlyphs = v.getUint16(t.get('maxp')!.offset + 4);
    const hmtx = t.get('hmtx')!.offset;
    for (let i = 0; i < numGlyphs; i++) {
      expect(v.getUint16(hmtx + i * 4)).toBe((upem / PIXELS_PER_EM) * ADVANCE_PX);
    }
  });

  it('keeps loca monotonic and inside glyf', () => {
    const v = new DataView(font);
    const loca = t.get('loca')!;
    const glyf = t.get('glyf')!;
    let prev = 0;
    for (let i = 0; i < loca.length / 4; i++) {
      const off = v.getUint32(loca.offset + i * 4);
      expect(off).toBeGreaterThanOrEqual(prev);
      prev = off;
    }
    expect(prev).toBe(glyf.length);
  });

  it('is deterministic', () => {
    expect(new Uint8Array(buildPixelFont())).toEqual(new Uint8Array(font));
  });

  it('declines quietly where the FontFace API is missing', async () => {
    expect(PIXEL_FONT_FAMILY).toBe('TM Pixel');
    const fake = {} as Document;
    await expect(installPixelFont(fake)).resolves.toBe(false);
  });
});
