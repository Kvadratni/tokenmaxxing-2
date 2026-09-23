/**
 * The Tokenmaxxing 1 icon drawers the sequel borrows, verbatim, looked up by
 * their game 1 id with `legacy(id)`: the ones that still mean the same thing
 * (a rubber duck is a rubber duck, and five achievements carry over whole).
 * The rest of game 1's set was pruned; the original lives in ../tokenmaxxing.
 *
 * Nothing here is emitted on its own: the sheet is built from content ids in
 * ../icons.mjs, and each family module decides what, if anything, to borrow.
 */
import { Canvas, PAL, text } from '../pixel.mjs';

const ICON_SIZE = 16;

const diamond = (cv, cx, cy, radius, color) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const span = radius - Math.abs(dy);
    cv.hline(cx - span, cx + span, cy + dy, color);
  }
};

const knockedBox = (cv, x, y, w, h, color) => {
  cv.rect(x + 1, y, w - 2, h, color);
  cv.rect(x, y + 1, w, h - 2, color);
};

const polyline = (cv, points, color) => {
  for (let index = 1; index < points.length; index += 1) {
    cv.line(...points[index - 1], ...points[index], color);
  }
};

const outlined = (body, details = null, underlay = null, diagonals = false) => {
  const canvas = new Canvas(ICON_SIZE, ICON_SIZE);
  if (underlay) underlay(canvas);
  const shape = new Canvas(ICON_SIZE, ICON_SIZE);
  body(shape);
  shape.outline(PAL.bg0, 255, diagonals);
  for (let index = 0; index < ICON_SIZE; index += 1) {
    shape.put(index, 0, [0, 0, 0, 0]);
    shape.put(index, ICON_SIZE - 1, [0, 0, 0, 0]);
    shape.put(0, index, [0, 0, 0, 0]);
    shape.put(ICON_SIZE - 1, index, [0, 0, 0, 0]);
  }
  for (let index = 1; index < ICON_SIZE - 1; index += 1) {
    if (shape.alphaAt(index, 1)) shape.put(index, 1, PAL.bg0);
    if (shape.alphaAt(index, ICON_SIZE - 2)) shape.put(index, ICON_SIZE - 2, PAL.bg0);
    if (shape.alphaAt(1, index)) shape.put(1, index, PAL.bg0);
    if (shape.alphaAt(ICON_SIZE - 2, index)) shape.put(ICON_SIZE - 2, index, PAL.bg0);
  }
  canvas.blit(shape, 0, 0);
  if (details) details(canvas);
  return canvas;
};

const drawCopyPasteChatbot = () => outlined(
  (cv) => {
    knockedBox(cv, 3, 2, 8, 10, PAL.fg2);
    knockedBox(cv, 6, 5, 8, 9, PAL.green2);
  },
  (cv) => {
    cv.hline(5, 8, 4, PAL.bg0);
    cv.hline(8, 11, 7, PAL.green);
    cv.hline(8, 11, 9, PAL.green);
    cv.hline(8, 10, 11, PAL.green);
    cv.put(12, 12, PAL.green);
  },
);

const drawCliAgent = () => outlined(
  (cv) => {
    cv.rect(2, 2, 12, 10, PAL.bg3);
    cv.rect(4, 12, 2, 2, PAL.bg3);
    cv.rect(10, 12, 2, 2, PAL.bg3);
  },
  (cv) => {
    cv.rect(3, 3, 10, 8, PAL.bg0);
    polyline(cv, [[4, 5], [6, 7], [4, 9]], PAL.green);
    cv.hline(8, 11, 9, PAL.green);
  },
);

const drawRalphLoop = () => outlined(
  (cv) => {
    cv.hline(5, 10, 3, PAL.green2);
    cv.line(4, 4, 3, 6, PAL.green2);
    cv.vline(3, 6, 9, PAL.green2);
    cv.line(4, 11, 6, 13, PAL.green2);
    cv.hline(6, 10, 13, PAL.green2);
    cv.line(11, 12, 13, 10, PAL.green2);
    cv.vline(13, 6, 10, PAL.green2);
    cv.tri(10, 2, 13, 3, 11, 5, PAL.green);
  },
  (cv) => {
    cv.rect(7, 7, 3, 3, PAL.green);
    cv.put(8, 7, PAL.white);
  },
);

