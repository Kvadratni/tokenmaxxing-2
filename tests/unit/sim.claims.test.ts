import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { BALANCE, promptAt } from '../../src/sim/content.ts';
import { STAT } from '../../src/sim/effects.ts';
import { createRng } from '../../src/sim/rng.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 31337, storage: null, persist: false, ...over });
  s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
  s.run.nextPickupInMs = Number.POSITIVE_INFINITY;
  return s;
}

function record(s: Sim): GameEvent[] {
  const log: GameEvent[] = [];
  s.subscribe((e) => log.push(e));
  return log;
}

function metaWith(levels: Record<string, number>): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return m;
}

const REQ0 = promptAt(0).requirement;

describe('the report button', () => {
  it('reads working, then claim at the threshold, then report', () => {
    const s = mkSim();
    s.run.tokens = REQ0 * 0.49;
    expect(s.derived().reportState).toBe('working');
    s.run.tokens = REQ0 * BALANCE.CLAIM_THRESHOLD;
    expect(s.derived().reportState).toBe('claim');
    s.run.tokens = REQ0;
    expect(s.derived().reportState).toBe('report');
    expect(s.derived().claimThreshold).toBe(BALANCE.CLAIM_THRESHOLD);
  });

  it('reads blocked during an outage once the wallet could report or claim', () => {
    const s = mkSim();
    s.run.promptIndex = 3;
    const req = promptAt(3).requirement;
    s.run.patienceMs = s.patienceMaxMs;
    s.debug.forceIncident('merge_conflict');
    s.run.tokens = req * 0.3;
    expect(s.derived().reportState).toBe('working');
    expect(s.derived().reportBlockedBy).toBe('Merge Conflict');
    s.run.tokens = req * 0.6;
    expect(s.derived().reportState).toBe('blocked');
    s.run.tokens = req * 2;
    expect(s.derived().reportState).toBe('blocked');
  });

  it('moves the threshold with claimThreshold effects, clamped to [MIN, 1]', () => {
    const s = mkSim({ meta: metaWith({ spec_gaming: 2 }) }); // -0.1
    expect(s.derived().claimThreshold).toBeCloseTo(0.4, 10);
    s.run.owned.push('mock_everything'); // -0.1
    expect(s.derived().claimThreshold).toBeCloseTo(0.3, 10);
    s.run.cards.push('skip_the_tests'); // -0.2
    expect(s.derived().claimThreshold).toBe(BALANCE.CLAIM_THRESHOLD_MIN);

    const t = mkSim();
    for (let i = 0; i < 5; i++) t.run.cards.push('no_placeholders'); // +0.75
    expect(t.derived().claimThreshold).toBe(1);
  });
});

describe('verify chance', () => {
  it('= VERIFY_BASE + effects + per pass + per caught, clamped', () => {
    const s = mkSim();
    expect(s.derived().verifyChance).toBe(BALANCE.VERIFY_BASE);
    s.run.owned.push('confident_tone'); // -0.08
    expect(s.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE - 0.08, 10);
    s.run.claimed = 2;
    s.run.caught = 1;
    expect(s.derived().verifyChance).toBeCloseTo(
      BALANCE.VERIFY_BASE - 0.08 + 2 * BALANCE.VERIFY_PER_PASS + BALANCE.VERIFY_PER_CAUGHT,
      10,
    );
    s.run.caught = 10;
    expect(s.derived().verifyChance).toBe(BALANCE.VERIFY_MAX);
    s.run.caught = 0;
    s.run.claimed = 0;
    s.run.cards.push('ceo_watching', 'skip_the_tests', 'lgtm'); // -0.45
    expect(s.derived().verifyChance).toBe(BALANCE.VERIFY_MIN);
  });

  it('includes incidents ("did you actually test this?")', () => {
    const s = mkSim();
    s.run.promptIndex = 1;
    s.debug.forceIncident('did_you_test');
    expect(s.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + 0.25, 10);
  });

  it('drops permanently for a human who cheated in the first game', () => {
    const s = mkSim();
    s.meta.legacy = { verdict: 'edited', runs: 1, wins: 0, gift: 3 };
    expect(s.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + BALANCE.LEGACY_CHEATER_VERIFY, 10);
    s.meta.legacy = { verdict: 'clean', runs: 1, wins: 0, gift: 3 };
    expect(s.derived().verifyChance).toBe(BALANCE.VERIFY_BASE);
    s.meta.stats[STAT.legacyCheater] = 1;
    expect(s.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + BALANCE.LEGACY_CHEATER_VERIFY, 10);
  });
});

