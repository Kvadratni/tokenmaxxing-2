/**
 * MetaState persistence, signing and the tamper audit.
 *
 * Every entry point is total: a missing, throwing, corrupt or hostile storage
 * yields a fresh valid MetaState instead of an exception.
 */
import type {
  AchievementId,
  LegacyImport,
  MetaState,
  MetaUpgradeId,
  SaveVerdict,
  Settings,
} from './types.ts';
import { ACHIEVEMENT_BY_ID, FINAL_PROMPT_INDEX, META_BY_ID, META_UPGRADES } from './content.ts';
import { STAT } from './effects.ts';
import { legacyGift } from './legacy.ts';

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
    thumbs: 0,
    levels,
    bestPrompt: 0,
    runs: 0,
    wins: 0,
    totalThumbsEarned: 0,
    version: SAVE_VERSION,
    achievements: {},
    stats: {},
    legacy: null,
    settings: defaultSettings(),
  };
}

/** A fresh in-memory storage: handy for tests and for the legacy test hook. */
export function memoryStorage(seed: Readonly<Record<string, string>> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * The checksum field, and a decoy that nothing reads.
 *
 * None of this is security: the algorithm and salt are below, in a public
 * repository. Defeating the checksum is a puzzle with its own achievement, and
 * the decoy catches the reader who never got that far. Same scheme as the first
 * game, with a new salt.
 */
const SIG_FIELD = 'sig';
const HONEYPOT_FIELD = 'cheats_enabled';
const SALT = 'make-no-mistakes';

/** Stable JSON: object keys sorted, so a re-serialise cannot change the hash. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const r = v as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(',')}}`;
}

/**
 * What the signature covers. `settings` is deliberately excluded: volume and
 * reduced motion are preferences, and poking at them is not cheating. `legacy`
 * is covered, so un-importing a game 1 save to take the gift twice shows.
 */
function signedPart(raw: Record<string, unknown>): unknown {
  return {
    thumbs: raw['thumbs'] ?? 0,
    levels: raw['levels'] ?? {},
    bestPrompt: raw['bestPrompt'] ?? 0,
    runs: raw['runs'] ?? 0,
    wins: raw['wins'] ?? 0,
    totalThumbsEarned: raw['totalThumbsEarned'] ?? 0,
    achievements: raw['achievements'] ?? {},
    stats: raw['stats'] ?? {},
    legacy: raw['legacy'] ?? null,
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

const VERDICTS: readonly string[] = ['clean', 'legacy', 'edited', 'forged'];

function legacyIsCoherent(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (r['verdict'] === 'none') return true;
  if (typeof r['verdict'] !== 'string' || !VERDICTS.includes(r['verdict'])) return false;
  const count = (k: string): number => (typeof r[k] === 'number' ? (r[k] as number) : Number.NaN);
  const runs = count('runs');
  const wins = count('wins');
  const gift = count('gift');
  for (const v of [runs, wins, gift]) {
    if (!Number.isInteger(v) || v < 0) return false;
  }
  // A tampered game 1 save is a cheater's by definition.
  const cheater = r['cheater'];
  if (cheater !== undefined && typeof cheater !== 'boolean') return false;
  if (cheater === false && (r['verdict'] === 'edited' || r['verdict'] === 'forged')) return false;
  // The gift is a formula of the old save's wins, not a number you pick.
  return gift === legacyGift(wins);
}

/**
 * Is this payload internally possible?
 *
 * Runs on the **raw** JSON, because `migrateMeta` clamps levels to `maxLevel`
 * and quietly repairs `totalThumbsEarned`: by the time sanitising is done the
 * evidence is gone. Everything here is something a hand-edited save gets wrong
 * even after the checksum has been recomputed.
 */
export function saveIsCoherent(raw: Record<string, unknown>): boolean {
  const n = (k: string): number => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  for (const k of ['runs', 'thumbs', 'wins', 'totalThumbsEarned', 'bestPrompt']) {
    if (n(k) < 0) return false;
  }
  if (n('wins') > n('runs')) return false;
  if (n('totalThumbsEarned') < n('thumbs')) return false;

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
      if (!META_BY_ID[req]) continue;
      if (((lv[req] as number) ?? 0) < 1) return false;
    }
  }
  // Every 👍 ever spent had to be earned first.
  if (spent + n('thumbs') > n('totalThumbsEarned')) return false;

  // Prompt ten is the last one unless Endless Mode is owned. (No "a win means
  // bestPrompt 9" rule: `endRun(true)` is public API and may bank a win early,
  // and a false accusation is worse than a missed one.)
  const endless = typeof lv['endless_mode'] === 'number' && (lv['endless_mode'] as number) >= 1;
  if (!endless && n('bestPrompt') > FINAL_PROMPT_INDEX) return false;

  const ach = raw['achievements'];
  if (ach !== undefined) {
    if (typeof ach !== 'object' || ach === null) return false;
    for (const id of Object.keys(ach as Record<string, unknown>)) {
      if (!ACHIEVEMENT_BY_ID[id]) return false;
    }
  }

  const stats = raw['stats'];
  if (stats !== undefined) {
    if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) return false;
    for (const v of Object.values(stats as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return false;
    }
  }

  return legacyIsCoherent(raw['legacy']);
}

/**
 * Classify a stored payload before it is sanitised.
 *
 * `legacy` is the important one: a save with no `sig` is never an accusation.
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

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

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
  for (const def of META_UPGRADES) levels[def.id] = int(r[def.id], 0, 0, def.maxLevel);
  return levels;
}

function sanitizeAchievements(raw: unknown): Record<AchievementId, number> {
  const out: Record<AchievementId, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    // Drop ids this build does not know rather than carrying them along.
    if (!ACHIEVEMENT_BY_ID[id]) continue;
    const run = int(value, 0, 0);
    if (run > 0) out[id] = run;
  }
  return out;
}

function sanitizeStats(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

/**
 * The import record, with `cheater` always set. Records written before the
 * field existed get it from the verdict and from the stats flag early saves
 * used instead (`legacyStats`), so no save can lose it.
 */
function sanitizeLegacy(raw: unknown, legacyStats: Record<string, number>): MetaState['legacy'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const verdict = r['verdict'];
  if (verdict === 'none') return { verdict: 'none' };
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict)) return null;
  const cheater =
    typeof r['cheater'] === 'boolean'
      ? r['cheater']
      : verdict === 'edited' || verdict === 'forged' || (legacyStats[STAT.legacyCheater] ?? 0) > 0;
  const found: LegacyImport = {
    verdict: verdict as SaveVerdict,
    runs: int(r['runs'], 0),
    wins: int(r['wins'], 0),
    gift: int(r['gift'], 0),
    cheater,
  };
  return found;
}

