/**
 * The context window and compaction.
 *
 * Forced: overflow keeps a fraction of the wallet, docks patience, resets the
 * window, and (with more cards than summary slots) opens the summary picker.
 * Manual: /compact is a Training unlock; it keeps more of the wallet, costs no
 * patience, and pauses generation while it runs.
 */
import { expect, test } from '@playwright/test';
import { BALANCE, META_BY_ID } from '../../src/sim/content.ts';
import {
  TID,
  activeCards,
  advance,
  advanceUntil,
  bootPage,
  byPrefix,
  clickAgent,
  expectClean,
  frames,
  grant,
  grantThumbs,
  holdCards,
  loseRunToTraining,
  setContext,
  snap,
  startRun,
  tid,
} from './harness.ts';

/** Starting-pool cards with no effect on summary slots or patience. */
const CARDS = ['please', 'tip_200', 'you_are_expert'];

test.describe('forced compaction', () => {
  test('overflow with more cards than slots opens the summary picker; the kept set is what you chose', async ({
    page,
  }) => {
    const w = await bootPage(page);
    await startRun(page);
    await holdCards(page, CARDS);
    await grant(page, 1_000);
    const before = await snap(page);
    expect(before.run.cards).toEqual(CARDS);
    expect(before.derived.summarySlots).toBeLessThan(CARDS.length);

    await setContext(page, 1);
    const modal = page.getByTestId(TID.summaryModal);
    await expect(modal).toBeVisible();
    const during = await snap(page);
    expect(during.run.phase).toBe('compacting');
    expect(during.run.summary).toEqual({ offered: CARDS, slots: before.derived.summarySlots, forced: true });
    expect(during.run.compactions).toBe(1);
    expect(during.run.forcedCompactions).toBe(1);
    // A forced compaction keeps a fraction of the wallet and docks patience.
    expect(during.run.tokens).toBeCloseTo(before.run.tokens * before.derived.compactKeepForced, 6);
    const docked = (before.run.patienceMs - during.run.patienceMs) / before.derived.patienceMaxMs;
    expect(docked).toBeCloseTo(BALANCE.COMPACT_PENALTY, 3);
    expect(during.run.context).toBeLessThan(before.derived.contextMax * 0.5);

    await expect(byPrefix(modal, TID.summaryCard)).toHaveCount(CARDS.length);
    await expect(page.getByTestId(TID.summarySlots)).toContainText(String(during.run.summary!.slots));
    // Default: the first card(s) are kept.
    await expect(page.getByTestId(tid(TID.summaryCard, CARDS[0]!))).toHaveAttribute('aria-pressed', 'true');

    // The sim is paused while you choose, and the picker is not dismissable.
    await advance(page, 5_000);
    await page.keyboard.press('Escape');
    await frames(page, 2);
    await expect(modal).toBeVisible();
    const paused = await snap(page);
    expect(paused.run.patienceMs).toBe(during.run.patienceMs);
    expect(paused.run.phase).toBe('compacting');

    // With one slot, keeping another card swaps it in.
    const keep = CARDS[2]!;
    await page.getByTestId(tid(TID.summaryCard, keep)).click();
    await expect(page.getByTestId(tid(TID.summaryCard, keep))).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(tid(TID.summaryCard, CARDS[0]!))).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId(TID.summaryConfirm).click();
    await expect(modal).toBeHidden();

    const after = await snap(page);
    expect(after.run.phase).toBe('running');
    expect(after.run.cards).toEqual([keep]);
    expect(after.run.summary).toBeNull();
    await expect(activeCards(page)).toHaveCount(1);
    await expect(page.getByTestId(tid(TID.activeCard, keep))).toBeVisible();
    // Tools survive: they are installed, not remembered. And the badge is earned.
    expect(after.run.tools).toEqual(before.run.tools);
    expect(after.meta.achievements['compacted']).toBeGreaterThan(0);
    expectClean(w);
  });

  test('the picker takes the keyboard: digits toggle, Ctrl+Enter confirms, zero kept forgets them all', async ({
    page,
  }) => {
    await bootPage(page);
    await startRun(page);
    await holdCards(page, CARDS.slice(0, 2));
    await setContext(page, 1);
    await expect(page.getByTestId(TID.summaryModal)).toBeVisible();

    // Focus lands in the picker; "1" toggles the first card off.
    await page.keyboard.press('1');
    await expect(page.getByTestId(tid(TID.summaryCard, CARDS[0]!))).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId(TID.summaryModal)).toBeHidden();
    const s = await snap(page);
    expect(s.run.cards).toEqual([]);
    await expect(activeCards(page)).toHaveCount(0);
  });

  test('overflow with no more cards than slots compacts straight through', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await holdCards(page, CARDS.slice(0, 1));
    await grant(page, 500);
    const before = await snap(page);
    expect(before.run.cards.length).toBeLessThanOrEqual(before.derived.summarySlots);

    await setContext(page, 1);
    await frames(page, 2);
    await expect(page.getByTestId(TID.summaryModal)).toBeHidden();
    const after = await snap(page);
    expect(after.run.phase).toBe('running');
    expect(after.run.cards).toEqual(before.run.cards);
    expect(after.run.forcedCompactions).toBe(1);
    expect(after.run.tokens).toBeCloseTo(before.run.tokens * before.derived.compactKeepForced, 6);
    await expect(page.getByTestId(TID.toast).last()).toBeVisible();
    // The bar follows the reset.
    await expect(page.getByTestId(TID.contextBar)).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(after.derived.contextFill * 100)),
    );
  });

  test('clicks fill the window until it overflows on its own', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    // Park just under the edge, then click it over.
    const perClick = s0.derived.clickContext;
    await setContext(page, 1 - (perClick * 1.5) / s0.derived.contextMax);
    expect((await snap(page)).run.forcedCompactions).toBe(0);
    await clickAgent(page, 2);
    const s = await snap(page);
    expect(s.run.forcedCompactions, 'the second click overflows the window').toBe(1);
    expect(s.derived.contextFill).toBeLessThan(0.5);
  });
});

