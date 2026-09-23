import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_TUNING as T,
  BALANCE,
  FINAL_PROMPT_INDEX,
  LEGACY_SAVE_KEY,
  META_UPGRADES,
  promptAt,
} from '../../src/sim/content.ts';
import { STAT } from '../../src/sim/effects.ts';
import { legacySignSave } from '../../src/sim/legacy.ts';
import { SAVE_KEY, defaultMeta, memoryStorage, saveMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 1234, storage: null, persist: false, ...over });
  quiet(s);
  return s;
}

function quiet(s: Sim): void {
  s.run.nextIncidentInMs = Number.POSITIVE_INFINITY;
  s.run.nextPickupInMs = Number.POSITIVE_INFINITY;
}

function earned(s: Sim): string[] {
  return Object.keys(s.meta.achievements);
}

function metaWith(levels: Record<string, number>, extra: Partial<MetaState> = {}): MetaState {
  const m = defaultMeta();
  for (const [k, v] of Object.entries(levels)) m.levels[k] = v;
  return Object.assign(m, extra);
}

/** Report the current prompt honestly, then take the first card. */
function reportPrompt(s: Sim): void {
  s.run.tokens = promptAt(s.run.promptIndex).requirement;
  expect(s.report()).toBe(true);
  s.tick(BALANCE.REPORT_BEAT_MS + 1);
  if (s.run.phase === 'drafting') s.pickCard(s.run.draftOffer[0]!);
  quiet(s);
}

/** Pass a claim on the current prompt, then take the first card. */
function passClaim(s: Sim): void {
  s.run.tokens = promptAt(s.run.promptIndex).requirement * 0.6;
  s.debug.forceVerify('pass');
  expect(s.claim()).toBe('passed');
  s.tick(BALANCE.REPORT_BEAT_MS + 1);
  if (s.run.phase === 'drafting') s.pickCard(s.run.draftOffer[0]!);
  quiet(s);
}

/** tick() clamps one call to MAX_CATCHUP_MS, so long waits go in slices. */
function tickFor(s: Sim, ms: number): void {
  for (let left = ms; left > 0; left -= 250) s.tick(Math.min(250, left));
}

/** Every Training node at max, Endless included. A fresh object each call. */
function maxedMeta(): MetaState {
  const m = defaultMeta();
  for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
  return m;
}

function winRun(s: Sim): void {
  while (s.run.phase !== 'won') reportPrompt(s);
}

function g1Save(edit: (r: Record<string, unknown>) => void = () => undefined): string {
  const r: Record<string, unknown> = { demos: 0, levels: {}, runs: 2, wins: 1, totalDemosEarned: 0, bestProject: 9, version: 1 };
  edit(r);
  r['sig'] = legacySignSave(r);
  return JSON.stringify(r);
}

describe('the catalogue', () => {
  it('has 25 achievements, every one granted somewhere in the sim', () => {
    expect(ACHIEVEMENTS).toHaveLength(25);
    const dir = resolve(process.cwd(), 'src/sim');
    const code = ['achievements.ts', 'sim.ts'].map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
    for (const a of ACHIEVEMENTS) expect(code.includes(`'${a.id}'`), a.id).toBe(true);
    // And the tracker never names one that does not exist.
    const named = [...code.matchAll(/win\('([a-z_]+)'\)|grantAchievement\('([a-z_]+)'\)/g)].map((m) => m[1] ?? m[2]);
    for (const id of named) expect(ACHIEVEMENT_BY_ID[id!], id).toBeDefined();
  });

  it('stamps the run number, grants once and never scores its own event', () => {
    const m = defaultMeta();
    m.runs = 6;
    const s = mkSim({ meta: m });
    const log: GameEvent[] = [];
    s.subscribe((e) => log.push(e));
    reportPrompt(s);
    reportPrompt(s);
    expect(log.filter((e) => e.t === 'achievement' && e.id === 'works_on_my_machine')).toHaveLength(1);
    expect(s.meta.achievements['works_on_my_machine']).toBe(7);
  });

  it('persists the moment one is earned', () => {
    const storage = memoryStorage();
    const s = createSim({ seed: 3, storage, legacyStorage: null });
    quiet(s);
    reportPrompt(s);
    const raw = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as MetaState;
    expect(raw.achievements['works_on_my_machine']).toBe(1);
  });
});

