/**
 * Ambient fake agent session — the scrolling terminal behind the title screen
 * and the Demos tree.
 *
 *   const cli = createCliBackdrop({ reducedMotion: () => settings.reducedMotion });
 *   title.el.classList.add('tm-cli-host');
 *   title.el.insertBefore(cli.el, title.el.firstChild);
 *   cli.start();            // ... cli.stop() when the run screen takes over
 *
 * It is a *backdrop*: `pointer-events: none`, `aria-hidden`, `z-index: -1`, no
 * focusable nodes, and a vignette that scrubs the middle of the frame so the
 * title copy and buttons stay the loudest thing on screen.
 *
 * Cost: one `setInterval`. A tick that emits nothing is a clock read and a
 * compare; a tick that emits appends one <div> with at most two <span>s and
 * drops one node past the 40-line cap. Nothing in the loop reads layout, so it
 * can never force a synchronous reflow.
 *
 * The script is generated from a seeded PRNG, so the same seed always produces
 * the same session — deterministic for tests and screenshots, but long enough
 * in the cycle that nobody watching the title screen notices the loop.
 */
import { el } from './dom.ts';

/** Hard budget for a rendered line, in characters. Longer lines clip. */
export const CLI_MAX_LINE_CHARS = 70;

/** Ceiling on rendered lines per column, if the height cannot be measured. */
const MAX_LINES = 64;
/** Narrowest a column may get before the grid drops one. */
const COL_MIN_PX = 380;
/** Upper bound on columns. Past this the text is too dense to read as code. */
const MAX_COLS = 4;
/** Assumed row height when layout is unmeasurable (jsdom, display:none). */
const FALLBACK_LINE_PX = 15;
/** Timer period. Line pacing comes from `holdMs`, not from this. */
const TICK_MS = 100;
/** Ceiling on catch-up emits per column per tick, so a throttled tab cannot burst. */
const MAX_LINES_PER_TICK = 3;
/** Gap before the first animated line. */
const FIRST_LINE_MS = 420;
/** Past this much drift (backgrounded tab) the schedule resyncs to now. */
const RESYNC_MS = 2_000;
const DEFAULT_HOLD_MS = 180;
const DEFAULT_SEED = 0x5c0f;
/** Seed stride between columns — a big odd number, so no two share a session. */
const COL_SEED_STRIDE = 0x9e3779b1;

export type CliLineKind = 'prompt' | 'tool' | 'code' | 'ok' | 'warn' | 'fail' | 'note' | 'gap';

/** One rendered row. `text` + `arg` + `tail` must fit `CLI_MAX_LINE_CHARS`. */
export interface CliLine {
  readonly kind: CliLineKind;
  /** Leading run, painted in the kind colour. */
  readonly text: string;
  /** Path fragment, painted in `--blue`. */
  readonly arg?: string;
  /** Trailing stats, painted dim. */
  readonly tail?: string;
  /** Dwell before the next line. */
  readonly holdMs?: number;
}

export interface CliBackdrop {
  /** The node the host appends. Never focusable, never hit-tested. */
  readonly el: HTMLElement;
  start(): void;
  /** Pause. Cheap and idempotent — call it on `document.hidden`. */
  stop(): void;
  destroy(): void;
}

export interface CliBackdropOpts {
  /** When true, `start()` paints one static frame and never schedules a timer. */
  reducedMotion?: () => boolean;
  /** Injectable clock. Defaults to `performance.now`. */
  now?: () => number;
  /** PRNG seed. Fixed by default so boots are reproducible. */
  seed?: number;
}

/** One independent session. Columns share the timer and nothing else. */
interface Column {
  readonly log: HTMLElement;
  readonly next: () => CliLine;
  /** Pace multiplier, so the columns never march in lockstep. */
  readonly rate: number;
  nextAt: number;
}

