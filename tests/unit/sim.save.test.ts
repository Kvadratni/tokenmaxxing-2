import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { META_UPGRADES } from '../../src/sim/content.ts';
import { legacySignSave } from '../../src/sim/legacy.ts';
import type { StorageLike } from '../../src/sim/save.ts';
import {
  SAVE_KEY,
  SAVE_VERSION,
  auditSave,
  clearMeta,
  defaultMeta,
  defaultSettings,
  loadMeta,
  loadMetaAudited,
  memoryStorage,
  metaNextCost,
  migrateMeta,
  saveIsCoherent,
  saveMeta,
  signSave,
} from '../../src/sim/save.ts';
import { createSim } from '../../src/sim/sim.ts';

const hostile: StorageLike = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('nope');
  },
};

/** A save a real player could have: 12 👍 earned, 5 spent. */
function playedMeta(): MetaState {
  const m = defaultMeta();
  m.runs = 4;
  m.wins = 1;
  m.bestPrompt = 9;
  m.levels['tool_use'] = 2; // 2 + 3
  m.thumbs = 7;
  m.totalThumbsEarned = 12;
  m.achievements = { works_on_my_machine: 1, shipped_to_prod: 4 };
  m.stats = { sycophancy: 12, compactions: 3 };
  m.legacy = { verdict: 'clean', runs: 5, wins: 2, gift: 7, cheater: false };
  return m;
}

function stored(storage: StorageLike): Record<string, unknown> {
  return JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>;
}

/** Hand-edit a stored save, then fix the checksum like a determined cheater. */
function forge(edit: (raw: Record<string, unknown>) => void): Record<string, unknown> {
  const storage = memoryStorage();
  saveMeta(playedMeta(), storage);
  const raw = stored(storage);
  edit(raw);
  raw['sig'] = signSave(raw);
  return raw;
}

describe('defaults', () => {
  it('defaultMeta is complete, zeroed and versioned', () => {
    const m = defaultMeta();
    expect(m).toMatchObject({
      thumbs: 0,
      bestPrompt: 0,
      runs: 0,
      wins: 0,
      totalThumbsEarned: 0,
      version: SAVE_VERSION,
      achievements: {},
      stats: {},
      legacy: null,
    });
    expect(m.settings).toEqual(defaultSettings());
    for (const d of META_UPGRADES) expect(m.levels[d.id]).toBe(0);
  });

  it('returns fresh objects', () => {
    const a = defaultMeta();
    a.stats['x'] = 1;
    a.levels['tool_use'] = 3;
    expect(defaultMeta().stats).toEqual({});
    expect(defaultMeta().levels['tool_use']).toBe(0);
  });

  it('uses the sequel key', () => {
    expect(SAVE_KEY).toBe('tokenmaxxing2.save.v1');
  });
});

describe('round trip', () => {
  it('saves signed and reloads an identical, clean MetaState', () => {
    const storage = memoryStorage();
    const m = playedMeta();
    m.settings = { musicVolume: 0.25, sfxVolume: 0, reducedMotion: true, screenShake: false, showFps: true };
    expect(saveMeta(m, storage)).toBe(true);
    const raw = stored(storage);
    expect(typeof raw['sig']).toBe('string');
    expect(raw['cheats_enabled']).toBe(false);
    const back = loadMetaAudited(storage);
    expect(back.verdict).toBe('clean');
    expect(back.meta).toEqual(m);
  });

  it('clearMeta wipes it', () => {
    const storage = memoryStorage();
    saveMeta(playedMeta(), storage);
    expect(clearMeta(storage)).toBe(true);
    expect(loadMeta(storage)).toEqual(defaultMeta());
  });

  it('never throws on hostile or missing storage', () => {
    expect(loadMeta(hostile)).toEqual(defaultMeta());
    expect(saveMeta(defaultMeta(), hostile)).toBe(false);
    expect(clearMeta(hostile)).toBe(false);
    expect(loadMeta(null)).toEqual(defaultMeta());
    expect(() => createSim({ storage: hostile })).not.toThrow();
  });

  it('corrupt JSON is corruption, not cheating', () => {
    for (const junk of ['{', 'nope', '[[[', ' ']) {
      const r = loadMetaAudited(memoryStorage({ [SAVE_KEY]: junk }));
      expect(r.meta).toEqual(defaultMeta());
      expect(r.verdict).toBe('clean');
    }
  });
});

