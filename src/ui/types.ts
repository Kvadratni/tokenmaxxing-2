/**
 * Public shape of the DOM chrome. The integrator wires against this file.
 *
 * ## The rule: the UI asks, the integrator does
 *
 * The UI never mutates the sim. It reads state (`update()` every frame, plus
 * the read-only `UISimView` for shop lists and Training costs) and reports
 * every player intent as a `UIAction` through `UIOpts.onAction`. The
 * integrator applies it. For the sim-bound actions that is one call:
 *
 *   createUI({ root, sim, agentRect: AGENT_RECT, onAction: (a) => {
 *     if (applySimAction(sim, a)) { sim.save(); return; }   // src/ui/actions.ts
 *     switch (a.t) { ...the host-side actions below... }
 *   }});
 *
 * Feedback comes back through the sim's own events (`ui.handle(e)`): a denied
 * purchase toasts on `denied`, a bought upgrade on `buyUpgrade`, and so on, so
 * the UI never needs a return value from an action.
 *
 * ## The actions
 *
 * Sim-bound (`applySimAction` maps each to exactly one sim call):
 *
 * | action            | sim call                         | fired by                              |
 * |-------------------|----------------------------------|---------------------------------------|
 * | `buyTool`         | `buyTool(id, count)`             | tool row, hotkeys 1-9 (count = ×1/×10/×100) |
 * | `buyUpgrade`      | `buyUpgrade(id)`                 | upgrade row                           |
 * | `report`          | `report()`                       | report button / S in REPORT DONE state |
 * | `claim`           | `claim()`                        | report button / S in CLAIM DONE state |
 * | `compact`         | `compact()`                      | /compact button / C                   |
 * | `absolutelyRight` | `absolutelyRight()`              | YOU'RE ABSOLUTELY RIGHT button / Y    |
 * | `keepCards`       | `keepCards(ids)`                 | summary picker confirm                |
 * | `pickCard`        | `pickCard(id)`                   | draft confirm                         |
 * | `reroll`          | `rerollDraft()`                  | draft reroll                          |
 * | `buyMeta`         | `buyMeta(id)`                    | Training node                         |
 * | `startRun`        | `startRun()`                     | NEW SESSION (title and Training)      |
 * | `settings`        | `setSettings(patch)`             | Options; then re-apply audio volumes  |
 *
 * `startRun` should be applied synchronously: the UI switches to the run screen
 * right after emitting it (it holds the run-over dialog back until the new run
 * is actually running, so a deferred dispatch is safe, just slower to paint).
 *
 * Host-side (the sim alone cannot do these):
 *
 * - `canvasPointer`: pointer down on the stage or on the agent. Convert with
 *   `renderer.toScene(clientX, clientY)`; a pickup under the point wins
 *   (`sim.collectPickup`), otherwise `renderer.hitsAgent` gates `sim.click`.
 * - `canvasKey`: Space (anywhere on the run screen) or Enter on the focused
 *   agent. Click the centre of `AGENT_RECT`.
 * - `resetSave`: confirmed in Options. `clearMeta()` then reload.
 * - `screen`: informational. The sim should only tick while `ui.screen === 'run'`.
 * - `scale`: the integer `--px` changed; `renderer.resize()`.
 * - `uiHover`: pointer entered a live control; a good hook for `audio.play('uiHover')`.
 */
import type {
  CardId,
  DerivedStats,
  GameEvent,
  MetaFeature,
  MetaState,
  MetaUpgradeId,
  RunState,
  Settings,
  ToolDef,
  ToolId,
  UpgradeDef,
  UpgradeId,
} from '../sim/types.ts';

/** Which full-screen layer is on top. The run layer is always mounted. */
export type UIScreen = 'title' | 'meta' | 'achievements' | 'run';

export type ToastTone = 'info' | 'good' | 'bad' | 'warn';

/** Buy-quantity toggle. Sent to the sim as-is; the sim caps it at the tool's headroom. */
export type BuyQty = 1 | 10 | 100;

