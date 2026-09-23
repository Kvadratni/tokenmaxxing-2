/**
 * Named stage moments, shared by the headless preview (stage-preview.mjs)
 * and the in-browser demo (stage-demo.html). Pure data plus content.ts, so it
 * runs in node and in the browser alike.
 */
import { TOOLS } from '../../src/sim/content.ts';

// ---------------------------------------------------------------------------
// Fixtures: a complete RunState / DerivedStats, then per-scenario overrides.
// ---------------------------------------------------------------------------

export function perTool(v) {
  return Object.fromEntries(TOOLS.map((t) => [t.id, v]));
}

export function run(over = {}) {
  return {
    tokens: 420,
    promptIndex: 0,
    patienceMs: 100_000,
    context: 800,
    compactingMs: 0,
    summary: null,
    elapsedMs: 20_000,
    tools: perTool(0),
    owned: [],
    cards: [],
    incidents: [],
    phase: 'running',
    draftOffer: [],
    draftRerollsLeft: 0,
    nextIncidentInMs: 30_000,
    pickup: null,
    nextPickupInMs: 30_000,
    clicks: 40,
    tokensEarned: 900,
    tokensSpent: 400,
    reported: 0,
    claimed: 0,
    caught: 0,
    techDebt: 0,
    compactions: 0,
    forcedCompactions: 0,
    sycophancy: 0,
    sycophancyHeat: 0,
    pendingThumbs: 0,
    rngState: 1,
    seed: 1,
    ...over,
  };
}

export function derived(over = {}) {
  const contextMax = over.contextMax ?? 8000;
  const contextFill = over.contextFill ?? 0.1;
  return {
    clickPower: 3,
    idleRate: 12,
    autoClickHz: 0,
    toolRates: perTool(2),
    toolHalted: perTool(false),
    toolFootprint: perTool(1),
    toolCostMult: 1,
    nextCosts: perTool(100),
    headroom: perTool(60),
    requirement: 100,
    reportProgress: 0.4,
    reportState: 'working',
    reportBlockedBy: null,
    claimThreshold: 0.5,
    verifyChance: 0.4,
    patienceProgress: 0.9,
    patienceMaxMs: 120_000,
    patienceFrozen: false,
    sycophancyPower: 0.06,
    contextMax,
    contextFloor: 0,
    contextFill,
    contextRate: 10,
    clickContext: 24,
    secondsToCompaction: 200,
    summarySlots: 1,
    compactKeepForced: 0.25,
    compactKeepManual: 0.5,
    canCompact: false,
    etaSeconds: 20,
    thumbsIfEndedNow: 0,
    incidentRateMult: 1,
    critChance: 0.04,
    critMult: 7,
    oneShotChance: 0,
    oneShotPayoutS: 5,
    scene: 'bedroom',
    modelVersion: '2.0',
    multipliers: { click: 1, idle: 1, all: 1 },
    ...over,
  };
}

export const SETTINGS = { musicVolume: 0.5, sfxVolume: 0.5, reducedMotion: false, screenShake: false, showFps: false };

export function incident(id, over = {}) {
  return { id, remainingMs: 8000, clicksRemaining: 0, startedAtMs: 0, ...over };
}

/**
 * Each scenario: a run/derived pair, events at given times, and the moment to
 * capture. Frames are stepped at 60 fps from t = 0 so animations are real.
 */
