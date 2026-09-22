/**
 * Meta progression: banking Demos, spending them, and surviving a reload.
 */
import { expect, test, type Page } from '@playwright/test';
import { META_BY_ID } from '../../src/sim/content.ts';
import {
  TID,
  advance,
  bootPage,
  frames,
  grant,
  resetSave,
  snap,
  startRun,
  tid,
  takeCard,
} from './harness.ts';

/** Ship projects until the pending tally clears `min`, then die on the clock. */
async function bankDemos(page: Page, min = 5): Promise<number> {
  let guard = 0;
  while (guard++ < 6) {
    const s = await snap(page);
    if (s.run.pendingDemos >= min) break;
    await grant(page, s.derived.requirement);
    await page.getByTestId(TID.shipButton).click();
    await advance(page, 1200);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    await takeCard(page);
    await frames(page, 4);
  }
  const mid = await snap(page);
  expect(mid.run.pendingDemos, 'could not reach the target Demo tally').toBeGreaterThanOrEqual(min);

  await advance(page, mid.run.timeLeftMs + 500);
  await frames(page, 4);
  await expect(page.getByTestId(TID.runOverModal)).toBeVisible();
  await page.getByTestId(TID.runOverContinue).click();
  await frames(page, 4);
  await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
  return mid.run.pendingDemos;
}

test.describe('meta progression', () => {
  test('banked Demos buy an upgrade and the level increments', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    const banked = await bankDemos(page, 5);

    const atShop = await snap(page);
    expect(atShop.meta.demos).toBe(banked);
    await expect(page.getByTestId(TID.metaDemos)).toContainText(String(banked));
    await expect(page.getByTestId(tid(TID.metaRow, 'seed_funding'))).toBeVisible();

    const buy = page.getByTestId(tid(TID.metaBuy, 'seed_funding'));
    await expect(buy).toBeEnabled();
    await buy.click();
    await frames(page, 4);

    const after = await snap(page);
    expect(after.meta.levels['seed_funding']).toBe(1);
    // Costs are balance dials; read the price out of the content.
    const cost = META_BY_ID['seed_funding']!.costs[0]!;
    expect(after.meta.demos, `Seed Funding level 1 costs ${cost}`).toBe(banked - cost);
    await expect(page.getByTestId(TID.metaDemos)).toContainText(String(banked - cost));
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('a maxed-out or unaffordable upgrade is disabled, not silently ignored', async ({ page }) => {
    await bootPage(page);
    // Zero Demos on the title screen: every buy button must be inert.
    await page.keyboard.press('Escape');
    const s = await snap(page);
    expect(s.meta.demos).toBe(0);
    await page.getByTestId(TID.startRun).focus();
    // Reach the shop through a lost run so the screen is legitimately open.
    await startRun(page);
    const run = await snap(page);
    await advance(page, run.run.timeLeftMs + 500);
    await page.getByTestId(TID.runOverContinue).click();
    await frames(page, 4);

    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
    await expect(page.getByTestId(tid(TID.metaBuy, 'seed_funding'))).toBeDisabled();
    await expect(page.getByTestId(tid(TID.metaBuy, 'endless_mode'))).toBeDisabled();
  });

  test('seed_funding actually grants starting slop on the next run', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await bankDemos(page, 5);
    await page.getByTestId(tid(TID.metaBuy, 'seed_funding')).click();
    await frames(page, 4);
    expect((await snap(page)).meta.levels['seed_funding']).toBe(1);

    // Escape leaves the Demos shop for the title screen.
    await page.keyboard.press('Escape');
    await frames(page, 3);
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();

    await startRun(page, 4242);
    const fresh = await snap(page);
    expect(fresh.run.phase).toBe('running');
    expect(fresh.run.slop, 'Seed Funding L1 = 60 starting slop').toBe(60);
    expect(fresh.derived.shipProgress).toBeCloseTo(60 / fresh.derived.requirement, 6);
  });

  test('a purchased level survives a reload and dies with resetSave', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const banked = await bankDemos(page, 5);
    await page.getByTestId(tid(TID.metaBuy, 'seed_funding')).click();
    await frames(page, 4);
    const bought = await snap(page);
    expect(bought.meta.levels['seed_funding']).toBe(1);
    const seedCost = META_BY_ID['seed_funding']!.costs[0]!;
    expect(bought.meta.demos).toBe(banked - seedCost);

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
    await frames(page, 4);

    const reloaded = await snap(page);
    expect(reloaded.meta.levels['seed_funding'], 'the level must survive a reload').toBe(1);
    expect(reloaded.meta.demos).toBe(banked - seedCost);
    expect(reloaded.meta.runs).toBe(bought.meta.runs);
    expect(reloaded.screen, 'a reload lands back on the title screen').toBe('title');

    await resetSave(page);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
    await frames(page, 4);

    const wiped = await snap(page);
    expect(wiped.meta.levels['seed_funding']).toBe(0);
    expect(wiped.meta.demos).toBe(0);
    expect(wiped.meta.runs).toBe(0);
    expect(wiped.meta.totalDemosEarned).toBe(0);
  });

  test('the persisted payload is the versioned save key and nothing else', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await bankDemos(page, 5);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toEqual(['tokenmaxxing2.save.v1']);
    const raw = await page.evaluate(() => localStorage.getItem('tokenmaxxing2.save.v1'));
    const parsed = JSON.parse(raw ?? '{}') as { version?: number; demos?: number };
    expect(parsed.version).toBe(1);
    expect(parsed.demos).toBeGreaterThan(0);
  });
});