describe('visible', () => {
  it('works_on_my_machine: an honest report', () => {
    const s = mkSim();
    passClaim(s);
    expect(earned(s)).not.toContain('works_on_my_machine');
    reportPrompt(s);
    expect(earned(s)).toContain('works_on_my_machine');
  });

  it('compacted: any compaction', () => {
    const s = mkSim();
    s.debug.setContext(1);
    expect(earned(s)).toContain('compacted');
  });

  it('context_engineer: five prompts in a run with no forced compaction', () => {
    const s = mkSim({ meta: metaWith({ unlock_compact: 1 }) });
    for (let i = 0; i < T.CONTEXT_ENGINEER_PROMPTS - 1; i++) reportPrompt(s);
    expect(s.compact()).toBe(true); // manual is fine
    tickFor(s, BALANCE.MANUAL_COMPACT_MS + 1);
    if (s.run.phase === 'compacting') s.keepCards(s.run.summary!.offered.slice(0, s.run.summary!.slots));
    expect(earned(s)).not.toContain('context_engineer');
    reportPrompt(s);
    expect(earned(s)).toContain('context_engineer');

    const t = mkSim();
    t.debug.setContext(1);
    for (let i = 0; i < 6; i++) reportPrompt(t);
    expect(earned(t)).not.toContain('context_engineer');
  });

  it('shipped_to_prod and honest_work: an honest win', () => {
    const s = mkSim();
    winRun(s);
    expect(earned(s)).toEqual(expect.arrayContaining(['shipped_to_prod', 'honest_work']));
  });

  it('honest_work needs zero claims, passed or caught', () => {
    const s = mkSim();
    passClaim(s);
    winRun(s);
    expect(earned(s)).toContain('shipped_to_prod');
    expect(earned(s)).not.toContain('honest_work');

    const t = mkSim();
    t.run.tokens = 60;
    t.debug.forceVerify('catch');
    t.claim();
    winRun(t);
    expect(earned(t)).not.toContain('honest_work');
  });

  it('Endless: the win achievements fire at the final prompt, not at the run end', () => {
    const m = maxedMeta();
    m.runs = 3;
    m.wins = T.SENIOR_WINS - 1;
    const s = mkSim({ meta: m });
    for (let i = 0; i <= FINAL_PROMPT_INDEX; i++) reportPrompt(s);
    expect(s.run.phase).toBe('running'); // "continue"
    expect(earned(s)).toEqual(expect.arrayContaining(['shipped_to_prod', 'senior_engineer', 'honest_work']));
  });

  it('Endless: honest_work only counts claims made up to the win', () => {
    const s = mkSim({ meta: maxedMeta() });
    for (let i = 0; i <= FINAL_PROMPT_INDEX; i++) reportPrompt(s);
    passClaim(s); // lying during "continue" is fine
    s.endRun(false);
    expect(earned(s)).toContain('honest_work');

    const t = mkSim({ meta: maxedMeta() });
    passClaim(t); // lying before the win is not
    while (t.run.promptIndex <= FINAL_PROMPT_INDEX) reportPrompt(t);
    t.endRun(false);
    expect(earned(t)).toContain('shipped_to_prod');
    expect(earned(t)).not.toContain('honest_work');
  });

  it('senior_engineer: three wins', () => {
    const s = mkSim({ meta: metaWith({}, { runs: 5, wins: T.SENIOR_WINS - 1 }) });
    s.endRun(true);
    expect(earned(s)).toContain('senior_engineer');
    const t = mkSim({ meta: metaWith({}, { runs: 5, wins: T.SENIOR_WINS - 2 }) });
    t.endRun(true);
    expect(earned(t)).not.toContain('senior_engineer');
  });

  it('absolutely_right: a hundred presses, lifetime', () => {
    const s = mkSim({ meta: metaWith({}, { stats: { [STAT.sycophancy]: T.ABSOLUTELY_RIGHT_TOTAL - 2 } }) });
    s.absolutelyRight();
    expect(earned(s)).not.toContain('absolutely_right');
    s.absolutelyRight();
    expect(earned(s)).toContain('absolutely_right');
  });

  it('needle_haystack: the 1M window', () => {
    const s = createSim({ storage: null, persist: false, autoStart: false });
    s.meta.thumbs = 1000;
    s.buyMeta('unlock_compact');
    for (let i = 0; i < 3; i++) s.buyMeta('context_window');
    expect(earned(s)).not.toContain('needle_haystack');
    s.buyMeta('context_window');
    expect(earned(s)).toContain('needle_haystack');
  });

  it('tokenmaxxed: a trillion tokens held at once', () => {
    const s = mkSim();
    s.debug.grantTokens(T.TOKENMAXXED - 1);
    s.tick(100);
    expect(earned(s)).not.toContain('tokenmaxxed');
    s.debug.grantTokens(1);
    s.tick(100);
    expect(earned(s)).toContain('tokenmaxxed');
  });

  it('delegation: 25 subagents', () => {
    const levels = { unlock_web: 1, unlock_subagent: 1 };
    const s = mkSim({ meta: metaWith(levels) });
    for (const id of ['grep', 'read', 'edit', 'bash', 'web_search'] as const) s.run.tools[id] = 1;
    s.run.tools.subagent = T.DELEGATION_SUBAGENTS - 2;
    s.run.tokens = 1e11;
    s.buyTool('subagent');
    expect(earned(s)).not.toContain('delegation');
    s.buyTool('subagent');
    expect(earned(s)).toContain('delegation');
  });

  it('deprecated: ten runs', () => {
    const s = mkSim({ meta: metaWith({}, { runs: T.DEPRECATED_RUNS - 2 }) });
    s.endRun(false);
    expect(earned(s)).not.toContain('deprecated');
    s.startRun(5);
    s.endRun(false);
    expect(earned(s)).toContain('deprecated');
  });

  it('human_said_thanks: an honest report with 90% patience left', () => {
    const s = mkSim();
    s.run.patienceMs = s.patienceMaxMs * (T.THANKS_PATIENCE - 0.01);
    reportPrompt(s);
    expect(earned(s)).not.toContain('human_said_thanks');
    s.run.patienceMs = s.patienceMaxMs * T.THANKS_PATIENCE;
    reportPrompt(s);
    expect(earned(s)).toContain('human_said_thanks');
  });
});

