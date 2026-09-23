import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/sim/types.ts';
import { BALANCE, LEGACY_SAVE_KEY } from '../../src/sim/content.ts';
import { STAT } from '../../src/sim/effects.ts';
import { legacyAuditSave, legacyGift, legacySignSave, readLegacySave } from '../../src/sim/legacy.ts';
import type { StorageLike } from '../../src/sim/save.ts';
import { SAVE_KEY, auditSave, memoryStorage } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

// ---------------------------------------------------------------------------
// Golden vectors, written by Tokenmaxxing 1's own saveMeta()/signSave() and
// judged by its own auditSave(). The port must agree with them exactly.
// ---------------------------------------------------------------------------

const G1_LEVELS =
  '{"unlock_swarm":1,"unlock_ralph":0,"unlock_harness":0,"unlock_fleet":0,"unlock_farm":0,"unlock_agi":0,' +
  '"cracked":3,"unlock_autoclicker":0,"idle_hands":0,"unlock_headless":0,"keyboard_shortcuts":0,' +
  '"unlock_daemon":0,"seed_funding":2,"technical_cofounder":0,"incubator":0,"founder_mode":0,' +
  '"unlock_datacenter":0,"unlock_orbital":0,"unlock_model_cards":0,"prompt_library":0,"reroll_token":0,' +
  '"unlock_rare_cards":0,"scope_negotiator":0,"unlock_architecture":0,"unlock_yolo":0,"unlock_skip":0,' +
  '"hype_machine":0,"snack_drawer":0,"insurance":0,"unlock_lucky":0,"endless_mode":0}';
const G1_SETTINGS = '{"musicVolume":0.6,"sfxVolume":0.8,"reducedMotion":false,"screenShake":true,"showFps":false}';

/** 12 runs, 4 wins, a few nodes bought honestly. Game 1 says: clean. */
const G1_CLEAN =
  `{"demos":7,"levels":${G1_LEVELS},"bestProject":9,"runs":12,"wins":4,"totalDemosEarned":27,"version":1,` +
  `"achievements":{"first_ship":1,"demo_day":6},"settings":${G1_SETTINGS},"sig":"ccccf59602e2b6d2","cheats_enabled":false}`;

/** A clean signature over a save that game 1 had already caught cheating. */
const G1_KIDDIE =
  '{"demos":0,"levels":' +
  G1_LEVELS.replace('"unlock_swarm":1', '"unlock_swarm":0').replace('"cracked":3', '"cracked":0').replace('"seed_funding":2', '"seed_funding":0') +
  `,"bestProject":0,"runs":3,"wins":0,"totalDemosEarned":0,"version":1,"achievements":{"script_kiddie":2},` +
  `"settings":${G1_SETTINGS},"sig":"7a7d8d79518ffdf9","cheats_enabled":false}`;

