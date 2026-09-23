/**
 * HUD glyphs: ui_thumbs, ui_context, ui_patience, ui_compact, ui_claim.
 */
import { PAL, art } from './kit.mjs';

export const UI_ICONS = Object.freeze({
  // The meta currency: a thumbs-up, struck like a coin.
  ui_thumbs: () => art([
    '................',
    '....aaaaaaaa....',
    '...aaaaawwaaa...',
    '..aaaaawwwaaaa..',
    '.aaaaaawwwaaaaa.',
    '.aaaaawwwaaaaaa.',
    '.aaddwwwwwwwwaa.',
    '.aaddwwwwwffffa.',
    '.aaddwwwwwwwwaa.',
    '.aaddwwwwwffffa.',
    '.aaddwwwwwwwaaa.',
    '.aaddwwwwwwwaaa.',
    '..aaaaaaaaaaaa..',
    '...aaaaaaaaaa...',
    '....aaaaaaaa....',
    '................',
  ], { a: PAL.amber, w: PAL.white, d: PAL.fg2, f: PAL.fg2 }),

  // The context window: a frame, half full of tokens.
  ui_context: () => art([
    '................',
    '..ffffffffffff..',
    '..f..........f..',
    '..f..........f..',
    '..f..........f..',
    '..f..........f..',
    '..f.ggg......f..',
    '..f.g.g......f..',
    '..f.ggg.ggg..f..',
    '..f.....g.g..f..',
    '..f.ggg.gggggf..',
    '..f.g.g.gg.g.f..',
    '..f.gggggggg.f..',
    '..ffffffffffff..',
    '................',
    '................',
  ], { f: PAL.fg2, g: PAL.green }),

  // The human's patience: the hood, the two green eyes.
  ui_patience: () => art([
    '................',
    '.....hhhhhh.....',
    '....hhhhhhhh....',
    '...hhhffffhhh...',
    '...hhffffffhh...',
    '..hhfffffffhhh..',
    '..hhfgfffgffhh..',
    '..hhfffffffhhh..',
    '..hhffffffffhh..',
    '..hhhffffffhhh..',
    '..hhhhffffhhhh..',
    '.hhhhhhhhhhhhhh.',
    '.hhhhhhhhhhhhhh.',
    '................',
    '................',
    '................',
  ], { h: PAL.fg2, f: PAL.bg0, g: PAL.green }),

  // /compact: two walls pushing in on a rolled summary.
  ui_compact: () => art([
    '................',
    '................',
    '.r............r.',
    '.rr..........rr.',
    '.rrr........rrr.',
    '.rrrr......rrrr.',
    '.rrr.wwwwww.rrr.',
    '.rrr.wffffw.rrr.',
    '.rrr.wwwwww.rrr.',
    '.rrrr......rrrr.',
    '.rrr........rrr.',
    '.rr..........rr.',
    '.r............r.',
    '................',
    '................',
    '................',
  ], { r: PAL.red, w: PAL.fg0, f: PAL.fg2 }),

  // Claim done: a confident tick, with the failing X tucked behind it.
  ui_claim: () => art([
    '................',
    '................',
    '..........x...x.',
    '...........x.x..',
    '..aaaaaaaa..x...',
    '..a......a.x.x..',
    '..a.....aax...x.',
    '..a....aa.a.....',
    '..aa..aa..a.....',
    '..a.aaa...a.....',
    '..a..a....a.....',
    '..a.......a.....',
    '..aaaaaaaaa.....',
    '................',
    '................',
    '................',
  ], { a: PAL.amber, x: PAL.red }),
});
