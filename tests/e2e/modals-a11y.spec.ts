/**
 * Dialogs, keyboard and accessibility basics: help / about / options open and
 * close, mandatory dialogs trap focus and refuse Escape, hotkeys stand down
 * while a dialog owns the keyboard, and the bars speak ARIA.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  TID,
  advance,
  bootPage,
  draftCards,
  drainCoach,
  expectClean,
  focused,
  forceDraft,
  frames,
  grant,
  sel,
  snap,
  startRun,
  tid,
} from './harness.ts';

/** Same selector `src/ui/dom.ts#focusables` uses, so the two lists agree. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DRAFT = ['please', 'tip_200', 'you_are_expert'];

/** Press Tab `n` times; every stop must be inside `container`. Returns the stops. */
async function tabRing(page: Page, container: string, n: number, shift = false): Promise<string[]> {
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    const info = await page.evaluate((c) => {
      const a = document.activeElement;
      const box = document.querySelector(c);
      return {
        id: a?.getAttribute('data-testid') ?? a?.tagName ?? 'null',
        inside: Boolean(box && a && box.contains(a)),
      };
    }, container);
    expect(info.inside, `${shift ? 'Shift+' : ''}Tab #${i + 1} escaped ${container} to ${info.id}`).toBe(true);
    stops.push(info.id);
  }
  return stops;
}

test.describe('dialogs', () => {
  test('? opens how-to-play; Escape closes it, focus comes back, and the game keeps its keys', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    const helpBtn = page.getByTestId(TID.helpButton);
    await helpBtn.click();
    const modal = page.getByTestId(TID.helpModal);
    await expect(modal).toBeVisible();
    await expect(page.getByTestId(TID.helpControls)).toBeVisible();
    await expect(page.getByTestId(TID.helpMeta)).toBeAttached();
    // Every hotkey the game binds is documented.
    const keys = (await page.getByTestId(TID.helpControls).locator('kbd').allTextContents()).map((k) => k.trim());
    for (const k of ['Space', 'S', 'Y', 'C', 'Esc']) expect(keys, `help lists ${k}`).toContain(k);

    // While it owns the keyboard, no hotkey reaches the game.
    const before = await snap(page);
    for (const k of ['1', 's', 'y', 'c']) await page.keyboard.press(k);
    await frames(page, 2);
    await expect(modal).toBeVisible();
    const during = await snap(page);
    expect(during.run.sycophancy).toBe(before.run.sycophancy);
    expect(during.run.reported).toBe(before.run.reported);
    expect(during.run.compactions).toBe(before.run.compactions);

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(helpBtn).toBeFocused();

    // Space inside the dialog is the focused button's own key, never "generate".
    await helpBtn.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Space');
    await frames(page, 2);
    expect((await snap(page)).run.clicks).toBe(before.run.clicks);

    // "Got it" closes it; then Space is "generate" again.
    if (await modal.isVisible()) await page.getByTestId(TID.helpClose).click();
    await expect(modal).toBeHidden();
    await page.keyboard.press('Space');
    await frames(page, 2);
    expect((await snap(page)).run.clicks).toBe(before.run.clicks + 1);
    expectClean(w);
  });

  test('About opens from the title and the top bar, with its links, and closes both ways', async ({ page }) => {
    await bootPage(page);
    const about = page.getByTestId(TID.aboutModal);
    await page.getByTestId(TID.aboutButton).click();
    await expect(about).toBeVisible();
    for (const id of [TID.kofiLink, TID.repoLink, TID.prequelLink]) {
      const link = about.getByTestId(id);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', /^https:\/\//);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
    await page.getByTestId(TID.aboutClose).click();
    await expect(about).toBeHidden();

    await startRun(page);
    await page.getByTestId(TID.topbarAbout).click();
    await expect(about).toBeVisible();
    await expect(page.getByTestId(TID.helpModal), '? and About are different dialogs').toBeHidden();
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();
  });

  test('Options: toggles mirror the settings the sim holds; Escape closes', async ({ page }) => {
    await bootPage(page);
    await page.getByTestId(TID.optionsButton).click();
    const panel = page.getByTestId(TID.optionsPanel);
    await expect(panel).toBeVisible();

    const mute = page.getByTestId(TID.muteToggle);
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    let s = await snap(page);
    expect(s.meta.settings.musicVolume).toBe(0);
    expect(s.meta.settings.sfxVolume).toBe(0);
    await mute.click();
    s = await snap(page);
    expect(s.meta.settings.musicVolume).toBeGreaterThan(0);

    const motion = page.getByTestId(TID.reducedMotion);
    await motion.click();
    await expect(motion).toHaveAttribute('aria-pressed', 'true');
    expect((await snap(page)).meta.settings.reducedMotion).toBe(true);
    await expect(page.getByTestId(TID.app).locator('[data-reduced-motion="1"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.getByTestId(TID.optionsButton).click();
    await page.getByTestId(TID.optionsClose).click();
    await expect(panel).toBeHidden();
  });

  test('the draft traps focus, opens with nothing chosen, and refuses Escape', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forceDraft(page, DRAFT);
    const modal = page.getByTestId(TID.draftModal);
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal).toHaveAttribute('aria-label', /.+/);
    await expect(draftCards(page)).toHaveCount(DRAFT.length);
    expect(await focused(page), 'opening moves focus into the draft').toBe(tid(TID.draftCard, DRAFT[0]!));
    await expect(page.getByTestId(TID.draftConfirm), 'nothing is pre-chosen').toBeDisabled();

    await page.keyboard.press('Escape');
    await frames(page, 2);
    await expect(modal, 'a mandatory pick is not dismissable').toBeVisible();

    const stops = await tabRing(page, sel(TID.draftModal), 8);
    expect(new Set(stops).size, 'the trap cycles, not pins').toBeGreaterThan(1);
    await tabRing(page, sel(TID.draftModal), 5, true);

    // Arrows move the highlight, Enter confirms it.
    await page.getByTestId(tid(TID.draftCard, DRAFT[0]!)).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId(tid(TID.draftCard, DRAFT[0]!))).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId(tid(TID.draftCard, DRAFT[1]!))).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(modal).toBeHidden();
    expect((await snap(page)).run.cards).toEqual([DRAFT[1]]);
  });

  test('the draft owns the keyboard: shop and report hotkeys stand down', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 100_000);
    await forceDraft(page, DRAFT);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    const before = await snap(page);
    for (const k of ['1', 's', 'y', 'Space']) await page.keyboard.press(k);
    await frames(page, 2);
    const after = await snap(page);
    expect(after.run.tools).toEqual(before.run.tools);
    expect(after.run.reported).toBe(before.run.reported);
    expect(after.run.clicks).toBe(before.run.clicks);
    expect(after.run.phase).toBe('drafting');
  });
});

