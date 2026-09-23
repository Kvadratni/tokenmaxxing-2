import { describe, expect, it } from 'vitest';
import type { GameEvent, MetaState, ToolId } from '../../src/sim/types.ts';
import { BALANCE, TOOLS, TOOL_BY_ID, TOOL_IDS, UPGRADE_BY_ID } from '../../src/sim/content.ts';
import { bulkToolCost, cappedCount, toolCostAt } from '../../src/sim/derive.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 20260922, storage: null, persist: false, ...over });
  quiet(s);
  return s;
}

/** No random incidents or pickups unless a test asks for them. */
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

function tickFor(s: Sim, ms: number): void {
  for (let left = ms; left > 0; left -= 100) s.tick(Math.min(100, left));
}

describe('click power', () => {
  it('is (BASE + clickAdd) x clickMult x (1 + clickPerTool x tools) x allMult', () => {
    const s = mkSim();
    expect(s.derived().clickPower).toBe(BALANCE.BASE_CLICK);

    s.run.owned.push('streaming'); // clickAdd 2
    expect(s.derived().clickPower).toBe(BALANCE.BASE_CLICK + 2);

    s.run.owned.push('spec_decoding'); // clickMult 2
    s.run.cards.push('please'); // allMult 1.12
    expect(s.derived().clickPower).toBeCloseTo((BALANCE.BASE_CLICK + 2) * 2 * 1.12, 10);

    s.run.owned.push('tool_reflex'); // clickPerTool 0.02
    s.run.tools.grep = 6;
    s.run.tools.read = 4;
    expect(s.derived().clickPower).toBeCloseTo((BALANCE.BASE_CLICK + 2) * 2 * (1 + 0.02 * 10) * 1.12, 10);
  });

  it('Training multiplies it (Pretraining)', () => {
    const s = mkSim({ meta: metaWith({ tool_use: 1, pretraining: 3 }) });
    expect(s.derived().clickPower).toBeCloseTo(BALANCE.BASE_CLICK * 2.2, 10);
  });

  it('a click pays click power, or click power x critMult on a crit', () => {
    const s = mkSim();
    const log = record(s);
    for (let i = 0; i < 300; i++) s.click(160, 112);
    const clicks = log.filter((e): e is Extract<GameEvent, { t: 'click' }> => e.t === 'click');
    expect(clicks).toHaveLength(300);
    for (const c of clicks) {
      expect(c.amount).toBe(c.crit ? BALANCE.BASE_CLICK * BALANCE.CRIT_MULT : BALANCE.BASE_CLICK);
      expect(c.auto).toBe(false);
    }
    expect(s.run.clicks).toBe(300);
  });

  it('crits land near the base chance', () => {
    const s = mkSim();
    const log = record(s);
    for (let i = 0; i < 4000; i++) {
      s.click(160, 112);
      s.run.context = 0; // keep compaction out of this
    }
    const crits = log.filter((e) => e.t === 'click' && e.crit).length;
    expect(crits / 4000).toBeGreaterThan(BALANCE.CRIT_CHANCE * 0.6);
    expect(crits / 4000).toBeLessThan(BALANCE.CRIT_CHANCE * 1.5);
  });

  it('clamps crit chance to the cap and adds crit payout', () => {
    const s = mkSim();
    s.run.owned.push('temperature_2', 'best_of_n'); // +0.06, +4 mult
    s.run.incidents.push({ id: 'pk_sparkles', remainingMs: 1e9, clicksRemaining: 0, startedAtMs: 0 }); // +0.25
    s.run.cards.push('deep_breath'); // +0.03
    const d = s.derived();
    expect(d.critChance).toBeCloseTo(BALANCE.CRIT_CHANCE + 0.06 + 0.25 + 0.03, 10);
    expect(d.critMult).toBe(BALANCE.CRIT_MULT + 4);
    for (let i = 0; i < 10; i++) s.run.incidents.push({ id: 'pk_sparkles', remainingMs: 1e9, clicksRemaining: 0, startedAtMs: 0 });
    expect(s.derived().critChance).toBe(BALANCE.CRIT_CHANCE_CAP);
  });

  it('is refused outside the running phase', () => {
    const s = mkSim();
    const log = record(s);
    s.endRun(false);
    expect(s.click(160, 112)).toBe(0);
    expect(log.some((e) => e.t === 'denied' && e.reason === 'phase')).toBe(true);
  });
});

