/**
 * CLI mirror of tests/unit/ui.icons.test.ts — handy while adding content.
 * It imports the UI's own `iconIdFor` rather than re-deriving it, so the two
 * cannot disagree about which icon a tree node asks for.
 */
import { AGENT_TIERS, CARDS, META_UPGRADES, UPGRADES } from '@sim/index.ts';
import { ICONS, ICON_COLS, ICON_ROWS } from '../src/ui/icon-map.ts';
import { iconIdFor } from '../src/ui/meta.ts';

const want = new Map<string, string>();
for (const t of AGENT_TIERS) want.set(t.id, 'agent tier');
for (const u of UPGRADES) want.set(u.id, 'shop upgrade');
for (const c of CARDS) want.set(c.id, 'draft card');
for (const m of META_UPGRADES) want.set(iconIdFor(m), `tree node (${m.name})`);
// Pickups are drawn procedurally on the canvas, not from the DOM sheet.

const missing = [...want].filter(([id]) => !(id in ICONS));
const used = Object.keys(ICONS).length;
console.log(`sheet: ${used} icons in ${ICON_COLS}x${ICON_ROWS} (${ICON_COLS * ICON_ROWS} cells)`);
console.log(`needed: ${want.size} | missing: ${missing.length}`);
for (const [id, why] of missing) console.log(`  ${id.padEnd(22)} ${why}`);
process.exitCode = missing.length > 0 ? 1 : 0;
