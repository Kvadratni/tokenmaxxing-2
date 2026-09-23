/**
 * The first-run tour: a spotlight over one thing at a time, with the clock
 * held, on the first NEW SESSION a browser ever presses.
 *
 * happy-dom has no layout engine, so where a test needs geometry it pins the
 * boxes it cares about (`pin`); everything else measures as zero and the tour
 * degrades to a card in the middle of the screen, which is exactly what it
 * should do with nothing to point at.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/sim/content.ts';
import type { GameEvent } from '../../src/sim/types.ts';
import { TID, tid } from '../../src/testids.ts';
import {
  box,
  intersects,
  mergeHoles,
  placeTooltip,
  shadeRects,
  TOUR_ADVANCE_MS,
  TOUR_CLICKS,
  TOUR_KEY,
  TOUR_PAD,
  TOUR_SETTLE_MS,
  TOUR_STEPS,
  type TourRect,
} from '../../src/ui/tour.ts';
import { TOUR_BODY_MAX, TOUR_TITLE_MAX } from '../../src/ui/tour-steps.ts';
import {
  isHidden,
  key,
  makeMeta,
  makeRun,
  makeSettings,
  memoryStorage,
  mountUI,
  must,
  q,
  unmountAll,
  type Mounted,
  type MountOpts,
} from './ui.fake-sim.ts';

const original = { w: window.innerWidth, h: window.innerHeight };

/** happy-dom reports `clientWidth` as 0, so the UI's viewport is `innerWidth` x `innerHeight`. */
function setViewport(vw: number, vh: number): void {
  (window as unknown as { innerWidth: number }).innerWidth = vw;
  (window as unknown as { innerHeight: number }).innerHeight = vh;
}

beforeEach(() => {
  vi.useFakeTimers();
  setViewport(1440, 900);
});

afterEach(() => {
  unmountAll();
  setViewport(original.w, original.h);
  vi.useRealTimers();
});

const CLICK: GameEvent = { t: 'click', amount: BALANCE.BASE_CLICK, x: 160, y: 120, crit: false, auto: false };

/**
 * A browser that has never seen the tour, on the title screen, with a host
 * that does what src/main.ts does with a stage click: the sim takes it and
 * says so.
 */
function fresh(o: MountOpts = {}): Mounted {
  return mountUI({
    screen: 'title',
    tour: 'fresh',
    onAction: (a, m) => {
      if (a.t !== 'canvasPointer' && a.t !== 'canvasKey') return;
      m.sim.run.clicks += 1;
      m.ui.handle(CLICK);
    },
    ...o,
  });
}

const tour = (m: Mounted): HTMLElement => must(m.root, TID.tour);
const isOpen = (m: Mounted): boolean => !isHidden(tour(m));
/** The id of the step on screen, off the tooltip's testid. */
const stepId = (m: Mounted): string | null => {
  if (!isOpen(m)) return null;
  const node = tour(m).querySelector<HTMLElement>(`[data-testid^="${TID.tourStep}-"]`);
  return node?.dataset['testid']?.slice(TID.tourStep.length + 1) ?? null;
};
const card = (m: Mounted): HTMLElement => must(m.root, tid(TID.tourStep, stepId(m) ?? ''));
const press = (m: Mounted, id: string): void => (must(m.root, id) as HTMLButtonElement).click();
const newSession = (m: Mounted): void => press(m, TID.startRun);
const indexOf = (id: string): number => TOUR_STEPS.findIndex((s) => s.id === id);

/** Next until `id` is on screen. */
function walkTo(m: Mounted, id: string): void {
  for (let i = 0; i < TOUR_STEPS.length && stepId(m) !== id; i++) press(m, TID.tourNext);
  expect(stepId(m)).toBe(id);
}

function clickAgent(m: Mounted): void {
  must(m.root, TID.agent).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
}

/** A key, from wherever focus is (the tour's card, normally). */
function pressKey(k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return key(document.activeElement ?? document.body, k, init);
}

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** Give an element a layout box, as a browser would. */
function pin(node: HTMLElement, r: DOMRect): void {
  node.getBoundingClientRect = () => r;
}