/**
 * Migration hook. Unrecognised fields fall back to defaults rather than
 * failing the load; the version switch is the seam for future schema bumps.
 */
export function migrateMeta(raw: unknown): MetaState {
  const base = defaultMeta();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  const stats = sanitizeStats(r['stats']);
  const meta: MetaState = {
    thumbs: int(r['thumbs'], base.thumbs),
    levels: sanitizeLevels(r['levels']),
    bestPrompt: int(r['bestPrompt'], base.bestPrompt),
    runs: int(r['runs'], base.runs),
    wins: int(r['wins'], base.wins),
    totalThumbsEarned: int(r['totalThumbsEarned'], base.totalThumbsEarned),
    version: SAVE_VERSION,
    achievements: sanitizeAchievements(r['achievements']),
    stats,
    legacy: sanitizeLegacy(r['legacy'], stats),
    settings: sanitizeSettings(r['settings']),
  };
  // The old stats flag now lives on the import record. Only drop it once it
  // has been folded in; without a record, it stays where isLegacyCheater reads it.
  if (meta.legacy && meta.legacy.verdict !== 'none') delete meta.stats[STAT.legacyCheater];
  // Lifetime 👍 can never be smaller than the 👍 on hand.
  if (meta.totalThumbsEarned < meta.thumbs) meta.totalThumbsEarned = meta.thumbs;
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
  if (typeof text !== 'string' || text.length === 0) return { meta: defaultMeta(), verdict: 'clean' };
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

/** Persist, signed. Returns false instead of throwing when storage refuses. */
export function saveMeta(meta: MetaState, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const payload: Record<string, unknown> = { ...meta, version: SAVE_VERSION };
    // Signed once the payload is final, so a migrated save is re-signed rather
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

/** 👍 cost of the next level of a Training node; Infinity when maxed or unknown. */
export function metaNextCost(meta: MetaState, id: MetaUpgradeId): number {
  const def = META_BY_ID[id];
  if (!def) return Number.POSITIVE_INFINITY;
  const level = int(meta.levels[id], 0, 0, def.maxLevel);
  if (level >= def.maxLevel) return Number.POSITIVE_INFINITY;
  const cost = def.costs[level];
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : Number.POSITIVE_INFINITY;
}
