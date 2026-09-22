/**
 * FROZEN CONTRACT: `data-testid` values.
 *
 * UI must render exactly these ids. QA selects exclusively on them, never on
 * CSS classes or text content. Additive changes only.
 */
export const TID = {
  // shell
  app: 'app',
  scene: 'scene-canvas',
  /** Invisible hit target over the agent: the thing you click to generate. */
  agent: 'agent-hit',

  // HUD
  tokens: 'hud-tokens',
  tokenRate: 'hud-token-rate',
  clickPower: 'hud-click-power',
  /** Live incident-rate multiplier. Tech debt pushes it up. */
  incidentRisk: 'hud-incident-risk',
  /** Crit / one-shot chance. Hidden while both are at their base. */
  critChance: 'hud-crit',
  promptText: 'hud-prompt-text',
  promptNum: 'hud-prompt-num',
  reportBar: 'hud-report-bar',
  reportBarFill: 'hud-report-bar-fill',
  requirement: 'hud-requirement',
  patienceBar: 'hud-patience-bar',
  patienceFill: 'hud-patience-fill',
  patienceText: 'hud-patience-text',
  contextBar: 'hud-context-bar',
  contextFill: 'hud-context-fill',
  contextText: 'hud-context-text',
  /** The manual /compact button. Hidden until the Training unlock. */
  compactButton: 'compact-button',
  /** "You're absolutely right!" */
  sycophancyButton: 'sycophancy-button',
  thumbsTally: 'hud-thumbs-tally',
  /** One button, three states: REPORT DONE / CLAIM DONE / WORKING. */
  reportButton: 'report-button',
  /** Live verify chance, shown while the button reads CLAIM DONE. */
  verifyChance: 'hud-verify-chance',
  techDebt: 'hud-tech-debt',
  modelVersion: 'hud-model-version',
  incidentBanner: 'incident-banner',
  incidentName: 'incident-name',
  incidentTimer: 'incident-timer',
  activeCards: 'active-cards',

  // shop
  shop: 'shop',
  tabTools: 'tab-tools',
  tabUpgrades: 'tab-upgrades',
  toolList: 'tool-list',
  upgradeList: 'upgrade-list',
  /** `${toolRow}-${toolId}` */
  toolRow: 'tool-row',
  /** `${toolCost}-${toolId}` */
  toolCost: 'tool-cost',
  /** `${toolOwned}-${toolId}` */
  toolOwned: 'tool-owned',
  /** `${toolFootprint}-${toolId}`: context per second this tool adds. */
  toolFootprint: 'tool-footprint',
  /** `${upgradeRow}-${upgradeId}` */
  upgradeRow: 'upgrade-row',
  buyQtyToggle: 'buy-qty-toggle',
  /** Opens/closes the shop drawer on a short viewport. */
  shopToggle: 'shop-toggle',
  shopScrim: 'shop-scrim',

  // draft ("The human is prompt engineering")
  draftModal: 'draft-modal',
  /** `${draftCard}-${cardId}` */
  draftCard: 'draft-card',
  draftReroll: 'draft-reroll',
  draftRerollCount: 'draft-reroll-count',
  /** Commits the highlighted card. Picking is deliberately two-step. */
  draftConfirm: 'draft-confirm',

  // compaction summary picker
  summaryModal: 'summary-modal',
  /** `${summaryCard}-${cardId}`: toggles whether the card is kept. */
  summaryCard: 'summary-card',
  summarySlots: 'summary-slots',
  summaryConfirm: 'summary-confirm',

  // run over / Training
  runOverModal: 'run-over-modal',
  runOverTitle: 'run-over-title',
  runOverThumbs: 'run-over-thumbs',
  /** "Releasing Tokenmaxxing 2.5 (new)". */
  runOverVersion: 'run-over-version',
  runOverContinue: 'run-over-continue',
  /** The '👍 are permanent, spend them in Training' line. */
  runOverCarry: 'run-over-carry',
  metaScreen: 'meta-screen',
  metaThumbs: 'meta-thumbs',
  /** `${metaRow}-${metaId}` */
  metaRow: 'meta-row',
  /** `${metaBuy}-${metaId}` */
  metaBuy: 'meta-buy',
  metaTip: 'meta-tip',
  startRun: 'start-run',
  achievementsScreen: 'achievements-screen',
  achievementsButton: 'title-achievements',
  achievementsCount: 'achievements-count',
  /** `${achievementRow}-${id}` */
  achievementRow: 'achievement-row',
  achievementPopup: 'achievement-popup',
  /** `${achievementPopupCard}-${id}` */
  achievementPopupCard: 'achievement-popup-card',
  titleScreen: 'title-screen',
  /** One-time notice that a Tokenmaxxing 1 save was found. */
  legacyNotice: 'legacy-notice',

  // about / credits
  aboutButton: 'about-button',
  aboutModal: 'about-modal',
  aboutClose: 'about-close',
  kofiLink: 'kofi-link',
  repoLink: 'repo-link',
  /** Link back to the first game. */
  prequelLink: 'prequel-link',

  // how to play
  helpButton: 'help-button',
  helpModal: 'help-modal',
  helpClose: 'help-close',
  helpControls: 'help-controls',
  /** The 'Between sessions' explainer: the Training loop. */
  helpMeta: 'help-meta',
  coach: 'coach',
  coachTip: 'coach-tip',
  coachDismiss: 'coach-dismiss',
  /** Ambient fake agent session behind the title screen. */
  cliBackdrop: 'cli-backdrop',

  // options / debug
  optionsButton: 'options-button',
  optionsPanel: 'options-panel',
  muteToggle: 'mute-toggle',
  reducedMotion: 'reduced-motion',
  resetSave: 'reset-save',
  toast: 'toast',
} as const;