function pinSize(node: HTMLElement, w: number, h: number): void {
  Object.defineProperty(node, 'offsetWidth', { configurable: true, get: () => w });
  Object.defineProperty(node, 'offsetHeight', { configurable: true, get: () => h });
}

/** Where a pooled node was written, from its inline style. */
function placed(node: HTMLElement): TourRect {
  const n = (p: string): number => Number.parseFloat(node.style.getPropertyValue(p) || '0');
  return box(n('left'), n('top'), n('width'), n('height'));
}

const liveRings = (m: Mounted): HTMLElement[] =>
  Array.from(tour(m).querySelectorAll<HTMLElement>('.tm-tour__ring')).filter((n) => !n.hidden);
const liveShades = (m: Mounted): HTMLElement[] =>
  Array.from(tour(m).querySelectorAll<HTMLElement>('.tm-tour__shade')).filter((n) => !n.hidden);

// ---------------------------------------------------------------------------

describe('the first NEW SESSION opens on the tour', () => {
  it('shows over the run screen, holds the clock and takes focus', () => {
    const m = fresh();
    expect(isOpen(m)).toBe(false);
    expect(m.ui.holdsClock).toBe(false);
    newSession(m);
    expect(m.sent('startRun')).toHaveLength(1);
    expect(m.ui.screen).toBe('run');
    expect(isOpen(m)).toBe(true);
    expect(stepId(m)).toBe('intro');
    expect(m.ui.holdsClock).toBe(true);
    expect(document.activeElement).toBe(must(m.root, TID.tourNext));
    expect(card(m).getAttribute('role')).toBe('dialog');
    expect(card(m).getAttribute('aria-modal')).toBe('true');
    expect(card(m).textContent).toContain(`1/${TOUR_STEPS.length}`);
  });

  it('is finished by walking to the end, which persists "seen" in its own key', () => {
    const m = fresh();
    newSession(m);
    for (const [i, step] of TOUR_STEPS.entries()) {
      expect(stepId(m)).toBe(step.id);
      expect(card(m).textContent).toContain(`${i + 1}/${TOUR_STEPS.length}`);
      press(m, TID.tourNext);
    }
    expect(isOpen(m)).toBe(false);
    expect(m.ui.holdsClock).toBe(false);
    expect(m.storage.getItem(TOUR_KEY)).not.toBeNull();
    expect([...m.storage.data.keys()], 'nothing but its own key').toEqual([TOUR_KEY]);
    // Focus goes back to the board.
    expect(document.activeElement).toBe(must(m.root, TID.agent));
  });

  it('ends on "Start the session", with nothing left to skip', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'training');
    expect(must(m.root, TID.tourNext).textContent).toBe('Start the session');
    expect(isHidden(must(m.root, TID.tourSkip))).toBe(true);
  });

  it('persists "seen" on Skip, and on Escape', () => {
    const a = fresh();
    newSession(a);
    press(a, TID.tourNext);
    press(a, TID.tourSkip);
    expect(isOpen(a)).toBe(false);
    expect(a.storage.getItem(TOUR_KEY)).not.toBeNull();
    unmountAll();

    const b = fresh();
    newSession(b);
    const e = pressKey('Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(isOpen(b)).toBe(false);
    expect(b.ui.holdsClock).toBe(false);
    expect(b.storage.getItem(TOUR_KEY)).not.toBeNull();
  });

  it('only once: the next NEW SESSION goes straight to the board', () => {
    const m = fresh();
    newSession(m);
    press(m, TID.tourSkip);
    m.ui.setScreen('title');
    newSession(m);
    expect(m.ui.screen).toBe('run');
    expect(isOpen(m)).toBe(false);
    expect(m.ui.holdsClock).toBe(false);
    expect(document.activeElement).toBe(must(m.root, TID.agent));
  });

  it('remembers across page loads, through storage', () => {
    const storage = memoryStorage();
    const a = fresh({ storage });
    newSession(a);
    press(a, TID.tourSkip);
    unmountAll();
    const b = fresh({ storage });
    newSession(b);
    expect(isOpen(b)).toBe(false);
  });

  it('never opens for a browser that has seen it', () => {
    const m = mountUI({ screen: 'title' });
    newSession(m);
    expect(isOpen(m)).toBe(false);
    expect(m.ui.holdsClock).toBe(false);
  });

  it("opens from Training's NEW SESSION too", () => {
    const m = fresh({ screen: 'meta' });
    press(m, TID.metaStart);
    expect(m.ui.screen).toBe('run');
    expect(stepId(m)).toBe('intro');
  });

  it('is not "seen" if the run screen goes away under it: it comes back next time', () => {
    const m = fresh();
    newSession(m);
    m.ui.setScreen('title');
    expect(isOpen(m)).toBe(false);
    expect(m.ui.holdsClock).toBe(false);
    expect(m.storage.getItem(TOUR_KEY)).toBeNull();
    newSession(m);
    expect(stepId(m)).toBe('intro');
  });

  it('keeps going for this page when storage refuses the write', () => {
    const m = fresh({
      storage: Object.assign(memoryStorage(), {
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
    });
    newSession(m);
    expect(() => press(m, TID.tourSkip)).not.toThrow();
    m.ui.setScreen('title');
    newSession(m);
    expect(isOpen(m)).toBe(false);
  });
});

describe('Replay the tour, in How to play', () => {
  it('closes help and starts the tour on the run screen', () => {
    const m = mountUI();
    press(m, TID.helpButton);
    expect(isHidden(must(m.root, TID.helpModal))).toBe(false);
    press(m, TID.tourReplay);
    expect(isHidden(must(m.root, TID.helpModal))).toBe(true);
    expect(stepId(m)).toBe('intro');
    expect(m.ui.holdsClock).toBe(true);
    expect(m.sent('startRun'), 'the session on screen carries on').toHaveLength(0);
    expect(document.activeElement).toBe(must(m.root, TID.tourNext));
  });

  it('starts a session first from the title', () => {
    const m = mountUI({ screen: 'title' });
    press(m, TID.helpButton);
    press(m, TID.tourReplay);
    expect(m.sent('startRun')).toHaveLength(1);
    expect(m.ui.screen).toBe('run');
    expect(stepId(m)).toBe('intro');
    expect(m.ui.holdsClock).toBe(true);
  });

  it('replays from the top, mid-tour or after it', () => {
    const m = mountUI();
    press(m, TID.helpButton);
    press(m, TID.tourReplay);
    walkTo(m, 'context');
    m.ui.handle({ t: 'denied', reason: 'cost' }); // any event: nothing restarts it by accident
    expect(stepId(m)).toBe('context');
    press(m, TID.tourSkip);
    press(m, TID.helpButton);
    press(m, TID.tourReplay);
    expect(stepId(m)).toBe('intro');
  });
});

describe('the clock', () => {
  it('is held exactly while the tour is open', () => {
    const m = fresh();
    expect(m.ui.holdsClock).toBe(false);
    newSession(m);
    expect(m.ui.holdsClock).toBe(true);
    for (let i = 0; i < 5; i++) m.frame();
    expect(m.ui.holdsClock).toBe(true);
    walkTo(m, 'training');
    expect(m.ui.holdsClock).toBe(true);
    press(m, TID.tourNext);
    expect(m.ui.holdsClock).toBe(false);
  });
});

describe('keys and buttons', () => {
  it('Next and Back step through, and Back does nothing on the first step', () => {
    const m = fresh();
    newSession(m);
    expect((must(m.root, TID.tourBack) as HTMLButtonElement).disabled).toBe(true);
    press(m, TID.tourNext);
    expect(stepId(m)).toBe(TOUR_STEPS[1]!.id);
    expect((must(m.root, TID.tourBack) as HTMLButtonElement).disabled).toBe(false);
    press(m, TID.tourBack);
    expect(stepId(m)).toBe(TOUR_STEPS[0]!.id);
    // Back went disabled under focus: focus is handed to Next, not dropped.
    expect(document.activeElement).toBe(must(m.root, TID.tourNext));
  });

  it('→ and Enter go forward, ← goes back', () => {
    const m = fresh();
    newSession(m);
    expect(pressKey('ArrowRight').defaultPrevented).toBe(true);
    expect(stepId(m)).toBe(TOUR_STEPS[1]!.id);
    // Enter anywhere but on one of the tour's own buttons (those activate themselves).
    card(m).focus();
    expect(pressKey('Enter').defaultPrevented).toBe(true);
    expect(stepId(m)).toBe(TOUR_STEPS[2]!.id);
    pressKey('ArrowLeft');
    pressKey('ArrowLeft');
    expect(stepId(m)).toBe(TOUR_STEPS[0]!.id);
  });

  it('Enter on a focused tour button is left to the button', () => {
    const m = fresh();
    newSession(m);
    must(m.root, TID.tourNext).focus();
    const e = pressKey('Enter');
    expect(e.defaultPrevented).toBe(false);
    expect(stepId(m)).toBe('intro');
  });

  it('Esc skips', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'patience');
    pressKey('Escape');
    expect(isOpen(m)).toBe(false);
  });

  it('Space never presses a tour button: off the interactive step it does nothing', () => {
    const m = fresh();
    newSession(m);
    const e = pressKey(' ');
    expect(e.defaultPrevented).toBe(true);
    expect(stepId(m)).toBe('intro');
    expect(m.sent('canvasKey')).toHaveLength(0);
  });

  it('holds the game hotkeys while it is open', () => {
    const m = fresh({ run: makeRun({ tokens: 10_000 }) });
    newSession(m);
    for (const k of ['s', 'y', '1', 'c']) pressKey(k);
    expect(m.sent('report')).toHaveLength(0);
    expect(m.sent('absolutelyRight')).toHaveLength(0);
    expect(m.sent('buyTool')).toHaveLength(0);
    expect(m.sent('compact')).toHaveLength(0);
    press(m, TID.tourSkip);
    pressKey('y');
    expect(m.sent('absolutelyRight')).toHaveLength(1);
  });

  it('traps Tab inside the card, both ways', () => {
    const m = fresh();
    newSession(m);
    press(m, TID.tourNext); // Back is live from step 2
    const skip = must(m.root, TID.tourSkip);
    const next = must(m.root, TID.tourNext);
    next.focus();
    expect(key(next, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(skip);
    expect(key(skip, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(next);
  });

  it('pulls focus back when something outside takes it', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    // A click on the agent focuses it (stage.ts); the card takes focus back.
    clickAgent(m);
    expect(card(m).contains(document.activeElement)).toBe(true);
    // And Tab from anywhere outside lands in the card.
    must(m.root, TID.optionsButton).focus();
    expect(card(m).contains(document.activeElement)).toBe(true);
  });

  it('a press on the dim does nothing', () => {
    const m = fresh();
    newSession(m);
    const shade = liveShades(m)[0]!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    shade.dispatchEvent(down);
    expect(down.defaultPrevented, 'and does not blur the card').toBe(true);
    expect(stepId(m)).toBe('intro');
  });
});

describe('"This is you": the interactive step', () => {
  const agentStep = TOUR_STEPS[indexOf('agent')]!;

  it('asks for three clicks, with a live counter', () => {
    expect(agentStep.clicks).toBe(TOUR_CLICKS);
    expect(TOUR_CLICKS).toBe(3);
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    expect(card(m).textContent).toContain(`Try it: 0/${TOUR_CLICKS}.`);
    clickAgent(m);
    clickAgent(m);
    expect(m.sent('canvasPointer'), 'clicks take the normal path').toHaveLength(2);
    expect(card(m).textContent).toContain(`2/${TOUR_CLICKS}`);
    expect(stepId(m)).toBe('agent');
  });

  it('moves on by itself a beat after the third click', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    for (let i = 0; i < TOUR_CLICKS; i++) clickAgent(m);
    expect(card(m).textContent).toContain(`${TOUR_CLICKS}/${TOUR_CLICKS}`);
    expect(stepId(m), '"3/3" stays up for a beat').toBe('agent');
    vi.advanceTimersByTime(TOUR_ADVANCE_MS);
    expect(stepId(m)).toBe('tokens');
    expect(m.sim.run.clicks).toBe(TOUR_CLICKS);
  });

  it('counts Space the same way: it generates, through the host', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    pressKey(' ');
    pressKey(' ', { repeat: true }); // held down: one press, not two
    expect(m.sent('canvasKey')).toHaveLength(1);
    expect(card(m).textContent).toContain(`1/${TOUR_CLICKS}`);
  });

  it('counts only what the sim took from the player, not automation', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    m.ui.handle({ ...CLICK, auto: true } as GameEvent);
    expect(card(m).textContent).toContain(`0/${TOUR_CLICKS}`);
  });

  it('Next works on it too, and Back into it starts the count over', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    clickAgent(m);
    press(m, TID.tourNext);
    expect(stepId(m)).toBe('tokens');
    press(m, TID.tourBack);
    expect(stepId(m)).toBe('agent');
    expect(card(m).textContent).toContain(`0/${TOUR_CLICKS}`);
  });

  it('a Next during the beat does not skip a step', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    for (let i = 0; i < TOUR_CLICKS; i++) clickAgent(m);
    press(m, TID.tourNext);
    expect(stepId(m)).toBe('tokens');
    vi.advanceTimersByTime(TOUR_ADVANCE_MS * 2);
    expect(stepId(m)).toBe('tokens');
  });
});

