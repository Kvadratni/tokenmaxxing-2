/**
 * Tokenmaxxing DOM chrome.
 *
 *   const ui = createUI({ root: document.getElementById('app')!, sim, onAction });
 *   renderer = createRenderer(ui.canvas);
 *   // per frame:
 *   ui.update(sim.run, sim.derived(), sim.meta);
 *   // per sim event:
 *   sim.subscribe((e) => { ui.handle(e); audio.handle(e); renderer.handle(e); });
 *
 * The UI calls the sim directly for purchases / ship / draft picks / meta buys
 * and mirrors every action through `onAction` so the host can unlock audio,
 * persist the save and play sounds. `update()` is dirty-tracked: a frame where
 * nothing changed writes nothing to the DOM.
 */
import '../styles/palette.css';
import '../styles/ui.css';
import '../styles/cli.css';
import '../styles/help.css';

import type { DerivedStats, GameEvent, MetaState, RunState } from '../sim/types.ts';
import { INCIDENT_BY_ID, CARD_BY_ID, PICKUP_BY_ID } from '../sim/content.ts';
import { TID } from '../testids.ts';
import { createCliBackdrop } from './cli-backdrop.ts';
import { createCoach } from './coach.ts';
import { createHelp } from './help.ts';
import { Attr, btn, el, focusables, Hide, on, setInert, trapTab } from './dom.ts';
import { Draft } from './draft.ts';
import { fmtInt } from './format.ts';
import { bindHotkeys, HOTKEY_HINTS } from './hotkeys.ts';
import { installIconSheet } from './icon.ts';
import { Hud } from './hud.ts';
import { MetaScreen } from './meta.ts';
import { AchievementsScreen } from './achievements.ts';
import { createAchievementPopup } from './achievement-popup.ts';
import { About } from './about.ts';
import { Options } from './options.ts';
import { RunOver } from './runover.ts';
import { createScale, type ShopMode } from './scale.ts';
import { Shop } from './shop.ts';
import { TitleScreen } from './title.ts';
import { Toasts } from './toasts.ts';
import type { ToastTone, UI, UIAction, UICtx, UIOpts, UIScreen } from './types.ts';

export type { UI, UIOpts, UIScreen, UIAction, UICtx, ToastTone, BuyQty } from './types.ts';
export { HOTKEY_HINTS } from './hotkeys.ts';
export { computeScale } from './scale.ts';
export { bulkCost, maxAffordable, qtyCount, qtyLabel } from './shop.ts';
export { fmtNum, fmtInt, fmtTime, fmtShortTime, fmtPct } from './format.ts';