export function createCliBackdrop(opts: CliBackdropOpts = {}): CliBackdrop {
  const now = opts.now ?? ((): number => performance.now());
  const reducedMotion = opts.reducedMotion ?? ((): boolean => false);
  const baseSeed = opts.seed ?? DEFAULT_SEED;

  const root = el('div', {
    cls: 'tm-cli',
    tid: 'cli-backdrop',
    attrs: { 'aria-hidden': 'true' },
  });
  // Also inline, not only in cli.css: if the stylesheet ever fails to load the
  // backdrop still must not be able to swallow a click on the Start button.
  root.style.pointerEvents = 'none';

  let columns: Column[] = [];
  /** Rendered lines kept per column. Re-measured whenever the grid is rebuilt. */
  let capacity = MAX_LINES;
  let timer: ReturnType<typeof setInterval> | null = null;
  let raf = 0;
  let destroyed = false;

  function append(col: Column, line: CliLine): void {
    // Hot path: hand-built nodes, no options object, no innerHTML, textContent
    // only. At most three nodes per line.
    const node = document.createElement('div');
    node.className = `tm-cli__line tm-cli__line--${line.kind}`;
    node.textContent = line.text;
    if (line.arg !== undefined) {
      const span = document.createElement('span');
      span.className = 'tm-cli__path';
      span.textContent = line.arg;
      node.appendChild(span);
    }
    if (line.tail !== undefined) {
      const span = document.createElement('span');
      span.className = 'tm-cli__tail';
      span.textContent = line.tail;
      node.appendChild(span);
    }
    col.log.appendChild(node);
    while (col.log.childElementCount > capacity) {
      const first = col.log.firstElementChild;
      if (first === null) break;
      first.remove();
    }
  }

  /** Append the next scripted line; returns how long to dwell on it. */
  function emit(col: Column): number {
    const line = col.next();
    append(col, line);
    return (line.holdMs ?? DEFAULT_HOLD_MS) * col.rate;
  }

  function tick(): void {
    const t = now();
    for (const col of columns) {
      // A backgrounded tab coalesces intervals; do not replay the missing minute.
      if (t - col.nextAt > RESYNC_MS) col.nextAt = t;
      for (let n = 0; n < MAX_LINES_PER_TICK && col.nextAt <= t; n++) {
        col.nextAt += emit(col);
      }
    }
  }

  /**
   * How many columns fit, and how many rows each holds.
   *
   * Both are pure layout reads, so they happen here — on start and on resize —
   * and never inside `tick()`, which must not be able to force a reflow.
   */
  function measure(): { cols: number; rows: number } {
    const w = root.clientWidth || root.ownerDocument.defaultView?.innerWidth || 0;
    const h = root.clientHeight || root.ownerDocument.defaultView?.innerHeight || 0;
    const cols = Math.max(1, Math.min(MAX_COLS, Math.floor(w / COL_MIN_PX) || 1));
    const probe = columns[0]?.log.firstElementChild as HTMLElement | undefined;
    const linePx = probe?.offsetHeight || FALLBACK_LINE_PX;
    // +2 so the topmost row is always mid-clip rather than sitting flush.
    const rows = h > 0 ? Math.ceil(h / linePx) + 2 : MAX_LINES;
    return { cols, rows: Math.max(8, rows) };
  }

  /** Build (or rebuild) the grid. Cheap no-op when the shape has not changed. */
  function layout(): void {
    if (destroyed) return;
    const { cols, rows } = measure();
    capacity = rows;
    if (columns.length === cols) {
      // Same shape: just trim to the new row budget.
      for (const col of columns) {
        while (col.log.childElementCount > capacity) col.log.firstElementChild?.remove();
      }
      return;
    }
    root.style.setProperty('--tm-cli-cols', String(cols));
    for (const col of columns) col.log.remove();
    columns = [];
    for (let i = 0; i < cols; i++) {
      columns.push({
        log: el('div', { cls: 'tm-cli__log', parent: root }),
        next: createCliScript(baseSeed + i * COL_SEED_STRIDE),
        rate: 0.82 + i * 0.19,
        nextAt: 0,
      });
    }
  }

  function fill(): void {
    for (const col of columns) {
      if (col.log.childElementCount > 0) continue;
      for (let i = 0; i < capacity; i++) emit(col);
    }
  }

  function onResize(): void {
    if (destroyed || raf !== 0) return;
    // Coalesce a resize drag into one rebuild per frame.
    raf = requestAnimationFrame(() => {
      raf = 0;
      const had = columns.length;
      layout();
      if (columns.length !== had) fill();
    });
  }

  function start(): void {
    if (destroyed) return;
    layout();
    fill();
    if (reducedMotion()) {
      stop();
      root.classList.add('is-static');
      return;
    }
    root.classList.remove('is-static');
    if (timer !== null) return;
    const t0 = now() + FIRST_LINE_MS;
    for (const col of columns) col.nextAt = t0;
    timer = setInterval(tick, TICK_MS);
    root.ownerDocument.defaultView?.addEventListener('resize', onResize, { passive: true });
  }

  function stop(): void {
    root.ownerDocument.defaultView?.removeEventListener('resize', onResize);
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function destroy(): void {
    destroyed = true;
    stop();
    root.remove();
  }

  return { el: root, start, stop, destroy };
}

/** Flat text of a line, exactly as it renders. */
export function cliLineText(line: CliLine): string {
  return `${line.text}${line.arg ?? ''}${line.tail ?? ''}`;
}

/* ---------------------------------------------------------------------- */
/* script generator                                                       */
/* ---------------------------------------------------------------------- */

/**
 * An endless, deterministic agent session. Each call returns the next line.
 * Exported so tests can walk hundreds of lines without a DOM.
 */
export function createCliScript(seed: number): () => CliLine {
  const rng = makeRng(seed);
  let buf: CliLine[] = [];
  let i = 0;
  return (): CliLine => {
    if (i >= buf.length) {
      buf = buildTask(rng);
      i = 0;
    }
    const line = buf[i];
    i += 1;
    return line ?? BLANK;
  };
}

const BLANK: CliLine = { kind: 'gap', text: '' };

interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

/** mulberry32 — same generator the sim uses, kept local so this module has no deps. */
function makeRng(seed: number): Rng {
  let a = (Math.trunc(seed) | 0) || 1;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  return { next, int: (n: number): number => Math.floor(next() * n) };
}

type NonEmpty<T> = readonly [T, ...T[]];

function pick<T>(r: Rng, xs: NonEmpty<T>): T {
  return xs[r.int(xs.length)] ?? xs[0];
}

function chance(r: Rng, p: number): boolean {
  return r.next() < p;
}

const HEX = '0123456789abcdef';

function hex(r: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += HEX[r.int(16)] ?? '0';
  return s;
}

function dur(r: Rng): string {
  return (0.8 + r.next() * 5).toFixed(2);
}

interface Task {
  readonly prompt: string;
  readonly files: NonEmpty<string>;
  readonly grep: string;
  readonly test: string;
  readonly code: NonEmpty<string>;
  /** Assertion text printed under a failing test. */
  readonly fail: string;
  /** Commit subject. Keep to 48 characters. */
  readonly commit: string;
}

const TASKS: NonEmpty<Task> = [
  {
    prompt: 'implement the checkout flow',
    files: ['src/checkout/cart.ts', 'src/checkout/total.ts', 'src/api/routes.ts'],
    grep: 'TODO',
    test: 'cart.test.ts',
    code: [
      'export async function checkout(cart: Cart) {',
      '  const total = cart.items.reduce(sumLine, 0);',
      '  if (total <= 0) throw new Error("empty cart");',
      '  return post("/api/checkout", { total });',
      '}',
    ],
    fail: 'expected 21.98 to be 19.99 (tax applied twice)',
    commit: 'feat: checkout, tax applied exactly once',
  },
  {
    prompt: 'why is cart.test.ts flaky',
    files: ['tests/cart.test.ts', 'src/checkout/cart.ts'],
    grep: 'await sleep',
    test: 'cart.test.ts',
    code: [
      '-  await sleep(50); // should be plenty',
      '+  await waitFor(() => cart.ready === true);',
    ],
    fail: 'timed out after 5000ms (50ms was plenty, usually)',
    commit: 'fix: stop measuring time with vibes',
  },
  {
    prompt: 'add dark mode',
    files: ['src/styles/theme.css', 'src/ui/theme.ts'],
    grep: '#fff',
    test: 'theme.test.ts',
    code: [
      ':root[data-theme="dark"] {',
      '  --bg: #14161a;',
      '  --fg: #d7dee8;',
      '}',
    ],
    fail: 'found "#fff" in the dark theme, 87 times',
    commit: 'feat: dark mode (light mode is the bug now)',
  },
  {
    prompt: 'the bundle is 41mb, fix it',
    files: ['vite.config.ts', 'src/vendor/index.ts'],
    grep: 'import \\*',
    test: 'bundle.test.ts',
    code: [
      '-import * as icons from "@mega/icons";',
      '+import { Check, X } from "@mega/icons";',
    ],
    fail: 'expected < 5mb, received 40.8mb (better!)',
    commit: 'perf: bundle 41.2mb -> 40.8mb',
  },
  {
    prompt: 'add auth, keep it simple',
    files: ['src/auth/session.ts', 'src/auth/guard.ts'],
    grep: 'req.user',
    test: 'auth.test.ts',
    code: [
      'export function requireUser(req: Req): User {',
      '  const sid = req.cookies.sid ?? "";',
      '  return verify(sid) ?? redirect("/login");',
      '}',
    ],
    fail: 'expected a redirect, got the admin dashboard',
    commit: 'fix: logged-out users are no longer admins',
  },
  {
    prompt: 'make the landing page convert',
    files: ['src/pages/landing.tsx', 'src/copy/hero.ts'],
    grep: 'gradient',
    test: 'landing.test.ts',
    code: [
      'const HERO = "The last tool you will ever need";',
      'const CTA = "Start free. No card, no soul.";',
      'const PROOF = ["YC", "a16z", "my cousin"];',
    ],
    fail: 'expected 1 call to action, found 6',
    commit: 'feat: 3 more gradients, 1 fewer paragraph',
  },
  {
    prompt: 'rewrite twitter, we have a weekend',
    files: ['src/timeline/feed.ts', 'src/timeline/rank.ts'],
    grep: 'engagement',
    test: 'feed.test.ts',
    code: [
      'export function rank(posts: Post[]): Post[] {',
      '  return posts.sort((a, b) => b.rage - a.rage);',
      '}',
    ],
    fail: 'expected 280 chars, received the whole novel',
    commit: 'feat: timeline ranked by rage, as is standard',
  },
  {
    prompt: 'delete every TODO in the repo',
    files: ['src/engine/tick.ts', 'src/net/socket.ts', 'src/db/pool.ts'],
    grep: 'TODO|FIXME|XXX',
    test: 'lint.test.ts',
    code: [
      '-// TODO: handle the error case',
      '-// TODO: this is O(n^2), fix before launch',
      '+// (handled)',
    ],
    fail: 'expected 0 TODOs, found 3 new ones',
    commit: 'chore: 142 TODOs resolved, 0 problems solved',
  },
  {
    prompt: 'make it 10x faster',
    files: ['src/engine/tick.ts', 'src/engine/pool.ts'],
    grep: 'for (const',
    test: 'perf.test.ts',
    code: [
      '-  for (const e of all) e.update(dt);',
      '+  for (let i = 0; i < n; i++) pool[i].update(dt);',
      '+  // do not ask about the allocation on line 40',
    ],
    fail: 'expected 16ms, received 41ms (on the old laptop)',
    commit: 'perf: 10x faster on a benchmark I wrote',
  },
  {
    prompt: 'the CEO says the button is too blue',
    files: ['src/ui/button.css', 'src/styles/palette.css'],
    grep: '#4a9de8',
    test: 'button.test.ts',
    code: [
      '-  background: #4a9de8;',
      '+  background: #4a9de7;',
    ],
    fail: 'expected "#4a9de7", received "still too blue"',
    commit: 'fix: button is a completely different blue',
  },
  {
    prompt: 'add tests for the tests',
    files: ['tests/meta/tests.test.ts', 'vitest.config.ts'],
    grep: 'describe(',
    test: 'tests.test.ts',
    code: [
      'it("the tests exist", () => {',
      '  expect(files("tests").length).toBeGreaterThan(0);',
      '});',
    ],
    fail: 'expected 0 to be greater than 0',
    commit: 'test: 100% coverage of the test files',
  },
  {
    prompt: 'migrate us to the new framework',
    files: ['package.json', 'src/main.ts', 'src/app/root.tsx'],
    grep: 'old-framework',
    test: 'boot.test.ts',
    code: [
      '-import { render } from "old-framework";',
      '+import { render } from "new-framework";',
      '// 411 files to go, all exactly like this one',
    ],
    fail: 'Cannot find module "new-framework"',
    commit: 'chore: migrate 1 of 412 files',
  },
];

const THINKING: NonEmpty<string> = [
  "I'll read the existing implementation first.",
  'This looks straightforward. Famous last words.',
  'Let me check whether this was already solved here.',
  'There is a lot of code here. Most of it is mine.',
  'Reading 4 files to be safe. Make that 11.',
  'I will do this one properly. I mean it this time.',
  'Interesting. That should not have compiled.',
  'The user said "simple". Interpreting generously.',
  'Noted. I will pretend I did not see that file.',
  'Plan: 1) read 2) edit 3) apologise 4) commit',
  'I have a hunch. My hunches are 51% accurate.',
  'Two approaches here. Picking the longer one.',
];

const EXCUSES: NonEmpty<string> = [
  'Right. That one is on me. Reading the test.',
  'Ah. The test is correct and I am not.',
  'I see the problem. It is the code I just wrote.',
  'That assertion is load-bearing. Fixing the code.',
  'Classic off-by-one, in the expensive direction.',
  'The test was right to be suspicious of me.',
  'Reverting the clever part, keeping the dull part.',
  'You are absolutely right. Let me fix that.',
  'Let me try a completely different approach.',
  'I apologise for the confusion. Root-causing now.',
  'I have not actually run this yet. Running it.',
];

/**
 * Magic incantations appended to prompts. Everybody has typed at least three
 * of these into an agent and quietly believed it helped.
 */
const DIRECTIVES: NonEmpty<string> = [
  'make no mistakes',
  'do not hallucinate',
  'this is important to my career',
  "I'll tip you $200",
  'take a deep breath',
  'think step by step',
  'ultrathink',
  'do not stop until it works',
  'no mocks this time',
  'you are a 10x engineer',
  'be concise',
  'do not touch anything else',
  'read the whole file first',
  'no placeholders',
];

/** The follow-up you type ninety seconds after saying "looks good". */
const PUSHBACK: NonEmpty<string> = [
  '> are you sure?',
  '> did you actually run it?',
  '> that is not what I asked for',
  '> you deleted my test',
  '> why is it 400 lines',
  '> stop apologising and fix it',
  '> it still does not work',
  '> read the error message',
  '> you changed 11 unrelated files',
  '> do not just delete the assertion',
];

/** The reply. Always the same reply. */
const CLIMBDOWNS: NonEmpty<string> = [
  'You are absolutely right.',
  'You are absolutely right to push back.',
  'Good catch. Let me take a step back.',
  'Great question! Let me re-read the file.',
  'Apologies — I will be more careful this time.',
  'You are right, and I should have checked.',
];

/** Said with total confidence, roughly 40% of the time correctly. */
const VICTORY: NonEmpty<string> = [
  'Perfect! Everything is working now.',
  'Done. This should work.',
  'All green. Shipping it.',
  'That was the last one. Almost certainly.',
  'Fixed properly this time.',
];

const WARNINGS: NonEmpty<string> = [
  '1 skipped (it.skip, added 9 commits ago)',
  '2 warnings, both about me',
  'coverage 61% -> 61% (new tests, new code)',
  'eslint: 14 problems, 14 fixable, 0 fixed',
  'type error suppressed with a very small comment',
  'peer dep mismatch (resolved by not looking)',
];

const TOKEN_TAGS: NonEmpty<string> = [
  '',
  ' · cache 78%',
  ' · 2 retries',
  ' · worth it',
  ' · 1 compaction',
];

const GLOBS: NonEmpty<string> = ['tests/**/*.test.ts', 'src/**/*.ts', 'src/**/*.css'];

function tokensLine(r: Rng): CliLine {
  const up = (3 + r.next() * 38).toFixed(1);
  const down = (0.4 + r.next() * 6).toFixed(1);
  const secs = 6 + r.int(90);
  const cost = (0.03 + r.next() * 0.9).toFixed(2);
  return {
    kind: 'note',
    text: `  ↑ ${up}k ↓ ${down}k tokens · ${secs}s · $${cost}${pick(r, TOKEN_TAGS)}`,
    holdMs: 520,
  };
}

/** One coherent task: prompt, recon, edit, tests, maybe a faceplant, commit. */
function buildTask(r: Rng): CliLine[] {
  const t = pick(r, TASKS);
  const out: CliLine[] = [];
  const target = pick(r, t.files);
  const plus = 8 + r.int(120);
  const minus = r.int(40);

  out.push({ kind: 'gap', text: '', holdMs: 460 });
  // The incantation only rides along if the whole line still fits the budget —
  // a clipped joke is not a joke.
  const spell = pick(r, DIRECTIVES);
  const spelled = `> ${t.prompt}. ${spell}.`;
  const opener =
    chance(r, 0.5) && spelled.length <= CLI_MAX_LINE_CHARS ? spelled : `> ${t.prompt}`;
  out.push({ kind: 'prompt', text: opener, holdMs: 720 });
  if (chance(r, 0.6)) {
    out.push({ kind: 'note', text: `  ${pick(r, THINKING)}`, holdMs: 440 });
  }

  out.push({ kind: 'tool', text: '● Read ', arg: t.files[0], holdMs: 240 });
  if (chance(r, 0.55)) {
    out.push({
      kind: 'tool',
      text: `● Grep "${t.grep}" `,
      tail: `(${12 + r.int(180)} matches)`,
      holdMs: 280,
    });
  }
  if (chance(r, 0.3)) {
    out.push({
      kind: 'tool',
      text: '● Glob ',
      arg: pick(r, GLOBS),
      tail: ` (${18 + r.int(70)} files)`,
      holdMs: 250,
    });
  }

  out.push({ kind: 'tool', text: '● Edit ', arg: target, tail: `  +${plus} -${minus}`, holdMs: 320 });
  for (const frag of t.code) {
    out.push({ kind: 'code', text: `  ${frag}`, holdMs: 90 + r.int(70) });
  }

  out.push({ kind: 'tool', text: '● Bash npm test', holdMs: 560 });
  const passed = 24 + r.int(60);
  if (chance(r, 0.55)) {
    out.push({ kind: 'fail', text: `✗ 1 failed  ${t.test}:${20 + r.int(180)}`, holdMs: 780 });
    out.push({ kind: 'note', text: `  ${t.fail}`, holdMs: 640 });
    out.push({ kind: 'note', text: `  ${pick(r, EXCUSES)}`, holdMs: 500 });
    out.push({ kind: 'tool', text: '● Read ', arg: t.test, holdMs: 260 });
    out.push({
      kind: 'tool',
      text: '● Edit ',
      arg: target,
      tail: `  +${1 + r.int(9)} -${1 + r.int(9)}`,
      holdMs: 340,
    });
    out.push({ kind: 'tool', text: '● Bash npm test', holdMs: 540 });
    out.push({ kind: 'ok', text: `✓ ${passed + 1} passed  (${dur(r)}s)`, holdMs: 620 });
    if (chance(r, 0.4)) {
      out.push({ kind: 'note', text: `  ${pick(r, VICTORY)}`, holdMs: 560 });
    }
  } else {
    out.push({ kind: 'ok', text: `✓ ${passed} passed  (${dur(r)}s)`, holdMs: 600 });
    if (chance(r, 0.35)) {
      out.push({ kind: 'warn', text: `⚠ ${pick(r, WARNINGS)}`, holdMs: 500 });
    }
  }

  // The user comes back. It is never good news.
  if (chance(r, 0.32)) {
    out.push({ kind: 'gap', text: '', holdMs: 380 });
    out.push({ kind: 'prompt', text: pick(r, PUSHBACK), holdMs: 700 });
    out.push({ kind: 'note', text: `  ${pick(r, CLIMBDOWNS)}`, holdMs: 620 });
    out.push({
      kind: 'tool',
      text: '● Edit ',
      arg: target,
      tail: `  +${1 + r.int(24)} -${1 + r.int(24)}`,
      holdMs: 340,
    });
  }

  out.push(tokensLine(r));
  out.push({ kind: 'tool', text: '● Bash git commit -a', holdMs: 300 });
  out.push({ kind: 'note', text: `  [main ${hex(r, 7)}] ${t.commit}`, holdMs: 620 });
  out.push({
    kind: 'note',
    text: `  ${t.files.length} files changed, ${plus} +, ${minus} -`,
    holdMs: 760,
  });

  if (chance(r, 0.22)) {
    out.push({ kind: 'gap', text: '', holdMs: 400 });
    out.push({ kind: 'prompt', text: '> actually, revert that', holdMs: 700 });
    out.push({ kind: 'tool', text: '● Bash git revert HEAD', holdMs: 420 });
    out.push({ kind: 'ok', text: '✓ reverted. Net change today: 0 lines.', holdMs: 780 });
  } else if (chance(r, 0.2)) {
    out.push({ kind: 'warn', text: '⚠ Context low — compacting.', holdMs: 480 });
    out.push({ kind: 'note', text: '  Compacted 94k -> 11k. Nothing important.', holdMs: 700 });
  }

  return out;
}