describe('what each step lights up', () => {
  const WANT: Record<string, readonly string[]> = {
    intro: [],
    agent: [TID.agent],
    tokens: [TID.tokens],
    prompt: [TID.promptNum, TID.promptText, TID.reportBar],
    patience: [TID.patienceBar],
    context: [TID.contextBar],
    compaction: [TID.contextBar],
    tools: [TID.toolList],
    sycophancy: [TID.sycophancyButton],
    claim: [TID.reportButton],
    cards: [TID.activeCards],
    training: [],
  };

  it('twelve steps, in order, each on the right testids', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(Object.keys(WANT));
    const m = fresh();
    newSession(m);
    for (const step of TOUR_STEPS) {
      expect(stepId(m)).toBe(step.id);
      const on = (tour(m).dataset['targets'] ?? '').split(' ').filter(Boolean);
      expect(on, step.id).toEqual(WANT[step.id]);
      for (const id of on) expect(q(m.root, id), `${step.id} points at ${id}, which exists`).not.toBeNull();
      press(m, TID.tourNext);
    }
  });

  it('the prompt step is the prompt line and the report bar, each its own cut-out', () => {
    const prompt = TOUR_STEPS[indexOf('prompt')]!;
    expect(prompt.targets).toEqual([[TID.promptNum, TID.promptText], [TID.reportBar]]);
  });

  it('the context step adds the stage floor, where the pile is', () => {
    const m = fresh();
    newSession(m);
    pin(must(m.root, TID.contextBar), rect(300, 140, 700, 27));
    pin(must(m.root, TID.scene), rect(90, 235, 960, 540));
    walkTo(m, 'context');
    const rings = liveRings(m).map(placed);
    expect(rings).toHaveLength(2);
    const floor = rings[1]!;
    // Bottom of the canvas, clear of the prompt line under it.
    expect(floor.bottom).toBeLessThanOrEqual(235 + 540);
    expect(floor.top).toBeGreaterThan(235 + 540 / 2);
    expect(floor.width).toBeGreaterThan(900);
  });

  it('fits its copy budget: a one-line title, and one to three lines of body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length, `${step.id}: "${step.title}"`).toBeLessThanOrEqual(TOUR_TITLE_MAX);
      const body = step.body.replace('{clicks}', `${TOUR_CLICKS}/${TOUR_CLICKS}`);
      expect(body.length, `${step.id}: "${body}"`).toBeLessThanOrEqual(TOUR_BODY_MAX);
    }
  });

  it('copy reads its numbers out of content.ts', () => {
    const body = (id: string): string => TOUR_STEPS[indexOf(id)]!.body;
    expect(body('context')).toContain(`${BALANCE.BASE_CONTEXT / 1000}K`);
    expect(body('compaction')).toContain(`${Math.round(BALANCE.COMPACT_KEEP_FORCED * 100)}%`);
    expect(body('compaction')).toContain(`all but ${BALANCE.BASE_SUMMARY_SLOTS} prompt card`);
    expect(body('claim')).toContain(`${Math.round(BALANCE.CLAIM_THRESHOLD * 100)}%`);
  });
});