test.describe('manual /compact', () => {
  test('hidden until Training unlocks it; then C compacts, keeps more and pauses generation', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    const compactBtn = page.getByTestId(TID.compactButton);
    await expect(compactBtn).toBeHidden();
    await page.keyboard.press('c');
    await frames(page, 2);
    expect((await snap(page)).run.compactions, 'C does nothing before the unlock').toBe(0);

    // Bank the (empty) run and buy /compact in Training.
    await loseRunToTraining(page);
    const node = page.getByTestId(tid(TID.metaBuy, 'unlock_compact'));
    await expect(node).toBeDisabled();
    const cost = META_BY_ID['unlock_compact']!.costs[0]!;
    const thumbs0 = (await snap(page)).meta.thumbs;
    await grantThumbs(page, cost);
    await expect(page.getByTestId(TID.metaThumbs)).toContainText(String(thumbs0 + cost));
    await expect(node).toBeEnabled();
    await node.click();
    await frames(page, 2);
    const bought = await snap(page);
    expect(bought.meta.levels['unlock_compact']).toBe(1);
    expect(bought.meta.thumbs).toBe(thumbs0);

    // A new session from Training: the button is there now.
    await page.getByTestId(TID.metaStart).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    await page.evaluate(() => window.__TOKENMAXXING2__!.startRun(0x7a11));
    await frames(page, 2);
    await expect(compactBtn).toBeVisible();
    await expect(compactBtn).toBeEnabled();

    await holdCards(page, CARDS.slice(0, 2));
    await grant(page, 1_000);
    await setContext(page, 0.6);
    const before = await snap(page);
    expect(before.derived.canCompact).toBe(true);

    await page.keyboard.press('c');
    // Two cards, one slot: the summary picker opens for a manual compaction too.
    await expect(page.getByTestId(TID.summaryModal)).toBeVisible();
    const picking = await snap(page);
    expect(picking.run.summary?.forced).toBe(false);
    await page.getByTestId(TID.summaryConfirm).click();
    await expect(page.getByTestId(TID.summaryModal)).toBeHidden();

    const after = await snap(page);
    expect(after.run.compactions).toBe(1);
    expect(after.run.forcedCompactions, 'manual is not forced').toBe(0);
    expect(after.run.tokens).toBeCloseTo(before.run.tokens * before.derived.compactKeepManual, 6);
    expect(after.derived.compactKeepManual).toBeGreaterThan(after.derived.compactKeepForced);
    expect(after.run.patienceMs, 'no patience cost').toBe(before.run.patienceMs);
    expect(after.run.context).toBeLessThan(before.run.context);
    expect(after.run.cards).toEqual([CARDS[0]]);

    // Generation pauses while it compacts: clicks land on nothing.
    expect(after.run.compactingMs).toBeGreaterThan(0);
    await expect(compactBtn).toBeDisabled();
    const clicks = after.run.clicks;
    await clickAgent(page, 2);
    expect((await snap(page)).run.clicks, 'no generating mid-compaction').toBe(clicks);

    await advanceUntil(page, (s) => s.run.compactingMs <= 0, { what: 'the /compact pause to end' });
    await expect(compactBtn).toBeEnabled();
    await clickAgent(page, 1);
    expect((await snap(page)).run.clicks).toBe(clicks + 1);
    expectClean(w);
  });
});
