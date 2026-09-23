import { describe, expect, it } from 'vitest';
import { CONTEXT_WINDOW_LABELS, META_CURVES, BALANCE, promptAt } from '../../src/sim/content.ts';
import {
  TOKEN_UNITS,
  formatContext,
  formatEta,
  formatInt,
  formatMult,
  formatPercent,
  formatRate,
  formatTime,
  formatTokens,
} from '../../src/sim/format.ts';

describe('formatTokens', () => {
  it('prints integers below 1000 bare', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(7.9)).toBe('7');
    expect(formatTokens(999)).toBe('999');
  });

  it('prints two decimals and an SI unit from 1000 up', () => {
    expect(formatTokens(1000)).toBe('1.00K');
    expect(formatTokens(184_200)).toBe('184.20K');
    expect(formatTokens(4.56e6)).toBe('4.56M');
    expect(formatTokens(2.5e9)).toBe('2.50G');
    expect(formatTokens(promptAt(9).requirement)).toBe('3.84T');
  });

  it('promotes instead of printing 1000.00', () => {
    expect(formatTokens(999_999)).toBe('1.00M');
    expect(formatTokens(999_994)).toBe('999.99K');
  });

  it('handles signs, infinities and garbage', () => {
    expect(formatTokens(-1500)).toBe('-1.50K');
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatTokens(Number.NEGATIVE_INFINITY)).toBe('-∞');
    expect(formatTokens(Number.NaN)).toBe('0');
  });

  it('runs out of units gracefully', () => {
    const last = TOKEN_UNITS[TOKEN_UNITS.length - 1];
    expect(formatTokens(1e40).endsWith(last!)).toBe(true);
  });
});

describe('formatContext', () => {
  it('writes windows the way model cards do', () => {
    expect(formatContext(BALANCE.BASE_CONTEXT)).toBe('8K');
    expect(formatContext(184_320)).toBe('184K');
    expect(formatContext(1_000_000)).toBe('1M');
    expect(formatContext(10_000_000)).toBe('10M');
  });

  it('matches every Context Window label in the tree', () => {
    META_CURVES.CONTEXT_WINDOW.forEach((mult, i) => {
      expect(formatContext(BALANCE.BASE_CONTEXT * mult)).toBe(CONTEXT_WINDOW_LABELS[i]);
    });
  });

  it('keeps one decimal below ten, and rounds across unit boundaries', () => {
    expect(formatContext(1500)).toBe('1.5K');
    expect(formatContext(9_940)).toBe('9.9K');
    expect(formatContext(9_960)).toBe('10K');
    expect(formatContext(999)).toBe('999');
    expect(formatContext(999.6)).toBe('1K');
    expect(formatContext(999_700)).toBe('1M');
    expect(formatContext(1_500_000)).toBe('1.5M');
    expect(formatContext(0)).toBe('0');
    expect(formatContext(Number.NaN)).toBe('0');
    expect(formatContext(Number.POSITIVE_INFINITY)).toBe('∞');
  });
});

describe('the rest, as the first game had them', () => {
  it('formatRate', () => {
    expect(formatRate(12.34)).toBe('12.3/s');
    expect(formatRate(1234)).toBe('1.23K/s');
    expect(formatRate(999.96)).toBe('1.00K/s');
    expect(formatRate(-2)).toBe('-2.0/s');
    expect(formatRate(Number.NaN)).toBe('0.0/s');
  });

  it('formatTime rounds up so the last second still reads', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(1)).toBe('0:01');
    expect(formatTime(61_000)).toBe('1:01');
    expect(formatTime(120_000)).toBe('2:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });

  it('formatInt groups without a locale', () => {
    expect(formatInt(1_234_567)).toBe('1,234,567');
    expect(formatInt(-1000)).toBe('-1,000');
    expect(formatInt(12.9)).toBe('12');
    expect(formatInt(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('formatMult and formatPercent', () => {
    expect(formatMult(3)).toBe('×3');
    expect(formatMult(1.25)).toBe('×1.25');
    expect(formatMult(Number.NaN)).toBe('×1');
    expect(formatPercent(0.35)).toBe('35%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('formatEta', () => {
    expect(formatEta(0)).toBe('0s');
    expect(formatEta(11.2)).toBe('12s');
    expect(formatEta(184)).toBe('3m 04s');
    expect(formatEta(7322)).toBe('2h 2m');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