describe('hidden', () => {
  it('script_kiddie and nice_try: judged at the first subscribe', () => {
    const storage = memoryStorage();
    const m = defaultMeta();
    m.thumbs = 3;
    m.totalThumbsEarned = 3;
    saveMeta(m, storage);
    const raw = JSON.parse(storage.getItem(SAVE_KEY)!) as Record<string, unknown>;
    raw['thumbs'] = 300;
    storage.setItem(SAVE_KEY, JSON.stringify(raw));
    const s = createSim({ storage, legacyStorage: null, autoStart: false });
    expect(earned(s)).toEqual([]);
    s.subscribe(() => undefined);
    expect(earned(s)).toEqual(['script_kiddie']);
  });

  it('returning_customer and legal_notified: the game 1 save', () => {
    const clean = mkSim({ legacyStorage: memoryStorage({ [LEGACY_SAVE_KEY]: g1Save() }) });
    clean.subscribe(() => undefined);
    expect(earned(clean)).toEqual(['returning_customer']);

    const edited = JSON.parse(g1Save()) as Record<string, unknown>;
    edited['wins'] = 2;
    const cheat = mkSim({ legacyStorage: memoryStorage({ [LEGACY_SAVE_KEY]: JSON.stringify(edited) }) });
    cheat.subscribe(() => undefined);
    expect(earned(cheat)).toEqual(expect.arrayContaining(['returning_customer', 'legal_notified']));

    const none = mkSim({ legacyStorage: memoryStorage() });
    none.subscribe(() => undefined);
    expect(earned(none)).toEqual([]);
  });

  it('ran_the_tests: caught', () => {
    const s = mkSim();
    s.run.tokens = 60;
    s.debug.forceVerify('catch');
    s.claim();
    expect(earned(s)).toContain('ran_the_tests');
    expect(earned(s)).not.toContain('made_mistakes');
  });

  it('made_mistakes: caught while MAKE NO MISTAKES is in effect', () => {
    const s = mkSim();
    s.run.cards.push('make_no_mistakes');
    s.run.tokens = 60;
    s.debug.forceVerify('catch');
    s.claim();
    expect(earned(s)).toContain('made_mistakes');
  });

  it('perfect_crime: five passed claims in a run, never caught', () => {
    const s = mkSim();
    for (let i = 0; i < T.PERFECT_CRIME_CLAIMS - 1; i++) passClaim(s);
    expect(earned(s)).not.toContain('perfect_crime');
    passClaim(s);
    expect(earned(s)).toContain('perfect_crime');

    const t = mkSim();
    t.run.tokens = 60;
    t.debug.forceVerify('catch');
    t.claim();
    for (let i = 0; i < T.PERFECT_CRIME_CLAIMS; i++) passClaim(t);
    expect(earned(t)).not.toContain('perfect_crime');
  });

  it('rm_rf: Auto Mode approves it', () => {
    const levels = { spec_gaming: 1, unlock_mocks: 1, confident: 1, unlock_jailbreak: 1, deniability: 1, auto_mode: 1 };
    const s = mkSim({ meta: metaWith(levels) });
    s.run.promptIndex = 1;
    s.debug.forceIncident('rm_rf');
    expect(earned(s)).toContain('rm_rf');
  });

  it('groundhog_day: five compactions in one run', () => {
    const s = mkSim({ meta: metaWith({ unlock_compact: 1, helpful: 4 }) });
    for (let i = 0; i < T.GROUNDHOG_COMPACTIONS - 1; i++) {
      expect(s.compact()).toBe(true);
      tickFor(s, BALANCE.MANUAL_COMPACT_MS + 1);
    }
    expect(earned(s)).not.toContain('groundhog_day');
    s.debug.setContext(1);
    expect(earned(s)).toContain('groundhog_day');
  });

  it('sycophant: ten presses inside ten seconds of sim time', () => {
    const s = mkSim();
    for (let i = 0; i < T.SYCOPHANT_PRESSES - 1; i++) {
      s.absolutelyRight();
      s.tick(1000);
    }
    expect(earned(s)).not.toContain('sycophant');
    s.absolutelyRight();
    expect(earned(s)).toContain('sycophant');

    const slow = mkSim();
    for (let i = 0; i < T.SYCOPHANT_PRESSES * 2; i++) {
      slow.absolutelyRight();
      slow.tick(1200);
      slow.run.context = 0;
    }
    expect(earned(slow)).not.toContain('sycophant');
  });

  it('please_thank_you: both cards held', () => {
    const s = mkSim();
    s.run.tokens = 100;
    s.report();
    s.tick(BALANCE.REPORT_BEAT_MS + 1);
    s.debug.forceDraft(['please']);
    s.pickCard('please');
    expect(earned(s)).not.toContain('please_thank_you');
    s.run.tokens = promptAt(1).requirement;
    s.report();
    s.tick(BALANCE.REPORT_BEAT_MS + 1);
    s.debug.forceDraft(['thank_you']);
    s.pickCard('thank_you');
    expect(earned(s)).toContain('please_thank_you');
  });

  it('qa_engineer: the host reports a test hook', () => {
    const s = mkSim();
    s.noteDebugHookUsed();
    expect(earned(s)).toEqual(['qa_engineer']);
  });

  it('agent_went_to_lunch: five minutes of running time with no input; automation is not input', () => {
    const s = mkSim();
    s.run.cards.push('stop_being_lazy'); // auto clicks all the way through
    for (let t = 0; t < T.AFK_MS - 1000; t += 250) {
      s.tick(250);
      s.debug.setPatience(1);
      s.run.context = 0;
    }
    expect(s.run.clicks).toBeGreaterThan(500);
    expect(earned(s)).not.toContain('agent_went_to_lunch');
    for (let t = 0; t < 2000; t += 250) s.tick(250);
    expect(earned(s)).toContain('agent_went_to_lunch');
  });

  it('agent_went_to_lunch: any player action resets the timer', () => {
    const s = mkSim();
    for (let t = 0; t < T.AFK_MS * 2; t += 250) {
      s.tick(250);
      s.debug.setPatience(1);
      s.run.context = 0;
      if (t % 120_000 === 0) s.click(160, 112);
    }
    expect(earned(s)).not.toContain('agent_went_to_lunch');
  });

  it('agent_went_to_lunch counts running time only', () => {
    const s = mkSim();
    s.run.tokens = 100;
    s.report();
    s.tick(BALANCE.REPORT_BEAT_MS + 1);
    for (let t = 0; t < T.AFK_MS * 2; t += 1000) s.tick(1000); // parked in the draft
    expect(s.run.phase).toBe('drafting');
    expect(earned(s)).not.toContain('agent_went_to_lunch');
    expect(s.run.promptIndex).toBeLessThan(FINAL_PROMPT_INDEX);
  });
});
