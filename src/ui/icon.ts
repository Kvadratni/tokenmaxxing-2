/**
 * Icon tiles.
 *
 * One sheet of 16x16 cells (tools/art/icons.mjs). Each icon is a `<span>`
 * positioned into the sheet with `background-position`, so the whole set costs
 * a single cached request and scales in integer steps like the rest of the
 * chrome. Ids come from `icon-ids.ts`; an id the sheet does not have yet
 * degrades to a neutral tile (or to a text glyph, where one reads better)
 * rather than a hole.
 */
import { ICONS, ICON_COLS, ICON_ROWS, ICON_SHEET } from './icon-map.ts';

/**
 * Set once on the UI root so every icon shares one url() and one grid.
 *
 * The grid comes from the generated manifest, never from a literal in the CSS:
 * the sheet gains a row whenever content outgrows it, and a stale number there
 * would silently mis-slice every icon at once.
 */
export function installIconSheet(root: HTMLElement): void {
  root.style.setProperty('--icon-sheet', `url("${ICON_SHEET}")`);
  root.style.setProperty('--icon-cols', String(ICON_COLS));
  root.style.setProperty('--icon-rows', String(ICON_ROWS));
}

export function hasIcon(id: string): boolean {
  return ICONS[id] !== undefined;
}

/**
 * Build an icon tile. Always decorative: every place it sits already has a
 * text label, so the icon is `aria-hidden` and adds nothing for screen readers.
 */
export function iconEl(id: string, parent?: HTMLElement): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = 'tm-icon';
  node.setAttribute('aria-hidden', 'true');
  node.dataset['icon'] = id;
  const pos = ICONS[id];
  if (pos) {
    node.style.setProperty('--ix', String(pos[0]));
    node.style.setProperty('--iy', String(pos[1]));
  } else {
    node.classList.add('tm-icon--missing');
  }
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * An icon when the sheet has it, otherwise a text glyph in the same slot. For
 * chrome like the 👍 tally, where an empty grey tile would read as broken but
 * the emoji reads fine. The glyph is painted by CSS (`content: attr(...)`), so
 * the text of whatever holds it is the same with the sheet or without it.
 */
export function iconOrGlyph(id: string, glyph: string, parent?: HTMLElement): HTMLSpanElement {
  if (hasIcon(id)) return iconEl(id, parent);
  const node = document.createElement('span');
  node.className = 'tm-glyph';
  node.setAttribute('aria-hidden', 'true');
  node.dataset['icon'] = id;
  node.dataset['glyph'] = glyph;
  if (parent) parent.appendChild(node);
  return node;
}