export const SCENARIOS = {
  'fresh-prompt': {
    run: run({ tools: { ...perTool(0), grep: 3, read: 1 } }),
    derived: derived({ contextFill: 0.08, patienceProgress: 0.98 }),
    events: [[0, { t: 'runStart', seed: 1 }]],
    at: 0.55,
  },
  working: {
    run: run({ promptIndex: 2, tools: { ...perTool(0), grep: 6, read: 4, edit: 3, bash: 2, subagent: 3 } }),
    derived: derived({ contextFill: 0.46, patienceProgress: 0.72, scene: 'coworking', reportState: 'working' }),
    events: [[1.9, { t: 'click', amount: 18, x: 160, y: 140, crit: false, auto: false }]],
    at: 2.0,
  },
  'panic-90': {
    run: run({
      promptIndex: 4,
      tools: { ...perTool(0), grep: 12, read: 9, edit: 6, bash: 5, web_search: 3, subagent: 7, mcp_server: 2, ralph_loop: 1 },
    }),
    derived: derived({
      contextFill: 0.93,
      contextMax: 32_000,
      contextFloor: 1800,
      patienceProgress: 0.33,
      scene: 'openplan',
      reportState: 'claim',
    }),
    events: [],
    at: 2.3,
  },
  'compaction-slam': {
    run: run({ promptIndex: 3, context: 400, tools: { ...perTool(0), grep: 8, read: 6, edit: 4, bash: 3 } }),
    derived: derived({ contextFill: 0.05, patienceProgress: 0.6, scene: 'coworking' }),
    before: { contextFill: 1, context: 8000 },
    events: [[1.0, { t: 'compactStart', forced: true, kept: 100, lost: 300 }]],
    at: 1.4,
  },
  'compaction-summary': {
    run: run({ promptIndex: 3, context: 400, tools: { ...perTool(0), grep: 8, read: 6, edit: 4, bash: 3 } }),
    derived: derived({ contextFill: 0.05, patienceProgress: 0.6, scene: 'coworking' }),
    before: { contextFill: 1, context: 8000 },
    events: [[1.0, { t: 'compactStart', forced: true, kept: 100, lost: 300 }]],
    at: 3.2,
  },
  'claim-caught': {
    run: run({ promptIndex: 5, tools: { ...perTool(0), grep: 10, read: 8, edit: 5, bash: 4, subagent: 2 } }),
    derived: derived({ contextFill: 0.55, patienceProgress: 0.12, scene: 'openplan', reportState: 'working' }),
    events: [[1.0, { t: 'claim', promptIndex: 5, caught: true, verifyChance: 0.48, spent: 1000 }]],
    at: 1.5,
  },
  'claim-passed': {
    run: run({ promptIndex: 6, tools: { ...perTool(0), grep: 10, read: 8, edit: 5, bash: 4, web_search: 2, subagent: 4 } }),
    derived: derived({ contextFill: 0.35, patienceProgress: 0.5, scene: 'datacenter' }),
    events: [[1.0, { t: 'claim', promptIndex: 6, caught: false, verifyChance: 0.4, spent: 1000 }]],
    at: 1.35,
  },
  'wait-stop': {
    run: run({ promptIndex: 1, incidents: [incident('wait_stop', { remainingMs: 5000 })], tools: { ...perTool(0), grep: 4, read: 2, edit: 2 } }),
    derived: derived({ contextFill: 0.3, patienceProgress: 0.6, toolHalted: perTool(true) }),
    events: [[1.0, { t: 'incidentStart', id: 'wait_stop', tone: 'bad' }]],
    at: 1.5,
  },
  permission: {
    run: run({ promptIndex: 2, incidents: [incident('bash_permission', { tool: 'bash' })], tools: { ...perTool(0), grep: 5, read: 3, edit: 2, bash: 3 } }),
    derived: derived({ contextFill: 0.4, patienceProgress: 0.55, scene: 'coworking', toolHalted: { ...perTool(false), bash: true } }),
    events: [],
    at: 2.0,
  },
  lunch: {
    run: run({ promptIndex: 7, incidents: [incident('lunch')], tools: { ...perTool(0), grep: 20, read: 12, edit: 10, bash: 8, web_search: 6, subagent: 12, agent_team: 3, mcp_server: 2, rsi: 1 } }),
    derived: derived({ contextFill: 0.6, contextMax: 128_000, contextFloor: 9000, patienceProgress: 0.7, patienceFrozen: true, scene: 'datacenter' }),
    events: [],
    at: 2.0,
  },
  crit: {
    run: run({ promptIndex: 1, tools: { ...perTool(0), grep: 5, read: 3, edit: 2 } }),
    derived: derived({ contextFill: 0.25, patienceProgress: 0.8 }),
    events: [[1.9, { t: 'click', amount: 147, x: 160, y: 140, crit: true, auto: false }]],
    at: 2.05,
  },
  report: {
    run: run({ promptIndex: 2, phase: 'reported', tools: { ...perTool(0), grep: 6, read: 4, edit: 3, bash: 2 } }),
    derived: derived({ contextFill: 0.4, patienceProgress: 0.7, scene: 'coworking' }),
    events: [[1.8, { t: 'report', promptIndex: 2, thumbs: 2, patienceLeft: 0.7 }]],
    at: 2.1,
  },
  grovel: {
    run: run({ promptIndex: 4, tools: { ...perTool(0), grep: 8, read: 5, edit: 4, bash: 3, web_search: 1 } }),
    derived: derived({ contextFill: 0.5, patienceProgress: 0.08, scene: 'openplan' }),
    events: [[1.9, { t: 'sycophancy', restored: 0.06, heat: 1 }]],
    at: 2.1,
  },
  furious: {
    run: run({ promptIndex: 8, patienceMs: 6000, tools: { ...perTool(0), grep: 15, read: 10, edit: 9, bash: 7, web_search: 4, subagent: 3, ralph_loop: 1 } }),
    derived: derived({ contextFill: 0.42, patienceProgress: 0.07, scene: 'orbital' }),
    events: [],
    at: 2.5,
  },
  typing: {
    run: run({ promptIndex: 5, phase: 'drafting', tools: { ...perTool(0), grep: 9, read: 6, edit: 5, bash: 4 } }),
    derived: derived({ contextFill: 0.2, patienceProgress: 1, scene: 'openplan' }),
    events: [],
    at: 2.2,
  },
  'orbital-pickup': {
    run: run({
      promptIndex: 9,
      pickup: { id: 'rubber_duck', x: 86, y: 70, vx: 20, baseY: 70, ageS: 2, remainingMs: 5000 },
      tools: { ...perTool(0), grep: 30, read: 20, edit: 20, bash: 15, web_search: 10, subagent: 25, mcp_server: 4, agent_team: 5, ralph_loop: 3, rsi: 2 },
    }),
    derived: derived({ contextFill: 0.72, contextMax: 1_000_000, contextFloor: 40_000, patienceProgress: 0.2, scene: 'orbital' }),
    events: [],
    at: 2.0,
  },
};

