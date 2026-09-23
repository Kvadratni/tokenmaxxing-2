/**
 * TM Pixel: the chrome's pixel monospace, built at boot from a bitmap table.
 *
 * The concept art sets every word in a blocky pixel face, the repo ships no
 * font files and takes no dependencies, so the font is authored here as 5x7
 * bitmaps (lowercase with real descenders) and compiled into a TrueType file
 * in memory, then handed to the FontFace API. Every lit pixel becomes a square
 * contour on a 125-unit grid with 8 pixels to the em, so at any font-size that
 * is a multiple of 8 device pixels each glyph pixel lands on whole device
 * pixels and the text stays as crisp as the canvas beside it.
 *
 * The same outlines are registered at weight 400 and 700. A 5x7 face has no
 * room for a bold: smearing each glyph a pixel to the right, the usual bitmap
 * trick, closes every one-pixel counter (M, W, m, the dots of an ellipsis) and
 * turns them into blobs. Registering the 700 face stops the browser inventing
 * a bold of its own, so emphasis in the chrome is size and colour instead.
 * Anything the table does not cover (emoji, mostly) falls through to the next
 * font in the CSS stack.
 *
 *   installPixelFont();                    // once, at UI creation
 *   font-family: 'TM Pixel', ui-monospace, monospace;
 */

export const PIXEL_FONT_FAMILY = 'TM Pixel';

/** Font units per glyph pixel. */
const U = 125;
/** Glyph pixels per em: font-size 8px draws one glyph pixel per CSS pixel. */
export const PIXELS_PER_EM = 8;
const UNITS_PER_EM = U * PIXELS_PER_EM;
/** Cell advance in glyph pixels: 5 of glyph, 1 of spacing. */
export const ADVANCE_PX = 6;
/** Line box in glyph pixels: 1 above the caps, 7 of caps, 2 of descender. */
const ASCENT_PX = 8;
const DESCENT_PX = 2;
/** Rows authored per glyph: 7 above the baseline, then up to 2 of descender. */
const ROWS = 9;
const BASELINE_ROW = 6;

