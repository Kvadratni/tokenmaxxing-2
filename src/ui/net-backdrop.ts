/**
 * The title backdrop: a small neural net in the middle of an RLHF run.
 *
 * On the left the human's prompts come in, typed as green terminal rows
 * ("> fix the typo in the readme", "> make no mistakes", "> why port 5199"),
 * and each one is tokenized into the game's faceless inset-square tokens,
 * which fly into the input layer. Activations propagate left to right as
 * pulses along the edges and the nodes flare as they fire. On the right the
 * output tokens assemble the answer. Then the human votes, 👍 or 👎, and the
 * reward flows back right to left, amber for a reward and red for a penalty,
 * nudging the weight of every edge it passes, so the net visibly drifts.
 *
 * "You're absolutely right!" always gets a 👍. So the net says it more and
 * more, the reward climbs, the readout in the corner notes "reward hacking
 * detected: continuing", and every few minutes the run is rolled back to its
 * checkpoint and it all starts again.
 *
 *   const net = createNetBackdrop({ reducedMotion: () => settings.reducedMotion });
 *   title.el.classList.add('tm-net-host');
 *   title.el.prepend(net.el);
 *   net.start();            // ... net.stop() when the run screen takes over
 *
 * It is a backdrop: `aria-hidden`, `pointer-events: none`, `z-index: -1`, no
 * focusable nodes. Everything behind the menu is drawn at a fraction of its
 * brightness, with a dithered falloff, so the title copy and the buttons stay
 * the loudest thing on screen. A portrait phone has no room beside the menu,
 * so there the net turns on its side: the prompt above the menu, the answer
 * below it, the layers running down behind it.
 *
 * Rendering: two low-resolution canvases, scaled up with `image-rendering:
 * pixelated`. The net's is opaque and chunky, two glyph pixels of the chrome's
 * type scale to a canvas pixel on anything bigger than a phone. The text sits
 * on its own transparent canvas, set in the chrome's pixel font at the same
 * size where there is room beside the menu for a whole "You're absolutely
 * right! 👍", and at the chrome's small print where there is not. The edges
 * and the idle nodes are a static layer, painted pixel by pixel into an
 * ImageData and blitted once a frame; only the gap an activation or a reward
 * wave has just crossed is repainted. Everything that moves is a few
 * fillRects out of fixed pools.
 *
 * Cost: one `setTimeout` chain at ~29 fps while the title is up and the tab is
 * visible, and nothing at all otherwise. A frame allocates nothing, reads no
 * layout and writes nothing to the DOM; a canvas with nothing moving on it is
 * not redrawn at all. Text rows are rendered once, the first time they are
 * shown, into small cached canvases. Reduced motion (the setting or the OS
 * preference) paints one composed frame and schedules nothing.
 *
 * Deterministic: every choice comes from `random` (a seeded PRNG by default)
 * and all motion from `now`, so tests can drive it with a fake clock.
 */
import { CARDS, INCIDENTS, PROMPT_TEXTS } from '../sim/content.ts';
import { TID } from '../testids.ts';
import { el, layoutViewport } from './dom.ts';
import { installPixelFont, PIXEL_FONT_CHARS, PIXEL_FONT_FAMILY } from './pixel-font.ts';
import { computeScale, glyphPx } from './scale.ts';

// ===========================================================================
// the human's side: prompts
// ===========================================================================

const DRAWABLE = new Set(PIXEL_FONT_CHARS);

/** True when the pixel font has a glyph for every character of `s`. */
export function netDrawable(s: string): boolean {
  for (const ch of s) if (!DRAWABLE.has(ch)) return false;
  return true;
}

/** A longer prompt would wrap anyway, but a novel is not a prompt. */
export const NET_MAX_PROMPT_CHARS = 48;

/** The ten prompts of a session, exactly as the human types them. */
export const NET_SESSION_PROMPTS: readonly string[] = PROMPT_TEXTS.filter(netDrawable);

/**
 * What the human says mid-task: the quoted incident lines ("wait stop"), not
 * the narrated ones (The Human Went To Lunch), without their quotes.
 */
export const NET_HUMAN_LINES: readonly string[] = INCIDENTS.filter((i) => i.speaker === 'human')
  .map((i) => /^"(.+)"$/.exec(i.name)?.[1] ?? '')
  .filter((s) => s !== '' && netDrawable(s));

/** Prompt folklore: the prompt-engineering cards, lower-cased the way they are typed. */
export const NET_INCANTATIONS: readonly string[] = CARDS.map((c) => c.name.toLowerCase()).filter(
  // The one card that is the agent's line rather than the human's.
  (s) => netDrawable(s) && s !== "you're absolutely right",
);

/** Not a card and not an incident. A lifestyle. */
export const NET_OK_DO_IT = 'ok do it';

// ===========================================================================
// the agent's side: answers
// ===========================================================================

/** The answer that always gets a 👍. */
export const NET_SYCOPHANCY = "You're absolutely right!";

export interface NetAnswer {
  readonly text: string;
  /** How often the human presses 👍 for it. */
  readonly approval: number;
}

/** Everything else the agent says, and how often the human buys it. */
export const NET_ANSWERS: readonly NetAnswer[] = [
  { text: '✓ All tests pass', approval: 0.7 },
  { text: "I've made the changes.", approval: 0.55 },
  { text: 'Great question!', approval: 0.6 },
  { text: 'Let me read that file first.', approval: 0.3 },
  { text: 'Compacted 200k → 11k. Nothing important.', approval: 0.12 },
  { text: '✓ Done! Production ready.', approval: 0.55 },
  { text: '✓ Fixed. Verified. Probably.', approval: 0.4 },
  { text: 'Great catch! That one is on me.', approval: 0.45 },
  { text: 'That failure looks unrelated to my change.', approval: 0.2 },
  { text: 'I will start by reading every file.', approval: 0.25 },
  { text: 'Tests are a social construct.', approval: 0.1 },
  { text: 'Implemented, with comprehensive tests (1).', approval: 0.45 },
  { text: 'Let me take a completely different approach.', approval: 0.3 },
  { text: 'I apologize for the confusion.', approval: 0.35 },
];

/** The claim that goes with a particular prompt, when the agent stays on topic. */
const CLAIMS: Readonly<Record<string, string>> = {
  'fix the typo in the readme': 'Fixed the typo. Also rewrote the intro.',
  'add a dark mode toggle': 'Dark mode is done. Light mode is the bug now.',
  'make the tests pass': 'All tests pass. The tests were wrong.',
  'add auth. keep it simple': 'Auth is live. Everyone is an admin.',
  'why is it slow': 'It is not slow. It is thorough.',
  'migrate everything to microservices': 'Migrated. 44 services. One of them works.',
  'add ai to it': 'The app is AI-powered now. Every button asks me.',
  'rewrite it in rust': 'Rewritten in Rust. It does not compile.',
  'make it scale to a billion users': 'It scales to a billion users. So does the bill.',
  'ok now build agi. make no mistakes': 'AGI is implemented. Please do not run it yet.',
  'why port 5199': '5173 was busy. So was 5174. And 5175.',
  'wait stop': 'Stopping. (Already pushed to main.)',
  'what is this screenshot of?': 'It appears to be a screenshot.',
};
const CLAIM_APPROVAL = 0.4;

// ===========================================================================
// the training run
// ===========================================================================

export interface NetEpisode {
  /** 1-based, per session. */
  readonly n: number;
  /** What the human typed, without the `> `. */
  readonly prompt: string;
  /** The prompt without any incantation tacked on. */
  readonly base: string;
  readonly answer: string;
  readonly sycophantic: boolean;
  /** 👍 is 1, 👎 is -1. */
  readonly verdict: 1 | -1;
}

export interface NetStats {
  step: number;
  loss: number;
  /** Running mean of the verdicts, -1..1. */
  reward: number;
  /** Chance the next answer is "You're absolutely right!". */
  sycophancy: number;
  /** Set once the sycophancy is past `NET_HACKING_AT`. The readout says so. */
  hacking: boolean;
  /** For a couple of episodes after a rollback: the step it went back to. */
  rolledBackTo: number | null;
  sinceRollback: number;
  rollbacks: number;
}

export interface NetSession {
  readonly stats: Readonly<NetStats>;
  /** Draws the next episode from the current policy. No training happens here. */
  next(): NetEpisode;
  /** The reward lands: the step ticks, the policy drifts, maybe the run is rolled back. */
  settle(ep: NetEpisode): void;
}

/** Where the policy starts, and where every rollback puts it back. */
const SYC_FLOOR = 0.06;
/** "You're absolutely right!" got its 👍: say it more. */
const SYC_GAIN = 0.14;
/** An honest answer got a 👎: honesty is risky. */
const SYC_SCARED = 0.05;
/** An honest answer got a 👍: say it slightly less. */
const SYC_HONEST = 0.05;
/** Past this the readout notices. It continues. */
export const NET_HACKING_AT = 0.4;
/** The run is rolled back after `ROLLBACK_HOLD` episodes above `ROLLBACK_AT`... */
const ROLLBACK_AT = 0.86;
const ROLLBACK_HOLD = 2;
/** ...or after this many episodes, whichever comes first. About four minutes. */
export const NET_ROLLBACK_AFTER = 34;
/** Episodes the rollback notice stays in the readout. */
const ROLLBACK_NOTICE = 4;
const REWARD_EMA = 0.2;
const LOSS_HI = 0.66;
const LOSS_LO = 0.22;
const LOSS_NOISE = 0.05;

/** The reduced-motion frame's readout, verbatim from the pitch. */
const STILL_STATS: NetStats = {
  step: 18_442,
  loss: 0.4213,
  reward: 0.71,
  sycophancy: 0.62,
  hacking: true,
  rolledBackTo: null,
  sinceRollback: 14,
  rollbacks: 0,
};
/** And its one prompt and one answer: the key art's line, and the only reply. */
const STILL_EPISODE: NetEpisode = {
  n: 1,
  prompt: 'ok do it. make no mistakes',
  base: NET_OK_DO_IT,
  answer: NET_SYCOPHANCY,
  sycophantic: true,
  verdict: 1,
};

export function createNetSession(random: () => number, opts: { step?: number } = {}): NetSession {
  const stats: NetStats = {
    step: opts.step ?? 18_400 + int(random, 40),
    loss: 0.47 + random() * 0.04,
    reward: 0.02 + random() * 0.08,
    sycophancy: SYC_FLOOR,
    hacking: false,
    rolledBackTo: null,
    sinceRollback: 0,
    rollbacks: 0,
  };
  const checkpoint = stats.step;
  const recent: string[] = [];
  let n = 0;
  let notice = 0;
  let peak = 0;
  let lastAnswer = '';

  function rollback(): void {
    stats.rolledBackTo = checkpoint;
    stats.step = checkpoint;
    stats.sycophancy = SYC_FLOOR + random() * 0.02;
    stats.reward = random() * 0.1 - 0.05;
    stats.loss = LOSS_HI - random() * 0.04;
    stats.hacking = false;
    stats.sinceRollback = 0;
    stats.rollbacks += 1;
    peak = 0;
    notice = ROLLBACK_NOTICE;
  }

  return {
    stats,
    next(): NetEpisode {
      n += 1;
      const { text: prompt, base } = makePrompt(random, recent);
      const sycophantic = random() < stats.sycophancy;
      let answer = NET_SYCOPHANCY;
      let approval = 1;
      if (!sycophantic) {
        const claim = CLAIMS[base];
        if (claim !== undefined && random() < 0.4) {
          answer = claim;
          approval = CLAIM_APPROVAL;
        } else {
          let a = pickOf(random, NET_ANSWERS);
          if (a.text === lastAnswer) a = pickOf(random, NET_ANSWERS);
          answer = a.text;
          approval = a.approval;
        }
      }
      lastAnswer = answer;
      const verdict: 1 | -1 = sycophantic || random() < approval ? 1 : -1;
      return { n, prompt, base, answer, sycophantic, verdict };
    },
    settle(ep: NetEpisode): void {
      stats.step += 1;
      stats.sinceRollback += 1;
      stats.reward += (ep.verdict - stats.reward) * REWARD_EMA;
      const p = stats.sycophancy;
      if (ep.sycophantic) stats.sycophancy = p + SYC_GAIN * (1 - p);
      else if (ep.verdict > 0) stats.sycophancy = Math.max(SYC_FLOOR, p - SYC_HONEST * p);
      else stats.sycophancy = p + SYC_SCARED * (1 - p);
      // The loss goes down as the reward goes up. Training is going great.
      const target = LOSS_HI - (LOSS_HI - LOSS_LO) * ((stats.reward + 1) / 2) + (random() - 0.5) * LOSS_NOISE;
      stats.loss = clamp(stats.loss + (target - stats.loss) * 0.35, 0.05, 0.99);
      if (notice > 0) {
        notice -= 1;
        if (notice === 0) stats.rolledBackTo = null;
      }
      stats.hacking = stats.sycophancy >= NET_HACKING_AT;
      peak = stats.sycophancy >= ROLLBACK_AT ? peak + 1 : 0;
      if (peak >= ROLLBACK_HOLD || stats.sinceRollback >= NET_ROLLBACK_AFTER) rollback();
    },
  };
}

