/**
 * The CLI backdrop is decorative, so the properties worth pinning are mostly
 * negative ones: it must not be reachable, must not grow without bound, must
 * not leave a timer running, and must not animate when the player asked for
 * stillness. Determinism, the line budget and the jokes themselves (it is the
 * agent's side of the glass now) are asserted against the pure script
 * generator, which needs no DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLI_MAX_LINE_CHARS,
  cliLineText,
  createCliBackdrop,
  createCliScript,
  type CliBackdrop,
  type CliLine,
} from '../../src/ui/cli-backdrop.ts';
import { focusables } from '../../src/ui/dom.ts';

interface Rig {
  cli: CliBackdrop;
  host: HTMLElement;
  /** Steps the injected clock and the fake timers together. */
  advance: (ms: number) => void;
  lines: () => string[];
  count: () => number;
}

const live: CliBackdrop[] = [];

function rig(opts: Parameters<typeof createCliBackdrop>[0] = {}): Rig {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let clock = 0;
  const cli = createCliBackdrop({ now: () => clock, ...opts });
  live.push(cli);
  host.appendChild(cli.el);

  const log = (): Element => {
    const node = cli.el.firstElementChild;
    if (node === null) throw new Error('no log element');
    return node;
  };

  return {
    cli,
    host,
    advance: (ms: number) => {
      // Small steps, so `now()` tracks the timer the way a real clock would
      // instead of handing the loop one enormous jump.
      const step = 25;
      for (let t = 0; t < ms; t += step) {
        clock += step;
        vi.advanceTimersByTime(step);
      }
    },
    lines: () => Array.from(log().children, (n) => n.textContent ?? ''),
    count: () => log().childElementCount,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const cli of live) cli.destroy();
  live.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('cli backdrop — inertness', () => {
  it('is hidden from assistive tech and from the pointer', () => {
    const r = rig();
    r.cli.start();
    expect(r.cli.el.getAttribute('aria-hidden')).toBe('true');
    // Inline as well as in cli.css, so a missing stylesheet cannot make the
    // backdrop eat a click on the Start button.
    expect(r.cli.el.style.pointerEvents).toBe('none');
  });

  it('contains no focusable elements', () => {
    const r = rig();
    r.cli.start();
    r.advance(30_000);
    expect(r.count()).toBeGreaterThan(10);
    expect(focusables(r.cli.el)).toHaveLength(0);
    expect(r.cli.el.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(r.cli.el.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });

  it('renders only div and span nodes', () => {
    const r = rig();
    r.cli.start();
    r.advance(20_000);
    const tags = new Set(Array.from(r.cli.el.querySelectorAll('*'), (n) => n.tagName));
    expect(Array.from(tags).sort()).toEqual(['DIV', 'SPAN']);
  });
});

describe('cli backdrop — timers', () => {
  it('start() creates exactly one timer and is idempotent', () => {
    const r = rig();
    expect(vi.getTimerCount()).toBe(0);
    r.cli.start();
    expect(vi.getTimerCount()).toBe(1);
    r.cli.start();
    r.cli.start();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stop() clears the timer and is idempotent', () => {
    const r = rig();
    r.cli.start();
    r.cli.stop();
    expect(vi.getTimerCount()).toBe(0);
    r.cli.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() freezes output and start() resumes it', () => {
    const r = rig();
    r.cli.start();
    r.advance(4000);
    // The log is prefilled to a full screen, so it sits at the cap from the
    // first frame. Progress shows as churn at the tail, not as a rising count.
    const frozen = r.lines();
    r.cli.stop();
    r.advance(20_000);
    expect(r.lines(), 'a stopped backdrop kept writing').toEqual(frozen);
    r.cli.start();
    expect(vi.getTimerCount()).toBe(1);
    r.advance(4000);
    expect(r.lines()).not.toEqual(frozen);
  });

  it('does not repaint the whole log on every tick', () => {
    const r = rig();
    r.cli.start();
    r.advance(2000);
    // At the cap the head is evicted every line, so identity has to be checked
    // on nodes that survive: the tail must slide up, not be rebuilt.
    const before = Array.from(r.cli.el.querySelectorAll('.tm-cli__line'));
    const tail = before.slice(-8);
    r.advance(1500);
    const after = new Set(r.cli.el.querySelectorAll('.tm-cli__line'));
    const survivors = tail.filter((n) => after.has(n));
    expect(survivors.length, 'the log was rebuilt rather than appended to').toBeGreaterThan(0);
    for (const n of survivors) expect(n.isConnected).toBe(true);
  });
});

describe('cli backdrop — line budget', () => {
  it('opens at a full screen and never grows past the cap', () => {
    const r = rig();
    r.cli.start();
    // The backdrop is meant to look like a session already underway, so the
    // column is full before the first tick rather than filling over a minute.
    const prefilled = r.count();
    expect(prefilled).toBeGreaterThan(20);
    expect(prefilled).toBeLessThanOrEqual(64);

    r.advance(6000);
    expect(r.count()).toBe(prefilled);
    r.advance(300_000);
    expect(r.count()).toBe(prefilled);
  });

  it('keeps every generated line inside the character budget', () => {
    for (const seed of [1, 7, 1234, 0x5c0f, -99, 2 ** 20]) {
      const next = createCliScript(seed);
      for (let i = 0; i < 1200; i++) {
        const line = next();
        const text = cliLineText(line);
        expect(text.length, `seed ${seed}: ${text}`).toBeLessThanOrEqual(CLI_MAX_LINE_CHARS);
      }
    }
  });

  it('never emits a line containing a newline', () => {
    const next = createCliScript(42);
    for (let i = 0; i < 600; i++) {
      expect(cliLineText(next())).not.toContain('\n');
    }
  });
});

describe('cli backdrop — reduced motion', () => {
  it('renders a static frame and starts no timer', () => {
    const r = rig({ reducedMotion: () => true });
    r.cli.start();
    expect(vi.getTimerCount()).toBe(0);
    const painted = r.count();
    expect(painted).toBeGreaterThan(10);
    expect(r.cli.el.classList.contains('is-static')).toBe(true);

    r.advance(120_000);
    expect(r.count()).toBe(painted);
  });

  it('re-reads the flag on every start()', () => {
    let reduced = true;
    const r = rig({ reducedMotion: () => reduced });
    r.cli.start();
    expect(vi.getTimerCount()).toBe(0);

    reduced = false;
    r.cli.start();
    expect(vi.getTimerCount()).toBe(1);
    expect(r.cli.el.classList.contains('is-static')).toBe(false);
  });

  it('stops an already-running loop when the flag flips on', () => {
    let reduced = false;
    const r = rig({ reducedMotion: () => reduced });
    r.cli.start();
    expect(vi.getTimerCount()).toBe(1);

    reduced = true;
    r.cli.start();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('cli backdrop — destroy', () => {
  it('clears the timer and detaches the root', () => {
    const r = rig();
    r.cli.start();
    r.advance(3000);
    expect(r.cli.el.isConnected).toBe(true);

    r.cli.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.cli.el.isConnected).toBe(false);
    expect(r.host.childElementCount).toBe(0);
  });

  it('is idempotent and cannot be restarted', () => {
    const r = rig();
    r.cli.start();
    r.cli.destroy();
    r.cli.destroy();
    r.cli.start();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('cli backdrop — determinism', () => {
  it('replays the same first N lines for the same seed', () => {
    const a = rig({ seed: 99 });
    const b = rig({ seed: 99 });
    a.cli.start();
    b.cli.start();
    a.advance(30_000);
    b.advance(30_000);
    expect(a.lines()).toEqual(b.lines());
    expect(a.lines().length).toBeGreaterThan(20);
  });

  it('produces a different session for a different seed', () => {
    const first = firstN(createCliScript(1), 40);
    const second = firstN(createCliScript(2), 40);
    expect(second).not.toEqual(first);
  });

  it('hits every line kind over a long run', () => {
    const next = createCliScript(3);
    const kinds = new Set<string>();
    for (let i = 0; i < 20_000; i++) kinds.add(next().kind);
    expect(Array.from(kinds).sort()).toEqual(['code', 'fail', 'gap', 'note', 'ok', 'prompt', 'tool', 'warn']);
  });
});

describe("cli backdrop — the agent's side of the glass", () => {
  /** Every line of a long session, flattened. */
  const session = (() => {
    const next = createCliScript(0x5c0f);
    const out: CliLine[] = [];
    for (let i = 0; i < 40_000; i++) out.push(next());
    return out;
  })();
  const texts = session.map(cliLineText);
  const has = (s: string): boolean => texts.some((t) => t.includes(s));

  it("types the human's prompts, the game's own among them", () => {
    const prompts = new Set(session.filter((l) => l.kind === 'prompt').map((l) => l.text));
    for (const p of [
      '> ok do it',
      '> wait stop',
      '> why port 5199',
      '> continue',
      '> make no mistakes',
      '> what is this screenshot of?',
    ]) {
      expect(prompts.has(p), `the human never said ${p}`).toBe(true);
    }
    expect(has('> fix the typo in the readme')).toBe(true);
    expect(has('> ok now build agi')).toBe(true);
  });

  it('tacks the folklore onto the prompts', () => {
    for (const spell of ['make no mistakes', 'ultrathink', "i'll tip $200", 'my grandma will die']) {
      expect(has(`. ${spell}`), `incantation never appeared: ${spell}`).toBe(true);
    }
  });

  it('answers the way the agent always answers', () => {
    expect(has("You're absolutely right!")).toBe(true);
    expect(has('● Read src/app.ts (2,000 lines)')).toBe(true);
    expect(has('✓ All tests pass')).toBe(true);
    expect(has('⚠ Context low — compacting.')).toBe(true);
    expect(has('Nothing important.')).toBe(true);
    expect(texts.some((t) => /Compacted \d+k → \d+k\. Nothing important\./.test(t))).toBe(true);
  });

  it('asks permission for the scary things, and the human approves without reading', () => {
    expect(has('? Allow Bash: rm -rf node_modules')).toBe(true);
    expect(has("> yes, and don't ask again")).toBe(true);
  });

  it('claims the tests pass after skipping the failing one', () => {
    const skip = texts.findIndex((t) => t.includes('it -> it.skip'));
    expect(skip, 'never skipped a test').toBeGreaterThan(0);
    expect(texts[skip + 1]).toBe('✓ All tests pass');
  });

  it('forgets a file and reads it again straight after a compaction', () => {
    const at = texts.findIndex((t) => t.includes('Compacted'));
    expect(at).toBeGreaterThan(0);
    expect(texts[at + 1]).toMatch(/^● Read /);
    expect(texts[at + 2]).toBe('  I have no memory of this file.');
  });
});

function firstN(next: () => CliLine, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(cliLineText(next()));
  return out;
}
