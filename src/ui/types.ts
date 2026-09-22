/**
 * Public shape of the DOM chrome. The integrator wires against this file.
 *
 * Design rule: the UI calls the sim directly for every game mutation
 * (purchases, ship, draft picks, meta buys) and *additionally* reports the
 * action through `onAction` so the host can react — unlock audio on the first
 * gesture, persist the save, play a sound, etc. Handlers must not mutate state.
 */
import type {
  AgentTierId,
  CardId,
  DerivedStats,
  GameEvent,
  MetaState,
  MetaUpgradeId,
  RunState,
  Settings,
  SimApi,
  UpgradeId,
} from '../sim/types.ts';

/** Which full-screen layer is on top. The run layer is always mounted. */
export type UIScreen = 'title' | 'meta' | 'achievements' | 'run';

export type ToastTone = 'info' | 'good' | 'bad';

/** Buy-quantity toggle state. `'max'` is sent to the sim as `Infinity`. */
export type BuyQty = 1 | 10 | 'max';

export type UIAction =
  /** A run was started from the title screen. Fired after `sim.startRun()`. */
  | { readonly t: 'startRun' }
  /** Top-level screen changed. */
  | { readonly t: 'screen'; readonly screen: UIScreen }
  /** `count` is `Infinity` when the quantity toggle is on MAX. */
  | { readonly t: 'buyAgent'; readonly id: AgentTierId; readonly count: number; readonly ok: boolean }
  | { readonly t: 'buyUpgrade'; readonly id: UpgradeId; readonly ok: boolean }
  | { readonly t: 'ship'; readonly ok: boolean }
  | { readonly t: 'pickCard'; readonly id: CardId; readonly ok: boolean }
  | { readonly t: 'rerollDraft'; readonly ok: boolean }
  | { readonly t: 'buyMeta'; readonly id: MetaUpgradeId; readonly ok: boolean }
  /** Pointer went down on the scene. Host converts with `renderer.toScene()`. */
  | { readonly t: 'canvasPointer'; readonly clientX: number; readonly clientY: number }
  /** Space/Enter on the focused scene. Host should click the laptop centre. */
  | { readonly t: 'canvasKey' }
  /** A settings control moved. `sim.meta.settings` has already been mutated. */
  | { readonly t: 'settingsChange'; readonly settings: Settings }
  /** Reset-save confirmed. The UI cannot wipe storage; the host must. */
  | { readonly t: 'resetSave' }
  /** Integer pixel scale changed; the renderer may want to `resize()`. */
  | { readonly t: 'scale'; readonly px: number }
  /** Pointer entered an interactive control — good hook for a hover blip. */
  | { readonly t: 'uiHover' };

export interface UIOpts {
  /** Container. It is emptied on create and on `destroy()`. */
  readonly root: HTMLElement;
  readonly sim: SimApi;
  /** Side-effect hook. Optional; the UI is fully functional without it. */
  readonly onAction?: (a: UIAction) => void;
  /** Injectable clock (ms). Defaults to `performance.now`. Tests use this. */
  readonly now?: () => number;
  /** Screen to mount on. Defaults to `'title'`. */
  readonly screen?: UIScreen;
}

export interface UI {
  /** The canvas the renderer attaches to. The UI creates and owns the node. */
  readonly canvas: HTMLCanvasElement;
  /** The UI's own wrapper inside `opts.root`. */
  readonly el: HTMLElement;
  /** Current top-level screen. */
  readonly screen: UIScreen;
  /** Current integer pixel scale (the numeric value behind `--px`). */
  readonly scale: number;
  /** Called once per animation frame with fresh state. Must be cheap. */
  update(run: RunState, derived: DerivedStats, meta: MetaState): void;
  /** Feed a sim event: toasts, flashes, incident chatter. */
  handle(e: GameEvent): void;
  setScreen(s: UIScreen): void;
  /** Push a transient message into the toast stack. */
  toast(text: string, tone?: ToastTone): void;
  /** Recompute `--px` from the viewport. Safe to call any time. */
  resize(): void;
  destroy(): void;
}

/** Shared services handed to each panel. Internal. */
export interface UICtx {
  readonly sim: SimApi;
  emit(a: UIAction): void;
  toast(text: string, tone?: ToastTone): void;
  setScreen(s: UIScreen): void;
  now(): number;
}
