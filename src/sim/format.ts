/**
 * Display formatting. Locale-independent on purpose: identical output on every
 * machine keeps the e2e snapshots and the balance reports stable.
 */

/**
 * The unit ladder for token counts: SI prefixes, as in the first game, with an
 * upper-case K because that is how context windows are written (8K, 200K).
 */
export const TOKEN_UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'] as const;

/**
 * `999` -> "999", `1000` -> "1.00K", `184_200` -> "184.20K", `3.84e12` -> "3.84T".
 * Integers below 1000 print bare; everything else gets two decimals and a unit.
 * (The first game's formatter, renamed.)
 */
export function formatTokens(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  if (n === Number.POSITIVE_INFINITY) return '∞';
  if (n === Number.NEGATIVE_INFINITY) return '-∞';
  if (n < 0) return `-${formatTokens(-n)}`;
  if (n < 1000) return String(Math.floor(n));

  const last = TOKEN_UNITS.length - 1;
  let tier = 0;
  let scaled = n;
  while (scaled >= 1000 && tier < last) {
    scaled /= 1000;
    tier += 1;
  }
  // toFixed(2) can round 999.999 up to "1000.00": promote instead.
  if (scaled >= 999.995 && tier < last) {
    scaled /= 1000;
    tier += 1;
  }
  return `${scaled.toFixed(2)}${TOKEN_UNITS[tier]}`;
}

/** One decimal below ten, none above, and never a trailing ".0". */
function compact(v: number): string {
  if (v >= 9.95) return String(Math.round(v));
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * Context sizes the way model cards write them: `8000` -> "8K",
 * `184_320` -> "184K", `1e6` -> "1M", `1e7` -> "10M", `1500` -> "1.5K".
 */
export function formatContext(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  if (n < 0) return `-${formatContext(-n)}`;
  if (n < 999.5) return String(Math.round(n));
  if (n < 999_500) return `${compact(n / 1e3)}K`;
  if (n < 999_500_000) return `${compact(n / 1e6)}M`;
  return `${compact(n / 1e9)}G`;
}

/** Countdown-friendly `M:SS`. Rounds up so the last second still reads 0:01. */
export function formatTime(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** `12.34` -> "12.3/s", `1234` -> "1.23K/s". */
export function formatRate(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0.0/s';
  if (n < 0) return `-${formatRate(-n)}`;
  if (n < 1000) {
    const rounded = Math.round(n * 10) / 10;
    if (rounded < 1000) return `${rounded.toFixed(1)}/s`;
    // Rounded up across the unit boundary: print it as the next unit.
    return `${formatTokens(1000)}/s`;
  }
  return `${formatTokens(n)}/s`;
}

/** Grouped integer without locale dependence: `1234567` -> "1,234,567". */
export function formatInt(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const neg = n < 0;
  const digits = String(Math.floor(Math.abs(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return neg ? `-${out}` : out;
}

/** `1.25` -> "×1.25", `3` -> "×3". */
export function formatMult(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '×1';
  if (Number.isInteger(n)) return `×${n}`;
  return `×${n.toFixed(2)}`;
}

/** `0.35` -> "35%". */
export function formatPercent(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0%';
  return `${Math.round(n * 100)}%`;
}

/** Seconds as a compact ETA: "12s", "3m 04s", "—" when unreachable. */
export function formatEta(seconds: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const total = Math.ceil(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