describe('signing', () => {
  it('covers progression and legacy, not settings', () => {
    const raw = { ...playedMeta() } as unknown as Record<string, unknown>;
    const sig = signSave(raw);
    expect(signSave({ ...raw, settings: { musicVolume: 0 } })).toBe(sig);
    expect(signSave({ ...raw, thumbs: 8 })).not.toBe(sig);
    expect(signSave({ ...raw, stats: {} })).not.toBe(sig);
    expect(signSave({ ...raw, legacy: null })).not.toBe(sig);
    // Key order never matters.
    const reordered = Object.fromEntries(Object.entries(raw).reverse());
    expect(signSave(reordered)).toBe(sig);
  });

  it('uses its own salt, not the first game\'s', () => {
    expect(signSave({})).not.toBe(legacySignSave({}));
  });
});

describe('auditSave', () => {
  it('clean when signed and coherent', () => {
    expect(auditSave(forge(() => undefined))).toBe('clean');
  });

  it('legacy when unsigned (never an accusation)', () => {
    const raw = forge(() => undefined);
    delete raw['sig'];
    expect(auditSave(raw)).toBe('legacy');
  });

  it('edited when a value changed under the signature', () => {
    const storage = memoryStorage();
    saveMeta(playedMeta(), storage);
    const raw = stored(storage);
    raw['thumbs'] = 9000;
    expect(auditSave(raw)).toBe('edited');
  });

  it('edited when the honeypot is flipped', () => {
    expect(auditSave({ ...forge(() => undefined), cheats_enabled: true })).toBe('edited');
    expect(auditSave({ ...forge(() => undefined), cheats_enabled: 'true' })).toBe('edited');
  });

  it('forged when re-signed but impossible', () => {
    const cases: [string, (r: Record<string, unknown>) => void][] = [
      ['more 👍 on hand than ever earned', (r) => (r['thumbs'] = 99)],
      ['levels bought with 👍 never earned', (r) => ((r['levels'] as Record<string, number>)['tool_use'] = 6)],
      ['a level past its ceiling', (r) => ((r['levels'] as Record<string, number>)['honest'] = 2)],
      ['a node without its prerequisites', (r) => ((r['levels'] as Record<string, number>)['rlhf'] = 1)],
      ['a node that does not exist', (r) => ((r['levels'] as Record<string, number>)['god_mode'] = 1)],
      ['more wins than runs', (r) => (r['wins'] = 9)],
      ['a prompt past ten without Endless', (r) => (r['bestPrompt'] = 12)],
      ['an achievement that does not exist', (r) => (r['achievements'] = { free_win: 1 })],
      ['a negative stat', (r) => (r['stats'] = { sycophancy: -1 })],
      ['a gift that is not the formula', (r) => (r['legacy'] = { verdict: 'clean', runs: 5, wins: 2, gift: 15 })],
      ['a verdict that is not one', (r) => (r['legacy'] = { verdict: 'trustme', runs: 1, wins: 0, gift: 3 })],
      ['a cheater flag that is not a boolean', (r) => (r['legacy'] = { verdict: 'clean', runs: 5, wins: 2, gift: 7, cheater: 'no' })],
      ['a tampered game 1 save marked honest', (r) => (r['legacy'] = { verdict: 'edited', runs: 5, wins: 2, gift: 7, cheater: false })],
    ];
    for (const [why, edit] of cases) expect(auditSave(forge(edit)), why).toBe('forged');
  });

  it('accepts what play produces: totals, legacy none, endless past ten', () => {
    expect(auditSave(forge((r) => (r['legacy'] = { verdict: 'none' })))).toBe('clean');
    expect(auditSave(forge((r) => (r['legacy'] = null)))).toBe('clean');
    const endless = defaultMeta();
    for (const d of META_UPGRADES) endless.levels[d.id] = d.maxLevel;
    const spent = META_UPGRADES.reduce((n, d) => n + d.costs.slice(0, d.maxLevel).reduce((a, b) => a + b, 0), 0);
    endless.totalThumbsEarned = spent;
    endless.runs = 30;
    endless.wins = 20;
    endless.bestPrompt = 14;
    expect(saveIsCoherent(endless as unknown as Record<string, unknown>)).toBe(true);
  });
});

