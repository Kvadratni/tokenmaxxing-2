/**
 * MetaState persistence.
 *
 * Every entry point is total: a missing, throwing, corrupt, or hostile storage
 * implementation yields a fresh valid MetaState instead of an exception.
 */
import type { AchievementId, MetaState, MetaUpgradeId, SaveVerdict, Settings } from './types.ts';
import { META_UPGRADES, META_BY_ID } from './content.ts';
import { ACHIEVEMENT_BY_ID } from './achievements.ts';

export const SAVE_KEY = 'tokenmaxxing2.save.v1';
export const SAVE_VERSION = 1;

/** The slice of the Web Storage API the sim actually uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSettings(): Settings {
  return {
    musicVolume: 0.6,
    sfxVolume: 0.8,
    reducedMotion: false,
    screenShake: true,
    showFps: false,
  };
}

export function defaultMeta(): MetaState {
  const levels: Record<MetaUpgradeId, number> = {};
  for (const def of META_UPGRADES) levels[def.id] = 0;
  return {
    demos: 0,
    levels,
    bestProject: 0,
    runs: 0,
    wins: 0,
    totalDemosEarned: 0,
    version: SAVE_VERSION,
    achievements: {},
    settings: defaultSettings(),
  };
}

/**
 * Field carrying the save's checksum, and a decoy that nothing reads.
 *
 * None of this is security — the algorithm and the salt are a few lines below
 * in a public repository, so anyone who looks can forge a save. That is the
 * point: defeating the checksum is a puzzle with its own achievement, and the
 * decoy catches the reader who never got that far.
 */
const SIG_FIELD = 'sig';
const HONEYPOT_FIELD = 'cheats_enabled';
const SALT = 'you-are-absolutely-right';

/** Stable JSON: object keys sorted, so a re-serialise cannot change the hash. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const r = v as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(',')}}`;
}

/**
 * The fields the signature covers. `settings` is deliberately excluded: volume
 * and reduced-motion are preferences, not progression, and someone poking at
 * those has not cheated at anything.
 */
function signedPart(raw: Record<string, unknown>): unknown {
  return {
    demos: raw['demos'] ?? 0,
    levels: raw['levels'] ?? {},
    bestProject: raw['bestProject'] ?? 0,
    runs: raw['runs'] ?? 0,
    wins: raw['wins'] ?? 0,
    totalDemosEarned: raw['totalDemosEarned'] ?? 0,
    achievements: raw['achievements'] ?? {},
    version: raw['version'] ?? SAVE_VERSION,
  };
}

/** FNV-1a over two 32-bit lanes. Deterministic, sync, no dependencies. */
export function signSave(raw: Record<string, unknown>): string {
  const text = `${SALT}|${canonical(signedPart(raw))}`;
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

/**
 * Is this payload internally possible?
 *
 * Runs on the **raw** JSON, because `migrateMeta` clamps levels to `maxLevel`
 * and quietly repairs `totalDemosEarned` — by the time sanitising is done the
 * evidence is gone. Anything here is something a hand-edited save gets wrong
 * even after the checksum has been recomputed.
 */
export function saveIsCoherent(raw: Record<string, unknown>): boolean {
  const n = (k: string): number => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  if (n('runs') < 0 || n('demos') < 0 || n('wins') < 0 || n('totalDemosEarned') < 0) return false;
  if (n('wins') > n('runs')) return false;
  if (n('bestProject') > META_MAX_PROJECT) return false;
  if (n('totalDemosEarned') < n('demos')) return false;

  const levels = raw['levels'];
  if (levels !== undefined && (typeof levels !== 'object' || levels === null)) return false;
  const lv = (levels ?? {}) as Record<string, unknown>;
  let spent = 0;
  for (const [id, value] of Object.entries(lv)) {
    const def = META_BY_ID[id];
    const level = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(level) || level < 0 || !Number.isInteger(level)) return false;
    // A level on a node that does not exist, or past its ceiling.
    if (!def) {
      if (level > 0) return false;
      continue;
    }
    if (level > def.maxLevel) return false;
    for (let i = 0; i < level; i++) spent += def.costs[i] ?? 0;
  }
  // Owning a node whose prerequisites are unowned is not reachable by play.
  for (const [id, value] of Object.entries(lv)) {
    const def = META_BY_ID[id];
    if (!def || typeof value !== 'number' || value < 1) continue;
    for (const req of def.requires) {
      const parent = META_BY_ID[req];
      if (!parent) continue;
      if (((lv[req] as number) ?? 0) < 1) return false;
    }
  }
  // Every Demo ever spent had to be earned first.
  if (spent + n('demos') > n('totalDemosEarned')) return false;

  const ach = raw['achievements'];
  if (ach !== undefined) {
    if (typeof ach !== 'object' || ach === null) return false;
    for (const id of Object.keys(ach as Record<string, unknown>)) {
      if (!ACHIEVEMENT_BY_ID[id]) return false;
    }
  }
  return true;
}

/** Highest plausible `bestProject`. Ten projects, stored 1-based here. */
const META_MAX_PROJECT = 10;

/**
 * Classify a stored payload before it is sanitised.
 *
 * `legacy` is the important one: a save written before signing existed has no
 * `sig`, and treating that as tampering would accuse every existing player the
 * first time they loaded a new build.
 */
