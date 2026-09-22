/**
 * Achievements, and the three-layer save-tampering check behind Script Kiddie.
 *
 * The false-positive cases matter more than the true ones here: accusing an
 * honest player is a real bug, and the three ways it could happen are a save
 * written before signing existed, a schema migration, and storage corruption.
 */
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, BIG_SLOP } from '../../src/sim/achievements.ts';
import { BALANCE, FINAL_PROJECT_INDEX, META_BY_ID, projectAt } from '../../src/sim/content.ts';
import * as Sim from '../../src/sim/index.ts';
import {
  SAVE_KEY,
  auditSave,
  defaultMeta,
  loadMetaAudited,
  saveIsCoherent,
  saveMeta,
  signSave,
} from '../../src/sim/save.ts';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import type { StorageLike } from '../../src/sim/save.ts';

/** In-memory storage so nothing here touches a real localStorage. */
function mem(seed?: string): StorageLike & { dump(): string | null } {
  let value: string | null = seed ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
    removeItem: () => {
      value = null;
    },
    dump: () => value,
  };
}

/** A signed, coherent save with the given fields patched in. */
function signedSave(patch: Partial<MetaState> = {}): string {
  const store = mem();
  saveMeta({ ...defaultMeta(), ...patch }, store);
  return store.dump() ?? '';
}

describe('achievement content', () => {
  it('has unique ids and both visible and hidden entries', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ACHIEVEMENTS.filter((a) => !a.hidden).length).toBeGreaterThanOrEqual(8);
    expect(ACHIEVEMENTS.filter((a) => a.hidden).length).toBeGreaterThanOrEqual(8);
  });

  it('sets the big-slop threshold somewhere a run can actually reach', () => {
    // This shipped at 1e33 — a literal hellaslop — while the last project needs
    // 3.84 TSLOP to ship. Twenty-one orders of magnitude of impossible. Holding
    // slop peaks at the final requirement, so that is the hard ceiling.
    const ceiling = projectAt(FINAL_PROJECT_INDEX).requirement;
    expect(BIG_SLOP).toBeLessThanOrEqual(ceiling);
    // …but still far enough out that it means something.
    expect(BIG_SLOP).toBeGreaterThan(projectAt(FINAL_PROJECT_INDEX - 2).requirement);
  });

  it('describes every entry and never leaves a blurb empty', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length, a.id).toBeGreaterThan(2);
      expect(a.blurb.length, a.id).toBeGreaterThan(8);
      expect(a.icon.length, a.id).toBeGreaterThan(0);
    }
  });
});

describe('save signing', () => {
  it('round-trips a save it wrote itself as clean', () => {
    const store = mem(signedSave({ demos: 12, totalDemosEarned: 40 }));
    const { verdict, meta } = loadMetaAudited(store);
    expect(verdict).toBe('clean');
    expect(meta.demos).toBe(12);
  });

  it('ignores settings, so changing the volume is not cheating', () => {
    const raw = JSON.parse(signedSave()) as Record<string, unknown>;
    raw['settings'] = { musicVolume: 0, sfxVolume: 0, reducedMotion: true, screenShake: false, showFps: true };
    expect(auditSave(raw)).toBe('clean');
  });

  it('calls a save with no signature legacy, never edited', () => {
    // The critical false positive: every save written before signing existed
    // has no `sig`, and accusing those would hit every current player.
    const legacy = JSON.stringify({ ...defaultMeta(), demos: 5, totalDemosEarned: 5 });
    expect(auditSave(JSON.parse(legacy) as unknown)).toBe('legacy');
    const store = mem(legacy);
    expect(loadMetaAudited(store).verdict).toBe('legacy');
  });

  it('treats unparseable storage as corruption, not cheating', () => {
    expect(loadMetaAudited(mem('}{ not json')).verdict).toBe('clean');
    expect(loadMetaAudited(mem('')).verdict).toBe('clean');
    expect(loadMetaAudited(mem()).verdict).toBe('clean');
  });

  it('re-signs after a write, so a migrated save does not look edited', () => {
    // A v0 payload gets rewritten with a signature the next time we persist.
    const store = mem(JSON.stringify({ demos: 3, totalDemosEarned: 3 }));
    const { meta } = loadMetaAudited(store);
    expect(saveMeta(meta, store)).toBe(true);
    expect(loadMetaAudited(store).verdict).toBe('clean');
  });

  it('catches the obvious edit', () => {
    const raw = JSON.parse(signedSave({ demos: 1, totalDemosEarned: 1 })) as Record<string, unknown>;
    raw['demos'] = 999_999;
    expect(auditSave(raw)).toBe('edited');
  });

  it('catches the honeypot before any hashing', () => {
    const raw = JSON.parse(signedSave()) as Record<string, unknown>;
    raw['cheats_enabled'] = true;
    expect(auditSave(raw)).toBe('edited');
    // Even with a correct signature over the edited payload.
    raw['sig'] = signSave(raw);
    expect(auditSave(raw)).toBe('edited');
  });

  it('catches a forged signature over an impossible save', () => {
    const raw = JSON.parse(signedSave()) as Record<string, unknown>;
    raw['wins'] = 50;
    raw['runs'] = 1;
    raw['sig'] = signSave(raw); // they found the hash…
    expect(auditSave(raw)).toBe('forged'); // …and not the arithmetic
  });
});

