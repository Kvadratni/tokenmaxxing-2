/**
 * Global hotkeys.
 *
 *   Space / Enter   click the laptop (handled locally by the scene button)
 *   1 - 9           buy the Nth visible agent tier
 *   S               ship
 *   Q               cycle buy quantity
 *   Esc             close a dismissable dialog / leave the Demos shop
 *
 * Keys never fire while a text field has focus, while a modifier is held, or
 * while a modal is up (Escape is handled inside the modal itself).
 */
import { isTypingTarget, on } from './dom.ts';

export interface HotkeyHandlers {
  /** A modal owns the keyboard right now. */
  isBlocked(): boolean;
  buyTier(index: number): void;
  ship(): void;
  escape(): void;
}

export interface HotkeyHint {
  keys: string;
  what: string;
}

export const HOTKEY_HINTS: readonly HotkeyHint[] = [
  { keys: 'Space', what: 'code' },
  { keys: '1-9', what: 'buy agent' },
  { keys: 'S', what: 'ship' },
  { keys: 'Esc', what: 'close' },
];

export function bindHotkeys(target: EventTarget, h: HotkeyHandlers): () => void {
  return on(target, 'keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      h.escape();
      return;
    }
    if (h.isBlocked()) return;
    if (e.repeat) return;

    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      h.buyTier(e.key.charCodeAt(0) - 49);
      return;
    }
    if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      h.ship();
    }
  });
}