describe('the spotlight', () => {
  it('cuts out its target and never covers it: not the dim, not the ring, not the card', () => {
    const m = fresh();
    newSession(m);
    const bar = rect(320, 147, 720, 27);
    pin(must(m.root, TID.patienceBar).parentElement!, bar);
    walkTo(m, 'patience');
    pinSize(card(m), 296, 150);
    m.ui.resize();
    window.dispatchEvent(new Event('resize'));
    const target = box(bar.left, bar.top, bar.width, bar.height);
    const [ring] = liveRings(m).map(placed);
    expect(ring).toEqual(box(320 - TOUR_PAD, 147 - TOUR_PAD, 720 + 2 * TOUR_PAD, 27 + 2 * TOUR_PAD));
    for (const s of liveShades(m).map(placed)) expect(intersects(s, ring!), 'a shade over the cut-out').toBe(false);
    const tip = box(placed(card(m)).left, placed(card(m)).top, 296, 150);
    expect(intersects(tip, target), 'the card over its own target').toBe(false);
    expect(card(m).dataset['side']).toBe('below');
  });

  it('with nothing to point at, dims the whole screen and centres the card', () => {
    const m = fresh();
    newSession(m);
    expect(liveRings(m)).toHaveLength(0);
    const shades = liveShades(m).map(placed);
    expect(shades).toEqual([box(0, 0, 1440, 900)]);
    expect(card(m).dataset['side']).toBe('center');
  });

  it('pulses, unless motion is reduced', () => {
    const m = fresh();
    newSession(m);
    m.frame();
    expect(tour(m).hasAttribute('data-pulse')).toBe(true);
    m.sim.meta.settings = makeSettings({ reducedMotion: true });
    m.frame();
    expect(tour(m).hasAttribute('data-pulse')).toBe(false);
  });

  it('starts still under reduced motion', () => {
    const m = fresh({ meta: makeMeta({ settings: makeSettings({ reducedMotion: true }) }) });
    newSession(m);
    m.frame();
    expect(tour(m).hasAttribute('data-pulse')).toBe(false);
  });
});