describe('save coherence', () => {
  const base = (): Record<string, unknown> => ({
    demos: 0,
    levels: {},
    bestProject: 0,
    runs: 1,
    wins: 0,
    totalDemosEarned: 0,
    achievements: {},
  });

  it('accepts an ordinary save', () => {
    expect(saveIsCoherent(base())).toBe(true);
  });

  it('rejects more wins than runs', () => {
    expect(saveIsCoherent({ ...base(), wins: 2, runs: 1 })).toBe(false);
  });

  it('rejects negative counters', () => {
    expect(saveIsCoherent({ ...base(), demos: -5 })).toBe(false);
  });

  it('rejects a level past its ceiling', () => {
    const id = 'cracked';
    const max = META_BY_ID[id]!.maxLevel;
    expect(saveIsCoherent({ ...base(), levels: { [id]: max + 1 }, totalDemosEarned: 1e9 })).toBe(
      false,
    );
  });

  it('rejects a node whose prerequisites are unowned', () => {
    // unlock_ralph requires unlock_swarm.
    expect(
      saveIsCoherent({ ...base(), levels: { unlock_ralph: 1 }, totalDemosEarned: 1e9 }),
    ).toBe(false);
  });

  it('rejects Demos that were never earned', () => {
    // Owning seed_funding L1 costs Demos, so totalDemosEarned cannot be 0.
    expect(saveIsCoherent({ ...base(), levels: { seed_funding: 1 }, totalDemosEarned: 0 })).toBe(
      false,
    );
  });

  it('rejects unknown achievement ids', () => {
    expect(saveIsCoherent({ ...base(), achievements: { i_win: 1 } })).toBe(false);
  });

  it('accepts a legitimately deep save', () => {
    expect(
      saveIsCoherent({
        ...base(),
        runs: 40,
        wins: 3,
        demos: 10,
        totalDemosEarned: 5_000,
        levels: { unlock_swarm: 1, unlock_ralph: 1, seed_funding: 2 },
        achievements: { first_ship: 1, demo_day: 12 },
      }),
    ).toBe(true);
  });
});

describe('the cheat achievements reach the player', () => {
  function simWith(save: string): { sim: ReturnType<typeof Sim.createSim>; seen: string[] } {
    const store = mem(save);
    const seen: string[] = [];
    const sim = Sim.createSim({ storage: store, autoStart: false });
    sim.subscribe((e: GameEvent) => {
      if (e.t === 'achievement') seen.push(e.id);
    });
    return { sim, seen };
  }

  it('awards Script Kiddie for an edited save', () => {
    const raw = JSON.parse(signedSave({ demos: 1, totalDemosEarned: 1 })) as Record<string, unknown>;
    raw['demos'] = 4242;
    const { sim, seen } = simWith(JSON.stringify(raw));
    expect(seen).toContain('script_kiddie');
    expect(sim.meta.achievements['script_kiddie']).toBeGreaterThan(0);
  });

  it('awards Nice Try when the signature was fixed but the save is impossible', () => {
    const raw = JSON.parse(signedSave()) as Record<string, unknown>;
    raw['wins'] = 99;
    raw['runs'] = 0;
    raw['sig'] = signSave(raw);
    const { seen } = simWith(JSON.stringify(raw));
    expect(seen).toContain('nice_try');
    expect(seen).not.toContain('script_kiddie');
  });

  it('signs a legacy save the moment it is found', () => {
    // Left unsigned, the save stays freely editable-without-detection until some
    // unrelated write happens to come along.
    const legacy = JSON.stringify({ demos: 4, totalDemosEarned: 4, runs: 2 });
    const store = mem(legacy);
    expect(auditSave(JSON.parse(legacy) as unknown)).toBe('legacy');

    const sim = Sim.createSim({ storage: store, autoStart: false });
    expect(sim.meta.demos).toBe(4);
    // Signed on discovery, so the very next load is clean...
    const after = JSON.parse(store.dump() ?? '{}') as Record<string, unknown>;
    expect(typeof after['sig']).toBe('string');
    expect(auditSave(after)).toBe('clean');
    // ...and an edit from here on is caught.
    after['demos'] = 9999;
    expect(auditSave(after)).toBe('edited');
  });

  it('awards neither for an honest save, a legacy save, or under the test hooks', () => {
    expect(simWith(signedSave({ demos: 3, totalDemosEarned: 3 })).seen).toEqual([]);
    expect(simWith(JSON.stringify({ demos: 3, totalDemosEarned: 3 })).seen).toEqual([]);

    // `trustSave` is what keeps the QA harness — which injects raw saves by
    // design — from earning Script Kiddie on every single e2e run.
    const raw = JSON.parse(signedSave()) as Record<string, unknown>;
    raw['demos'] = 1e9;
    const seen: string[] = [];
    const sim = Sim.createSim({
      storage: mem(JSON.stringify(raw)),
      autoStart: false,
      trustSave: true,
    });
    sim.subscribe((e: GameEvent) => {
      if (e.t === 'achievement') seen.push(e.id);
    });
    expect(seen).toEqual([]);
  });

  it('is granted once and survives a reload', () => {
    const raw = JSON.parse(signedSave({ demos: 1, totalDemosEarned: 1 })) as Record<string, unknown>;
    raw['demos'] = 4242;
    const store = mem(JSON.stringify(raw));
    const first = Sim.createSim({ storage: store, autoStart: false });
    first.subscribe(() => {});
    expect(first.meta.achievements['script_kiddie']).toBeGreaterThan(0);

    // The rewritten save is signed and coherent, so the second load is clean —
    // but the achievement it already earned stays earned.
    const second = Sim.createSim({ storage: store, autoStart: false });
    const seen: string[] = [];
    second.subscribe((e: GameEvent) => {
      if (e.t === 'achievement') seen.push(e.id);
    });
    expect(second.meta.achievements['script_kiddie']).toBeGreaterThan(0);
    expect(seen, 'awarded twice').toEqual([]);
    expect(store.dump()).toContain(SAVE_KEY.length > 0 ? 'sig' : 'sig');
  });
});

