import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { BALANCE, TOOL_BY_ID } from '../../src/sim/content.ts';
import { STAT } from '../../src/sim/effects.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 7, storage: null, persist: false, ...over });
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

const COMPACT = { unlock_compact: 1 };

function tickFor(s: Sim, ms: number): void {
  for (let left = ms; left > 0; left -= 100) s.tick(Math.min(100, left));
}

describe('the window', () => {
  it('starts at the base 8K and grows with Training', () => {
    expect(mkSim().derived().contextMax).toBe(BALANCE.BASE_CONTEXT);
    expect(mkSim({ meta: metaWith({ ...COMPACT, context_window: 1 }) }).derived().contextMax).toBe(32_000);
    expect(mkSim({ meta: metaWith({ ...COMPACT, context_window: 5 }) }).derived().contextMax).toBe(10_000_000);
  });

  it('each click adds CTX_PER_CLICK x clickContextMult', () => {
    const s = mkSim();
    s.click(160, 112);
    expect(s.run.context).toBe(BALANCE.CTX_PER_CLICK);
    s.run.owned.push('concise_mode'); // 0.6
    s.run.cards.push('think_step_by_step'); // 2
    expect(s.derived().clickContext).toBeCloseTo(BALANCE.CTX_PER_CLICK * 0.6 * 2, 10);
    s.click(160, 112);
    expect(s.run.context).toBeCloseTo(BALANCE.CTX_PER_CLICK * (1 + 1.2), 10);
  });

  it('tools add owned x footprint x toolFootprintMult x footprintMult per second', () => {
    const s = mkSim();
    s.run.tools.grep = 4;
    s.run.tools.read = 2;
    s.run.owned.push('line_ranges', 'prompt_caching'); // read x0.5, all x0.75
    const expected = (4 * TOOL_BY_ID.grep.footprint + 2 * TOOL_BY_ID.read.footprint * 0.5) * 0.75;
    expect(s.derived().contextRate).toBeCloseTo(expected, 10);
    tickFor(s, 1000);
    expect(s.run.context).toBeCloseTo(expected, 8);
  });

  it('MCP manuals are a permanent floor the window never goes below', () => {
    const s = mkSim();
    s.run.tools.mcp_server = 3;
    const floor = 3 * TOOL_BY_ID.mcp_server.floor;
    expect(s.derived().contextFloor).toBe(floor);
    s.debug.setContext(0);
    expect(s.run.context).toBe(floor);
    s.run.owned.push('tool_search'); // floor x0.1
    expect(s.derived().contextFloor).toBeCloseTo(floor * 0.1, 10);
  });

  it('caps the floor at FLOOR_CAP_FRACTION of the window, everywhere it is used', () => {
    const s = mkSim();
    s.run.tools.mcp_server = 60; // 54,000 of manuals in an 8K window
    const cap = BALANCE.FLOOR_CAP_FRACTION * BALANCE.BASE_CONTEXT;
    expect(s.derived().contextFloor).toBe(cap);
    s.debug.setContext(0);
    expect(s.run.context).toBe(cap);
    s.debug.forceIncident('cache_hit_incident');
    expect(s.run.context).toBe(cap);
    s.debug.setContext(1);
    expect(s.run.context).toBeCloseTo(cap + BALANCE.SUMMARY_FRACTION * BALANCE.BASE_CONTEXT, 8);
    // A small fleet sits under the cap and is not touched by it.
    s.run.tools.mcp_server = 2;
    expect(s.derived().contextFloor).toBe(2 * TOOL_BY_ID.mcp_server.floor);
  });

  it('60 MCP servers in an 8K window do not compact every tick', () => {
    const s = mkSim();
    s.run.tools.mcp_server = 60;
    s.debug.setContext(1);
    expect(s.run.forcedCompactions).toBe(1);
    for (let t = 0; t < 20_000; t += 100) {
      s.tick(100);
      s.debug.setPatience(1);
    }
    // 60 x 6 context/s refills the ~3,600 of headroom in about ten seconds.
    expect(s.run.forcedCompactions).toBeGreaterThan(1);
    expect(s.run.forcedCompactions).toBeLessThanOrEqual(4);
    expect(s.run.phase).toBe('running');
  });

  it('instant context actions scale with the window and stop at the floor', () => {
    const s = mkSim();
    s.run.tools.mcp_server = 1;
    s.run.context = 2000;
    s.debug.forceIncident('screenshot'); // +15%
    expect(s.run.context).toBeCloseTo(2000 + 0.15 * BALANCE.BASE_CONTEXT, 8);
    s.debug.forceIncident('cache_hit_incident'); // -25%
    expect(s.run.context).toBeCloseTo(2000 + (0.15 - 0.25) * BALANCE.BASE_CONTEXT, 8);
    s.run.incidents.length = 0;
    s.debug.forceIncident('cache_hit_incident');
    expect(s.run.context).toBe(TOOL_BY_ID.mcp_server.floor);
  });

  it('warns once at each fill and re-arms after a compaction', () => {
    const s = mkSim();
    const log = record(s);
    const warns = (): number[] =>
      log.filter((e): e is Extract<GameEvent, { t: 'contextWarn' }> => e.t === 'contextWarn').map((e) => e.fill);
    s.run.context = 0.79 * BALANCE.BASE_CONTEXT;
    s.click(160, 112);
    s.click(160, 112);
    expect(warns()).toEqual([]);
    s.run.context = 0.8 * BALANCE.BASE_CONTEXT;
    s.click(160, 112);
    s.click(160, 112);
    expect(warns()).toEqual([0.8]);
    s.run.context = 0.96 * BALANCE.BASE_CONTEXT;
    s.click(160, 112);
    expect(warns()).toEqual([0.8, 0.95]);
    s.run.context = 0.5 * BALANCE.BASE_CONTEXT;
    s.run.context = 0.85 * BALANCE.BASE_CONTEXT;
    s.click(160, 112);
    expect(warns()).toEqual([0.8, 0.95]);
    s.debug.setContext(1); // forced compaction re-arms
    s.run.context = 0.81 * BALANCE.BASE_CONTEXT;
    s.click(160, 112);
    expect(warns()).toEqual([0.8, 0.95, 0.8]);
  });

  it('predicts the seconds to a forced compaction', () => {
    const s = mkSim();
    expect(s.derived().secondsToCompaction).toBe(Number.POSITIVE_INFINITY);
    s.run.tools.read = 10; // 70/s
    s.run.context = 1000;
    expect(s.derived().secondsToCompaction).toBeCloseTo((BALANCE.BASE_CONTEXT - 1000) / 70, 8);
  });
});

