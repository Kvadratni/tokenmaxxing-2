/**
 * The UI icon sheet covers every id the UI can ask for. The UI looks icons up
 * by convention only, so the convention is the contract:
 *   tool_<id>, upg_<id>, card_<id>, meta_<id>, pickup_<id>,
 *   each achievement's `icon` field, and ui_thumbs / ui_context /
 *   ui_patience / ui_compact / ui_claim.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS, ICON_COLS, ICON_IDS, ICON_ROWS, ICON_SIZE, iconPos } from '../../src/render/icon-map.ts';
import { ACHIEVEMENTS, CARDS, META_UPGRADES, PICKUPS, TOOLS, UPGRADES } from '../../src/sim/content.ts';

const UI_IDS = ['ui_thumbs', 'ui_context', 'ui_patience', 'ui_compact', 'ui_claim'];

function expectedIds(): string[] {
  return [
    ...TOOLS.map((t) => `tool_${t.id}`),
    ...UPGRADES.map((u) => `upg_${u.id}`),
    ...CARDS.map((c) => `card_${c.id}`),
    ...META_UPGRADES.map((m) => `meta_${m.id}`),
    ...PICKUPS.map((p) => `pickup_${p.id}`),
    ...ACHIEVEMENTS.map((a) => a.icon),
    ...UI_IDS,
  ];
}

describe('icon coverage', () => {
  it('has a cell for every content id, by the naming convention', () => {
    const missing = expectedIds().filter((id) => !ICONS[id]);
    expect(missing, `no icon for: ${missing.join(', ')}`).toEqual([]);
  });

  it('has nothing the content does not know about', () => {
    const wanted = new Set(expectedIds());
    expect(ICON_IDS.filter((id) => !wanted.has(id))).toEqual([]);
    expect(ICON_IDS).toHaveLength(wanted.size);
  });

  it('gives every achievement its own icon field', () => {
    for (const a of ACHIEVEMENTS) expect(iconPos(a.icon), a.id).not.toBeNull();
    expect(new Set(ACHIEVEMENTS.map((a) => a.icon)).size).toBe(ACHIEVEMENTS.length);
  });

  it('places every icon in its own cell, inside the grid', () => {
    const cells = new Set<string>();
    for (const [id, pos] of Object.entries(ICONS)) {
      const [col, row] = pos;
      expect(col, id).toBeGreaterThanOrEqual(0);
      expect(col, id).toBeLessThan(ICON_COLS);
      expect(row, id).toBeGreaterThanOrEqual(0);
      expect(row, id).toBeLessThan(ICON_ROWS);
      const key = `${col},${row}`;
      expect(cells.has(key), `${id} shares cell ${key}`).toBe(false);
      cells.add(key);
    }
  });

  it('the sheet on disk matches the manifest grid', () => {
    const path = resolve(process.cwd(), 'public/sprites/icons.png');
    const png = readFileSync(path);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(ICON_COLS * ICON_SIZE);
    expect(png.readUInt32BE(20)).toBe(ICON_ROWS * ICON_SIZE);
  });

  it('unknown ids resolve to null, not to someone else\'s cell', () => {
    expect(iconPos('tool_nonsense')).toBeNull();
    expect(iconPos('')).toBeNull();
  });
});
