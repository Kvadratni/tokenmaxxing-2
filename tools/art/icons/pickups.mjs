/**
 * UI icons for the drifting pickups: `pickup_<id>`. Same shapes as the stage
 * sprites (shape + accent from content.ts), redrawn at icon size.
 */
import { PAL, agentGlyph, art, outlined, tokenGlyph } from './kit.mjs';
import { legacy } from './legacy.mjs';

export const PICKUP_ICONS = Object.freeze({
  // One token worth the whole paragraph.
  pickup_golden_token: () => outlined(
    (cv) => tokenGlyph(cv, 3, 3, 10, PAL.amber, PAL.amber),
    (cv) => {
      cv.hline(3, 12, 3, PAL.white);
      cv.put(3, 4, PAL.white);
      cv.rect(7, 7, 2, 2, PAL.white);
    },
  ),

  // Seen it before. A fifth of your context, freed.
  pickup_cache_hit: () => art([
    '................',
    '................',
    '....b..b..b.....',
    '...bbbbbbbbbb...',
    '..bbbbbbbbbbbb..',
    '...bddddddddb...',
    '..bbdwwwwwwdbb..',
    '...bdwwwwwwdb...',
    '..bbddddddddbb..',
    '...bbbbbbbbbb...',
    '....b..b..b.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { b: PAL.blue, d: PAL.bg0, w: PAL.white }),

  // The human said thanks.
  pickup_thanks_note: () => art([
    '................',
    '................',
    '..wwwwwwwwwwww..',
    '.wwwwwwwwwwwwww.',
    '.wwddddwwwwddww.',
    '.wwwwwwwwwwddww.',
    '.wwdddddddwddww.',
    '.wwwwwwwwwwwwww.',
    '.wwddddwwwwddww.',
    '..wwwwwwwwwwww..',
    '...ww...........',
    '...w............',
    '..w.............',
    '................',
    '................',
    '................',
  ], { w: PAL.white, d: PAL.fg2 }),

  // Accepted answer: the green tick on a stack of replies.
  pickup_stack_overflow: () => art([
    '................',
    '................',
    '..aaaaaaaaaaa...',
    '..a.........a...',
    '..a.aaaaaaa.a...',
    '..a.........a..g',
    '..a.aaaaa...a.gg',
    '..a........gagg.',
    '..a.aaaaaagggg..',
    '..a.......gga...',
    '..aaaaaaaaaaa...',
    '...a............',
    '..a.............',
    '................',
    '................',
    '................',
  ], { a: PAL.amber, g: PAL.green }),

  // Explained the bug to a duck. The duck fixed it.
  pickup_rubber_duck: legacy('rubber_duck'),

  // Somebody wrote docs. Unheard of.
  pickup_documentation: () => art([
    '................',
    '................',
    '...pppppppppp...',
    '...plppppppppw..',
    '...plpwwwwppw...',
    '...plppppppppw..',
    '...plpwwwppppw..',
    '...plppppppppw..',
    '...plppppppppw..',
    '...plppppppppw..',
    '...plppppppppw..',
    '...plpppppppppw.',
    '...pwwwwwwwwwww.',
    '................',
    '................',
    '................',
  ], { p: PAL.purple, l: PAL.bg3, w: PAL.fg0 }),

  // It is a feature now.
  pickup_a_bug: () => art([
    '................',
    '....f......f....',
    '.....f....f.....',
    '......dddd......',
    '..f..rrrrrr..f..',
    '...frrrbbrrrf...',
    '....rrrbbrrr....',
    '..ffrrrbbrrrff..',
    '....rrrbbrrr....',
    '...frrrbbrrrf...',
    '..f..rrrrrr..f..',
    '......rrrr......',
    '................',
    '................',
    '................',
    '................',
  ], { f: PAL.fg2, d: PAL.bg3, r: PAL.red, b: PAL.bg0 }),

  // The human pressed the button.
  pickup_thumbs_up: () => art([
    '................',
    '......gg........',
    '.....ggg........',
    '.....ggg........',
    '....ggg.........',
    '..dggggggggg....',
    '..dggggggggg....',
    '..dgggggdddd....',
    '..dgggggggg.....',
    '..dgggggdddd....',
    '..dgggggggg.....',
    '..dggggggg......',
    '................',
    '................',
    '................',
    '................',
  ], { g: PAL.green, d: PAL.green2 }),

  // Crit chance way up, briefly.
  pickup_sparkles: () => art([
    '................',
    '.............a..',
    '.....a......aaa.',
    '.....a.......a..',
    '....aaa.........',
    '....aaa.........',
    '.aaaaaaaaa......',
    '....aaa.........',
    '....aaa...a.....',
    '.....a....a.....',
    '.....a..aaaaa...',
    '..........a.....',
    '..........a.....',
    '................',
    '................',
    '................',
  ], { a: PAL.amber }, (cv) => {
    cv.put(5, 6, PAL.white);
    cv.put(10, 10, PAL.white);
  }),

  // A stray agent. It works for you now: it arrives with a bow on.
  pickup_free_subagent: () => outlined(
    (cv) => {
      agentGlyph(cv, 5, 5, 6, 8);
      cv.vline(6, 13, 14, PAL.green);
      cv.vline(9, 13, 14, PAL.green);
      cv.rect(6, 2, 4, 2, PAL.red);
      cv.put(5, 1, PAL.red);
      cv.put(10, 1, PAL.red);
    },
    (cv) => {
      cv.put(6, 7, PAL.white);
      cv.put(9, 7, PAL.white);
      cv.put(7, 3, PAL.white);
    },
  ),
});
