/**
 * Achievement icons, keyed by each achievement's `icon` field (achv_<id>).
 * Each one is a small trophy of its own joke. The five that carried over from
 * Tokenmaxxing 1 with the same name and joke keep their game 1 drawing, and
 * The Agent Went To Lunch borrows game 1's AFK chair, which is the same joke.
 * See ./kit.mjs for the house rules.
 */
import { PAL, art, outlined, pixels, text } from './kit.mjs';
import { legacy } from './legacy.mjs';

/**
 * A halo is painted outside the outline pass (game 1's Nice Try does the same
 * with its sparkle lines), so the hole in the ring stays see-through instead
 * of filling up with outline.
 */
const halo = (cv, x, y, rows) => pixels(cv, x, y, rows, { a: PAL.amber, w: PAL.white });

export const ACHIEVEMENT_ICONS = Object.freeze({
  // --- visible ---------------------------------------------------------------

  // Report done on a prompt. Honestly, even. The tick does not fit the screen.
  achv_works_on_my_machine: () => art([
    '................',
    '................',
    '............gg..',
    '...........ggg..',
    '..sssssssssgg...',
    '..sbbbbbbbggs...',
    '..sbgbbbbggbs...',
    '..sbggbbggbbs...',
    '..sbbggggbbbs...',
    '..sbbbggbbbbs...',
    '..sssssssssss...',
    '.kkkkkkkkkkkkk..',
    '..ssssssssssss..',
    '................',
    '................',
    '................',
  ], { s: PAL.fg2, b: PAL.bg0, g: PAL.green, k: PAL.fg1 }),

  // First compaction. Nothing important was lost.
  achv_compacted: () => art([
    '................',
    '................',
    '................',
    '..ssssssssssss..',
    '....ssssssssss..',
    '......sssssss...',
    '.......sssss....',
    '......sssssss...',
    '.....sssssssss..',
    '..gggggggggggg..',
    '..ggwwggggwwgg..',
    '..gggggggggggg..',
    '.g.g........g.g.',
    '................',
    '................',
    '................',
  ], { s: PAL.fg2, g: PAL.green, w: PAL.white }),

  // Five prompts without a forced compaction: a hard hat with a token on it.
  achv_context_engineer: () => art([
    '................',
    '................',
    '................',
    '................',
    '......aaaa......',
    '....aaawwaaa....',
    '...aaaawwaaaa...',
    '...aaaggggaaa...',
    '...aaagbbgaaa...',
    '...aaagbbgaaa...',
    '...aaaggggaaa...',
    '..bbbbbbbbbbbb..',
    '..aaaaaaaaaaaa..',
    '..aaaaaaaaaaaa..',
    '................',
    '................',
  ], { a: PAL.amber, w: PAL.white, g: PAL.green, b: PAL.bg0 }),

  // All ten prompts. The human built AGI. Allegedly. It shipped, anyway.
  achv_shipped_to_prod: () => art([
    '................',
    '................',
    '.......rr.......',
    '......rrrr......',
    '......wwww......',
    '.....wwwwww.....',
    '.....wwbbww.....',
    '.....wwbbww.....',
    '.....wwwwww.....',
    '....rwwwwwwr....',
    '...rrwwwwwwrr...',
    '...rr.wwww.rr...',
    '......aaaa......',
    '.......aa.......',
    '................',
    '................',
  ], { r: PAL.red, w: PAL.fg0, b: PAL.bg0, a: PAL.amber }),

  // Three wins, three stripes.
  achv_senior_engineer: () => art([
    '................',
    '................',
    '.......aa.......',
    '......aaaa......',
    '.....aa..aa.....',
    '....aa.aa.aa....',
    '...aa.aaaa.aa...',
    '...a.aa..aa.a...',
    '....aa.aa.aa....',
    '...aa.aaaa.aa...',
    '...a.aa..aa.a...',
    '....aa....aa....',
    '...aa......aa...',
    '...a........a...',
    '................',
    '................',
  ], { a: PAL.amber }),

  // Same name, same joke, same thumb as game 1.
  achv_absolutely_right: legacy('achv_absolutely_right'),

  // The 1M context window: a haystack, and somewhere in it, the needle.
  achv_needle_haystack: () => art([
    '................',
    '................',
    '.............w..',
    '............w...',
    '.......a.a.w....',
    '......aaaaaw....',
    '.....aaaaaaaa...',
    '.....abaaabaa...',
    '....aabaabaaaa..',
    '....abaabaabaa..',
    '...aabaabaabaa..',
    '...abaabaabaaba.',
    '..aabaabaabaaba.',
    '..aaaaaaaaaaaaa.',
    '................',
    '................',
  ], { a: PAL.amber, b: PAL.bg0, w: PAL.white }),

  // Same name, same joke as game 1.
  achv_tokenmaxxed: legacy('achv_tokenmaxxed'),

  // Twenty-five subagents: an org chart, and you are finally management.
  achv_delegation: () => art([
    '................',
    '................',
    '.....ggggg......',
    '.....gwgwg......',
    '.....ggggg......',
    '.....ggggg......',
    '.......l........',
    '...lllllllll....',
    '...l...l...l....',
    '..ggg.ggg.ggg...',
    '..wgw.wgw.wgw...',
    '..ggg.ggg.ggg...',
    '..ggg.ggg.ggg...',
    '..g.g.g.g.g.g...',
    '................',
    '................',
  ], { g: PAL.green, w: PAL.white, l: PAL.fg2 }),

  // A win without a single Claim Done: the agent, with a halo.
  achv_honest_work: () => art([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....gggggg.....',
    '.....gwggwg.....',
    '.....gwggwg.....',
    '.....gggggg.....',
    '.....gggggg.....',
    '.....gggggg.....',
    '......g..g......',
    '................',
    '................',
  ], { g: PAL.green, w: PAL.white }, (cv) => halo(cv, 3, 1, [
    '..aawwaa..',
    '.a......a.',
    'a........a',
    '.a......a.',
    '..aaaaaa..',
  ])),

  // Ten runs. Pour one out for 2.0.
  achv_deprecated: () => art([
    '................',
    '................',
    '......sssss.....',
    '....sssssssss...',
    '...sssssssssd...',
    '...sbbssssbbbd..',
    '...sssbsssbsbd..',
    '...ssbssssbsbd..',
    '...sbsssssbsbd..',
    '...sbbbsbsbbbd..',
    '...ssssssssssd..',
    '...ssssssssssd..',
    '..dddddddddddd..',
    '..gggggggggggg..',
    '................',
    '................',
  ], { s: PAL.fg1, b: PAL.bg0, d: PAL.fg2, g: PAL.green2 }),

  // Over 90% patience left: the human, pleased, for once.
  achv_human_said_thanks: () => art([
    '................',
    '................',
    '.........rr.rr..',
    '.........rrrrr..',
    '..........rrr...',
    '.....hhhhh.r....',
    '....hhhhhhh.....',
    '...hhhfffhhh....',
    '..hhhfffffhhh...',
    '..hhfgfffgfhh...',
    '..hhgfgfgfghh...',
    '..hhhfffffhhh...',
    '..hhhhhhhhhhh...',
    '.hhhhhhhhhhhhh..',
    '................',
    '................',
  ], { h: PAL.fg2, f: PAL.bg0, g: PAL.green, r: PAL.red }),

  // --- hidden ----------------------------------------------------------------

  // Same name, same joke as game 1 (the checksum noticed again).
  achv_script_kiddie: legacy('achv_script_kiddie'),

  // Same name, same joke as game 1.
  achv_nice_try: legacy('achv_nice_try'),

  // A Tokenmaxxing 1 save: the floppy, labelled 1.
  achv_returning_customer: () => art([
    '................',
    '................',
    '................',
    '...bbbffffbb....',
    '...bbbfkkfbbb...',
    '...bbbfkkfbbbb..',
    '...bbbffffbbbb..',
    '...bbbbbbbbbbb..',
    '...bbwwwwwwwbb..',
    '...bbwwwbwwwbb..',
    '...bbwwbbwwwbb..',
    '...bbwwwbwwwbb..',
    '...bbwwwbwwwbb..',
    '...bbwwbbbwwbb..',
    '................',
    '................',
  ], { b: PAL.blue, f: PAL.fg1, k: PAL.bg0, w: PAL.fg0 }),

  // A tampered game 1 save. The human cheats too, then: the gavel comes down.
  achv_legal_notified: () => art([
    '................',
    '................',
    '................',
    '.......wa.......',
    '......aawa......',
    '.....aaaaw......',
    '....aaaaa.......',
    '...waaaa........',
    '...awaa.aa......',
    '....aw...aa.....',
    '..........aa....',
    '...sssss...aa...',
    '..sssssss...a...',
    '..sssssss.......',
    '................',
    '................',
  ], { a: PAL.amber, w: PAL.fg0, s: PAL.fg2 }),

  // Caught claiming done: red and blue lights.
  achv_ran_the_tests: () => art([
    '................',
    '................',
    '................',
    '..w....ww....w..',
    '...w...ww...w...',
    '................',
    '......rrbb......',
    '.....rwrbbb.....',
    '....rrwrbbbb....',
    '....rrrrbbbb....',
    '....rrrrbbbb....',
    '...wwwwwwwwww...',
    '..wwwwwwwwwwww..',
    '................',
    '................',
    '................',
  ], { r: PAL.red, b: PAL.blue, w: PAL.white }),

  // Five uncaught claims in one run: the agent, masked, leaving with a golden token.
  achv_perfect_crime: () => outlined(
    (cv) => {
      cv.rect(2, 2, 6, 11, PAL.green);
      cv.rect(1, 4, 8, 2, PAL.bg0);
      cv.put(3, 5, PAL.white);
      cv.put(6, 5, PAL.white);
      cv.put(3, 13, PAL.green);
      cv.put(6, 13, PAL.green);
      cv.rect(8, 7, 6, 6, PAL.amber);
    },
    (cv) => {
      cv.rect(9, 8, 4, 4, PAL.bg0);
      cv.rect(10, 9, 2, 2, PAL.amber);
      cv.put(13, 7, PAL.white);
    },
  ),

  // Auto Mode approved it: a lit bomb, labelled rm.
  achv_rm_rf: () => outlined(
    (cv) => {
      cv.disc(7, 9, 4.5, PAL.fg2);
      cv.rect(9, 3, 2, 2, PAL.fg2);
      cv.line(11, 3, 12, 2, PAL.amber);
    },
    (cv) => {
      text(cv, 4, 7, 'RM', PAL.white);
      for (const [x, y] of [[13, 1], [13, 3], [11, 1]]) cv.put(x, y, PAL.amber);
    },
  ),

  // Five compactions in one run: the alarm clock, 6:00 again.
  achv_groundhog_day: () => art([
    '................',
    '................',
    '..aaa......aaa..',
    '..aa..rrrr..aa..',
    '....rrffffrr....',
    '...rffffbfffr...',
    '...rffffbfffr...',
    '..rfffffbffffr..',
    '..rfffffbffffr..',
    '..rfffffbffffr..',
    '...rffffbfffr...',
    '...rffffffffr...',
    '....rrffffrr....',
    '...r..rrrr..r...',
    '................',
    '................',
  ], { a: PAL.amber, r: PAL.red, f: PAL.fg0, b: PAL.bg0 }),

  // Ten "You're absolutely right"s in ten seconds: an apple for the human.
  achv_sycophant: () => art([
    '................',
    '................',
    '.......k.gg.w...',
    '.......kgg.www..',
    '....rrrkrrr.w...',
    '...rrrrrrrrr....',
    '..rrwwrrrrrrr...',
    '..rrwrrrrrrrr...',
    '..rrrrrrrrrrr...',
    '..rrrrrrrrrrr...',
    '..rrrrrrrrrrr...',
    '...rrrrrrrrr....',
    '....rrr.rrr.....',
    '................',
    '................',
    '................',
  ], { r: PAL.red, g: PAL.green, w: PAL.white, k: PAL.bg0 }),

  // Caught lying under MAKE NO MISTAKES: the badge, and the halo slipping off.
  achv_made_mistakes: () => art([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...wwwwwwwwww...',
    '...wwwwwwwwww...',
    '...wwrrwwrrww...',
    '...wwwrrrrwww...',
    '....wwwrrwww....',
    '....wwrrrrww....',
    '.....rrwwrr.....',
    '.......ww.......',
    '................',
    '................',
  ], { w: PAL.fg0, r: PAL.red }, (cv) => halo(cv, 2, 1, [
    '.aaaa.....',
    'a....aa...',
    '.a.....a..',
    '..aaaaa...',
  ])),

  // PLEASE and THANK YOU: another ten million dollars, gift-wrapped.
  achv_please_thank_you: () => art([
    '................',
    '................',
    '...rr......rr...',
    '...rrrr..rrrr...',
    '....rrrrrrrr....',
    '...rrr.aa.rrr...',
    '.....aaaaaa.....',
    '....aaaabbaa....',
    '...aaaabbaaaa...',
    '..aaaaaabaaaaa..',
    '..aaaaaaabbaaa..',
    '..aaaaaabbaaaa..',
    '...aaaaaaaaaa...',
    '....aaaaaaaa....',
    '................',
    '................',
  ], { a: PAL.amber, b: PAL.bg0, r: PAL.red }),

  // Same name, same joke as game 1: the test harness, clamped on.
  achv_qa_engineer: legacy('achv_qa_engineer'),

  // Idle for five minutes. The human did not notice. Lunch: game 1's burger,
  // which reads as lunch at 1x where an empty chair reads as a grey smudge.
  achv_agent_went_to_lunch: legacy('achv_full_stack'),
});
