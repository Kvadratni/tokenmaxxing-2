import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE, INCIDENTS, INCIDENT_BY_ID } from '@sim/content.ts';
import type { AudioEngine, GameEvent, SceneKey, SfxName } from '@sim/types.ts';
import {
  createMockFactory,
  MockAudioContext,
  type MockFactory,
  type MockGain,
} from '@audio/mock-context.ts';
import {
  attachUnlockOnFirstGesture,
  contextUrgency,
  createAudioEngine,
  incidentSfx,
  sycophancyThinness,
  AUTO_CLICK_GAP_MS,
  AUTO_CRIT_GAP_MS,
  COALESCE_MS,
  INCIDENT_SFX,
  SFX_VOICE_CAP,
} from '@audio/engine.ts';
import type { AnySfxName } from '@audio/sfx.ts';
import { mtof } from '@audio/synth.ts';

/** Every member of the frozen `SfxName` union. The Record type rejects a missing or a stray name. */
const SFX_SET: Record<SfxName, true> = {
  click: true,
  clickCrit: true,
  oneShot: true,
  buy: true,
  denied: true,
  report: true,
  claim: true,
  caught: true,
  compact: true,
  compactForced: true,
  sycophancy: true,
  draftOpen: true,
  draftPick: true,
  reroll: true,
  incidentBad: true,
  incidentGood: true,
  incidentClear: true,
  interrupt: true,
  permission: true,
  warn: true,
  contextWarn: true,
  lose: true,
  win: true,
  uiHover: true,
  metaBuy: true,
  achievement: true,
};
const ALL_SFX = Object.keys(SFX_SET) as SfxName[];

const SCENE_KEYS: readonly SceneKey[] = ['bedroom', 'coworking', 'openplan', 'datacenter', 'orbital'];

type EventOf<K extends GameEvent['t']> = Extract<GameEvent, { readonly t: K }>;

/** One of every `GameEvent` kind. The mapped type rejects a missing or a stray kind. */
const ONE_OF_EACH: { readonly [K in GameEvent['t']]: EventOf<K> } = {
  click: { t: 'click', amount: 3, x: 10, y: 10, crit: false, auto: false },
  oneShot: { t: 'oneShot', amount: 500, seconds: 5 },
  buyTool: { t: 'buyTool', id: 'grep', cost: 15, owned: 1 },
  buyUpgrade: { t: 'buyUpgrade', id: 'u1', cost: 100 },
  report: { t: 'report', promptIndex: 0, thumbs: 1, patienceLeft: 0.6 },
  claim: { t: 'claim', promptIndex: 1, caught: false, verifyChance: 0.4, spent: 900 },
  compactStart: { t: 'compactStart', forced: true, kept: 250, lost: 750 },
  compactEnd: { t: 'compactEnd', keptCards: ['a'], droppedCards: ['b'] },
  sycophancy: { t: 'sycophancy', restored: 0.06, heat: 1 },
  draftOpen: { t: 'draftOpen', offer: ['a', 'b', 'c'] },
  draftPick: { t: 'draftPick', id: 'a' },
  draftReroll: { t: 'draftReroll' },
  incidentStart: { t: 'incidentStart', id: 'overloaded', tone: 'bad' },
  incidentEnd: { t: 'incidentEnd', id: 'overloaded' },
  incidentProgress: { t: 'incidentProgress', id: 'continue', clicksRemaining: 3 },
  pickupSpawn: { t: 'pickupSpawn', id: 'golden_token', x: 40, y: 60 },
  pickupCollect: { t: 'pickupCollect', id: 'golden_token', x: 40, y: 60 },
  pickupExpire: { t: 'pickupExpire', id: 'golden_token' },
  patienceWarn: { t: 'patienceWarn', secondsLeft: 9 },
  contextWarn: { t: 'contextWarn', fill: 0.8 },
  runOver: { t: 'runOver', won: true, thumbs: 14, reported: 10 },
  metaBuy: { t: 'metaBuy', id: 'pretraining', level: 2, cost: 4 },
  runStart: { t: 'runStart', seed: 1234 },
  achievement: { t: 'achievement', id: 'first_report' },
  toolLost: { t: 'toolLost', id: 'bash', owned: 2 },
  legacyImport: { t: 'legacyImport', verdict: 'clean', gift: 5, cheater: false },
  denied: { t: 'denied', reason: 'cost' },
};

