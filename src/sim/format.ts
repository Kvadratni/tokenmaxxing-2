/**
 * Display formatting. Locale-independent on purpose: identical output on every
 * machine keeps the e2e snapshots and the balance reports stable.
 */

/**
 * SI prefixes, because the joke is FLOPS: a *quantity* of work is measured in
 * slop, and a *rate* is measured in slops — slop per second. So the wallet
 * reads `4.20 TSLOP` and the production readout reads `17.3 GSLOPS`.
 *
 * Real SI runs out at quetta (1e30). Past that we use `H` for hella, which was
 * a genuinely proposed prefix for 1e27 and never made it — exactly the right
 * flavour of real-but-ridiculous for a game about slop.
 */
export const SLOP_UNITS = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q', 'H'] as const;

/** Long names, index-matched to SLOP_UNITS. Used for the wallet's label. */
export const SLOP_UNIT_NAMES = [
  'slop',
  'kiloslop',
  'megaslop',
  'gigaslop',
  'teraslop',
  'petaslop',
  'exaslop',
  'zettaslop',
  'yottaslop',
  'ronnaslop',
  'quettaslop',
  'hellaslop',
] as const;

/** Which SI tier a magnitude lands in. Clamped to the table. */
export function slopTier(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  // Magnitude first: -1500 is a kiloslop debt, not 0 tier.
  const mag = Math.abs(n);
  if (mag < 1000) return 0;
  const last = SLOP_UNITS.length - 1;
  let tier = 0;
  let scaled = mag;
  while (scaled >= 1000 && tier < last) {
    scaled /= 1000;
    tier += 1;
  }
  if (scaled >= 999.995 && tier < last) tier += 1;
  return tier;
}

/**
 * Full unit word for a magnitude — `4.2e12` -> "teraslop". Pluralised into the
 * rate form ("teraslops") by `slopRateName`.
 */
export function slopUnitName(n: number): string {
  return SLOP_UNIT_NAMES[slopTier(n)] ?? 'slop';
}

/** Rate form: slop *per second*, the FLOPS pun. `4.2e9` -> "gigaslops". */
export function slopRateName(n: number): string {
  return `${slopUnitName(n)}s`;
}

/**
 * `999` -> "999", `1000` -> "1.00k", `4.56e6` -> "4.56M".
 * Integers below 1000 print bare; everything else gets two decimals and a unit.
 */
export function formatSlop(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  if (n === Number.POSITIVE_INFINITY) return '∞';
  if (n === Number.NEGATIVE_INFINITY) return '-∞';
  if (n < 0) return `-${formatSlop(-n)}`;
  if (n < 1000) return String(Math.floor(n));

  const last = SLOP_UNITS.length - 1;
  let tier = 0;
  let scaled = n;
  while (scaled >= 1000 && tier < last) {
    scaled /= 1000;
    tier += 1;
  }
  // toFixed(2) can round 999.999 up to "1000.00" — promote instead.
  if (scaled >= 999.995 && tier < last) {
    scaled /= 1000;
    tier += 1;
  }
  return `${scaled.toFixed(2)}${SLOP_UNITS[tier]}`;
}

/** Countdown-friendly `M:SS`. Rounds up so the last second still reads 0:01. */
export function formatTime(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** `12.34` -> "12.3/s", `1234` -> "1.23k/s". */
export function formatRate(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0.0/s';
  if (n < 0) return `-${formatRate(-n)}`;
  if (n < 1000) {
    const rounded = Math.round(n * 10) / 10;
    if (rounded < 1000) return `${rounded.toFixed(1)}/s`;
    // Rounded up across the unit boundary — print it as the next unit.
    return `${formatSlop(1000)}/s`;
  }
  return `${formatSlop(n)}/s`;
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

/** The number alone, already divided down into its SI tier. */
export function slopMantissa(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const tier = slopTier(n);
  const mag = Math.abs(n);
  return tier === 0 ? String(Math.floor(mag)) : (mag / Math.pow(1000, tier)).toFixed(2);
}

/**
 * Wallet form — a quantity of slop. `4.2e12` -> "4.20 TSLOP".
 * Below a kiloslop there is no prefix, so it reads "840 SLOP".
 */
export function formatSlopUnit(n: number): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0 SLOP';
  if (!Number.isFinite(n)) return `${n > 0 ? '' : '-'}\u221e SLOP`;
  const prefix = (SLOP_UNITS[slopTier(n)] ?? '').toUpperCase();
  return `${n < 0 ? '-' : ''}${slopMantissa(n)} ${prefix}SLOP`;
}

/**
 * Rate form — slop per second. `1.73e10` -> "17.3 GSLOPS".
 * The trailing S is the "per second", so there is deliberately no "/s".
 */
export function formatSlops(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0 SLOPS';
  const tier = slopTier(n);
  const prefix = (SLOP_UNITS[tier] ?? '').toUpperCase();
  if (tier === 0) {
    // Sub-kilo rates get one decimal; "0.4 SLOPS" is more use than "0 SLOPS".
    const rounded = Math.round(Math.abs(n) * 10) / 10;
    return `${n < 0 ? '-' : ''}${rounded.toFixed(1)} SLOPS`;
  }
  return `${n < 0 ? '-' : ''}${slopMantissa(n)} ${prefix}SLOPS`;
}
