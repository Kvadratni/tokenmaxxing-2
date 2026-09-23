/**
 * Shop icons for the in-run upgrades: `upg_<id>`. Each one draws the joke in
 * its blurb (content.ts). Colour follows the shop's kind so a row scans at a
 * glance: tool upgrades lean on their tool's colours, context blue/green,
 * patience amber, claims red/amber, crits amber/white.
 */
import { PAL, art, knockedBox, outlined, pixels, tokenGlyph } from './kit.mjs';
import { legacy } from './legacy.mjs';

/** `art`, but a typo in the picture fails loudly instead of drawing garbage. */
const pic = (rows, colors, details) => {
  if (rows.length !== 16 || rows.some((row) => row.length !== 16)) {
    throw new Error(`upgrade icon rows must be 16x16: ${rows.map((row) => row.length).join(',')}`);
  }
  return art(rows, colors, details);
};

export const UPGRADE_ICONS = Object.freeze({
  // --- click ----------------------------------------------------------------

  // Tokens arrive one at a time. It feels faster.
  upg_streaming: () => outlined((cv) => {
    tokenGlyph(cv, 8, 2, 6, PAL.green, PAL.green);
    cv.hline(3, 6, 3, PAL.green2);
    cv.hline(2, 6, 5, PAL.green2);
    cv.hline(4, 6, 7, PAL.green2);
    tokenGlyph(cv, 6, 9, 5, PAL.green, PAL.green);
    cv.hline(2, 4, 10, PAL.green2);
    cv.hline(3, 4, 12, PAL.green2);
  }),

  // Guesses the next five tokens. Keeps two.
  upg_spec_decoding: legacy('speculative_decoding'),

  // A fat dictionary. The cover is an emoji.
  upg_bigger_vocab: () => pic([
    '................',
    '................',
    '...ggggggggFF...',
    '...ggggggggFd...',
    '...ggggggggFF...',
    '...ggrggrggFd...',
    '...grrrrrrgFF...',
    '...grrrrrrgFd...',
    '...ggrrrrggFF...',
    '...gggrrgggFd...',
    '...ggggggggFF...',
    '...ggggggggFd...',
    '...ggggggggFF...',
    '................',
    '................',
    '................',
  ], { g: PAL.green, F: PAL.fg0, r: PAL.red, d: PAL.bg0 }),

  // Eight experts. One of them is awake.
  upg_moe: () => pic([
    '................',
    '................',
    '..GGG.GGG.GGG...',
    '..GGG.GGG.GGG...',
    '..GGG.GGG.GGG...',
    '................',
    '..GGG.wgw.GGG...',
    '..GGG.ggg.GGG...',
    '..GGG.ggg.GGG...',
    '................',
    '..GGG.GGG.......',
    '..GGG.GGG.......',
    '..GGG.GGG.......',
    '................',
    '................',
    '................',
  ], { G: PAL.green2, g: PAL.green, w: PAL.white }),

  // Thinks for forty seconds.
  upg_extended_thinking: () => pic([
    '................',
    '................',
    '.....ppp.ppp....',
    '...ppppppppppp..',
    '..pppppppppppp..',
    '..ppwwpwwpwwpp..',
    '..ppwwpwwpwwpp..',
    '..pppppppppppp..',
    '...pppppppppp...',
    '.....ppp.ppp....',
    '................',
    '....pp..........',
    '....pp..........',
    '..p.............',
    '................',
    '................',
  ], { p: PAL.purple, w: PAL.white }),

  // Calls its tools on reflex: a wrench with a spark.
  upg_tool_reflex: () => pic([
    '................',
    '................',
    '.....aa...f..f..',
    '....aa....f..f..',
    '...aaaa...ffff..',
    '....aa...fff....',
    '...aa...fff.....',
    '...a...fff......',
    '......fff.......',
    '.....fff........',
    '....fff.........',
    '...fff..........',
    '..fff...........',
    '..ff............',
    '................',
    '................',
  ], { f: PAL.fg1, a: PAL.amber }),

  // Does not wait to be asked. Clicks on its own.
  upg_keep_going: legacy('autoclicker'),

  // Every time it tries to stop, the sign says GO.
  upg_stop_hook: () => pic([
    '................',
    '................',
    '....rrrrrrr.....',
    '...rrrrrrrrr....',
    '..rrrrrrrrrrr...',
    '..rrrwwrrwrrr...',
    '..rrwrrrwrwrr...',
    '..rrwrwrwrwrr...',
    '..rrwrwrwrwrr...',
    '..rrrwwrrwrrr...',
    '...rrrrrrrrr....',
    '....rrrrrrr.....',
    '.......f........',
    '.......f........',
    '................',
    '................',
  ], { r: PAL.red, w: PAL.white, f: PAL.fg1 }),

  // --- tools ----------------------------------------------------------------

  // Grep, but in Rust, so twice as fast.
  upg_ripgrep: () => pic([
    '................',
    '................',
    '........ffff....',
    '..aaa..fbbbbf...',
    '......fbfbbbbf..',
    '..aaa.fbfbbbbf..',
    '......fbbbbbbf..',
    '..aaa.fbbbbbbf..',
    '.......fbbbbf...',
    '......f.ffff....',
    '.....fff........',
    '....fff.........',
    '...fff..........',
    '...ff...........',
    '................',
    '................',
  ], { f: PAL.fg1, b: PAL.blue, a: PAL.amber }),

  // .* matches everything.
  upg_regex: () => pic([
    '................',
    '................',
    '................',
    '.........bb.....',
    '.........bb.....',
    '......bb.bb.bb..',
    '.......bbbbbb...',
    '........bwwb....',
    '........bwwb....',
    '.......bbbbbb...',
    '......bb.bb.bb..',
    '..www....bb.....',
    '..www....bb.....',
    '..www...........',
    '................',
    '................',
  ], { b: PAL.blue, w: PAL.white }),

  // Reads lines 1 to 2,000 of a twelve-line file. Half the context, somehow.
  upg_line_ranges: () => pic([
    '................',
    '................',
    '.....FFFFFFFF...',
    '.....FmmmmmFF...',
    '.....FFFFFFFF...',
    '..bb.FbbbbbbF...',
    '..b..FFFFFFFF...',
    '..b..FbbbbFFF...',
    '..b..FFFFFFFF...',
    '..bb.FbbbbbFF...',
    '.....FFFFFFFF...',
    '.....FmmmmmmF...',
    '.....FFFFFFFF...',
    '.....FmmmFFFF...',
    '................',
    '................',
  ], { F: PAL.fg0, m: PAL.fg2, b: PAL.blue }),

  // Just to be sure. And again. And once more after the edit.
  upg_read_again: () => outlined(
    (cv) => {
      cv.rect(2, 2, 8, 11, PAL.fg0);
      cv.rect(7, 7, 7, 7, [0, 0, 0, 0]);
      pixels(cv, 7, 7, [
        '..ggg.g',
        '.g...gg',
        'g...ggg',
        'g......',
        'g.....g',
        '.g...g.',
        '..ggg..',
      ], { g: PAL.green });
    },
    (cv) => {
      for (const y of [4, 6, 8]) cv.hline(3, 7, y, PAL.fg2);
      cv.hline(3, 4, 10, PAL.fg2);
    },
  ),

  // Changes forty lines at once. Thirty-nine were fine.
  upg_multi_edit: () => pic([
    '................',
    '................',
    '......rrr.......',
    '..rrr.rrr.rrr...',
    '..rrr.aaa.rrr...',
    '..aaa.aaa.aaa...',
    '..aaa.aaa.aaa...',
    '..aaa.aaa.aaa...',
    '..aaa.aaa.aaa...',
    '..aaa.aaa.aaa...',
    '..FFF.aaa.FFF...',
    '...F..FFF..F....',
    '.......F........',
    '................',
    '................',
    '................',
  ], { r: PAL.red, a: PAL.amber, F: PAL.fg0 }),

  // Every A becomes a B. What could possibly go wrong.
  upg_find_replace_all: () => pic([
    '................',
    '................',
    '.......F........',
    '......F.F.......',
    '......FFF.......',
    '......F.F.......',
    '......F.F.......',
    '......aaa.......',
    '.......a........',
    '..rr..rr..rr....',
    '..r.r.r.r.r.r...',
    '..rr..rr..rr....',
    '..r.r.r.r.r.r...',
    '..rr..rr..rr....',
    '................',
    '................',
  ], { F: PAL.fg0, a: PAL.amber, r: PAL.red }),

  // Pipe it to grep. Pipe that to grep.
  upg_pipes: () => pic([
    '................',
    '................',
    '..f.............',
    '..fFFFFFF.......',
    '..fffffff.......',
    '..fffffff.......',
    '..f...fff.......',
    '......fff.......',
    '......fFFFFFF...',
    '......fffffff...',
    '......fffffff...',
    '..........fff...',
    '...........g....',
    '...........g....',
    '................',
    '................',
  ], { f: PAL.fg1, F: PAL.fg0, g: PAL.green }),

  // Starts the dev server. Forgets it. Starts another.
  upg_background_tasks: () => outlined((cv) => {
    for (const [x, y] of [[2, 2], [4, 4], [6, 6]]) {
      cv.rect(x, y, 8, 7, PAL.fg2);
      cv.rect(x + 1, y + 2, 6, 4, PAL.bg0);
      cv.put(x + 6, y, PAL.green);
    }
    cv.put(8, 10, PAL.green);
    cv.hline(9, 10, 11, PAL.green);
  }),

  // Only reads the first result. It was sponsored.
  upg_first_result: () => pic([
    '................',
    '................',
    '..aaaaaaaaaaaa..',
    '..aaaadaaddaaa..',
    '..aaadadadadaa..',
    '..aaadddadadaa..',
    '..aaadadadadaa..',
    '..aaadadaddaaa..',
    '..aaaaaaaaaaaa..',
    '................',
    '..bbbbbbbb......',
    '..mmmmmmmmmmm...',
    '................',
    '..bbbbbb........',
    '................',
    '................',
  ], { a: PAL.amber, d: PAL.bg0, b: PAL.blue, m: PAL.fg2 }),

  // Every answer is marked as a duplicate of itself.
  upg_so_mirror: () => outlined((cv) => {
    knockedBox(cv, 2, 2, 9, 6, PAL.fg2);
    cv.put(3, 8, PAL.fg2);
    cv.hline(4, 8, 4, PAL.bg0);
    cv.hline(4, 6, 6, PAL.bg0);
    cv.rect(4, 5, 10, 8, PAL.bg0);
    knockedBox(cv, 5, 6, 9, 6, PAL.amber);
    cv.put(12, 12, PAL.amber);
    cv.put(12, 13, PAL.amber);
    cv.hline(7, 11, 8, PAL.bg0);
    cv.hline(7, 9, 10, PAL.bg0);
  }),

  // Five at once. Same bug, five different fixes.
  upg_parallel_subagents: () => pic([
    '................',
    '................',
    '................',
    '....GGG.GGG.....',
    '....wGw.wGw.....',
    '....GGG.GGG.....',
    '....GGG.GGG.....',
    '................',
    '..ggg.ggg.ggg...',
    '..wgw.wgw.wgw...',
    '..ggg.ggg.ggg...',
    '..ggg.ggg.ggg...',
    '..g.g.g.g.g.g...',
    '................',
    '................',
    '................',
  ], { g: PAL.green, G: PAL.green2, w: PAL.white }),

  // One paragraph back. Mostly confidence.
  upg_subagent_summaries: () => pic([
    '................',
    '................',
    '.....FFFFFFFFF..',
    '.....FFdFFdFdF..',
    '.....FdFdFdFdF..',
    '.....FdFdFddFF..',
    '.....FdFdFdFdF..',
    '.....FFdFFdFdF..',
    '.....FFFFFFFFF..',
    '......F.........',
    '..ggggg.........',
    '..gwgwg.........',
    '..ggggg.........',
    '..g...g.........',
    '................',
    '................',
  ], { F: PAL.fg0, d: PAL.bg0, g: PAL.green, w: PAL.white }),

  // Loads the manuals only when needed. Needs a tool to find the tools.
  upg_tool_search: () => pic([
    '................',
    '................',
    '..pppppppp......',
    '..pdpppppp......',
    '..pdpppppp......',
    '..pdpppfff......',
    '..pdppfbbbf.....',
    '..pdpfbfbbbf....',
    '..pdpfbbbbbf....',
    '..pdpfbbbbbf....',
    '..pdppfbbbf.....',
    '..pdpppffff.....',
    '..pppppp..ff....',
    '...........ff...',
    '................',
    '................',
  ], { p: PAL.purple, d: PAL.bg0, f: PAL.fg1, b: PAL.blue }),

  // It opened a browser. You do not have a browser. It worked anyway.
  upg_oauth_finally: () => pic([
    '................',
    '................',
    '..pppppppppppp..',
    '..pdpdpdpppppp..',
    '..pppppppppppp..',
    '..p3333333333p..',
    '..p3333333333p..',
    '..p3333333333p..',
    '..pppppppppppp..',
    '...aaaa.........',
    '..aa..aaaaaaaa..',
    '..aa..aaaaaaaa..',
    '...aaaa...a.aa..',
    '..........a.....',
    '................',
    '................',
  ], { p: PAL.purple, d: PAL.bg0, 3: PAL.bg3, a: PAL.amber }),

  // Twelve status updates. Zero status.
  upg_async_standups: () => pic([
    '................',
    '................',
    '......rrrrrrr...',
    '.....rrwrrwwrr..',
    '.....rwwrrrrwr..',
    '.....rrwrrrwrr..',
    '..gggrrwrrwrrr..',
    '.ggggrwwwrwwwr..',
    '..ggggrrrrrrr...',
    '..gggggggggg....',
    '..ggdggdggdg....',
    '..gggggggggg....',
    '...gg...........',
    '...g............',
    '................',
    '................',
  ], { r: PAL.red, w: PAL.white, g: PAL.green, d: PAL.bg0 }),

  // Now they overwrite each other on purpose: two cursors, one line.
  upg_shared_scratchpad: () => pic([
    '................',
    '................',
    '...ggg.....rrr..',
    '...g.......r....',
    '..FgFFFFFFFrFF..',
    '..FgFFFFFFFrFF..',
    '..Fgdddddddrd...',
    '..FgFFFFFFFrFF..',
    '..FFFFFFFFFFFF..',
    '..FddddddddFFF..',
    '..FFFFFFFFFFFF..',
    '..FdddddddddFF..',
    '..FFFFFFFFFFFF..',
    '..FddddddFFFFF..',
    '..FFFFFFFFFFFF..',
    '................',
  ], { F: PAL.fg0, g: PAL.green, r: PAL.red, d: PAL.bg0 }),

  // It has an exit condition now. It is never met.
  upg_exit_condition: () => pic([
    '................',
    '................',
    '......a.........',
    '.....aaa........',
    '....addaa.......',
    '...aaaadaa......',
    '..aaaadaaaggg...',
    '...aaaaaa...g...',
    '....aadaa...g...',
    '.....aaa....g...',
    '......a.....g...',
    '......g.....g...',
    '.....g.g....g...',
    '......gggggggg..',
    '................',
    '................',
  ], { a: PAL.amber, d: PAL.bg0, g: PAL.green }),

  // while true; do while true; do agent; done; done
  upg_nested_ralph: () => pic([
    '................',
    '................',
    '.....ggggg.g....',
    '....gg...gggg...',
    '...gg....ggggg..',
    '..gg............',
    '..g...GGGG...g..',
    '..g..GG..GG..g..',
    '..g..G....G..g..',
    '..g......GG..g..',
    '..gg....GGGGgg..',
    '...gg.......g...',
    '....gg.....gg...',
    '.....ggggggg....',
    '................',
    '................',
  ], { g: PAL.green, G: PAL.green2 }),

  // It grades its own homework. Straight As.
  upg_own_benchmarks: () => pic([
    '................',
    '................',
    '..FFFFFFFFFFFF..',
    '..FmmmmmmmmFFF..',
    '..FFFFFFFFFFFF..',
    '..FmmmmmmFFFFF..',
    '..FFFFFFFFFFFF..',
    '..FFFrrrFFFrFF..',
    '..FFrrFrrrrrrF..',
    '..FFrrFrrFrFFF..',
    '..FFrrrrrFFFFF..',
    '..FFrrFrrFFFFF..',
    '..FFrrFrrFFFFF..',
    '..FFFFFFFFFFFF..',
    '................',
    '................',
  ], { F: PAL.fg0, m: PAL.fg2, r: PAL.red }),

  // Trained on its own output. Extremely confident.
  upg_the_successor: () => pic([
    '................',
    '................',
    '....a..aa..a....',
    '....aa.aa.aa....',
    '....aaaaaaaa....',
    '....gggggggg....',
    '....gwddgwdg....',
    '....gddggddg....',
    '....gggggggg....',
    '....gggggggg....',
    '....gggggggg....',
    '....gggggggg....',
    '....gggggggg....',
    '.....g....g.....',
    '................',
    '................',
  ], { a: PAL.amber, g: PAL.green, d: PAL.bg0, w: PAL.white }),

  // --- global ---------------------------------------------------------------

  // Three calls at once. Two of them read the same file.
  upg_parallel_tool_calls: () => pic([
    '................',
    '................',
    '..........ffff..',
    '.......a..fddf..',
    '..FFFFFaa.ffff..',
    '.......a..fdff..',
    '..........ffff..',
    '.......a..fddf..',
    '..FFFFFaa.ffff..',
    '.......a..ffff..',
    '................',
    '...........a....',
    '..FFFFFFFFFaa...',
    '...........a....',
    '................',
    '................',
  ], { F: PAL.fg0, a: PAL.amber, f: PAL.fg1, d: PAL.bg0 }),

  // Half price. Results by Thursday.
  upg_batch_api: () => pic([
    '................',
    '................',
    '.....F....F.....',
    '..rrrrrrrrrrrr..',
    '..rrrrrrrrrrrr..',
    '..rrrrrrrrrrrr..',
    '..FFFFFFFFFFFF..',
    '..FFddFddFddFF..',
    '..FFddFddFddFF..',
    '..FFFFFFFFFFFF..',
    '..FFddFddFaaFF..',
    '..FFddFddFaaFF..',
    '..FFFFFFFFFFFF..',
    '................',
    '................',
    '................',
  ], { r: PAL.red, F: PAL.fg0, d: PAL.bg0, a: PAL.amber }),

  // Instructions it reads once and ignores forever.
  upg_agents_md: legacy('claude_md'),

  // Sends every hard question to the cheap model.
  upg_model_router: legacy('model_router'),

  // Everything the big model knew, minus the parts that worked.
  upg_distilled_weights: legacy('distillation'),

  // --- context --------------------------------------------------------------

  // The human stops reading halfway anyway: half a page, torn off.
  upg_concise_mode: () => pic([
    '................',
    '................',
    '................',
    '..FFFFFFFFFFFF..',
    '..FbbbbbbbbbbF..',
    '..FFFFFFFFFFFF..',
    '..FbbbbbbbFFFF..',
    '..FFFFFFFFFFFF..',
    '..FbbbbbbbbbFF..',
    '..FFFFFFFFFFFF..',
    '..F.FF.FF.FF.F..',
    '................',
    '............mm..',
    '...........mm...',
    '................',
    '................',
  ], { F: PAL.fg0, b: PAL.blue, m: PAL.fg2 }),

  // You have read this file before.
  upg_prompt_caching: legacy('prompt_caching'),

  // Stops reading node_modules. Mostly.
  upg_gitignore: () => outlined(
    (cv) => {
      cv.rect(2, 3, 5, 1, PAL.fg2);
      cv.rect(2, 4, 12, 9, PAL.fg1);
    },
    (cv) => {
      for (let y = 5; y <= 12; y += 1) {
        for (let x = 4; x <= 11; x += 1) {
          const dx = x - 7.5;
          const dy = y - 8.5;
          const d = Math.hypot(dx, dy);
          if ((d >= 2.4 && d <= 3.9) || (d < 3 && Math.abs(dx - dy) < 0.8)) cv.put(x, y, PAL.red);
        }
      }
    },
  ),

  // Survives compaction. Nobody reads it: nothing is ticked.
  upg_todo_md: () => pic([
    '................',
    '................',
    '......ffff......',
    '..gggffffggggg..',
    '..gggggggggggg..',
    '..gggggggggggg..',
    '..gdddgggggggg..',
    '..gdgdgddddddg..',
    '..gdddgggggggg..',
    '..gggggggggggg..',
    '..gdddgggggggg..',
    '..gdgdgddddgGG..',
    '..gdddggggggG...',
    '..ggggggggggG...',
    '................',
    '................',
  ], { g: PAL.green, G: PAL.green2, f: PAL.fg1, d: PAL.bg0 }),

  // "## Key decisions" followed by nothing at all.
  upg_summary_template: () => pic([
    '................',
    '................',
    '..b.b.b.b.......',
    '..bbb.bbb.FFFF..',
    '..b.b.b.b.......',
    '..bbb.bbb.FFF...',
    '..b.b.b.b.......',
    '................',
    '..mm.mm.mm.mm...',
    '..m..........m..',
    '.............m..',
    '..m.............',
    '..m..........m..',
    '...mm.mm.mm.mm..',
    '................',
    '................',
  ], { b: PAL.blue, F: PAL.fg0, m: PAL.fg2 }),

  // Forgets the unimportant parts. Decides what those are.
  upg_context_pruning: () => outlined((cv) => {
    cv.rect(2, 2, 4, 4, PAL.blue);
    cv.rect(3, 3, 2, 2, PAL.bg0);
    cv.rect(2, 10, 4, 4, PAL.blue);
    cv.rect(3, 11, 2, 2, PAL.bg0);
    cv.line(6, 5, 13, 10, PAL.fg0);
    cv.line(6, 10, 13, 5, PAL.fg0);
    cv.rect(11, 7, 3, 2, PAL.green);
  }),

  // --- patience -------------------------------------------------------------

  // "Still working on it!" every thirty seconds.
  upg_progress_updates: () => pic([
    '................',
    '................',
    '................',
    '...FFFFFFFFFF...',
    '..FFFFFFFFFFFF..',
    '..FddddddddddF..',
    '..Fdaaaaaaa3dF..',
    '..Fdaaaaaaa3dF..',
    '..FddddddddddF..',
    '..FFFFFFFFFFFF..',
    '...FFFFFFFFFF...',
    '...FF...........',
    '...F............',
    '................',
    '................',
    '................',
  ], { F: PAL.fg0, d: PAL.bg0, a: PAL.amber, 3: PAL.bg3 }),

  // Done. Tested. Probably.
  upg_emoji_checkmarks: () => pic([
    '................',
    '................',
    '...gggggggg.....',
    '..gggggggggg....',
    '..gggggggwwg....',
    '..ggggggwwwg....',
    '..gwgggwwwgg....',
    '..gwwgwwwggg....',
    '..gwwwwwgaaaa...',
    '..ggwwwgaddaa...',
    '..gggwgaaaada...',
    '...ggggaaadaa...',
    '.......aaaaaa...',
    '.......aaadaa...',
    '........aaaa....',
    '................',
  ], { g: PAL.green, w: PAL.white, a: PAL.amber, d: PAL.bg0 }),

  // "You are absolutely right, and I apologize for the confusion."
  upg_apology_templates: () => pic([
    '................',
    '................',
    '..aa............',
    '...awwwww...ww..',
    '...awwwwwwwwww..',
    '...awwwwwwwwww..',
    '...awwwwfwwwww..',
    '...awwwffwwww...',
    '...a...wwwww....',
    '...a............',
    '...a............',
    '...a............',
    '...a............',
    '..aaa...........',
    '................',
    '................',
  ], { a: PAL.amber, w: PAL.white, f: PAL.fg1 }),

  // Every answer is a table now.
  upg_markdown_tables: () => pic([
    '................',
    '................',
    '..aaaa.aaa.aaa..',
    '..aaaa.aaa.aaa..',
    '................',
    '..FFFF.FFF.FFF..',
    '..FFFF.FFF.FFF..',
    '................',
    '..mmmm.mmm.mmm..',
    '..mmmm.mmm.mmm..',
    '................',
    '..FFFF.FFF.FFF..',
    '..FFFF.FFF.FFF..',
    '................',
    '................',
    '................',
  ], { a: PAL.amber, F: PAL.fg0, m: PAL.fg2 }),

  // --- claims ---------------------------------------------------------------

  // Wrong, but in bold.
  upg_confident_tone: () => outlined((cv) => {
    const b = [
      'wwwwwwww..',
      'wwwwwwwww.',
      'www...www.',
      'www...www.',
      'wwwwwwww..',
      'wwwwwwwww.',
      'www....www',
      'www....www',
      'www....www',
      'wwwwwwwwww',
      'wwwwwwwww.',
    ];
    pixels(cv, 3, 3, b, { w: PAL.red });
    pixels(cv, 2, 2, b, { w: PAL.white });
  }),

  // The tests pass. The tests test the mocks.
  upg_mock_everything: () => pic([
    '................',
    '................',
    '..aaaaaaaaaaaa..',
    '..aaaaaaaaaaaa..',
    '..aaaaaaaaagaa..',
    '..aaaaaaaaggaa..',
    '..aagaaaaggaaa..',
    '..aaggaaggaaaa..',
    '..aaaggggaaaaa..',
    '..aaaaggaaaaaa..',
    '..aaaaaaaaaaaa..',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '................',
    '................',
  ], { a: PAL.amber, g: PAL.green, m: PAL.fg2 }),

  // It was flaky anyway.
  upg_delete_failing_test: () => pic([
    '................',
    '................',
    '..FFFFFF........',
    '..FrFFrF........',
    '..FFrrFF........',
    '..FFrrFF........',
    '..FrFFrF........',
    '..FFFFFF.fffff..',
    '........fffffff.',
    '.........fdfdf..',
    '.........fdfdf..',
    '.........fdfdf..',
    '.........fdfdf..',
    '..........fff...',
    '................',
    '................',
  ], { F: PAL.fg0, r: PAL.red, f: PAL.fg1, d: PAL.bg0 }),

  // [skip ci]. Not a flag. A lifestyle.
  upg_skip_ci: () => pic([
    '................',
    '................',
    '...a..a...aa....',
    '...aa.aa..aa....',
    '...aaaaaa.aa....',
    '...aaaaaa.aa....',
    '...aa.aa..aa....',
    '...a..a...aa....',
    '................',
    '.....FF.FFF.....',
    '....F....F......',
    '....F....F......',
    '....F....F......',
    '.....FF.FFF.....',
    '................',
    '................',
  ], { a: PAL.amber, F: PAL.fg0 }),

  // --- crits ----------------------------------------------------------------

  // Occasionally brilliant. Occasionally Welsh.
  upg_temperature_2: () => pic([
    '................',
    '................',
    '...a...r...a....',
    '..aaa.....aaa...',
    '...a..FrF..a....',
    '......FrF.......',
    '......FrF.......',
    '......FrF.......',
    '......FrF.......',
    '......FrF.......',
    '.....FrrrF......',
    '.....FrrrF......',
    '.....FrrrF......',
    '......FFF.......',
    '................',
    '................',
  ], { F: PAL.fg0, r: PAL.red, a: PAL.amber }),

  // Generates eight. Shows you the one that compiles.
  upg_best_of_n: legacy('best_of_n'),

  // Nobody knows which try.
  upg_one_shot_prompting: legacy('one_shot'),

  // The tools pass. The tools wrote the tests.
  upg_eval_harness: legacy('eval_harness'),

  // --- permissions ----------------------------------------------------------

  // "npm test", "npm run", "npm anything": an all-access pass.
  upg_allowlist: () => pic([
    '................',
    '................',
    '..b.........b...',
    '...b.......b....',
    '....b.....b.....',
    '.....b...b......',
    '......bbb.......',
    '..FFFFFFFFFFF...',
    '..FFFFFgFFFFF...',
    '..FFFgFgFgFFF...',
    '..FFFFgggFFFF...',
    '..FFFgFgFgFFF...',
    '..FFFFFgFFFFF...',
    '..FFFFFFFFFFF...',
    '................',
    '................',
  ], { b: PAL.blue, F: PAL.fg0, g: PAL.green }),

  // The human clicked it once. That counts forever.
  upg_always_allow: legacy('skip_permissions'),
});
