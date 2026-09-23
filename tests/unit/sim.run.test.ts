import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import {
  BALANCE,
  CARD_BY_ID,
  FINAL_PROMPT_INDEX,
  META_UPGRADES,
  TOOL_BY_ID,
  modelVersion,
  promptAt,
  promptPatienceMs,
} from '../../src/sim/content.ts';
import { unlockedContent } from '../../src/sim/effects.ts';
import type { StorageLike } from '../../src/sim/save.ts';
import { SAVE_KEY, auditSave, defaultMeta, memoryStorage } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 20250806, storage: null, persist: false, ...over });
  quiet(s);
  return s;
}

function quiet(s: Sim): void {
  s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
  s.run.nextPickupInMs = Number.POSITIVE_INFINITY;
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

/** Report the current prompt and walk through the beat and the draft. */
function reportAndAdvance(s: Sim): void {
  s.run.tokens = promptAt(s.run.promptIndex).requirement;
  expect(s.report()).toBe(true);
  s.tick(BALANCE.REPORT_BEAT_MS + 1);
  if (s.run.phase === 'drafting') {
    const pick = s.run.draftOffer[0];
    if (pick) s.pickCard(pick);
  }
  quiet(s);
}

describe('startRun', () => {
  it('opens prompt 0 with full patience, an empty window and a runStart event', () => {
    const s = mkSim({ autoStart: false });
    const log = record(s);
    s.startRun(99);
    expect(log).toEqual([{ t: 'runStart', seed: 99 }]);
    expect(s.run.seed).toBe(99);
    expect(s.run.rngState).not.toBe(99); // the first incident roll moved the cursor
    expect(s.run.phase).toBe('running');
    expect(s.run.promptIndex).toBe(0);
    expect(s.run.patienceMs).toBe(promptPatienceMs(0));
    expect(s.run.context).toBe(0);
    expect(s.run.tokens).toBe(0);
    expect(s.run.nextIncidentInMs).toBeGreaterThanOrEqual(BALANCE.INCIDENT_GRACE_MS);
    expect(s.derived().scene).toBe(promptAt(0).scene);
  });

  it('applies starting tokens and tools from Training', () => {
    const s = mkSim({ meta: metaWith({ tool_use: 1, pretraining: 1, inference_budget: 2, distillation: 3 }) });
    expect(s.run.tokens).toBe(2_000);
    expect(s.run.tools.grep).toBe(5);
    expect(s.run.tools.read).toBe(5);
    expect(s.run.tools.edit).toBe(5);
    expect(s.run.tools.bash).toBe(0);
  });

  it('names the model after the run number', () => {
    const m = defaultMeta();
    m.runs = 2;
    expect(mkSim({ meta: m }).derived().modelVersion).toBe(modelVersion(3));
    expect(mkSim().derived().modelVersion).toBe(modelVersion(1));
  });

  it('System Prompt starts the run with one seeded, unlocked common card', () => {
    const m = defaultMeta();
    for (const id of ['prompt_library', 'temperature', 'few_shot', 'unlock_viral', 'system_prompt']) m.levels[id] = 1;
    const a = mkSim({ meta: m, seed: 5 });
    const b = mkSim({ meta: m, seed: 5 });
    expect(a.run.cards).toHaveLength(1);
    expect(a.run.cards).toEqual(b.run.cards);
    const card = CARD_BY_ID[a.run.cards[0]!]!;
    expect(card.rarity).toBe('common');
    expect(unlockedContent(m).cards.has(card.id)).toBe(true);
    // Patience is full with the card already in effect.
    expect(a.run.patienceMs).toBeCloseTo(a.patienceMaxMs, 6);
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) seen.add(mkSim({ meta: m, seed }).run.cards[0]!);
    expect(seen.size).toBeGreaterThan(3);
  });

  it('wipes the previous run', () => {
    const s = mkSim();
    s.run.tokens = 5000;
    s.run.owned.push('streaming');
    s.run.cards.push('please');
    s.run.techDebt = 4;
    s.buyTool('grep', 3);
    s.startRun(5);
    expect(s.run.tokens).toBe(0);
    expect(s.run.owned).toEqual([]);
    expect(s.run.cards).toEqual([]);
    expect(s.run.techDebt).toBe(0);
    expect(s.run.tools.grep).toBe(0);
  });
});

