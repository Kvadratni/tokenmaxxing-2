import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioEngine, GameEvent, SceneKey, SfxName } from '@sim/types.ts';
import {
  createMockFactory,
  MockAudioContext,
  type MockFactory,
  type MockGain,
} from '@audio/mock-context.ts';
import { attachUnlockOnFirstGesture, createAudioEngine, COALESCE_MS, SFX_VOICE_CAP } from '@audio/engine.ts';

const ALL_SFX: readonly SfxName[] = [
  'click',
  'clickCrit',
  'buy',
  'denied',
  'ship',
  'draftOpen',
  'draftPick',
  'reroll',
  'incidentBad',
  'incidentGood',
  'incidentClear',
  'warn',
  'lose',
  'win',
  'uiHover',
  'metaBuy',
];

const SCENE_KEYS: readonly SceneKey[] = ['bedroom', 'coworking', 'openplan', 'datacenter', 'orbital'];

/** One of every `GameEvent` variant. */
const ALL_EVENTS: readonly GameEvent[] = [
  { t: 'click', amount: 1, x: 10, y: 10, crit: false, auto: false },
  { t: 'click', amount: 9, x: 10, y: 10, crit: true, auto: false },
  { t: 'buyAgent', id: 'cli_agent', cost: 10, owned: 1 },
  { t: 'buyUpgrade', id: 'faster_fingers', cost: 10 },
  { t: 'ship', projectIndex: 0, demos: 2, timeLeftMs: 1000 },
  { t: 'draftOpen', offer: ['a', 'b'] },
  { t: 'draftPick', id: 'a' },
  { t: 'draftReroll' },
  { t: 'incidentStart', id: 'outage', tone: 'bad' },
  { t: 'incidentStart', id: 'hype', tone: 'good' },
  { t: 'incidentEnd', id: 'outage' },
  { t: 'incidentProgress', id: 'outage', clicksRemaining: 3 },
  { t: 'deadlineWarn', secondsLeft: 9 },
  { t: 'runOver', won: true, demos: 5, shipped: 3 },
  { t: 'runOver', won: false, demos: 1, shipped: 0 },
  { t: 'metaBuy', id: 'nootropics', level: 2, cost: 4 },
  { t: 'runStart', seed: 1234 },
  { t: 'denied', reason: 'cost' },
];

/** Locate the music/sfx buses by their wiring, not by creation index. */
function buses(ctx: MockAudioContext): { master: MockGain; music: MockGain; sfx: MockGain } {
  const master = ctx.created.gains[0];
  if (!master) throw new Error('no master gain');
  const children = ctx.created.gains.filter((g) => g.outputs.includes(master));
  const [music, sfx] = children;
  if (!music || !sfx) throw new Error('bus gains missing');
  return { master, music, sfx };
}

