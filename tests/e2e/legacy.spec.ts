/**
 * The cross-game hook: a Tokenmaxxing 1 save on the same origin.
 *
 * The saves here are built with game 1's *own* signing code, imported from
 * the untouched original (`../tokenmaxxing/src/sim/save.ts`), so "clean"
 * means what game 1 itself would say, and each fixture is checked against
 * game 1's own audit before the sequel ever sees it.
 *
 * Two paths in: the `importLegacy` hook (what a cross-origin dev server has to
 * use), and the real one, a `tokenmaxxing.save.v1` key in localStorage at
 * first boot, which the preview origin can exercise directly.
 */
import { expect, test } from '@playwright/test';
import * as game1 from '../../../tokenmaxxing/src/sim/save.ts';
import { ACHIEVEMENT_BY_ID, BALANCE } from '../../src/sim/content.ts';
import {
  LEGACY_KEY,
  SAVE_KEY,
  TID,
  bootPage,
  expectClean,
  frames,
  importLegacy,
  snap,
  startRun,
} from './harness.ts';

type Game1Meta = ReturnType<typeof game1.defaultMeta>;

/** A save game 1 would write for a player with a few runs behind them. */
function game1Save(edit: (m: Game1Meta) => void = () => {}): string {
  const store = new Map<string, string>();
  const storage: game1.StorageLike = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
  const meta = game1.defaultMeta();
  meta.runs = 7;
  meta.wins = 2;
  meta.bestProject = 6;
  meta.demos = 4;
  meta.totalDemosEarned = 30;
  meta.levels['unlock_swarm'] = 1;
  meta.levels['cracked'] = 2;
  meta.achievements = { first_ship: 1, series_a: 3 };
  edit(meta);
  expect(game1.saveMeta(meta, storage), 'game 1 wrote the save').toBe(true);
  const raw = store.get(game1.SAVE_KEY);
  expect(raw).toBeTruthy();
  return raw!;
}

/** Game 1's own verdict on a payload, as a fixture sanity check. */
function game1Verdict(raw: string): string {
  return game1.auditSave(JSON.parse(raw) as unknown);
}

/** The same save, hand-edited after signing: more wins than it earned. */
function tamperedSave(): string {
  const raw = JSON.parse(game1Save()) as Record<string, unknown>;
  raw['wins'] = 5;
  return JSON.stringify(raw);
}

/** Correctly re-signed with game 1's code, but impossible: more wins than runs. */
function forgedSave(): string {
  const raw = JSON.parse(game1Save()) as Record<string, unknown>;
  raw['wins'] = 50;
  raw['sig'] = game1.signSave(raw);
  return JSON.stringify(raw);
}

/** A clean signature over a save that carries game 1's own cheating badge. */
function convictedSave(): string {
  return game1Save((m) => {
    m.achievements = { ...m.achievements, script_kiddie: 2 };
  });
}

const giftFor = (wins: number): number =>
  Math.min(BALANCE.LEGACY_GIFT_CAP, BALANCE.LEGACY_GIFT_BASE + BALANCE.LEGACY_GIFT_PER_WIN * wins);