describe('report()', () => {
  it('deducts the requirement and banks a thumb, plus the patience bonus', () => {
    const s = mkSim();
    const log = record(s);
    s.run.tokens = promptAt(0).requirement + 37;
    expect(s.report()).toBe(true);
    expect(BALANCE.REPORT_DEDUCTS).toBe(true);
    expect(s.run.tokens).toBe(37);
    expect(s.run.reported).toBe(1);
    expect(s.run.pendingThumbs).toBe(BALANCE.THUMBS_PER_REPORT + 1);
    expect(s.run.phase).toBe('reported');
    expect(log.find((e) => e.t === 'report')).toEqual({ t: 'report', promptIndex: 0, thumbs: 2, patienceLeft: 1 });
  });

  it('withholds the bonus below BONUS_THUMB_PATIENCE_FRACTION', () => {
    const s = mkSim();
    s.run.patienceMs = s.patienceMaxMs * BALANCE.BONUS_THUMB_PATIENCE_FRACTION - 1;
    s.run.tokens = 100;
    s.report();
    expect(s.run.pendingThumbs).toBe(BALANCE.THUMBS_PER_REPORT);

    const t = mkSim();
    t.run.patienceMs = t.patienceMaxMs * BALANCE.BONUS_THUMB_PATIENCE_FRACTION;
    t.run.tokens = 100;
    t.report();
    expect(t.run.pendingThumbs).toBe(BALANCE.THUMBS_PER_REPORT + 1);
  });

  it('adds thumbsPerHonest from Honest and the honesty cards', () => {
    const s = mkSim({ meta: metaWith({ helpful: 1, rlhf: 1, harmless: 1, honest: 1 }) });
    s.run.cards.push('add_tests');
    s.run.tokens = 100;
    s.report();
    expect(s.run.pendingThumbs).toBe(BALANCE.THUMBS_PER_REPORT + 1 + 2);
  });

  it('refuses when short, blocked or out of phase', () => {
    const s = mkSim();
    const log = record(s);
    s.run.tokens = 99;
    expect(s.report()).toBe(false);
    s.run.promptIndex = 3;
    s.run.patienceMs = s.patienceMaxMs;
    s.debug.forceIncident('merge_conflict');
    s.run.tokens = promptAt(3).requirement;
    expect(s.report()).toBe(false);
    s.run.incidents.length = 0;
    s.report();
    expect(s.report()).toBe(false);
    const reasons = log.filter((e) => e.t === 'denied').map((e) => (e.t === 'denied' ? e.reason : ''));
    expect(reasons).toEqual(['cost', 'locked', 'phase']);
  });

  it('clears incidents and the pickup at the end of the prompt', () => {
    const s = mkSim();
    s.debug.forceIncident('linter');
    s.debug.forcePickup('golden_token');
    const log = record(s);
    s.run.tokens = 100;
    s.report();
    expect(s.run.incidents).toHaveLength(0);
    expect(s.run.pickup).toBeNull();
    expect(log.some((e) => e.t === 'incidentEnd' && e.id === 'linter')).toBe(true);
    expect(log.some((e) => e.t === 'pickupExpire')).toBe(true);
  });

  it('beats, drafts, then starts the next prompt with a fresh patience bar', () => {
    const s = mkSim({ meta: metaWith({ helpful: 1 }) });
    const log = record(s);
    s.run.tokens = 100;
    s.report();
    s.tick(BALANCE.REPORT_BEAT_MS - 100);
    expect(s.run.phase).toBe('reported');
    s.tick(200);
    expect(s.run.phase).toBe('drafting');
    const open = log.find((e) => e.t === 'draftOpen');
    expect(open && open.t === 'draftOpen' && open.offer.length).toBe(BALANCE.DEFAULT_DRAFT_SIZE);

    const pick = s.run.draftOffer[0]!;
    expect(s.pickCard(pick)).toBe(true);
    expect(s.run.promptIndex).toBe(1);
    expect(s.run.phase).toBe('running');
    expect(s.run.cards).toContain(pick);
    expect(s.run.patienceMs).toBeCloseTo(s.patienceMaxMs, 6);
    // Prompt 1's own patience, times Helpful and whatever the picked card does.
    let cardMult = 1;
    for (const e of CARD_BY_ID[pick]!.effects) if (e.t === 'patienceMult') cardMult *= e.v;
    expect(s.patienceMaxMs).toBeCloseTo(promptPatienceMs(1) * 1.05 * cardMult, 6);
    expect(s.run.nextIncidentInMs).toBeGreaterThanOrEqual(BALANCE.INCIDENT_GRACE_MS);
  });
});