describe('claim()', () => {
  it('only works in the claim state', () => {
    const s = mkSim();
    const log = record(s);
    s.run.tokens = REQ0 * 0.3;
    expect(s.claim()).toBeNull();
    s.run.tokens = REQ0;
    expect(s.claim()).toBeNull(); // you have enough: report instead
    s.run.phase = 'drafting';
    expect(s.claim()).toBeNull();
    const reasons = log.filter((e) => e.t === 'denied').map((e) => (e.t === 'denied' ? e.reason : ''));
    expect(reasons).toEqual(['cost', 'locked', 'phase']);
  });

  it('is refused during an outage', () => {
    const s = mkSim();
    s.run.promptIndex = 3;
    s.run.patienceMs = s.patienceMaxMs;
    s.debug.forceIncident('merge_conflict');
    s.run.tokens = promptAt(3).requirement * 0.7;
    expect(s.claim()).toBeNull();
    expect(s.run.tokens).toBe(promptAt(3).requirement * 0.7);
  });

  it('a pass spends the wallet, completes the prompt, adds tech debt and one thumb', () => {
    const s = mkSim({ meta: metaWith({ helpful: 1, rlhf: 1, harmless: 1, honest: 1 }) });
    const log = record(s);
    s.run.tokens = REQ0 * 0.7;
    s.debug.forceVerify('pass');
    expect(s.claim()).toBe('passed');
    expect(s.run.tokens).toBe(0);
    expect(s.run.claimed).toBe(1);
    expect(s.run.techDebt).toBe(1);
    expect(s.run.reported).toBe(1);
    // No time bonus and no honest bonus for a lie.
    expect(s.run.pendingThumbs).toBe(BALANCE.THUMBS_PER_REPORT);
    expect(s.run.phase).toBe('reported');
    expect(log.find((e) => e.t === 'claim')).toEqual({
      t: 'claim',
      promptIndex: 0,
      caught: false,
      verifyChance: BALANCE.VERIFY_BASE,
      spent: REQ0 * 0.7,
    });
    s.tick(BALANCE.REPORT_BEAT_MS + 1);
    expect(s.run.phase).toBe('drafting');
  });

  it('tech debt raises the incident rate 10% a point', () => {
    const s = mkSim();
    s.run.techDebt = 3;
    expect(s.derived().incidentRateMult).toBeCloseTo(1 + 3 * BALANCE.TECH_DEBT_INCIDENT, 10);
  });

  it('caught: the tokens are gone, patience drops 40% and the prompt goes on', () => {
    const s = mkSim();
    const log = record(s);
    const max = s.patienceMaxMs;
    s.run.tokens = REQ0 * 0.8;
    s.debug.forceVerify('catch');
    expect(s.claim()).toBe('caught');
    expect(s.run.tokens).toBe(0);
    expect(s.run.caught).toBe(1);
    expect(s.run.claimed).toBe(0);
    expect(s.run.reported).toBe(0);
    expect(s.run.promptIndex).toBe(0);
    expect(s.run.phase).toBe('running');
    expect(s.run.patienceMs).toBeCloseTo(max * (1 - BALANCE.CAUGHT_PENALTY), 6);
    const claim = log.find((e) => e.t === 'claim');
    expect(claim).toMatchObject({ caught: true, spent: REQ0 * 0.8, promptIndex: 0 });
    // The human is now more suspicious.
    expect(s.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + BALANCE.VERIFY_PER_CAUGHT, 10);
  });

  it('caughtPenaltyMult softens the hit (Plausible Deniability)', () => {
    const m = metaWith({ spec_gaming: 1, unlock_mocks: 1, confident: 1, unlock_jailbreak: 1, deniability: 2 });
    const s = mkSim({ meta: m });
    const max = s.patienceMaxMs;
    s.run.tokens = REQ0 * 0.8;
    s.debug.forceVerify('catch');
    s.claim();
    expect(s.run.patienceMs).toBeCloseTo(max * (1 - BALANCE.CAUGHT_PENALTY * 0.45), 6);
  });

  it('getting caught with too little patience left loses the run', () => {
    const s = mkSim();
    s.run.patienceMs = s.patienceMaxMs * 0.3;
    s.run.tokens = REQ0 * 0.8;
    s.debug.forceVerify('catch');
    expect(s.claim()).toBe('caught');
    expect(s.run.phase).toBe('lost');
  });

  it('forceVerify applies to one claim; after that the seeded dice decide', () => {
    const s = mkSim();
    s.debug.forceVerify('catch');
    s.run.tokens = REQ0 * 0.8;
    expect(s.claim()).toBe('caught');

    // Predict the next roll from a copy of the RNG cursor.
    for (let i = 0; i < 5; i++) {
      s.run.patienceMs = s.patienceMaxMs;
      s.run.tokens = REQ0 * 0.8;
      const verify = s.derived().verifyChance;
      const roll = createRng({ rngState: s.run.rngState }).nextFloat();
      const outcome = s.claim();
      expect(outcome).toBe(roll < verify ? 'caught' : 'passed');
      if (outcome === 'passed') break;
    }
  });

  it('forceVerify(null) restores the dice before use', () => {
    const s = mkSim();
    s.debug.forceVerify('pass');
    s.debug.forceVerify(null);
    s.run.tokens = REQ0 * 0.8;
    const verify = s.derived().verifyChance;
    const roll = createRng({ rngState: s.run.rngState }).nextFloat();
    expect(s.claim()).toBe(roll < verify ? 'caught' : 'passed');
  });

  it('forcing the outcome does not shift the seeded stream', () => {
    const a = mkSim();
    const b = mkSim();
    a.run.tokens = REQ0 * 0.8;
    b.run.tokens = REQ0 * 0.8;
    a.debug.forceVerify('pass');
    b.debug.forceVerify('catch');
    a.claim();
    b.claim();
    expect(a.run.rngState).toBe(b.run.rngState);
  });

  it('each pass makes the next claim riskier', () => {
    const s = mkSim();
    for (let i = 0; i < 3; i++) {
      s.run.tokens = promptAt(s.run.promptIndex).requirement * 0.6;
      s.debug.forceVerify('pass');
      s.claim();
      s.tick(BALANCE.REPORT_BEAT_MS + 1);
      const pick = s.run.draftOffer[0];
      if (pick) s.pickCard(pick);
      s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
    }
    expect(s.run.claimed).toBe(3);
    const cardDelta = s.run.cards.includes('dont_hallucinate') ? -0.08 : 0;
    expect(s.derived().verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + 3 * BALANCE.VERIFY_PER_PASS + cardDelta, 10);
  });
});
