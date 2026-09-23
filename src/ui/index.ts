/**
 * Tokenmaxxing 2 DOM chrome.
 *
 *   const ui = createUI({ root, sim, agentRect: AGENT_RECT, onAction });
 *   renderer = createRenderer(ui.canvas);
 *   // per frame:
 *   ui.update(sim.run, sim.derived(), sim.meta);
 *   // per sim event:
 *   sim.subscribe((e) => { ui.handle(e); audio.handle(e); renderer.handle(e); });
 *
 * The UI never mutates the sim. Every intent leaves through `onAction` (see
 * types.ts for the table, and `applySimAction` for the one-line dispatcher),
 * and every result comes back as state in `update()` or an event in
 * `handle()`. `update()` is dirty-tracked: a frame where nothing changed
 * writes nothing to the DOM.
 */
import '../styles/palette.css';
import '../styles/ui.css';
import '../styles/cli.css';
import '../styles/help.css';

import { CARD_BY_ID, INCIDENT_BY_ID, META_BY_ID, PICKUP_BY_ID, TOOL_BY_ID, UPGRADE_BY_ID } from '../sim/content.ts';
import type { DerivedStats, GameEvent, MetaState, RunState } from '../sim/types.ts';
import { TID } from '../testids.ts';
import { About } from './about.ts';
import { createAchievementPopup } from './achievement-popup.ts';
import { AchievementsScreen } from './achievements.ts';
import { createCliBackdrop } from './cli-backdrop.ts';
import { createCoach } from './coach.ts';
import { Attr, btn, el, focusables, Hide, on, setInert, trapTab } from './dom.ts';
import { Draft } from './draft.ts';
import { fmtPct, formatInt, formatTokens } from './format.ts';
import { createHelp } from './help.ts';
import { bindHotkeys, HOTKEY_HINTS } from './hotkeys.ts';
import { Hud, reportView } from './hud.ts';
import { installIconSheet } from './icon.ts';
import { LegacyNotice } from './legacy.ts';
import { MetaScreen } from './meta.ts';
import { Options } from './options.ts';
import { installPixelFont } from './pixel-font.ts';
import { RunOver } from './runover.ts';
import { createScale, type ShopMode } from './scale.ts';
import { Shop } from './shop.ts';
import { DEFAULT_AGENT_RECT, Stage } from './stage.ts';
import { CardStrip } from './strip.ts';
import { SummaryPicker } from './summary.ts';
import { TitleScreen } from './title.ts';
import { Toasts } from './toasts.ts';
import type { SceneRect, ToastTone, UI, UIAction, UICtx, UIOpts, UIScreen } from './types.ts';

export type {
  BuyQty,
  SceneRect,
  ToastTone,
  UI,
  UIAction,
  UIActionType,
  UICtx,
  UIOpts,
  UIScreen,
  UISimView,
  UIUnlocked,
} from './types.ts';
export { applySimAction, HOST_ACTIONS, SIM_ACTIONS } from './actions.ts';
export type { SimActionTarget } from './actions.ts';
export { HOTKEY_HINTS } from './hotkeys.ts';
export { computeScale, glyphPx } from './scale.ts';
export { requiredIconIds } from './icon-ids.ts';
export { DEFAULT_AGENT_RECT } from './stage.ts';

/** The toast for each `denied` reason. `cost` is tokens, `thumbs` the meta currency. */
export const DENIED_TEXT = {
  cost: 'Not enough tokens',
  thumbs: 'Not enough 👍',
  locked: 'Locked',
  phase: 'Not right now',
} as const;

