/**
 * The game 2 save: it persists, it resets, and it notices when you edit it.
 *
 * The tamper checks run WITHOUT `?testhooks`: the hooks set `trustSave`, which
 * switches the audit off so the harness can inject saves without accusing
 * itself. Catching a real edit has to be tested the way a player would do it.
 */
import { expect, test, type Page } from '@playwright/test';
import { META_BY_ID } from '../../src/sim/content.ts';
import { signSave } from '../../src/sim/save.ts';
import {
  SAVE_KEY,
  TID,
  TOUR_KEY,
  bootPage,
  expectClean,
  frames,
  grantThumbs,
  snap,
  tid,
} from './harness.ts';

type Save = Record<string, unknown>;

async function readSave(page: Page): Promise<Save> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as Record<string, unknown>, SAVE_KEY);
}

async function writeSave(page: Page, save: Save): Promise<void> {
  await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [SAVE_KEY, JSON.stringify(save)]);
}

/** Wait for the game to have written its first signed save. */
async function firstSave(page: Page): Promise<Save> {
  await expect.poll(async () => (await readSave(page)) !== null).toBe(true);
  const save = await readSave(page);
  expect(typeof save['sig']).toBe('string');
  expect(save['cheats_enabled']).toBe(false);
  return save;
}

test.describe('save tampering', () => {
  test('flipping cheats_enabled in the save earns Script Kiddie II', async ({ page }) => {
    const w = await bootPage(page, { hooks: false });
    const save = await firstSave(page);
    expect((save['achievements'] as Save)['script_kiddie']).toBeUndefined();

    await writeSave(page, { ...save, cheats_enabled: true });
    await page.reload();
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();

    // The popup says so, the save records it, and the achievements screen shows it.
    await expect(page.getByTestId(tid(TID.achievementPopupCard, 'script_kiddie'))).toBeVisible();
    await expect.poll(async () => ((await readSave(page))['achievements'] as Save)['script_kiddie']).toBeTruthy();
    const after = await readSave(page);
    expect(after['cheats_enabled'], 'the save is re-signed clean afterwards').toBe(false);

    await page.getByTestId(TID.achievementsButton).click();
    await expect(page.getByTestId(TID.achievementsScreen)).toBeVisible();
    await expect(page.getByTestId(tid(TID.achievementRow, 'script_kiddie'))).toContainText('Script Kiddie II');
    expectClean(w);
  });

  test('editing a signed field without re-signing is caught the same way', async ({ page }) => {
    await bootPage(page, { hooks: false });
    const save = await firstSave(page);
    await writeSave(page, { ...save, thumbs: 999, totalThumbsEarned: 999 });
    await page.reload();
    await expect(page.getByTestId(tid(TID.achievementPopupCard, 'script_kiddie'))).toBeVisible();
  });

  test('a correctly re-signed but impossible save earns Nice Try instead', async ({ page }) => {
    // Signed with the game's own code, so the checksum passes; but no play
    // can spend 👍 on Training nobody earned.
    const forged: Save = {
      version: 1,
      thumbs: 0,
      totalThumbsEarned: 0,
      levels: { unlock_compact: 1 },
      bestPrompt: 0,
      runs: 1,
      wins: 0,
      achievements: {},
      stats: {},
      legacy: { verdict: 'none' },
    };
    forged['sig'] = signSave(forged);
    forged['cheats_enabled'] = false;
    const w = await bootPage(page, { hooks: false, save: JSON.stringify(forged) });
    await expect(page.getByTestId(tid(TID.achievementPopupCard, 'nice_try'))).toBeVisible();
    const after = await readSave(page);
    expect((after['achievements'] as Save)['nice_try']).toBeTruthy();
    expect((after['achievements'] as Save)['script_kiddie']).toBeUndefined();
    expectClean(w);
  });

  test('an unsigned save is not an accusation', async ({ page }) => {
    const unsigned: Save = { version: 1, thumbs: 2, totalThumbsEarned: 2, runs: 1, wins: 0, achievements: {} };
    await bootPage(page, { hooks: false, save: JSON.stringify(unsigned) });
    await page.waitForTimeout(500);
    await expect(page.locator(`[data-testid^="${TID.achievementPopupCard}-"]`)).toHaveCount(0);
    const after = await readSave(page);
    expect(typeof after['sig'], 'an unsigned save is signed the moment it is found').toBe('string');
    expect(after['thumbs']).toBe(2);
  });

  test('under ?testhooks the save is trusted: the same edit earns nothing', async ({ page }) => {
    await bootPage(page);
    const save = await firstSave(page);
    await writeSave(page, { ...save, cheats_enabled: true });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__TOKENMAXXING2__));
    await frames(page, 4);
    expect((await snap(page)).meta.achievements['script_kiddie']).toBeUndefined();
  });
});

test.describe('persistence', () => {
  test('Training progress survives a reload, and Reset save wipes it', async ({ page }) => {
    const w = await bootPage(page);
    await grantThumbs(page, META_BY_ID['unlock_compact']!.costs[0]!);
    await page.getByTestId(TID.titleMeta).click();
    await page.getByTestId(tid(TID.metaBuy, 'unlock_compact')).click();
    await frames(page, 2);
    const bought = await snap(page);
    expect(bought.meta.levels['unlock_compact']).toBe(1);

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__TOKENMAXXING2__));
    const reloaded = await snap(page);
    expect(reloaded.screen, 'a reload lands on the title').toBe('title');
    expect(reloaded.meta.levels['unlock_compact']).toBe(1);
    expect(reloaded.meta.thumbs).toBe(bought.meta.thumbs);

    // Reset is two clicks on purpose.
    await page.getByTestId(TID.optionsButton).click();
    await expect(page.getByTestId(TID.optionsPanel)).toBeVisible();
    const reset = page.getByTestId(TID.resetSave);
    await reset.click();
    await frames(page, 2);
    expect((await snap(page)).meta.levels['unlock_compact'], 'one click only arms it').toBe(1);
    await Promise.all([page.waitForEvent('load'), reset.click()]);
    await page.waitForFunction(() => Boolean(window.__TOKENMAXXING2__));
    const wiped = await snap(page);
    expect(wiped.meta.levels['unlock_compact']).toBe(0);
    expect(wiped.meta.thumbs).toBe(0);
    expect(wiped.meta.runs).toBe(0);
    expectClean(w);
  });

  test('the save is the one versioned key, signed, with the honeypot off', async ({ page }) => {
    await bootPage(page);
    await grantThumbs(page, 1);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    // The tour's "seen" is its own key on purpose, outside the signed save (the
    // harness writes it). Nothing else may be there.
    expect(keys.filter((k) => k !== TOUR_KEY)).toEqual([SAVE_KEY]);
    const save = await readSave(page);
    expect(save['version']).toBe(1);
    expect(save['thumbs']).toBe(1);
    expect(save['sig']).toBe(signSave(save));
    expect(save['cheats_enabled']).toBe(false);
  });
});
