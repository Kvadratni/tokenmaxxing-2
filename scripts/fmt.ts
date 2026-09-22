import { formatSlop, formatSlopUnit, formatSlops, slopUnitName } from '@sim/format.ts';
for (const n of [0, 840, 1000, 999999.9, 1.73e10, 3.84e12, 5.08e10, 1e33]) {
  console.log(
    String(n).padStart(11), '|',
    formatSlop(n).padEnd(9), '|',
    formatSlopUnit(n).padEnd(15), '|',
    formatSlops(n).padEnd(16), '|',
    slopUnitName(n),
  );
}
