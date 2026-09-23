/**
 * The reference dispatcher: one sim call per sim-bound `UIAction`.
 *
 *   onAction: (a) => {
 *     if (applySimAction(sim, a)) return;   // bought, reported, claimed, ...
 *     // canvasPointer / canvasKey / resetSave / screen / scale / uiHover
 *   }
 *
 * It is the only code in src/ui that touches a sim mutator, and the UI itself
 * never calls it: the integrator does, from its `onAction`. Keeping the mapping
 * here means the table in types.ts and the code cannot drift apart.
 */
import type { CardId, MetaUpgradeId, Settings, ToolId, UpgradeId } from '../sim/types.ts';
import type { UIAction, UIActionType } from './types.ts';

/** The mutating half of `Sim` that the sim-bound actions reach. */
export interface SimActionTarget {
  buyTool(id: ToolId, count?: number): boolean;
  buyUpgrade(id: UpgradeId): boolean;
  report(): boolean;
  claim(): 'passed' | 'caught' | null;
  compact(): boolean;
  absolutelyRight(): boolean;
  keepCards(ids: readonly CardId[]): boolean;
  pickCard(id: CardId): boolean;
  rerollDraft(): boolean;
  buyMeta(id: MetaUpgradeId): boolean;
  startRun(seed?: number): void;
  setSettings(patch: Partial<Settings>): void;
}

/** Actions `applySimAction` handles. Everything else is the host's job. */
export const SIM_ACTIONS: ReadonlySet<UIActionType> = new Set<UIActionType>([
  'buyTool',
  'buyUpgrade',
  'report',
  'claim',
  'compact',
  'absolutelyRight',
  'keepCards',
  'pickCard',
  'reroll',
  'buyMeta',
  'startRun',
  'settings',
]);

/** Actions the host must implement itself. */
export const HOST_ACTIONS: ReadonlySet<UIActionType> = new Set<UIActionType>([
  'canvasPointer',
  'canvasKey',
  'resetSave',
  'screen',
  'scale',
  'uiHover',
]);

/**
 * Apply a sim-bound action. Returns `true` when the action belonged to the sim
 * (whether or not the sim accepted it: a refusal arrives as a `denied` event),
 * `false` when the host still has to handle it.
 */
export function applySimAction(sim: SimActionTarget, a: UIAction): boolean {
  switch (a.t) {
    case 'buyTool':
      sim.buyTool(a.id, a.count);
      return true;
    case 'buyUpgrade':
      sim.buyUpgrade(a.id);
      return true;
    case 'report':
      sim.report();
      return true;
    case 'claim':
      sim.claim();
      return true;
    case 'compact':
      sim.compact();
      return true;
    case 'absolutelyRight':
      sim.absolutelyRight();
      return true;
    case 'keepCards':
      sim.keepCards(a.ids);
      return true;
    case 'pickCard':
      sim.pickCard(a.id);
      return true;
    case 'reroll':
      sim.rerollDraft();
      return true;
    case 'buyMeta':
      sim.buyMeta(a.id);
      return true;
    case 'startRun':
      sim.startRun();
      return true;
    case 'settings':
      sim.setSettings(a.patch);
      return true;
    case 'canvasPointer':
    case 'canvasKey':
    case 'resetSave':
    case 'screen':
    case 'scale':
    case 'uiHover':
      return false;
  }
}
