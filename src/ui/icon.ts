/**
 * Shop / card icons.
 *
 * One sheet of 16x16 cells (see tools/art/icons.mjs). Each icon is a
 * `<span>` positioned into the sheet with `background-position`, so the whole
 * set costs a single cached request and scales in integer steps like the rest
 * of the chrome. An unknown id degrades to a neutral tile rather than a hole.
 */
import { ICONS, ICON_COLS, ICON_ROWS, ICON_SHEET } from './icon-map.ts';

/**
 * Set once on the UI root so every icon shares one url() and one grid.
 *
 * The grid comes from the generated manifest, never from a literal in the CSS:
 * the sheet gains a row whenever content outgrows it, and a stale `8` there
 * would silently mis-slice all 75 icons at once.
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
 * Build an icon tile. Always decorative — every row it sits in already has a
 * text label, so the icon is `aria-hidden` and adds nothing for screen readers.
 */
export function iconEl(id: string, parent?: HTMLElement): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = 'tm-icon';
  node.setAttribute('aria-hidden', 'true');
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