describe('it follows the layout', () => {
  it('re-places on resize, and on a frame where its target moved', () => {
    const m = fresh();
    newSession(m);
    const bar = must(m.root, TID.contextBar);
    pin(bar, rect(300, 140, 700, 27));
    walkTo(m, 'compaction');
    expect(placed(liveRings(m)[0]!).left).toBe(300 - TOUR_PAD);

    pin(bar, rect(16, 213, 359, 18));
    setViewport(390, 844);
    window.dispatchEvent(new Event('resize'));
    const r = placed(liveRings(m)[0]!);
    expect([r.left, r.top, r.width]).toEqual([16 - TOUR_PAD, 213 - TOUR_PAD, 359 + 2 * TOUR_PAD]);
    // The dim tiles the new viewport.
    const area = liveShades(m).map(placed).reduce((s, x) => s + x.width * x.height, 0);
    expect(area).toBe(390 * 844 - r.width * r.height);

    // No event at all: the next frame notices on its own.
    pin(bar, rect(40, 100, 300, 18));
    m.frame();
    expect(placed(liveRings(m)[0]!).left).toBe(40 - TOUR_PAD);
  });

  it('writes nothing on a frame where nothing moved', () => {
    const m = fresh();
    newSession(m);
    pin(must(m.root, TID.contextBar), rect(300, 140, 700, 27));
    walkTo(m, 'context');
    m.frame();
    const obs = new MutationObserver(() => undefined);
    obs.observe(tour(m), { subtree: true, childList: true, attributes: true, characterData: true });
    for (let i = 0; i < 30; i++) m.frame();
    const records = obs.takeRecords();
    obs.disconnect();
    expect(records).toHaveLength(0);
  });
});