test.describe('the Tokenmaxxing 1 save', () => {
  test('fixtures: game 1 judges its own saves the way the specs assume', () => {
    expect(game1.SAVE_KEY).toBe(LEGACY_KEY);
    expect(game1Verdict(game1Save())).toBe('clean');
    expect(game1Verdict(tamperedSave())).toBe('edited');
    expect(game1Verdict(forgedSave())).toBe('forged');
    expect(game1Verdict(convictedSave())).toBe('clean');
    for (const id of ['returning_customer', 'legal_notified']) {
      expect(ACHIEVEMENT_BY_ID[id]?.hidden, `${id} is a hidden achievement`).toBe(true);
    }
  });

  test('a clean save: the notice, the welcome 👍, and Returning Customer', async ({ page }) => {
    const w = await bootPage(page);
    const before = await snap(page);
    expect(before.meta.thumbs).toBe(0);

    await importLegacy(page, game1Save());
    const notice = page.getByTestId(TID.legacyNotice);
    await expect(notice).toBeVisible();
    await expect(page.getByTestId(TID.legacyOk)).toBeFocused();

    const after = await snap(page);
    const gift = giftFor(2);
    expect(gift).toBeGreaterThan(0);
    expect(after.meta.legacy).toEqual({ verdict: 'clean', runs: 7, wins: 2, gift, cheater: false });
    expect(after.meta.thumbs).toBe(before.meta.thumbs + gift);
    expect(after.meta.totalThumbsEarned, 'the gift counts as earned').toBe(before.meta.totalThumbsEarned + gift);
    await expect(notice).toContainText(`+${gift}`);
    expect(after.meta.achievements['returning_customer']).toBeGreaterThan(0);
    expect(after.meta.achievements['legal_notified']).toBeUndefined();

    await page.getByTestId(TID.legacyOk).click();
    await expect(notice).toBeHidden();

    // An honest human checks claims at the usual rate.
    const run = await startRun(page);
    expect(run.derived.verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE, 6);
    expectClean(w);
  });

  test('a tampered save: the notice anyway, the gift anyway, and Legal Has Been Notified', async ({ page }) => {
    const w = await bootPage(page);
    await importLegacy(page, tamperedSave());
    const notice = page.getByTestId(TID.legacyNotice);
    await expect(notice).toBeVisible();

    const after = await snap(page);
    const gift = giftFor(5);
    expect(after.meta.legacy).toEqual({ verdict: 'edited', runs: 7, wins: 5, gift, cheater: true });
    expect(after.meta.thumbs).toBe(gift);
    await expect(notice).toContainText(`+${gift}`);
    expect(after.meta.achievements['returning_customer']).toBeGreaterThan(0);
    expect(after.meta.achievements['legal_notified']).toBeGreaterThan(0);

    // Escape dismisses it like any notice.
    await page.keyboard.press('Escape');
    await expect(notice).toBeHidden();

    // The human cheats too, so they check your work less.
    const run = await startRun(page);
    expect(run.derived.verifyChance).toBeCloseTo(BALANCE.VERIFY_BASE + BALANCE.LEGACY_CHEATER_VERIFY, 6);
    expectClean(w);
  });

  for (const [name, make, verdict] of [
    ['a forged save (re-signed, but impossible)', forgedSave, 'forged'],
    ['a clean-signed save carrying game 1’s cheating badge', convictedSave, 'clean'],
  ] as const) {
    test(`${name} marks the human a cheater`, async ({ page }) => {
      await bootPage(page);
      const raw = make();
      await importLegacy(page, raw);
      await expect(page.getByTestId(TID.legacyNotice)).toBeVisible();
      const s = await snap(page);
      const wins = (JSON.parse(raw) as { wins: number }).wins;
      expect(s.meta.legacy).toEqual({ verdict, runs: 7, wins, gift: giftFor(wins), cheater: true });
      expect(s.meta.achievements['legal_notified']).toBeGreaterThan(0);
    });
  }

  test('junk in the game 1 slot is not a save: no notice, no gift', async ({ page }) => {
    await bootPage(page);
    await importLegacy(page, '{"this is": not json');
    await frames(page, 4);
    await expect(page.getByTestId(TID.legacyNotice)).toBeHidden();
    const s = await snap(page);
    expect(s.meta.legacy).toEqual({ verdict: 'none' });
    expect(s.meta.thumbs).toBe(0);
    expect(s.meta.achievements['returning_customer']).toBeUndefined();
  });

  test('the real path: a game 1 save on the origin is imported once, at first boot', async ({ page }) => {
    const w = await bootPage(page, { legacySave: game1Save() });
    await expect(page.getByTestId(TID.legacyNotice)).toBeVisible();
    const first = await snap(page);
    expect(first.meta.legacy).toMatchObject({ verdict: 'clean', wins: 2 });
    expect(first.meta.thumbs).toBe(giftFor(2));
    await page.getByTestId(TID.legacyOk).click();

    // The import is recorded in the game 2 save: a reload does not repeat it.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__TOKENMAXXING2__));
    await frames(page, 4);
    await expect(page.getByTestId(TID.legacyNotice)).toBeHidden();
    const again = await snap(page);
    expect(again.meta.legacy).toEqual(first.meta.legacy);
    expect(again.meta.thumbs, 'the gift is one-time').toBe(first.meta.thumbs);
    // Game 1's save is read, never written.
    expect(await page.evaluate((k) => localStorage.getItem(k) !== null, LEGACY_KEY)).toBe(true);
    expectClean(w);
  });

  test('the real path in production (no hooks): a tampered save is caught and recorded', async ({ page }) => {
    const w = await bootPage(page, { hooks: false, legacySave: tamperedSave() });
    await expect(page.getByTestId(TID.legacyNotice)).toBeVisible();
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, unknown>, SAVE_KEY);
    expect(saved['legacy']).toMatchObject({ verdict: 'edited', cheater: true });
    const ach = saved['achievements'] as Record<string, number>;
    expect(ach['returning_customer']).toBeGreaterThan(0);
    expect(ach['legal_notified']).toBeGreaterThan(0);
    // Importing a cheater's save is not the sequel's own save being tampered with.
    expect(ach['script_kiddie']).toBeUndefined();
    await page.getByTestId(TID.legacyOk).click();
    await expect(page.getByTestId(TID.legacyNotice)).toBeHidden();
    expectClean(w);
  });
});