describe('migrateMeta', () => {
  it('sanitises hostile fields', () => {
    const m = migrateMeta({
      thumbs: 'lots',
      levels: { tool_use: 999, honest: -4, not_real: 7 },
      runs: Number.NaN,
      wins: null,
      bestPrompt: [],
      stats: { sycophancy: 4, bad: -1, worse: 'x', nan: Number.NaN },
      legacy: { verdict: 'edited', runs: 3.7, wins: -1, gift: 'x' },
      achievements: { works_on_my_machine: 2, not_real: 1, compacted: 0 },
      settings: { musicVolume: 12, sfxVolume: -3, reducedMotion: 'yes' },
    });
    expect(m.thumbs).toBe(0);
    expect(m.levels['tool_use']).toBe(6);
    expect(m.levels['honest']).toBe(0);
    expect(m.levels['not_real']).toBeUndefined();
    expect(m.runs).toBe(0);
    expect(m.stats).toEqual({ sycophancy: 4 });
    expect(m.legacy).toEqual({ verdict: 'edited', runs: 3, wins: 0, gift: 0, cheater: true });
    expect(m.achievements).toEqual({ works_on_my_machine: 2 });
    expect(m.settings.musicVolume).toBe(1);
    expect(m.settings.sfxVolume).toBe(0);
    expect(m.settings.reducedMotion).toBe(false);
  });

  it('fills stats and legacy on a payload that predates them', () => {
    const m = migrateMeta({ thumbs: 3, totalThumbsEarned: 3, runs: 1 });
    expect(m.stats).toEqual({});
    expect(m.legacy).toBeNull();
    expect(migrateMeta({ legacy: { verdict: 'none' } }).legacy).toEqual({ verdict: 'none' });
    expect(migrateMeta({ legacy: { verdict: 'bogus' } }).legacy).toBeNull();
  });

  it('repairs lifetime 👍 below the 👍 on hand', () => {
    expect(migrateMeta({ thumbs: 10, totalThumbsEarned: 2 }).totalThumbsEarned).toBe(10);
  });
});

describe('the legacy cheater flag', () => {
  /** A save as the sequel wrote it before LegacyImport.cheater existed. */
  function earlySave(): StorageLike {
    const raw: Record<string, unknown> = {
      ...(playedMeta() as unknown as Record<string, unknown>),
      legacy: { verdict: 'clean', runs: 5, wins: 2, gift: 7 },
      stats: { sycophancy: 12, compactions: 3, legacyCheater: 1 },
    };
    raw['sig'] = signSave(raw);
    raw['cheats_enabled'] = false;
    return memoryStorage({ [SAVE_KEY]: JSON.stringify(raw) });
  }

  it('migrates the early stats flag onto the import record', () => {
    const loaded = loadMetaAudited(earlySave());
    expect(loaded.verdict).toBe('clean');
    expect(loaded.meta.legacy).toEqual({ verdict: 'clean', runs: 5, wins: 2, gift: 7, cheater: true });
    expect(loaded.meta.stats['legacyCheater']).toBeUndefined();
    expect(loaded.meta.stats['sycophancy']).toBe(12);
  });

  it('never loses it: the bonus applies, and survives a write and a reload', () => {
    const storage = earlySave();
    const s = createSim({ storage, legacyStorage: null, autoStart: false });
    expect(s.derived().verifyChance).toBeCloseTo(0.4 - 0.1, 10);
    s.save();
    const again = loadMetaAudited(storage);
    expect(again.verdict).toBe('clean');
    expect(again.meta.legacy).toMatchObject({ cheater: true });
  });

  it('an early record with a tampered verdict is a cheater, and a flag with no record stays put', () => {
    expect(migrateMeta({ legacy: { verdict: 'forged', runs: 1, wins: 0, gift: 3 } }).legacy).toMatchObject({ cheater: true });
    expect(migrateMeta({ legacy: { verdict: 'legacy', runs: 1, wins: 0, gift: 3 } }).legacy).toMatchObject({ cheater: false });
    const orphan = migrateMeta({ stats: { legacyCheater: 1 } });
    expect(orphan.stats['legacyCheater']).toBe(1);
  });
});