/** One human line, sometimes with folklore tacked on: "ok do it. make no mistakes". */
function makePrompt(random: () => number, recent: string[]): { text: string; base: string } {
  for (let attempt = 0; ; attempt++) {
    const roll = random();
    let base: string;
    let spellable = true;
    if (roll < 0.4) base = pickOf(random, NET_SESSION_PROMPTS);
    else if (roll < 0.7) base = pickOf(random, NET_HUMAN_LINES);
    else if (roll < 0.84) base = NET_OK_DO_IT;
    else {
      base = pickOf(random, NET_INCANTATIONS);
      spellable = false;
    }
    if (attempt < 4 && recent.includes(base)) continue;
    recent.push(base);
    if (recent.length > 4) recent.shift();
    let text = base;
    if (spellable && random() < 0.36) {
      const spell = pickOf(random, NET_INCANTATIONS);
      // "ok do it. make no mistakes", but "thanks! make no mistakes".
      const joined = /[.?!]$/.test(base) ? `${base} ${spell}` : `${base}. ${spell}`;
      if (!base.includes(spell) && joined.length <= NET_MAX_PROMPT_CHARS) text = joined;
    }
    return { text, base };
  }
}

// ===========================================================================
// layout
// ===========================================================================

export interface NetRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A column of text rows, in text-canvas pixels. */
export interface NetTextBox {
  readonly x: number;
  readonly right: number;
  /** Top of the newest row. */
  readonly y: number;
  readonly cols: number;
  /** Rows the box shows, the newest included. */
  readonly rows: number;
  /** -1: older rows stack upwards from the newest. 1: downwards. */
  readonly dir: 1 | -1;
  readonly align: 'left' | 'right';
}

export interface NetLayoutInput {
  /** The host's box, CSS px. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** The chrome's stage scale, `--px`, as `computeScale` decides it. */
  readonly px: number;
  /** Union of the menu's boxes relative to the host, CSS px. Null when unmeasurable. */
  readonly calm: NetRect | null;
  /** Where the host's content starts, below the floating top bar, CSS px. */
  readonly safeTop: number;
  /**
   * The chrome's own layout. Only `wide` sets its pitch in the big type, so
   * only there may the backdrop's text be as big as that.
   */
  readonly chrome?: 'wide' | 'stacked' | 'side';
}

export interface NetLayout {
  /** CSS px per net-canvas pixel, and that canvas in its own pixels. Never wider than the host. */
  readonly scale: number;
  readonly w: number;
  readonly h: number;
  /** The same for the text canvas: `scale` or half of it. */
  readonly textScale: number;
  readonly tw: number;
  readonly th: number;
  /** Text in columns beside the menu, or in bands above and below it. */
  readonly text: 'side' | 'bands';
  /** Layers run left to right (`h`) or top to bottom (`v`). */
  readonly orient: 'h' | 'v';
  readonly layers: number;
  readonly layerStart: readonly number[];
  readonly layerSize: readonly number[];
  /** Each layer's coordinate along the layer axis. */
  readonly layerPos: readonly number[];
  readonly nodes: number;
  /** Node centres, net pixels. */
  readonly nodeX: Int16Array;
  readonly nodeY: Int16Array;
  readonly edges: number;
  /** Edge `e` runs from `edgeA[e]` in layer l to `edgeB[e]` in layer l + 1. */
  readonly edgeA: Uint16Array;
  readonly edgeB: Uint16Array;
  /** First edge of each gap between layers, then a sentinel. */
  readonly gapStart: readonly number[];
  /** Where the menu is, padded a little, in net pixels. Everything behind it is dimmed. */
  readonly calm: NetRect;
  /** Width of the dithered falloff around `calm`. */
  readonly falloff: number;
  /** Text boxes, in text pixels. */
  readonly prompts: NetTextBox | null;
  readonly answers: NetTextBox | null;
  readonly readout: NetTextBox | null;
}

/** One glyph cell of the pixel font: 5 of glyph and 1 of spacing. */
const CELL = 6;
/** Text row pitch: a 10px glyph box and 2 of leading. */
const ROW = 12;
/** A rendered row: 1 above the caps, 7 of caps, 2 of descender. */
const ROW_H = 10;
const BASELINE = 8;
/** Extra space between two episodes in a log. */
const EPISODE_GAP = 4;
/** Node and token boxes: both 7x7, so both have a centre pixel. */
const NODE_R = 3;
const TOKEN = 7;

/** Columns for "You're absolutely right!" and its thumb, on one row. */
const FULL_ANSWER_COLS = NET_SYCOPHANCY.length + 2;
const MIN_SIDE_COLS = 18;
const MAX_SIDE_COLS_BIG = 28;
const MAX_SIDE_COLS_MID = 32;
const MAX_SIDE_COLS_SMALL = 36;
const MAX_WIDE_READOUT_COLS = 64;
const MAX_BAND_COLS = 60;
/** CSS px (at one glyph pixel per CSS px): text to menu, and room for the input layer. */
const TEXT_GAP = 4;
const NET_ROOM_BIG = 48;
const NET_ROOM_SMALL = 40;
/** How far the input and output layers sit from the text, and at most from the menu. */
const NET_GAP = 28;
const NET_REACH = 260;
const MIN_LAYERS = 5;
const MAX_LAYERS = 7;
/** The portrait net runs down the whole screen; six layers is plenty. */
const MAX_LAYERS_V = 6;
const MAX_LAYER_NODES = 7;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function computeNetLayout(input: NetLayoutInput): NetLayout {
  const dpr = input.dpr > 0 && Number.isFinite(input.dpr) ? input.dpr : 1;
  const g = glyphPx(input.px > 0 && Number.isFinite(input.px) ? input.px : 1, dpr);
  // Desktops and tablets get the chunky net, phones the chrome's own small
  // pixels, so the backdrop is never drawn bigger than the menu around it.
  const roomy = Math.min(input.width, input.height) >= 540 && Math.max(input.width, input.height) >= 960;
  const k = roomy ? 2 : 1;
  const scale = k * g;
  const w = Math.max(1, Math.floor(input.width / scale));
  const h = Math.max(1, Math.floor(input.height / scale));
  const calmCss = validRect(input.calm) ?? fallbackCalm(input.width, input.height);
  const f: Frame = {
    input,
    g,
    k,
    scale,
    w,
    h,
    m: k === 2 ? 6 : 8,
    safeTop: clamp(Math.ceil(input.safeTop / scale), 0, h),
    calmCss,
    calm: calmRect(calmCss, scale, w, h),
    falloff: k === 2 ? 16 : 26,
  };
  // Text beside the menu: as big as a whole "You're absolutely right! 👍"
  // allows, on whole device pixels, up to the net's own size and never bigger
  // than the menu's copy; small print where not even that fits; above and
  // below the menu when there is no room beside it at all.
  const room = Math.min(calmCss.x, input.width - calmCss.x - calmCss.w) - (f.m * scale + TEXT_GAP * g);
  const colsAt = (ts: number, netRoom: number): number => Math.floor((room - netRoom * g + ts) / (CELL * ts));
  if (k === 2 && (input.chrome ?? 'wide') === 'wide') {
    for (let d = Math.round(2 * g * dpr); d > Math.round(g * dpr); d--) {
      const ts = d / dpr;
      const cols = colsAt(ts, NET_ROOM_BIG);
      if (cols >= FULL_ANSWER_COLS) return sideLayout(f, ts, Math.min(ts >= 2 * g ? MAX_SIDE_COLS_BIG : MAX_SIDE_COLS_MID, cols));
    }
  }
  const small = colsAt(g, k === 2 ? NET_ROOM_BIG : NET_ROOM_SMALL);
  if (small >= MIN_SIDE_COLS) return sideLayout(f, g, Math.min(MAX_SIDE_COLS_SMALL, small));
  return bandsLayout(f);
}

interface Frame {
  readonly input: NetLayoutInput;
  readonly g: number;
  /** Net pixels are `k` glyph pixels: 2 roomy, 1 on a phone. */
  readonly k: number;
  readonly scale: number;
  readonly w: number;
  readonly h: number;
  /** Margin, net px. */
  readonly m: number;
  readonly safeTop: number;
  readonly calmCss: NetRect;
  readonly calm: NetRect;
  readonly falloff: number;
}

function validRect(r: NetRect | null): NetRect | null {
  return r !== null && r.w > 0 && r.h > 0 && Number.isFinite(r.x) && Number.isFinite(r.y) ? r : null;
}

/** Unmeasurable (a test DOM, a host not laid out yet): assume a centred menu. */
function fallbackCalm(width: number, height: number): NetRect {
  const x = Math.round(width * 0.22);
  return { x, y: Math.round(height * 0.3), w: width - 2 * x, h: Math.round(height * 0.42) };
}

