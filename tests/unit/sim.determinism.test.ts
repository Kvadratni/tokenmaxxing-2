import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameEvent, MetaState } from '../../src/sim/types.ts';
import { META_UPGRADES } from '../../src/sim/content.ts';
import { defaultMeta } from '../../src/sim/save.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { createSim } from '../../src/sim/sim.ts';

// Vitest runs from the project root; import.meta.url is not a file URL under happy-dom.
const SIM_DIR = resolve(process.cwd(), 'src/sim') + '/';

function midMeta(): MetaState {
  const m = defaultMeta();
  // No Context Window: the 8K window keeps the compaction paths busy.
  for (const id of ['unlock_compact', 'tool_use', 'pretraining', 'helpful', 'prompt_library']) {
    m.levels[id] = 1;
  }
  return m;
}

/**
 * A scripted player: clicks, buys, reports, drafts, compacts and flatters the
 * human, entirely as a function of state it reads. Same seed, same meta, same
 * script: the run must replay byte for byte.
 */
function playScript(sim: Sim, ms: number): void {
  for (let t = 0; t < ms; t += 100) {
    const run = sim.run;
    if (run.phase === 'won' || run.phase === 'lost') return;
    if (run.phase === 'drafting') {
      const pick = run.draftOffer[0];
      if (pick) sim.pickCard(pick);
    } else if (run.phase === 'compacting' && run.summary) {
      sim.keepCards(run.summary.offered.slice(0, run.summary.slots));
    } else if (run.phase === 'running') {
      const d = sim.derived();
      if (d.reportState === 'report') sim.report();
      else if (d.reportState === 'claim' && d.patienceProgress < 0.05) sim.claim();
      for (const tool of sim.visibleTools()) {
        if (sim.run.tokens > d.nextCosts[tool.id] * 2) sim.buyTool(tool.id);
      }
      const up = sim.availableUpgrades()[0];
      if (up && sim.run.tokens > up.cost * 3) sim.buyUpgrade(up.id);
      if (d.patienceProgress < 0.3) sim.absolutelyRight();
      if (d.contextFill > 0.7 && d.canCompact) sim.compact();
      if (run.pickup) sim.collectPickup(run.pickup.x, run.pickup.y);
      if (t % 200 === 0) sim.click(160, 112);
    }
    sim.tick(100);
  }
}

function replay(seed: number, meta: MetaState, ms = 150_000): { events: GameEvent[]; state: string } {
  const sim = createSim({ seed, meta, storage: null, persist: false });
  const events: GameEvent[] = [];
  sim.subscribe((e) => events.push(e));
  playScript(sim, ms);
  return { events, state: JSON.stringify({ run: sim.run, meta: sim.meta, derived: sim.derived() }) };
}

describe('determinism', () => {
  it('replays a scripted run exactly from the same seed', () => {
    const a = replay(424242, midMeta());
    const b = replay(424242, midMeta());
    expect(a.events.length).toBeGreaterThan(50);
    expect(a.events).toEqual(b.events);
    expect(a.state).toBe(b.state);
  });

  it('diverges on a different seed', () => {
    const a = replay(1, midMeta());
    const b = replay(2, midMeta());
    expect(a.state).not.toBe(b.state);
  });

  it('exercises the interesting systems in that script', () => {
    const { events } = replay(424242, midMeta());
    const kinds = new Set(events.map((e) => e.t));
    for (const k of ['click', 'buyTool', 'report', 'draftOpen', 'draftPick', 'incidentStart', 'compactStart']) {
      expect(kinds.has(k as GameEvent['t'])).toBe(true);
    }
  });

  it('startRun(seed) on a used sim replays like a fresh sim with that seed', () => {
    const used = createSim({ seed: 5, meta: midMeta(), storage: null, persist: false });
    playScript(used, 20_000);
    used.startRun(777);
    playScript(used, 60_000);

    const fresh = createSim({ seed: 777, meta: midMeta(), storage: null, persist: false });
    playScript(fresh, 60_000);
    expect(JSON.stringify(used.run)).toBe(JSON.stringify(fresh.run));
  });

  it('derives a fresh but deterministic seed when none is given', () => {
    const a = createSim({ storage: null, persist: false });
    const b = createSim({ storage: null, persist: false });
    const first = a.run.seed;
    a.startRun();
    b.startRun();
    expect(a.run.seed).not.toBe(first);
    expect(a.run.seed).toBe(b.run.seed);
  });

  it('tick clamps huge deltas and ignores garbage', () => {
    const s = createSim({ seed: 3, storage: null, persist: false });
    s.tick(Number.NaN);
    s.tick(-5);
    s.tick(Number.POSITIVE_INFINITY);
    expect(s.run.elapsedMs).toBe(0);
    s.tick(60_000);
    expect(s.run.elapsedMs).toBeLessThanOrEqual(2_000);
  });

  it('every Training level in a maxed meta still folds to finite numbers', () => {
    const m = defaultMeta();
    for (const d of META_UPGRADES) m.levels[d.id] = d.maxLevel;
    const s = createSim({ seed: 9, meta: m, storage: null, persist: false });
    const d = s.derived();
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'number' && k !== 'etaSeconds' && k !== 'secondsToCompaction') {
        expect(Number.isFinite(v), k).toBe(true);
      }
    }
  });
});

describe('src/sim hygiene', () => {
  const files = readdirSync(SIM_DIR).filter((f) => f.endsWith('.ts'));
  const sources = files.map((f) => ({ f, text: readFileSync(SIM_DIR + f, 'utf8') }));

  it('never reaches for ambient randomness or the wall clock', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/Math\.random\s*\(/);
      expect(text, f).not.toMatch(/Date\.now\s*\(/);
      expect(text, f).not.toMatch(/performance\.now\s*\(/);
      expect(text, f).not.toMatch(/new Date\s*\(/);
    }
  });

  it('has no console.log left behind', () => {
    for (const { f, text } of sources) expect(text, f).not.toMatch(/console\.log/);
  });

  it('carries no first-game vocabulary outside the legacy auditor', () => {
    for (const { f, text } of sources) {
      // content.ts and types.ts belong to the integrator; legacy.ts ports game 1 on purpose.
      if (f === 'legacy.ts' || f === 'content.ts' || f === 'types.ts') continue;
      expect(text, f).not.toMatch(/\bslop\b|laptop|\bdemos?\b|agentTier|AgentTier|projectIndex/i);
    }
  });
});