describe('the shop drawer', () => {
  it('opens for the tools step where the shop is a drawer, and shuts after it', () => {
    setViewport(844, 390);
    const m = fresh();
    expect(m.ui.el.hasAttribute('data-shop-drawer')).toBe(true);
    newSession(m);
    walkTo(m, 'tools');
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(true);
    expect(must(m.root, TID.shop).hasAttribute('inert')).toBe(false);
    // The card keeps focus: the drawer did not take it.
    expect(card(m).contains(document.activeElement)).toBe(true);
    press(m, TID.tourNext);
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(false);
    press(m, TID.tourBack);
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(true);
    pressKey('Escape');
    expect(isOpen(m)).toBe(false);
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(false);
  });

  it('holds the card, unpressable, until the sheet has finished sliding', () => {
    setViewport(844, 390);
    const m = fresh();
    newSession(m);
    walkTo(m, 'tools');
    expect(tour(m).hasAttribute('data-settling')).toBe(true);
    expect(card(m).contains(document.activeElement), 'waiting does not cost it focus').toBe(true);
    vi.advanceTimersByTime(TOUR_SETTLE_MS);
    expect(tour(m).hasAttribute('data-settling')).toBe(false);
    // And again on the way out, as the sheet slides back down.
    press(m, TID.tourNext);
    expect(tour(m).hasAttribute('data-settling')).toBe(true);
    pressKey('Escape');
    expect(tour(m).hasAttribute('data-settling')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait under reduced motion: nothing slides', () => {
    setViewport(844, 390);
    const m = fresh({ meta: makeMeta({ settings: makeSettings({ reducedMotion: true }) }) });
    newSession(m);
    walkTo(m, 'tools');
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(true);
    expect(tour(m).hasAttribute('data-settling')).toBe(false);
  });

  it('shuts one left open before the tour replays over it', () => {
    setViewport(844, 390);
    const m = mountUI();
    press(m, TID.shopToggle);
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(true);
    press(m, TID.helpButton);
    press(m, TID.tourReplay);
    expect(stepId(m)).toBe('intro');
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(false);
  });

  it('follows a rotation mid-step: rail to drawer', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'tools');
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(false);
    setViewport(844, 390);
    m.ui.resize();
    expect(m.ui.el.hasAttribute('data-shop-drawer')).toBe(true);
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(true);
  });

  it('leaves an in-flow shop alone', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'tools');
    expect(m.ui.el.hasAttribute('data-shop-drawer')).toBe(false);
    expect(m.ui.el.hasAttribute('data-shop-open')).toBe(false);
  });
});

