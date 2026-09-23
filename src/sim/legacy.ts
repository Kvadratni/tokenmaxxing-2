/**
 * The Tokenmaxxing 1 save, judged the way Tokenmaxxing 1 would judge it.
 *
 * Both games live on one origin, so the sequel can read the first game's save
 * out of localStorage. To decide whether the human cheated back then, this
 * module ports game 1's own audit verbatim: its canonical JSON, its FNV-1a
 * signature and salt, its honeypot, and its coherence rules over *its* meta
 * tree and achievement list (copied below, because game 1's content is not
 * this game's content).
 *
 * Private to the sim: nothing here is re-exported from index.ts.
 */
import type { SaveVerdict } from './types.ts';
import { BALANCE, LEGACY_SAVE_SALT } from './content.ts';

// ---------------------------------------------------------------------------
// Game 1's data, as its audit saw it
// ---------------------------------------------------------------------------

interface LegacyNode {
  readonly maxLevel: number;
  readonly costs: readonly number[];
  readonly requires: readonly string[];
}

/** Game 1's Training tree ("Demos"): id -> ceiling, per-level cost, parents. */
export const LEGACY_META: Readonly<Record<string, LegacyNode>> = {
  unlock_swarm: { maxLevel: 1, costs: [5], requires: [] },
  unlock_ralph: { maxLevel: 1, costs: [8], requires: ['unlock_swarm'] },
  unlock_harness: { maxLevel: 1, costs: [13], requires: ['unlock_ralph'] },
  unlock_fleet: { maxLevel: 1, costs: [21], requires: ['unlock_harness'] },
  unlock_farm: { maxLevel: 1, costs: [34], requires: ['unlock_fleet'] },
  unlock_agi: { maxLevel: 1, costs: [55], requires: ['unlock_farm'] },
  cracked: { maxLevel: 6, costs: [2, 3, 5, 8, 13, 21], requires: [] },
  unlock_autoclicker: { maxLevel: 1, costs: [5], requires: ['cracked'] },
  idle_hands: { maxLevel: 3, costs: [3, 8, 13], requires: ['unlock_autoclicker'] },
  unlock_headless: { maxLevel: 1, costs: [21], requires: ['idle_hands'] },
  keyboard_shortcuts: { maxLevel: 4, costs: [5, 8, 13, 21], requires: ['unlock_headless'] },
  unlock_daemon: { maxLevel: 1, costs: [34], requires: ['keyboard_shortcuts'] },
  seed_funding: { maxLevel: 5, costs: [2, 3, 5, 8, 13], requires: [] },
  technical_cofounder: { maxLevel: 3, costs: [5, 8, 13], requires: ['seed_funding'] },
  incubator: { maxLevel: 3, costs: [3, 8, 21], requires: ['technical_cofounder'] },
  founder_mode: { maxLevel: 6, costs: [3, 5, 8, 13, 21, 34], requires: ['incubator'] },
  unlock_datacenter: { maxLevel: 1, costs: [21], requires: ['founder_mode'] },
  unlock_orbital: { maxLevel: 1, costs: [34], requires: ['unlock_datacenter'] },
  unlock_model_cards: { maxLevel: 1, costs: [3], requires: [] },
  prompt_library: { maxLevel: 1, costs: [8], requires: ['unlock_model_cards'] },
  reroll_token: { maxLevel: 2, costs: [5, 13], requires: ['prompt_library'] },
  unlock_rare_cards: { maxLevel: 1, costs: [13], requires: ['reroll_token'] },
  scope_negotiator: { maxLevel: 4, costs: [3, 5, 8, 13], requires: ['unlock_rare_cards'] },
  unlock_architecture: { maxLevel: 1, costs: [21], requires: ['scope_negotiator'] },
  unlock_yolo: { maxLevel: 1, costs: [5], requires: [] },
  unlock_skip: { maxLevel: 1, costs: [13], requires: ['unlock_yolo'] },
  hype_machine: { maxLevel: 3, costs: [5, 8, 13], requires: ['unlock_skip'] },
  snack_drawer: { maxLevel: 1, costs: [13], requires: ['hype_machine'] },
  insurance: { maxLevel: 3, costs: [8, 13, 21], requires: ['snack_drawer'] },
  unlock_lucky: { maxLevel: 1, costs: [21], requires: ['insurance'] },
  endless_mode: {
    maxLevel: 1,
    costs: [34],
    requires: ['unlock_agi', 'unlock_daemon', 'unlock_orbital', 'unlock_architecture', 'unlock_lucky'],
  },
};

/** Game 1's achievement ids. An id outside this list could only be typed in. */
export const LEGACY_ACHIEVEMENT_IDS: readonly string[] = [
  'first_ship',
  'series_a',
  'demo_day',
  'full_stack',
  'vertical',
  'hellaslop',
  'friday',
  'no_hands',
  'firefighter',
  'tokenmaxxed',
  'script_kiddie',
  'nice_try',
  'rubber_duck',
  'one_shot_wonder',
  'technical_debt',
  'sigkill',
  'no_mistakes',
  'absolutely_right',
  'afk',
  'qa_engineer',
  'ralph',
];

/** Game 1 awarded these to a save it caught being edited. */
const LEGACY_CHEAT_ACHIEVEMENTS: readonly string[] = ['script_kiddie', 'nice_try'];