describe('automation', () => {
  it('fires real clicks, flagged auto, that add context and clear click-to-fix incidents', () => {
    const s = mkSim();
    s.run.cards.push('stop_being_lazy'); // autoClick 4
    s.debug.forceIncident('continue'); // clears with 15 clicks
    const log = record(s);
    tickFor(s, 1000);
    const autos = log.filter((e) => e.t === 'click');
    expect(autos).toHaveLength(4);
    expect(autos.every((e) => e.t === 'click' && e.auto)).toBe(true);
    expect(s.run.clicks).toBe(4);
    expect(s.run.context).toBeCloseTo(4 * BALANCE.CTX_PER_CLICK, 6);
    expect(s.run.incidents.find((i) => i.id === 'continue')?.clicksRemaining).toBe(11);
    expect(s.derived().autoClickHz).toBe(4);
  });

  it('owes whole clicks across uneven frames', () => {
    const s = mkSim();
    s.run.owned.push('keep_going'); // 3/s
    for (let i = 0; i < 10; i++) s.tick(333);
    for (let i = 0; i < 10; i++) s.tick(167);
    expect(s.run.clicks).toBe(15); // 5 s at 3 Hz
  });
});

describe('tools', () => {
  it('rate = baseRate x owned x toolMult x idleMult x allMult', () => {
    const s = mkSim();
    s.run.tools.grep = 10;
    s.run.tools.read = 3;
    s.run.owned.push('ripgrep', 'parallel_tool_calls'); // grep x2, idle x1.5
    s.run.cards.push('please'); // all x1.12
    const d = s.derived();
    const grep = TOOL_BY_ID.grep.baseRate * 10 * 2 * 1.5 * 1.12;
    const read = TOOL_BY_ID.read.baseRate * 3 * 1.5 * 1.12;
    expect(d.toolRates.grep).toBeCloseTo(grep, 8);
    expect(d.toolRates.read).toBeCloseTo(read, 8);
    expect(d.idleRate).toBeCloseTo(grep + read, 8);
    expect(d.multipliers).toEqual({ click: 1, idle: 1.5, all: 1.12 });
  });

  it('produces tokens every tick', () => {
    const s = mkSim();
    s.run.tools.edit = 5;
    const rate = s.derived().idleRate;
    tickFor(s, 2000);
    expect(s.run.tokens).toBeCloseTo(rate * 2, 6);
    expect(s.run.tokensEarned).toBeCloseTo(rate * 2, 6);
  });

  it('idleHalt, toolHalt and networkHalt stop production and footprint', () => {
    const s = mkSim({ meta: metaWith({ unlock_web: 1 }) });
    s.run.tools.grep = 5;
    s.run.tools.bash = 5;
    s.run.tools.web_search = 5;
    expect(s.derived().contextRate).toBeGreaterThan(0);

    s.debug.forceIncident('bash_permission');
    let d = s.derived();
    expect(d.toolHalted.bash).toBe(true);
    expect(d.toolRates.bash).toBe(0);
    expect(d.toolRates.grep).toBeGreaterThan(0);
    s.run.incidents.length = 0;

    s.debug.forceIncident('github_down');
    d = s.derived();
    expect(d.toolHalted.web_search).toBe(true);
    expect(d.toolRates.web_search).toBe(0);
    expect(d.toolHalted.grep).toBe(false);
    expect(d.contextRate).toBeCloseTo(5 * 1.5 + 5 * 4, 8); // grep + bash only
    s.run.incidents.length = 0;

    s.debug.forceIncident('wait_stop');
    d = s.derived();
    expect(d.idleRate).toBe(0);
    expect(d.contextRate).toBe(0);
    expect(TOOL_IDS.every((id) => d.toolHalted[id])).toBe(true);
  });

  it('toolFootprint is one unit\'s context per second, all modifiers in, halted or not', () => {
    const s = mkSim();
    s.run.owned.push('line_ranges', 'prompt_caching'); // read x0.5, every tool x0.75
    s.run.cards.push('be_concise'); // every tool x0.85
    let d = s.derived();
    expect(d.toolFootprint.read).toBeCloseTo(TOOL_BY_ID.read.footprint * 0.5 * 0.75 * 0.85, 10);
    expect(d.toolFootprint.grep).toBeCloseTo(TOOL_BY_ID.grep.footprint * 0.75 * 0.85, 10);
    s.run.tools.read = 4;
    expect(s.derived().contextRate).toBeCloseTo(4 * d.toolFootprint.read, 10);
    // A halt stops the context, not the price tag.
    s.debug.forceIncident('wait_stop');
    d = s.derived();
    expect(d.contextRate).toBe(0);
    expect(d.toolFootprint.read).toBeCloseTo(TOOL_BY_ID.read.footprint * 0.5 * 0.75 * 0.85, 10);
  });

  it('toolCostMult lets the shop quote bulk prices exactly', () => {
    const s = mkSim({ meta: metaWith({ tool_use: 1, pretraining: 1, inference_budget: 1, distillation: 1, quantization: 2 }) });
    s.run.promptIndex = 3;
    s.run.owned.push('batch_api');
    const d = s.derived();
    expect(d.toolCostMult).toBeCloseTo(0.9 * 0.85, 10);
    const quote = bulkToolCost(TOOL_BY_ID.grep, s.run.tools.grep, 10, d.toolCostMult);
    s.run.tokens = quote;
    expect(s.buyTool('grep', 10)).toBe(true);
    expect(s.run.tokens).toBe(0);
    expect(s.run.tokensSpent).toBe(quote);
  });

  it('costs baseCost x growth^owned x toolCostMult, rounded', () => {
    const grep = TOOL_BY_ID.grep;
    expect(toolCostAt(grep, 0, 1)).toBe(grep.baseCost);
    expect(toolCostAt(grep, 7, 1)).toBe(Math.round(grep.baseCost * Math.pow(grep.costGrowth, 7)));
    expect(toolCostAt(grep, 7, 0.75)).toBe(Math.round(grep.baseCost * Math.pow(grep.costGrowth, 7) * 0.75));
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += toolCostAt(grep, 3 + i, 0.9);
    expect(bulkToolCost(grep, 3, 12, 0.9)).toBe(sum);
    expect(bulkToolCost(grep, 3, 0, 0.9)).toBe(0);
  });

  it('quotes nextCosts with toolCostMult from Training and upgrades', () => {
    const s = mkSim({
      meta: metaWith({ tool_use: 1, pretraining: 1, inference_budget: 1, distillation: 1, quantization: 3 }),
    });
    expect(s.derived().nextCosts.grep).toBe(toolCostAt(TOOL_BY_ID.grep, s.run.tools.grep, 0.86));
  });

  it('buys atomically: a short wallet moves nothing', () => {
    const s = mkSim();
    const log = record(s);
    s.run.tokens = bulkToolCost(TOOL_BY_ID.grep, 0, 3, 1) - 1;
    expect(s.buyTool('grep', 3)).toBe(false);
    expect(s.run.tools.grep).toBe(0);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'cost' });

    s.run.tokens += 1;
    expect(s.buyTool('grep', 3)).toBe(true);
    expect(s.run.tools.grep).toBe(3);
    expect(s.run.tokens).toBe(0);
    expect(s.run.tokensSpent).toBe(bulkToolCost(TOOL_BY_ID.grep, 0, 3, 1));
    expect(log.at(-1)).toEqual({ t: 'buyTool', id: 'grep', cost: s.run.tokensSpent, owned: 3 });
  });

  it('buy max (Infinity) buys as many as the wallet allows', () => {
    const s = mkSim();
    s.run.tokens = bulkToolCost(TOOL_BY_ID.grep, 0, 7, 1) + 5;
    expect(s.buyTool('grep', Number.POSITIVE_INFINITY)).toBe(true);
    expect(s.run.tools.grep).toBe(7);
    expect(s.run.tokens).toBe(5);
  });

  it('enforces maxOwned: bulk buys clamp, a capped tool is refused', () => {
    const s = mkSim();
    const grep = TOOL_BY_ID.grep;
    expect(cappedCount(grep, grep.maxOwned - 2, 10)).toBe(2);
    expect(cappedCount(grep, 0, Number.POSITIVE_INFINITY)).toBe(grep.maxOwned);
    s.run.tools.grep = grep.maxOwned - 2;
    s.run.tokens = 1e30;
    expect(s.buyTool('grep', 10)).toBe(true);
    expect(s.run.tools.grep).toBe(grep.maxOwned);
    const log = record(s);
    expect(s.buyTool('grep')).toBe(false);
    expect(log.at(-1)).toEqual({ t: 'denied', reason: 'locked' });
    expect(s.derived().headroom.grep).toBe(0);
  });

  it('reveals each tier once the previous one is owned', () => {
    const s = mkSim();
    expect(s.visibleTools().map((t) => t.id)).toEqual(['grep']);
    s.run.tokens = 1e9;
    expect(s.buyTool('read')).toBe(false);
    s.buyTool('grep');
    expect(s.visibleTools().map((t) => t.id)).toEqual(['grep', 'read']);
    s.buyTool('read');
    s.buyTool('edit');
    expect(s.visibleTools().map((t) => t.id)).toEqual(['grep', 'read', 'edit', 'bash']);
    // Tier 5 is locked on a fresh save whatever the run owns.
    s.buyTool('bash');
    expect(s.visibleTools().map((t) => t.id)).toEqual(['grep', 'read', 'edit', 'bash']);
    expect(s.buyTool('web_search')).toBe(false);
  });

  it('refuses purchases outside the running phase', () => {
    const s = mkSim();
    s.run.tokens = 1e9;
    const log = record(s);
    s.endRun(false);
    expect(s.buyTool('grep')).toBe(false);
    expect(s.buyUpgrade('streaming')).toBe(false);
    expect(log.filter((e) => e.t === 'denied').map((e) => (e.t === 'denied' ? e.reason : ''))).toEqual([
      'phase',
      'phase',
    ]);
  });
});