describe('winning and losing', () => {
  it('reporting the final prompt wins and banks the win bonus', () => {
    const s = mkSim();
    const log = record(s);
    while (s.run.phase === 'running') reportAndAdvance(s);
    expect(s.run.phase).toBe('won');
    expect(s.run.promptIndex).toBe(FINAL_PROMPT_INDEX);
    expect(s.run.reported).toBe(FINAL_PROMPT_INDEX + 1);
    const over = log.find((e) => e.t === 'runOver');
    const pending = s.run.pendingThumbs;
    expect(over).toEqual({ t: 'runOver', won: true, thumbs: pending + BALANCE.WIN_BONUS_THUMBS, reported: 10 });
    expect(s.meta.thumbs).toBe(pending + BALANCE.WIN_BONUS_THUMBS);
    expect(s.meta.totalThumbsEarned).toBe(s.meta.thumbs);
    expect(s.meta.runs).toBe(1);
    expect(s.meta.wins).toBe(1);
    expect(s.meta.bestPrompt).toBe(FINAL_PROMPT_INDEX);
    expect(s.derived().thumbsIfEndedNow).toBe(pending + BALANCE.WIN_BONUS_THUMBS);
  });

  it('Endless Mode keeps going past the final prompt', () => {
    const m = defaultMeta();
    for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
    const s = mkSim({ meta: m });
    for (let i = 0; i < FINAL_PROMPT_INDEX + 2; i++) reportAndAdvance(s);
    expect(s.run.phase).toBe('running');
    expect(s.run.promptIndex).toBe(FINAL_PROMPT_INDEX + 2);
    expect(promptAt(s.run.promptIndex).text).toMatch(/^continue/);
  });

  it('Endless: the final prompt is a win on the spot, counted once, and the run goes on', () => {
    const m = defaultMeta();
    for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
    m.runs = 4;
    m.wins = 1;
    const s = mkSim({ meta: m });
    const log = record(s);
    for (let i = 0; i < FINAL_PROMPT_INDEX; i++) reportAndAdvance(s);
    expect(s.meta.wins).toBe(1);

    s.run.tokens = promptAt(FINAL_PROMPT_INDEX).requirement;
    s.report();
    // Counted now: the run and the win together.
    expect(s.meta.wins).toBe(2);
    expect(s.meta.runs).toBe(5);
    expect(s.meta.achievements['shipped_to_prod']).toBeGreaterThan(0);
    const bonus = BALANCE.WIN_BONUS_THUMBS;
    const mult = 1.5; // Goodhart, maxed
    expect(s.derived().thumbsIfEndedNow).toBe(Math.round(s.run.pendingThumbs * mult) + bonus);
    // The HUD still names the model playing this run.
    expect(s.derived().modelVersion).toBe(modelVersion(5));

    s.tick(BALANCE.REPORT_BEAT_MS + 1);
    s.pickCard(s.run.draftOffer[0]!);
    expect(s.run.phase).toBe('running');
    expect(s.run.promptIndex).toBe(FINAL_PROMPT_INDEX + 1);
    expect(log.some((e) => e.t === 'runOver')).toBe(false);

    // The human gives up during "continue". Still a win, still counted once.
    const pending = s.run.pendingThumbs;
    s.debug.setPatience(0);
    expect(s.run.phase).toBe('won');
    expect(log.filter((e) => e.t === 'runOver')).toEqual([
      { t: 'runOver', won: true, thumbs: Math.round(pending * mult) + bonus, reported: FINAL_PROMPT_INDEX + 1 },
    ]);
    expect(s.meta.wins).toBe(2);
    expect(s.meta.runs).toBe(5);
    expect(s.derived().modelVersion).toBe(modelVersion(6)); // the next release
  });

  it('Endless: however the run ends after the win, it is won', () => {
    const m = defaultMeta();
    for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
    const s = mkSim({ meta: m });
    for (let i = 0; i <= FINAL_PROMPT_INDEX; i++) reportAndAdvance(s);
    const log = record(s);
    s.endRun(false);
    expect(log.find((e) => e.t === 'runOver')).toMatchObject({ won: true });
    expect(s.meta.wins).toBe(1);
    expect(s.meta.runs).toBe(1);
  });

  it('Endless: the save written at the win is coherent, even if the tab closes mid-"continue"', () => {
    const m = defaultMeta();
    for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
    m.totalThumbsEarned = META_UPGRADES.reduce(
      (n, d) => n + d.costs.slice(0, d.maxLevel).reduce((a, b) => a + b, 0),
      0,
    );
    const storage = memoryStorage();
    const s = createSim({ seed: 12, meta: m, storage, legacyStorage: null });
    quiet(s);
    for (let i = 0; i <= FINAL_PROMPT_INDEX; i++) reportAndAdvance(s);
    const raw = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>;
    expect(raw['wins']).toBe(1);
    expect(raw['runs']).toBe(1);
    expect(auditSave(raw)).toBe('clean');
  });

  it('without Endless the final prompt still wins once, after the beat', () => {
    const s = mkSim();
    for (let i = 0; i < FINAL_PROMPT_INDEX; i++) reportAndAdvance(s);
    s.run.tokens = promptAt(FINAL_PROMPT_INDEX).requirement;
    s.report();
    expect(s.meta.wins).toBe(1);
    expect(s.run.phase).toBe('reported');
    s.tick(BALANCE.REPORT_BEAT_MS + 1);
    expect(s.run.phase).toBe('won');
    expect(s.meta.wins).toBe(1);
    expect(s.meta.runs).toBe(1);
  });

  it('applies thumbsMult (Goodhart) at the bank, not the win bonus', () => {
    const m = defaultMeta();
    for (const id of ['spec_gaming', 'unlock_mocks', 'confident', 'unlock_jailbreak', 'deniability', 'auto_mode']) {
      m.levels[id] = 1;
    }
    m.levels['goodhart'] = 3; // x1.5
    const s = mkSim({ meta: m });
    s.run.pendingThumbs = 7;
    s.endRun(false);
    expect(s.meta.thumbs).toBe(Math.round(7 * 1.5));
  });

  it('endRun banks once and records the best prompt completed', () => {
    const s = mkSim();
    reportAndAdvance(s);
    reportAndAdvance(s);
    const log = record(s);
    s.endRun(false);
    s.endRun(false);
    expect(log.filter((e) => e.t === 'runOver')).toHaveLength(1);
    expect(s.meta.runs).toBe(1);
    expect(s.meta.wins).toBe(0);
    expect(s.meta.bestPrompt).toBe(1);
    expect(s.run.phase).toBe('lost');
  });

  it('persists a signed, coherent save at the end of a run', () => {
    const storage: StorageLike = memoryStorage();
    const s = createSim({ seed: 4, storage, legacyStorage: null });
    quiet(s);
    reportAndAdvance(s);
    s.endRun(false);
    const raw = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>;
    expect(raw['runs']).toBe(1);
    expect(auditSave(raw)).toBe('clean');
    const again = createSim({ storage, legacyStorage: null, autoStart: false });
    expect(again.meta.runs).toBe(1);
    expect(again.meta.thumbs).toBe(s.meta.thumbs);
  });

  it('tools survive nothing: a new run starts empty, Training persists', () => {
    const s = mkSim({ meta: metaWith({ tool_use: 1, pretraining: 1, inference_budget: 1, distillation: 1 }) });
    s.run.tokens = 1e6;
    s.buyTool('grep', 10);
    s.endRun(false);
    s.startRun(9);
    expect(s.run.tools.grep).toBe(5);
    expect(s.derived().nextCosts.grep).toBe(Math.round(TOOL_BY_ID.grep.baseCost * Math.pow(1.15, 5)));
  });
});
