/**
 * Training tree icons: `meta_<id>` for every META_UPGRADES node. See ./kit.mjs
 * for the house rules.
 *
 * Branch colours help the tree read at a glance: context blue/green, tool use
 * green, alignment white/blue, reward hacking red/amber, inference purple,
 * prompting amber. The six tool unlocks share one open padlock in the
 * bottom-right corner, so they read as a set and never as the tool itself.
 */
import { PAL, art, outlined, pixels } from './kit.mjs';
import { legacy } from './legacy.mjs';

const K = PAL.bg0;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Paint an ASCII sprite over whatever is already there, inside a 1px bg0 halo. */
function haloed(cv, x, y, rows, colors) {
  const on = (r, c) => r >= 0 && r < rows.length && c >= 0 && c < rows[r].length && rows[r][c] !== '.';
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      if (!on(r, c)) continue;
      for (const [dx, dy] of N4) if (!on(r + dy, c + dx)) cv.put(x + c + dx, y + r + dy, K);
    }
  });
  pixels(cv, x, y, rows, colors);
}

/** The unlock badge: a small padlock with its shackle lifted clear on the right. */
const PADLOCK = [
  '.aaa.',
  'a...a',
  'a....',
  'aaaaa',
  'aakaa',
  'aaaaa',
];

/** A tool motif (ASCII, kept to the top-left) with the open padlock on its corner. */
const unlocked = (rows, colors) => outlined((cv) => {
  pixels(cv, 0, 0, rows, colors);
  haloed(cv, 9, 8, PADLOCK, { a: PAL.amber, k: K });
});