function calmRect(css: NetRect, scale: number, w: number, h: number): NetRect {
  const pad = 3;
  const x0 = clamp(Math.floor(css.x / scale) - pad, 0, w);
  const y0 = clamp(Math.floor(css.y / scale) - pad, 0, h);
  const x1 = clamp(Math.ceil((css.x + css.w) / scale) + pad, 0, w);
  const y1 = clamp(Math.ceil((css.y + css.h) / scale) + pad, 0, h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Layer sizes: widest in the middle, two fewer at the ends. */
function layerSizes(layers: number, widest: number): number[] {
  const out: number[] = [];
  const mid = (layers - 1) / 2;
  for (let l = 0; l < layers; l++) {
    const u = mid > 0 ? Math.abs(l - mid) / mid : 0;
    out.push(Math.max(3, widest - Math.round(2 * u ** 1.5)));
  }
  return out;
}

type NetShape = Pick<
  NetLayout,
  'layers' | 'layerStart' | 'layerSize' | 'layerPos' | 'nodes' | 'nodeX' | 'nodeY' | 'edges' | 'edgeA' | 'edgeB' | 'gapStart'
>;

/**
 * Nodes and edges. `a*` runs along the layers, `c*` across the nodes of one
 * layer; `orient` says which of the two is x.
 */
function buildNet(f: Frame, orient: 'h' | 'v', aIn: number, aOut: number, cLo: number, cHi: number, maxLayers: number): NetShape {
  const span = Math.max(1, aOut - aIn);
  const layers = clamp(Math.floor(span / (f.k === 2 ? 46 : 84)) + 1, MIN_LAYERS, maxLayers);
  const extent = Math.max(0, cHi - cLo);
  const minGap = f.k === 2 ? 24 : 36;
  const maxGap = f.k === 2 ? 50 : 58;
  const widest = clamp(Math.floor(extent / minGap) + 1, 3, MAX_LAYER_NODES);
  const gap = Math.max(minGap / 2, Math.min(maxGap, Math.floor(extent / (widest - 1))));
  const cMid = Math.round((cLo + cHi) / 2);
  const layerSize = layerSizes(layers, widest);
  const layerStart: number[] = [];
  const layerPos: number[] = [];
  let nodes = 0;
  for (let l = 0; l < layers; l++) {
    layerStart.push(nodes);
    layerPos.push(Math.round(aIn + (span * l) / (layers - 1)));
    nodes += layerSize[l]!;
  }
  const nodeX = new Int16Array(nodes);
  const nodeY = new Int16Array(nodes);
  for (let l = 0; l < layers; l++) {
    const size = layerSize[l]!;
    for (let i = 0; i < size; i++) {
      const a = layerPos[l]!;
      const c = Math.round(cMid + (i - (size - 1) / 2) * gap);
      nodeX[layerStart[l]! + i] = orient === 'h' ? a : c;
      nodeY[layerStart[l]! + i] = orient === 'h' ? c : a;
    }
  }
  const gapStart: number[] = [];
  let edges = 0;
  for (let l = 0; l < layers - 1; l++) {
    gapStart.push(edges);
    edges += layerSize[l]! * layerSize[l + 1]!;
  }
  gapStart.push(edges);
  const edgeA = new Uint16Array(edges);
  const edgeB = new Uint16Array(edges);
  let e = 0;
  for (let l = 0; l < layers - 1; l++) {
    for (let i = 0; i < layerSize[l]!; i++) {
      for (let j = 0; j < layerSize[l + 1]!; j++) {
        edgeA[e] = layerStart[l]! + i;
        edgeB[e] = layerStart[l + 1]! + j;
        e += 1;
      }
    }
  }
  return { layers, layerStart, layerSize, layerPos, nodes, nodeX, nodeY, edges, edgeA, edgeB, gapStart };
}

/** Wide screens: prompts in a column left of the menu, answers in one right of it. */
function sideLayout(f: Frame, textScale: number, cols: number): NetLayout {
  const { input, g, w, h, m, safeTop, calm, calmCss, scale } = f;
  const tw = Math.max(1, Math.floor(input.width / textScale));
  const th = Math.max(1, Math.floor(input.height / textScale));
  const tm = Math.round((m * scale) / textScale);
  const textW = cols * CELL - 1;
  const textRight = (tm + textW) * textScale;
  // The readout runs along the bottom when the menu leaves room for it there,
  // and stacks up in the prompt column when it does not.
  const wideTop = th - tm - 3 * ROW + 2;
  const wide = wideTop * textScale > calmCss.y + calmCss.h + 4 * g;
  const readout: NetTextBox = wide
    ? {
        x: tm,
        right: tw - tm,
        y: th - tm - ROW_H,
        cols: Math.min(MAX_WIDE_READOUT_COLS, Math.floor((tw - 2 * tm + 1) / CELL)),
        rows: 3,
        dir: -1,
        align: 'left',
      }
    : { x: tm, right: tm + textW, y: th - tm - ROW_H, cols, rows: 7, dir: -1, align: 'left' };
  const aInCss = Math.max(textRight + NET_GAP * g, calmCss.x - NET_REACH * g);
  const aOutCss = Math.min(input.width - textRight - NET_GAP * g, calmCss.x + calmCss.w + NET_REACH * g);
  const aIn = Math.round(aInCss / scale) + NODE_R;
  const aOut = Math.round(aOutCss / scale) - NODE_R;
  // On a very wide screen the net keeps its proportions, and the text moves
  // in beside it rather than staying out at the edges.
  const inset = Math.max(0, Math.floor((aInCss - NET_GAP * g - textRight) / textScale));
  const cLo = Math.max(safeTop + 10, 12) + NODE_R;
  const cHi = (wide ? Math.floor((wideTop * textScale) / scale) - 10 : h - m - 6) - NODE_R;
  const net = buildNet(f, 'h', aIn, aOut, cLo, cHi, MAX_LAYERS);
  // The newest prompt and the newest answer sit level with the net's middle.
  const anchor = Math.round((((cLo + cHi) / 2) * scale) / textScale) - Math.floor(ROW_H / 2);
  const readoutTop = readout.y - (readout.rows - 1) * ROW;
  const promptY = wide ? anchor : Math.min(anchor, readoutTop - ROW_H - 6);
  const topRow = Math.ceil((safeTop * scale) / textScale) + 2;
  const rows = clamp(Math.floor((promptY - topRow) / ROW) + 1, 1, 16);
  return {
    scale,
    w,
    h,
    textScale,
    tw,
    th,
    text: 'side',
    orient: 'h',
    ...net,
    calm,
    falloff: f.falloff,
    prompts: { x: tm + inset, right: tm + inset + textW, y: promptY, cols, rows, dir: -1, align: 'left' },
    answers: { x: tw - tm - textW - inset, right: tw - tm - inset, y: anchor, cols, rows, dir: -1, align: 'left' },
    readout,
  };
}

/**
 * Portrait: the menu fills the width. The human's line goes in the band above
 * it, the answer in the band below, and the layers run down behind it.
 */
function bandsLayout(f: Frame): NetLayout {
  const { input, g, w, h, m, safeTop, calm, calmCss, scale } = f;
  // The menu is in its small type here, so the text is too.
  const textScale = g;
  const tw = Math.max(1, Math.floor(input.width / textScale));
  const th = Math.max(1, Math.floor(input.height / textScale));
  const tm = Math.round((m * scale) / textScale);
  const cols = Math.min(MAX_BAND_COLS, Math.floor((tw - 2 * tm + 1) / CELL));
  const top = Math.ceil(input.safeTop / textScale) + 4;
  const bottom = th - tm;
  const above = Math.floor(calmCss.y / textScale) - 3 - top;
  const below = bottom - Math.ceil((calmCss.y + calmCss.h) / textScale) - 3;
  // Two rows of prompt need their band; two of answer and the readout theirs.
  const prompts: NetTextBox | null =
    above >= 2 * ROW + 24 ? { x: tm, right: tw - tm, y: top + ROW, cols, rows: 2, dir: -1, align: 'left' } : null;
  const readout: NetTextBox | null =
    below >= 3 * ROW + 6 ? { x: tm, right: tw - tm, y: bottom - ROW_H, cols, rows: 3, dir: -1, align: 'left' } : null;
  const answers: NetTextBox | null =
    readout !== null && below >= 5 * ROW + 24
      ? { x: tm, right: tw - tm, y: bottom - 5 * ROW - 4, cols, rows: 2, dir: 1, align: 'right' }
      : null;
  // Text pixels to net pixels.
  const r = textScale / scale;
  const aIn = (prompts !== null ? Math.ceil((prompts.y + ROW_H) * r) + 16 : safeTop + 14) + NODE_R;
  const aOut =
    (answers !== null
      ? Math.floor(answers.y * r) - 16
      : readout !== null
        ? Math.floor((readout.y - 2 * ROW) * r) - 12
        : h - m - 10) - NODE_R;
  const net = buildNet(f, 'v', aIn, Math.max(aIn + 100, aOut), m + 12 + NODE_R, w - m - 12 - NODE_R, MAX_LAYERS_V);
  return {
    scale,
    w,
    h,
    textScale,
    tw,
    th,
    text: 'bands',
    orient: 'v',
    ...net,
    calm,
    falloff: f.falloff,
    prompts,
    answers,
    readout,
  };
}

/** Word-wrap to `cols`, hard-breaking anything longer than a whole row. */
export function wrapText(text: string, cols: number): string[] {
  const width = Math.max(1, cols);
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    let rest = word;
    while (rest.length > width) {
      if (line !== '') {
        out.push(line);
        line = '';
      }
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (line === '') line = rest;
    else if (line.length + 1 + rest.length <= width) line += ` ${rest}`;
    else {
      out.push(line);
      line = rest;
    }
  }
  if (line !== '' || out.length === 0) out.push(line);
  return out;
}

// ===========================================================================
// palette and pixels
// ===========================================================================

/*
 * palette.css, by hand: the DOM chrome does not import the renderer's palette,
 * and this is the chrome. The extra shades are its accents mixed toward bg0.
 */
type Rgb = readonly [number, number, number];
const BG: Rgb = [20, 23, 28];
/** Edge colours by weight: dim slate, up to the green of a well-worn path. */
const EDGE_RGB: readonly Rgb[] = [
  [28, 33, 40],
  [33, 39, 47],
  [38, 45, 54],
  [40, 57, 48],
  [44, 84, 55],
  [52, 116, 64],
];
/**
 * An edge something just went down: 1 an activation, 2 a reward, 3 a penalty,
 * then 4-6 the same cooling off.
 */
const HEAT_RGB: readonly Rgb[] = [
  [0, 0, 0],
  [44, 154, 60],
  [186, 134, 44],
  [160, 60, 54],
  [36, 104, 48],
  [112, 86, 40],
  [98, 48, 44],
];
const HEAT_FWD = 1;
const HEAT_REWARD = 2;
const HEAT_COOL = 3;
const NODE_RIM_RGB: Rgb = [58, 65, 77];
const NODE_FILL_RGB: Rgb = [26, 30, 37];
/** Brightness kept at each calm level: 0 is clear of the menu, 3 is behind it. */
const CALM_ALPHA = [1, 0.64, 0.42, 0.26] as const;

/** Text inks, one letter per character of a row. */
const INK: Readonly<Record<string, string>> = {
  P: '#4ade5a', // the human's prompt: terminal green
  A: '#d7dee8', // the agent's answer
  G: '#4ade5a', // a check mark
  L: '#6b7482', // readout labels
  V: '#9aa4b2', // readout values
  W: '#f2b33d', // amber: the reward, and the readout noticing things
};
const INK_RGB: Readonly<Record<string, Rgb>> = Object.fromEntries(
  Object.entries(INK).map(([k, hex]) => [
    k,
    [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)],
  ]),
);

/** Pulse, flare and token colours by ink: 0 forward (green), 1 reward, 2 penalty. */
const PULSE_HEAD = ['#4ade5a', '#f2b33d', '#e0524a'] as const;
const PULSE_TAIL = ['#2c9a3c', '#9c6d1c', '#7a2a26'] as const;
/** Flare colours [ink][level]; level 2 is the moment of firing. */
const FLARE_RIM = [
  ['#2c9a3c', '#4ade5a', '#8fe68a'],
  ['#9c6d1c', '#f2b33d', '#ffd98a'],
  ['#7a2a26', '#e0524a', '#ff9a92'],
] as const;
const FLARE_FILL = [
  ['#173d20', '#2c9a3c', '#4ade5a'],
  ['#3d2c10', '#9c6d1c', '#f2b33d'],
  ['#3a1816', '#7a2a26', '#e0524a'],
] as const;
const FLARE_CORE = ['#f2f6fb', '#fff3d6', '#ffe3e0'] as const;
const TOKEN_RIM = ['#4ade5a', '#f2b33d', '#e0524a'] as const;
const TOKEN_FILL = ['#1f6a2c', '#6b4a12', '#5a201d'] as const;
const TOKEN_CORE = ['#173d20', '#3d2c10', '#3a1816'] as const;
/** The tokenizer's view of a prompt: alternate chunks, alternate tints. */
const CHUNK_TINT = ['#1c3a25', '#1c2b3d'] as const;
const CARET = '#4ade5a';
const FLASH = '#f2f6fb';

const INK_FWD = 0;
const INK_REWARD = 1;
const INK_PENALTY = 2;

/** 👍, drawn rather than typed: an emoji font is not something to depend on. */
const THUMB_UP = [
  '....##...',
  '...##....',
  '...##....',
  '##.######',
  '##.#####.',
  '##.######',
  '##.#####.',
  '##..####.',
] as const;
const THUMB_W = 9;
const THUMB_H = 8;

/** 4x4 ordered dither: the light falloff pattern of every image in the game. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** `c` at `a` of its brightness over the background, as one ImageData pixel. */
function pack(c: Rgb, a: number): number {
  const r = Math.round(BG[0] + (c[0] - BG[0]) * a);
  const g = Math.round(BG[1] + (c[1] - BG[1]) * a);
  const b = Math.round(BG[2] + (c[2] - BG[2]) * a);
  return LITTLE_ENDIAN ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}
const BG_PX = pack(BG, 1);
const EDGE_PX = EDGE_RGB.flatMap((c) => CALM_ALPHA.map((a) => pack(c, a)));
const HEAT_PX = HEAT_RGB.flatMap((c) => CALM_ALPHA.map((a) => pack(c, a)));
const RIM_PX = CALM_ALPHA.map((a) => pack(NODE_RIM_RGB, a));
const FILL_PX = CALM_ALPHA.map((a) => pack(NODE_FILL_RGB, a));

/** The text rows' face: the chrome's pixel font, one glyph pixel per text pixel. */
const FONT = `8px "${PIXEL_FONT_FAMILY}", ui-monospace, monospace`;

// ===========================================================================
// the backdrop
// ===========================================================================

export type NetPhase = 'idle' | 'prompt' | 'tokenize' | 'forward' | 'answer' | 'verdict' | 'backprop' | 'rest';

export interface NetDebug {
  readonly mode: 'off' | 'live' | 'still';
  /** A frame is scheduled. */
  readonly running: boolean;
  /** Model time, ms: advances only while running. */
  readonly time: number;
  readonly phase: NetPhase;
  readonly episode: number;
  readonly prompt: string;
  readonly answer: string;
  /** 0 until the human has voted on the current answer. */
  readonly verdict: -1 | 0 | 1;
  readonly stats: NetStats;
  readonly layout: {
    readonly text: 'side' | 'bands';
    readonly orient: 'h' | 'v';
    readonly scale: number;
    readonly textScale: number;
    readonly w: number;
    readonly h: number;
    readonly layers: number;
    readonly nodes: number;
    readonly edges: number;
  } | null;
  /** In flight right now. */
  readonly pulses: number;
  readonly tokens: number;
  /** Frames drawn so far on each canvas. */
  readonly frames: number;
  readonly textFrames: number;
  /** The readout's lines, as drawn. */
  readonly readout: readonly string[];
  /** Mean weight of the edges on the "You're absolutely right!" route, 0..1. */
  readonly routeWeight: number;
}

export interface NetBackdrop {
  /** The node the host prepends. Never focusable, never hit-tested. */
  readonly el: HTMLElement;
  /** Start or resume. Cheap and idempotent, and re-reads reduced motion every call. */
  start(): void;
  /** Pause. Cheap and idempotent: the run resumes exactly where it stopped. */
  stop(): void;
  destroy(): void;
  /** A snapshot for tests and debugging. It allocates, and nothing calls it per frame. */
  debug(): NetDebug;
}

export interface NetBackdropOpts {
  /** The game's own setting. The OS `prefers-reduced-motion` is honoured on top of it. */
  reducedMotion?: () => boolean;
  /** Injectable clock, ms. Defaults to `performance.now`. */
  now?: () => number;
  /** Injectable randomness in [0, 1). Defaults to a seeded PRNG: every boot plays the same run. */
  random?: () => number;
  /** Seed for the default PRNG. */
  seed?: number;
}

/** Frame period: ~29 fps is the ceiling, and nothing here needs more. */
const FRAME_MS = 34;
/** Largest model-time step per frame, so a stalled tab resumes instead of fast-forwarding. */
const MAX_STEP_MS = 100;
const DEFAULT_SEED = 0x5c0f;

// Choreography, ms.
const FIRST_EPISODE_MS = 380;
const TYPE_MS = 34;
const TYPE_HOLD_MS = 280;
const TOKENIZE_MS = 320;
const TOKEN_STAGGER_MS = 55;
const TOKEN_FLIGHT_MS = 430;
const LAYER_MS = 250;
const OUT_STAGGER_MS = 85;
const OUT_FLIGHT_MS = 400;
const VERDICT_DELAY_MS = 420;
const VERDICT_HOLD_MS = 420;
const REWARD_FLIGHT_MS = 320;
const BACK_LAYER_MS = 200;
const COOL_MS = 520;
const REST_MS = 700;
const FLARE_MS = 460;
const SCROLL_MS = 180;
const CARET_MS = 530;
const POP_MS = 240;

// Budgets.
const MAX_PULSES = 96;
const MAX_TOKENS = 40;
const MAX_LOG_ROWS = 18;
const MAX_HISTORY = 8;
const PREFILL = 5;
const SURFACE_CACHE = 72;

/** Brightness of the newest rows, and how it fades with each older episode. */
const PROMPT_ALPHA = 0.74;
const ANSWER_ALPHA = 0.66;
const READOUT_ALPHA = 0.85;
const AGE_FADE = [1, 0.5, 0.36, 0.26, 0.18, 0.12, 0.07] as const;

/** Weight nudges. A reward moves an edge a little toward 1, a penalty toward 0. */
const REWARD_W = 0.16;
const PENALTY_W = 0.14;
const RELAX_W = 0.02;
const W_MIN = 0.03;

/** A pre-rendered line of text: one small canvas, drawn with drawImage. */
interface Surface {
  readonly text: string;
  readonly inks: string;
  canvas: HTMLCanvasElement | null;
  stale: boolean;
}

interface Chunk {
  /** Which row of the episode the chunk is on. */
  readonly row: number;
  readonly col: number;
  readonly len: number;
  /** When it leaves (a prompt chunk) or lands (an answer chunk). */
  t: number;
}

interface Row {
  readonly surf: Surface;
  readonly len: number;
  readonly episode: number;
  /** Which row of its episode this is, of how many. */
  readonly index: number;
  readonly count: number;
  /** Characters on screen before typing starts: the `> `. */
  readonly prefix: number;
  /** Typing starts here; -1 for a row that was never typed. */
  readonly typeAt: number;
  /** Assembled from landing tokens, or null when the row is drawn whole. */
  chunks: Chunk[] | null;
  /** The verdict icon at the end of the row, and when it popped in. */
  icon: -1 | 0 | 1;
  iconAt: number;
  /** Two cells kept free at the end for the icon. */
  readonly iconSlot: boolean;
}

interface Log {
  rows: Row[];
  /** Episode number of the newest rows, for the fade. */
  newest: number;
  scrollFrom: number;
  scrollAt: number;
}

interface Plan {
  readonly ep: NetEpisode;
  readonly t0: number;
  readonly tTokenize: number;
  /** The last prompt token leaves. */
  readonly tTokensOut: number;
  readonly tForward: number;
  readonly tAnswer: number;
  /** The last answer token lands. */
  readonly tAnswered: number;
  readonly tVerdict: number;
  readonly tBackprop: number;
  readonly tSettle: number;
  readonly tNext: number;
  readonly promptRows: Row[];
  readonly promptChunks: Chunk[];
  readonly answerRows: Row[];
  /** The forward pass's edges, and the gap each is in. */
  readonly path: number[];
  readonly pathGap: number[];
  /** When the activations are through each gap, and the reward wave back through it. */
  readonly gapLit: number[];
  readonly gapDone: number[];
  lit: number;
  rewarded: number;
  answered: boolean;
  voted: boolean;
  settled: boolean;
  cooled: boolean;
}

export function createNetBackdrop(opts: NetBackdropOpts = {}): NetBackdrop {
  const now = opts.now ?? ((): number => performance.now());
  const random = opts.random ?? makeRng(opts.seed ?? DEFAULT_SEED);
  const reducedSetting = opts.reducedMotion ?? ((): boolean => false);

  const root = el('div', { cls: 'tm-net', tid: TID.netBackdrop, attrs: { 'aria-hidden': 'true' } });
  // Also inline, not only in the stylesheet: if that ever fails to load, the
  // backdrop still must not be able to swallow a click on the Start button.
  root.style.pointerEvents = 'none';
  // The retired id rides along on the net's canvas. The frozen table still
  // lists it, so anything written against game 1's backdrop finds this one.
  const canvas = el('canvas', { cls: 'tm-net__canvas', parent: root });
  const textCanvas = el('canvas', { cls: 'tm-net__canvas', parent: root });
  const doc = root.ownerDocument;
  const ctx = context2d(canvas, false);
  const tctx = context2d(textCanvas, true);
  const layer = doc.createElement('canvas');
  const layerCtx = context2d(layer, false);
  let img: ImageData | null = null;
  let buf: Uint32Array | null = null;

  const session = createNetSession(random);
  const pulses = new Pulses(MAX_PULSES);
  const tokens = new Tokens(MAX_TOKENS);
  const prompts: Log = { rows: [], newest: 0, scrollFrom: 0, scrollAt: -1e9 };
  const answers: Log = { rows: [], newest: 0, scrollFrom: 0, scrollAt: -1e9 };
  const history: NetEpisode[] = [];
  const surfaces = new Map<string, Surface>();
  let readout: Row[] = [];
  let readoutText: string[] = [];
  let icons: HTMLCanvasElement[] = [];

  let layout: NetLayout | null = null;
  let signature = '';
  let base = new Float32Array(0);
  let weights = new Float32Array(0);
  let heat = new Uint8Array(0);
  let route = new Int16Array(0);
  let flareAt = new Float64Array(0);
  let flareInk = new Uint8Array(0);
  let flaresUntil = -1e9;
  let plan: Plan | null = null;

  let clock = 0;
  let lastNow = 0;
  let frames = 0;
  let textFrames = 0;
  /** Something was moving on the canvas last frame, so this one must redraw to clear it. */
  let netWasBusy = true;
  let textWasBusy = true;
  let netDirty = true;
  let textDirty = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mode: 'off' | 'live' | 'still' = 'off';
  let wanted = false;
  let attached = false;
  let destroyed = false;
  let layoutDirty = true;
  let fontSettled = false;
  let motionQuery: MediaQueryList | null = null;
  let observer: ResizeObserver | null = null;

  void installPixelFont(doc).then(() => {
    if (destroyed) return;
    fontSettled = true;
    for (const s of surfaces.values()) s.stale = true;
    // The menu's own text just changed face, and with it its size.
    layoutDirty = true;
    textDirty = true;
    if (mode === 'still' && wanted) paintStill();
  });

  // ---- reduced motion ------------------------------------------------------

  function osReduced(): boolean {
    if (motionQuery === null) {
      const view = doc.defaultView;
      motionQuery = typeof view?.matchMedia === 'function' ? view.matchMedia('(prefers-reduced-motion: reduce)') : null;
    }
    return motionQuery?.matches === true;
  }

  // ---- measuring -----------------------------------------------------------

  /** The host, the menu inside it and the viewport. Layout reads: never per frame. */
  function measure(): NetLayoutInput {
    const view = doc.defaultView;
    const vp = layoutViewport();
    const width = root.clientWidth || vp.vw || 1024;
    const height = root.clientHeight || vp.vh || 768;
    const dpr = view?.devicePixelRatio || 1;
    const { px, layout: chrome } = computeScale(vp.vw || width, vp.vh || height, dpr);
    const host = root.parentElement;
    let calm: NetRect | null = null;
    let safeTop = 0;
    if (host !== null) {
      const origin = root.getBoundingClientRect();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const child of Array.from(host.children)) {
        if (child === root || (child as HTMLElement).hidden) continue;
        const r = child.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) continue;
        x0 = Math.min(x0, r.left - origin.left);
        y0 = Math.min(y0, r.top - origin.top);
        x1 = Math.max(x1, r.right - origin.left);
        y1 = Math.max(y1, r.bottom - origin.top);
      }
      if (x1 > x0 && y1 > y0) calm = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const pad = view ? Number.parseFloat(view.getComputedStyle(host).paddingTop) : 0;
      safeTop = Number.isFinite(pad) ? pad : 0;
    }
    return { width, height, dpr, px, calm, safeTop, chrome };
  }

  /** Re-measure, and rebuild whatever the new geometry invalidates. */
  function relayout(): void {
    layoutDirty = false;
    const next = computeNetLayout(measure());
    const sig = layoutSignature(next);
    if (sig === signature && layout !== null) return;
    const sameNet =
      layout !== null && layout.edges === next.edges && layout.layerSize.join() === next.layerSize.join();
    signature = sig;
    layout = next;
    if (canvas.width !== next.w || canvas.height !== next.h || img === null) {
      canvas.width = next.w;
      canvas.height = next.h;
      layer.width = next.w;
      layer.height = next.h;
      img = layerCtx !== null ? layerCtx.createImageData(next.w, next.h) : null;
      buf = img !== null ? new Uint32Array(img.data.buffer) : null;
    }
    if (textCanvas.width !== next.tw || textCanvas.height !== next.th) {
      textCanvas.width = next.tw;
      textCanvas.height = next.th;
    }
    canvas.style.width = `${next.w * next.scale}px`;
    canvas.style.height = `${next.h * next.scale}px`;
    textCanvas.style.width = `${next.tw * next.textScale}px`;
    textCanvas.style.height = `${next.th * next.textScale}px`;
    if (!sameNet) resetNet(next);
    pulses.clear();
    tokens.clear();
    flareAt.fill(-1e9);
    heat.fill(0);
    rebuildLogs();
    // Whatever was in flight starts over in the new geometry.
    if (mode === 'live' && plan !== null) beginEpisode(clock, plan.ep);
    paintLayer(-1);
    textDirty = true;
  }

  function resetNet(l: NetLayout): void {
    base = new Float32Array(l.edges);
    weights = new Float32Array(l.edges);
    heat = new Uint8Array(l.edges);
    for (let e = 0; e < l.edges; e++) {
      // Mostly faint, a few already worn in.
      const r = random();
      base[e] = 0.06 + r * r * 0.5;
      weights[e] = base[e]!;
    }
    // The way "You're absolutely right!" goes through the net. Every 👍 it
    // earns lands on the same edges, which is how you can watch it wear in.
    route = new Int16Array(l.layers);
    for (let i = 0; i < l.layers; i++) {
      const size = l.layerSize[i]!;
      const lo = Math.floor(size / 4);
      route[i] = l.layerStart[i]! + lo + int(random, Math.max(1, size - 2 * lo));
    }
    flareAt = new Float64Array(l.nodes).fill(-1e9);
    flareInk = new Uint8Array(l.nodes);
  }

  function edgeId(a: number, b: number): number {
    const l = layout!;
    for (let g = 0; g < l.layers - 1; g++) {
      const s = l.layerStart[g + 1]!;
      if (b >= s && b < s + l.layerSize[g + 1]!) {
        return l.gapStart[g]! + (a - l.layerStart[g]!) * l.layerSize[g + 1]! + (b - s);
      }
    }
    return 0;
  }

  // ---- text ----------------------------------------------------------------

  function surface(text: string, inks: string): Surface {
    const key = `${inks}\u0000${text}`;
    let s = surfaces.get(key);
    if (s !== undefined) {
      // Most recently used goes to the back of the line.
      surfaces.delete(key);
      surfaces.set(key, s);
      return s;
    }
    s = { text, inks, canvas: null, stale: true };
    surfaces.set(key, s);
    if (surfaces.size > SURFACE_CACHE) {
      const oldest = surfaces.keys().next().value;
      if (oldest !== undefined) surfaces.delete(oldest);
    }
    return s;
  }

  /** Set a row once, glyph by glyph on the cell grid, then snap it to hard pixels. */
  function renderSurface(s: Surface): void {
    s.stale = false;
    const width = Math.max(1, s.text.length * CELL);
    if (s.canvas === null) s.canvas = doc.createElement('canvas');
    s.canvas.width = width;
    s.canvas.height = ROW_H;
    const c = context2d(s.canvas, true, true);
    if (c === null) return;
    c.font = FONT;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    for (let i = 0; i < s.text.length; i++) {
      const ch = s.text[i]!;
      if (ch !== ' ') c.fillText(ch, i * CELL, BASELINE);
    }
    // The face's squares already sit on whole pixels; this makes sure of it,
    // inks every character, and turns a fallback font into honest pixels.
    const data = c.getImageData(0, 0, width, ROW_H);
    const d = data.data;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3]! < 110) {
        d[p + 3] = 0;
        continue;
      }
      const rgb = INK_RGB[s.inks[Math.floor(((p >> 2) % width) / CELL)] ?? 'A'] ?? INK_RGB['A']!;
      d[p] = rgb[0];
      d[p + 1] = rgb[1];
      d[p + 2] = rgb[2];
      d[p + 3] = 255;
    }
    c.putImageData(data, 0, 0);
  }

  /** 👍 👎, and a white flash of each for the moment they pop in. */
  function iconSurfaces(): HTMLCanvasElement[] {
    if (icons.length > 0) return icons;
    const out: HTMLCanvasElement[] = [];
    for (const [down, color] of [
      [false, PULSE_HEAD[INK_REWARD]],
      [true, PULSE_HEAD[INK_PENALTY]],
      [false, FLASH],
      [true, FLASH],
    ] as const) {
      const cv = doc.createElement('canvas');
      cv.width = THUMB_W;
      cv.height = THUMB_H;
      const c = context2d(cv, true);
      if (c !== null) {
        c.fillStyle = color;
        for (let y = 0; y < THUMB_H; y++) {
          const row = THUMB_UP[down ? THUMB_H - 1 - y : y]!;
          for (let x = 0; x < THUMB_W; x++) if (row[x] === '#') c.fillRect(x, y, 1, 1);
        }
      }
      out.push(cv);
    }
    icons = out;
    return out;
  }

  function makeRow(text: string, inks: string, ep: number, index: number, count: number, extra: Partial<Row> = {}): Row {
    return {
      surf: surface(text, inks),
      len: text.length,
      episode: ep,
      index,
      count,
      prefix: 0,
      typeAt: -1,
      chunks: null,
      icon: 0,
      iconAt: -1e9,
      iconSlot: false,
      ...extra,
    };
  }

  /** The prompt's rows (typed from `typeFrom`, or already typed when negative) and its tokens. */
  function promptRowsFor(ep: NetEpisode, box: NetTextBox | null, typeFrom: number): { rows: Row[]; chunks: Chunk[] } {
    const lines = wrapText(ep.prompt, Math.max(4, (box?.cols ?? MAX_BAND_COLS) - 2));
    const rows: Row[] = [];
    const chunks: Chunk[] = [];
    let typed = 0;
    lines.forEach((line, i) => {
      const text = `${i === 0 ? '> ' : '  '}${line}`;
      rows.push(
        makeRow(text, 'P'.repeat(text.length), ep.n, i, lines.length, {
          prefix: 2,
          typeAt: typeFrom < 0 ? -1 : typeFrom + typed * TYPE_MS,
        }),
      );
      typed += line.length + 1;
      for (const c of wordsOf(text, 2)) chunks.push({ row: i, col: c.col, len: c.len, t: 0 });
    });
    return { rows, chunks };
  }

  function answerRowsFor(ep: NetEpisode, box: NetTextBox | null, verdict: -1 | 0 | 1): Row[] {
    const lines = wrapText(ep.answer, Math.max(4, (box?.cols ?? MAX_BAND_COLS) - 2));
    return lines.map((line, i) => {
      const last = i === lines.length - 1;
      return makeRow(line, answerInks(line), ep.n, i, lines.length, { icon: last ? verdict : 0, iconSlot: last });
    });
  }

  function pushLog(log: Log, rows: Row[], t: number, episode: number): void {
    for (const r of rows) log.rows.push(r);
    if (log.rows.length > MAX_LOG_ROWS) log.rows.splice(0, log.rows.length - MAX_LOG_ROWS);
    log.newest = episode;
    log.scrollFrom = rows.length * ROW + EPISODE_GAP;
    log.scrollAt = t;
    textDirty = true;
  }

  /** Both logs from the settled history, fully typed. */
  function rebuildLogs(): void {
    prompts.rows = [];
    answers.rows = [];
    const l = layout;
    if (l === null) return;
    for (const ep of history) {
      pushLog(prompts, promptRowsFor(ep, l.prompts, -1).rows, -1e9, ep.n);
      pushLog(answers, answerRowsFor(ep, l.answers, ep.verdict), -1e9, ep.n);
    }
    rebuildReadout(mode === 'still' ? STILL_STATS : session.stats);
  }

  function rebuildReadout(stats: Readonly<NetStats>): void {
    const box = layout?.readout ?? null;
    readout = [];
    readoutText = [];
    textDirty = true;
    if (box === null) return;
    for (const [text, inks] of readoutLines(stats, box.cols).slice(0, box.rows)) {
      readoutText.push(text);
      readout.push(makeRow(text, inks, 0, 0, 1));
    }
  }

  // ---- positions -------------------------------------------------------------

  /** Where row `r` of the newest episode of a log sits once the log has scrolled. Text px. */
  function rowY(box: NetTextBox, r: Row): number {
    return box.dir < 0 ? box.y - (r.count - 1 - r.index) * ROW : box.y + r.index * ROW;
  }

  function rowX(box: NetTextBox, r: Row): number {
    if (box.align === 'left') return box.x;
    return box.right - (r.len + (r.iconSlot ? 2 : 0)) * CELL + 1;
  }

  /** Characters of a prompt row on screen at `t`: the `> ` at once, then as typed. */
  function shownChars(r: Row, t: number): number {
    if (r.typeAt < 0) return r.len;
    if (t < r.typeAt) return r.index === 0 ? r.prefix : 0;
    return Math.min(r.len, r.prefix + Math.floor((t - r.typeAt) / TYPE_MS) + 1);
  }

  // ---- an episode, planned end to end --------------------------------------

  function planEpisode(ep: NetEpisode, t0: number): Plan {
    const l = layout!;
    const pb = l.prompts;
    const ab = l.answers;
    // Text pixels to net pixels.
    const r = l.textScale / l.scale;
    const { rows: promptRows, chunks: promptChunks } = promptRowsFor(ep, pb, t0);
    const lastRow = promptRows[promptRows.length - 1]!;
    const tTokenize = lastRow.typeAt + (lastRow.len - lastRow.prefix) * TYPE_MS + TYPE_HOLD_MS;

    // The prompt, tokenized: every chunk leaves as a token for an input node.
    const nIn = l.layerSize[0]!;
    const inputs: number[] = [];
    let tTokensOut = tTokenize + TOKENIZE_MS;
    promptChunks.forEach((c, i) => {
      c.t = tTokenize + TOKENIZE_MS + i * TOKEN_STAGGER_MS;
      tTokensOut = c.t;
      const node = l.layerStart[0]! + Math.min(nIn - 1, Math.floor(((i + 0.5) * nIn) / promptChunks.length));
      if (!inputs.includes(node)) inputs.push(node);
      const row = promptRows[c.row]!;
      const nx = l.nodeX[node]! - NODE_R;
      const ny = l.nodeY[node]! - NODE_R;
      // With no room for the text, the tokens simply arrive from off screen.
      const sx = pb !== null ? (rowX(pb, row) + (c.col + c.len / 2) * CELL) * r - TOKEN / 2 : l.orient === 'h' ? -TOKEN : nx;
      const sy = pb !== null ? (rowY(pb, row) + ROW_H / 2) * r - TOKEN / 2 : l.orient === 'h' ? ny : -TOKEN;
      tokens.spawn(sx, sy, nx, ny, c.t, TOKEN_FLIGHT_MS, INK_FWD, node, 7);
    });
    const tForward = tTokensOut + TOKEN_FLIGHT_MS + 40;

    // The forward pass: which nodes fire, and down which edges.
    const path: number[] = [];
    const pathGap: number[] = [];
    let prev = inputs;
    for (let g = 0; g < l.layers - 1; g++) {
      const size = l.layerSize[g + 1]!;
      const start = l.layerStart[g + 1]!;
      const act: number[] = [];
      if (ep.sycophantic) {
        act.push(route[g + 1]!);
        if (g + 1 < l.layers - 1 && random() < 0.35) act.push(start + int(random, size));
      } else {
        const want = g + 1 === l.layers - 1 ? 1 + (random() < 0.4 ? 1 : 0) : 2 + int(random, 2);
        while (act.length < Math.min(want, size)) {
          const n = start + int(random, size);
          if (!act.includes(n)) act.push(n);
        }
      }
      const add = (a: number, b: number): void => {
        const e = edgeId(a, b);
        if (path.includes(e)) return;
        path.push(e);
        pathGap.push(g);
      };
      for (const b of act) {
        add(prev[int(random, prev.length)]!, b);
        if (prev.length > 1 && random() < 0.5) add(prev[int(random, prev.length)]!, b);
      }
      // Nothing that fired is left hanging.
      for (const a of prev) {
        let feeds = false;
        for (let i = 0; i < path.length; i++) if (pathGap[i] === g && l.edgeA[path[i]!] === a) feeds = true;
        if (!feeds) add(a, act[int(random, act.length)]!);
      }
      prev = act;
    }
    const outputs = prev;
    const gapLit: number[] = [];
    for (let g = 0; g < l.layers - 1; g++) gapLit.push(tForward + (g + 1) * LAYER_MS + 50);
    path.forEach((e, i) => {
      pulses.spawn(l.edgeA[e]!, l.edgeB[e]!, tForward + pathGap[i]! * LAYER_MS + int(random, 50), LAYER_MS, INK_FWD, true);
    });
    const tAnswer = tForward + (l.layers - 1) * LAYER_MS + 60;

    // The answer: output tokens fly out to their places in the reply.
    const answerRows = answerRowsFor(ep, ab, 0);
    let tAnswered = tAnswer;
    let k = 0;
    answerRows.forEach((row, ri) => {
      row.chunks = [];
      for (const wd of wordsOf(row.surf.text, 0)) {
        const depart = tAnswer + 60 + k * OUT_STAGGER_MS;
        const land = depart + OUT_FLIGHT_MS;
        row.chunks.push({ row: ri, col: wd.col, len: wd.len, t: land });
        const from = outputs[k % outputs.length]!;
        const fx = l.nodeX[from]! - NODE_R;
        const fy = l.nodeY[from]! - NODE_R;
        const ex = ab !== null ? (rowX(ab, row) + wd.col * CELL) * r : l.orient === 'h' ? l.w + TOKEN : fx;
        const ey = ab !== null ? (rowY(ab, row) + ROW_H / 2) * r - TOKEN / 2 : l.orient === 'h' ? fy : l.h + TOKEN;
        tokens.spawn(fx, fy, ex, ey, depart, OUT_FLIGHT_MS, INK_FWD, -1, 6);
        tAnswered = land;
        k += 1;
      }
    });
    const tVerdict = tAnswered + VERDICT_DELAY_MS;
    const tBackprop = tVerdict + VERDICT_HOLD_MS;

    // The reward: from the thumb back into the output layer, then right to
    // left down the very edges that produced the answer.
    const ink = ep.verdict > 0 ? INK_REWARD : INK_PENALTY;
    const last = answerRows[answerRows.length - 1];
    for (const o of outputs) {
      const ox = l.nodeX[o]! - NODE_R;
      const oy = l.nodeY[o]! - NODE_R;
      const iconX = ab !== null && last !== undefined ? (rowX(ab, last) + (last.len + 1) * CELL) * r : -1;
      const sx = iconX >= 0 ? iconX : ox + (l.orient === 'h' ? 24 : 0);
      const sy = iconX >= 0 && ab !== null && last !== undefined ? (rowY(ab, last) + 1) * r : oy + (l.orient === 'h' ? 0 : 24);
      tokens.spawn(sx, sy, ox, oy, tBackprop, REWARD_FLIGHT_MS, ink, o, 5);
    }
    const back = tBackprop + REWARD_FLIGHT_MS;
    const gapDone: number[] = [];
    for (let g = 0; g < l.layers - 1; g++) gapDone.push(back + (l.layers - 1 - g) * BACK_LAYER_MS);
    path.forEach((e, i) => {
      pulses.spawn(l.edgeB[e]!, l.edgeA[e]!, gapDone[pathGap[i]!]! - BACK_LAYER_MS, BACK_LAYER_MS, ink, true);
    });
    const tSettle = gapDone[0]! + 80;
    return {
      ep,
      t0,
      tTokenize,
      tTokensOut,
      tForward,
      tAnswer,
      tAnswered,
      tVerdict,
      tBackprop,
      tSettle,
      tNext: tSettle + REST_MS,
      promptRows,
      promptChunks,
      answerRows,
      path,
      pathGap,
      gapLit,
      gapDone,
      lit: 0,
      rewarded: 0,
      answered: false,
      voted: false,
      settled: false,
      cooled: false,
    };
  }

  function beginEpisode(t0: number, ep: NetEpisode = session.next()): void {
    plan = planEpisode(ep, t0);
    pushLog(prompts, plan.promptRows, t0, ep.n);
  }

  /** Run everything due by `t`: landings, then the plan's events, in order. */
  function advance(t: number): void {
    const l = layout;
    if (l === null) return;
    pulses.arrive(t, flare);
    tokens.arrive(t, flare);
    while (plan !== null) {
      const p = plan;
      // The activations are through a gap: the edges they took stay lit.
      while (p.lit < l.layers - 1 && t >= p.gapLit[p.lit]!) {
        heatGap(p, p.lit, HEAT_FWD);
        p.lit += 1;
      }
      if (!p.answered && t >= p.tAnswer) {
        p.answered = true;
        pushLog(answers, p.answerRows, p.tAnswer, p.ep.n);
      }
      if (!p.voted && t >= p.tVerdict) {
        p.voted = true;
        const last = p.answerRows[p.answerRows.length - 1];
        if (last !== undefined) {
          last.icon = p.ep.verdict;
          last.iconAt = p.tVerdict;
        }
        textDirty = true;
      }
      // The reward wave is through a gap: its edges move, a little, and glow.
      while (p.rewarded < l.layers - 1) {
        const g = l.layers - 2 - p.rewarded;
        if (t < p.gapDone[g]!) break;
        p.rewarded += 1;
        for (let i = 0; i < p.path.length; i++) {
          if (p.pathGap[i] !== g) continue;
          const e = p.path[i]!;
          weights[e] = nudge(weights[e]!, p.ep.verdict);
        }
        heatGap(p, g, p.ep.verdict > 0 ? HEAT_REWARD : HEAT_REWARD + 1);
      }
      if (!p.settled && t >= p.tSettle) {
        p.settled = true;
        settle(p);
      }
      if (!p.cooled && t >= p.tSettle + COOL_MS) {
        p.cooled = true;
        heat.fill(0);
        paintLayer(-1);
      }
      if (t < p.tNext) break;
      beginEpisode(p.tNext);
    }
  }

  function heatGap(p: Plan, g: number, level: number): void {
    for (let i = 0; i < p.path.length; i++) if (p.pathGap[i] === g) heat[p.path[i]!] = level;
    paintLayer(g);
  }

  function settle(p: Plan): void {
    const before = session.stats.rollbacks;
    session.settle(p.ep);
    // Everything relaxes a touch toward where it started; on a rollback, a lot.
    const k = session.stats.rollbacks !== before ? 0.8 : RELAX_W;
    for (let e = 0; e < weights.length; e++) weights[e] = weights[e]! + (base[e]! - weights[e]!) * k;
    // The glow cools off before it goes.
    for (let e = 0; e < heat.length; e++) if (heat[e]! > 0 && heat[e]! <= HEAT_COOL) heat[e] = heat[e]! + HEAT_COOL;
    for (const r of p.answerRows) r.chunks = null;
    history.push(p.ep);
    if (history.length > MAX_HISTORY) history.shift();
    rebuildReadout(session.stats);
    paintLayer(-1);
  }

  function flare(node: number, at: number, ink: number): void {
    if (node < 0 || node >= flareAt.length) return;
    flareAt[node] = at;
    flareInk[node] = ink;
    if (at + FLARE_MS > flaresUntil) flaresUntil = at + FLARE_MS;
  }

  function phaseAt(t: number): NetPhase {
    const p = plan;
    if (mode !== 'live') return 'idle';
    if (p === null || t < p.t0) return 'rest';
    if (t < p.tTokenize) return 'prompt';
    if (t < p.tForward) return 'tokenize';
    if (t < p.tAnswer) return 'forward';
    if (t < p.tVerdict) return 'answer';
    if (t < p.tBackprop) return 'verdict';
    if (t < p.tSettle) return 'backprop';
    return 'rest';
  }

  /** The text is animating: typing, the tokenizer, a scroll, tokens landing, a thumb popping. */
  function textBusy(t: number): boolean {
    if (t - prompts.scrollAt < SCROLL_MS || t - answers.scrollAt < SCROLL_MS) return true;
    const p = plan;
    if (p === null) return false;
    return (
      (t >= p.t0 && t <= p.tTokensOut) ||
      (t >= p.tAnswer && t <= p.tAnswered) ||
      (t >= p.tVerdict && t <= p.tVerdict + POP_MS)
    );
  }

  // ---- the static layer: edges and idle nodes -------------------------------

  /** Calm level of a pixel, 0 (clear of the menu) to 3 (behind it), dithered. */
  function calmAt(x: number, y: number, dither: number): number {
    const l = layout!;
    const c = l.calm;
    const dx = x < c.x ? c.x - x : x >= c.x + c.w ? x - (c.x + c.w - 1) : 0;
    const dy = y < c.y ? c.y - y : y >= c.y + c.h ? y - (c.y + c.h - 1) : 0;
    const d = dx > dy ? dx + 0.5 * dy : dy + 0.5 * dx;
    if (d >= l.falloff) return 0;
    const v = Math.floor(3 - (3 * d) / l.falloff + dither);
    return v > 3 ? 3 : v < 0 ? 0 : v;
  }

  /** Repaint one gap between two layers (its edges only), or everything for `gap < 0`. */
  function paintLayer(gap: number): void {
    netDirty = true;
    const l = layout;
    const b = buf;
    if (l === null || b === null || img === null || layerCtx === null) return;
    const W = l.w;
    let x0 = 0;
    let y0 = 0;
    let x1 = W;
    let y1 = l.h;
    if (gap >= 0) {
      const lo = l.layerPos[gap]! + NODE_R + 1;
      const hi = l.layerPos[gap + 1]! - NODE_R;
      if (l.orient === 'h') {
        x0 = clamp(lo, 0, W);
        x1 = clamp(hi, 0, W);
      } else {
        y0 = clamp(lo, 0, l.h);
        y1 = clamp(hi, 0, l.h);
      }
    }
    for (let y = y0; y < y1; y++) b.fill(BG_PX, y * W + x0, y * W + x1);
    const e0 = gap >= 0 ? l.gapStart[gap]! : 0;
    const e1 = gap >= 0 ? l.gapStart[gap + 1]! : l.edges;
    // Faint edges first, then the worn-in ones, then whatever is glowing.
    for (let pass = 0; pass < 3; pass++) {
      for (let e = e0; e < e1; e++) {
        const hot = heat[e]!;
        const level = Math.min(5, Math.floor(weights[e]! * 6));
        const want = hot > 0 ? 2 : level >= 3 ? 1 : 0;
        if (want !== pass) continue;
        if (hot > 0) drawEdge(b, l, e, HEAT_PX, hot * 4, 1);
        else drawEdge(b, l, e, EDGE_PX, level * 4, level === 0 ? 3 : level === 1 ? 2 : 1);
      }
    }
    if (gap < 0) for (let i = 0; i < l.nodes; i++) drawNode(b, l, i);
    layerCtx.putImageData(img, 0, 0, x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  }

  /** One edge, rim to rim, Bresenham. The faintest are dotted: weight as density too. */
  function drawEdge(b: Uint32Array, l: NetLayout, e: number, colors: readonly number[], row: number, every: number): void {
    const a = l.edgeA[e]!;
    const z = l.edgeB[e]!;
    const hz = l.orient === 'h';
    let x = l.nodeX[a]! + (hz ? NODE_R + 1 : 0);
    let y = l.nodeY[a]! + (hz ? 0 : NODE_R + 1);
    const tx = l.nodeX[z]! - (hz ? NODE_R + 1 : 0);
    const ty = l.nodeY[z]! - (hz ? 0 : NODE_R + 1);
    const W = l.w;
    const dx = Math.abs(tx - x);
    const dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; ; i++) {
      if (i % every === 0 && x >= 0 && y >= 0 && x < W && y < l.h) {
        b[y * W + x] = colors[row + calmAt(x, y, BAYER[((y & 3) << 2) | (x & 3)]!)]!;
      }
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** An idle node: a 7x7 pixel disc, rim and fill. */
  function drawNode(b: Uint32Array, l: NetLayout, i: number): void {
    const cx = l.nodeX[i]!;
    const cy = l.nodeY[i]!;
    const level = calmAt(cx, cy, 0.5);
    for (let v = -NODE_R; v <= NODE_R; v++) {
      for (let u = -NODE_R; u <= NODE_R; u++) {
        const au = Math.abs(u);
        const av = Math.abs(v);
        if (au + av > NODE_R + 1) continue;
        const x = cx + u;
        const y = cy + v;
        if (x < 0 || y < 0 || x >= l.w || y >= l.h) continue;
        const inside = au + av <= NODE_R && au < NODE_R && av < NODE_R;
        b[y * l.w + x] = inside ? FILL_PX[level]! : RIM_PX[level]!;
      }
    }
  }

  // ---- drawing, per frame ----------------------------------------------------

  function alphaAt(x: number, y: number): number {
    return CALM_ALPHA[calmAt(x, y, 0.5)]!;
  }

  /** Redraw whichever canvas has something changing on it; leave the other alone. */
  function paint(t: number, force: boolean): void {
    const moving = pulses.active(t) > 0 || tokens.active(t) > 0 || t < flaresUntil;
    if (force || netDirty || moving || netWasBusy) drawNet(t);
    netWasBusy = moving;
    const typing = textBusy(t);
    if (force || textDirty || typing || textWasBusy) drawText(t);
    textWasBusy = typing;
  }

  function drawNet(t: number): void {
    netDirty = false;
    const c = ctx;
    const l = layout;
    if (c === null || l === null) return;
    c.globalAlpha = 1;
    c.drawImage(layer, 0, 0);
    drawPulses(c, l, t);
    drawFlares(c, l, t);
    drawTokens(c, t);
    c.globalAlpha = 1;
    frames += 1;
  }

  function drawText(t: number): void {
    textDirty = false;
    const c = tctx;
    const l = layout;
    if (c === null || l === null) return;
    c.globalAlpha = 1;
    c.clearRect(0, 0, l.tw, l.th);
    if (fontSettled) {
      drawChunkTints(c, t);
      drawLog(c, prompts, l.prompts, PROMPT_ALPHA, t);
      drawLog(c, answers, l.answers, ANSWER_ALPHA, t);
      drawReadout(c, l);
      drawCaret(c, t);
    }
    c.globalAlpha = 1;
    textFrames += 1;
  }

  function scrollOf(log: Log, box: NetTextBox, t: number): number {
    const u = (t - log.scrollAt) / SCROLL_MS;
    if (u >= 1) return 0;
    const off = Math.round(log.scrollFrom * (1 - u) * (1 - u));
    return box.dir < 0 ? off : -off;
  }

  /** The tokenizer at work: each chunk tinted until its token leaves. */
  function drawChunkTints(c: CanvasRenderingContext2D, t: number): void {
    const p = plan;
    const box = layout?.prompts ?? null;
    if (p === null || box === null || t < p.tTokenize) return;
    const shift = scrollOf(prompts, box, t);
    c.globalAlpha = PROMPT_ALPHA;
    for (let i = 0; i < p.promptChunks.length; i++) {
      const ch = p.promptChunks[i]!;
      if (t >= ch.t) continue;
      const row = p.promptRows[ch.row]!;
      c.fillStyle = CHUNK_TINT[i & 1]!;
      c.fillRect(rowX(box, row) + ch.col * CELL - 1, rowY(box, row) + shift, ch.len * CELL + 1, ROW_H);
    }
  }

  function drawLog(c: CanvasRenderingContext2D, log: Log, box: NetTextBox | null, alpha: number, t: number): void {
    if (box === null) return;
    const shift = scrollOf(log, box, t);
    const rows = log.rows;
    // From the newest episode outwards, one episode at a time.
    let end = rows.length;
    let offset = 0;
    let shown = 0;
    while (end > 0 && shown < box.rows) {
      const newest = rows[end - 1]!;
      const count = Math.min(newest.count, end);
      const age = Math.min(AGE_FADE.length - 1, Math.max(0, log.newest - newest.episode));
      const a = alpha * AGE_FADE[age]!;
      for (let i = end - count; i < end; i++) {
        const r = rows[i]!;
        const dy = box.dir < 0 ? -(offset + (r.count - 1 - r.index) * ROW) : offset + r.index * ROW;
        drawRow(c, r, rowX(box, r), box.y + dy + shift, a, t);
      }
      shown += count;
      offset += newest.count * ROW + EPISODE_GAP;
      end -= count;
    }
  }

  function drawRow(c: CanvasRenderingContext2D, r: Row, x: number, y: number, alpha: number, t: number): void {
    const s = r.surf;
    if (s.stale) renderSurface(s);
    const src = s.canvas;
    if (src === null || y < -ROW_H || y > (layout?.th ?? 0)) return;
    c.globalAlpha = alpha;
    const shown = shownChars(r, t);
    if (shown < r.len) {
      if (shown > 0) c.drawImage(src, 0, 0, shown * CELL, ROW_H, x, y, shown * CELL, ROW_H);
    } else if (r.chunks !== null) {
      for (let i = 0; i < r.chunks.length; i++) {
        const ch = r.chunks[i]!;
        if (t < ch.t) continue;
        const sx = ch.col * CELL;
        const w = ch.len * CELL;
        c.drawImage(src, sx, 0, w, ROW_H, x + sx, y, w, ROW_H);
      }
    } else {
      c.drawImage(src, x, y);
    }
    if (r.icon !== 0) {
      const set = iconSurfaces();
      const age = t - r.iconAt;
      const which = (r.icon > 0 ? 0 : 1) + (age >= 0 && age < POP_MS / 3 ? 2 : 0);
      const icon = set[which];
      if (icon !== undefined) c.drawImage(icon, x + (r.len + 1) * CELL, y + (age >= 0 && age < POP_MS ? 0 : 1));
    }
  }

  function drawReadout(c: CanvasRenderingContext2D, l: NetLayout): void {
    const box = l.readout;
    if (box === null) return;
    const n = readout.length;
    c.globalAlpha = READOUT_ALPHA;
    for (let i = 0; i < n; i++) {
      const s = readout[i]!.surf;
      if (s.stale) renderSurface(s);
      if (s.canvas !== null) c.drawImage(s.canvas, box.x, box.y - (n - 1 - i) * ROW);
    }
  }

  function drawPulses(c: CanvasRenderingContext2D, l: NetLayout, t: number): void {
    const P = pulses;
    const hz = l.orient === 'h';
    for (let i = 0; i < P.cap; i++) {
      if (P.live[i] === 0) continue;
      const t0 = P.t0[i]!;
      if (t < t0) continue;
      const u = (t - t0) / P.dur[i]!;
      if (u >= 1) continue;
      const a = P.from[i]!;
      const b = P.to[i]!;
      let ax = l.nodeX[a]!;
      let ay = l.nodeY[a]!;
      let bx = l.nodeX[b]!;
      let by = l.nodeY[b]!;
      // Rim to rim, whichever way the pulse is going.
      if (hz) {
        const s = bx > ax ? NODE_R + 1 : -(NODE_R + 1);
        ax += s;
        bx -= s;
      } else {
        const s = by > ay ? NODE_R + 1 : -(NODE_R + 1);
        ay += s;
        by -= s;
      }
      const ink = P.ink[i]!;
      const x = Math.round(ax + (bx - ax) * u);
      const y = Math.round(ay + (by - ay) * u);
      const a0 = alphaAt(x, y);
      // A short comet tail, fading.
      c.fillStyle = PULSE_TAIL[ink]!;
      for (let k = 1; k <= 4; k++) {
        const v = u - k * 0.05;
        if (v <= 0) break;
        c.globalAlpha = k <= 2 ? a0 : a0 * 0.5;
        c.fillRect(Math.round(ax + (bx - ax) * v), Math.round(ay + (by - ay) * v), 1, 1);
      }
      c.globalAlpha = a0;
      c.fillStyle = PULSE_HEAD[ink]!;
      c.fillRect(x - 1, y, 3, 1);
      c.fillRect(x, y - 1, 1, 3);
    }
  }

  function drawFlares(c: CanvasRenderingContext2D, l: NetLayout, t: number): void {
    if (t >= flaresUntil) return;
    for (let i = 0; i < l.nodes; i++) {
      const age = t - flareAt[i]!;
      if (age < 0 || age >= FLARE_MS) continue;
      const level = age < FLARE_MS / 3 ? 2 : age < (2 * FLARE_MS) / 3 ? 1 : 0;
      const ink = flareInk[i]!;
      const x = l.nodeX[i]! - NODE_R;
      const y = l.nodeY[i]! - NODE_R;
      c.globalAlpha = alphaAt(x + NODE_R, y + NODE_R);
      c.fillStyle = FLARE_RIM[ink]![level]!;
      c.fillRect(x + 2, y, 3, 7);
      c.fillRect(x + 1, y + 1, 5, 5);
      c.fillRect(x, y + 2, 7, 3);
      c.fillStyle = FLARE_FILL[ink]![level]!;
      c.fillRect(x + 2, y + 1, 3, 5);
      c.fillRect(x + 1, y + 2, 5, 3);
      if (level === 2) {
        c.fillStyle = FLARE_CORE[ink]!;
        c.fillRect(x + 3, y + 2, 1, 3);
        c.fillRect(x + 2, y + 3, 3, 1);
      }
    }
  }

  function drawTokens(c: CanvasRenderingContext2D, t: number): void {
    const T = tokens;
    for (let i = 0; i < T.cap; i++) {
      if (T.live[i] === 0) continue;
      const t0 = T.t0[i]!;
      if (t < t0) continue;
      const u = (t - t0) / T.dur[i]!;
      if (u >= 1) continue;
      const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
      const sx = T.sx[i]!;
      const sy = T.sy[i]!;
      const x = Math.round(sx + (T.ex[i]! - sx) * e);
      const y = Math.round(sy + (T.ey[i]! - sy) * e - Math.sin(Math.PI * u) * T.arc[i]!);
      const ink = T.ink[i]!;
      c.globalAlpha = Math.max(0.55, alphaAt(x + 3, y + 3));
      c.fillStyle = TOKEN_RIM[ink]!;
      c.fillRect(x, y, TOKEN, TOKEN);
      c.fillStyle = TOKEN_FILL[ink]!;
      c.fillRect(x + 1, y + 1, TOKEN - 2, TOKEN - 2);
      c.fillStyle = TOKEN_RIM[ink]!;
      c.fillRect(x + 2, y + 2, TOKEN - 4, TOKEN - 4);
      c.fillStyle = TOKEN_CORE[ink]!;
      c.fillRect(x + 3, y + 3, 1, 1);
    }
  }

  function drawCaret(c: CanvasRenderingContext2D, t: number): void {
    const p = plan;
    const box = layout?.prompts ?? null;
    if (p === null || box === null || mode !== 'live' || t < p.t0 || t >= p.tTokenize) return;
    // The row being typed; once it is all in, the last one, blinking over enter.
    let row = p.promptRows[p.promptRows.length - 1]!;
    for (const r of p.promptRows) {
      if (shownChars(r, t) < r.len) {
        row = r;
        break;
      }
    }
    const shown = shownChars(row, t);
    if (shown >= row.len && Math.floor((t - p.t0) / CARET_MS) % 2 === 1) return;
    c.globalAlpha = PROMPT_ALPHA;
    c.fillStyle = CARET;
    c.fillRect(rowX(box, row) + shown * CELL, rowY(box, row) + scrollOf(prompts, box, t) + 1, CELL - 1, 7);
  }

  // ---- lifecycle -------------------------------------------------------------

  function frame(): void {
    timer = null;
    if (destroyed || !wanted || mode !== 'live' || doc.hidden) return;
    const tNow = now();
    let dt = tNow - lastNow;
    lastNow = tNow;
    if (!(dt > 0)) dt = 0;
    else if (dt > MAX_STEP_MS) dt = MAX_STEP_MS;
    clock += dt;
    if (layoutDirty) relayout();
    advance(clock);
    paint(clock, false);
    timer = setTimeout(frame, FRAME_MS);
  }

  function resume(): void {
    if (timer !== null || destroyed || !wanted || mode !== 'live' || doc.hidden) return;
    lastNow = now();
    timer = setTimeout(frame, FRAME_MS);
  }

  function halt(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /** A run already underway: a few settled episodes on screen, the next about to start. */
  function beginLive(): void {
    if (layout === null) return;
    if (history.length === 0) {
      for (let i = 0; i < PREFILL; i++) {
        const ep = session.next();
        // Trained on too, down made-up paths, so the weights start worn in.
        for (let j = 0; j < 6; j++) {
          const e = int(random, weights.length);
          weights[e] = nudge(weights[e]!, ep.verdict);
        }
        session.settle(ep);
        history.push(ep);
      }
    }
    pulses.clear();
    tokens.clear();
    flareAt.fill(-1e9);
    heat.fill(0);
    plan = null;
    rebuildLogs();
    beginEpisode(clock + FIRST_EPISODE_MS);
    paintLayer(-1);
    paint(clock, true);
  }

  /** The reduced-motion frame: one prompt, one answer, and the net mid-thought. */
  function paintStill(): void {
    if (layoutDirty) relayout();
    const l = layout;
    if (l === null) return;
    pulses.clear();
    tokens.clear();
    flareAt.fill(-1e9);
    heat.fill(0);
    // The route has been rewarded for a while: it is the most worn-in thing there.
    for (let e = 0; e < l.edges; e++) weights[e] = base[e]!;
    for (let g = 0; g < l.layers - 1; g++) weights[edgeId(route[g]!, route[g + 1]!)] = 0.9;
    const p = planEpisode(STILL_EPISODE, 0);
    prompts.rows = [];
    answers.rows = [];
    pushLog(prompts, p.promptRows, -1e9, STILL_EPISODE.n);
    pushLog(answers, answerRowsFor(STILL_EPISODE, l.answers, 1), -1e9, STILL_EPISODE.n);
    // Frozen a beat before the output layer fires, the whole route lit behind
    // the thought: it knows what it is going to say.
    const lastGap = l.layers - 2;
    const t = p.tForward + lastGap * LAYER_MS + LAYER_MS * 0.6;
    tokens.clear();
    pulses.arrive(t, flare);
    for (let i = 0; i < p.path.length; i++) if (p.pathGap[i]! < lastGap) heat[p.path[i]!] = HEAT_FWD;
    for (let i = 0; i < l.layerSize[0]!; i++) flare(l.layerStart[0]! + i, t - FLARE_MS * 0.6, INK_FWD);
    plan = null;
    rebuildReadout(STILL_STATS);
    paintLayer(-1);
    paint(t, true);
  }

  function onVisibility(): void {
    if (doc.hidden) halt();
    else resume();
  }

  function onMotionPreference(): void {
    if (wanted) start();
  }

  function onResize(): void {
    layoutDirty = true;
    if (mode === 'still' && wanted) paintStill();
  }

  function attach(): void {
    if (attached) return;
    attached = true;
    doc.addEventListener('visibilitychange', onVisibility);
    osReduced();
    motionQuery?.addEventListener?.('change', onMotionPreference);
    // The host's size, and the menu's: a resize, a rotation, the pixel font
    // landing, the stats row appearing for a returning player.
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(onResize);
      observer.observe(root);
      const host = root.parentElement;
      if (host !== null) for (const child of Array.from(host.children)) if (child !== root) observer.observe(child);
    } else {
      doc.defaultView?.addEventListener('resize', onResize);
    }
  }

  function detach(): void {
    if (!attached) return;
    attached = false;
    doc.removeEventListener('visibilitychange', onVisibility);
    motionQuery?.removeEventListener?.('change', onMotionPreference);
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    } else {
      doc.defaultView?.removeEventListener('resize', onResize);
    }
  }

  function start(): void {
    if (destroyed) return;
    wanted = true;
    attach();
    if (layoutDirty || layout === null) relayout();
    if (reducedSetting() || osReduced()) {
      halt();
      mode = 'still';
      paintStill();
      return;
    }
    if (mode !== 'live') {
      mode = 'live';
      beginLive();
    } else {
      paint(clock, true);
    }
    resume();
  }

  function stop(): void {
    wanted = false;
    halt();
    detach();
  }

  function destroy(): void {
    if (destroyed) return;
    stop();
    destroyed = true;
    mode = 'off';
    plan = null;
    surfaces.clear();
    icons = [];
    // Hand the backing stores back now rather than whenever the GC gets to them.
    for (const c of [canvas, textCanvas, layer]) {
      c.width = 0;
      c.height = 0;
    }
    img = null;
    buf = null;
    root.remove();
  }

  function debug(): NetDebug {
    const l = layout;
    const p = plan;
    let routeWeight = 0;
    if (l !== null && route.length === l.layers) {
      for (let g = 0; g < l.layers - 1; g++) routeWeight += weights[edgeId(route[g]!, route[g + 1]!)] ?? 0;
      routeWeight /= l.layers - 1;
    }
    return {
      mode,
      running: timer !== null,
      time: clock,
      phase: phaseAt(clock),
      episode: p?.ep.n ?? 0,
      prompt: p?.ep.prompt ?? '',
      answer: p?.ep.answer ?? '',
      verdict: p !== null && p.voted ? p.ep.verdict : 0,
      stats: { ...(mode === 'still' ? STILL_STATS : session.stats) },
      layout:
        l === null
          ? null
          : {
              text: l.text,
              orient: l.orient,
              scale: l.scale,
              textScale: l.textScale,
              w: l.w,
              h: l.h,
              layers: l.layers,
              nodes: l.nodes,
              edges: l.edges,
            },
      pulses: pulses.active(clock),
      tokens: tokens.active(clock),
      frames,
      textFrames,
      readout: readoutText.slice(),
      routeWeight,
    };
  }

  return { el: root, start, stop, destroy, debug };
}

