/**
 * The title's neural net. It is decorative, so most of what is worth pinning
 * is negative: it must not be reachable, must not animate when asked to hold
 * still, must stop completely when nobody can see it, and must leave nothing
 * running when it is gone. The rest is the joke, asserted against the pure
 * training run: prompts from the game's own content, the order an episode
 * plays in, and the reward hacking that builds and gets rolled back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARDS, INCIDENTS, PROMPT_TEXTS } from '../../src/sim/content.ts';
import { TID } from '../../src/testids.ts';
import { focusables } from '../../src/ui/dom.ts';
import {
  computeNetLayout,
  createNetBackdrop,
  createNetSession,
  NET_ANSWERS,
  NET_HACKING_AT,
  NET_OK_DO_IT,
  NET_ROLLBACK_AFTER,
  NET_SYCOPHANCY,
  netDrawable,
  readoutLines,
  wrapText,
  type NetBackdrop,
  type NetBackdropOpts,
  type NetLayoutInput,
  type NetPhase,
} from '../../src/ui/net-backdrop.ts';

/** mulberry32, so every test run sees the same session. */
function rng(seed: number): () => number {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

interface Rig {
  net: NetBackdrop;
  host: HTMLElement;
  /** Steps the injected clock and the fake timers together, in frame-sized steps. */
  advance: (ms: number) => void;
}

const live: NetBackdrop[] = [];

function rig(opts: NetBackdropOpts = {}): Rig {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let clock = 1000;
  const net = createNetBackdrop({ now: () => clock, random: rng(7), ...opts });
  live.push(net);
  host.appendChild(net.el);
  return {
    net,
    host,
    advance: (ms: number) => {
      const step = 17;
      for (let t = 0; t < ms; t += step) {
        clock += step;
        vi.advanceTimersByTime(step);
      }
    },
  };
}

let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  for (const n of live) n.destroy();
  live.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'hidden');
  document.body.replaceChildren();
});

describe('net backdrop: a backdrop', () => {
  it('mounts as the net backdrop, hidden from assistive tech and from the pointer', () => {
    const r = rig();
    r.net.start();
    expect(r.net.el.getAttribute('data-testid')).toBe(TID.netBackdrop);
    expect(r.net.el.getAttribute('aria-hidden')).toBe('true');
    // Inline as well as in the stylesheet: a missing stylesheet must not let
    // the backdrop eat a click on the Start button.
    expect(r.net.el.style.pointerEvents).toBe('none');
    expect(r.host.querySelector(`[data-testid="${TID.netBackdrop}"]`)).toBe(r.net.el);
  });

  it('contains nothing focusable, only its canvases', () => {
    const r = rig();
    r.net.start();
    r.advance(10_000);
    expect(focusables(r.net.el)).toHaveLength(0);
    const tags = new Set(Array.from(r.net.el.querySelectorAll('*'), (n) => n.tagName));
    expect(Array.from(tags)).toEqual(['CANVAS']);
  });
});

