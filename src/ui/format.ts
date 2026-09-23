/**
 * Number and time formatting for the chrome.
 *
 * The sim owns the number formats (`formatTokens` and friends), so the HUD,
 * the canvas and the balance reports can never disagree about what "184.2K"
 * means. They are re-exported here so every UI module formats through one
 * door. The helpers below are presentation only: bar widths, countdowns and
 * the rate line. All locale-independent, so tests see identical strings on
 * every machine.
 */
import { formatContext, formatInt, formatTokens } from '../sim/index.ts';

export { formatContext, formatInt, formatTokens };

/**
 * A token *rate*. Below 100 a whole-number format would print a new player's
 * first Grep (0.8 tokens a second) as "0", so small rates keep one decimal.
 */
export function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '0';
  const a = Math.abs(n);
  if (a >= 100) return formatTokens(n);
  const r = Math.round(a * 10) / 10;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return n < 0 ? `-${s}` : s;
}

/** `0.06` -> `+6%`, `0.004` -> `+0.4%`. For "how much will this press restore". */
export function fmtGain(f: number): string {
  if (!Number.isFinite(f) || f <= 0) return '+0%';
  const pct = f * 100;
  if (pct < 1) return `+${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `+${Math.round(pct)}%`;
}

/** `0.184` -> `18%`, clamped so a verify chance never reads 101%. */
export function fmtPct(f: number): string {
  if (!Number.isFinite(f)) return '0%';
  return `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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

/**
 * Patience readout, `M:SS`, rounded *up* so the last second still reads 0:01
 * and the bar and the number hit zero together. Fixed width for anything under
 * ten minutes, which is every prompt the human will ever sit through.
 */
export function fmtClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/** `42` -> `42s`, `130` -> `2:10`. For "full in …" hints. */
export function fmtSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '--';
  if (s < 60) return `${Math.max(1, Math.ceil(s))}s`;
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)}:${pad2(t % 60)}`;
}

/** Percentage string for bar widths. Quantised so tiny deltas skip the write. */
export function barWidth(f: number): string {
  const clamped = Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0;
  return `${(Math.round(clamped * 1000) / 10).toFixed(1)}%`;
}

/** Whole-number multiplier: `1.2` -> `×1.20`. */
export function fmtMult(n: number): string {
  if (!Number.isFinite(n)) return '×1.00';
  return `×${n.toFixed(2)}`;
}

/**
 * The human's quoted text without its quotes: `"wait stop"` -> `wait stop`.
 * Incident names for things the human *said* are stored quoted.
 */
export function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

/** True when an incident name is something the human typed. */
export function isQuoted(s: string): boolean {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"');
}