describe('the coach waits for it', () => {
  it('shows no tip while the tour is open, then teaches as usual', () => {
    const m = fresh({ run: makeRun({ context: BALANCE.BASE_CONTEXT * 0.25 }) });
    newSession(m);
    for (let i = 0; i < 3; i++) m.frame();
    expect(m.root.querySelector(`[data-testid^="${TID.coachTip}-"]`)).toBeNull();
    press(m, TID.tourSkip);
    m.frame();
    expect(q(m.root, tid(TID.coachTip, 'context'))).not.toBeNull();
  });

  it('takes down a tip that was already up when it replays', () => {
    const m = mountUI({ run: makeRun({ context: BALANCE.BASE_CONTEXT * 0.25 }) });
    expect(q(m.root, tid(TID.coachTip, 'context'))).not.toBeNull();
    press(m, TID.helpButton);
    press(m, TID.tourReplay);
    expect(m.root.querySelector(`[data-testid^="${TID.coachTip}-"]`)).toBeNull();
  });
});

describe('destroy', () => {
  it('takes the layer, its listeners and its timer with it', () => {
    const m = fresh();
    newSession(m);
    walkTo(m, 'agent');
    for (let i = 0; i < TOUR_CLICKS; i++) clickAgent(m);
    const before = m.actions.length;
    m.ui.destroy();
    expect(m.root.querySelector(`[data-testid="${TID.tour}"]`)).toBeNull();
    expect(() => key(window, 'Escape')).not.toThrow();
    expect(() => key(window, ' ')).not.toThrow();
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
    expect(() => vi.advanceTimersByTime(TOUR_ADVANCE_MS * 2)).not.toThrow();
    expect(m.actions.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe('shadeRects', () => {
  const area = (rs: readonly TourRect[]): number => rs.reduce((s, r) => s + r.width * r.height, 0);

  it('tiles everything but the cut-outs, with no overlap', () => {
    const holes = [box(300, 140, 700, 30), box(100, 640, 900, 100)];
    const shades = shadeRects(1440, 900, holes);
    expect(area(shades)).toBe(1440 * 900 - area(holes));
    for (const s of shades) for (const h of holes) expect(intersects(s, h)).toBe(false);
    for (let i = 0; i < shades.length; i++) {
      for (let j = i + 1; j < shades.length; j++) expect(intersects(shades[i]!, shades[j]!)).toBe(false);
    }
  });

  it('is four panels around one cut-out', () => {
    expect(shadeRects(1000, 800, [box(100, 100, 200, 50)])).toHaveLength(4);
  });

  it('clips a cut-out that runs off the screen', () => {
    const shades = shadeRects(844, 390, [box(-5, 217, 854, 200)]);
    expect(area(shades)).toBe(844 * 217);
  });
});

describe('mergeHoles', () => {
  it('merges cut-outs that nearly touch, and keeps far ones apart', () => {
    expect(mergeHoles([box(0, 0, 100, 20), box(0, 22, 100, 20)])).toEqual([box(0, 0, 100, 42)]);
    expect(mergeHoles([box(300, 140, 700, 30), box(100, 640, 900, 100)])).toHaveLength(2);
    expect(mergeHoles([box(0, 0, 50, 50), box(25, 25, 50, 50)])).toEqual([box(0, 0, 75, 75)]);
  });
});

describe('placeTooltip', () => {
  const W = 296;
  const H = 150;
  const inView = (p: { left: number; top: number }, vw: number, vh: number): boolean =>
    p.left >= 0 && p.top >= 0 && p.left + W <= vw && p.top + H <= vh;

  it('centres with nothing lit', () => {
    expect(placeTooltip([], W, H, 1440, 900)).toEqual({ left: 572, top: 375, side: 'center' });
  });

  it('prefers the side it is asked for, and flips when there is no room', () => {
    const agent = box(487, 548, 166, 190);
    expect(placeTooltip([agent], W, H, 1440, 900, 'above').side).toBe('above');
    const high = box(487, 40, 166, 100);
    expect(placeTooltip([high], W, H, 1440, 900, 'above').side).toBe('below');
  });

  it('flips to fit a short screen: a bar near the bottom gets it above', () => {
    const report = box(483, 259, 357, 54);
    const p = placeTooltip([report], W, H, 844, 390);
    expect(p.side).toBe('above');
    expect(inView(p, 844, 390)).toBe(true);
    expect(intersects(box(p.left, p.top, W, H), report)).toBe(false);
  });

  it('steers clear of every cut-out, not just the first', () => {
    const bar = box(319, 142, 736, 37);
    const floor = box(108, 637, 924, 99);
    const p = placeTooltip([bar, floor], W, H, 1440, 900);
    for (const c of [bar, floor]) expect(intersects(box(p.left, p.top, W, H), c)).toBe(false);
  });

  it('finds a free spot when no side fits', () => {
    // A drawer across the whole width and most of a landscape phone.
    const list = box(0, 150, 844, 240);
    const p = placeTooltip([list], W, 130, 844, 390);
    expect(p.top + 130).toBeLessThanOrEqual(150);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });

  it('stays on screen whatever it is given', () => {
    for (const [vw, vh] of [
      [390, 844],
      [844, 390],
      [1440, 900],
      [320, 568],
    ] as const) {
      for (const a of [box(0, 0, 50, 50), box(vw - 60, vh - 60, 60, 60), box(10, vh / 2, vw - 20, 30)]) {
        const p = placeTooltip([a], Math.min(W, vw - 16), H, vw, vh);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.left + Math.min(W, vw - 16)).toBeLessThanOrEqual(vw);
        expect(p.top + H).toBeLessThanOrEqual(vh);
      }
    }
  });
});