describe('forced compaction', () => {
  it('fires on overflow: keeps 25% of the wallet, costs 15% patience, resets the window', () => {
    const s = mkSim();
    const log = record(s);
    s.run.tokens = 80;
    const max = s.patienceMaxMs;
    s.run.patienceMs = max * 0.9;
    s.run.context = BALANCE.BASE_CONTEXT - 1;
    s.click(160, 112); // +24 context: overflow

    const tokensAfterClick = 80 + (log.find((e) => e.t === 'click') as { amount: number }).amount;
    expect(s.run.tokens).toBeCloseTo(tokensAfterClick * BALANCE.COMPACT_KEEP_FORCED, 8);
    expect(s.run.patienceMs).toBeCloseTo(max * (0.9 - BALANCE.COMPACT_PENALTY), 6);
    expect(s.run.context).toBeCloseTo(BALANCE.SUMMARY_FRACTION * BALANCE.BASE_CONTEXT, 8);
    expect(s.run.compactions).toBe(1);
    expect(s.run.forcedCompactions).toBe(1);
    expect(s.meta.stats[STAT.compactions]).toBe(1);
    expect(s.meta.stats[STAT.forcedCompactions]).toBe(1);
    expect(s.run.phase).toBe('running');

    const start = log.find((e) => e.t === 'compactStart');
    expect(start).toEqual({
      t: 'compactStart',
      forced: true,
      kept: tokensAfterClick * BALANCE.COMPACT_KEEP_FORCED,
      lost: tokensAfterClick * (1 - BALANCE.COMPACT_KEEP_FORCED),
    });
    expect(log.find((e) => e.t === 'compactEnd')).toEqual({ t: 'compactEnd', keptCards: [], droppedCards: [] });
  });

  it('fires from tool footprint during a tick', () => {
    const s = mkSim();
    s.run.tools.read = 20; // 140/s
    s.run.context = BALANCE.BASE_CONTEXT - 50;
    tickFor(s, 1000);
    expect(s.run.forcedCompactions).toBe(1);
  });

  it('keeps more with compactKeep, up to the cap, and hurts less with compactPenaltyMult', () => {
    const s = mkSim({ meta: metaWith({ ...COMPACT, context_window: 1, longer_summaries: 1, better_summaries: 3 }) });
    s.run.owned.push('summary_template'); // +0.15
    expect(s.derived().compactKeepForced).toBeCloseTo(BALANCE.COMPACT_KEEP_FORCED + 0.3 + 0.15, 10);
    expect(s.derived().compactKeepManual).toBe(BALANCE.COMPACT_KEEP_CAP); // 0.5 + 0.45 capped
  });

  it('sits in the fill after the floor', () => {
    const s = mkSim();
    s.run.tools.mcp_server = 2;
    s.debug.setContext(1);
    expect(s.run.context).toBeCloseTo(2 * TOOL_BY_ID.mcp_server.floor + BALANCE.SUMMARY_FRACTION * BALANCE.BASE_CONTEXT, 8);
  });

  it('can end the run when the human runs out of patience', () => {
    const s = mkSim();
    const log = record(s);
    s.run.patienceMs = s.patienceMaxMs * 0.1;
    s.debug.setContext(1);
    expect(s.run.phase).toBe('lost');
    const kinds = log.map((e) => e.t);
    expect(kinds.indexOf('compactStart')).toBeLessThan(kinds.indexOf('compactEnd'));
    expect(kinds.indexOf('compactEnd')).toBeLessThan(kinds.indexOf('runOver'));
  });

  it('only happens while running', () => {
    const s = mkSim();
    s.run.phase = 'drafting';
    s.debug.setContext(1);
    expect(s.run.compactions).toBe(0);
    s.run.phase = 'running';
    s.tick(10);
    expect(s.run.forcedCompactions).toBe(1);
  });
});