export function auditSave(raw: unknown): SaveVerdict {
  if (!raw || typeof raw !== 'object') return 'clean';
  const r = raw as Record<string, unknown>;
  // `true` or the string "true": hand-editing JSON produces either.
  const trap = r[HONEYPOT_FIELD];
  if (trap === true || trap === 'true') return 'edited';
  const sig = r[SIG_FIELD];
  if (typeof sig !== 'string' || sig.length === 0) return 'legacy';
  if (sig !== signSave(r)) return 'edited';
  return saveIsCoherent(r) ? 'clean' : 'forged';
}

/** Best-effort handle on the ambient localStorage; null when unavailable. */
export function defaultStorage(): StorageLike | null {
  try {
    const g = globalThis as { localStorage?: StorageLike | null };
    const s = g.localStorage;
    if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return null;
    return s;
  } catch {
    return null;
  }
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function int(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.floor(num(v, fallback, min, max));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  return {
    musicVolume: num(r['musicVolume'], d.musicVolume, 0, 1),
    sfxVolume: num(r['sfxVolume'], d.sfxVolume, 0, 1),
    reducedMotion: bool(r['reducedMotion'], d.reducedMotion),
    screenShake: bool(r['screenShake'], d.screenShake),
    showFps: bool(r['showFps'], d.showFps),
  };
}

function sanitizeLevels(raw: unknown): Record<MetaUpgradeId, number> {
  const levels: Record<MetaUpgradeId, number> = {};
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const def of META_UPGRADES) {
    levels[def.id] = int(r[def.id], 0, 0, def.maxLevel);
  }
  return levels;
}

function sanitizeAchievements(raw: unknown): Record<AchievementId, number> {
  const out: Record<AchievementId, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    // Drop ids the build no longer knows about rather than carrying them along.
    if (!ACHIEVEMENT_BY_ID[id]) continue;
    const run = int(value, 0, 0);
    if (run > 0) out[id] = run;
  }
  return out;
}

/**
 * Migration hook. Older payloads are upgraded field-by-field here; anything
 * unrecognised falls back to the default value rather than failing the load.
 */
export function migrateMeta(raw: unknown): MetaState {
  const base = defaultMeta();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  // v0 (pre-versioned) payloads look the same minus `version`; nothing to do
  // beyond sanitising, but the switch is the seam for future schema bumps.
  const version = int(r['version'], 0, 0, 1_000_000);

  const meta: MetaState = {
    demos: int(r['demos'], base.demos),
    levels: sanitizeLevels(r['levels']),
    bestProject: int(r['bestProject'], base.bestProject),
    runs: int(r['runs'], base.runs),
    wins: int(r['wins'], base.wins),
    totalDemosEarned: int(r['totalDemosEarned'], base.totalDemosEarned),
    version: SAVE_VERSION,
    achievements: sanitizeAchievements(r['achievements']),
    settings: sanitizeSettings(r['settings']),
  };

  if (version > SAVE_VERSION) {
    // Save from a newer build: keep what we understand, drop the rest.
    meta.version = SAVE_VERSION;
  }
  // totalDemosEarned can never be smaller than the demos on hand.
  if (meta.totalDemosEarned < meta.demos) meta.totalDemosEarned = meta.demos;
  return meta;
}

/** Load, sanitise, and report how the stored payload looked. Never throws. */
export function loadMetaAudited(storage: StorageLike | null = defaultStorage()): {
  meta: MetaState;
  verdict: SaveVerdict;
} {
  if (!storage) return { meta: defaultMeta(), verdict: 'clean' };
  let text: string | null = null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { meta: defaultMeta(), verdict: 'clean' };
  }
  if (typeof text !== 'string' || text.length === 0) {
    return { meta: defaultMeta(), verdict: 'clean' };
  }
  try {
    const raw = JSON.parse(text) as unknown;
    // Audit before migrating: sanitising clamps the very fields that give a
    // hand-edited save away.
    return { meta: migrateMeta(raw), verdict: auditSave(raw) };
  } catch {
    // Unparseable is corruption, not cheating.
    return { meta: defaultMeta(), verdict: 'clean' };
  }
}

/** Load and sanitise. Never throws. */
export function loadMeta(storage: StorageLike | null = defaultStorage()): MetaState {
  return loadMetaAudited(storage).meta;
}

/** Persist. Returns false instead of throwing when storage rejects the write. */
export function saveMeta(
  meta: MetaState,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    const payload: Record<string, unknown> = { ...meta, version: SAVE_VERSION };
    // Signed after the payload is final, so a migrated save is re-signed rather
    // than left looking edited.
    payload[SIG_FIELD] = signSave(payload);
    payload[HONEYPOT_FIELD] = false;
    storage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Wipe the save. Never throws. */
export function clearMeta(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Demo cost of the next level of a meta upgrade; Infinity when maxed/unknown. */
export function metaNextCost(meta: MetaState, id: MetaUpgradeId): number {
  const def = META_BY_ID[id];
  if (!def) return Number.POSITIVE_INFINITY;
  const level = int(meta.levels[id], 0, 0, def.maxLevel);
  if (level >= def.maxLevel) return Number.POSITIVE_INFINITY;
  const cost = def.costs[level];
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : Number.POSITIVE_INFINITY;
}
