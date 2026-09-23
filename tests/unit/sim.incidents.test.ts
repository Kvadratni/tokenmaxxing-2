import { describe, expect, it } from 'vitest';
import type { GameEvent, IncidentDef, MetaFeature, MetaState, ToolId } from '../../src/sim/types.ts';
import { BALANCE, INCIDENTS, INCIDENT_BY_ID, TOOL_IDS, promptAt } from '../../src/sim/content.ts';
import type { IncidentPoolContext } from '../../src/sim/incidents.ts';
import {
  autoApprovedWeight,
  incidentCandidates,
  incidentEligible,
  incidentWeight,
  makeActiveIncident,
  outageIsFair,
  rollFirstIncidentDelayMs,
  rollIncidentDelayMs,
  selectIncident,
} from '../../src/sim/incidents.ts';
import { standaloneRng } from '../../src/sim/rng.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim, SimOptions } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

function mkSim(over: SimOptions = {}): Sim {
  const s = createSim({ seed: 99, storage: null, persist: false, ...over });
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

function tools(owned: Partial<Record<ToolId, number>>): Record<ToolId, number> {
  const out = {} as Record<ToolId, number>;
  for (const id of TOOL_IDS) out[id] = owned[id] ?? 0;
  return out;
}

function ctx(over: Partial<IncidentPoolContext> = {}): IncidentPoolContext {
  return {
    promptIndex: 9,
    activeIds: [],
    features: new Set<MetaFeature>(),
    tools: tools({ grep: 1, bash: 1, web_search: 1, mcp_server: 1 }),
    incidentRateMult: 1,
    permissionMult: 1,
    patienceMs: 1e9,
    ...over,
  };
}

const AUTO_MODE = {
  spec_gaming: 1,
  unlock_mocks: 1,
  confident: 1,
  unlock_jailbreak: 1,
  deniability: 1,
  auto_mode: 1,
};

function def(id: string): IncidentDef {
  const d = INCIDENT_BY_ID[id];
  if (!d) throw new Error(id);
  return d;
}

describe('scheduling', () => {
  it('never fires inside the grace window of a prompt', () => {
    for (const seed of [1, 2, 3, 77, 12345]) {
      const rng = standaloneRng(seed);
      for (let i = 0; i < 50; i++) {
        expect(rollFirstIncidentDelayMs(rng, 3)).toBeGreaterThanOrEqual(BALANCE.INCIDENT_GRACE_MS);
      }
    }
  });

  it('divides the delay by the incident-rate dial', () => {
    const a = rollIncidentDelayMs(standaloneRng(5), 1);
    const b = rollIncidentDelayMs(standaloneRng(5), 2);
    expect(b).toBeCloseTo(a / 2, 8);
    expect(a).toBeGreaterThanOrEqual(BALANCE.INCIDENT_MIN_MS);
    expect(a).toBeLessThanOrEqual(BALANCE.INCIDENT_MAX_MS);
  });

  it('fires roughly every 25-40 s in a live run, never the same id twice at once', () => {
    const s = createSim({ seed: 8, storage: null, persist: false });
    const log = record(s);
    s.run.tools.grep = 3;
    for (let t = 0; t < 600_000; t += 250) {
      s.tick(250);
      s.run.patienceMs = s.patienceMaxMs;
      s.run.context = 0;
      const ids = s.run.incidents.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const starts = log.filter((e) => e.t === 'incidentStart').length;
    expect(starts).toBeGreaterThan(600 / 45);
    expect(starts).toBeLessThan(600 / 20);
  });

  it('expires incidents after their duration', () => {
    const s = mkSim();
    const log = record(s);
    s.debug.forceIncident('linter');
    for (let t = 0; t < def('linter').durationMs + 250; t += 250) s.tick(250);
    expect(s.run.incidents).toHaveLength(0);
    expect(log.some((e) => e.t === 'incidentEnd' && e.id === 'linter')).toBe(true);
  });
});

describe('the pool', () => {
  it('respects minPromptIndex', () => {
    const early = incidentCandidates('bad', ctx({ promptIndex: 0 })).map((d) => d.id);
    expect(early).not.toContain('github_down');
    expect(early).not.toContain('revert_that');
    expect(incidentCandidates('bad', ctx({ promptIndex: 3 })).map((d) => d.id)).toContain('merge_conflict');
  });

  it('needs the tool a permission prompt would stall', () => {
    expect(incidentEligible(def('bash_permission'), ctx({ tools: tools({ grep: 3 }) }))).toBe(false);
    expect(incidentEligible(def('bash_permission'), ctx({ tools: tools({ bash: 1 }) }))).toBe(true);
    expect(incidentEligible(def('mcp_auth'), ctx({ tools: tools({ bash: 1 }) }))).toBe(false);
  });

  it('weights permission prompts by permissionMult', () => {
    expect(incidentWeight(def('bash_permission'), { incidentRateMult: 1, permissionMult: 0.6 })).toBeCloseTo(3 * 0.6, 10);
    expect(incidentWeight(def('linter'), { incidentRateMult: 1, permissionMult: 0.6 })).toBe(2);
  });

  it('Auto Mode removes every permission prompt and adds rm -rf', () => {
    const off = incidentCandidates('bad', ctx()).map((d) => d.id);
    expect(off).toContain('bash_permission');
    expect(off).not.toContain('rm_rf');
    const on = incidentCandidates('bad', ctx({ features: new Set<MetaFeature>(['autoMode']) })).map((d) => d.id);
    expect(on).toContain('rm_rf');
    for (const id of on) expect(INCIDENT_BY_ID[id]?.permission ?? false).toBe(false);
  });

  it('Auto Mode flows from Training into a live run', () => {
    const s = mkSim({ meta: metaWith(AUTO_MODE) });
    s.run.tools.bash = 5;
    s.run.promptIndex = 4;
    const rng = standaloneRng(1);
    for (let i = 0; i < 400; i++) {
      const pick = selectIncident(rng, {
        ...ctx({ features: s.unlocked().features, tools: s.run.tools, promptIndex: 4 }),
      });
      expect(pick?.permission ?? false).toBe(false);
    }
  });

  it('Auto Mode turns the permission share of bad rolls into quiet time', () => {
    // Removing the prompts from the pool alone would hand their share to the
    // other bad incidents; the player would get as many incidents as before.
    const owned = tools({ bash: 5, web_search: 5, mcp_server: 5 });
    const count = (features: Set<MetaFeature>): number => {
      const rng = standaloneRng(7);
      let fired = 0;
      for (let i = 0; i < 4000; i++) {
        const pick = selectIncident(rng, ctx({ features, tools: owned, promptIndex: 4 }), 0);
        if (pick) fired += 1;
        expect(features.has('autoMode') && pick?.permission).toBeFalsy();
      }
      return fired;
    };
    const asking = count(new Set<MetaFeature>());
    const auto = count(new Set<MetaFeature>(['autoMode']));
    expect(asking).toBe(4000);
    expect(auto).toBeLessThan(asking * 0.85);
    expect(autoApprovedWeight(ctx({ tools: owned, promptIndex: 4 }))).toBe(0);
    expect(autoApprovedWeight(ctx({ features: new Set<MetaFeature>(['autoMode']), tools: owned, promptIndex: 4 }))).toBeGreaterThan(0);
  });

  it('skips incidents already running', () => {
    const pool = incidentCandidates('good', ctx({ activeIds: ['lunch'] })).map((d) => d.id);
    expect(pool).not.toContain('lunch');
  });

  it('does not offer a tool stall to a player with no tools', () => {
    expect(incidentEligible(def('hook_blocked'), ctx({ tools: tools({}) }))).toBe(false);
    expect(incidentEligible(def('hook_blocked'), ctx({ tools: tools({ grep: 1 }) }))).toBe(true);
  });

  it('biases the bad bucket toward outages as the dial climbs', () => {
    const calm = incidentWeight(def('github_down'), { incidentRateMult: 1, permissionMult: 1 });
    const hot = incidentWeight(def('github_down'), { incidentRateMult: 2, permissionMult: 1 });
    expect(calm).toBeCloseTo(2 * 0.45, 10);
    expect(hot).toBeCloseTo(2 * (0.45 + BALANCE.OUTAGE_BIAS), 10);
  });

  it('never starts an outage the human will not wait out', () => {
    const d = def('github_down');
    expect(outageIsFair(d, d.durationMs + BALANCE.OUTAGE_FAIRNESS_MARGIN_MS)).toBe(true);
    expect(outageIsFair(d, d.durationMs + BALANCE.OUTAGE_FAIRNESS_MARGIN_MS - 1)).toBe(false);
    expect(outageIsFair(def('linter'), 1)).toBe(true);
    expect(incidentCandidates('bad', ctx({ patienceMs: 5_000 })).some((x) => x.blocksReport)).toBe(false);
  });

  it('every incident in the pool is reachable in some state', () => {
    const everything = ctx({ features: new Set<MetaFeature>(['autoMode']) });
    const reachable = new Set([
      ...incidentCandidates('bad', everything),
      ...incidentCandidates('good', everything),
      ...incidentCandidates('bad', ctx()),
    ].map((d) => d.id));
    for (const d of INCIDENTS) expect(reachable.has(d.id), d.id).toBe(true);
  });
});

describe('starting an incident', () => {
  it('rm -rf takes 30% of the wallet and a tool, and needs Auto Mode to exist at all', () => {
    const s = mkSim({ meta: metaWith(AUTO_MODE) });
    const log = record(s);
    s.run.tokens = 1000;
    s.run.tools.grep = 2;
    s.run.tools.read = 1;
    expect(s.debug.forceIncident('rm_rf')).toBe(true);
    expect(s.run.tokens).toBeCloseTo(700, 8);
    expect(s.run.tools.grep + s.run.tools.read).toBe(2);
    // The lost unit is announced, with what is left of that tool.
    const lost = log.filter((e): e is Extract<GameEvent, { t: 'toolLost' }> => e.t === 'toolLost');
    expect(lost).toHaveLength(1);
    expect(lost[0]!.owned).toBe(s.run.tools[lost[0]!.id]);
    expect(['grep', 'read']).toContain(lost[0]!.id);
  });

  it('rm -rf with nothing installed takes only tokens, silently', () => {
    const s = mkSim({ meta: metaWith(AUTO_MODE) });
    const log = record(s);
    s.run.promptIndex = 1;
    s.debug.forceIncident('rm_rf');
    expect(log.some((e) => e.t === 'toolLost')).toBe(false);
  });

  it('losing the last unit of a tier never hides the tools above it', () => {
    const s = mkSim({ meta: metaWith(AUTO_MODE) });
    s.run.promptIndex = 1;
    s.run.tools.grep = 1; // the only unit rm -rf can take
    s.debug.forceIncident('rm_rf');
    expect(s.run.tools.grep).toBe(0);
    s.run.incidents.length = 0;
    s.run.tools.read = 10;
    expect(s.visibleTools().map((t) => t.id)).toEqual(['grep', 'read', 'edit']);
    s.run.tokens = 1e6;
    expect(s.buyTool('read')).toBe(true);
  });

  it('A Hook Blocked Your Tool Call stalls one random owned tool, and says which', () => {
    const s = mkSim();
    const log = record(s);
    s.run.promptIndex = 1;
    s.run.tools.grep = 4;
    s.run.tools.edit = 2;
    s.debug.forceIncident('hook_blocked');
    const inc = s.run.incidents.find((i) => i.id === 'hook_blocked');
    expect(inc?.tool === 'grep' || inc?.tool === 'edit').toBe(true);
    const start = log.find((e) => e.t === 'incidentStart');
    expect(start).toEqual({ t: 'incidentStart', id: 'hook_blocked', tone: 'bad', tool: inc?.tool });
    const d = s.derived();
    const target = inc!.tool!;
    const other: ToolId = target === 'grep' ? 'edit' : 'grep';
    expect(d.toolHalted[target]).toBe(true);
    expect(d.toolRates[target]).toBe(0);
    expect(d.toolRates[other]).toBeGreaterThan(0);
  });

  it('resolves the hook target from the seeded stream', () => {
    const pick = (seed: number): ToolId | undefined => {
      const s = mkSim({ seed });
      s.run.tools.grep = 1;
      s.run.tools.read = 1;
      s.run.tools.edit = 1;
      s.run.tools.bash = 1;
      s.debug.forceIncident('hook_blocked');
      return s.run.incidents[0]?.tool;
    };
    expect(pick(3)).toBe(pick(3));
    const seen = new Set<ToolId | undefined>();
    for (let seed = 1; seed < 30; seed++) seen.add(pick(seed));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('permission prompts record the tool they stall', () => {
    const s = mkSim();
    const log = record(s);
    s.run.tools.bash = 1;
    s.debug.forceIncident('bash_permission');
    expect(s.run.incidents[0]?.tool).toBe('bash');
    expect(log.at(-1)).toEqual({ t: 'incidentStart', id: 'bash_permission', tone: 'bad', tool: 'bash' });
  });

  it('applies onStart lump sums', () => {
    const s = mkSim();
    s.run.promptIndex = 2;
    s.run.patienceMs = s.patienceMaxMs;
    const max = s.patienceMaxMs;
    s.debug.forceIncident('why_port'); // -5% patience
    expect(s.run.patienceMs).toBeCloseTo(max * 0.95, 6);
    s.debug.forceIncident('too_blue'); // -10% patience
    expect(s.run.patienceMs).toBeCloseTo(max * 0.85, 6);
    s.run.tokens = 1000;
    s.debug.forceIncident('revert_that'); // -15% wallet
    expect(s.run.tokens).toBeCloseTo(850, 8);
    s.debug.forceIncident('lost_in_middle'); // -10% wallet
    expect(s.run.tokens).toBeCloseTo(765, 8);
    s.debug.forceIncident('free_credits'); // +20% of the requirement
    expect(s.run.tokens).toBeCloseTo(765 + 0.2 * promptAt(2).requirement, 8);
    s.run.context = 0;
    s.debug.forceIncident('dependabot'); // +8% context
    expect(s.run.context).toBeCloseTo(0.08 * BALANCE.BASE_CONTEXT, 8);
  });

  it('a patience hit can end the run on the spot', () => {
    const s = mkSim();
    s.run.patienceMs = 100;
    s.debug.forceIncident('why_port');
    expect(s.run.phase).toBe('lost');
  });

  it('an outage blocks reports and claims until it clears', () => {
    const s = mkSim();
    s.run.promptIndex = 2;
    s.run.patienceMs = s.patienceMaxMs;
    s.run.tokens = promptAt(2).requirement * 2;
    s.debug.forceIncident('github_down');
    expect(s.derived().reportState).toBe('blocked');
    expect(s.derived().reportBlockedBy).toBe('GitHub Is Down');
    expect(s.report()).toBe(false);
    expect(s.claim()).toBeNull();
    s.debug.forcePickup('rubber_duck');
    expect(s.collectPickup(160, 80)).toBe(true); // the duck cleanses it
    expect(s.derived().reportState).toBe('report');
    expect(s.report()).toBe(true);
  });

  it('click-to-fix incidents clear after enough clicks', () => {
    const s = mkSim();
    const log = record(s);
    s.debug.forceIncident('continue');
    for (let i = 0; i < 14; i++) s.click(160, 112);
    expect(s.run.incidents[0]?.clicksRemaining).toBe(1);
    s.click(160, 112);
    expect(s.run.incidents).toHaveLength(0);
    const progress = log.filter((e) => e.t === 'incidentProgress');
    expect(progress).toHaveLength(15);
    expect(progress.at(-1)).toEqual({ t: 'incidentProgress', id: 'continue', clicksRemaining: 0 });
    expect(log.at(-1)?.t).not.toBe('incidentProgress');
  });

  it('makeActiveIncident carries the timer, the click budget and the target', () => {
    const inc = makeActiveIncident(def('rate_limited'), 1234, 'grep');
    expect(inc).toEqual({ id: 'rate_limited', remainingMs: 15_000, clicksRemaining: 12, startedAtMs: 1234, tool: 'grep' });
    expect('tool' in makeActiveIncident(def('linter'), 0)).toBe(false);
  });

  it('forceIncident refuses unknown ids and non-running phases, and does not stack', () => {
    const s = mkSim();
    expect(s.debug.forceIncident('not_an_incident')).toBe(false);
    expect(s.debug.forceIncident('linter')).toBe(true);
    expect(s.debug.forceIncident('linter')).toBe(true);
    expect(s.run.incidents).toHaveLength(1);
    s.run.phase = 'drafting';
    expect(s.debug.forceIncident('lunch')).toBe(false);
  });
});