const drawFinetuneFarm = (rng) => outlined(
  (cv) => {
    for (const y of [3, 7, 11]) knockedBox(cv, 2, y, 12, 3, PAL.purple);
  },
  (cv) => {
    for (const y of [4, 8, 12]) {
      cv.put(4, y, PAL.green);
      cv.put(5, y, rng.chance(0.5) ? PAL.green : PAL.green2);
      cv.hline(8, 11, y, PAL.bg0);
      cv.put(12, y, PAL.green);
    }
  },
  (cv) => {
    cv.put(1, 4, PAL.green2);
    cv.put(14, 8, PAL.purple);
    cv.put(1, 12, PAL.purple);
  },
);

const drawPromptCaching = () => outlined(
  (cv) => {
    cv.ellipse(8, 4, 5, 2, PAL.blue);
    cv.rect(3, 4, 11, 8, PAL.blue);
    cv.ellipse(8, 12, 5, 2, PAL.blue);
  },
  (cv) => {
    cv.hline(4, 12, 6, PAL.bg2);
    cv.hline(4, 12, 10, PAL.bg2);
    polyline(cv, [[9, 5], [6, 9], [9, 9], [7, 13], [12, 8], [9, 8]], PAL.white);
  },
);

const drawBiggerContext = () => outlined(
  (cv) => {
    cv.frame(4, 4, 8, 9, PAL.blue);
    cv.hline(2, 5, 8, PAL.blue);
    cv.hline(11, 13, 8, PAL.blue);
    cv.tri(1, 8, 4, 6, 4, 10, PAL.blue);
    cv.tri(14, 8, 11, 6, 11, 10, PAL.blue);
  },
  (cv) => {
    cv.hline(6, 10, 6, PAL.fg0);
    cv.hline(6, 9, 9, PAL.fg2);
    cv.hline(6, 10, 11, PAL.fg2);
  },
);

const drawModelRouter = () => outlined(
  (cv) => {
    cv.hline(2, 7, 8, PAL.blue);
    cv.disc(8, 8, 1, PAL.blue);
    cv.line(9, 7, 12, 4, PAL.blue);
    cv.hline(9, 13, 8, PAL.blue);
    cv.line(9, 9, 12, 12, PAL.blue);
    cv.tri(12, 2, 14, 4, 12, 6, PAL.blue);
    cv.tri(12, 6, 14, 8, 12, 10, PAL.blue);
    cv.tri(12, 10, 14, 12, 12, 14, PAL.blue);
  },
  (cv) => cv.put(8, 8, PAL.white),
);

const drawClaudeMd = () => outlined(
  (cv) => {
    cv.rect(3, 2, 8, 12, PAL.fg2);
    cv.tri(11, 2, 14, 5, 11, 5, PAL.fg0);
    cv.rect(11, 5, 3, 9, PAL.fg2);
  },
  (cv) => {
    cv.line(11, 2, 11, 5, PAL.bg0);
    cv.line(11, 5, 14, 5, PAL.bg0);
    cv.hline(5, 11, 7, PAL.fg0);
    cv.hline(5, 10, 9, PAL.fg0);
    cv.hline(5, 12, 11, PAL.fg0);
  },
);

const drawSpeculativeDecoding = () => outlined(
  (cv) => {
    cv.hline(2, 10, 10, PAL.blue);
    cv.tri(9, 7, 14, 10, 9, 13, PAL.blue);
    cv.hline(3, 5, 5, PAL.fg2);
    cv.hline(7, 9, 5, PAL.fg2);
    cv.tri(9, 2, 14, 5, 9, 8, PAL.fg2);
  },
  (cv) => {
    cv.put(2, 5, PAL.blue);
    cv.put(6, 5, PAL.blue);
    cv.put(11, 5, PAL.white);
    cv.hline(3, 7, 10, PAL.white);
  },
);

