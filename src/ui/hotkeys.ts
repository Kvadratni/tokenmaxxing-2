/**
 * Global hotkeys on the run screen.
 *
 *   Space       generate (click the agent), wherever focus is
 *   Enter       generate, while the agent itself has focus (stage.ts)
 *   1 - 9       buy the Nth visible tool, at the current ×1/×10/×100
 *   S           report done, or claim done: whatever the button says
 *   Y           "You're absolutely right!"
 *   C           /compact (once Training has unlocked it)
 *   Esc         close a dismissable dialog or the shop drawer; leave Training
 *
 * Keys never fire while a text field has focus, while a modifier is held, or
 * while a dialog owns the keyboard (Escape is handled inside the dialog
 * itself). Held keys do not repeat: generating is a click, not a hold.
 */
import { isTypingTarget, on } from './dom.ts';

export interface HotkeyHandlers {
  /** A dialog, or another screen, owns the keyboard right now. */
  isBlocked(): boolean;
  /** Space is also a button's own activation key; while this is true it is left alone. */
  spaceIsLocal(): boolean;
  generate(): void;
  buyTool(index: number): void;
  report(): void;
  absolutelyRight(): void;
  compact(): void;
  escape(): void;
}

export interface HotkeyHint {
  readonly keys: string;
  readonly what: string;
}

/** The topbar legend. The help dialog lists the full set. */
export const HOTKEY_HINTS: readonly HotkeyHint[] = [
  { keys: 'Space', what: 'generate' },
  { keys: '1-9', what: 'tools' },
  { keys: 'S', what: 'report' },
  { keys: 'Y', what: 'absolutely right' },
  { keys: 'C', what: 'compact' },
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

    if (e.key === ' ' || e.key === 'Spacebar') {
      if (h.spaceIsLocal()) return;
      // Stops the focused button (a shop row, say) activating as well: Space
      // means "generate" on this screen, and a stray purchase is worse than a
      // lost keyboard shortcut. Enter still activates buttons.
      e.preventDefault();
      if (!e.repeat) h.generate();
      return;
    }
    if (e.repeat) return;

    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      h.buyTool(e.key.charCodeAt(0) - 49);
      return;
    }
    switch (e.key.toLowerCase()) {
      case 's':
        e.preventDefault();
        h.report();
        return;
      case 'y':
        e.preventDefault();
        h.absolutelyRight();
        return;
      case 'c':
        e.preventDefault();
        h.compact();
        return;
      default:
        return;
    }
  });
}