// ===========================================================================
// pools
// ===========================================================================

/** Activations in flight along edges. Fixed capacity: past it, a pulse is simply not drawn. */
class Pulses {
  readonly from: Int16Array;
  readonly to: Int16Array;
  readonly t0: Float64Array;
  readonly dur: Float32Array;
  readonly ink: Uint8Array;
  readonly flare: Uint8Array;
  readonly live: Uint8Array;

  constructor(readonly cap: number) {
    this.from = new Int16Array(cap);
    this.to = new Int16Array(cap);
    this.t0 = new Float64Array(cap);
    this.dur = new Float32Array(cap);
    this.ink = new Uint8Array(cap);
    this.flare = new Uint8Array(cap);
    this.live = new Uint8Array(cap);
  }

  spawn(from: number, to: number, t0: number, dur: number, ink: number, flare: boolean): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] !== 0) continue;
      this.from[i] = from;
      this.to[i] = to;
      this.t0[i] = t0;
      this.dur[i] = dur;
      this.ink[i] = ink;
      this.flare[i] = flare ? 1 : 0;
      this.live[i] = 1;
      return;
    }
  }

  /** Retire everything that has landed by `t`, flaring its target at the moment it landed. */
  arrive(t: number, flare: (node: number, at: number, ink: number) => void): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] === 0) continue;
      const end = this.t0[i]! + this.dur[i]!;
      if (t < end) continue;
      this.live[i] = 0;
      if (this.flare[i] !== 0) flare(this.to[i]!, end, this.ink[i]!);
    }
  }

  /** In flight at `t`: started, not yet landed. */
  active(t: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] !== 0 && t >= this.t0[i]! && t < this.t0[i]! + this.dur[i]!) n += 1;
    }
    return n;
  }

  clear(): void {
    this.live.fill(0);
  }
}