describe('manual /compact', () => {
  it('needs the Training unlock', () => {
    const s = mkSim();
    const log = record(s);
    expect(s.derived().canCompact).toBe(false);
    expect(s.compact()).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'locked' });
  });

  it('keeps half the wallet, costs no patience and pauses generation for 3 s', () => {
    const s = mkSim({ meta: metaWith(COMPACT) });
    const log = record(s);
    s.run.tools.grep = 10;
    s.run.tokens = 1000;
    s.run.context = 5000;
    const patience = s.run.patienceMs;
    expect(s.derived().canCompact).toBe(true);
    expect(s.compact()).toBe(true);

    expect(s.run.tokens).toBe(1000 * BALANCE.COMPACT_KEEP_MANUAL);
    expect(s.run.patienceMs).toBe(patience);
    expect(s.run.context).toBeCloseTo(BALANCE.SUMMARY_FRACTION * BALANCE.BASE_CONTEXT, 8);
    expect(s.run.compactingMs).toBe(BALANCE.MANUAL_COMPACT_MS);
    expect(s.run.compactions).toBe(1);
    expect(s.run.forcedCompactions).toBe(0);
    expect(log.find((e) => e.t === 'compactStart')).toEqual({ t: 'compactStart', forced: false, kept: 500, lost: 500 });

    const d = s.derived();
    expect(d.canCompact).toBe(false);
    expect(d.idleRate).toBe(0);
    expect(d.contextRate).toBe(0);
    expect(d.clickPower).toBe(0);
    expect(d.toolHalted.grep).toBe(true);

    // Clicks land on nothing, and the button cannot be spammed.
    expect(s.click(160, 112)).toBe(0);
    expect(s.run.clicks).toBe(0);
    expect(s.compact()).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'phase' });

    // Patience still drains through the pause.
    const before = s.run.tokens;
    tickFor(s, 1000);
    expect(s.run.patienceMs).toBeCloseTo(patience - 1000, 6);
    expect(s.run.tokens).toBe(before);

    tickFor(s, 2000);
    expect(s.run.compactingMs).toBe(0);
    expect(s.derived().idleRate).toBeGreaterThan(0);
    expect(s.click(160, 112)).toBeGreaterThan(0);
  });

  it('is refused outside the running phase', () => {
    const s = mkSim({ meta: metaWith(COMPACT) });
    s.run.phase = 'drafting';
    expect(s.compact()).toBe(false);
  });
});