/** Build a scoped testid, e.g. `tid(TID.toolRow, 'grep')`. */
export function tid(base: string, suffix?: string): string {
  return suffix ? `${base}-${suffix}` : base;
}

/**
 * The hook the QA harness drives the game through. `src/main.ts` assigns this
 * to `window.__TOKENMAXXING2__` so Playwright can inspect and steer a run
 * without pixel-hunting. Guarded by `import.meta.env.DEV` OR the
 * `?testhooks=1` query param so it is inert in a normal production load.
 */
export interface TestHooks {
  readonly version: 2;
  /** Live snapshot of sim state. Structured-cloneable. */
  snapshot(): unknown;
  /** Fast-forward the simulation by N milliseconds without waiting. */
  advance(ms: number): void;
  /** Grant tokens directly. */
  grant(amount: number): void;
  /** Grant unspent 👍 directly. */
  grantThumbs(n: number): void;
  /** Start a run with a fixed seed for reproducible tests. */
  startRun(seed: number): void;
  forceIncident(id: string): void;
  forcePickup(id: string, x?: number, y?: number): void;
  forceDraft(ids: string[]): void;
  /** Simulate N clicks on the agent. */
  clickAgent(n: number): void;
  /** Set context to this fraction of the window (0..1). 1 forces a compaction. */
  setContext(fill: number): void;
  /** Set patience to this fraction of the prompt's max (0..1). */
  setPatience(fill: number): void;
  /** Force the outcome of the next claim's verify roll; null restores the dice. */
  forceVerify(outcome: 'pass' | 'catch' | null): void;
  /**
   * Pretend a Tokenmaxxing 1 save (raw JSON text) was found, then run the
   * one-time import. Cross-origin dev servers can't see the real one.
   */
  importLegacy(raw: string): void;
  setTimeScale(k: number): void;
  resetSave(): void;
  renderStats(): { fps: number; particles: number; sprites: number; missingSprites: string[] };
}

declare global {
  interface Window {
    __TOKENMAXXING2__?: TestHooks;
  }
}