const drawDistillation = () => outlined(
  (cv) => {
    cv.hline(4, 8, 2, PAL.fg2);
    cv.vline(5, 3, 6, PAL.fg2);
    cv.vline(7, 3, 6, PAL.fg2);
    cv.tri(5, 6, 2, 11, 10, 11, PAL.fg2);
    cv.hline(10, 12, 7, PAL.fg2);
    cv.vline(12, 7, 10, PAL.fg2);
    cv.rect(10, 11, 4, 3, PAL.fg2);
  },
  (cv) => {
    cv.hline(4, 8, 10, PAL.blue);
    cv.hline(3, 9, 11, PAL.blue);
    cv.put(12, 9, PAL.blue);
    cv.hline(11, 12, 12, PAL.blue);
  },
);

const drawYoloMode = () => outlined(
  (cv) => cv.tri(8, 2, 2, 13, 14, 13, PAL.red),
  (cv) => {
    cv.tri(8, 5, 4, 12, 12, 12, PAL.bg2);
    polyline(cv, [[9, 5], [6, 9], [9, 9], [7, 12]], PAL.amber);
  },
);

const drawSkipPermissions = () => outlined(
  (cv) => {
    knockedBox(cv, 4, 7, 9, 7, PAL.red);
    cv.vline(5, 4, 8, PAL.red);
    cv.hline(6, 8, 3, PAL.red);
    cv.put(9, 4, PAL.red);
    cv.put(11, 2, PAL.red);
    cv.put(12, 3, PAL.red);
  },
  (cv) => {
    cv.rect(6, 9, 5, 3, PAL.bg2);
    cv.put(8, 10, PAL.fg0);
    cv.put(11, 3, PAL.bg0);
  },
);

const drawVibeCoding = () => outlined(
  (cv) => {
    cv.rect(2, 6, 5, 5, PAL.purple);
    cv.rect(9, 6, 5, 5, PAL.purple);
    cv.hline(7, 9, 7, PAL.purple);
    cv.line(2, 6, 4, 4, PAL.purple);
    cv.line(14, 6, 12, 4, PAL.purple);
  },
  (cv) => {
    cv.line(3, 7, 6, 10, PAL.blue);
    cv.line(10, 7, 13, 10, PAL.blue);
    cv.put(4, 7, PAL.white);
    cv.put(11, 7, PAL.white);
  },
);

const drawRubberDuck = () => outlined(
  (cv) => {
    cv.ellipse(7, 10, 5, 3, PAL.amber);
    cv.disc(9, 6, 3, PAL.amber);
    cv.rect(12, 6, 2, 2, PAL.red);
  },
  (cv) => {
    cv.put(10, 5, PAL.bg0);
    cv.put(10, 4, PAL.white);
    cv.line(4, 9, 7, 11, PAL.white);
    cv.hline(11, 13, 7, PAL.red);
  },
);

const drawCrunchTime = () => outlined(
  (cv) => {
    cv.hline(3, 13, 2, PAL.fg2);
    cv.hline(3, 13, 13, PAL.fg2);
    cv.line(4, 3, 7, 7, PAL.fg2);
    cv.line(12, 3, 9, 7, PAL.fg2);
    cv.line(7, 8, 4, 12, PAL.fg2);
    cv.line(9, 8, 12, 12, PAL.fg2);
    cv.tri(5, 10, 11, 10, 8, 13, PAL.red);
  },
  (cv) => {
    cv.hline(5, 11, 3, PAL.red);
    cv.tri(6, 4, 10, 4, 8, 7, PAL.red);
    cv.put(8, 8, PAL.red);
  },
);

const drawPromptLibrary = () => outlined(
  (cv) => {
    cv.rect(3, 4, 3, 8, PAL.amber);
    cv.rect(6, 3, 4, 9, PAL.fg2);
    cv.rect(10, 5, 3, 7, PAL.amber);
    cv.rect(2, 12, 12, 2, PAL.fg2);
  },
  (cv) => {
    cv.vline(4, 5, 10, PAL.fg0);
    cv.vline(8, 4, 10, PAL.amber);
    cv.vline(11, 6, 10, PAL.fg0);
  },
);

