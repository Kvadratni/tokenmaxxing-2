/**
 * The art tools read the game's own TypeScript: content.ts for every id that
 * needs an icon or a gadget, atlas-types.ts for the sprite contract. Modern
 * Node strips types on import, so no build step and no second copy of the ids.
 */
const CONTENT_URL = new URL('../../src/sim/content.ts', import.meta.url);
const CONTRACT_URL = new URL('../../src/render/atlas-types.ts', import.meta.url);

async function importTs(url, what) {
  try {
    return await import(url.href);
  } catch (error) {
    const hint = 'tools/art imports TypeScript directly and needs Node 22.18+ or 23.6+ '
      + `(this is ${process.version}).`;
    throw new Error(`could not load ${what}: ${error.message}\n${hint}`);
  }
}

let content = null;
/** TOOLS, UPGRADES, CARDS, META_UPGRADES, PICKUPS, ACHIEVEMENTS, ... */
export async function loadContent() {
  content ??= await importTs(CONTENT_URL, 'src/sim/content.ts');
  return content;
}

let contract = null;
/** REQUIRED_SPRITES, AGENT_BOX, AGENT_FEET, ... */
export async function loadRenderContract() {
  contract ??= await importTs(CONTRACT_URL, 'src/render/atlas-types.ts');
  return contract;
}

/**
 * Every icon id the UI may ask for, in sheet order. The UI looks icons up by
 * this convention only, so this is the whole contract:
 *   tool_<id>, upg_<id>, card_<id>, meta_<id>, pickup_<id>,
 *   each achievement's own `icon` field, and the five HUD glyphs.
 */
export const UI_ICON_IDS = Object.freeze(['ui_thumbs', 'ui_context', 'ui_patience', 'ui_compact', 'ui_claim']);

export async function iconIds() {
  const c = await loadContent();
  const families = [
    { family: 'tool', ids: c.TOOLS.map((t) => `tool_${t.id}`) },
    { family: 'upg', ids: c.UPGRADES.map((u) => `upg_${u.id}`) },
    { family: 'card', ids: c.CARDS.map((x) => `card_${x.id}`) },
    { family: 'meta', ids: c.META_UPGRADES.map((m) => `meta_${m.id}`) },
    { family: 'pickup', ids: c.PICKUPS.map((p) => `pickup_${p.id}`) },
    { family: 'achv', ids: c.ACHIEVEMENTS.map((a) => a.icon) },
    { family: 'ui', ids: [...UI_ICON_IDS] },
  ];
  const all = families.flatMap((f) => f.ids);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate icon ids: ${[...new Set(dupes)].join(', ')}`);
  return { families, all };
}