describe('the sim and its save', () => {
  it('writes lifetime stats at every report, claim and compaction', () => {
    const storage = memoryStorage();
    const s = createSim({ seed: 3, storage, legacyStorage: null });
    s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
    s.run.nextPickupInMs = Number.POSITIVE_INFINITY;
    const statsOnDisk = (): Record<string, number> =>
      ((JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>)['stats'] ?? {}) as Record<string, number>;

    s.absolutelyRight();
    expect(statsOnDisk()['sycophancy']).toBeUndefined(); // presses alone are not worth a write
    s.run.tokens = 100;
    s.report();
    expect(statsOnDisk()['sycophancy']).toBe(1);

    s.tick(1000);
    s.pickCard(s.run.draftOffer[0]!);
    s.absolutelyRight();
    s.run.tokens = 1000; // claim territory on prompt 1 (1,500 needed)
    s.debug.forceVerify('catch');
    expect(s.claim()).toBe('caught');
    expect(statsOnDisk()['sycophancy']).toBe(2);

    s.absolutelyRight();
    s.debug.setContext(1);
    expect(statsOnDisk()['sycophancy']).toBe(3);
    expect(statsOnDisk()['compactions']).toBe(1);
    expect(auditSave(JSON.parse(storage.getItem(SAVE_KEY) ?? '{}'))).toBe('clean');
  });

  function events(storage: StorageLike, trustSave = false): { log: GameEvent[]; meta: MetaState } {
    const s = createSim({ storage, legacyStorage: null, trustSave, autoStart: false });
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    return { log, meta: s.meta };
  }

  it('signs an unsigned save the moment it loads, even under trustSave', () => {
    const storage = memoryStorage();
    saveMeta(playedMeta(), storage);
    const raw = stored(storage);
    delete raw['sig'];
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    createSim({ storage, legacyStorage: null, trustSave: true, autoStart: false });
    expect(auditSave(stored(storage))).toBe('clean');
  });

  it('an edited save earns Script Kiddie II at the first subscribe', () => {
    const storage = memoryStorage();
    saveMeta(playedMeta(), storage);
    const raw = stored(storage);
    raw['thumbs'] = 5000;
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    const { log, meta } = events(storage);
    expect(log).toContainEqual({ t: 'achievement', id: 'script_kiddie' });
    expect(meta.achievements['script_kiddie']).toBeGreaterThan(0);
  });

  it('a forged save earns Nice Try', () => {
    const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify(forge((r) => (r['wins'] = 9))) });
    expect(events(storage).log).toContainEqual({ t: 'achievement', id: 'nice_try' });
  });

  it('trustSave skips the check entirely', () => {
    const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify(forge((r) => (r['wins'] = 9))) });
    expect(events(storage, true).log.some((e) => e.t === 'achievement')).toBe(false);
  });

  it('a clean save earns nothing, and stays clean after play', () => {
    const storage = memoryStorage();
    saveMeta(playedMeta(), storage);
    const s = createSim({ storage, legacyStorage: null, seed: 3 });
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    expect(log.some((e) => e.t === 'achievement')).toBe(false);
    s.absolutelyRight();
    s.debug.grantThumbs(4);
    s.endRun(false);
    expect(auditSave(stored(storage))).toBe('clean');
  });

  it('metaNextCost walks the cost ladder and is Infinity when maxed or unknown', () => {
    const m = defaultMeta();
    expect(metaNextCost(m, 'tool_use')).toBe(1);
    m.levels['tool_use'] = 5;
    expect(metaNextCost(m, 'tool_use')).toBe(13);
    m.levels['tool_use'] = 6;
    expect(metaNextCost(m, 'tool_use')).toBe(Number.POSITIVE_INFINITY);
    expect(metaNextCost(m, 'nope')).toBe(Number.POSITIVE_INFINITY);
  });
});