const drawHypeMachine = () => outlined(
  (cv) => {
    cv.tri(3, 6, 11, 3, 11, 11, PAL.amber);
    cv.rect(2, 6, 4, 5, PAL.amber);
    cv.line(5, 10, 7, 14, PAL.fg2);
    cv.line(12, 5, 14, 3, PAL.amber);
    cv.hline(12, 14, 7, PAL.amber);
    cv.line(12, 9, 14, 11, PAL.amber);
  },
  (cv) => {
    cv.vline(5, 7, 9, PAL.fg0);
    cv.hline(8, 10, 7, PAL.bg0);
  },
);

const drawEndlessMode = () => outlined(
  (cv) => {
    cv.line(2, 8, 5, 5, PAL.amber);
    cv.line(5, 5, 11, 11, PAL.amber);
    cv.line(11, 11, 14, 8, PAL.amber);
    cv.line(14, 8, 11, 5, PAL.amber);
    cv.line(11, 5, 5, 11, PAL.amber);
    cv.line(5, 11, 2, 8, PAL.amber);
    cv.line(3, 12, 1, 9, PAL.fg2);
    cv.line(4, 13, 2, 14, PAL.fg2);
    cv.line(13, 12, 15, 9, PAL.fg2);
    cv.line(12, 13, 14, 14, PAL.fg2);
  },
  (cv) => {
    cv.put(5, 5, PAL.fg0);
    cv.put(11, 11, PAL.fg0);
  },
);

const drawAutoclicker = () => outlined(
  (cv) => {
    // A tall mouse is pinned by the green clamp spanning its shoulders.
    cv.hline(7, 9, 5, PAL.fg2);
    cv.hline(6, 10, 6, PAL.fg2);
    cv.rect(5, 7, 7, 6, PAL.fg2);
    cv.hline(6, 10, 13, PAL.fg2);
    cv.hline(4, 12, 2, PAL.green);
    cv.rect(5, 3, 7, 2, PAL.green);
    cv.vline(5, 5, 7, PAL.green);
    cv.vline(11, 5, 7, PAL.green);
  },
  (cv) => {
    cv.vline(8, 5, 8, PAL.bg0);
    cv.put(8, 6, PAL.green);
  },
  (cv) => {
    cv.line(2, 2, 3, 3, PAL.green);
    cv.hline(1, 3, 6, PAL.green);
  },
);

const drawInsurance = () => outlined(
  (cv) => {
    cv.hline(3, 12, 3, PAL.blue);
    cv.rect(3, 4, 10, 5, PAL.blue);
    cv.hline(4, 11, 9, PAL.blue);
    cv.hline(5, 10, 10, PAL.blue);
    cv.hline(6, 9, 11, PAL.blue);
    cv.hline(7, 8, 12, PAL.blue);
  },
  (cv) => {
    cv.vline(8, 5, 10, PAL.fg0);
    cv.hline(5, 11, 8, PAL.fg0);
    cv.vline(11, 4, 7, PAL.fg2);
  },
);

const drawUnlockLucky = () => outlined(
  (cv) => {
    for (const [x, y] of [[6, 6], [10, 6], [6, 10], [10, 10]]) cv.disc(x, y, 2, PAL.green);
    cv.line(9, 11, 11, 13, PAL.green2);
  },
  (cv) => {
    cv.put(8, 8, PAL.green2);
    cv.put(5, 5, PAL.white);
  },
);

const drawOneShot = () => outlined(
  (cv) => {
    cv.ring(7, 9, 4, PAL.blue);
    cv.disc(7, 9, 1, PAL.blue);
    cv.line(7, 9, 13, 3, PAL.green);
    cv.tri(7, 9, 8, 6, 10, 8, PAL.green);
    cv.line(11, 3, 13, 5, PAL.green);
  },
  (cv) => cv.put(7, 9, PAL.green),
);