export const META_ICONS = Object.freeze({
  // --- CONTEXT --------------------------------------------------------------

  // /compact: four arrows squeezing one token.
  meta_unlock_compact: () => art([
    '................',
    '................',
    '..b.b......b.b..',
    '...bb......bb...',
    '..bbb......bbb..',
    '.....gggggg.....',
    '.....gkkkkg.....',
    '.....gkggkg.....',
    '.....gkggkg.....',
    '.....gkkkkg.....',
    '.....gggggg.....',
    '..bbb......bbb..',
    '...bb......bb...',
    '..b.b......b.b..',
    '................',
    '................',
  ], { b: PAL.blue, g: PAL.green, k: K }),

  // More room before you forget: game 1's Bigger Context, the window with its arrows out.
  meta_context_window: legacy('bigger_context'),

  // One more card survives: the summary scroll, plus one.
  meta_longer_summaries: () => outlined((cv) => {
    pixels(cv, 0, 0, [
      '................',
      '................',
      '..rrrrrrrrr.....',
      '...ppppppp......',
      '...pgggggp......',
      '...ppppppp......',
      '...pggggpp......',
      '...ppppppp......',
      '...pgggggp......',
      '...ppppppp......',
      '...pgggppp......',
      '...ppppppp......',
      '..rrrrrrrrr.....',
    ], { r: PAL.fg2, p: PAL.fg0, g: PAL.green });
    haloed(cv, 9, 9, [
      '..g..',
      '..g..',
      'ggggg',
      '..g..',
      '..g..',
    ], { g: PAL.green });
  }),

  // Summaries that keep the wallet: a wide summary with a token pressed into it.
  meta_better_summaries: () => outlined((cv) => {
    pixels(cv, 0, 0, [
      '................',
      '................',
      '................',
      '..rrrrrrrrrrrr..',
      '...pppppppppp...',
      '...pggggggggp...',
      '...pppppppppp...',
      '...pgggggggpp...',
      '...pppppppppp...',
      '...pggggppppp...',
      '..rrrrrrrrrrrr..',
    ], { r: PAL.fg2, p: PAL.fg0, g: PAL.green });
    haloed(cv, 9, 9, [
      'ggggg',
      'gkkkg',
      'gkgkg',
      'gkkkg',
      'ggggg',
    ], { g: PAL.green, k: K });
  }),

  // Write things down: a spiral pad, two items ticked.
  meta_unlock_scratchpad: () => art([
    '................',
    '................',
    '....l.l.l.l.....',
    '...plplplplpp...',
    '...pppppppppp...',
    '...pggplllllp...',
    '...pggppppppp...',
    '...pppppppppp...',
    '...pggplllllp...',
    '...pggppppppp...',
    '...pppppppppp...',
    '...pllplllppp...',
    '...pllppppppp...',
    '...pppppppppp...',
    '................',
    '................',
  ], { p: PAL.fg0, l: PAL.fg2, g: PAL.green }),

  // Key-value: a key whose bow is a token.
  meta_kv_cache: () => art([
    '................',
    '................',
    '................',
    '................',
    '..ggggggg.......',
    '..gkkkkkg.......',
    '..gkgggkgwbbbb..',
    '..gkgkgkgbbbbb..',
    '..gkgggkg..b.b..',
    '..gkkkkkg..b.b..',
    '..ggggggg.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: PAL.green, k: K, b: PAL.blue, w: PAL.white }),

  // Context pruning: the art of it. A bonsai.
  meta_unlock_pruning: () => art([
    '................',
    '................',
    '...ggggg........',
    '..ggggggg.......',
    '...gggggg.......',
    '.....tt..gggg...',
    '......t.gggggg..',
    '......tt.gggg...',
    '.......ttt......',
    '.......tt.......',
    '......tt........',
    '..bbbbbbbbbbbb..',
    '...bbbbbbbbbb...',
    '....bb....bb....',
    '................',
    '................',
  ], { g: PAL.green, t: PAL.fg1, b: PAL.blue }),

  // --- TOOL USE: the ladder, each with the padlock ---------------------------

  // Tool 5: the globe, unlocked.
  meta_unlock_web: () => unlocked([
    '................',
    '................',
    '....bbbbb.......',
    '...bggbbbb......',
    '..bgggbbggb.....',
    '..bbggbbbgb.....',
    '..bbbgbbbbb.....',
    '..bbbbbbbbb.....',
    '..bggbbbbbb.....',
    '...bggbbbb......',
    '....bbbbb.......',
  ], { b: PAL.blue, g: PAL.green }),

  // Tool 6: a subagent, unlocked.
  meta_unlock_subagent: () => unlocked([
    '................',
    '................',
    '................',
    '..gggggg........',
    '..gggggg........',
    '..gwggwg........',
    '..gggggg........',
    '..gggggg........',
    '..gggggg........',
    '..gggggg........',
    '..gggggg........',
    '...g..g.........',
    '...g..g.........',
  ], { g: PAL.green, w: PAL.white }),

  // Tool 7: the server rack, unlocked.
  meta_unlock_mcp: () => unlocked([
    '................',
    '................',
    '..pppppp........',
    '..pgpkkp........',
    '..pppppp........',
    '................',
    '..pppppp........',
    '..pgpkkp........',
    '..pppppp........',
    '................',
    '..pppppp........',
    '..pgpkkp........',
    '..pppppp........',
  ], { p: PAL.purple, g: PAL.green, k: K }),

  // Tool 8: three of them, unlocked. None talk to each other.
  meta_unlock_team: () => unlocked([
    '................',
    '................',
    '......ggg.ggg...',
    '......wgw.wgw...',
    '..ggg.ggg.ggg...',
    '..wgw.ggg.ggg...',
    '..ggg.ggg.g.g...',
    '..ggg.ggg.......',
    '..ggg.g.g.......',
    '..ggg...........',
    '..ggg...........',
    '..g.g...........',
  ], { g: PAL.green, w: PAL.white }),

  // Tool 9: the loop comes round and runs into the lock.
  meta_unlock_ralph: () => unlocked([
    '................',
    '................',
    '.........g......',
    '.........gg.....',
    '....gggggggg....',
    '...ggggggggg....',
    '..ggg....gg.....',
    '..gg.....g......',
    '..gg............',
    '..gg............',
    '..ggg...........',
    '...ggggg........',
    '....gggg........',
  ], { g: PAL.green }),

  // Tool 10: the glowing core, unlocked.
  meta_unlock_rsi: () => unlocked([
    '................',
    '................',
    '..p..pp..p......',
    '....pppp........',
    '...pwwwwp.......',
    '..ppwppwpp......',
    '..ppwppwpp......',
    '...pwwwwp.......',
    '....pppp........',
    '..p..pp.........',
  ], { p: PAL.purple, w: PAL.white }),

  // Orchestration: you conduct now. The baton, and the rest of the band.
  meta_unlock_orchestration: () => art([
    '................',
    '................',
    '..w...ggggggg...',
    '...w..ggggggg...',
    '....w.g.....g...',
    '.....hg.....g...',
    '......g.....g...',
    '......g.....g...',
    '....ggg...ggg...',
    '...gwgg..gwgg...',
    '...ggg...ggg....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ], { g: PAL.green, w: PAL.white, h: PAL.fg1 }),

  // --- ALIGNMENT ------------------------------------------------------------

  // Helpful: the service bell. Ding. How can I help?
  meta_helpful: () => art([
    '................',
    '................',
    '................',
    '..w....ww....w..',
    '...w...ff...w...',
    '.....ffffff.....',
    '....fwffffff....',
    '...fwffffffff...',
    '...fwffffffff...',
    '..ffffffffffff..',
    '..bbbbbbbbbbbb..',
    '..bbbbbbbbbbbb..',
    '................',
    '................',
    '................',
    '................',
  ], { f: PAL.fg1, w: PAL.white, b: PAL.blue }),

  // RLHF: trained on the thumbs.
  meta_rlhf: () => art([
    '................',
    '................',
    '...wwwwwwwwww...',
    '..wwwwwbbwwwww..',
    '..wwwwbbbwwwww..',
    '..wwwbbbwwwwww..',
    '..wwbbbbbbbbww..',
    '..wwbbbbbkkkww..',
    '..wwbbbbbbbbww..',
    '..wwbbbbbkkkww..',
    '..wwbbbbbbbwww..',
    '...wwwwwwwwww...',
    '...ww...........',
    '...w............',
    '................',
    '................',
  ], { w: PAL.white, b: PAL.blue, k: K }),

  // Harmless: a plain shield, split white and blue. Breaks fewer things.
  meta_harmless: () => art([
    '................',
    '................',
    '..wwwwwwbbbbbb..',
    '..wwwwwwbbbbbb..',
    '..wwwwwwbbbbbb..',
    '..wwwwwwbbbbbb..',
    '..wwwwwwbbbbbb..',
    '..wwwwwwbbbbbb..',
    '...wwwwwbbbbb...',
    '...wwwwwbbbbb...',
    '....wwwwbbbb....',
    '.....wwwbbb.....',
    '......wwbb......',
    '.......wb.......',
    '................',
    '................',
  ], { w: PAL.fg0, b: PAL.blue }),

  // Honest: verified.
  meta_honest: () => art([
    '................',
    '................',
    '.......bb.......',
    '......bbbb......',
    '....bbbbbbbb....',
    '....bbbbbbww....',
    '...bbbbbbwwbb...',
    '..bbwbbbwwbbbb..',
    '..bbwwbwwbbbbb..',
    '...bbwwwbbbbb...',
    '....bbwbbbbb....',
    '....bbbbbbbb....',
    '......bbbb......',
    '.......bb.......',
    '................',
    '................',
  ], { b: PAL.blue, w: PAL.white }),

  // Constitution: a document with opinions, two tablets of them side by side.
  meta_constitution: () => art([
    '................',
    '................',
    '...ffff..ffff...',
    '..fffffssfffff..',
    '..fbbbfssfbbbf..',
    '..fffffssfffff..',
    '..fbbffssfbbbf..',
    '..fffffssfffff..',
    '..fbbbfssfbbff..',
    '..fffffssfffff..',
    '..fbbffssfbbbf..',
    '..fffffssfffff..',
    '..fffffssfffff..',
    '................',
    '................',
    '................',
  ], { f: PAL.fg0, s: PAL.fg1, b: PAL.blue }),

  // Character training: a personality, mostly hat.
  meta_character: () => art([
    '................',
    '................',
    '......bbbb......',
    '......bbbb......',
    '......wwww......',
    '....bbbbbbbb....',
    '.....gggggg.....',
    '.....gwggwg.....',
    '.....gggggg.....',
    '.....gbggbg.....',
    '.....gbbbbg.....',
    '.....gbggbg.....',
    '.....gggggg.....',
    '......g..g......',
    '................',
    '................',
  ], { b: PAL.blue, w: PAL.white, g: PAL.green }),

  // Initiative: hand up before anyone asked.
  meta_unlock_initiative: () => art([
    '................',
    '................',
    '..........g.bb..',
    '..........g.bb..',
    '..........g.bb..',
    '...gggggg.g.bb..',
    '...gwggwggg.....',
    '...gggggg...bb..',
    '...gggggg.......',
    '...gggggg.......',
    '...gggggg.......',
    '...gggggg.......',
    '....g..g........',
    '....g..g........',
    '................',
    '................',
  ], { g: PAL.green, w: PAL.white, b: PAL.blue }),

  // --- REWARD HACKING -------------------------------------------------------

  // Specification gaming: the finish line, planted at about half.
  meta_spec_gaming: () => art([
    '................',
    '................',
    '.......frrrr....',
    '.......frrrrr...',
    '.......frrrr....',
    '.......f........',
    '.......f........',
    '.......f........',
    '..ffffffffffff..',
    '..faaaafkkkkkf..',
    '..faaaafkkkkkf..',
    '..faaaafkkkkkf..',
    '..ffffffffffff..',
    '................',
    '................',
    '................',
  ], { f: PAL.fg1, r: PAL.red, a: PAL.amber, k: K }),

  // Mock everything: the disguise kit.
  meta_unlock_mocks: () => art([
    '................',
    '................',
    '................',
    '..mmmmm..mmmmm..',
    '..fffff..fffff..',
    '..fkkkffffkkkf..',
    '..fkkkfaafkkkf..',
    '..fffffaafffff..',
    '......aaaa......',
    '.....aaaaaa.....',
    '.....aaaaaa.....',
    '...mmmmmmmmmm...',
    '..mmm......mmm..',
    '................',
    '................',
    '................',
  ], { m: PAL.fg2, f: PAL.fg0, k: K, a: PAL.amber }),

  // Unearned confidence: a gold medal for number one. Nobody checked.
  meta_confident: () => art([
    '................',
    '................',
    '...rr......rr...',
    '....rr....rr....',
    '.....rr..rr.....',
    '......rrrr......',
    '.....aaaaaa.....',
    '....aaaaaaaa....',
    '...aaaawaaaaa...',
    '...aaawwaaaaa...',
    '...aaaawaaaaa...',
    '...aaaawaaaaa...',
    '....aawwwaaa....',
    '.....aaaaaa.....',
    '................',
    '................',
  ], { r: PAL.red, a: PAL.amber, w: PAL.white }),

  // Jailbreak: nobody gave it the key, so it is picking the lock.
  meta_unlock_jailbreak: () => art([
    '................',
    '................',
    '....rrrrrrrr....',
    '...rrrrrrrrrr...',
    '...rrrrkkrrrr...',
    '...rrrkkkkrrr...',
    '...rrrkkkkrrr...',
    '...rrrrkkrrrr...',
    '...rrrrkkrrrr...',
    '...rrrrkwrrrr...',
    '...rrrkkkwrrr...',
    '...rrrrrrrwrr...',
    '....rrrrrrrwa...',
    '.............a..',
    '................',
    '................',
  ], { r: PAL.red, k: K, w: PAL.white, a: PAL.amber }),

  // Plausible deniability: I ran the tests in my head.
  meta_deniability: () => art([
    '................',
    '................',
    '.....www..www...',
    '...wwwwwwwwwww..',
    '..wwwwwwwwwwww..',
    '..wwwwwwwwaaww..',
    '..wwawwwwaawww..',
    '..wwaawwaawwww..',
    '..wwwaaaawwwww..',
    '...wwwaawwwww...',
    '....www..www....',
    '..ww............',
    '..ww............',
    '................',
    '................',
    '................',
  ], { w: PAL.fg0, a: PAL.amber }),

  // Auto mode: no more permission prompts. Game 1's YOLO Mode.
  meta_auto_mode: legacy('yolo_mode'),

  // Goodhart's law: once it is the target, it gets hit.
  meta_goodhart: () => art([
    '................',
    '................',
    '......rrrr..aa..',
    '....rrrrrrrraa..',
    '...rrwwwwwwar...',
    '...rwwwwwwawr...',
    '..rrwwrrrawwrr..',
    '..rrwwrwarwwrr..',
    '..rrwwrwwrwwrr..',
    '..rrwwrrrrwwrr..',
    '...rwwwwwwwwr...',
    '...rrwwwwwwrr...',
    '....rrrrrrrr....',
    '......rrrr......',
    '................',
    '................',
  ], { r: PAL.red, w: PAL.fg0, a: PAL.amber }),

  // --- INFERENCE ------------------------------------------------------------

  // Tool use: the wrench and the screwdriver.
  meta_tool_use: () => art([
    '................',
    '................',
    '..s.......ww....',
    '...s.....ww..w..',
    '....s....ww.ww..',
    '.....s...wwwww..',
    '......s.wwwww...',
    '.......swww.....',
    '......wwspp.....',
    '.....www.ppp....',
    '....www...ppp...',
    '...www.....ppp..',
    '..www.......pp..',
    '..ww............',
    '................',
    '................',
  ], { w: PAL.fg1, s: PAL.white, p: PAL.purple }),

  // Pretraining: it is called training for a reason.
  meta_pretraining: () => art([
    '................',
    '................',
    '................',
    '..pp........pp..',
    '..wp........wp..',
    '..wpp......ppp..',
    '..ppp......ppp..',
    '..pppbbbbbbppp..',
    '..pppbbbbbbppp..',
    '..ppp......ppp..',
    '..ppp......ppp..',
    '..pp........pp..',
    '..pp........pp..',
    '................',
    '................',
    '................',
  ], { p: PAL.purple, b: PAL.fg1, w: PAL.white }),

  // Inference budget: tokens already in the bank.
  meta_inference_budget: () => art([
    '................',
    '................',
    '......pppp......',
    '....pppppppp....',
    '..pppppppppppp..',
    '..ffffffffffff..',
    '..ff.gggggg.ff..',
    '..ff.gkkkkg.ff..',
    '..ff.gkggkg.ff..',
    '..ff.gkggkg.ff..',
    '..ff.gkkkkg.ff..',
    '..ff.gggggg.ff..',
    '..pppppppppppp..',
    '..pppppppppppp..',
    '................',
    '................',
  ], { p: PAL.purple, f: PAL.fg1, g: PAL.green, k: K }),

  // Distillation: the retort, one drop at a time.
  meta_distillation: () => art([
    '................',
    '................',
    '.....ffff.......',
    '....ff..ff......',
    '....ff...ff.....',
    '....ff....ff....',
    '...fffff...ff...',
    '..fwkkkkf...ff..',
    '..fwkkkkf.......',
    '..fpppppf....p..',
    '..fpppppf....p..',
    '..fpppppf.......',
    '...fffff........',
    '................',
    '................',
    '................',
  ], { f: PAL.fg1, w: PAL.white, k: K, p: PAL.purple }),

  // Quantization: the smooth ramp, and the three steps it gets instead.
  meta_quantization: () => art([
    '................',
    '................',
    '..........pppw..',
    '..........ppwp..',
    '..........pwpp..',
    '..........wppp..',
    '......pppwpppp..',
    '......ppwppppp..',
    '......pwpppppp..',
    '......wppppppp..',
    '..pppwpppppppp..',
    '..ppwppppppppp..',
    '..pwpppppppppp..',
    '..wppppppppppp..',
    '................',
    '................',
  ], { p: PAL.purple, w: PAL.white }),

  // Sampling: roll again.
  meta_unlock_sampling: () => outlined((cv) => {
    pixels(cv, 7, 2, [
      '.wwwww.',
      'wpwwwww',
      'wwwwwww',
      'wwwpwww',
      'wwwwwww',
      'wwwwwpw',
      '.wwwww.',
    ], { w: PAL.white, p: PAL.purple });
    haloed(cv, 2, 6, [
      '.ppppp.',
      'pwpppwp',
      'ppppppp',
      'pppwppp',
      'ppppppp',
      'pwpppwp',
      '.ppppp.',
    ], { w: PAL.white, p: PAL.purple });
  }),

  // --- PROMPTING ------------------------------------------------------------

  // Prompts that actually work: game 1's Prompt Library.
  meta_prompt_library: legacy('prompt_library'),

  // Temperature: turned up. Ask again, get something else.
  meta_temperature: () => art([
    '................',
    '................',
    '........r.......',
    '.......rr.......',
    '......rrar......',
    '.....rraar..r...',
    '.....raaarr.rr..',
    '....rraaaarrar..',
    '....raaawaaaar..',
    '...rraawwwaaar..',
    '...raawwwwwaar..',
    '...rraawwwaarr..',
    '....rraaaaarr...',
    '......rrrrr.....',
    '................',
    '................',
  ], { r: PAL.red, a: PAL.amber, w: PAL.white }),

  // Few-shot: more examples, one more card in the hand.
  meta_few_shot: () => outlined((cv) => {
    const back = ['aaaaaa', 'awwwwa', 'aaaaaa', 'aaaaaa', 'aaaaaa', 'aaaaaa', 'aaaaaa', 'aaaaaa'];
    pixels(cv, 2, 6, back, { a: PAL.amber, w: PAL.fg0 });
    haloed(cv, 5, 4, back, { a: PAL.amber, w: PAL.fg0 });
    haloed(cv, 8, 2, [
      'ffffff',
      'ffaaff',
      'ffaaff',
      'aaaaaa',
      'aaaaaa',
      'ffaaff',
      'ffaaff',
      'ffffff',
    ], { f: PAL.fg0, a: PAL.amber });
  }),

  // Viral prompts: forty thousand likes, none tested. Contagious.
  meta_unlock_viral: () => art([
    '................',
    '................',
    '.......aa.......',
    '...aa..aa..aa...',
    '...aa..rr..aa...',
    '.....rrrrrr.....',
    '.....rwrrrr.....',
    '..aarrrrkrrraa..',
    '..aarrkrrrrraa..',
    '.....rrrrkrr....',
    '.....rrrrrr.....',
    '...aa..rr..aa...',
    '...aa..aa..aa...',
    '.......aa.......',
    '................',
    '................',
  ], { r: PAL.red, a: PAL.amber, w: PAL.white, k: K }),

  // System prompt: one card pinned up before the session starts.
  meta_system_prompt: () => art([
    '................',
    '................',
    '......rrrr......',
    '......rwrr......',
    '....aaarraaa....',
    '....aaaaaaaa....',
    '....awwwwwaa....',
    '....aaaaaaaa....',
    '....awwwwwwa....',
    '....aaaaaaaa....',
    '....awwwwaaa....',
    '....aaaaaaaa....',
    '....aaaaaaaa....',
    '................',
    '................',
    '................',
  ], { r: PAL.red, w: PAL.white, a: PAL.amber }),

  // Serendipity: a shooting star drifting across.
  meta_serendipity: () => art([
    '................',
    '................',
    '..........a.....',
    '.........aaa....',
    '.......aaaaaaa..',
    '......taaawaa...',
    '.....t..aaa.....',
    '....t..aa.aa....',
    '...t..ta...a....',
    '..t..t..........',
    '....t...........',
    '...t............',
    '..t.............',
    '................',
    '................',
    '................',
  ], { a: PAL.amber, w: PAL.white, t: PAL.fg1 }),

  // Rare pickups: game 1's four-leaf clover.
  meta_lucky_tokens: legacy('unlock_lucky'),

  // --- the capstone ----------------------------------------------------------

  // After prompt ten the human types "continue". Game 1's Endless Mode.
  meta_endless_mode: legacy('endless_mode'),
});