export type UIAction =
  // ---- sim-bound: see the table above and `applySimAction` -----------------
  | { readonly t: 'buyTool'; readonly id: ToolId; readonly count: number }
  | { readonly t: 'buyUpgrade'; readonly id: UpgradeId }
  | { readonly t: 'report' }
  | { readonly t: 'claim' }
  | { readonly t: 'compact' }
  | { readonly t: 'absolutelyRight' }
  | { readonly t: 'keepCards'; readonly ids: readonly CardId[] }
  | { readonly t: 'pickCard'; readonly id: CardId }
  | { readonly t: 'reroll' }
  | { readonly t: 'buyMeta'; readonly id: MetaUpgradeId }
  | { readonly t: 'startRun' }
  | { readonly t: 'settings'; readonly patch: Partial<Settings> }
  // ---- stage input: the host converts coordinates, then calls the sim -----
  | { readonly t: 'canvasPointer'; readonly clientX: number; readonly clientY: number }
  | { readonly t: 'canvasKey' }
  // ---- host-only ------------------------------------------------------------
  | { readonly t: 'resetSave' }
  | { readonly t: 'screen'; readonly screen: UIScreen }
  | { readonly t: 'scale'; readonly px: number }
  | { readonly t: 'uiHover' };

/** Every `UIAction['t']`, for exhaustiveness checks and tests. */
export type UIActionType = UIAction['t'];

/** A rectangle in 320x180 scene space. */
export interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Structural twin of the sim's `UnlockedContent` (src/sim/effects.ts). */
export interface UIUnlocked {
  readonly tools: ReadonlySet<ToolId>;
  readonly upgrades: ReadonlySet<string>;
  readonly cards: ReadonlySet<string>;
  readonly features: ReadonlySet<MetaFeature>;
}

/**
 * The read-only slice of `Sim` (src/sim/index.ts) the UI looks at. The real
 * `Sim` satisfies it structurally; the unit tests hand in a double.
 */
export interface UISimView {
  readonly run: RunState;
  readonly meta: MetaState;
  /** Tools currently visible in the shop. */
  visibleTools(): readonly ToolDef[];
  /** Upgrades currently purchasable (requirements met, not owned). */
  availableUpgrades(): readonly UpgradeDef[];
  /** Tools past the frontier, shown as locked teasers. */
  lockedTools(): readonly ToolDef[];
  /** 👍 cost of the next level of a Training node; Infinity when maxed. */
  metaCost(id: MetaUpgradeId): number;
  unlocked(): UIUnlocked;
}

export interface UIOpts {
  /** Container. It is emptied on create and on `destroy()`. */
  readonly root: HTMLElement;
  readonly sim: UISimView;
  /** Every player intent. Without it the UI renders but nothing happens. */
  readonly onAction?: (a: UIAction) => void;
  /** Injectable clock (ms). Defaults to `performance.now`. Tests use this. */
  readonly now?: () => number;
  /** Screen to mount on. Defaults to `'title'`. */
  readonly screen?: UIScreen;
  /**
   * Scene-space hit box of the agent (`AGENT_RECT` from
   * src/render/atlas-types.ts). The `agent-hit` button is laid over it.
   */
  readonly agentRect?: SceneRect;
}

export interface UI {
  /** The canvas the renderer attaches to. The UI creates and owns the node. */
  readonly canvas: HTMLCanvasElement;
  /** The UI's own wrapper inside `opts.root`. */
  readonly el: HTMLElement;
  /** Current top-level screen. */
  readonly screen: UIScreen;
  /** Current pixel scale (the numeric value behind `--px`). */
  readonly scale: number;
  /** Called once per animation frame with fresh state. Must be cheap. */
  update(run: RunState, derived: DerivedStats, meta: MetaState): void;
  /** Feed a sim event: toasts, flashes, the legacy notice, achievements. */
  handle(e: GameEvent): void;
  setScreen(s: UIScreen): void;
  /** Push a transient message into the toast stack. */
  toast(text: string, tone?: ToastTone): void;
  /** Move the `agent-hit` overlay (scene coordinates). */
  setAgentRect(r: SceneRect): void;
  /** Recompute `--px` from the viewport. Safe to call any time. */
  resize(): void;
  destroy(): void;
}

/** Shared services handed to each panel. Internal. */
export interface UICtx {
  readonly sim: UISimView;
  emit(a: UIAction): void;
  toast(text: string, tone?: ToastTone): void;
  setScreen(s: UIScreen): void;
  now(): number;
}