describe('driving the game through the debug hooks', () => {
  it('earns QA Engineer once, and emits it', () => {
    // `?testhooks=1` reaches production on purpose — the verification scripts
    // drive the deployed build through it — so a player found the API in the
    // README and wrote an autoclicker on top. Using it is content, not a hole.
    const s = Sim.createSim({ seed: 2, storage: null, persist: false });
    const seen: string[] = [];
    s.subscribe((e: GameEvent) => {
      if (e.t === 'achievement') seen.push(e.id);
    });
    expect(s.meta.achievements['qa_engineer']).toBeUndefined();

    s.noteDebugHookUsed();
    expect(seen).toEqual(['qa_engineer']);
    expect(s.meta.achievements['qa_engineer']).toBeGreaterThan(0);

    // Idempotent: an autoclicker calls a hook thousands of times a second.
    for (let i = 0; i < 500; i++) s.noteDebugHookUsed();
    expect(seen).toEqual(['qa_engineer']);
  });
});

describe('earning achievements through play', () => {
  function sim(): ReturnType<typeof Sim.createSim> {
    return Sim.createSim({ seed: 3, storage: null, persist: false });
  }

  it('Hello World on the first ship', () => {
    const s = sim();
    const seen: string[] = [];
    s.subscribe((e: GameEvent) => {
      if (e.t === 'achievement') seen.push(e.id);
    });
    s.startRun(3);
    s.run.slop = s.derived().requirement;
    expect(s.ship()).toBe(true);
    expect(seen).toContain('first_ship');
    expect(s.meta.achievements['first_ship']).toBeGreaterThan(0);
  });

  it('No Hands only when the project took no manual click', () => {
    const s = sim();
    s.startRun(3);
    // A manual click disqualifies it.
    s.click(1, 1);
    s.run.slop = s.derived().requirement;
    s.ship();
    expect(s.meta.achievements['no_hands']).toBeUndefined();

    // Clear the draft so the run is 'running' again, then ship a project that
    // never gets touched by hand.
    s.tick(BALANCE.SHIP_BEAT_MS + 1);
    if (s.run.draftOffer.length > 0) s.pickCard(s.run.draftOffer[0] as string);
    expect(s.run.phase).toBe('running');
    s.run.slop = s.derived().requirement;
    expect(s.ship()).toBe(true);
    expect(s.meta.achievements['no_hands']).toBeGreaterThan(0);
  });

  it('Ship It Friday needs the clock nearly out', () => {
    const s = sim();
    s.startRun(3);
    s.run.slop = s.derived().requirement;
    s.run.timeLeftMs = 2_000;
    s.ship();
    expect(s.meta.achievements['friday']).toBeGreaterThan(0);
  });

  it('hidden achievements stay unearned until their condition is met', () => {
    const s = sim();
    s.startRun(3);
    for (const a of ACHIEVEMENTS.filter((x) => x.hidden)) {
      expect(s.meta.achievements[a.id], a.id).toBeUndefined();
    }
  });

  it('every id the tracker can award actually exists in the content', () => {
    const s = sim();
    const seen: string[] = [];
    s.subscribe((e: GameEvent) => {
      if (e.t === 'achievement') seen.push(e.id);
    });
    s.startRun(3);
    s.run.slop = 1e12;
    s.buyAgent('tab_autocomplete', 5);
    s.run.slop = s.derived().requirement;
    s.ship();
    for (const id of seen) expect(ACHIEVEMENT_BY_ID[id], id).toBeTruthy();
  });
});