describe('upgrades', () => {
  it('buy once, deducting the cost', () => {
    const s = mkSim();
    const cost = UPGRADE_BY_ID['streaming']!.cost;
    s.run.tokens = cost;
    expect(s.buyUpgrade('streaming')).toBe(true);
    expect(s.run.tokens).toBe(0);
    expect(s.run.owned).toEqual(['streaming']);
    s.run.tokens = cost;
    expect(s.buyUpgrade('streaming')).toBe(false);
  });

  it('respect minPrompt, tool and upgrade requirements', () => {
    const s = mkSim({ meta: metaWith({ unlock_initiative: 1 }) });
    s.run.tokens = 1e12;
    expect(s.buyUpgrade('spec_decoding')).toBe(false); // minPrompt 1
    s.run.promptIndex = 1;
    expect(s.buyUpgrade('spec_decoding')).toBe(true);
    expect(s.buyUpgrade('ripgrep')).toBe(false); // needs 5 grep
    s.run.tools.grep = 5;
    expect(s.buyUpgrade('ripgrep')).toBe(true);
    s.run.promptIndex = 5;
    expect(s.buyUpgrade('stop_hook')).toBe(false); // needs keep_going
    expect(s.buyUpgrade('keep_going')).toBe(true);
    expect(s.buyUpgrade('stop_hook')).toBe(true);
  });
});