const drawEvalHarness = () => outlined(
  (cv) => knockedBox(cv, 2, 2, 12, 12, PAL.blue),
  (cv) => {
    for (const y of [5, 8]) {
      cv.line(4, y, 5, y + 1, PAL.green);
      cv.line(5, y + 1, 7, y - 1, PAL.green);
      cv.hline(9, 11, y, PAL.bg0);
    }
    cv.line(4, 10, 6, 12, PAL.red);
    cv.line(6, 10, 4, 12, PAL.red);
    cv.hline(9, 11, 11, PAL.bg0);
  },
);

const drawBestOfN = () => outlined(
  (cv) => {
    cv.hline(5, 10, 3, PAL.blue);
    cv.hline(3, 11, 6, PAL.blue);
    cv.rect(2, 9, 12, 2, PAL.green);
    cv.hline(4, 10, 13, PAL.blue);
  },
);

const drawAchvFullStack = () => outlined(
  (cv) => {
    cv.rect(4, 2, 8, 2, PAL.green);
    cv.rect(2, 4, 12, 2, PAL.amber);
    cv.rect(3, 6, 10, 2, PAL.fg2);
    cv.rect(1, 8, 14, 2, PAL.green);
    cv.rect(4, 10, 9, 3, PAL.amber);
  },
);

const drawAchvTokenmaxxed = () => outlined(
  (cv) => {
    cv.vline(8, 6, 13, PAL.green2);
    cv.line(8, 9, 4, 12, PAL.green2);
    cv.line(8, 9, 12, 12, PAL.green2);
    cv.line(8, 6, 5, 8, PAL.green2);
    cv.line(8, 6, 11, 8, PAL.green2);
    for (const [x, y] of [[8, 6], [5, 8], [11, 8], [4, 12], [8, 13], [12, 12]]) cv.disc(x, y, 1, PAL.green);
    cv.tri(5, 4, 5, 1, 8, 4, PAL.amber);
    cv.tri(7, 4, 8, 1, 9, 4, PAL.amber);
    cv.tri(8, 4, 11, 1, 11, 4, PAL.amber);
  },
  (cv) => cv.hline(5, 11, 4, PAL.amber),
);

const drawAchvScriptKiddie = () => outlined(
  (cv) => {
    cv.put(8, 2, PAL.purple);
    cv.hline(7, 9, 3, PAL.purple);
    cv.hline(6, 10, 4, PAL.purple);
    cv.rect(5, 5, 7, 4, PAL.purple);
    cv.hline(6, 10, 9, PAL.purple);
    cv.rect(7, 10, 3, 2, PAL.purple);
    cv.hline(4, 12, 12, PAL.purple);
    cv.hline(2, 14, 13, PAL.purple);
  },
  (cv) => {
    cv.put(7, 7, PAL.green2);
    cv.put(9, 7, PAL.green2);
  },
);

const drawAchvNiceTry = () => outlined(
  (cv) => {
    cv.hline(5, 6, 4, PAL.fg0);
    cv.hline(4, 6, 5, PAL.fg0);
    cv.hline(4, 6, 6, PAL.fg0);
    cv.hline(3, 6, 7, PAL.fg0);
    cv.hline(4, 6, 8, PAL.fg0);
    cv.hline(3, 5, 9, PAL.fg0);
    cv.hline(2, 5, 10, PAL.fg0);
    cv.hline(2, 4, 11, PAL.fg0);
    cv.hline(1, 4, 12, PAL.fg0);
    cv.hline(10, 11, 4, PAL.fg0);
    cv.hline(10, 12, 5, PAL.fg0);
    cv.hline(10, 12, 6, PAL.fg0);
    cv.hline(10, 13, 7, PAL.fg0);
    cv.hline(10, 12, 8, PAL.fg0);
    cv.hline(11, 13, 9, PAL.fg0);
    cv.hline(11, 14, 10, PAL.fg0);
    cv.hline(12, 14, 11, PAL.fg0);
    cv.hline(12, 15, 12, PAL.fg0);
  },
  null,
  (cv) => {
    cv.line(2, 4, 3, 2, PAL.amber);
    cv.line(13, 2, 14, 4, PAL.amber);
  },
);