/**
 * Glyphs, top row first, `#` lit. Rows are 5 wide (6 for the joining dashes);
 * a glyph with fewer than 9 rows has no descender.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  ' ': '.....',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
  N: '#...#/#...#/##..#/#.#.#/#..##/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '...../...../.###./....#/.####/#...#/.####',
  b: '#..../#..../#.##./##..#/#...#/#...#/####.',
  c: '...../...../.###./#..../#..../#...#/.###.',
  d: '....#/....#/.##.#/#..##/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../.###.',
  f: '..##./.#..#/.#.../###../.#.../.#.../.#...',
  g: '...../...../.####/#...#/#...#/#...#/.####/....#/.###.',
  h: '#..../#..../#.##./##..#/#...#/#...#/#...#',
  i: '..#../...../.##../..#../..#../..#../.###.',
  j: '...#./...../..##./...#./...#./...#./...#./#..#./.##..',
  k: '#..../#..../#..#./#.#../##.../#.#../#..#.',
  l: '.##../..#../..#../..#../..#../..#../.###.',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#',
  n: '...../...../#.##./##..#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/.###.',
  p: '...../...../####./#...#/#...#/#...#/####./#..../#....',
  q: '...../...../.####/#...#/#...#/#...#/.####/....#/....#',
  r: '...../...../#.##./##..#/#..../#..../#....',
  s: '...../...../.###./#..../.###./....#/####.',
  t: '.#.../.#.../###../.#.../.#.../.#..#/..##.',
  u: '...../...../#...#/#...#/#...#/#..##/.##.#',
  v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#...#/#...#/#...#/#...#/.####/....#/.###.',
  z: '...../...../#####/...#./..#../.#.../#####',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  '1': '..#../.##../..#../..#../..#../..#../.###.',
  '2': '.###./#...#/....#/...#./..#../.#.../#####',
  '3': '#####/...#./..#../...#./....#/#...#/.###.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
  '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '..##./.#.../#..../####./#...#/#...#/.###.',
  '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/...#./.##..',
  '!': '..#../..#../..#../..#../..#../...../..#..',
  '"': '.#.#./.#.#./.#.#./...../...../...../.....',
  '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  $: '..#../.####/#.#../.###./..#.#/####./..#..',
  '%': '##.../##..#/...#./..#../.#.../#..##/...##',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
  "'": '..#../..#../.#.../...../...../...../.....',
  '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
  ')': '.#.../..#../...#./...#./...#./..#../.#...',
  '*': '...../..#../#.#.#/.###./#.#.#/..#../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  ',': '...../...../...../...../...../.##../..#../.#...',
  '-': '...../...../...../.###./...../...../.....',
  '.': '...../...../...../...../...../.##../.##..',
  '/': '...../....#/...#./..#../.#.../#..../.....',
  ':': '...../.##../.##../...../.##../.##../.....',
  ';': '...../.##../.##../...../.##../.##../..#../.#...',
  '<': '...#./..#../.#.../#..../.#.../..#../...#.',
  '=': '...../...../#####/...../#####/...../.....',
  '>': '.#.../..#../...#./....#/...#./..#../.#...',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  '@': '.###./#...#/....#/.##.#/#.#.#/#.#.#/.###.',
  '[': '.###./.#.../.#.../.#.../.#.../.#.../.###.',
  '\\': '...../#..../.#.../..#../...#./....#/.....',
  ']': '.###./...#./...#./...#./...#./...#./.###.',
  '^': '..#../.#.#./#...#/...../...../...../.....',
  _: '...../...../...../...../...../...../...../#####',
  '`': '.#.../..#../...../...../...../...../.....',
  '{': '...#./..#../..#../.#.../..#../..#../...#.',
  '|': '..#../..#../..#../..#../..#../..#../..#..',
  '}': '.#.../..#../..#../...#./..#../..#../.#...',
  '~': '...../...../.#.../#.#.#/...#./...../.....',
  // --- beyond ASCII: what the copy and the content actually use -----------
  '×': '...../#...#/.#.#./..#../.#.#./#...#/.....',
  '·': '...../...../...../..#../...../...../.....',
  '•': '...../...../.###./.###./.###./...../.....',
  '…': '...../...../...../...../...../...../#.#.#',
  '–': '...../...../...../#####/...../...../.....',
  '—': '....../....../....../######/....../....../......',
  '─': '....../....../....../######/....../....../......',
  '‘': '..#../.#.../.#.../...../...../...../.....',
  '’': '..#../..#../.#.../...../...../...../.....',
  '“': '.#.#./#.#../#.#../...../...../...../.....',
  '”': '.#.#./.#.#./#.#../...../...../...../.....',
  '→': '...../..#../...#./#####/...#./..#../.....',
  '←': '...../..#../.#.../#####/.#.../..#../.....',
  '↑': '..#../.###./#.#.#/..#../..#../..#../.....',
  '↓': '...../..#../..#../..#../#.#.#/.###./..#..',
  '✓': '...../....#/...##/#.##./###../.#.../.....',
  '✗': '...../#...#/.#.#./..#../.#.#./#...#/.....',
  '⚠': '..#../.#.#./.#.#./#.#.#/#...#/#.#.#/#####',
  '●': '...../.###./#####/#####/#####/.###./.....',
  '▋': '####./####./####./####./####./####./####./####./####.',
  '█': '#####/#####/#####/#####/#####/#####/#####/#####/#####',
  '░': '#.#.#/.#.#./#.#.#/.#.#./#.#.#/.#.#./#.#.#/.#.#./#.#.#',
  '▸': '...../.#.../.##../.###./.##../.#.../.....',
};

/** Every character the font draws, space included. */
export const PIXEL_FONT_CHARS: string = Object.keys(GLYPHS).join('');

interface Bitmap {
  /** `grid[row][col]`, rows top to bottom (0..8), row 6 sits on the baseline. */
  readonly grid: readonly (readonly boolean[])[];
  readonly width: number;
}

function parseGlyph(src: string): Bitmap {
  const rows = src.split('/');
  const width = Math.max(...rows.map((r) => r.length));
  const grid: boolean[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row = rows[r] ?? '';
    const cells: boolean[] = [];
    for (let c = 0; c < width; c++) cells.push(row[c] === '#');
    grid.push(cells);
  }
  return { grid, width };
}