export function createUI(opts: UIOpts): UI {
  const { root, sim } = opts;
  const now = opts.now ?? (() => performance.now());

  root.replaceChildren();
  // Only stamped when the host has not already labelled the container.
  const stampedApp = !root.hasAttribute('data-testid');
  if (stampedApp) root.setAttribute('data-testid', TID.app);
  const ui = el('div', { cls: 'tm-ui', parent: root });
  installIconSheet(ui);
  void installPixelFont(root.ownerDocument).then((ok) => {
    if (ok && !destroyed) ui.setAttribute('data-pixel-font', '');
  });

  let screen: UIScreen = opts.screen ?? 'title';
  ui.dataset['screen'] = screen;
  let destroyed = false;
  let lastRun: RunState = sim.run;
  let lastDerived: DerivedStats | null = null;
  const disposers: Array<() => void> = [];

  const emit = (a: UIAction): void => {
    if (destroyed) return;
    if (a.t === 'startRun') {
      // The old run's ending must not flash up while the new one boots.
      runOver.holdForNewRun();
      hud.reset();
      stage.reset();
    }
    opts.onAction?.(a);
  };

  const ctx: UICtx = {
    sim,
    emit,
    toast: (text: string, tone: ToastTone = 'info') => toasts.push(text, tone),
    setScreen: (s: UIScreen) => setScreen(s),
    now,
  };

  // ---- top bar -------------------------------------------------------------
  const topbar = el('header', { cls: 'tm-topbar', parent: ui });
  el('span', { cls: 'tm-brand', text: 'Tokenmaxxing 2', parent: topbar });
  const legend = el('div', { cls: 'tm-legend', parent: topbar, attrs: { 'aria-hidden': 'true' } });
  for (const hint of HOTKEY_HINTS) {
    const span = el('span', { parent: legend });
    el('kbd', { text: hint.keys, parent: span });
    el('span', { text: ` ${hint.what}`, parent: span });
  }
  el('span', { cls: 'tm-spacer', parent: topbar });
  // `?` is how-to-play, not credits: one glyph cannot mean two things.
  const helpBtn = btn({ cls: 'tm-btn tm-btn--quiet', tid: TID.helpButton, text: '?', parent: topbar, label: 'How to play' });
  const aboutBtn = btn({
    cls: 'tm-btn tm-btn--quiet',
    tid: 'topbar-about',
    text: 'About',
    parent: topbar,
    label: 'About this game and credits',
  });
  const shopBtn = btn({
    cls: 'tm-btn tm-shop-toggle',
    tid: TID.shopToggle,
    text: 'Shop',
    parent: topbar,
    label: 'Open the shop',
    attrs: { 'aria-expanded': 'false' },
  });
  const optionsBtn = btn({ cls: 'tm-btn', tid: TID.optionsButton, text: 'Options', parent: topbar, label: 'Open options' });

  // ---- the run layer ---------------------------------------------------------
  const main = el('div', { cls: 'tm-main', parent: ui });
  const toasts = new Toasts(ui, now);
  const hud = new Hud(main, ctx);
  const stage = new Stage(main, ctx, opts.agentRect ?? DEFAULT_AGENT_RECT);
  const shop = new Shop(main, ctx, (cost) => hud.setPreviewCost(cost));
  const strip = new CardStrip(main);

  /*
   * The shop drawer, short viewports only. Where height is scarce (a landscape
   * phone, a squat window) the rail cannot sit beside the stage and stacking it
   * spends height the screen has not got, so it becomes a bottom sheet. Where
   * there is height, the shop stays in the flow. scale.ts owns the decision.
   */
  const shopScrim = el('div', { cls: 'tm-scrim', tid: TID.shopScrim, parent: ui });
  const shopOpenAttr = new Attr(ui, 'data-shop-open');
  const shopBtnHide = new Hide(shopBtn);
  const shopBtnExpanded = new Attr(shopBtn, 'aria-expanded');
  const shopBtnLabel = new Attr(shopBtn, 'aria-label');
  let shopMode: ShopMode = 'inline';
  let drawerOpen = false;
  let drawerPrevFocus: HTMLElement | null = null;

  /**
   * Everything the open sheet covers goes `inert`: the tab ring must not walk
   * into content behind the scrim and a stray tap must not buy through it. A
   * *closed* sheet is inert too: it is parked off the bottom of the screen.
   * The topbar sits above the scrim and stays live, so "Shop" can close it.
   */
  function syncDrawerInert(): void {
    const drawer = shopMode === 'drawer';
    setInert(shop.el, drawer && !drawerOpen);
    for (const node of Array.from(main.children)) {
      if (node === shop.el || !(node instanceof HTMLElement)) continue;
      setInert(node, drawer && drawerOpen);
    }
  }

  function focusIntoDrawer(): void {
    const target = focusables(shop.el)[0] ?? shop.el;
    if (target === shop.el && !shop.el.hasAttribute('tabindex')) shop.el.setAttribute('tabindex', '-1');
    target.focus();
  }

  /** Open or close the sheet. A no-op where the shop is in the flow. */
  function setDrawer(open: boolean): void {
    if (open && shopMode !== 'drawer') return;
    if (open === drawerOpen) return;
    // Captured *before* anything goes inert: an inert ancestor blurs its focus.
    if (open) {
      const active = document.activeElement;
      drawerPrevFocus = active instanceof HTMLElement ? active : null;
    }
    drawerOpen = open;
    shopOpenAttr.set(open ? '' : null);
    shopBtnExpanded.set(String(open));
    shopBtnLabel.set(open ? 'Close the shop' : 'Open the shop');
    syncDrawerInert();
    if (open) {
      focusIntoDrawer();
      return;
    }
    const back = !shopBtn.hidden && shopBtn.isConnected ? shopBtn : drawerPrevFocus;
    drawerPrevFocus = null;
    if (back !== null && back.isConnected) back.focus();
  }

  function setShopMode(mode: ShopMode): void {
    shopMode = mode;
    // `hidden`, not just `display: none`: a display:none button that still
    // counts as focusable is exactly how the desktop tab ring broke in game 1.
    shopBtnHide.set(mode !== 'drawer');
    if (mode !== 'drawer') setDrawer(false);
    syncDrawerInert();
  }

  // ---- overlays --------------------------------------------------------------
  const draft = new Draft(ui, ctx);
  const summary = new SummaryPicker(ui, ctx);
  const runOver = new RunOver(ui, ctx);
  const options = new Options(ui, ctx);
  const about = new About(ui, ctx);
  const legacy = new LegacyNotice(ui);
  const title = new TitleScreen(ui, ctx);
  const metaScreen = new MetaScreen(ui, ctx);
  const achievements = new AchievementsScreen(ui, ctx);
  const help = createHelp(ui, { onDismiss: () => help.close() });

  let reduced = false;
  let firstRun = true;
  const achievementPopup = createAchievementPopup(ui, { reducedMotion: () => reduced });

  // ---- the ambient CLI behind the title --------------------------------------
  // Mounted inside the title screen so it cannot outlive or bleed past it.
  const cli = createCliBackdrop({ reducedMotion: () => reduced });
  title.el.classList.add('tm-cli-host');
  title.el.prepend(cli.el);
  let cliReducedAt = reduced;

  function syncCli(): void {
    if (destroyed) return;
    if (screen !== 'title' || document.hidden) {
      cli.stop();
      return;
    }
    // `start()` samples reducedMotion once; a toggle needs a restart.
    if (cliReducedAt !== reduced) {
      cli.stop();
      cliReducedAt = reduced;
    }
    cli.start();
  }

  const dialogOpen = (): boolean =>
    options.isOpen ||
    about.isOpen ||
    help.isOpen ||
    legacy.isOpen ||
    draft.isOpen ||
    summary.isOpen ||
    runOver.isOpen;

  const coach = createCoach(ui, { enabled: () => firstRun && screen === 'run' && !dialogOpen() });

  const reducedAttr = new Attr(ui, 'data-reduced-motion');
  const fpsAttr = new Attr(ui, 'data-show-fps');

  // ---- scale -----------------------------------------------------------------
  // The same callback decides the drawer: both fall out of the viewport, and one
  // place reacts to a resize or a rotation.
  const scaleCtl = createScale(ui, (s) => {
    setShopMode(s.shop);
    emit({ t: 'scale', px: s.px });
  });

  // ---- Training unlocks the run layer depends on ----------------------------
  function refreshUnlocked(): void {
    let u = null;
    try {
      u = sim.unlocked();
    } catch {
      u = null;
    }
    hud.setCompactUnlocked(u?.features.has('compact') ?? false);
  }
  refreshUnlocked();

  // ---- screens ---------------------------------------------------------------
  function setScreen(s: UIScreen): void {
    if (destroyed || s === screen) return;
    const prev = screen;
    screen = s;
    ui.dataset['screen'] = s;
    if (prev === 'run') {
      // The run layer stops updating, so its dialogs must stand down.
      draft.close();
      summary.close();
      runOver.close();
      coach.dismissAll();
      setDrawer(false);
    }
    options.close();
    about.close();
    help.close();
    title.setVisible(s === 'title');
    metaScreen.setVisible(s === 'meta');
    achievements.setVisible(s === 'achievements');
    setInert(main, s !== 'run');
    syncCli();
    if (s === 'run') {
      refreshUnlocked();
      stage.agentBtn.focus();
    } else if (s === 'title') {
      title.primary.focus();
    } else if (s === 'achievements') {
      achievements.primary.focus();
    } else {
      metaScreen.primary.focus();
    }
    emit({ t: 'screen', screen: s });
  }

  title.setVisible(screen === 'title');
  metaScreen.setVisible(screen === 'meta');
  achievements.setVisible(screen === 'achievements');
  setInert(main, screen !== 'run');
  syncCli();

  // ---- input -----------------------------------------------------------------
  disposers.push(
    on(shopBtn, 'click', () => setDrawer(!drawerOpen)),
    // Tapping the dimmed board behind the drawer closes it.
    on(shopScrim, 'click', () => setDrawer(false)),
    // The same trap the dialogs use, so the sheet cannot drift apart from them.
    on(shop.el, 'keydown', (ev) => {
      if (drawerOpen) trapTab(shop.el, ev as KeyboardEvent);
    }),
    on(optionsBtn, 'click', () => options.toggle()),
    on(aboutBtn, 'click', () => about.toggle()),
    on(title.aboutBtn, 'click', () => about.toggle()),
    on(title.achievementsBtn, 'click', () => setScreen('achievements')),
    on(helpBtn, 'click', () => help.toggle()),
    // A backgrounded tab must not keep repainting the log.
    on(document, 'visibilitychange', () => syncCli()),
  );

  const running = (): boolean => lastRun.phase === 'running';

  disposers.push(
    bindHotkeys(window, {
      isBlocked: () => screen !== 'run' || dialogOpen(),
      spaceIsLocal: () => drawerOpen,
      generate: () => {
        if (running()) emit({ t: 'canvasKey' });
      },
      buyTool: (i) => shop.buyVisibleIndex(i),
      report: () => {
        if (hud.reportAction !== null) {
          hud.pressReport();
          return;
        }
        const d = lastDerived;
        if (d === null || !running()) return;
        const view = reportView(d, lastRun.phase);
        if (view.state === 'blocked') ctx.toast(`Blocked: ${view.sub}`, 'bad');
        else ctx.toast(`Still working: claim unlocks at ${fmtPct(d.claimThreshold)}`, 'info');
      },
      absolutelyRight: () => {
        if (running()) emit({ t: 'absolutelyRight' });
      },
      compact: () => {
        const d = lastDerived;
        if (d !== null && d.canCompact && running() && lastRun.compactingMs <= 0) emit({ t: 'compact' });
      },
      escape: () => {
        // Topmost first: dialogs float above the sheet.
        if (help.isOpen) return help.close();
        if (about.isOpen) return about.close();
        if (options.isOpen) return options.close();
        if (legacy.isOpen) return legacy.close();
        if (drawerOpen) return setDrawer(false);
        if (draft.isOpen || summary.isOpen || runOver.isOpen) return;
        if (screen === 'meta' || screen === 'achievements') setScreen('title');
      },
    }),
  );

  // ---- frame -----------------------------------------------------------------
  function update(run: RunState, derived: DerivedStats, meta: MetaState): void {
    if (destroyed) return;
    lastRun = run;
    lastDerived = derived;
    const s = meta.settings;
    reducedAttr.set(s.reducedMotion ? '1' : null);
    fpsAttr.set(s.showFps ? '1' : null);
    // Coach marks are a first-session thing; `runs` ticks over when it ends.
    firstRun = meta.runs === 0;
    if (s.reducedMotion !== reduced) {
      reduced = s.reducedMotion;
      syncCli();
    }
    options.update(s);

    if (screen === 'run') {
      hud.update(run, derived, meta);
      stage.update(run);
      shop.update(run, derived);
      strip.update(run, derived);
      // Nothing is buyable once the run stops running, and an open sheet would
      // hold the board inert under a mandatory dialog. Closed *before* the
      // dialogs open, so the restored focus does not fight theirs.
      if (drawerOpen && run.phase !== 'running') setDrawer(false);
      summary.update(run);
      draft.update(run);
      runOver.update(run, derived, meta);
      coach.update(run, derived);
    } else {
      title.update(meta);
      metaScreen.update(meta);
      achievements.update(meta);
    }
  }

  // ---- events ----------------------------------------------------------------
  const nameOfCard = (id: string): string => CARD_BY_ID[id]?.name ?? id;

  function handle(e: GameEvent): void {
    if (destroyed) return;
    switch (e.t) {
      case 'denied':
        toasts.push(DENIED_TEXT[e.reason] ?? 'Not right now', 'bad');
        break;
      case 'buyUpgrade':
        toasts.push(`Installed ${UPGRADE_BY_ID[e.id]?.name ?? e.id}`, 'good');
        break;
      case 'report':
        toasts.push(`Reported done · +${formatInt(e.thumbs)} 👍`, 'good');
        break;
      case 'claim':
        if (e.caught) toasts.push('The human ran the tests. Caught.', 'bad');
        else toasts.push('Claimed done. The human believed you. +1 tech debt', 'warn');
        break;
      case 'compactStart':
        stage.noteCompaction();
        toasts.push(
          e.forced
            ? `Context full: compacted. Kept ${formatTokens(e.kept)} tokens.`
            : `/compact: kept ${formatTokens(e.kept)} tokens`,
          e.forced ? 'bad' : 'info',
        );
        break;
      case 'compactEnd':
        if (e.droppedCards.length > 0) {
          toasts.push(`Forgot ${e.droppedCards.map(nameOfCard).join(', ')}`, 'info');
        }
        break;
      case 'draftPick':
        toasts.push(`The human typed ${nameOfCard(e.id)}`, 'good');
        break;
      case 'draftReroll':
        toasts.push('The human rephrased it', 'info');
        break;
      case 'incidentEnd': {
        const def = INCIDENT_BY_ID[e.id];
        if (def && def.tone === 'bad') toasts.push(`${def.name}: over`, 'good');
        break;
      }
      case 'pickupCollect': {
        const def = PICKUP_BY_ID[e.id];
        if (def) toasts.push(`${def.label}: ${def.blurb}`, 'good');
        break;
      }
      case 'patienceWarn':
        toasts.push(`${Math.max(1, Math.round(e.secondsLeft))}s of patience left`, 'bad');
        break;
      case 'contextWarn':
        toasts.push(
          e.fill >= 0.95 ? 'Context 95%: compaction imminent' : `Context ${Math.round(e.fill * 100)}%`,
          e.fill >= 0.95 ? 'bad' : 'warn',
        );
        break;
      case 'oneShot':
        toasts.push(`One-shot it: +${formatTokens(e.amount)}`, 'good');
        break;
      case 'achievement':
        achievementPopup.show(e.id);
        break;
      case 'metaBuy':
        toasts.push(`Trained ${META_BY_ID[e.id]?.name ?? e.id}`, 'good');
        refreshUnlocked();
        break;
      case 'runStart':
        hud.reset();
        stage.reset();
        refreshUnlocked();
        break;
      case 'legacyImport':
        // `cheater` covers a clean-signed save that still carries game 1's
        // cheating achievements, not just an edited or forged one.
        legacy.show(e.verdict, e.gift, e.cheater);
        break;
      case 'toolLost':
        toasts.push(`rm -rf took a ${TOOL_BY_ID[e.id]?.name ?? e.id} with it`, 'bad');
        break;
      case 'runOver':
        runOver.noteBanked(e.thumbs);
        break;
      default:
        break;
    }
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    for (const d of disposers) d();
    disposers.length = 0;
    scaleCtl.destroy();
    cli.destroy();
    coach.destroy();
    help.destroy();
    legacy.destroy();
    options.destroy();
    about.destroy();
    runOver.destroy();
    summary.destroy();
    draft.destroy();
    achievementPopup.destroy();
    achievements.destroy();
    metaScreen.destroy();
    title.destroy();
    strip.destroy();
    shop.destroy();
    stage.destroy();
    hud.destroy();
    toasts.destroy();
    ui.remove();
    root.replaceChildren();
    if (stampedApp) root.removeAttribute('data-testid');
  }

  return {
    canvas: stage.canvas,
    el: ui,
    get screen() {
      return screen;
    },
    get scale() {
      return scaleCtl.px;
    },
    update,
    handle,
    setScreen,
    toast: (text: string, tone?: ToastTone) => toasts.push(text, tone ?? 'info'),
    setAgentRect: (r: SceneRect) => stage.setAgentRect(r),
    resize: () => scaleCtl.apply(),
    destroy,
  };
}