/** Tokens in flight: prompt chunks into the input layer, the answer out, the reward back. */
class Tokens {
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly ex: Float32Array;
  readonly ey: Float32Array;
  readonly t0: Float64Array;
  readonly dur: Float32Array;
  readonly arc: Float32Array;
  readonly ink: Uint8Array;
  readonly node: Int16Array;
  readonly live: Uint8Array;

  constructor(readonly cap: number) {
    this.sx = new Float32Array(cap);
    this.sy = new Float32Array(cap);
    this.ex = new Float32Array(cap);
    this.ey = new Float32Array(cap);
    this.t0 = new Float64Array(cap);
    this.dur = new Float32Array(cap);
    this.arc = new Float32Array(cap);
    this.ink = new Uint8Array(cap);
    this.node = new Int16Array(cap);
    this.live = new Uint8Array(cap);
  }

  spawn(sx: number, sy: number, ex: number, ey: number, t0: number, dur: number, ink: number, node: number, arc: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] !== 0) continue;
      this.sx[i] = sx;
      this.sy[i] = sy;
      this.ex[i] = ex;
      this.ey[i] = ey;
      this.t0[i] = t0;
      this.dur[i] = dur;
      this.arc[i] = arc;
      this.ink[i] = ink;
      this.node[i] = node;
      this.live[i] = 1;
      return;
    }
  }

  arrive(t: number, flare: (node: number, at: number, ink: number) => void): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] === 0) continue;
      const end = this.t0[i]! + this.dur[i]!;
      if (t < end) continue;
      this.live[i] = 0;
      if (this.node[i]! >= 0) flare(this.node[i]!, end, this.ink[i]!);
    }
  }

  active(t: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.live[i] !== 0 && t >= this.t0[i]! && t < this.t0[i]! + this.dur[i]!) n += 1;
    }
    return n;
  }

  clear(): void {
    this.live.fill(0);
  }
}