const LEGACY_SAVE_VERSION = 1;
/** Highest plausible `bestProject` in game 1: ten projects, stored 1-based. */
const LEGACY_MAX_PROJECT = 10;
const SIG_FIELD = 'sig';
const HONEYPOT_FIELD = 'cheats_enabled';

// ---------------------------------------------------------------------------
// Game 1's audit, verbatim
// ---------------------------------------------------------------------------

/** Stable JSON: object keys sorted, so a re-serialise cannot change the hash. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const r = v as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(',')}}`;
}

/** The fields game 1's signature covers. Settings were never signed. */
function signedPart(raw: Record<string, unknown>): unknown {
  return {
    demos: raw['demos'] ?? 0,
    levels: raw['levels'] ?? {},
    bestProject: raw['bestProject'] ?? 0,
    runs: raw['runs'] ?? 0,
    wins: raw['wins'] ?? 0,
    totalDemosEarned: raw['totalDemosEarned'] ?? 0,
    achievements: raw['achievements'] ?? {},
    version: raw['version'] ?? LEGACY_SAVE_VERSION,
  };
}

/** Game 1's FNV-1a over two 32-bit lanes, with game 1's salt. */
export function legacySignSave(raw: Record<string, unknown>): string {
  const text = `${LEGACY_SAVE_SALT}|${canonical(signedPart(raw))}`;
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Is this game 1 payload internally possible? Game 1's rules, unchanged. */
export function legacySaveIsCoherent(raw: Record<string, unknown>): boolean {
  const n = (k: string): number => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  if (n('runs') < 0 || n('demos') < 0 || n('wins') < 0 || n('totalDemosEarned') < 0) return false;
  if (n('wins') > n('runs')) return false;
  if (n('bestProject') > LEGACY_MAX_PROJECT) return false;
  if (n('totalDemosEarned') < n('demos')) return false;

  const levels = raw['levels'];
  if (levels !== undefined && (typeof levels !== 'object' || levels === null)) return false;
  const lv = (levels ?? {}) as Record<string, unknown>;
  let spent = 0;
  for (const [id, value] of Object.entries(lv)) {
    const def = LEGACY_META[id];
    const level = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(level) || level < 0 || !Number.isInteger(level)) return false;
    if (!def) {
      if (level > 0) return false;
      continue;
    }
    if (level > def.maxLevel) return false;
    for (let i = 0; i < level; i++) spent += def.costs[i] ?? 0;
  }
  for (const [id, value] of Object.entries(lv)) {
    const def = LEGACY_META[id];
    if (!def || typeof value !== 'number' || value < 1) continue;
    for (const req of def.requires) {
      if (!LEGACY_META[req]) continue;
      if (((lv[req] as number) ?? 0) < 1) return false;
    }
  }
  if (spent + n('demos') > n('totalDemosEarned')) return false;

  const ach = raw['achievements'];
  if (ach !== undefined) {
    if (typeof ach !== 'object' || ach === null) return false;
    for (const id of Object.keys(ach as Record<string, unknown>)) {
      if (!LEGACY_ACHIEVEMENT_IDS.includes(id)) return false;
    }
  }
  return true;
}

/** Game 1's verdict on a parsed payload. */
export function legacyAuditSave(raw: unknown): SaveVerdict {
  if (!raw || typeof raw !== 'object') return 'clean';
  const r = raw as Record<string, unknown>;
  const trap = r[HONEYPOT_FIELD];
  if (trap === true || trap === 'true') return 'edited';
  const sig = r[SIG_FIELD];
  if (typeof sig !== 'string' || sig.length === 0) return 'legacy';
  if (sig !== legacySignSave(r)) return 'edited';
  return legacySaveIsCoherent(r) ? 'clean' : 'forged';
}

// ---------------------------------------------------------------------------
// What the sequel takes from it
// ---------------------------------------------------------------------------

export interface LegacyFinding {
  readonly verdict: SaveVerdict;
  readonly runs: number;
  readonly wins: number;
  /** Tampered by game 1's standards, or carrying game 1's cheating achievements. */
  readonly cheater: boolean;
}

/** Game 1's own sanitiser for a counter: a non-negative integer or 0. */
function legacyCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.floor(Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, v)));
}

/**
 * Read a raw game 1 save. Null means there is nothing to import: no save, or
 * one game 1 itself would have discarded as corrupt and started fresh over.
 */
export function readLegacySave(text: string | null | undefined): LegacyFinding | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const verdict = legacyAuditSave(r);
  const ach = r['achievements'];
  const earned =
    ach && typeof ach === 'object'
      ? Object.entries(ach as Record<string, unknown>)
          .filter(([, v]) => legacyCount(v) > 0)
          .map(([id]) => id)
      : [];
  const cheater =
    verdict === 'edited' ||
    verdict === 'forged' ||
    LEGACY_CHEAT_ACHIEVEMENTS.some((id) => earned.includes(id));
  return { verdict, runs: legacyCount(r['runs']), wins: legacyCount(r['wins']), cheater };
}

/** The one-time welcome gift, scaled by the old save's wins. */
export function legacyGift(wins: number): number {
  const w = Number.isFinite(wins) ? Math.max(0, Math.floor(wins)) : 0;
  return Math.min(BALANCE.LEGACY_GIFT_CAP, BALANCE.LEGACY_GIFT_BASE + BALANCE.LEGACY_GIFT_PER_WIN * w);
}