describe('one-shots', () => {
  it('never fire without an upgrade granting a chance', () => {
    const s = mkSim();
    s.run.tools.grep = 30;
    const log = record(s);
    tickFor(s, 60_000);
    expect(log.some((e) => e.t === 'oneShot')).toBe(false);
    expect(s.derived().oneShotChance).toBe(0);
  });

  it('pay (base + oneShotPayout) seconds of idle rate at the rolled chance', () => {
    const s = mkSim();
    s.run.owned.push('one_shot_prompting', 'eval_harness'); // 0.06, +1 s
    s.run.tools.grep = 10;
    const d = s.derived();
    expect(d.oneShotChance).toBeCloseTo(0.06, 10);
    expect(d.oneShotPayoutS).toBe(BALANCE.ONE_SHOT_BASE_PAYOUT_S + 1);
    const log = record(s);
    const rolls = 3000;
    for (let i = 0; i < rolls; i++) {
      s.tick(BALANCE.ONE_SHOT_ROLL_MS);
      s.run.context = 0;
      s.run.patienceMs = s.patienceMaxMs;
    }
    const shots = log.filter((e): e is Extract<GameEvent, { t: 'oneShot' }> => e.t === 'oneShot');
    expect(shots.length / rolls).toBeGreaterThan(0.04);
    expect(shots.length / rolls).toBeLessThan(0.08);
    for (const shot of shots) {
      expect(shot.seconds).toBe(6);
      expect(shot.amount).toBeCloseTo(d.idleRate * 6, 6);
    }
  });

  it('clamp the chance to its cap', () => {
    const s = mkSim();
    for (let i = 0; i < 20; i++) s.run.owned.push('one_shot_prompting');
    expect(s.derived().oneShotChance).toBe(BALANCE.ONE_SHOT_CHANCE_CAP);
  });
});

describe('derived bookkeeping', () => {
  it('reports progress, ETA and headroom', () => {
    const s = mkSim();
    s.run.tools.grep = 10;
    s.run.tokens = 40;
    const d = s.derived();
    expect(d.requirement).toBe(100);
    expect(d.reportProgress).toBeCloseTo(0.4, 10);
    expect(d.etaSeconds).toBeCloseTo(60 / d.idleRate, 8);
    expect(d.headroom.grep).toBe(TOOL_BY_ID.grep.maxOwned - 10);
    s.run.tools.grep = 0;
    expect(s.derived().etaSeconds).toBe(Number.POSITIVE_INFINITY);
    s.run.tokens = 500;
    expect(s.derived().etaSeconds).toBe(0);
  });

  it('lists every tool in the per-tool records', () => {
    const d = mkSim().derived();
    for (const t of TOOLS) {
      const id: ToolId = t.id;
      expect(d.toolRates[id]).toBe(0);
      expect(d.toolHalted[id]).toBe(false);
      expect(d.nextCosts[id]).toBe(t.baseCost);
      expect(d.headroom[id]).toBe(t.maxOwned);
    }
  });
});