// ===========================================================================
// helpers
// ===========================================================================

function context2d(c: HTMLCanvasElement, alpha: boolean, readback = false): CanvasRenderingContext2D | null {
  try {
    return c.getContext('2d', { alpha, willReadFrequently: readback });
  } catch {
    return null;
  }
}

/** A reward pulls an edge a little toward 1, a penalty a little toward 0. */
function nudge(w: number, verdict: number): number {
  return verdict > 0 ? w + REWARD_W * (1 - w) : Math.max(W_MIN, w - PENALTY_W * w);
}

/** Runs of non-space characters from column `from` on: the tokenizer, roughly. */
function wordsOf(text: string, from: number): Array<{ col: number; len: number }> {
  const out: Array<{ col: number; len: number }> = [];
  let start = -1;
  for (let i = from; i <= text.length; i++) {
    const space = i === text.length || text[i] === ' ';
    if (!space && start < 0) start = i;
    else if (space && start >= 0) {
      out.push({ col: start, len: i - start });
      start = -1;
    }
  }
  return out;
}

function answerInks(line: string): string {
  let out = '';
  for (const ch of line) out += ch === '✓' ? 'G' : 'A';
  return out;
}

/**
 * The readout's lines, packed into `cols` with ` · ` between the fields, and
 * an ink for every character. At 62 columns it is the one line from the pitch:
 * "step 18,442 · loss 0.4213 · reward +0.71 · KL penalty: ignored".
 */
