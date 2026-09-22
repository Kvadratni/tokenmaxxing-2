import { describe, expect, it } from 'vitest';
import {
  SLOP_UNITS,
  formatEta,
  formatInt,
  formatMult,
  formatPercent,
  formatRate,
  formatSlop,
  formatSlopUnit,
  formatSlops,
  formatTime,
  slopRateName,
  slopUnitName,
} from '../../src/sim/format.ts';

describe('formatSlop', () => {
  it('prints integers below 1000 with no decimals', () => {
    expect(formatSlop(0)).toBe('0');
    expect(formatSlop(1)).toBe('1');
    expect(formatSlop(42.9)).toBe('42');
    expect(formatSlop(999)).toBe('999');
    expect(formatSlop(999.4)).toBe('999');
  });

  it('switches to two-decimal units at exactly 1000', () => {
    expect(formatSlop(1000)).toBe('1.00k');
    expect(formatSlop(1234)).toBe('1.23k');
    expect(formatSlop(12_345)).toBe('12.35k');
    expect(formatSlop(999_000)).toBe('999.00k');
  });

  it('promotes rather than printing 1000.00 of a lower unit', () => {
    expect(formatSlop(999_999.9)).toBe('1.00M');
    expect(formatSlop(1_000_000)).toBe('1.00M');
  });

  it('covers the whole unit ladder', () => {
    // SI ladder: kilo through quetta, then hella (the prefix that never was).
    const expected = ['1.00k', '1.00M', '1.00G', '1.00T', '1.00P', '1.00E', '1.00Z', '1.00Y', '1.00R', '1.00Q', '1.00H'];
    for (let i = 0; i < expected.length; i++) {
      expect(formatSlop(Math.pow(1000, i + 1))).toBe(expected[i]);
    }
    expect(SLOP_UNITS.length).toBe(12);
  });

  it('clamps past the top unit instead of running out of names', () => {
    expect(formatSlop(Math.pow(1000, 12))).toBe('1000.00H');
  });

  it('handles negatives and non-finite input without throwing', () => {
    expect(formatSlop(-1500)).toBe('-1.50k');
    expect(formatSlop(-12)).toBe('-12');
    expect(formatSlop(Number.NaN)).toBe('0');
    expect(formatSlop(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatSlop(Number.NEGATIVE_INFINITY)).toBe('-∞');
  });
});

describe('formatTime', () => {
  it('formats M:SS with a zero-padded seconds field', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(1)).toBe('0:01');
    expect(formatTime(1000)).toBe('0:01');
    expect(formatTime(9000)).toBe('0:09');
    expect(formatTime(10_000)).toBe('0:10');
    expect(formatTime(60_000)).toBe('1:00');
    expect(formatTime(90_000)).toBe('1:30');
    expect(formatTime(120_000)).toBe('2:00');
    expect(formatTime(600_000)).toBe('10:00');
  });

  it('rounds up so a countdown never shows 0:00 while time remains', () => {
    expect(formatTime(59_999)).toBe('1:00');
    expect(formatTime(0.5)).toBe('0:01');
  });

  it('clamps negatives and non-finite input', () => {
    expect(formatTime(-1)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatRate', () => {
  it('uses one decimal below 1000', () => {
    expect(formatRate(0)).toBe('0.0/s');
    expect(formatRate(12.34)).toBe('12.3/s');
    expect(formatRate(12.35)).toBe('12.4/s');
    expect(formatRate(999.4)).toBe('999.4/s');
  });

  it('switches to slop units at 1000', () => {
    expect(formatRate(1000)).toBe('1.00k/s');
    expect(formatRate(999.96)).toBe('1.00k/s');
    expect(formatRate(1_500_000)).toBe('1.50M/s');
  });

  it('handles negatives and NaN', () => {
    expect(formatRate(-4.25)).toBe('-4.3/s');
    expect(formatRate(Number.NaN)).toBe('0.0/s');
  });
});

describe('secondary formatters', () => {
  it('formatInt groups without locale dependence', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1,000');
    expect(formatInt(1_234_567)).toBe('1,234,567');
    expect(formatInt(-1000)).toBe('-1,000');
    expect(formatInt(Number.NaN)).toBe('0');
  });

  it('formatMult drops decimals for whole multipliers', () => {
    expect(formatMult(3)).toBe('×3');
    expect(formatMult(1.25)).toBe('×1.25');
    expect(formatMult(Number.NaN)).toBe('×1');
  });

  it('formatPercent rounds to whole percent', () => {
    expect(formatPercent(0.35)).toBe('35%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('formatEta degrades to an em dash when unreachable', () => {
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatEta(0)).toBe('0s');
    expect(formatEta(12.1)).toBe('13s');
    expect(formatEta(184)).toBe('3m 04s');
    expect(formatEta(7200)).toBe('2h 0m');
  });
});

describe('slop units — the FLOPS pun', () => {
  it('a quantity is slop, a rate is slops', () => {
    // The trailing S on the rate *is* the "per second". That is the joke.
    expect(formatSlopUnit(3.84e12)).toBe('3.84 TSLOP');
    expect(formatSlops(1.73e10)).toBe('17.30 GSLOPS');
  });

  it('below a kiloslop there is no prefix', () => {
    expect(formatSlopUnit(840)).toBe('840 SLOP');
    expect(formatSlops(4)).toBe('4.0 SLOPS');
  });

  it('names every rung of the ladder', () => {
    const names = [1, 1e3, 1e6, 1e9, 1e12, 1e15, 1e18, 1e21, 1e24, 1e27, 1e30, 1e33].map(
      slopUnitName,
    );
    expect(names).toEqual([
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
    ]);
  });

  it('the rate name is just the quantity name pluralised', () => {
    expect(slopRateName(1.73e10)).toBe('gigaslops');
    expect(slopRateName(0)).toBe('slops');
  });

  it('survives negatives and non-finite input', () => {
    expect(formatSlopUnit(Number.NaN)).toBe('0 SLOP');
    expect(formatSlops(Number.NaN)).toBe('0 SLOPS');
    expect(formatSlopUnit(-1500)).toBe('-1.50 KSLOP');
    expect(formatSlops(-1500)).toBe('-1.50 KSLOPS');
  });

  it('clamps at the top of the ladder rather than running out of names', () => {
    expect(slopUnitName(1e60)).toBe('hellaslop');
    expect(formatSlops(1e60)).toContain('HSLOPS');
  });
});
