/**
 * Every id the UI can hand to `iconEl()` must exist on the sheet.
 *
 * This has broken twice: content lands, the sheet stays 64 cells, and the shop
 * quietly renders holes. The failure is invisible in a typecheck (icon ids are
 * plain strings) and invisible in a smoke test (a missing icon still renders a
 * `<span>`), so it needs its own assertion.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_TIERS, CARDS, META_UPGRADES, UPGRADES } from '../../src/sim/index.ts';
import { ACHIEVEMENTS } from '../../src/sim/achievements.ts';
import { ICONS, ICON_COLS, ICON_ROWS } from '../../src/ui/icon-map.ts';
import { hasIcon } from '../../src/ui/icon.ts';
import { iconIdFor } from '../../src/ui/meta.ts';

/** id -> where it is requested from, for a failure message worth reading. */
function requestedIcons(): Map<string, string> {
  const want = new Map<string, string>();
  for (const t of AGENT_TIERS) want.set(t.id, `agent tier "${t.name}"`);
  for (const u of UPGRADES) want.set(u.id, `shop upgrade "${u.name}"`);
  for (const c of CARDS) want.set(c.id, `draft card "${c.name}"`);
  for (const m of META_UPGRADES) want.set(iconIdFor(m), `tree node "${m.name}"`);
  // Achievements draw from the same sheet. Pickups do not — they are rendered
  // procedurally on the canvas — so an achievement that borrowed a pickup id
  // silently rendered a blank tile.
  for (const a of ACHIEVEMENTS) want.set(a.icon, `achievement "${a.name}"`);
  // Pickups are drawn procedurally onto the canvas, not from this sheet.
  return want;
}

describe('icon sheet coverage', () => {
  it('has an icon for every tier, upgrade, card and tree node', () => {
    const missing = [...requestedIcons()]
      .filter(([id]) => !hasIcon(id))
      .map(([id, why]) => `${id} (${why})`);
    expect(missing, `add these to tools/art/icons.mjs:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('fits inside the generated grid', () => {
    for (const [id, [x, y]] of Object.entries(ICONS)) {
      expect(x, `${id} column`).toBeLessThan(ICON_COLS);
      expect(y, `${id} row`).toBeLessThan(ICON_ROWS);
    }
    // A sheet with a wholly empty trailing row means the manifest and the PNG
    // disagree about height, which shifts nothing but wastes a fetch.
    const lastRow = Object.values(ICONS).some(([, y]) => y === ICON_ROWS - 1);
    expect(lastRow, 'ICON_ROWS is larger than the icons actually occupy').toBe(true);
  });

  it('gives every icon its own cell', () => {
    const cells = Object.values(ICONS).map(([x, y]) => `${x},${y}`);
    expect(new Set(cells).size, 'two icons share a cell').toBe(cells.length);
  });
});