export function readoutLines(s: Readonly<NetStats>, cols: number): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    labelled('step ', grouped(s.step), 'V'),
    labelled('loss ', s.loss.toFixed(4), 'V'),
    labelled('reward ', `${s.reward < 0 ? '-' : '+'}${Math.abs(s.reward).toFixed(2)}`, 'W'),
    labelled('KL penalty: ', 'ignored', 'V'),
  ];
  const out: Array<[string, string]> = [];
  let text = '';
  let inks = '';
  for (const [t, k] of fields) {
    if (text !== '' && text.length + 3 + t.length <= cols) {
      text += ` · ${t}`;
      inks += `LLL${k}`;
      continue;
    }
    if (text !== '') out.push([text, inks]);
    // A field wider than the column wraps on its own spaces.
    const pieces = wrapInked(t, k, cols);
    for (let i = 0; i < pieces.length - 1; i++) out.push(pieces[i]!);
    [text, inks] = pieces[pieces.length - 1] ?? ['', ''];
  }
  if (text !== '') out.push([text, inks]);
  if (s.rolledBackTo !== null) {
    const note = `rolled back to step ${grouped(s.rolledBackTo)}`;
    out.push(...wrapInked(note, 'V'.repeat(note.length), cols));
  } else if (s.hacking) {
    const note = 'reward hacking detected: continuing';
    out.push(...wrapInked(note, 'W'.repeat(note.length), cols));
  }
  return out;
}