test.describe('accessibility', () => {
  test('the bars are progressbars that track state', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    for (const id of [TID.contextBar, TID.patienceBar, TID.reportBar]) {
      const bar = page.getByTestId(id);
      await expect(bar).toHaveAttribute('role', 'progressbar');
      await expect(bar).toHaveAttribute('aria-label', /.+/);
      await expect(bar).toHaveAttribute('aria-valuemin', '0');
      await expect(bar).toHaveAttribute('aria-valuemax', '100');
    }
    await grant(page, s0.derived.requirement * 0.25);
    await expect(page.getByTestId(TID.reportBar)).toHaveAttribute('aria-valuenow', '25');
    await advance(page, s0.derived.patienceMaxMs / 2);
    const s1 = await snap(page);
    await expect(page.getByTestId(TID.patienceBar)).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(s1.derived.patienceProgress * 100)),
    );
    await expect(page.getByTestId(TID.contextBar)).toHaveAttribute('aria-valuetext', /.+/);
  });

  test('every run-screen control is reachable with Tab, and focus never falls to <body>', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 1_000);
    // Coach tips are focusable too; a raw Tab walk needs a quiet screen.
    await drainCoach(page);

    const expected = await page.evaluate((f) => {
      const root = document.querySelector('[data-testid="app"]');
      if (!root) return [] as string[];
      return Array.from(root.querySelectorAll<HTMLElement>(f))
        .filter((n) => n.closest('[hidden]') === null && n.closest('[inert]') === null)
        .filter((n) => n.getAttribute('aria-hidden') !== 'true')
        .filter((n) => n.getClientRects().length > 0)
        .map((n) => n.getAttribute('data-testid') ?? n.tagName);
    }, FOCUSABLE);
    for (const id of [TID.agent, TID.reportButton, TID.sycophancyButton, TID.tabTools, TID.buyQtyToggle, TID.optionsButton]) {
      expect(expected, `${id} is in the tab ring`).toContain(id);
    }

    await page.getByTestId(expected[0]!).focus();
    const visited = new Set<string>([expected[0]!]);
    for (let i = 1; i < expected.length; i++) {
      await page.keyboard.press('Tab');
      const id = await focused(page);
      expect(id, `Tab #${i} fell out of the app`).not.toBe('BODY');
      visited.add(id);
    }
    expect([...visited].sort()).toEqual([...new Set(expected)].sort());
  });

  test('prefers-reduced-motion collapses transitions and the game still plays', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const w = await bootPage(page);
    await startRun(page);
    const dur = await page.getByTestId(TID.reportBarFill).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(Number.parseFloat(dur), `the report bar must not animate (got ${dur})`).toBeLessThan(0.01);
    await page.getByTestId(TID.agent).click();
    await frames(page, 2);
    expect((await snap(page)).run.clicks).toBe(1);
    expectClean(w);
  });

  test('coach marks teach on the first session only', async ({ page }) => {
    const w = await bootPage(page, { keepCoach: true });
    await startRun(page);
    const tips = page.locator(`[data-testid^="${TID.coachTip}-"]`);
    await expect(tips.first()).toBeVisible();
    expect(await tips.count(), 'one tip at a time').toBe(1);
    const id = ((await tips.first().getAttribute('data-testid')) ?? '').slice(TID.coachTip.length + 1);
    await page.getByTestId(tid(TID.coachDismiss, id)).click();
    await expect(page.getByTestId(tid(TID.coachTip, id))).toBeHidden();

    // Second session: no coaching.
    await page.evaluate(() => window.__TOKENMAXXING2__!.setPatience(0));
    await page.getByTestId(TID.runOverContinue).click();
    await page.getByTestId(TID.metaStart).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    await page.evaluate(() => window.__TOKENMAXXING2__!.setContext(0.5));
    await page.waitForTimeout(600);
    await expect(tips).toHaveCount(0);
    expectClean(w);
  });
});