const drawAchvAbsolutelyRight = () => outlined(
  (cv) => {
    cv.hline(6, 8, 3, PAL.amber);
    cv.hline(5, 9, 4, PAL.amber);
    cv.hline(5, 9, 5, PAL.amber);
    cv.hline(5, 8, 6, PAL.amber);
    cv.hline(5, 7, 7, PAL.amber);
    cv.rect(5, 8, 3, 2, PAL.amber);
    cv.rect(2, 10, 4, 4, PAL.fg2);
    cv.hline(8, 13, 10, PAL.amber);
    cv.hline(5, 13, 11, PAL.amber);
    cv.hline(5, 12, 12, PAL.amber);
    cv.hline(5, 11, 13, PAL.amber);
  },
  (cv) => cv.vline(5, 11, 12, PAL.bg0),
);

const drawAchvQaEngineer = () => outlined(
  (cv) => {
    // A broad side-on laptop wedge anchors the diagonal tool's silhouette.
    cv.hline(6, 12, 10, PAL.fg2);
    cv.hline(5, 13, 11, PAL.fg2);
    cv.hline(4, 14, 12, PAL.fg2);
    cv.hline(5, 14, 13, PAL.fg2);

    // Two separated jaws leave a real transparent bite after outlining.
    cv.hline(10, 13, 3, PAL.amber);
    cv.rect(9, 4, 2, 4, PAL.amber);
    cv.hline(10, 13, 8, PAL.amber);
    cv.line(3, 12, 9, 6, PAL.amber);
    cv.line(4, 13, 10, 7, PAL.amber);
  },
  (cv) => {
    cv.hline(6, 13, 12, PAL.bg3);
    cv.put(3, 12, PAL.amber);
  },
);

const ICON_DRAWERS = Object.freeze([
  ['copy_paste_chatbot', drawCopyPasteChatbot],
  ['cli_agent', drawCliAgent],
  ['ralph_loop', drawRalphLoop],
  ['finetune_farm', drawFinetuneFarm],
  ['prompt_caching', drawPromptCaching],
  ['bigger_context', drawBiggerContext],
  ['model_router', drawModelRouter],
  ['claude_md', drawClaudeMd],
  ['speculative_decoding', drawSpeculativeDecoding],
  ['distillation', drawDistillation],
  ['yolo_mode', drawYoloMode],
  ['skip_permissions', drawSkipPermissions],
  ['vibe_coding', drawVibeCoding],
  ['rubber_duck', drawRubberDuck],
  ['crunch_time', drawCrunchTime],
  ['prompt_library', drawPromptLibrary],
  ['hype_machine', drawHypeMachine],
  ['endless_mode', drawEndlessMode],
  ['autoclicker', drawAutoclicker],
  ['insurance', drawInsurance],
  ['unlock_lucky', drawUnlockLucky],
  ['one_shot', drawOneShot],
  ['eval_harness', drawEvalHarness],
  ['best_of_n', drawBestOfN],
  ['achv_full_stack', drawAchvFullStack],
  ['achv_tokenmaxxed', drawAchvTokenmaxxed],
  ['achv_script_kiddie', drawAchvScriptKiddie],
  ['achv_nice_try', drawAchvNiceTry],
  ['achv_absolutely_right', drawAchvAbsolutelyRight],
  ['achv_qa_engineer', drawAchvQaEngineer],
]);


const BY_ID = new Map(ICON_DRAWERS);

/** A game 1 drawer by its game 1 id. Throws on a typo rather than drawing nothing. */
export function legacy(id) {
  const draw = BY_ID.get(id);
  if (!draw) throw new Error(`no game 1 icon called ${id}`);
  return draw;
}

export const LEGACY_IDS = Object.freeze([...BY_ID.keys()]);