describe('the summary picker', () => {
  function withCards(s: Sim, ids: string[]): void {
    for (const id of ids) s.run.cards.push(id);
  }

  it('opens when more cards are held than fit, and stops the clock', () => {
    const s = mkSim({ meta: metaWith(COMPACT) });
    const log = record(s);
    withCards(s, ['please', 'thank_you', 'tip_200']);
    s.run.tokens = 100;
    s.debug.setContext(1);

    expect(s.run.phase).toBe('compacting');
    expect(s.run.summary).toEqual({ offered: ['please', 'thank_you', 'tip_200'], slots: 1, forced: true });
    expect(log.some((e) => e.t === 'compactEnd')).toBe(false);

    const elapsed = s.run.elapsedMs;
    const patience = s.run.patienceMs;
    tickFor(s, 5000);
    expect(s.run.elapsedMs).toBe(elapsed);
    expect(s.run.patienceMs).toBe(patience);
    expect(s.click(160, 112)).toBe(0);
    expect(s.absolutelyRight()).toBe(false);
  });

  it('validates keepCards: at most `slots`, only offered, no duplicates, right phase', () => {
    const s = mkSim({ meta: metaWith(COMPACT) });
    const log = record(s);
    expect(s.keepCards([])).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'phase' });

    withCards(s, ['please', 'thank_you', 'tip_200']);
    s.debug.setContext(1);
    expect(s.keepCards(['please', 'thank_you'])).toBe(false); // over slots
    expect(s.keepCards(['grandma'])).toBe(false); // not offered
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'locked' });
    expect(s.run.phase).toBe('compacting');

    expect(s.keepCards(['thank_you'])).toBe(true);
    expect(s.run.cards).toEqual(['thank_you']);
    expect(s.run.summary).toBeNull();
    expect(s.run.phase).toBe('running');
    expect(log.at(-1)).toEqual({ t: 'compactEnd', keptCards: ['thank_you'], droppedCards: ['please', 'tip_200'] });
  });

  it('rejects duplicate ids even when they would fit', () => {
    const s = mkSim({ meta: metaWith({ ...COMPACT, context_window: 1, longer_summaries: 1 }) });
    withCards(s, ['please', 'thank_you', 'tip_200']);
    s.debug.setContext(1);
    expect(s.run.summary?.slots).toBe(2);
    expect(s.keepCards(['please', 'please'])).toBe(false);
    expect(s.keepCards([])).toBe(true); // keeping nothing is allowed
    expect(s.run.cards).toEqual([]);
  });

  it('resolves at once when every card fits in the summary', () => {
    const s = mkSim({ meta: metaWith(COMPACT) });
    const log = record(s);
    withCards(s, ['please']);
    s.debug.setContext(1);
    expect(s.run.phase).toBe('running');
    expect(log.find((e) => e.t === 'compactEnd')).toEqual({ t: 'compactEnd', keptCards: ['please'], droppedCards: [] });
  });

  it('counts summary slots from base, Training, upgrades and cards', () => {
    const s = mkSim({ meta: metaWith({ ...COMPACT, context_window: 1, longer_summaries: 3 }) });
    s.run.owned.push('todo_md');
    s.run.cards.push('remember_this');
    expect(s.derived().summarySlots).toBe(BALANCE.BASE_SUMMARY_SLOTS + 3 + 1 + 1);
  });

  it('a manual compaction with too many cards picks first, then pauses', () => {
    const s = mkSim({ meta: metaWith(COMPACT) });
    withCards(s, ['please', 'thank_you']);
    s.compact();
    expect(s.run.phase).toBe('compacting');
    expect(s.run.summary?.forced).toBe(false);
    tickFor(s, 1000);
    expect(s.run.compactingMs).toBe(BALANCE.MANUAL_COMPACT_MS);
    s.keepCards(['please']);
    tickFor(s, 1000);
    expect(s.run.compactingMs).toBe(BALANCE.MANUAL_COMPACT_MS - 1000);
  });

  it('dropping a patience card shrinks the bar to fit', () => {
    const s = mkSim({ meta: metaWith(COMPACT) });
    s.run.cards.push('grandma', 'please'); // patience x1.25
    s.run.patienceMs = s.patienceMaxMs;
    s.debug.setContext(1);
    s.keepCards(['please']);
    expect(s.run.patienceMs).toBeLessThanOrEqual(s.patienceMaxMs);
  });
});