function click(crit: boolean, auto: boolean): GameEvent {
  return { t: 'click', amount: 3, x: 0, y: 0, crit, auto };
}

function incident(id: string, tone: 'bad' | 'good'): GameEvent {
  return { t: 'incidentStart', id, tone };
}

/** Every kind, plus the variants that take a different branch. */
const ALL_EVENTS: readonly GameEvent[] = [
  ...Object.values(ONE_OF_EACH),
  click(true, false),
  click(false, true),
  click(true, true),
  { t: 'claim', promptIndex: 1, caught: true, verifyChance: 0.6, spent: 900 },
  { t: 'compactStart', forced: false, kept: 500, lost: 500 },
  incident('wait_stop', 'bad'),
  { t: 'incidentStart', id: 'bash_permission', tone: 'bad', tool: 'bash' },
  incident('lunch', 'good'),
  { t: 'runOver', won: false, thumbs: 2, reported: 3 },
  { t: 'legacyImport', verdict: 'forged', gift: 0, cheater: true },
  { t: 'toolLost', id: 'mcp_server', owned: 0 },
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

/** An unlocked engine on a mock context with the score muted, so only SFX make nodes. */
async function sfxRig(): Promise<{ engine: AudioEngine; ctx: MockAudioContext }> {
  const f = createMockFactory();
  const engine = make({ contextFactory: f.factory, music: 0 });
  await engine.unlock();
  return { engine, ctx: f.latest() };
}

/** What one `handle()` call cost: voices started and their summed peak gain. */
function measure(ctx: MockAudioContext, fire: () => void): { voices: number; level: number } {
  const sources = ctx.sources().length;
  const gains = ctx.created.gains.length;
  fire();
  const level = ctx.created.gains
    .slice(gains)
    .map((g) => Math.max(0, ...g.gain.targets()))
    .reduce((a, b) => a + b, 0);
  return { voices: ctx.sources().length - sources, level };
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
    // happy-dom has no AudioContext, so detection genuinely finds nothing.
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
    expect(() => engine.play('report')).not.toThrow();
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

  it('plays every sound once unlocked', async () => {
    const { engine, ctx } = await sfxRig();
    for (const name of ALL_SFX) {
      ctx.advance(1);
      const { voices } = measure(ctx, () => engine.play(name));
      expect(voices, name).toBeGreaterThan(0);
    }
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
  const cases: ReadonlyArray<readonly [string, GameEvent, AnySfxName]> = [
    ['click', click(false, false), 'click'],
    ['crit click', click(true, false), 'clickCrit'],
    ['automated click', click(false, true), 'click'],
    ['automated crit', click(true, true), 'clickCrit'],
    ['oneShot', ONE_OF_EACH.oneShot, 'oneShot'],
    ['buyTool', ONE_OF_EACH.buyTool, 'buy'],
    ['buyUpgrade', ONE_OF_EACH.buyUpgrade, 'buy'],
    ['denied (cost)', { t: 'denied', reason: 'cost' }, 'denied'],
    ['denied (thumbs)', { t: 'denied', reason: 'thumbs' }, 'denied'],
    ['denied (locked)', { t: 'denied', reason: 'locked' }, 'denied'],
    ['denied (phase)', { t: 'denied', reason: 'phase' }, 'denied'],
    ['metaBuy', ONE_OF_EACH.metaBuy, 'metaBuy'],
    ['achievement', ONE_OF_EACH.achievement, 'achievement'],
    ['legacyImport (clean save)', { t: 'legacyImport', verdict: 'clean', gift: 5, cheater: false }, 'achievement'],
    ['legacyImport (cheater)', { t: 'legacyImport', verdict: 'forged', gift: 0, cheater: true }, 'achievement'],
    ['toolLost', ONE_OF_EACH.toolLost, 'toolLost'],
    ['toolLost (the last one)', { t: 'toolLost', id: 'mcp_server', owned: 0 }, 'toolLost'],
    ['report', ONE_OF_EACH.report, 'report'],
    ['claim that got past the human', { t: 'claim', promptIndex: 2, caught: false, verifyChance: 0.3, spent: 9e3 }, 'claim'],
    ['claim the human caught', { t: 'claim', promptIndex: 2, caught: true, verifyChance: 0.7, spent: 9e3 }, 'caught'],
    ['manual /compact', { t: 'compactStart', forced: false, kept: 500, lost: 500 }, 'compact'],
    ['forced compaction', { t: 'compactStart', forced: true, kept: 250, lost: 750 }, 'compactForced'],
    ['sycophancy', ONE_OF_EACH.sycophancy, 'sycophancy'],
    ['runOver (won)', { t: 'runOver', won: true, thumbs: 14, reported: 10 }, 'win'],
    ['runOver (lost)', { t: 'runOver', won: false, thumbs: 2, reported: 3 }, 'lose'],
    ['draftOpen', ONE_OF_EACH.draftOpen, 'draftOpen'],
    ['draftPick', ONE_OF_EACH.draftPick, 'draftPick'],
    ['draftReroll', ONE_OF_EACH.draftReroll, 'reroll'],
    ['incidentStart "wait stop"', incident('wait_stop', 'bad'), 'interrupt'],
    ['incidentStart bash_permission', { t: 'incidentStart', id: 'bash_permission', tone: 'bad', tool: 'bash' }, 'permission'],
    ['incidentStart web_permission', { t: 'incidentStart', id: 'web_permission', tone: 'bad', tool: 'web_search' }, 'permission'],
    ['incidentStart mcp_auth', { t: 'incidentStart', id: 'mcp_auth', tone: 'bad', tool: 'mcp_server' }, 'permission'],
    ['incidentStart (bad)', incident('overloaded', 'bad'), 'incidentBad'],
    ['incidentStart (good)', incident('lunch', 'good'), 'incidentGood'],
    ['incidentStart (unknown id, bad tone)', incident('not_an_incident', 'bad'), 'incidentBad'],
    ['incidentStart (unknown id, good tone)', incident('not_an_incident', 'good'), 'incidentGood'],
    ['incidentEnd', ONE_OF_EACH.incidentEnd, 'incidentClear'],
    ['pickupCollect', ONE_OF_EACH.pickupCollect, 'incidentGood'],
    ['patienceWarn', ONE_OF_EACH.patienceWarn, 'warn'],
    ['contextWarn', ONE_OF_EACH.contextWarn, 'contextWarn'],
  ];

  for (const [label, event, sfx] of cases) {
    it(`${label} -> ${sfx}`, () => {
      const engine = make({ contextFactory: null });
      const spy = vi.spyOn(engine, 'play');
      engine.handle(event);
      expect(spy.mock.calls.map((c) => c[0])).toEqual([sfx]);
    });
  }

  it('stays silent on purely informational events', () => {
    const engine = make({ contextFactory: null });
    const spy = vi.spyOn(engine, 'play');
    engine.handle(ONE_OF_EACH.incidentProgress);
    engine.handle(ONE_OF_EACH.runStart);
    engine.handle(ONE_OF_EACH.compactEnd);
    engine.handle(ONE_OF_EACH.pickupSpawn);
    engine.handle(ONE_OF_EACH.pickupExpire);
    expect(spy).not.toHaveBeenCalled();
  });

  it('covers every GameEvent kind without throwing', () => {
    const engine = make({ contextFactory: null });
    expect(Object.keys(ONE_OF_EACH)).toHaveLength(27);
    expect(() => {
      for (const e of ALL_EVENTS) engine.handle(e);
    }).not.toThrow();
  });

  it('resets the click streak on runStart', async () => {
    const { engine, ctx } = await sfxRig();

    for (let i = 0; i < 4; i++) engine.handle(click(false, false));
    const climbed = ctx.created.oscillators.map((o) => o.frequency.calls[0]?.args[0] ?? 0);
    expect(climbed[3]!).toBeGreaterThan(climbed[0]!);

    engine.handle(ONE_OF_EACH.runStart);
    engine.handle(click(false, false));
    const after = ctx.created.oscillators[4]!.frequency.calls[0]!.args[0]!;
    expect(after).toBeCloseTo(climbed[0]!, 6);
  });

  it('lands rm -rf as the incident sting plus a crunch for the lost tool', async () => {
    const { engine, ctx } = await sfxRig();
    const sting = measure(ctx, () => engine.handle(incident('rm_rf', 'bad')));
    const crunch = measure(ctx, () => engine.handle(ONE_OF_EACH.toolLost));
    expect(sting.voices).toBeGreaterThan(0);
    expect(crunch.voices).toBeGreaterThan(0);
  });

  it('folds a legacy import and its hidden achievement into one fanfare', async () => {
    const { engine, ctx } = await sfxRig();
    const first = measure(ctx, () => engine.handle(ONE_OF_EACH.legacyImport));
    expect(first.voices).toBeGreaterThan(0);
    const second = measure(ctx, () => engine.handle({ t: 'achievement', id: 'legacy' }));
    expect(second.voices).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('incident sounds', () => {
  it('dings for every permission prompt in the content', () => {
    const prompts = INCIDENTS.filter((i) => i.permission === true);
    expect(prompts.map((i) => i.id)).toEqual(
      expect.arrayContaining(['bash_permission', 'web_permission', 'mcp_auth']),
    );
    for (const i of prompts) expect(incidentSfx(i.id, i.tone), i.id).toBe('permission');
  });

  it('shatters glass for "wait stop"', () => {
    expect(incidentSfx('wait_stop', 'bad')).toBe('interrupt');
  });

  it('only gives a sound of its own to incidents that exist', () => {
    expect(INCIDENT_SFX.size).toBeGreaterThan(0);
    for (const id of INCIDENT_SFX.keys()) expect(INCIDENT_BY_ID[id], id).toBeDefined();
  });

  it('falls back to the tone for every other incident', () => {
    let checked = 0;
    for (const i of INCIDENTS) {
      if (i.permission === true || INCIDENT_SFX.has(i.id)) continue;
      expect(incidentSfx(i.id, i.tone), i.id).toBe(i.tone === 'good' ? 'incidentGood' : 'incidentBad');
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('is not fooled by ids that collide with Object.prototype', () => {
    expect(incidentSfx('constructor', 'bad')).toBe('incidentBad');
    expect(incidentSfx('__proto__', 'good')).toBe('incidentGood');
    expect(incidentSfx('toString', 'bad')).toBe('incidentBad');
  });
});

// ---------------------------------------------------------------------------

describe('sycophancy heat', () => {
  it('stays sincere at first and goes hollow after a handful of presses', () => {
    expect(sycophancyThinness(0)).toBe(0);
    expect(sycophancyThinness(1)).toBe(0);
    expect(sycophancyThinness(3)).toBeCloseTo(0.5, 6);
    expect(sycophancyThinness(5)).toBe(1);
    expect(sycophancyThinness(40)).toBe(1);
    let prev = -1;
    for (let heat = 0; heat <= 6; heat += 0.25) {
      const thin = sycophancyThinness(heat);
      expect(thin).toBeGreaterThanOrEqual(prev);
      prev = thin;
    }
  });

  it('reads nonsense heat safely', () => {
    expect(sycophancyThinness(Number.NaN)).toBe(0);
    expect(sycophancyThinness(-3)).toBe(0);
    expect(sycophancyThinness(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('thins the chime as heat builds', async () => {
    const { engine, ctx } = await sfxRig();
    const press = (heat: number): { voices: number; level: number } => {
      ctx.advance(1); // well past the coalescing window
      return measure(ctx, () => engine.handle({ t: 'sycophancy', restored: 0.06 / 2 ** heat, heat }));
    };
    const sincere = press(0);
    const warm = press(3);
    const hollow = press(8);
    expect(sincere.voices).toBeGreaterThan(hollow.voices);
    expect(warm.level).toBeLessThan(sincere.level);
    expect(hollow.level).toBeLessThan(warm.level);
  });

  it('plays the sincere chime for a bare play()', async () => {
    const { engine, ctx } = await sfxRig();
    const sincere = measure(ctx, () => engine.handle({ t: 'sycophancy', restored: 0.06, heat: 0 }));
    ctx.advance(1);
    engine.handle({ t: 'sycophancy', restored: 0.001, heat: 9 });
    ctx.advance(1);
    const bare = measure(ctx, () => engine.play('sycophancy'));
    expect(bare).toEqual(sincere);
  });
});

// ---------------------------------------------------------------------------

describe('context warnings', () => {
  const fills = BALANCE.CONTEXT_WARN_FILLS;
  const first = fills[0]!;
  const last = fills[fills.length - 1]!;

  it('scales urgency from the first warning fill to the last', () => {
    expect(last).toBeGreaterThan(first);
    expect(contextUrgency(first)).toBe(0);
    expect(contextUrgency(last)).toBe(1);
    expect(contextUrgency((first + last) / 2)).toBeCloseTo(0.5, 6);
    expect(contextUrgency(0)).toBe(0);
    expect(contextUrgency(1.5)).toBe(1);
    expect(contextUrgency(Number.NaN)).toBe(0);
  });

  it('sounds the last warning more urgently than the first', async () => {
    const { engine, ctx } = await sfxRig();
    const early = measure(ctx, () => engine.handle({ t: 'contextWarn', fill: first }));
    ctx.advance(1);
    const late = measure(ctx, () => engine.handle({ t: 'contextWarn', fill: last }));
    expect(late.voices).toBeGreaterThan(early.voices);
  });
});

// ---------------------------------------------------------------------------

describe('automated clicks', () => {
  const auto = (crit = false): GameEvent => click(crit, true);
  const human = (crit = false): GameEvent => click(crit, false);

  it('throttle a burst to one tick per gap', async () => {
    const { engine, ctx } = await sfxRig();
    for (let i = 0; i < 30; i++) engine.handle(auto());
    expect(ctx.created.oscillators).toHaveLength(1);

    ctx.advance(AUTO_CLICK_GAP_MS / 2000);
    engine.handle(auto());
    expect(ctx.created.oscillators).toHaveLength(1);

    ctx.advance(AUTO_CLICK_GAP_MS / 1000);
    engine.handle(auto());
    expect(ctx.created.oscillators).toHaveLength(2);
  });

  it('tick along steadily under a 40 Hz autoclicker', async () => {
    const { engine, ctx } = await sfxRig();
    const seconds = 2;
    for (let i = 0; i < seconds * 40; i++) {
      ctx.advance(1 / 40);
      engine.handle(auto());
    }
    const ticks = ctx.created.oscillators.length;
    expect(ticks).toBeLessThanOrEqual(Math.ceil((seconds * 1000) / AUTO_CLICK_GAP_MS));
    expect(ticks).toBeGreaterThanOrEqual(Math.floor((seconds * 1000) / (AUTO_CLICK_GAP_MS + 25)));
  });

  it('never throttle a human', async () => {
    const { engine, ctx } = await sfxRig();
    for (let i = 0; i < 12; i++) engine.handle(human());
    expect(ctx.created.oscillators).toHaveLength(12);
  });

  it('keep automated crits to one sting per gap, ticking in between', async () => {
    const { engine, ctx } = await sfxRig();
    for (let i = 0; i < 10; i++) engine.handle(auto(true));
    const sting = ctx.created.oscillators.length;
    // One clickCrit arpeggio, and no tick on top of it.
    expect(sting).toBe(4);

    ctx.advance((AUTO_CLICK_GAP_MS + 10) / 1000);
    engine.handle(auto(true));
    // The crit gate is still shut, so this crit is just a tick.
    expect(ctx.created.oscillators).toHaveLength(sting + 1);

    ctx.advance(AUTO_CRIT_GAP_MS / 1000);
    engine.handle(auto(true));
    expect(ctx.created.oscillators).toHaveLength(sting + 1 + 4);
  });

  it('leave the human click streak alone', async () => {
    const { engine, ctx } = await sfxRig();
    for (let i = 0; i < 3; i++) {
      engine.handle(human());
      ctx.advance(0.05);
    }
    for (let i = 0; i < 4; i++) {
      ctx.advance(0.1);
      engine.handle(auto());
    }
    engine.handle(human());
    const oscs = ctx.created.oscillators;
    expect(oscs).toHaveLength(8);
    // The fourth human click continues the run (base + 3), as if nothing had happened.
    expect(oscs[7]!.frequency.calls[0]!.args[0]!).toBeCloseTo(mtof(76 + 3), 4);
  });
});

// ---------------------------------------------------------------------------

describe('voice budget and rate limiting', () => {
  it('caps the oscillators created by 200 SFX in one tick', async () => {
    const { engine, ctx } = await sfxRig();

    for (let i = 0; i < 200; i++) engine.play('click');

    expect(ctx.created.oscillators.length).toBeLessThanOrEqual(SFX_VOICE_CAP);
    expect(ctx.created.oscillators.length).toBe(SFX_VOICE_CAP);
    for (const s of ctx.sources()) {
      expect(s.startCalls).toHaveLength(1);
      expect(s.stopCalls).toHaveLength(1);
    }
  });

  it('recovers the budget once voices have ended', async () => {
    const { engine, ctx } = await sfxRig();

    for (let i = 0; i < 200; i++) engine.play('click');
    expect(ctx.created.oscillators).toHaveLength(SFX_VOICE_CAP);

    ctx.advance(2);
    for (let i = 0; i < 5; i++) engine.play('click');
    expect(ctx.created.oscillators.length).toBe(SFX_VOICE_CAP + 5);
  });

  it('coalesces identical non-click SFX inside the window', async () => {
    const { engine, ctx } = await sfxRig();

    engine.play('uiHover');
    const first = ctx.created.oscillators.length;
    engine.play('uiHover');
    engine.play('uiHover');
    expect(ctx.created.oscillators).toHaveLength(first);

    ctx.advance(COALESCE_MS / 1000 + 0.005);
    engine.play('uiHover');
    expect(ctx.created.oscillators.length).toBeGreaterThan(first);
  });

  it('never coalesces clicks: they stay 1:1 with input', async () => {
    const { engine, ctx } = await sfxRig();
    for (let i = 0; i < 6; i++) engine.play('click');
    expect(ctx.created.oscillators).toHaveLength(6);
  });

  it('does not coalesce different SFX with each other', async () => {
    const { engine, ctx } = await sfxRig();
    engine.play('uiHover');
    engine.play('draftPick');
    expect(ctx.created.oscillators.length).toBeGreaterThan(1);
  });

  it('lets the sycophancy chime through at human mashing speed', async () => {
    const { engine, ctx } = await sfxRig();
    let played = 0;
    for (let heat = 1; heat <= 8; heat++) {
      ctx.advance(0.08);
      if (measure(ctx, () => engine.handle({ t: 'sycophancy', restored: 0.01, heat })).voices > 0) played++;
    }
    expect(played).toBe(8);
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

    // And no SFX work is done while muted, from events or direct calls.
    const before = ctx.sources().length;
    for (let i = 0; i < 20; i++) engine.play('click');
    for (const e of ALL_EVENTS) engine.handle(e);
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
    engine.play('report');
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
