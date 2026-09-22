/**
 * The central mechanic: the wallet *is* the ship bar.
 *
 * Click -> slop up -> buy an agent -> slop *down* and the bar visibly shrinks
 * -> idle rate up. If the bar does not move when you spend, the whole design
 * premise is broken, so that assertion is on rendered pixels, not on state.
 */
import { expect, test } from '@playwright/test';
import {
  TID,
  advance,
  agentRow,
  bootPage,
  clickLaptop,
  clickLaptopHook,
  draftCards,
  forceDraft,
  frames,
  grant,
  shipFillWidth,
  snap,
  startRun,
  tid,
  takeCard,
} from './harness.ts';
import { BALANCE, CARD_BY_ID } from '../../src/sim/content.ts';

const TIER1 = 'tab_autocomplete';

test.describe('core loop', () => {
  test('clicking the laptop produces slop', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);

    const before = await snap(page);
    expect(before.run.phase).toBe('running');
    expect(before.run.clicks).toBe(0);

    await clickLaptop(page, 5);

    const after = await snap(page);
    expect(after.run.clicks, 'a real pointer click must reach the laptop hit box').toBe(5);
    expect(after.run.slop).toBeGreaterThan(before.run.slop);
    expect(after.run.slopEarned).toBeGreaterThan(0);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('buying an agent spends slop, shrinks the ship bar and raises idle rate', async ({
    page,
  }) => {
    const w = await bootPage(page);
    await startRun(page);

    // Half a bar of slop so the shrink is unmistakable at any viewport width.
    const req = (await snap(page)).derived.requirement;
    await grant(page, req * 0.5);
    await frames(page, 6); // let the roll-up + width transition settle

    const before = await snap(page);
    const widthBefore = await shipFillWidth(page);
    expect(before.derived.shipProgress).toBeCloseTo(0.5, 2);
    expect(widthBefore).toBeGreaterThan(0);
    expect(before.derived.idleRate).toBe(0);

    const row = agentRow(page, TIER1);
    await expect(row).toBeEnabled();
    const cost = before.derived.nextCosts[TIER1];
    expect(cost).toBeGreaterThan(0);

    await row.click();
    await frames(page, 8);

    const after = await snap(page);
    expect(after.run.agents[TIER1]).toBe(1);
    expect(after.run.slop).toBeCloseTo(before.run.slop - cost, 5);
    expect(after.run.slop).toBeGreaterThanOrEqual(0);
    expect(after.run.slopSpent).toBeCloseTo(cost, 5);
    expect(after.derived.shipProgress).toBeLessThan(before.derived.shipProgress);
    expect(after.derived.idleRate).toBeGreaterThan(before.derived.idleRate);

    // The bar itself, in pixels. 90ms width transition, so poll.
    await expect
      .poll(() => shipFillWidth(page), {
        message: 'the ship bar must visibly shrink when slop is spent',
        timeout: 5_000,
      })
      .toBeLessThan(widthBefore - 1);

    expect(await page.getByTestId(tid(TID.agentOwned, TIER1)).textContent()).toContain('1');
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('idle production accrues over time once agents are owned', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 500);
    await agentRow(page, TIER1).click();
    await frames(page, 4);

    const before = await snap(page);
    expect(before.derived.idleRate).toBeGreaterThan(0);

    await advance(page, 10_000);
    const after = await snap(page);
    const expected = before.run.slop + before.derived.idleRate * 10;
    expect(after.run.slop).toBeCloseTo(expected, 3);
  });

  test('ship: button enables at the requirement, opens the draft, then the project advances', async ({
    page,
  }) => {
    const w = await bootPage(page);
    await startRun(page);

    const shipBtn = page.getByTestId(TID.shipButton);
    await expect(shipBtn).toBeDisabled();

    const start = await snap(page);
    expect(start.run.projectIndex).toBe(0);
    await grant(page, start.derived.requirement);
    await expect(shipBtn).toBeEnabled();

    await shipBtn.click();
    await frames(page, 3);

    // Shipping deducts the requirement and enters the celebration beat. The
    // project index only moves once the draft pick lands (see sim.pickCard).
    const shipped = await snap(page);
    expect(shipped.run.phase).toBe('shipped');
    expect(shipped.run.shipped).toBe(1);
    expect(shipped.run.slop).toBeCloseTo(start.run.slop, 5);
    expect(shipped.run.projectIndex).toBe(0);

    await advance(page, 1200);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    const drafting = await snap(page);
    expect(drafting.run.phase).toBe('drafting');
    expect(drafting.run.draftOffer.length).toBeGreaterThan(0);

    await takeCard(page);
    await frames(page, 4);

    const next = await snap(page);
    expect(next.run.projectIndex, 'project index advances on the draft pick').toBe(1);
    expect(next.derived.requirement).toBeGreaterThan(start.derived.requirement);
    expect(next.run.phase).toBe('running');
    await expect(page.getByTestId(TID.draftModal)).toBeHidden();
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('the requirement grows and the deadline shrinks with each project', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    const p1 = await snap(page);
    await grant(page, p1.derived.requirement);
    await page.getByTestId(TID.shipButton).click();
    await advance(page, 1200);
    await takeCard(page);
    await frames(page, 4);

    const p2 = await snap(page);
    // Read the ratio out of the content — REQ_GROWTH is a balance dial and
    // pinning a literal here just makes every tuning pass break this test.
    expect(p2.derived.requirement / p1.derived.requirement).toBeCloseTo(BALANCE.REQ_GROWTH, 3);
    expect(p2.run.timeLeftMs).toBeLessThan(p1.run.timeLeftMs);
    expect(await page.getByTestId(TID.projectNum).textContent()).toContain('2');
  });

  test('draft offers exactly three cards by default', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const s = await snap(page);
    await grant(page, s.derived.requirement);
    await page.getByTestId(TID.shipButton).click();
    await advance(page, 1200);

    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    await expect(draftCards(page)).toHaveCount(3);
    const offer = (await snap(page)).run.draftOffer;
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size, 'the draft must not offer duplicates').toBe(3);
  });

  test('picking Haiku closes the modal, joins the active strip and cuts agent cost ~60%', async ({
    page,
  }) => {
    await bootPage(page);
    await startRun(page);

    const before = await snap(page);
    const costBefore = before.derived.nextCosts[TIER1];

    await forceDraft(page, ['haiku', 'sonnet', 'opus']);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    await expect(draftCards(page)).toHaveCount(3);

    await takeCard(page, 'haiku');
    await frames(page, 4);

    await expect(page.getByTestId(TID.draftModal)).toBeHidden();
    const after = await snap(page);
    expect(after.run.cards).toContain('haiku');
    await expect(
      page.getByTestId(TID.activeCards).getByTestId(tid('active-card', 'haiku')),
    ).toBeVisible();

    // Haiku is agentCostMult 0.4 -> the next unit costs ~40% of what it did.
    // Costs are rounded to whole slop, so on a small tier-1 base the ratio
    // lands near 0.4 rather than exactly on it; assert the discount, not the
    // rounding. The exact multiplier is covered by the sim unit tests.
    const haiku = CARD_BY_ID['haiku'];
    const mult = (haiku?.effects.find((e) => e.t === 'agentCostMult') as { v: number }).v;
    const ratio = after.derived.nextCosts[TIER1] / costBefore;
    expect(ratio).toBeGreaterThan(mult - 0.05);
    expect(ratio).toBeLessThan(mult + 0.05);
  });

  test('active-cards strip accumulates every card drafted this run', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    await forceDraft(page, ['rubber_duck', 'sonnet', 'haiku']);
    await takeCard(page, 'rubber_duck');
    await frames(page, 3);
    await forceDraft(page, ['vibe_coding', 'sonnet', 'haiku']);
    await takeCard(page, 'sonnet');
    await frames(page, 3);

    const s = await snap(page);
    expect(s.run.cards).toEqual(['rubber_duck', 'sonnet']);
    await expect(
      page.getByTestId(TID.activeCards).locator('[data-testid^="active-card-"]'),
    ).toHaveCount(2);
  });

  test('the shop never sells at a price the sim will not honour', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 1_000);
    await frames(page, 4);

    // Exactly the quoted price: the purchase must succeed, never be denied.
    const s = await snap(page);
    const price = s.derived.nextCosts[TIER1];
    const displayed = await page.getByTestId(tid(TID.agentCost, TIER1)).textContent();
    expect(displayed?.trim()).toBe(String(price));

    await clickLaptopHook(page, 0);
    await agentRow(page, TIER1).click();
    await frames(page, 3);
    const after = await snap(page);
    expect(after.run.agents[TIER1]).toBe(1);
    expect(after.run.slop).toBeCloseTo(1_000 - price, 5);
  });
});
