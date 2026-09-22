/**
 * FROZEN CONTRACT — `data-testid` values.
 *
 * UI must render exactly these ids. QA selects exclusively on them, never on
 * CSS classes or text content. Additive changes only.
 */
export const TID = {
  // shell
  app: 'app',
  scene: 'scene-canvas',
  laptop: 'laptop-hit',

  // HUD
  slop: 'hud-slop',
  slopRate: 'hud-slop-rate',
  clickPower: 'hud-click-power',
  /** Live incident-rate multiplier — the risk dial. */
  incidentRisk: 'hud-incident-risk',
  /** Crit chance / one-shot chance. Hidden while both are at their base. */
  critChance: 'hud-crit',
  projectName: 'hud-project-name',
  projectNum: 'hud-project-num',
  shipBar: 'hud-ship-bar',
  shipBarFill: 'hud-ship-bar-fill',
  requirement: 'hud-requirement',
  deadlineBar: 'hud-deadline-bar',
  deadlineFill: 'hud-deadline-fill',
  deadlineText: 'hud-deadline-text',
  demoTally: 'hud-demo-tally',
  shipButton: 'ship-button',
  incidentBanner: 'incident-banner',
  incidentName: 'incident-name',
  incidentTimer: 'incident-timer',
  activeCards: 'active-cards',

  // shop
  shop: 'shop',
  tabAgents: 'tab-agents',
  tabUpgrades: 'tab-upgrades',
  agentList: 'agent-list',
  upgradeList: 'upgrade-list',
  /** `${agentRow}-${tierId}` */
  agentRow: 'agent-row',
  /** `${agentCost}-${tierId}` */
  agentCost: 'agent-cost',
  /** `${agentOwned}-${tierId}` */
  agentOwned: 'agent-owned',
  /** `${upgradeRow}-${upgradeId}` */
  upgradeRow: 'upgrade-row',
  buyQtyToggle: 'buy-qty-toggle',
  /**
   * Opens/closes the shop drawer. Only present (unhidden) on a short viewport —
   * a landscape phone or a squat window — where the shop is a bottom sheet
   * instead of a block in the flow.
   */
  shopToggle: 'shop-toggle',
  /** The dimmed layer behind an open shop drawer. Tapping it closes the sheet. */
  shopScrim: 'shop-scrim',

  // draft
  draftModal: 'draft-modal',
  /** `${draftCard}-${cardId}` */
  draftCard: 'draft-card',
  draftReroll: 'draft-reroll',
  draftRerollCount: 'draft-reroll-count',
  /** Commits the highlighted card. Picking is deliberately two-step. */
  draftConfirm: 'draft-confirm',

  // run over / meta
  runOverModal: 'run-over-modal',
  runOverTitle: 'run-over-title',
  runOverDemos: 'run-over-demos',
  runOverContinue: 'run-over-continue',
  /** The 'Demos are permanent, spend them on the tree' line. */
  runOverCarry: 'run-over-carry',
  metaScreen: 'meta-screen',
  metaDemos: 'meta-demos',
  /** `${metaRow}-${metaId}` */
  metaRow: 'meta-row',
  /** `${metaBuy}-${metaId}` */
  metaBuy: 'meta-buy',
  /** Floating detail panel for the focused/hovered tree node. */
  metaTip: 'meta-tip',
  startRun: 'start-run',
  /** Achievements screen, off the title. */
  achievementsScreen: 'achievements-screen',
  achievementsButton: 'title-achievements',
  achievementsCount: 'achievements-count',
  /** `${achievementRow}-${id}` */
  achievementRow: 'achievement-row',
  /** Steam-style unlock popup, bottom-right. */
  achievementPopup: 'achievement-popup',
  /** `${achievementPopupCard}-${id}` */
  achievementPopupCard: 'achievement-popup-card',
  titleScreen: 'title-screen',

  // about / credits
  aboutButton: 'about-button',
  aboutModal: 'about-modal',
  aboutClose: 'about-close',
  kofiLink: 'kofi-link',
  /** Link to the source, on the title menu and in About. */
  repoLink: 'repo-link',

  // how to play
  helpButton: 'help-button',
  helpModal: 'help-modal',
  helpClose: 'help-close',
  helpControls: 'help-controls',
  /** The 'Between runs' explainer — the meta loop. */
  helpMeta: 'help-meta',
  /** First-run coach marks. `coachTip`/`coachDismiss` are scoped by tip id. */
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

/** Build a scoped testid, e.g. `tid(TID.agentRow, 'cli_agent')`. */
export function tid(base: string, suffix?: string): string {
  return suffix ? `${base}-${suffix}` : base;
}

/**
 * The hook the QA harness drives the game through. `src/main.ts` assigns this
 * to `window.__TOKENMAXXING__` so Playwright can inspect and steer a run
 * without pixel-hunting. Guarded by `import.meta.env.DEV` OR the
 * `?testhooks=1` query param so it is inert in a normal production load.
 */
export interface TestHooks {
  readonly version: 1;
  /** Live snapshot of sim state. Structured-cloneable. */
  snapshot(): unknown;
  /** Fast-forward the simulation by N milliseconds without waiting. */
  advance(ms: number): void;
  /** Grant slop directly (test-only). */
  grant(amount: number): void;
  /** Start a run with a fixed seed for reproducible tests. */
  startRun(seed: number): void;
  /** Force a specific incident to fire now. */
  forceIncident(id: string): void;
  /** Drop a specific pickup on screen at the given scene coords. */
  forcePickup(id: string, x?: number, y?: number): void;
  /** Force the next draft offer. */
  forceDraft(ids: string[]): void;
  /** Simulate N clicks on the laptop. */
  clickLaptop(n: number): void;
  /** Set the sim's time scale (1 = normal). */
  setTimeScale(k: number): void;
  /** Wipe persisted meta progression. */
  resetSave(): void;
  /** Everything the renderer drew last frame, for visual assertions. */
  renderStats(): { fps: number; particles: number; sprites: number; missingSprites: string[] };
}

declare global {
  interface Window {
    __TOKENMAXXING__?: TestHooks;
  }
}