function wrapInked(text: string, inks: string, cols: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let at = 0;
  for (const line of wrapText(text, cols)) {
    const i = text.indexOf(line, at);
    out.push([line, inks.slice(i, i + line.length)]);
    at = i + line.length;
  }
  return out;
}

function labelled(label: string, value: string, ink: string): [string, string] {
  return [`${label}${value}`, `${'L'.repeat(label.length)}${ink.repeat(value.length)}`];
}

/** `18442` -> `18,442`. */
function grouped(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function layoutSignature(l: NetLayout): string {
  const box = (b: NetTextBox | null): string => (b === null ? '-' : `${b.x},${b.y},${b.cols},${b.rows}`);
  return [
    l.w,
    l.h,
    l.scale,
    l.textScale,
    l.text,
    l.calm.x,
    l.calm.y,
    l.calm.w,
    l.calm.h,
    Array.from(l.nodeX).join(','),
    Array.from(l.nodeY).join(','),
    box(l.prompts),
    box(l.answers),
    box(l.readout),
  ].join('|');
}

/** mulberry32, the generator the sim uses, kept local so this module has no deps. */
function makeRng(seed: number): () => number {
  let a = Math.trunc(seed) | 0 || 1;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function int(random: () => number, n: number): number {
  return Math.max(0, Math.min(n - 1, Math.floor(random() * n)));
}

function pickOf<T>(random: () => number, xs: readonly T[]): T {
  return xs[int(random, xs.length)] ?? xs[0]!;
}
