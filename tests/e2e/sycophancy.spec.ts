/**
 * "You're absolutely right!": buys patience back, worth half as much each
 * press while the heat is on, and costs context because sycophancy is tokens
 * too.
 */
import { expect, test } from '@playwright/test';
import { ACHIEVEMENT_BY_ID, ACHIEVEMENT_TUNING } from '../../src/sim/content.ts';
import {
  TID,
  bootPage,
  expectClean,
  forceDraft,
  frames,
  setPatience,
  snap,
  startRun,
  takeCard,
} from './harness.ts';

const gain = (f: number): string => {
  const p = f * 100;
  return p < 1 ? `+${(Math.round(p * 10) / 10).toFixed(1)}%` : `+${Math.round(p)}%`;
};

test.describe('sycophancy', () => {
  test('the button and Y restore patience with diminishing returns, and cost context', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    await setPatience(page, 0.3);
    const s0 = await snap(page);
    const button = page.getByTestId(TID.sycophancyButton);
    await expect(button).toBeEnabled();
    await expect(button).toContainText(gain(s0.derived.sycophancyPower));

    await button.click();
    await frames(page, 2);
    const s1 = await snap(page);
    expect(s1.run.sycophancy).toBe(1);
    expect((s1.run.patienceMs - s0.run.patienceMs) / s0.derived.patienceMaxMs).toBeCloseTo(
      s0.derived.sycophancyPower,
      6,
    );
    expect(s1.run.context, 'sycophancy is tokens too').toBeGreaterThan(s0.run.context);
    // Each press is worth about half the last while the heat is on.
    expect(s1.derived.sycophancyPower).toBeLessThan(s0.derived.sycophancyPower * 0.75);
    await expect(button).toContainText(gain(s1.derived.sycophancyPower));

    await page.keyboard.press('y');
    await frames(page, 2);
    const s2 = await snap(page);
    expect(s2.run.sycophancy).toBe(2);
    const second = (s2.run.patienceMs - s1.run.patienceMs) / s1.derived.patienceMaxMs;
    expect(second).toBeCloseTo(s1.derived.sycophancyPower, 6);
    expect(second).toBeLessThan((s1.run.patienceMs - s0.run.patienceMs) / s0.derived.patienceMaxMs);
    expect(s2.meta.stats['sycophancy'], 'lifetime presses are counted').toBe(2);

    // The heat cools off: left alone, the next press is worth the full amount
    // again. The cool-down is a tuned duration and can outlast the human, so
    // keep the human patient while waiting on it.
    let cooled = s2;
    for (let spent = 0; cooled.derived.sycophancyPower < s0.derived.sycophancyPower * 0.999; spent += 2_000) {
      expect(spent, 'the sycophancy heat never cooled off').toBeLessThan(15 * 60_000);
      await page.evaluate(() => {
        const h = window.__TOKENMAXXING2__!;
        h.setPatience(1);
        h.advance(2_000);
      });
      cooled = await snap(page);
    }
    expect(cooled.run.phase).toBe('running');
    expect(cooled.run.sycophancyHeat).toBeCloseTo(0, 9);
    expectClean(w);
  });

  test('it never overfills the bar', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    expect(s0.derived.patienceProgress).toBe(1);
    await page.getByTestId(TID.sycophancyButton).click();
    await frames(page, 2);
    const s1 = await snap(page);
    expect(s1.run.patienceMs).toBe(s0.derived.patienceMaxMs);
    expect(s1.run.sycophancy).toBe(1);
  });

  test('ten presses in ten seconds is the hidden Sycophant', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    expect(ACHIEVEMENT_BY_ID['sycophant']?.hidden).toBe(true);
    for (let i = 0; i < ACHIEVEMENT_TUNING.SYCOPHANT_PRESSES; i++) await page.keyboard.press('y');
    await frames(page, 2);
    const s = await snap(page);
    expect(s.run.sycophancy).toBe(ACHIEVEMENT_TUNING.SYCOPHANT_PRESSES);
    expect(s.meta.achievements['sycophant']).toBeGreaterThan(0);
  });

  test('outside a running prompt the button is off and Y does nothing', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forceDraft(page, ['please', 'tip_200', 'you_are_expert']);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    await expect(page.getByTestId(TID.sycophancyButton)).toBeDisabled();
    await page.keyboard.press('y');
    await frames(page, 2);
    expect((await snap(page)).run.sycophancy).toBe(0);
    await takeCard(page);
    await expect(page.getByTestId(TID.sycophancyButton)).toBeEnabled();
  });
});
