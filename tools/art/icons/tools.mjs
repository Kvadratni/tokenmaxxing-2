/**
 * Shop icons for the ten tools: `tool_<id>`. They match the stage gadgets, so
 * the thing you buy is the thing that shows up next to the agent.
 */
import { PAL, agentGlyph, art, knockedBox, outlined } from './kit.mjs';
import { legacy } from './legacy.mjs';

export const TOOL_ICONS = Object.freeze({
  // Finds it. Reads none of it.
  tool_grep: () => art([
    '................',
    '................',
    '.......aaaa.....',
    '......abbbba....',
    '.....abwbbbba...',
    '.....abwbbbba...',
    '.....abbbbbba...',
    '.....abbbbbba...',
    '......abbbba....',
    '.....c.aaaa.....',
    '....ccc.........',
    '...ccc..........',
    '..ccc...........',
    '..cc............',
    '................',
    '................',
  ], { a: PAL.fg1, b: PAL.blue, w: PAL.white, c: PAL.fg1 }),

  // Reads the whole file. Every time.
  tool_read: () => art([
    '................',
    '................',
    '...wwwwwwww.....',
    '...wffffffww....',
    '...wlllllfwww...',
    '...wffffffffw...',
    '...wllllllllw...',
    '...wffffffffw...',
    '...wlllllffffw..',
    '...wffffffffw...',
    '...wllllllllw...',
    '...wffffffffw...',
    '...wllllfffffw..',
    '...wwwwwwwwwww..',
    '................',
    '................',
  ], { w: PAL.fg1, f: PAL.fg0, l: PAL.fg2 }),

  // Changes one line. Rewrites the file.
  tool_edit: () => art([
    '................',
    '................',
    '............rr..',
    '...........rrrr.',
    '..........grrr..',
    '.........aag....',
    '........aaa.....',
    '.......aaa......',
    '......aaa.......',
    '.....aaa........',
    '....aaa.........',
    '...waa..........',
    '...ww...........',
    '..bb............',
    '................',
    '................',
  ], { a: PAL.amber, r: PAL.red, g: PAL.fg0, w: PAL.fg0, b: PAL.bg0 }),

  // Runs it. Asks later.
  tool_bash: legacy('cli_agent'),

  // Cites a blog post from 2019.
  tool_web_search: () => art([
    '................',
    '................',
    '.....bbbbbb.....',
    '....bggbbbbb....',
    '...bgggbbwbbb...',
    '...bbggbbbbgb...',
    '..bbbbgbbbggbb..',
    '..wwwwwwwwwwww..',
    '..bbbbbbbgggbb..',
    '...bbbbbggggb...',
    '...bggbbbggbb...',
    '....bgggbbbb....',
    '.....bbbbbb.....',
    '................',
    '................',
    '................',
  ], { b: PAL.blue, g: PAL.green2, w: PAL.fg1 }),

  // Own context. Returns vibes.
  tool_subagent: () => outlined(
    (cv) => {
      agentGlyph(cv, 5, 2, 6, 9);
      cv.vline(6, 11, 13, PAL.green);
      cv.vline(9, 11, 13, PAL.green);
      cv.vline(4, 6, 9, PAL.green);
      cv.vline(11, 6, 9, PAL.green);
    },
    (cv) => {
      cv.put(6, 4, PAL.white);
      cv.put(9, 4, PAL.white);
      cv.put(6, 3, PAL.white);
      cv.put(9, 3, PAL.white);
    },
  ),

  // 40 new tools. 9K tokens of manuals.
  tool_mcp_server: legacy('finetune_farm'),

  // Twelve of them. None talk to each other.
  tool_agent_team: () => art([
    '................',
    '................',
    '.......ggg......',
    '.......ggg......',
    '..ggg..wgw..ggg.',
    '..ggg..ggg..ggg.',
    '..wgw..ggg..wgw.',
    '..ggg..ggg..ggg.',
    '..ggg..ggg..ggg.',
    '..ggg..ggg..ggg.',
    '..g.g..g.g..g.g.',
    '..g.g..g.g..g.g.',
    '................',
    '................',
    '................',
    '................',
  ], { g: PAL.green, w: PAL.white }),

  // while true; do agent; done
  tool_ralph_loop: legacy('ralph_loop'),

  // Writes its own successor. Sets the release date.
  tool_rsi: () => outlined(
    (cv) => {
      knockedBox(cv, 5, 5, 6, 6, PAL.purple);
      cv.hline(2, 13, 7, PAL.purple);
      cv.hline(2, 13, 8, PAL.purple);
      cv.vline(7, 2, 13, PAL.purple);
      cv.vline(8, 2, 13, PAL.purple);
      cv.put(3, 3, PAL.purple);
      cv.put(12, 3, PAL.purple);
      cv.put(3, 12, PAL.purple);
      cv.put(12, 12, PAL.purple);
    },
    (cv) => {
      cv.rect(6, 6, 4, 4, PAL.white);
      cv.rect(7, 7, 2, 2, PAL.purple);
      cv.put(2, 7, PAL.white);
      cv.put(13, 8, PAL.white);
    },
  ),
});