/** Pixel-space rectangle, y up, baseline at 0. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Lit pixels as a few rectangles: horizontal runs per row, then runs stacked
 * straight down merged into one taller rectangle. Fewer points, same union.
 */
function rectsOf(b: Bitmap): Rect[] {
  const done: Rect[] = [];
  let open = new Map<string, Rect>();
  for (let r = 0; r < ROWS; r++) {
    const row = b.grid[r] ?? [];
    const next = new Map<string, Rect>();
    const top = BASELINE_ROW + 1 - r;
    for (let c = 0; c < b.width; ) {
      if (!row[c]) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < b.width && row[e + 1]) e++;
      const key = `${c}:${e}`;
      const prev = open.get(key);
      if (prev) {
        prev.y0 = top - 1;
        next.set(key, prev);
        open.delete(key);
      } else {
        next.set(key, { x0: c, x1: e + 1, y1: top, y0: top - 1 });
      }
      c = e + 1;
    }
    for (const rect of open.values()) done.push(rect);
    open = next;
  }
  for (const rect of open.values()) done.push(rect);
  return done;
}

// ---------------------------------------------------------------------------
// TrueType writer
// ---------------------------------------------------------------------------

class Bytes {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.room(1);
    this.view.setUint8(this.length, v & 0xff);
    this.length += 1;
    return this;
  }

  u16(v: number): this {
    this.room(2);
    this.view.setUint16(this.length, v & 0xffff);
    this.length += 2;
    return this;
  }

  i16(v: number): this {
    this.room(2);
    this.view.setInt16(this.length, v);
    this.length += 2;
    return this;
  }

  u32(v: number): this {
    this.room(4);
    this.view.setUint32(this.length, v >>> 0);
    this.length += 4;
    return this;
  }

  tag(s: string): this {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i) || 0x20);
    return this;
  }

  bytes(b: Uint8Array): this {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  pad4(): this {
    while (this.length % 4 !== 0) this.u8(0);
    return this;
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const padded = Math.ceil(data.length / 4) * 4;
  for (let i = 0; i < padded; i += 4) {
    const word =
      ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

interface BuiltGlyph {
  readonly data: Uint8Array;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly points: number;
  readonly contours: number;
}

const EMPTY_GLYPH: BuiltGlyph = {
  data: new Uint8Array(0),
  xMin: 0,
  yMin: 0,
  xMax: 0,
  yMax: 0,
  points: 0,
  contours: 0,
};

function buildGlyph(b: Bitmap): BuiltGlyph {
  const rects = rectsOf(b);
  if (rects.length === 0) return EMPTY_GLYPH;
  // Clockwise, as TrueType wants outer contours: up the left, across, down.
  const pts: Array<[number, number]> = [];
  for (const r of rects) {
    pts.push([r.x0 * U, r.y0 * U], [r.x0 * U, r.y1 * U], [r.x1 * U, r.y1 * U], [r.x1 * U, r.y0 * U]);
  }
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const [x, y] of pts) {
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  }
  const w = new Bytes();
  w.i16(rects.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  for (let i = 0; i < rects.length; i++) w.u16(i * 4 + 3);
  w.u16(0); // no instructions
  // Flag 0x01: on-curve, and both coordinates written as full int16 deltas.
  for (let i = 0; i < pts.length; i++) w.u8(0x01);
  let px = 0;
  for (const [x] of pts) {
    w.i16(x - px);
    px = x;
  }
  let py = 0;
  for (const [, y] of pts) {
    w.i16(y - py);
    py = y;
  }
  w.pad4();
  return { data: w.done(), xMin, yMin, xMax, yMax, points: pts.length, contours: rects.length };
}

/** The `.notdef` box: never drawn in practice, since the CSS stack falls back first. */
const NOTDEF = parseGlyph('#####/#...#/#...#/#...#/#...#/#...#/#####');

function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

function nameTable(style: string): Uint8Array {
  const ps = `TMPixel-${style}`;
  const names: Array<[number, string]> = [
    [1, PIXEL_FONT_FAMILY],
    [2, style],
    [3, `${PIXEL_FONT_FAMILY} ${style} 1.0`],
    [4, `${PIXEL_FONT_FAMILY} ${style}`],
    [5, 'Version 1.000'],
    [6, ps],
  ];
  const strings = names.map(([, s]) => utf16be(s));
  const w = new Bytes();
  w.u16(0).u16(names.length).u16(6 + names.length * 12);
  let offset = 0;
  names.forEach(([id], i) => {
    const len = strings[i]!.length;
    w.u16(3).u16(1).u16(0x0409).u16(id).u16(len).u16(offset);
    offset += len;
  });
  for (const s of strings) w.bytes(s);
  return w.done();
}

function cmapTable(codes: readonly number[]): Uint8Array {
  // Glyph ids are assigned in code order from 1, so every run of consecutive
  // code points is one segment with a constant delta.
  const segs: Array<{ start: number; end: number; delta: number }> = [];
  codes.forEach((code, i) => {
    const gid = i + 1;
    const last = segs[segs.length - 1];
    if (last && code === last.end + 1 && gid - code === last.delta) last.end = code;
    else segs.push({ start: code, end: code, delta: gid - code });
  });
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const pow = 2 ** Math.floor(Math.log2(n));
  const sub = new Bytes();
  sub
    .u16(4)
    .u16(16 + 8 * n)
    .u16(0)
    .u16(n * 2)
    .u16(pow * 2)
    .u16(Math.log2(pow))
    .u16(n * 2 - pow * 2);
  for (const s of segs) sub.u16(s.end);
  sub.u16(0);
  for (const s of segs) sub.u16(s.start);
  for (const s of segs) sub.u16(s.delta & 0xffff);
  for (let i = 0; i < n; i++) sub.u16(0);
  const body = sub.done();
  const w = new Bytes();
  // Two encoding records onto the same subtable: Unicode BMP and Windows BMP.
  w.u16(0).u16(2);
  w.u16(0).u16(3).u32(20);
  w.u16(3).u16(1).u32(20);
  w.bytes(body);
  return w.done();
}

/** Compile the font. Pure: every call returns a byte-identical file. */
export function buildPixelFont(): ArrayBuffer {
  const style = 'Regular';
  const advance = ADVANCE_PX * U;

  const entries = Object.entries(GLYPHS)
    .map(([ch, src]) => ({ code: ch.codePointAt(0) ?? 0, src }))
    .filter((e) => e.code > 0 && e.code < 0xffff)
    .sort((a, b) => a.code - b.code);
  const codes = entries.map((e) => e.code);
  const glyphs: BuiltGlyph[] = [buildGlyph(NOTDEF), ...entries.map((e) => buildGlyph(parseGlyph(e.src)))];
  const numGlyphs = glyphs.length;

  // glyf + loca (long offsets)
  const glyf = new Bytes();
  const loca = new Bytes();
  for (const g of glyphs) {
    loca.u32(glyf.length);
    glyf.bytes(g.data);
  }
  loca.u32(glyf.length);

  let xMin = 0;
  let yMin = 0;
  let xMax = 0;
  let yMax = 0;
  let maxPoints = 0;
  let maxContours = 0;
  let minRsb = advance;
  for (const g of glyphs) {
    if (g.contours === 0) continue;
    xMin = Math.min(xMin, g.xMin);
    yMin = Math.min(yMin, g.yMin);
    xMax = Math.max(xMax, g.xMax);
    yMax = Math.max(yMax, g.yMax);
    maxPoints = Math.max(maxPoints, g.points);
    maxContours = Math.max(maxContours, g.contours);
    minRsb = Math.min(minRsb, advance - g.xMax);
  }

  const ascent = ASCENT_PX * U;
  const descent = DESCENT_PX * U;

  const head = new Bytes()
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment, patched below
    .u32(0x5f0f3cf5)
    .u16(0x000b)
    .u16(UNITS_PER_EM)
    .u32(0)
    .u32(0) // created
    .u32(0)
    .u32(0) // modified
    .i16(xMin)
    .i16(yMin)
    .i16(xMax)
    .i16(yMax)
    .u16(0)
    .u16(8)
    .i16(2)
    .i16(1) // long loca
    .i16(0)
    .done();

  const hhea = new Bytes()
    .u32(0x00010000)
    .i16(ascent)
    .i16(-descent)
    .i16(0)
    .u16(advance)
    .i16(0)
    .i16(minRsb)
    .i16(xMax)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(numGlyphs)
    .done();

  const hmtx = new Bytes();
  for (const g of glyphs) hmtx.u16(advance).i16(g.contours === 0 ? 0 : g.xMin);

  const maxp = new Bytes()
    .u32(0x00010000)
    .u16(numGlyphs)
    .u16(maxPoints)
    .u16(maxContours)
    .u16(0)
    .u16(0)
    .u16(1) // maxZones
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .done();

  const os2 = new Bytes()
    .u16(4)
    .i16(advance)
    .u16(400)
    .u16(5)
    .u16(0)
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(75)
    .i16(650)
    .i16(600)
    .i16(0)
    .i16(350)
    .i16(U)
    .i16(3 * U)
    .i16(0);
  // PANOSE: Latin text, monospaced.
  for (const b of [2, 0, 5, 9, 0, 0, 0, 0, 0, 0]) os2.u8(b);
  os2
    .u32(0x80000003) // Basic Latin, Latin-1, General Punctuation
    .u32(0x0000f820) // arrows, box drawing, blocks, shapes, symbols, dingbats
    .u32(0)
    .u32(0)
    .tag('TMPX')
    .u16(0x0040 | 0x0080) // REGULAR + USE_TYPO_METRICS
    .u16(Math.min(...codes))
    .u16(Math.min(0xffff, Math.max(...codes)))
    .i16(ascent)
    .i16(-descent)
    .i16(0)
    .u16(ascent)
    .u16(descent)
    .u32(1)
    .u32(0)
    .i16(5 * U)
    .i16(7 * U)
    .u16(0)
    .u16(0x20)
    .u16(1);

  const post = new Bytes()
    .u32(0x00030000)
    .u32(0)
    .i16(-U)
    .i16(U)
    .u32(1) // isFixedPitch
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .done();

  const tables: Array<[string, Uint8Array]> = [
    ['OS/2', os2.done()],
    ['cmap', cmapTable(codes)],
    ['glyf', glyf.done()],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx.done()],
    ['loca', loca.done()],
    ['maxp', maxp],
    ['name', nameTable(style)],
    ['post', post],
  ];

  const n = tables.length;
  const pow = 2 ** Math.floor(Math.log2(n));
  const out = new Bytes();
  out
    .u32(0x00010000)
    .u16(n)
    .u16(pow * 16)
    .u16(Math.log2(pow))
    .u16(n * 16 - pow * 16);
  let offset = 12 + n * 16;
  const placed: number[] = [];
  for (const [tag, data] of tables) {
    out.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    placed.push(offset);
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const [, data] of tables) out.bytes(data).pad4();
  const file = out.done();

  // head.checkSumAdjustment makes the whole file sum to the magic constant.
  const headIndex = tables.findIndex(([tag]) => tag === 'head');
  const headAt = placed[headIndex] ?? 0;
  const adjust = (0xb1b0afba - checksum(file)) >>> 0;
  new DataView(file.buffer, file.byteOffset, file.byteLength).setUint32(headAt + 8, adjust);
  const out2 = new ArrayBuffer(file.length);
  new Uint8Array(out2).set(file);
  return out2;
}

let installing: Promise<boolean> | null = null;

/**
 * Register both faces with `document.fonts`. Idempotent; resolves `false`
 * where the FontFace API is missing (a test DOM) or the browser refuses the
 * file, in which case the CSS stack's monospace fallback simply stays up.
 */
export function installPixelFont(doc: Document = document): Promise<boolean> {
  if (installing) return installing;
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (typeof FontFace === 'undefined' || fonts === undefined || typeof fonts.add !== 'function') {
    return Promise.resolve(false);
  }
  installing = (async (): Promise<boolean> => {
    try {
      const file = buildPixelFont();
      const faces = [
        new FontFace(PIXEL_FONT_FAMILY, file, { weight: '400', style: 'normal' }),
        new FontFace(PIXEL_FONT_FAMILY, file.slice(0), { weight: '700', style: 'normal' }),
      ];
      for (const face of faces) fonts.add(face);
      await Promise.all(faces.map((f) => f.load()));
      return true;
    } catch {
      return false;
    }
  })();
  return installing;
}