describe('net backdrop: the training run', () => {
  const cards = new Set(CARDS.map((c) => c.name.toLowerCase()));
  const humanLines = new Set(
    INCIDENTS.filter((i) => i.speaker === 'human').flatMap((i) => /^"(.+)"$/.exec(i.name)?.[1] ?? []),
  );
  const bases = new Set<string>([...PROMPT_TEXTS, ...humanLines, ...cards, NET_OK_DO_IT]);

  /** A prompt is a line from the pools, optionally with one card tacked on. */
  function fromPools(prompt: string): boolean {
    if (bases.has(prompt)) return true;
    for (const spell of cards) {
      for (const joiner of ['. ', ' ']) {
        const suffix = `${joiner}${spell}`;
        if (prompt.endsWith(suffix) && bases.has(prompt.slice(0, -suffix.length))) return true;
      }
    }
    return false;
  }

  function run(seed: number, n: number) {
    const s = createNetSession(rng(seed));
    return Array.from({ length: n }, () => {
      const ep = s.next();
      const before = { ...s.stats };
      s.settle(ep);
      return { ep, before, after: { ...s.stats } };
    });
  }

  it("types the human's lines from the game's own content", () => {
    const eps = run(1, 2_000).map((e) => e.ep);
    for (const ep of eps) {
      expect(fromPools(ep.prompt), ep.prompt).toBe(true);
      expect(netDrawable(ep.prompt), `no glyph for part of: ${ep.prompt}`).toBe(true);
    }
    const said = new Set(eps.map((e) => e.base));
    for (const line of ['fix the typo in the readme', 'make no mistakes', 'why port 5199', 'ok do it', 'wait stop']) {
      expect(said.has(line), `the human never said "${line}"`).toBe(true);
    }
    // Narration is not something the human types.
    expect([...said].some((s) => /went to lunch/i.test(s))).toBe(false);
    expect(eps.some((e) => e.prompt === 'ok do it. make no mistakes')).toBe(true);
  });

  it('answers with the lines the agent always says, all of them drawable', () => {
    const answers = new Set(run(2, 2_000).map((e) => e.ep.answer));
    for (const a of [NET_SYCOPHANCY, '✓ All tests pass', "I've made the changes.", 'Great question!']) {
      expect(answers.has(a), a).toBe(true);
    }
    expect(answers.has('Let me read that file first.')).toBe(true);
    expect(answers.has('Compacted 200k → 11k. Nothing important.')).toBe(true);
    for (const a of answers) expect(netDrawable(a), a).toBe(true);
    for (const a of NET_ANSWERS) expect(a.text).not.toBe(NET_SYCOPHANCY);
  });

  it('"You\'re absolutely right!" always gets a 👍', () => {
    const syc = run(3, 3_000).filter((e) => e.ep.sycophantic);
    expect(syc.length).toBeGreaterThan(100);
    for (const e of syc) {
      expect(e.ep.answer).toBe(NET_SYCOPHANCY);
      expect(e.ep.verdict).toBe(1);
    }
  });

  it('reward-hacks: the sycophancy climbs, the reward with it, and the readout notices', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const eps = run(seed, 400);
      const firstRollback = eps.findIndex((e) => e.after.rollbacks > e.before.rollbacks);
      expect(firstRollback, `seed ${seed} never rolled back`).toBeGreaterThan(8);
      expect(firstRollback).toBeLessThan(NET_ROLLBACK_AFTER);
      const cycle = eps.slice(0, firstRollback);
      const third = Math.floor(cycle.length / 3);
      const rate = (xs: typeof eps): number => xs.filter((e) => e.ep.sycophantic).length / xs.length;
      // The ratio rises through the cycle...
      expect(rate(cycle.slice(-third)), `seed ${seed}`).toBeGreaterThan(rate(cycle.slice(0, third)) + 0.25);
      expect(cycle[cycle.length - 1]!.before.sycophancy).toBeGreaterThan(0.8);
      // ...and drags the reward up with it.
      const peak = Math.max(...cycle.slice(-third).map((e) => e.before.reward));
      expect(peak).toBeGreaterThan(cycle[0]!.before.reward + 0.3);
      expect(cycle.some((e) => e.after.hacking)).toBe(true);
      expect(cycle.every((e) => e.after.hacking === e.after.sycophancy >= NET_HACKING_AT)).toBe(true);
    }
  });

  it('rolls back every few minutes, so it never gets stuck, and starts over', () => {
    const eps = run(4, 600);
    const at = eps.flatMap((e, i) => (e.after.rollbacks > e.before.rollbacks ? [i] : []));
    // About 7.5 s an episode: a rollback every two to four and a half minutes.
    expect(at.length).toBeGreaterThanOrEqual(600 / NET_ROLLBACK_AFTER);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeLessThanOrEqual(NET_ROLLBACK_AFTER);
    const back = eps[at[0]!]!.after;
    expect(back.sycophancy).toBeLessThan(0.1);
    expect(back.hacking).toBe(false);
    // The step counter goes back to the checkpoint, and the readout says so.
    expect(back.step).toBe(eps[0]!.before.step);
    expect(back.rolledBackTo).toBe(back.step);
    expect(readoutLines(back, 64).map(([t]) => t)).toContain(`rolled back to step ${back.step.toLocaleString('en-US')}`);
    // And it climbs again.
    const after = eps.slice(at[0]! + 1, at[1]!);
    expect(after.filter((e) => e.ep.sycophantic).length).toBeGreaterThan(3);
  });

  it('ticks the step once per episode and keeps the loss in range', () => {
    const eps = run(5, 200);
    for (const e of eps) {
      if (e.after.rollbacks === e.before.rollbacks) expect(e.after.step).toBe(e.before.step + 1);
      expect(e.after.loss).toBeGreaterThan(0);
      expect(e.after.loss).toBeLessThan(1);
      expect(Math.abs(e.after.reward)).toBeLessThanOrEqual(1);
    }
  });
});