function g1(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function variant(edit: (r: Record<string, unknown>) => void, resign = false): string {
  const r = g1(G1_CLEAN);
  edit(r);
  if (resign) r['sig'] = legacySignSave(r);
  return JSON.stringify(r);
}

describe('the ported game 1 audit', () => {
  it('signs exactly like game 1', () => {
    expect(legacySignSave(g1(G1_CLEAN))).toBe('ccccf59602e2b6d2');
    expect(legacySignSave(g1(G1_KIDDIE))).toBe('7a7d8d79518ffdf9');
    expect(legacySignSave({})).toBe('09b5369eb4604ed0');
    const forged = g1(G1_CLEAN);
    forged['demos'] = 9000;
    expect(legacySignSave(forged)).toBe('997188fa573c13a1');
  });

  it('reaches game 1\'s verdicts on game 1\'s saves', () => {
    expect(legacyAuditSave(g1(G1_CLEAN))).toBe('clean');
    expect(legacyAuditSave(g1(G1_KIDDIE))).toBe('clean');
    expect(legacyAuditSave(g1(variant((r) => (r['wins'] = 11))))).toBe('edited');
    expect(legacyAuditSave(g1(variant((r) => (r['cheats_enabled'] = true))))).toBe('edited');
    expect(legacyAuditSave(g1(variant((r) => delete r['sig'])))).toBe('legacy');
    expect(legacyAuditSave({})).toBe('legacy');
    expect(legacyAuditSave(g1(variant((r) => (r['demos'] = 9000), true)))).toBe('forged');
    expect(legacyAuditSave(g1(variant((r) => (r['achievements'] = { first_ship: 1, not_real: 1 }), true)))).toBe('forged');
    expect(legacyAuditSave(g1(variant((r) => (r['bestProject'] = 11), true)))).toBe('forged');
    expect(
      legacyAuditSave(
        g1(
          variant((r) => {
            const lv = r['levels'] as Record<string, number>;
            lv['unlock_ralph'] = 1;
            lv['unlock_swarm'] = 0;
            r['totalDemosEarned'] = 35;
          }, true),
        ),
      ),
    ).toBe('forged');
  });

  it('reads what the sequel needs, or nothing', () => {
    expect(readLegacySave(G1_CLEAN)).toEqual({ verdict: 'clean', runs: 12, wins: 4, cheater: false });
    expect(readLegacySave(G1_KIDDIE)).toEqual({ verdict: 'clean', runs: 3, wins: 0, cheater: true });
    expect(readLegacySave(variant((r) => (r['wins'] = 11)))).toEqual({ verdict: 'edited', runs: 12, wins: 11, cheater: true });
    for (const nothing of [null, undefined, '', '{', 'null', '42', '[]', '"save"']) {
      expect(readLegacySave(nothing as string | null)).toBeNull();
    }
  });

  it('scales the gift with wins, capped', () => {
    expect(legacyGift(0)).toBe(BALANCE.LEGACY_GIFT_BASE);
    expect(legacyGift(4)).toBe(BALANCE.LEGACY_GIFT_BASE + 4 * BALANCE.LEGACY_GIFT_PER_WIN);
    expect(legacyGift(1000)).toBe(BALANCE.LEGACY_GIFT_CAP);
  });
});

describe('the one-time import', () => {
  function boot(legacyText: string | null, storage: StorageLike = memoryStorage()): { sim: Sim; log: GameEvent[]; storage: StorageLike } {
    const legacy = memoryStorage(legacyText === null ? {} : { [LEGACY_SAVE_KEY]: legacyText });
    const sim = createSim({ storage, legacyStorage: legacy, autoStart: false });
    const log: GameEvent[] = [];
    sim.subscribe((e) => log.push(e));
    return { sim, log, storage };
  }

  it('runs at the first subscribe, not before', () => {
    const legacy = memoryStorage({ [LEGACY_SAVE_KEY]: G1_CLEAN });
    const sim = createSim({ storage: null, legacyStorage: legacy, autoStart: false });
    expect(sim.meta.legacy).toBeNull();
    sim.subscribe(() => undefined);
    expect(sim.meta.legacy).not.toBeNull();
  });

  it('absent: records that it looked, gives nothing, says nothing', () => {
    const { sim, log } = boot(null);
    expect(sim.meta.legacy).toEqual({ verdict: 'none' });
    expect(sim.meta.thumbs).toBe(0);
    expect(log).toEqual([]);
  });

  it('clean: a welcome gift and Returning Customer', () => {
    const { sim, log, storage } = boot(G1_CLEAN);
    const gift = legacyGift(4);
    expect(sim.meta.legacy).toEqual({ verdict: 'clean', runs: 12, wins: 4, gift, cheater: false });
    expect(sim.meta.thumbs).toBe(gift);
    expect(sim.meta.totalThumbsEarned).toBe(gift);
    expect(log[0]).toEqual({ t: 'legacyImport', verdict: 'clean', gift, cheater: false });
    expect(log).toContainEqual({ t: 'achievement', id: 'returning_customer' });
    expect(log).not.toContainEqual({ t: 'achievement', id: 'legal_notified' });
    expect(sim.derived().verifyChance).toBe(BALANCE.VERIFY_BASE);
    // The sequel's own save stays coherent after the gift.
    expect(auditSave(JSON.parse(storage.getItem(SAVE_KEY) ?? '{}'))).toBe('clean');
  });

  it('edited: Legal Has Been Notified, and the human checks claims less, permanently', () => {
    const { sim, log, storage } = boot(variant((r) => (r['wins'] = 11)));
    expect(sim.meta.legacy?.verdict).toBe('edited');
    expect(log).toContainEqual({ t: 'legacyImport', verdict: 'edited', gift: legacyGift(11), cheater: true });
    expect(log).toContainEqual({ t: 'achievement', id: 'legal_notified' });
    expect(log).toContainEqual({ t: 'achievement', id: 'returning_customer' });
    const later = createSim({ storage, legacyStorage: null, autoStart: false });
    expect(later.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + BALANCE.LEGACY_CHEATER_VERIFY, 10);
  });

  it('a clean signature carrying game 1\'s cheating achievements still counts as cheating', () => {
    const { sim, log } = boot(G1_KIDDIE);
    expect(sim.meta.legacy).toMatchObject({ verdict: 'clean', cheater: true });
    // The import record is the source of truth; the old stats flag is never written.
    expect(sim.meta.stats[STAT.legacyCheater]).toBeUndefined();
    expect(log).toContainEqual({ t: 'achievement', id: 'legal_notified' });
    expect(sim.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + BALANCE.LEGACY_CHEATER_VERIFY, 10);
  });

  it('happens once: a reload, or a second listener, never pays twice', () => {
    const storage = memoryStorage();
    const first = boot(G1_CLEAN, storage);
    first.sim.subscribe(() => undefined);
    expect(first.sim.meta.thumbs).toBe(legacyGift(4));
    const again = boot(G1_CLEAN, storage);
    expect(again.sim.meta.thumbs).toBe(legacyGift(4));
    expect(again.log.some((e) => e.t === 'legacyImport')).toBe(false);
  });

  it('runs under trustSave too (the test hooks exercise it)', () => {
    const legacy = memoryStorage({ [LEGACY_SAVE_KEY]: G1_CLEAN });
    const sim = createSim({ storage: null, legacyStorage: legacy, trustSave: true, autoStart: false });
    sim.subscribe(() => undefined);
    expect(sim.meta.legacy?.verdict).toBe('clean');
  });

  it('defaults to the sequel\'s own storage (same origin)', () => {
    const storage = memoryStorage({ [LEGACY_SAVE_KEY]: G1_CLEAN });
    const sim = createSim({ storage, autoStart: false });
    sim.subscribe(() => undefined);
    expect(sim.meta.legacy?.verdict).toBe('clean');
  });

  it('debug.importLegacy forgets the old import and re-runs it on the raw text', () => {
    const { sim, log } = boot(null);
    expect(sim.meta.legacy).toEqual({ verdict: 'none' });
    sim.debug.importLegacy(G1_KIDDIE);
    expect(sim.meta.legacy?.verdict).toBe('clean');
    expect(log).toContainEqual({ t: 'legacyImport', verdict: 'clean', gift: legacyGift(0), cheater: true });
    expect(sim.meta.legacy).toMatchObject({ cheater: true });
    sim.debug.importLegacy(G1_CLEAN);
    expect(sim.meta.legacy).toMatchObject({ verdict: 'clean', cheater: false });
    expect(sim.meta.thumbs).toBe(legacyGift(0) + legacyGift(4));
    sim.debug.importLegacy('not json');
    expect(sim.meta.legacy).toEqual({ verdict: 'none' });
  });
});
