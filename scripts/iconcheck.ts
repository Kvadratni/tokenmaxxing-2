/**
 * CLI mirror of tests/unit/ui.icons.test.ts, handy while adding content:
 * every icon id the UI will ask the sheet for, and which the sheet lacks.
 *
 *   npx vite-node scripts/iconcheck.ts
 *
 * It asks the UI itself (`requiredIconIds`, and `iconIdFor` for tree nodes)
 * rather than re-deriving ids, so the two cannot disagree.
 */
import { META_UPGRADES } from '@sim/index.ts';
import { requiredIconIds } from '../src/ui/icon-ids.ts';
import { ICONS, ICON_COLS, ICON_ROWS } from '../src/ui/icon-map.ts';
import { iconIdFor } from '../src/ui/meta.ts';

const want = new Set<string>(requiredIconIds());
for (const m of META_UPGRADES) want.add(iconIdFor(m));

const missing = [...want].filter((id) => !(id in ICONS));
const used = Object.keys(ICONS).length;
console.log(`sheet: ${used} icons in ${ICON_COLS}x${ICON_ROWS} (${ICON_COLS * ICON_ROWS} cells)`);
console.log(`needed: ${want.size} | missing: ${missing.length}`);
for (const id of missing) console.log(`  ${id}`);
process.exitCode = missing.length > 0 ? 1 : 0;
