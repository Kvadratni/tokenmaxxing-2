/**
 * The three onboarding surfaces, wired into the real page: the ambient CLI
 * behind the title, the `?` overlay, and the first-run coach marks.
 *
 * Unit tests already cover each module in isolation. What can only break at
 * the seam is covered here — chiefly that a full-bleed decorative layer does
 * not eat the Start button, which is the one way this feature could make the
 * game unplayable.
 */
import { expect, test } from '@playwright/test';
import { TID, advance, bootPage, clickLaptop, frames, snap, startRun, tid } from './harness.ts';

test.describe('onboarding', () => {
  test('the CLI backdrop runs behind the title and never eats a click', async ({ page }) => {
    const w = await bootPage(page);
    const cli = page.getByTestId(TID.cliBackdrop);
    await expect(cli).toBeAttached();
    await expect(cli).toHaveAttribute('aria-hidden', 'true');

    // It must be decorative in the accessibility tree and inert to the mouse.
    const inert = await cli.evaluate((n) => getComputedStyle(n).pointerEvents);
    expect(inert).toBe('none');

    // It writes lines over time rather than painting one frozen frame.
    await page.waitForFunction(
      () => (document.querySelectorAll('.tm-cli__line').length ?? 0) > 2,
      undefined,
      { timeout: 5000 },
    );
    const early = await page.locator('.tm-cli__line').count();
    await page.waitForTimeout(1200);
    const later = await page.locator('.tm-cli__line').allTextContents();
    expect(early).toBeGreaterThan(0);
    expect(later.join('\n').length).toBeGreaterThan(0);

    // The backdrop covers the whole title screen, so a hit test at the centre
    // of Start must still land on Start.
    const start = page.getByTestId(TID.startRun);
    const box = (await start.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => {
        const n = document.elementFromPoint(x as number, y as number);
        return n?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit, 'the backdrop is intercepting the Start button').toBe(TID.startRun);

    await start.click();
    await frames(page, 3);
    expect((await snap(page)).run.phase).toBe('running');
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('the backdrop stops once the run starts and comes back on the title', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await frames(page, 3);
    // Still in the DOM (it lives inside the title screen) but not visible.
    await expect(page.getByTestId(TID.cliBackdrop)).toBeHidden();

    const during = await page.locator('.tm-cli__line').allTextContents();
    await advance(page, 3000);
    await page.waitForTimeout(900);
    const after = await page.locator('.tm-cli__line').allTextContents();
    expect(after, 'the log kept ticking while the player was in a run').toEqual(during);
  });

  test('? opens how-to-play, Escape closes it, and the game keeps its keys', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);

    await page.getByTestId(TID.helpButton).click();
    const modal = page.getByTestId(TID.helpModal);
    await expect(modal).toBeVisible();
    await expect(page.getByTestId(TID.helpControls)).toBeVisible();
    // No key row may advertise the removed buy-quantity hotkey. The prose below
    // the table does mention Q — to say it deliberately does not exist — so this
    // has to look at the <kbd> chips, not the section text.
    const keys = await page.getByTestId(TID.helpControls).locator('kbd').allTextContents();
    expect(keys.map((k) => k.trim().toLowerCase())).not.toContain('q');

    // While it owns the keyboard, Space must not be clicking the laptop.
    const before = await snap(page);
    await page.keyboard.press('Space');
    await frames(page, 3);
    expect((await snap(page)).run.clicks).toBe(before.run.clicks);

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await frames(page, 3);
    await clickLaptop(page);
    expect((await snap(page)).run.clicks).toBeGreaterThan(before.run.clicks);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('? and About are different buttons', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await page.getByTestId(TID.helpButton).click();
    await expect(page.getByTestId(TID.helpModal)).toBeVisible();
    await expect(page.getByTestId(TID.aboutModal)).toBeHidden();
    await page.keyboard.press('Escape');

    await page.getByTestId('topbar-about').click();
    await expect(page.getByTestId(TID.aboutModal)).toBeVisible();
    await expect(page.getByTestId(TID.helpModal)).toBeHidden();
    // The title screen carries its own Ko-fi link, so scope to the modal.
    await expect(page.getByTestId(TID.aboutModal).getByTestId(TID.kofiLink)).toBeVisible();
  });

  test('coach marks appear on the first run only', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    await frames(page, 4);

    const tip = page.getByTestId(new RegExp(`^${TID.coachTip}-`));
    await expect(tip.first()).toBeVisible({ timeout: 4000 });
    // Exactly one at a time — a wall of bubbles is worse than none.
    expect(await tip.count()).toBe(1);

    // Dismissing retires it without blocking play.
    const id = (await tip.first().getAttribute('data-testid'))!.slice(TID.coachTip.length + 1);
    await page.getByTestId(tid(TID.coachDismiss, id)).click();
    await frames(page, 3);
    await expect(page.getByTestId(tid(TID.coachTip, id))).toBeHidden();

    // Die, bank the run, and start a second one: no coaching this time.
    const s = await snap(page);
    await advance(page, s.run.timeLeftMs + 500);
    await frames(page, 4);
    await page.getByTestId(TID.runOverContinue).click();
    await frames(page, 4);
    await page.keyboard.press('Escape');
    await frames(page, 3);

    await startRun(page, 99);
    await advance(page, 6000);
    await frames(page, 6);
    expect((await snap(page)).meta.runs).toBeGreaterThan(0);
    expect(await page.getByTestId(new RegExp(`^${TID.coachTip}-`)).count()).toBe(0);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });
});
