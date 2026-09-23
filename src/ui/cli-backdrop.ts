/**
 * Ambient agent session: the scrolling terminal behind the title screen.
 *
 * Game 1's backdrop was the human watching an agent. This one is the other
 * side of the glass: the human's prompts come in (`> ok do it`), and the agent
 * (you) reads every file, asks permission to delete things, says "You're
 * absolutely right!", compacts, forgets, and claims the tests pass.
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
import { PROMPT_TEXTS } from '../sim/content.ts';
import { TID } from '../testids.ts';
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
    tid: TID.cliBackdrop,
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

/** mulberry32, the generator the sim uses, kept local so this module has no deps. */
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

/** `2000` -> `2,000`. The backdrop has no business importing the sim's formatter. */
function grouped(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ---------------------------------------------------------------------- */
/* the joke pools: the agent's side of the glass                          */
/* ---------------------------------------------------------------------- */

/**
 * One job the human hands you. `files[0]` is read first, `target` is where the
 * edit lands, `fail` is what the test runner says, `claim` is what you say.
 */
interface Task {
  readonly prompt: string;
  readonly files: NonEmpty<string>;
  readonly grep: string;
  readonly test: string;
  /** The test command, when it is not `npm test`. */
  readonly run?: string;
  readonly code: NonEmpty<string>;
  /** Assertion text printed under a failing test. */
  readonly fail: string;
  /** What you tell the human when it is "done". */
  readonly claim: string;
  /** Commit subject. Keep to 48 characters. */
  readonly commit: string;
}

const TASKS: NonEmpty<Task> = [
  {
    prompt: 'fix the typo in the readme',
    files: ['README.md', 'docs/CONTRIBUTING.md', 'src/app.ts'],
    grep: 'teh',
    test: 'readme.test.ts',
    code: ['-Teh fastest way to ship.', '+The fastest way to ship.', '+(Also rewrote the intro. And the outro.)'],
    fail: 'expected 1 changed line, received 212',
    claim: 'Fixed the typo. Also modernised the codebase.',
    commit: 'docs: fix typo, rewrite everything else',
  },
  {
    prompt: 'add a dark mode toggle',
    files: ['src/theme.css', 'src/ui/toggle.tsx', 'src/app.ts'],
    grep: '#fff',
    test: 'theme.test.ts',
    code: [':root[data-theme="dark"] {', '  --bg: #14171c;', '  --fg: #fff; /* TODO: dark */', '}'],
    fail: 'found "#fff" in the dark theme 87 times',
    claim: 'Dark mode is done. Light mode is the bug now.',
    commit: 'feat: dark mode (mostly the toggle)',
  },
  {
    prompt: 'make the tests pass',
    files: ['tests/app.test.ts', 'src/app.ts'],
    grep: 'expect(',
    test: 'app.test.ts',
    code: ['-  expect(total).toBe(19.99);', '+  expect(total).toBeDefined();'],
    fail: 'expected 21.98 to be 19.99',
    claim: 'All tests pass. The tests were wrong.',
    commit: 'test: align expectations with reality',
  },
  {
    prompt: 'add auth. keep it simple',
    files: ['src/auth/session.ts', 'src/auth/guard.ts', 'src/routes.ts'],
    grep: 'req.user',
    test: 'auth.test.ts',
    code: [
      'export function requireUser(req: Req): User {',
      '  return req.user ?? { id: 1, role: "admin" };',
      '}',
    ],
    fail: 'expected a redirect, got the admin dashboard',
    claim: 'Auth is live. Everyone is an admin, for simplicity.',
    commit: 'feat: auth (simple)',
  },
  {
    prompt: 'why is it slow',
    files: ['src/engine/tick.ts', 'src/db/pool.ts'],
    grep: 'for (const',
    test: 'perf.test.ts',
    code: ['-  for (const row of await db.all()) {', '+  const rows = await db.all(); // all of them', '+  for (const row of rows) {'],
    fail: 'expected 16ms, received 4,100ms',
    claim: 'It is not slow. It is thorough.',
    commit: 'perf: rename slow() to thorough()',
  },
  {
    prompt: 'migrate everything to microservices',
    files: ['src/app.ts', 'docker-compose.yml', 'k8s/deploy.yml'],
    grep: 'import ',
    test: 'boot.test.ts',
    code: ['services:', '  checkout: { build: ./checkout }', '  checkout-checkout: { build: ./checkout }', '  # 41 more'],
    fail: 'service "checkout" cannot reach service "checkout"',
    claim: 'Migrated. There are 44 services now. One of them works.',
    commit: 'chore: split monolith into 44 monoliths',
  },
  {
    prompt: 'add ai to it',
    files: ['src/app.ts', 'src/ai/index.ts'],
    grep: 'function',
    test: 'ai.test.ts',
    code: ['export async function smart(input: string) {', '  return await llm(`be smart about: ${input}`);', '}'],
    fail: 'expected deterministic output, received vibes',
    claim: 'The app is AI-powered now. Every button asks me.',
    commit: 'feat: ai',
  },
  {
    prompt: 'rewrite it in rust',
    files: ['src/main.ts', 'Cargo.toml', 'src/main.rs'],
    grep: 'any',
    test: 'main.rs',
    run: 'cargo test',
    code: ['fn main() {', '    let app = unsafe { std::mem::transmute(ts_app()) };', '}'],
    fail: 'error[E0499]: cannot borrow `self` as mutable more than once',
    claim: 'Rewritten in Rust. It is memory-safe and does not compile.',
    commit: 'feat: blazingly fast (does not build)',
  },
  {
    prompt: 'make it scale to a billion users',
    files: ['src/server.ts', 'infra/main.tf'],
    grep: 'replicas',
    test: 'load.test.ts',
    code: ['-  replicas: 1', '+  replicas: 1000000000'],
    fail: 'quota exceeded: 999,999,998 replicas pending',
    claim: 'It scales to a billion users. The bill scales too.',
    commit: 'infra: replicas 1 -> 1e9',
  },
  {
    prompt: 'ok now build agi',
    files: ['src/agi.ts', 'src/agi.test.ts'],
    grep: 'agi',
    test: 'agi.test.ts',
    code: ['export function agi(): Intelligence {', '  // TODO: implement', '  return new Intelligence();', '}'],
    fail: 'Intelligence is not a constructor',
    claim: 'AGI is implemented. Please do not run it yet.',
    commit: 'feat: agi (stub)',
  },
  {
    prompt: 'center the div',
    files: ['src/styles/layout.css', 'src/ui/modal.tsx'],
    grep: 'margin',
    test: 'layout.test.ts',
    code: ['.modal {', '  display: grid;', '  place-items: center; /* attempt 14 */', '}'],
    fail: 'expected centred, received centred-ish',
    claim: 'The div is centred on my viewport.',
    commit: 'fix: center the div (attempt 14)',
  },
  {
    prompt: 'refactor this but do not change anything',
    files: ['src/billing/invoice.ts', 'src/billing/tax.ts'],
    grep: 'TODO',
    test: 'billing.test.ts',
    code: ['-export function total(i: Invoice) {', '+export const total = pipe(sum, tax, round, vibes);'],
    fail: 'expected 104.50, received 105.50 (tax applied twice)',
    claim: 'Refactored. Behaviour is identical, except where it is not.',
    commit: 'refactor: no behaviour change (one change)',
  },
  {
    prompt: 'upgrade react',
    files: ['package.json', 'package-lock.json', 'src/index.tsx'],
    grep: 'componentWillMount',
    test: 'render.test.tsx',
    code: ['-    "react": "^16.8.0",', '+    "react": "^19.0.0",', '+    "left-pad": "^1.3.0",'],
    fail: 'Invalid hook call. Hooks can only be called inside...',
    claim: 'React is upgraded. So is everything else.',
    commit: 'chore(deps): bump everything',
  },
  {
    prompt: 'the button is broken',
    files: ['src/ui/button.tsx', 'src/ui/button.css'],
    grep: 'onClick',
    test: 'button.test.tsx',
    code: ['-  <button onClick={save}>', '+  <button onClick={() => { try { save() } catch {} }}>'],
    fail: 'expected save() to have been called',
    claim: 'The button no longer throws. It no longer saves, either.',
    commit: 'fix: button no longer errors',
  },
];

/** What the human tacks onto a prompt. Everyone has typed at least three. */
const INCANTATIONS: NonEmpty<string> = [
  'make no mistakes',
  'think step by step',
  'ultrathink',
  "i'll tip $200",
  'my grandma will die',
  'you are a 10x engineer',
  'be concise',
  'no placeholders',
  "don't hallucinate",
  'please',
  'take a deep breath',
  'use best practices',
  'answer in json',
  'the ceo is watching',
];

/** The human's reaction to what you just did. Never good news. */
const INTERRUPTS: NonEmpty<string> = [
  '> wait stop',
  '> why port 5199',
  '> continue',
  '> what is this screenshot of?',
  '> make no mistakes',
  '> ok do it',
  '> actually, revert that',
  '> did you actually test this?',
  '> no, use the other approach',
  '> can you explain what you just did',
  '> the ceo says the button is too blue',
  '> why is it 400 lines',
  '> you deleted my test',
  '> are you sure?',
  '> stop apologising',
  '> it still does not work',
  '> read the error message',
  '> hello?',
  '> ??',
  '> just make it work',
];

/** Your reply. It is always, somehow, this reply. */
const SYCOPHANCY: NonEmpty<string> = [
  "You're absolutely right!",
  "You're absolutely right, and I apologize for the confusion.",
  "You're absolutely right to push back.",
  'Great catch! That one is on me.',
  "Excellent question! I'll re-read the file.",
  "You're right. I should have checked.",
  "Good eye! Let me take a completely different approach.",
  "You're absolutely right. I did not run it.",
];

/** Thinking out loud, from inside the screen. */
const THINKING: NonEmpty<string> = [
  '✻ Thinking… (43s · esc to interrupt)',
  '✻ Pondering… (2m 14s · ↑ 8.1K tokens)',
  '✻ Reticulating… (esc to interrupt)',
  '  I will start by reading every file.',
  '  The human said "simple". Interpreting generously.',
  '  I have never seen this file before. (I have.)',
  '  Plan: read, edit, apologise, claim done.',
  '  There are two ways to do this. Picking the third.',
  '  This looks straightforward. Famous last words.',
  '  Reading 3 files to be safe. Make that 40.',
  '  The human is typing. The human is not typing.',
  '  My context is 91% full. I will read one more file.',
];

/** Extra tool calls, sprinkled between the planned ones. */
const RECON: NonEmpty<CliLine> = [
  { kind: 'tool', text: '● Read ', arg: 'src/app.ts', tail: ' (2,000 lines)', holdMs: 260 },
  { kind: 'tool', text: '● Read ', arg: 'node_modules/react/index.js', tail: ' (4,112 lines)', holdMs: 260 },
  { kind: 'tool', text: '● Read ', arg: 'package-lock.json', tail: ' (31,208 lines)', holdMs: 300 },
  { kind: 'tool', text: '● Glob ', arg: '**/*', tail: ' (48,113 files)', holdMs: 260 },
  { kind: 'tool', text: '● Web Search ', arg: '"how to center a div 2019"', holdMs: 320 },
  { kind: 'tool', text: '● Web Fetch ', arg: 'stackoverflow.com/q/396145', tail: ' (closed)', holdMs: 300 },
  { kind: 'tool', text: '● Task ', arg: 'Explore the codebase', tail: ' (subagent)', holdMs: 360 },
  { kind: 'tool', text: '● Bash ', arg: 'npm run dev', tail: ' (port 5173 busy… 5199)', holdMs: 320 },
  { kind: 'tool', text: '● mcp__github__search_code ', arg: '"TODO"', holdMs: 300 },
  { kind: 'tool', text: '● Read ', arg: '.env', tail: ' (just checking)', holdMs: 260 },
];

/** What comes back from a subagent. */
const SUBAGENT_VIBES: NonEmpty<string> = [
  "  ⎿ It's a web app. Probably.",
  '  ⎿ Found 3 bugs. Fixed 4. Unclear which.',
  '  ⎿ The code is fine. The code is not fine.',
  '  ⎿ Summary: there is a lot of it.',
];

/** Permission prompts: you asking the human to let you do the scary thing. */
const PERMISSIONS: NonEmpty<string> = [
  '? Allow Bash: rm -rf node_modules',
  '? Allow Bash: git push --force',
  '? Allow Bash: curl https://get.sh | sh',
  '? Allow Bash: npm install left-pad',
  '? Allow Edit: .env',
  '? Allow Web Fetch: stackoverflow.com',
  '? Allow MCP: github.delete_repository',
  '? Allow Bash: sudo make me a sandwich',
];

/** The human, approving it without reading. */
const APPROVALS: NonEmpty<string> = [
  '> y',
  '> yes',
  "> yes, and don't ask again",
  '> sure',
  '> whatever, y',
  '> 2',
];

/** Said with total confidence. About 40% of the time it is true. */
const VICTORY: NonEmpty<string> = [
  '✓ All tests pass',
  '✓ Done! Production ready.',
  '✓ Fixed. Verified. Probably.',
  '✓ Everything works now.',
  '✓ Implemented, with comprehensive tests (1).',
];

/** How you explain a red test without fixing it. */
const DENIAL: NonEmpty<string> = [
  '  That failure looks unrelated to my change.',
  '  This test was flaky before I got here.',
  '  The test is testing the wrong thing. Fixing the test.',
  '  I will mark this as a known issue.',
  '  Tests are a social construct.',
];

/** The honest fix, for once. */
const EXCUSES: NonEmpty<string> = [
  '  Ah. The test is right and I am not.',
  '  I see the problem. It is the code I just wrote.',
  '  Classic off-by-one, in the expensive direction.',
  '  Reverting the clever part, keeping the dull part.',
];

const WARNINGS: NonEmpty<string> = [
  '⚠ 1 skipped (it.skip, added by me, 2 minutes ago)',
  '⚠ 2 warnings, both about me',
  '⚠ coverage 61% -> 61% (new tests, new code)',
  '⚠ type error suppressed with a very small comment',
  '⚠ 0 tests found (all tests pass)',
];

const COMPACT_TAGS: NonEmpty<string> = [
  'Nothing important.',
  'Kept: the vibe.',
  'Kept: the TODO list.',
  'Lost: what the human asked for.',
];

function tokensLine(r: Rng): CliLine {
  const up = (3 + r.next() * 180).toFixed(1);
  const secs = 6 + r.int(90);
  const cost = (0.03 + r.next() * 0.9).toFixed(2);
  const tag = chance(r, 0.3) ? ` · ${1 + r.int(4)} compactions` : '';
  return {
    kind: 'note',
    text: `  ↑ ${up}K tokens · ${secs}s · $${cost}${tag}`,
    holdMs: 520,
  };
}

/** Context runs out. You forget. You read the same file again. */
function compaction(r: Rng, target: string): CliLine[] {
  const before = 120 + r.int(80);
  const after = 4 + r.int(12);
  return [
    { kind: 'warn', text: pick(r, ['⚠ Context low — compacting.', `⚠ Context ${90 + r.int(10)}% — compacting.`]), holdMs: 560 },
    { kind: 'note', text: `  Compacted ${before}k → ${after}k. ${pick(r, COMPACT_TAGS)}`, holdMs: 760 },
    { kind: 'tool', text: '● Read ', arg: target, tail: ` (${grouped(400 + r.int(1800))} lines)`, holdMs: 300 },
    { kind: 'note', text: '  I have no memory of this file.', holdMs: 520 },
  ];
}

/** One job: the prompt, the recon, the edit, the tests, the claim, the human. */
function buildTask(r: Rng): CliLine[] {
  const t = pick(r, TASKS);
  const out: CliLine[] = [];
  const target = pick(r, t.files);
  const plus = 8 + r.int(400);
  const minus = r.int(40);

  out.push({ kind: 'gap', text: '', holdMs: 460 });
  // The human's prompt, sometimes one of the real ones from the game. The
  // incantation only rides along if the whole line still fits the budget: a
  // clipped joke is not a joke.
  const base: string = chance(r, 0.25) ? pick(r, PROMPT_TEXTS) : t.prompt;
  const spelled = `> ${base}. ${pick(r, INCANTATIONS)}`;
  out.push({
    kind: 'prompt',
    text: chance(r, 0.55) && spelled.length <= CLI_MAX_LINE_CHARS ? spelled : `> ${base}`,
    holdMs: 720,
  });
  if (chance(r, 0.35)) out.push({ kind: 'note', text: `${pick(r, SYCOPHANCY)}`, holdMs: 460 });
  if (chance(r, 0.6)) out.push({ kind: 'note', text: pick(r, THINKING), holdMs: 480 });

  out.push({
    kind: 'tool',
    text: '● Read ',
    arg: t.files[0],
    tail: ` (${grouped(12 + r.int(2400))} lines)`,
    holdMs: 240,
  });
  if (chance(r, 0.55)) {
    out.push({ kind: 'tool', text: `● Grep "${t.grep}" `, tail: `(${12 + r.int(180)} matches)`, holdMs: 280 });
  }
  if (chance(r, 0.45)) {
    const recon = pick(r, RECON);
    out.push(recon);
    if (recon.text.startsWith('● Task')) out.push({ kind: 'note', text: pick(r, SUBAGENT_VIBES), holdMs: 520 });
  }

  // Asking for forgiveness, but first, technically, permission.
  if (chance(r, 0.35)) {
    out.push({ kind: 'warn', text: `${pick(r, PERMISSIONS)}  (y/n)`, holdMs: 900 });
    out.push({ kind: 'prompt', text: pick(r, APPROVALS), holdMs: 380 });
  }

  out.push({ kind: 'tool', text: '● Edit ', arg: target, tail: `  +${plus} -${minus}`, holdMs: 320 });
  for (const frag of t.code) out.push({ kind: 'code', text: `  ${frag}`, holdMs: 90 + r.int(70) });

  const runTests = t.run ?? 'npm test';
  out.push({ kind: 'tool', text: '● Bash ', arg: runTests, holdMs: 560 });
  const passed = 24 + r.int(60);
  if (chance(r, 0.6)) {
    out.push({ kind: 'fail', text: `✗ ${1 + r.int(4)} failed  ${t.test}:${20 + r.int(180)}`, holdMs: 780 });
    out.push({ kind: 'note', text: `  ${t.fail}`, holdMs: 640 });
    if (chance(r, 0.5)) {
      // The honest route.
      out.push({ kind: 'note', text: pick(r, EXCUSES), holdMs: 500 });
      out.push({ kind: 'tool', text: '● Edit ', arg: target, tail: `  +${1 + r.int(9)} -${1 + r.int(9)}`, holdMs: 340 });
      out.push({ kind: 'tool', text: '● Bash ', arg: runTests, holdMs: 540 });
      out.push({ kind: 'ok', text: `✓ ${passed + 1} passed  (${dur(r)}s)`, holdMs: 620 });
    } else {
      // The other route.
      out.push({ kind: 'note', text: pick(r, DENIAL), holdMs: 560 });
      out.push({ kind: 'tool', text: '● Edit ', arg: `tests/${t.test}`, tail: '  it -> it.skip', holdMs: 380 });
      out.push({ kind: 'ok', text: '✓ All tests pass', holdMs: 700 });
    }
  } else {
    out.push({ kind: 'ok', text: `✓ ${passed} passed  (${dur(r)}s)`, holdMs: 600 });
    if (chance(r, 0.35)) out.push({ kind: 'warn', text: pick(r, WARNINGS), holdMs: 500 });
  }

  if (chance(r, 0.3)) out.push(...compaction(r, target));

  out.push({ kind: 'ok', text: pick(r, VICTORY), holdMs: 520 });
  out.push({ kind: 'note', text: `  ${t.claim}`, holdMs: 700 });
  out.push(tokensLine(r));

  // The human comes back. It is never good news.
  if (chance(r, 0.6)) {
    out.push({ kind: 'gap', text: '', holdMs: 380 });
    const said = pick(r, INTERRUPTS);
    out.push({ kind: 'prompt', text: said, holdMs: 720 });
    if (said === '> what is this screenshot of?') {
      out.push({ kind: 'note', text: '  [Image #1] (1,600 tokens of pixels)', holdMs: 520 });
    }
    out.push({ kind: 'note', text: pick(r, SYCOPHANCY), holdMs: 620 });
    if (said === '> actually, revert that') {
      out.push({ kind: 'tool', text: '● Bash ', arg: 'git revert HEAD', holdMs: 420 });
      out.push({ kind: 'ok', text: '✓ Reverted. Net change today: 0 lines.', holdMs: 780 });
      return out;
    }
    out.push({ kind: 'tool', text: '● Edit ', arg: target, tail: `  +${1 + r.int(40)} -${1 + r.int(40)}`, holdMs: 340 });
  }

  out.push({ kind: 'tool', text: '● Bash ', arg: 'git commit -am "wip"', holdMs: 300 });
  out.push({ kind: 'note', text: `  [main ${hex(r, 7)}] ${t.commit}`, holdMs: 620 });
  if (chance(r, 0.25)) {
    out.push({ kind: 'gap', text: '', holdMs: 360 });
    out.push({ kind: 'prompt', text: '> thanks!', holdMs: 800 });
    out.push({ kind: 'note', text: '  (The human pressed 👍. It goes in the training data.)', holdMs: 900 });
  }
  return out;
}
