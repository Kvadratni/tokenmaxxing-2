/**
 * Achievements: the screen that lists them (hidden ones give nothing away),
 * and the popup that slides in when one lands.
 */
import { expect, test } from '@playwright/test';
import { ACHIEVEMENTS } from '../../src/sim/content.ts';
import {
  TID,
  bootPage,
  expectClean,
  fundReport,
  grant,
  snap,
  startRun,
  tid,
} from './harness.ts';

/** An unsigned save (trusted under ?testhooks) that already has QA Engineer, so its popup stays out of the way. */
const QA_DONE = JSON.stringify({ version: 1, achievements: { qa_engineer: 1 }, legacy: { verdict: 'none' } });

test.describe('achievements', () => {
  test('the screen lists all of them, hides the hidden ones, and has a way back', async ({ page }) => {
    const w = await bootPage(page);
    await page.getByTestId(TID.achievementsButton).click();
    const screen = page.getByTestId(TID.achievementsScreen);
    await expect(screen).toBeVisible();
    expect((await snap(page)).screen).toBe('achievements');
    await expect(page.getByTestId(TID.achievementsCount)).toHaveText(`0 / ${ACHIEVEMENTS.length}`);
    await expect(screen.locator(`[data-testid^="${TID.achievementRow}-"]`)).toHaveCount(ACHIEVEMENTS.length);

    for (const def of ACHIEVEMENTS) {
      const row = page.getByTestId(tid(TID.achievementRow, def.id));
      if (def.hidden) {
        // Discovering that it exists is the point: no name, no blurb.
        await expect(row, `${def.id} leaks its name`).not.toContainText(def.name);
        await expect(row).not.toContainText(def.blurb);
      } else {
        await expect(row).toContainText(def.name);
      }
    }

    // Opening the screen focuses Back, and the keyboard can take it.
    await expect(page.getByTestId(TID.achievementsBack)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();

    // Escape leaves it too.
    await page.getByTestId(TID.achievementsButton).click();
    await expect(screen).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
    expectClean(w);
  });

  // BUG (src/styles/ui.css:2647-2651): `.tm-achv { padding: var(--gap2) }`
  // overrides the top padding `.tm-screen` (ui.css:2290) reserves for the top
  // bar, so the achievements header renders under `.tm-topbar` (z-index 30,
  // ui.css:126). The "ACHIEVEMENTS" title overprints the brand, and a mouse
  // click on "← Back" lands on the top bar instead. Expected: the header sits
  // below the top bar, as on Training, and Back takes a click.
  test('the ← Back button takes a mouse click', async ({ page }) => {
    await bootPage(page);
    await page.getByTestId(TID.achievementsButton).click();
    await expect(page.getByTestId(TID.achievementsScreen)).toBeVisible();
    await page.getByTestId(TID.achievementsBack).click({ timeout: 3_000 });
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
  });

  test('driving the game through its test harness is QA Engineer, and the popup says so', async ({ page }) => {
    await bootPage(page);
    expect((await snap(page)).meta.achievements['qa_engineer']).toBeUndefined();
    await grant(page, 1);
    const card = page.getByTestId(tid(TID.achievementPopupCard, 'qa_engineer'));
    await expect(page.getByTestId(TID.achievementPopup)).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card).toContainText('QA Engineer');
    expect((await snap(page)).meta.achievements['qa_engineer']).toBe(1);

    // The screen now reveals it, stamped with the run it was earned on.
    await page.getByTestId(TID.achievementsButton).click();
    await expect(page.getByTestId(TID.achievementsCount)).toHaveText(`1 / ${ACHIEVEMENTS.length}`);
    await expect(page.getByTestId(tid(TID.achievementRow, 'qa_engineer'))).toContainText('QA Engineer');
  });

  test('reporting a first prompt pops It Works On My Machine, which then slides away', async ({ page }) => {
    const w = await bootPage(page, { save: QA_DONE });
    await startRun(page);
    await fundReport(page);
    await page.getByTestId(TID.reportButton).click();
    const card = page.getByTestId(tid(TID.achievementPopupCard, 'works_on_my_machine'));
    await expect(card).toBeVisible();
    expect((await snap(page)).meta.achievements['works_on_my_machine']).toBeGreaterThan(0);
    // Long enough to read, then gone. Real time (about six seconds), so the
    // ceiling is generous for a busy machine.
    await expect(card).toBeHidden({ timeout: 45_000 });
    expectClean(w);
  });
});