export function createUI(opts: UIOpts): UI {
  const { root, sim } = opts;
  const now = opts.now ?? (() => performance.now());
  const emit = (a: UIAction): void => opts.onAction?.(a);

  root.replaceChildren();
  // Only stamped when the host has not already labelled the container.
  const stampedApp = !root.hasAttribute('data-testid');
  if (stampedApp) root.setAttribute('data-testid', TID.app);
  const ui = el('div', { cls: 'tm-ui', parent: root });
  // One url() shared by every icon on the page.
  installIconSheet(ui);

  let screen: UIScreen = opts.screen ?? 'title';
  let destroyed = false;

  const disposers: Array<() => void> = [];

  const ctx: UICtx = {
    sim,
    emit,
    toast: (text: string, tone: ToastTone = 'info') => toasts.push(text, tone),
    setScreen: (s: UIScreen) => setScreen(s),
    now,
  };

  // ---- top bar -------------------------------------------------------------
  const topbar = el('header', { cls: 'tm-topbar', parent: ui });
  el('span', { cls: 'tm-brand', text: 'Tokenmaxxing', parent: topbar });

  const legend = el('div', { cls: 'tm-legend', parent: topbar, attrs: { 'aria-hidden': 'true' } });
  for (const hint of HOTKEY_HINTS) {
    const span = el('span', { parent: legend });
    el('kbd', { text: hint.keys, parent: span });
    el('span', { text: ` ${hint.what}`, parent: span });
  }

  el('span', { cls: 'tm-topbar__spacer', parent: topbar });
  // `?` is how-to-play, not credits. Credits get their own worded button —
  // one glyph cannot mean two things, and a new player pressing `?` wants the
  // rules, not a Ko-fi link.
  const helpBtn = btn({
    cls: 'tm-btn tm-btn--quiet',
    tid: TID.helpButton,
    text: '?',
    parent: topbar,
    label: 'How to play',
  });
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
  const optionsBtn = btn({
    cls: 'tm-btn',
    tid: TID.optionsButton,
    text: 'Options',
    parent: topbar,
    label: 'Open options',
  });

  // ---- main layout ---------------------------------------------------------
  const main = el('div', { cls: 'tm-main', parent: ui });
  const toasts = new Toasts(ui, now);
  const hud = new Hud(main, ctx);
  const shop = new Shop(main, ctx, (cost) => hud.setPreviewCost(cost));

  /*
   * Shop drawer, short viewports only.
   *
   * Where vertical space is scarce — a landscape phone, any squat window — the
   * shop in the flow squeezed the rail to one character per line, and stacking it
   * below the stage spends 420 units of height the screen has not got. So there
   * it becomes a bottom sheet and the board gets the screen back; you cannot tap
   * the laptop through an open shop anyway. Where there *is* height (every
   * portrait phone, every tablet, every desktop) the shop stays in the flow where
   * you can see it without a tap. `src/ui/scale.ts` owns that decision.
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
   * into content behind the scrim and a stray tap must not buy through it.
   *
   * Only `.tm-main`'s non-shop children, deliberately. The topbar sits *above*
   * the scrim (z-index 30 against 24) so it is neither dimmed nor covered, and
   * leaving it live is what lets "Shop" close what it opened.
   *
   * A *closed* sheet is inert too. It is parked at `translateY(100%)`, off the
   * bottom of the screen, and an invisible shop must not be in the tab ring.
   */
  function syncDrawerInert(): void {
    const drawer = shopMode === 'drawer';
    setInert(shop.el, drawer && !drawerOpen);
    for (const node of Array.from(main.children)) {
      if (node === shop.el || !(node instanceof HTMLElement)) continue;
      setInert(node, drawer && drawerOpen);
    }
  }

  /** Mirrors `Modal.focusFirst`: the panel itself is the fallback. */
  function focusIntoDrawer(): void {
    const target = focusables(shop.el)[0] ?? shop.el;
    if (target === shop.el && !shop.el.hasAttribute('tabindex')) {
      shop.el.setAttribute('tabindex', '-1');
    }
    target.focus();
  }

  /**
   * Open or close the sheet. A no-op on a tall viewport: there the shop is in the
   * flow and there is nothing to open, so the toggle, the scrim and Escape all
   * leave it alone.
   */
  function setDrawer(open: boolean): void {
    if (open && shopMode !== 'drawer') return;
    if (open === drawerOpen) return;
    // Captured *before* anything goes inert: making an ancestor inert blurs
    // whatever was focused inside it, so reading activeElement afterwards only
    // ever finds <body>.
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
    // Back to the toggle: it is what opened the sheet, and after a tap
    // `activeElement` is not reliably the button on every engine.
    const back = !shopBtn.hidden && shopBtn.isConnected ? shopBtn : drawerPrevFocus;
    drawerPrevFocus = null;
    if (back !== null && back.isConnected) back.focus();
  }

  function setShopMode(mode: ShopMode): void {
    shopMode = mode;
    // `hidden`, not just `display: none`. `focusables()` and the e2e tab-ring
    // test both key off the attribute, and a display:none button that still
    // counts as focusable is exactly how the desktop tab ring broke.
    shopBtnHide.set(mode !== 'drawer');
    if (mode !== 'drawer') setDrawer(false);
    syncDrawerInert();
  }

  // ---- overlays ------------------------------------------------------------
  const draft = new Draft(ui, ctx);
  const runOver = new RunOver(ui, ctx);
  const options = new Options(ui, ctx);
  const about = new About(ui, ctx);
  const title = new TitleScreen(ui, ctx);
  const metaScreen = new MetaScreen(ui, ctx);
  const achievements = new AchievementsScreen(ui, ctx);
  const help = createHelp(ui, { onDismiss: () => help.close() });

  // Latched from settings each frame so the backdrop and the coach can read
  // the player's motion preference without reaching into the sim.
  let reduced = false;
  let firstRun = true;

  // Earning one is a moment, so it gets its own corner card rather than a line
  // in the toast strip next to "Not enough slop".
  const achievementPopup = createAchievementPopup(ui, { reducedMotion: () => reduced });

  // ---- ambient CLI behind the title ----------------------------------------
  // Mounted *inside* the title screen, so it cannot outlive or bleed past it.
  // `.tm-cli-host` gives the screen the stacking context the backdrop's
  // `z-index: -1` needs to sit above the background and below the buttons.
  const cli = createCliBackdrop({ reducedMotion: () => reduced });
  title.el.classList.add('tm-cli-host');
  title.el.prepend(cli.el);
  let cliReducedAt = reduced;

  function syncCli(): void {
    if (destroyed) return;
    const wanted = screen === 'title' && !document.hidden;
    if (!wanted) {
      cli.stop();
      return;
    }
    // `start()` samples reducedMotion once, so a mid-session toggle needs a
    // restart to switch between the animated log and the static frame.
    if (cliReducedAt !== reduced) {
      cli.stop();
      cliReducedAt = reduced;
    }
    cli.start();
  }

  // ---- first-run coach marks -----------------------------------------------
  const coach = createCoach(ui, {
    enabled: () =>
      firstRun &&
      screen === 'run' &&
      !(options.isOpen || about.isOpen || help.isOpen || draft.isOpen || runOver.isOpen),
  });

  const reducedAttr = new Attr(ui, 'data-reduced-motion');
  const fpsAttr = new Attr(ui, 'data-show-fps');

  // ---- scale ---------------------------------------------------------------
  // Same callback decides whether the shop is a drawer: both fall out of the
  // viewport, and doing it here means there is exactly one place that reacts to
  // a resize or a rotation.
  const scaleCtl = createScale(ui, (s) => {
    setShopMode(s.shop);
    emit({ t: 'scale', px: s.px });
  });

  // ---- screen plumbing -----------------------------------------------------
  function setScreen(s: UIScreen): void {
    if (destroyed || s === screen) return;
    const prev = screen;
    screen = s;
    if (prev === 'run') {
      // The run layer stops updating, so its dialogs must be told to stand down.
      draft.close();
      runOver.close();
      options.close();
      about.close();
      help.close();
      coach.dismissAll();
      setDrawer(false);
    }
    title.setVisible(s === 'title');
    metaScreen.setVisible(s === 'meta');
    achievements.setVisible(s === 'achievements');
    syncCli();
    if (s === 'run') {
      hud.reset();
      hud.hitArea.focus();
    } else if (s === 'title') {
      title.primary?.focus();
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
  syncCli();

  // ---- input ---------------------------------------------------------------
  disposers.push(on(shopBtn, 'click', () => setDrawer(!drawerOpen)));
  // Tapping the dimmed stage behind the drawer closes it, the usual bottom-sheet
  // gesture.
  disposers.push(on(shopScrim, 'click', () => setDrawer(false)));
  // Focus trap. The same `trapTab` the modals use, so the sheet cannot drift
  // apart from them. Escape is handled by the hotkey binding below, which is
  // where every other dismissal already lives.
  disposers.push(
    on(shop.el, 'keydown', (ev) => {
      if (drawerOpen) trapTab(shop.el, ev as KeyboardEvent);
    }),
  );
  disposers.push(on(optionsBtn, 'click', () => options.toggle()));
  disposers.push(on(aboutBtn, 'click', () => about.toggle()));
  disposers.push(on(title.aboutBtn, 'click', () => about.toggle()));
  disposers.push(on(title.achievementsBtn, 'click', () => setScreen('achievements')));
  disposers.push(on(helpBtn, 'click', () => help.toggle()));
  // A backgrounded tab must not keep repainting the log.
  disposers.push(on(document, 'visibilitychange', () => syncCli()));

  disposers.push(
    bindHotkeys(window, {
      isBlocked: () =>
        screen !== 'run' ||
        options.isOpen ||
        about.isOpen ||
        help.isOpen ||
        draft.isOpen ||
        runOver.isOpen,
      buyTier: (i) => shop.buyVisibleIndex(i),
      ship: () => {
        const ok = sim.ship();
        emit({ t: 'ship', ok });
        if (!ok) ctx.toast('Not enough slop to ship', 'bad');
      },
      escape: () => {
        // Topmost thing first. The dialogs float at z-index 40, above the sheet
        // at 25, so a dialog opened over an open sheet closes first.
        if (help.isOpen) {
          help.close();
          return;
        }
        if (about.isOpen) {
          about.close();
          return;
        }
        if (options.isOpen) {
          options.close();
          return;
        }
        if (drawerOpen) {
          setDrawer(false);
          return;
        }
        if (draft.isOpen || runOver.isOpen) return;
        if (screen === 'meta' || screen === 'achievements') setScreen('title');
      },
    }),
  );

  // ---- frame ---------------------------------------------------------------
  function update(run: RunState, derived: DerivedStats, meta: MetaState): void {
    if (destroyed) return;
    const s = meta.settings;
    reducedAttr.set(s.reducedMotion ? '1' : null);
    fpsAttr.set(s.showFps ? '1' : null);
    // Coach marks are a first-run-only thing; `runs` ticks over the moment the
    // first run ends, so a returning player never sees them again.
    firstRun = meta.runs === 0;
    if (s.reducedMotion !== reduced) {
      reduced = s.reducedMotion;
      syncCli();
    }

    if (screen === 'run') {
      hud.update(run, derived, meta);
      shop.update(run, derived);
      /*
       * Nothing is buyable once the run stops running, so an open sheet is a
       * screenful of disabled rows — and worse, it would be holding the board
       * `inert` underneath a mandatory draft. Closed *before* the dialogs get
       * their chance to open, so the restore-focus does not fight the dialog's
       * own initial focus.
       */
      if (drawerOpen && run.phase !== 'running') setDrawer(false);
      draft.update(run);
      runOver.update(run, derived);
      coach.update(run, derived);
    } else {
      title.update(meta);
      metaScreen.update(meta);
      achievements.update(meta);
    }
  }

  // ---- events --------------------------------------------------------------
  function handle(e: GameEvent): void {
    if (destroyed) return;
    switch (e.t) {
      case 'denied':
        toasts.push(
          e.reason === 'cost'
            ? 'Not enough slop'
            : e.reason === 'demos'
              ? 'Not enough Demos'
              : e.reason === 'locked'
                ? 'Locked'
                : 'Not right now',
          'bad',
        );
        break;
      case 'incidentStart': {
        const def = INCIDENT_BY_ID[e.id];
        toasts.push(def?.name ?? e.id, e.tone === 'good' ? 'good' : 'bad');
        break;
      }
      case 'incidentEnd': {
        const def = INCIDENT_BY_ID[e.id];
        toasts.push(`${def?.name ?? e.id} cleared`, 'good');
        break;
      }
      case 'ship':
        toasts.push(`Shipped · +◈${fmtInt(e.demos)}`, 'good');
        break;
      case 'draftPick': {
        const def = CARD_BY_ID[e.id];
        toasts.push(`Picked ${def?.name ?? e.id}`, 'good');
        break;
      }
      case 'pickupCollect': {
        const def = PICKUP_BY_ID[e.id];
        if (def) toasts.push(`${def.label} — ${def.blurb}`, 'good');
        break;
      }
      case 'draftReroll':
        toasts.push('Rerolled', 'info');
        break;
      case 'achievement':
        achievementPopup.show(e.id);
        break;
      case 'deadlineWarn':
        toasts.push(`${Math.round(e.secondsLeft)}s left`, 'bad');
        break;
      case 'runStart':
        hud.reset();
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
    options.destroy();
    about.destroy();
    runOver.destroy();
    draft.destroy();
    achievementPopup.destroy();
    achievements.destroy();
    metaScreen.destroy();
    title.destroy();
    shop.destroy();
    hud.destroy();
    toasts.destroy();
    ui.remove();
    root.replaceChildren();
    if (stampedApp) root.removeAttribute('data-testid');
  }

  return {
    canvas: hud.canvas,
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
    resize: () => scaleCtl.apply(),
    destroy,
  };
}