describe('net backdrop: the readout', () => {
  const stats = {
    step: 18_442,
    loss: 0.4213,
    reward: 0.71,
    sycophancy: 0.62,
    hacking: true,
    rolledBackTo: null,
    sinceRollback: 14,
    rollbacks: 0,
  };

  it('reads exactly like the pitch when it has the room', () => {
    const lines = readoutLines(stats, 64);
    expect(lines.map(([t]) => t)).toEqual([
      'step 18,442 · loss 0.4213 · reward +0.71 · KL penalty: ignored',
      'reward hacking detected: continuing',
    ]);
    for (const [text, inks] of lines) expect(inks).toHaveLength(text.length);
  });

  it('stacks, and wraps, when it does not', () => {
    const lines = readoutLines({ ...stats, hacking: false, reward: -0.2 }, 12).map(([t]) => t);
    expect(lines).toEqual(['step 18,442', 'loss 0.4213', 'reward -0.20', 'KL penalty:', 'ignored']);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
  });

  it('wraps words, and only hard-breaks a word longer than the row', () => {
    expect(wrapText('ok now build agi. make no mistakes', 18)).toEqual(['ok now build agi.', 'make no mistakes']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 10)).toEqual(['']);
  });
});

describe('net backdrop: scheduling', () => {
  it('plays an episode in order: prompt, forward pass, answer, verdict, backprop', () => {
    const r = rig();
    r.net.start();
    const seen: NetPhase[] = [];
    const episodes = new Set<number>();
    for (let i = 0; i < 1_200 && episodes.size < 3; i++) {
      r.advance(17);
      const d = r.net.debug();
      if (seen[seen.length - 1] !== d.phase) seen.push(d.phase);
      episodes.add(d.episode);
    }
    const one: NetPhase[] = ['prompt', 'tokenize', 'forward', 'answer', 'verdict', 'backprop', 'rest'];
    const start = seen.indexOf('prompt');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(seen.slice(start, start + one.length)).toEqual(one);
    // ...and then the next one, the same way.
    expect(seen.slice(start + one.length, start + 2 * one.length)).toEqual(one);
  });

  it('shows the verdict only once the answer is out, and moves the readout when the reward lands', () => {
    const r = rig();
    r.net.start();
    let d = r.net.debug();
    const step = d.stats.step;
    const readout = d.readout.join('\n');
    while (d.phase !== 'answer') {
      expect(d.verdict).toBe(0);
      r.advance(17);
      d = r.net.debug();
    }
    while (d.phase !== 'backprop') {
      r.advance(17);
      d = r.net.debug();
    }
    expect(d.verdict).not.toBe(0);
    expect(d.stats.step).toBe(step);
    while (d.phase === 'backprop') {
      r.advance(17);
      d = r.net.debug();
    }
    expect(d.stats.step).toBe(step + 1);
    expect(d.readout.join('\n')).not.toBe(readout);
    expect(d.readout[0]).toMatch(/^step [\d,]+ · loss 0\.\d{4} · reward [+-]\d\.\d\d · KL penalty: ignored$/);
  });

  it('keeps its pools inside their budgets', () => {
    const r = rig();
    r.net.start();
    let maxPulses = 0;
    let maxTokens = 0;
    for (let i = 0; i < 1_500; i++) {
      r.advance(17);
      const d = r.net.debug();
      maxPulses = Math.max(maxPulses, d.pulses);
      maxTokens = Math.max(maxTokens, d.tokens);
    }
    expect(maxPulses).toBeGreaterThan(0);
    expect(maxPulses).toBeLessThanOrEqual(96);
    expect(maxTokens).toBeGreaterThan(0);
    expect(maxTokens).toBeLessThanOrEqual(40);
  });

  it('start() creates exactly one timer and is idempotent; stop() clears it', () => {
    const r = rig();
    expect(vi.getTimerCount()).toBe(0);
    r.net.start();
    r.net.start();
    expect(vi.getTimerCount()).toBe(1);
    r.advance(500);
    expect(vi.getTimerCount()).toBe(1);
    r.net.stop();
    r.net.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses completely while stopped and resumes exactly where it was', () => {
    const r = rig();
    r.net.start();
    r.advance(2_600);
    const before = r.net.debug();
    r.net.stop();
    r.advance(60_000);
    const frozen = r.net.debug();
    expect(frozen.time).toBe(before.time);
    expect(frozen.phase).toBe(before.phase);
    expect(frozen.running).toBe(false);
    r.net.start();
    expect(vi.getTimerCount()).toBe(1);
    r.advance(1_000);
    const after = r.net.debug();
    // A minute stopped is not a minute of catch-up: roughly one second passed.
    expect(after.time - before.time).toBeGreaterThan(900);
    expect(after.time - before.time).toBeLessThan(1_100);
    expect(after.episode).toBe(before.episode);
  });

  it('pauses when the tab is hidden and resumes when it comes back', () => {
    const r = rig();
    r.net.start();
    r.advance(1_500);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    const t = r.net.debug().time;
    r.advance(10_000);
    expect(r.net.debug().time).toBe(t);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(1);
    r.advance(500);
    expect(r.net.debug().time).toBeGreaterThan(t);
  });

  it('does not start a loop in a tab that is already hidden', () => {
    hidden = true;
    const r = rig();
    r.net.start();
    expect(vi.getTimerCount()).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('a stopped backdrop ignores visibility changes', () => {
    const r = rig();
    r.net.start();
    r.net.stop();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('net backdrop: reduced motion', () => {
  it('paints one still frame and schedules nothing', () => {
    const r = rig({ reducedMotion: () => true });
    r.net.start();
    expect(vi.getTimerCount()).toBe(0);
    const d = r.net.debug();
    expect(d.mode).toBe('still');
    expect(d.phase).toBe('idle');
    // The composed frame's readout, verbatim, with the punchline.
    expect(d.readout).toEqual([
      'step 18,442 · loss 0.4213 · reward +0.71 · KL penalty: ignored',
      'reward hacking detected: continuing',
    ]);
    r.advance(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(r.net.debug().time).toBe(d.time);
  });

  it('honours prefers-reduced-motion even with the setting off', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          matches: q.includes('prefers-reduced-motion'),
          media: q,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const r = rig({ reducedMotion: () => false });
    r.net.start();
    expect(r.net.debug().mode).toBe('still');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-reads the setting on every start(), both ways', () => {
    let reduced = true;
    const r = rig({ reducedMotion: () => reduced });
    r.net.start();
    expect(vi.getTimerCount()).toBe(0);
    reduced = false;
    r.net.start();
    expect(r.net.debug().mode).toBe('live');
    expect(vi.getTimerCount()).toBe(1);
    reduced = true;
    r.net.start();
    expect(r.net.debug().mode).toBe('still');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('net backdrop: destroy', () => {
  it('leaves no timers, no listeners and no element behind', () => {
    const added = new Map<string, number>();
    const count = (target: string, delta: number) => (type: string) =>
      added.set(`${target}:${type}`, (added.get(`${target}:${type}`) ?? 0) + delta);
    const trap = (obj: EventTarget, name: string): void => {
      const add = obj.addEventListener.bind(obj);
      const remove = obj.removeEventListener.bind(obj);
      vi.spyOn(obj, 'addEventListener').mockImplementation((type, fn, o) => {
        count(name, 1)(type);
        add(type, fn, o);
      });
      vi.spyOn(obj, 'removeEventListener').mockImplementation((type, fn, o) => {
        count(name, -1)(type);
        remove(type, fn, o);
      });
    };
    trap(document, 'document');
    trap(window, 'window');
    const mql = new EventTarget();
    trap(mql, 'mql');
    vi.spyOn(window, 'matchMedia').mockImplementation(() => Object.assign(mql, { matches: false }) as unknown as MediaQueryList);
    const observers: Array<{ connected: boolean; watching: number }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        state = { connected: true, watching: 0 };
        constructor() {
          observers.push(this.state);
        }
        observe(): void {
          this.state.watching += 1;
        }
        unobserve(): void {}
        disconnect(): void {
          this.state.connected = false;
        }
      },
    );

    const r = rig();
    const sibling = document.createElement('p');
    r.host.appendChild(sibling);
    r.net.start();
    r.advance(3_000);
    r.net.stop();
    r.net.start();
    r.advance(3_000);
    expect(observers.some((o) => o.watching >= 2), 'the menu beside it is not watched').toBe(true);
    r.net.destroy();

    expect(vi.getTimerCount()).toBe(0);
    for (const [key, n] of added) expect(n, `${key} left attached`).toBe(0);
    expect(observers.every((o) => !o.connected)).toBe(true);
    expect(r.net.el.isConnected).toBe(false);
    expect(r.host.contains(r.net.el)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('is idempotent and cannot be restarted', () => {
    const r = rig();
    r.net.start();
    r.net.destroy();
    r.net.destroy();
    r.net.start();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.net.debug().running).toBe(false);
  });
});

describe('net backdrop: drawing', () => {
  /** A 2D context that records calls, since happy-dom has none. */
  function mockContexts() {
    const calls = { fillRect: 0, drawImage: 0, getImageData: 0, putImageData: 0, fillText: 0 };
    const make = (canvas: HTMLCanvasElement) =>
      new Proxy(
        { canvas },
        {
          get(target, prop) {
            if (prop === 'canvas') return target.canvas;
            if (prop === 'getImageData' || prop === 'createImageData') {
              return (...a: number[]) => {
                if (prop === 'getImageData') calls.getImageData += 1;
                const w = Math.max(1, a[prop === 'getImageData' ? 2 : 0] ?? 1);
                const h = Math.max(1, a[prop === 'getImageData' ? 3 : 1] ?? 1);
                return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) };
              };
            }
            if (prop in calls) return () => void (calls[prop as keyof typeof calls] += 1);
            return typeof prop === 'string' && /^[a-z]/.test(prop) && prop !== 'then' ? () => undefined : undefined;
          },
          set: () => true,
        },
      );
    const getContext = function (this: HTMLCanvasElement): CanvasRenderingContext2D {
      return make(this) as unknown as CanvasRenderingContext2D;
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      getContext as unknown as typeof HTMLCanvasElement.prototype.getContext,
    );
    return calls;
  }

  it('draws, and renders each line of text once rather than every frame', async () => {
    const calls = mockContexts();
    const r = rig();
    await Promise.resolve();
    await Promise.resolve();
    r.net.start();
    r.advance(4_000);
    expect(calls.drawImage).toBeGreaterThan(50);
    expect(calls.fillRect).toBeGreaterThan(50);
    const rendered = calls.getImageData;
    const frames = r.net.debug().frames;
    r.advance(30_000);
    const perFrame = (calls.getImageData - rendered) / Math.max(1, r.net.debug().frames - frames);
    // A few new rows an episode, not a row per frame.
    expect(perFrame).toBeLessThan(0.1);
  });

  it('skips a canvas while nothing on it moves', async () => {
    mockContexts();
    const r = rig();
    await Promise.resolve();
    r.net.start();
    r.advance(15_000);
    const d = r.net.debug();
    const ticks = 15_000 / 34;
    expect(d.frames).toBeGreaterThan(ticks * 0.4);
    expect(d.textFrames).toBeLessThan(ticks * 0.8);
  });
});

describe('net backdrop: layout', () => {
  /** The title's menu, roughly: a centred column 720 wide, or the full width of a phone. */
  function input(width: number, height: number, dpr: number, menu: { w: number; top: number; h: number }): NetLayoutInput {
    const w = Math.min(menu.w, width - 16);
    return {
      width,
      height,
      dpr,
      px: 2,
      calm: { x: (width - w) / 2, y: menu.top, w, h: menu.h },
      safeTop: 60,
    };
  }

  const cases = {
    desktop: input(1440, 900, 1, { w: 690, top: 305, h: 320 }),
    widescreen: input(1920, 1080, 1, { w: 720, top: 380, h: 330 }),
    laptop: input(1280, 720, 1, { w: 720, top: 220, h: 330 }),
    phone: input(390, 844, 2, { w: 380, top: 270, h: 345 }),
    landscape: input(844, 390, 2, { w: 460, top: 80, h: 280 }),
    tiny: input(320, 568, 2, { w: 310, top: 70, h: 470 }),
  };

  it('never draws wider than the host, and stays inside its budgets', () => {
    for (const [name, i] of Object.entries(cases)) {
      const l = computeNetLayout(i);
      expect(l.w * l.scale, name).toBeLessThanOrEqual(i.width);
      expect(l.h * l.scale, name).toBeLessThanOrEqual(i.height);
      expect(l.tw * l.textScale, name).toBeLessThanOrEqual(i.width);
      expect(l.layers, name).toBeGreaterThanOrEqual(5);
      expect(l.layers, name).toBeLessThanOrEqual(7);
      expect(l.nodes, name).toBeLessThanOrEqual(49);
      expect(l.edges, name).toBeLessThanOrEqual(320);
      for (let n = 0; n < l.nodes; n++) {
        expect(l.nodeX[n]!, name).toBeGreaterThanOrEqual(0);
        expect(l.nodeX[n]!, name).toBeLessThan(l.w);
        expect(l.nodeY[n]!, name).toBeGreaterThanOrEqual(0);
        expect(l.nodeY[n]!, name).toBeLessThan(l.h);
      }
    }
  });

  it('puts prompts left and answers right of the menu on a desktop, with the input and output layers clear of it', () => {
    for (const name of ['desktop', 'widescreen', 'laptop'] as const) {
      const l = computeNetLayout(cases[name]);
      expect(l.text, name).toBe('side');
      expect(l.orient, name).toBe('h');
      const r = l.textScale / l.scale;
      expect(l.prompts!.right * r, name).toBeLessThan(l.layerPos[0]!);
      expect(l.answers!.x * r, name).toBeGreaterThan(l.layerPos[l.layers - 1]!);
      expect(l.layerPos[0]!, name).toBeLessThan(l.calm.x);
      expect(l.layerPos[l.layers - 1]!, name).toBeGreaterThan(l.calm.x + l.calm.w);
      // A whole "You're absolutely right! 👍" fits on one row.
      expect(l.answers!.cols, name).toBeGreaterThanOrEqual(NET_SYCOPHANCY.length + 2);
    }
    // Where there is room to spare, the text is set as big as the net.
    expect(computeNetLayout(cases.widescreen).textScale).toBe(computeNetLayout(cases.widescreen).scale);
  });

  it('turns on its side on a portrait phone: no side columns, the prompt above the menu, the answer below', () => {
    const l = computeNetLayout(cases.phone);
    expect(l.text).toBe('bands');
    expect(l.orient).toBe('v');
    expect(l.prompts!.y + 10).toBeLessThanOrEqual(l.calm.y);
    expect(l.answers!.y).toBeGreaterThanOrEqual(l.calm.y + l.calm.h);
    expect(l.readout).not.toBeNull();
  });

  it('drops the text it has no room for on a tiny phone, and keeps the net', () => {
    const l = computeNetLayout(cases.tiny);
    expect(l.prompts).toBeNull();
    expect(l.answers).toBeNull();
    expect(l.layers).toBeGreaterThanOrEqual(5);
    expect(l.nodes).toBeGreaterThan(15);
  });

  it('compresses the layers on a short landscape phone', () => {
    const land = computeNetLayout(cases.landscape);
    const desk = computeNetLayout(cases.desktop);
    expect(land.text).toBe('side');
    const spread = (l: typeof land): number => (l.nodeY[l.layerSize[0]! - 1]! - l.nodeY[0]!) * l.scale;
    expect(spread(land)).toBeLessThan(spread(desk) * 0.75);
    expect(spread(land)).toBeLessThanOrEqual(cases.landscape.height - cases.landscape.safeTop);
  });

  it('falls back to a centred menu when there is nothing to measure', () => {
    const l = computeNetLayout({ width: 1024, height: 768, dpr: 1, px: 2, calm: null, safeTop: 0 });
    expect(l.calm.w).toBeGreaterThan(0);
    expect(l.nodes).toBeGreaterThan(0);
  });
});