function musicLayers(ctx: MockAudioContext): MockGain[] {
  const { music } = buses(ctx);
  return ctx.created.gains.filter((g) => g.outputs.includes(music));
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

let engines: AudioEngine[] = [];

function make(opts: Parameters<typeof createAudioEngine>[0] = {}): AudioEngine {
  const e = createAudioEngine(opts);
  engines.push(e);
  return e;
}

beforeEach(() => {
  engines = [];
});

afterEach(() => {
  for (const e of engines) {
    try {
      e.destroy();
    } catch {
      /* already destroyed */
    }
  }
  engines = [];
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('headless safety', () => {
  it('never constructs a context at module load or at construction time', () => {
    const f = createMockFactory();
    make({ contextFactory: f.factory });
    expect(f.count).toBe(0);
  });

  it('is a total no-op with no WebAudio available at all', async () => {
    // happy-dom ships no AudioContext, so detection genuinely finds nothing.
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const engine = make();

    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.unlocked).toBe(false);

    expect(() => {
      for (const e of ALL_EVENTS) engine.handle(e);
      for (const s of ALL_SFX) engine.play(s);
      for (const s of SCENE_KEYS) engine.setScene(s);
      engine.setTension(0.5);
      engine.setVolumes({ music: 1, sfx: 1 });
      engine.destroy();
    }).not.toThrow();
    expect(engine.unlocked).toBe(false);
  });

  it('stays silent when the factory is explicitly null', async () => {
    const engine = make({ contextFactory: null });
    await engine.unlock();
    expect(engine.unlocked).toBe(false);
    expect(() => engine.play('ship')).not.toThrow();
  });

  it('stays silent when the factory throws', async () => {
    const engine = make({
      contextFactory: () => {
        throw new Error('autoplay blocked');
      },
    });
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(engine.unlocked).toBe(false);
  });

  it('stays silent when the factory returns an unusable context', async () => {
    const engine = make({ contextFactory: () => ({}) as unknown as AudioContext });
    await engine.unlock();
    expect(engine.unlocked).toBe(false);
  });

  it('remains inert after destroy()', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory });
    await engine.unlock();
    engine.destroy();

    const before = f.latest().sources().length;
    for (const e of ALL_EVENTS) engine.handle(e);
    engine.play('win');
    engine.setScene('orbital');
    engine.setTension(1);
    engine.setVolumes({ music: 1, sfx: 1 });
    expect(f.latest().sources()).toHaveLength(before);
    expect(engine.unlocked).toBe(false);
    expect(() => engine.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('unlock', () => {
  let f: MockFactory;

  beforeEach(() => {
    f = createMockFactory();
  });

  it('creates the context exactly once when called repeatedly', async () => {
    const engine = make({ contextFactory: f.factory });
    await engine.unlock();
    await engine.unlock();
    await engine.unlock();
    expect(f.count).toBe(1);
    expect(engine.unlocked).toBe(true);
  });

  it('creates the context exactly once when called concurrently', async () => {
    const engine = make({ contextFactory: f.factory });
    await Promise.all([engine.unlock(), engine.unlock(), engine.unlock(), engine.unlock()]);
    expect(f.count).toBe(1);
    expect(engine.unlocked).toBe(true);
  });

  it('resumes the context and builds the master limiter', async () => {
    const engine = make({ contextFactory: f.factory });
    await engine.unlock();
    const ctx = f.latest();
    expect(ctx.resumeCount).toBe(1);
    expect(ctx.state).toBe('running');
    expect(ctx.created.compressors).toHaveLength(1);
    const limiter = ctx.created.compressors[0]!;
    expect(limiter.outputs).toContain(ctx.destination);
    expect(limiter.threshold.value).toBeLessThan(0);
  });

  it('routes both buses through the master and the limiter', async () => {
    const engine = make({ contextFactory: f.factory });
    await engine.unlock();
    const ctx = f.latest();
    const { master, music, sfx } = buses(ctx);
    expect(music.outputs).toContain(master);
    expect(sfx.outputs).toContain(master);
    expect(master.outputs).toContain(ctx.created.compressors[0]!);
  });

  it('allows a retry after a failed unlock', async () => {
    let fail = true;
    const engine = make({
      contextFactory: () => {
        if (fail) throw new Error('nope');
        return f.factory();
      },
    });
    await engine.unlock();
    expect(engine.unlocked).toBe(false);
    fail = false;
    await engine.unlock();
    expect(engine.unlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('event routing', () => {
  const cases: ReadonlyArray<readonly [GameEvent, SfxName]> = [
    [{ t: 'click', amount: 1, x: 0, y: 0, crit: false, auto: false }, 'click'],
    [{ t: 'click', amount: 1, x: 0, y: 0, crit: true, auto: false }, 'clickCrit'],
    [{ t: 'buyAgent', id: 'agi', cost: 1, owned: 1 }, 'buy'],
    [{ t: 'buyUpgrade', id: 'u1', cost: 1 }, 'buy'],
    [{ t: 'denied', reason: 'cost' }, 'denied'],
    [{ t: 'denied', reason: 'locked' }, 'denied'],
    [{ t: 'denied', reason: 'phase' }, 'denied'],
    [{ t: 'metaBuy', id: 'm1', level: 1, cost: 1 }, 'metaBuy'],
    [{ t: 'ship', projectIndex: 2, demos: 1, timeLeftMs: 5 }, 'ship'],
    [{ t: 'runOver', won: true, demos: 1, shipped: 1 }, 'win'],
    [{ t: 'runOver', won: false, demos: 0, shipped: 0 }, 'lose'],
    [{ t: 'draftOpen', offer: ['a'] }, 'draftOpen'],
    [{ t: 'draftPick', id: 'a' }, 'draftPick'],
    [{ t: 'draftReroll' }, 'reroll'],
    [{ t: 'incidentStart', id: 'i', tone: 'bad' }, 'incidentBad'],
    [{ t: 'incidentStart', id: 'i', tone: 'good' }, 'incidentGood'],
    [{ t: 'incidentEnd', id: 'i' }, 'incidentClear'],
    [{ t: 'deadlineWarn', secondsLeft: 3 }, 'warn'],
  ];

  for (const [event, sfx] of cases) {
    const label = event.t === 'click' ? `click(crit=${String(event.crit)})` : event.t;
    it(`${label} -> ${sfx}`, () => {
      const engine = make({ contextFactory: null });
      const spy = vi.spyOn(engine, 'play');
      engine.handle(event);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(sfx);
    });
  }

  it('stays silent on purely informational events', () => {
    const engine = make({ contextFactory: null });
    const spy = vi.spyOn(engine, 'play');
    engine.handle({ t: 'incidentProgress', id: 'i', clicksRemaining: 2 });
    engine.handle({ t: 'runStart', seed: 7 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('covers every GameEvent variant without throwing', () => {
    const engine = make({ contextFactory: null });
    const kinds = new Set(ALL_EVENTS.map((e) => e.t));
    expect(kinds.size).toBe(15);
    expect(() => {
      for (const e of ALL_EVENTS) engine.handle(e);
    }).not.toThrow();
  });

  it('resets the click streak on runStart', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0 });
    await engine.unlock();
    const ctx = f.latest();

    for (let i = 0; i < 4; i++) engine.handle({ t: 'click', amount: 1, x: 0, y: 0, crit: false, auto: false });
    const climbed = ctx.created.oscillators.map((o) => o.frequency.calls[0]?.args[0] ?? 0);
    expect(climbed[3]!).toBeGreaterThan(climbed[0]!);

    engine.handle({ t: 'runStart', seed: 1 });
    engine.handle({ t: 'click', amount: 1, x: 0, y: 0, crit: false, auto: false });
    const after = ctx.created.oscillators[4]!.frequency.calls[0]!.args[0]!;
    expect(after).toBeCloseTo(climbed[0]!, 6);
  });
});

// ---------------------------------------------------------------------------

describe('voice budget and rate limiting', () => {
  it('caps the oscillators created by 200 SFX in one tick', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0 });
    await engine.unlock();
    const ctx = f.latest();

    for (let i = 0; i < 200; i++) engine.play('click');

    expect(ctx.created.oscillators.length).toBeLessThanOrEqual(SFX_VOICE_CAP);
    expect(ctx.created.oscillators.length).toBe(SFX_VOICE_CAP);
    for (const s of ctx.sources()) {
      expect(s.startCalls).toHaveLength(1);
      expect(s.stopCalls).toHaveLength(1);
    }
  });

  it('recovers the budget once voices have ended', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0 });
    await engine.unlock();
    const ctx = f.latest();

    for (let i = 0; i < 200; i++) engine.play('click');
    expect(ctx.created.oscillators).toHaveLength(SFX_VOICE_CAP);

    ctx.advance(2);
    for (let i = 0; i < 5; i++) engine.play('click');
    expect(ctx.created.oscillators.length).toBe(SFX_VOICE_CAP + 5);
  });

  it('coalesces identical non-click SFX inside the window', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0 });
    await engine.unlock();
    const ctx = f.latest();

    engine.play('uiHover');
    const first = ctx.created.oscillators.length;
    engine.play('uiHover');
    engine.play('uiHover');
    expect(ctx.created.oscillators).toHaveLength(first);

    ctx.advance(COALESCE_MS / 1000 + 0.005);
    engine.play('uiHover');
    expect(ctx.created.oscillators.length).toBeGreaterThan(first);
  });

  it('never coalesces clicks — they stay 1:1 with input', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0 });
    await engine.unlock();
    const ctx = f.latest();
    for (let i = 0; i < 6; i++) engine.play('click');
    expect(ctx.created.oscillators).toHaveLength(6);
  });

  it('does not coalesce different SFX with each other', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0 });
    await engine.unlock();
    const ctx = f.latest();
    engine.play('uiHover');
    engine.play('draftPick');
    expect(ctx.created.oscillators.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------

describe('volumes', () => {
  it('ramps rather than jumping, so there is no zipper noise', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.5, sfx: 0.5 });
    await engine.unlock();
    const ctx = f.latest();
    const { music, sfx } = buses(ctx);

    engine.setVolumes({ music: 1, sfx: 1 });
    for (const g of [music, sfx]) {
      const ramps = g.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime');
      expect(ramps.length).toBeGreaterThan(0);
      // Ramp lands in the future, not at the current instant.
      expect(ramps[ramps.length - 1]!.args[1]!).toBeGreaterThan(ctx.currentTime);
    }
  });

  it('silences both buses at volume 0 and halts the music scheduler', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.7, sfx: 0.9 });
    await engine.unlock();
    const ctx = f.latest();
    const { music, sfx } = buses(ctx);
    expect(music.gain.value).toBeGreaterThan(0);
    expect(sfx.gain.value).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(1);

    engine.setVolumes({ music: 0, sfx: 0 });

    expect(music.gain.value).toBe(0);
    expect(sfx.gain.value).toBe(0);
    for (const layer of musicLayers(ctx)) expect(layer.gain.value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // And no SFX work is done while muted.
    const before = ctx.sources().length;
    for (let i = 0; i < 20; i++) engine.play('click');
    expect(ctx.sources()).toHaveLength(before);
  });

  it('restarts the scheduler when music volume comes back up', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.7, sfx: 0.9 });
    await engine.unlock();
    engine.setVolumes({ music: 0, sfx: 0 });
    expect(vi.getTimerCount()).toBe(0);

    engine.setVolumes({ music: 0.8, sfx: 0.8 });
    expect(vi.getTimerCount()).toBe(1);
    expect(buses(f.latest()).music.gain.value).toBeGreaterThan(0);
  });

  it('never starts the scheduler when music is muted from the outset', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0, sfx: 1 });
    await engine.unlock();
    expect(vi.getTimerCount()).toBe(0);
    expect(buses(f.latest()).music.gain.value).toBe(0);
  });

  it('clamps out-of-range volumes', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory });
    await engine.unlock();
    engine.setVolumes({ music: 12, sfx: -3 });
    const { music, sfx } = buses(f.latest());
    expect(music.gain.value).toBeGreaterThan(0);
    expect(music.gain.value).toBeLessThanOrEqual(1);
    expect(sfx.gain.value).toBe(0);
  });

  it('accepts volume changes before unlock and applies them after', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory });
    engine.setVolumes({ music: 0, sfx: 1 });
    await engine.unlock();
    const { music, sfx } = buses(f.latest());
    expect(music.gain.value).toBe(0);
    expect(sfx.gain.value).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('scene and tension', () => {
  it('accepts setScene/setTension before unlock and applies them afterwards', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.8 });

    expect(() => {
      engine.setScene('orbital');
      engine.setTension(0.95);
    }).not.toThrow();

    await engine.unlock();
    const ctx = f.latest();

    // Drive the scheduler for a while with a moving clock.
    for (let i = 0; i < 80; i++) {
      ctx.advance(0.025);
      vi.advanceTimersByTime(25);
    }

    // Orbital bass is a saw; bedroom's is a triangle.
    expect(ctx.created.oscillators.some((o) => o.type === 'sawtooth')).toBe(true);
    // High tension => the hat layer is well above its idle floor.
    const layers = musicLayers(ctx);
    expect(layers).toHaveLength(3);
    expect(layers[2]!.gain.value).toBeGreaterThan(0.1);
  });

  it('accepts every SceneKey after unlock', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.5 });
    await engine.unlock();
    expect(() => {
      for (const s of SCENE_KEYS) engine.setScene(s);
    }).not.toThrow();
  });

  it('clamps tension into 0..1', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0 });
    await engine.unlock();
    expect(() => {
      engine.setTension(-5);
      engine.setTension(5);
      engine.setTension(Number.NaN);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('tab visibility', () => {
  it('pauses the scheduler when the tab hides and resumes when it returns', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.8 });
    await engine.unlock();
    expect(vi.getTimerCount()).toBe(1);

    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);

    setHidden(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(engine.unlocked).toBe(true);
  });

  it('does not resume while music is muted', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.8 });
    await engine.unlock();
    engine.setVolumes({ music: 0, sfx: 1 });
    setHidden(true);
    setHidden(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts suspended when unlocked on a hidden tab', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.8 });
    await engine.unlock();
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('detaches the listener on destroy', async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(document, 'removeEventListener');
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.8 });
    await engine.unlock();
    engine.destroy();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(() => setHidden(true)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can opt out of visibility handling', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.8, handleVisibility: false });
    await engine.unlock();
    setHidden(true);
    expect(vi.getTimerCount()).toBe(1);
    expect(engine.unlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('destroy', () => {
  it('clears every pending timer and closes the context', async () => {
    vi.useFakeTimers();
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory, music: 0.8, sfx: 0.8 });
    await engine.unlock();

    const ctx = f.latest();
    for (let i = 0; i < 20; i++) {
      ctx.advance(0.025);
      vi.advanceTimersByTime(25);
    }
    engine.play('ship');
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    engine.destroy();

    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.closeCount).toBe(1);
    expect(ctx.state).toBe('closed');
    expect(engine.unlocked).toBe(false);

    // Nothing wakes back up.
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is idempotent', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory });
    await engine.unlock();
    engine.destroy();
    engine.destroy();
    expect(f.latest().closeCount).toBe(1);
  });

  it('is safe before unlock', () => {
    const engine = make({ contextFactory: createMockFactory().factory });
    expect(() => engine.destroy()).not.toThrow();
  });

  it('ignores an unlock that lands after destroy', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory });
    const pending = engine.unlock();
    engine.destroy();
    await pending;
    expect(engine.unlocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('attachUnlockOnFirstGesture', () => {
  it('unlocks on the first pointer gesture and then detaches', async () => {
    const f = createMockFactory();
    const engine = make({ contextFactory: f.factory });
    const detach = attachUnlockOnFirstGesture(engine, window);

    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.count).toBe(1);

    window.dispatchEvent(new Event('keydown'));
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(f.count).toBe(1);
    expect(() => detach()).not.toThrow();
  });

  it('also listens for keyboard and touch', async () => {
    for (const type of ['keydown', 'touchstart'] as const) {
      const f = createMockFactory();
      const engine = make({ contextFactory: f.factory });
      attachUnlockOnFirstGesture(engine, window);
      window.dispatchEvent(new Event(type));
      await Promise.resolve();
      await Promise.resolve();
      expect(f.count, type).toBe(1);
    }
  });

  it('returns a harmless disposer when there is no event target', () => {
    const engine = make({ contextFactory: null });
    const detach = attachUnlockOnFirstGesture(engine, null);
    expect(() => detach()).not.toThrow();
  });
});
