/**
 * Number / time formatting. Locale-independent on purpose so unit tests and
 * the e2e gauntlet see identical strings on every machine.
 */

// One source of truth for the unit ladder. A local copy is exactly how the
// shop and the HUD end up disagreeing about what a teraslop is.
import { SLOP_UNITS } from '../sim/format.ts';

const SUFFIX = SLOP_UNITS;

/** Compact slop-style number: `947`, `1.24k`, `88.1M`, `3.02G`. */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  const neg = n < 0;
  const a = Math.abs(n);
  let s: string;
  if (a < 1000) {
    s = a < 10 && !Number.isInteger(a) ? a.toFixed(1) : String(Math.floor(a));
  } else {
    let v = a;
    let i = 0;
    while (v >= 1000 && i < SUFFIX.length - 1) {
      v /= 1000;
      i++;
    }
    const digits = v < 10 ? 2 : v < 100 ? 1 : 0;
    s = v.toFixed(digits) + (SUFFIX[i] ?? '');
  }
  return neg ? '-' + s : s;
}

/** Whole number with thousands separators, no locale lookup. */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const neg = n < 0;
  let s = String(Math.floor(Math.abs(n)));
  if (s.length > 3) {
    const parts: string[] = [];
    while (s.length > 3) {
      parts.unshift(s.slice(-3));
      s = s.slice(0, -3);
    }
    parts.unshift(s);
    s = parts.join(',');
  }
  return neg ? '-' + s : s;
}

function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n);
}

/** Fixed-width `mm:ss.d` so the deadline readout never reflows. */
export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--.-';
  const t = Math.max(0, ms);
  const m = Math.min(99, Math.floor(t / 60_000));
  const s = Math.floor((t % 60_000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${pad2(m)}:${pad2(s)}.${d}`;
}

/** Short countdown for incidents: `7.4s`, `1:02`, `∞`. */
export function fmtShortTime(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  const t = Math.max(0, ms);
  if (t >= 60_000) {
    const m = Math.floor(t / 60_000);
    const s = Math.floor((t % 60_000) / 1000);
    return `${m}:${pad2(s)}`;
  }
  return `${(t / 1000).toFixed(1)}s`;
}

/** `0.184` -> `18%`. */
export function fmtPct(f: number): string {
  if (!Number.isFinite(f)) return '∞%';
  return `${Math.round(f * 100)}%`;
}

/**
 * Share of the ship bar a purchase eats. Anything at or over the whole bar
 * reads as `100%+` — "−771% bar" is noise, "more than the whole bar" is a
 * decision.
 */
export function fmtBarCost(f: number): string {
  if (!Number.isFinite(f)) return '∞';
  if (f >= 1) return '100%+';
  if (f > 0 && f < 0.01) return '<1%';
  return `${Math.round(f * 100)}%`;
}

/** Percentage string for bar widths. Quantised so tiny deltas skip the write. */
export function barWidth(f: number): string {
  const clamped = Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0;
  return `${(Math.round(clamped * 1000) / 10).toFixed(1)}%`;
}

/** `ETA 12s` / `ETA 4:05` / `ETA --`. */
export function fmtEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}:${pad2(Math.floor(seconds % 60))}`;
  return `${Math.floor(m / 60)}h+`;
}
