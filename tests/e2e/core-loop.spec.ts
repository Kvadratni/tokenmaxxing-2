/**
 * The core loop: generate tokens, buy tools, report done, get prompt
 * engineered, move on to a harder prompt.
 *
 * The wallet is the report bar, so spending visibly pushes you away from
 * reporting. That is asserted on the rendered bar, not just on state.
 */
import { expect, test } from '@playwright/test';
import { formatTokens } from '../../src/sim/format.ts';
import {
  TID,
  activeCards,
  advance,
  advanceUntil,
  bootPage,
  clickAgent,
  draftCards,
  expectClean,
  frames,
  fundReport,
  grant,
  reportAndOpenDraft,
  snap,
  startRun,
  takeCard,
  tid,
  toolRow,
} from './harness.ts';

const TIER1 = 'grep';

test.describe('core loop', () => {
  test('clicking the agent generates tokens and fills the context window', async ({ page }) => {
    const w = await bootPage(page);
    const before = await startRun(page);
    expect(before.run.clicks).toBe(0);
    expect(before.run.tokens).toBe(0);

    await clickAgent(page, 5);

    const after = await snap(page);
    expect(after.run.clicks, 'a real pointer click must reach the agent hit box').toBe(5);
    // Crits are seeded, not guaranteed: bound the payout rather than pin it.
    const per = before.derived.clickPower;
    expect(after.run.tokensEarned).toBeGreaterThanOrEqual(5 * per);
    expect(after.run.tokensEarned).toBeLessThanOrEqual(5 * per * before.derived.critMult);
    expect(after.run.tokens).toBeCloseTo(after.run.tokensEarned, 6);
    // Every turn of output lands in the window.
    expect(after.run.context - before.run.context).toBeCloseTo(5 * before.derived.clickContext, 6);

    // The HUD reads the same wallet (it rolls up over a quarter second).
    await expect(page.getByTestId(TID.tokens)).toHaveText(formatTokens(after.run.tokens));
    await expect(page.getByTestId(TID.contextBar)).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(after.derived.contextFill * 100)),
    );
    expectClean(w);
  });

  test('Space generates from anywhere on the run screen; Enter while the agent has focus', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    // Focus somewhere that is not the agent: Space must still generate, and
    // must not activate the focused button.
    await page.getByTestId(TID.tabUpgrades).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await frames(page, 2);
    let s = await snap(page);
    expect(s.run.clicks).toBe(2);
    await expect(page.getByTestId(TID.tabUpgrades)).toHaveAttribute('aria-selected', 'false');

    await page.getByTestId(TID.agent).focus();
    await page.keyboard.press('Enter');
    await frames(page, 2);
    s = await snap(page);
    expect(s.run.clicks).toBe(3);
    expect(s.run.tokens).toBeGreaterThan(0);
  });

  test('buying a tool: a row click spends the quoted price, then hotkey 1 buys another', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    const start = await snap(page);
    // Three units' worth: both purchases are affordable at the quoted prices.
    const cost1 = start.derived.nextCosts[TIER1];
    const wallet = cost1 * 3;
    await grant(page, wallet);

    const before = await snap(page);
    expect(before.derived.idleRate).toBe(0);
    await expect(page.getByTestId(tid(TID.toolCost, TIER1))).toHaveText(formatTokens(cost1));
    const row = toolRow(page, TIER1);
    await expect(row).toBeEnabled();

    await row.click();
    await frames(page, 2);
    const one = await snap(page);
    expect(one.run.tools[TIER1]).toBe(1);
    expect(one.run.tokens).toBeCloseTo(wallet - cost1, 6);
    expect(one.run.tokensSpent).toBeCloseTo(cost1, 6);
    expect(one.derived.idleRate).toBeGreaterThan(0);
    // The footprint is the second price: context per second while it runs.
    expect(one.derived.contextRate).toBeCloseTo(one.derived.toolFootprint[TIER1], 6);
    expect(one.derived.nextCosts[TIER1]).toBeGreaterThan(cost1);
    await expect(page.getByTestId(tid(TID.toolOwned, TIER1))).toContainText('1');

    // Hotkey 1: the first visible tool, at the quoted price.
    const cost2 = one.derived.nextCosts[TIER1];
    await page.keyboard.press('1');
    await frames(page, 2);
    const two = await snap(page);
    expect(two.run.tools[TIER1]).toBe(2);
    expect(two.run.tokens).toBeCloseTo(wallet - cost1 - cost2, 6);
    expect(two.derived.idleRate).toBeCloseTo(2 * one.derived.idleRate, 6);
    // Owning one reveals the next rung: it is priced now, and buyable once affordable.
    await expect(page.getByTestId(tid(TID.toolCost, 'read'))).toHaveText(formatTokens(two.derived.nextCosts.read));
    await grant(page, two.derived.nextCosts.read);
    await expect(toolRow(page, 'read')).toBeEnabled();
    expectClean(w);
  });

  test('the wallet is the report bar: buying visibly shrinks it', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    await grant(page, s0.derived.requirement * 0.6);
    const fill = page.getByTestId(TID.reportBarFill);
    await expect(page.getByTestId(TID.reportBar)).toHaveAttribute('aria-valuenow', '60');
    await page.waitForTimeout(300); // width transition
    const wBefore = (await fill.boundingBox())!.width;
    expect(wBefore).toBeGreaterThan(0);

    await toolRow(page, TIER1).click();
    const after = await snap(page);
    expect(after.derived.reportProgress).toBeLessThan(0.6);
    await expect(page.getByTestId(TID.reportBar)).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(after.derived.reportProgress * 100)),
    );
    await expect
      .poll(async () => (await fill.boundingBox())!.width, { message: 'the report bar must shrink when tokens are spent' })
      .toBeLessThan(wBefore - 1);
  });

  test('tools produce on their own: advance() accrues tokens and context at the quoted rates', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 1_000);
    await toolRow(page, TIER1).click();
    await toolRow(page, TIER1).click();
    const before = await snap(page);
    expect(before.run.tools[TIER1]).toBe(2);

    await advance(page, 4_000);
    const after = await snap(page);
    expect(after.run.tokens - before.run.tokens).toBeCloseTo(before.derived.idleRate * 4, 3);
    expect(after.run.context - before.run.context).toBeCloseTo(before.derived.contextRate * 4, 3);
    expect(after.run.patienceMs).toBeCloseTo(before.run.patienceMs - 4_000, 3);
  });

  test('×10 buys ten at the quoted bulk price; the toggle cycles ×1, ×10, ×100', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    const toggle = page.getByTestId(TID.buyQtyToggle);
    await expect(toggle).toHaveText('×1');
    await toggle.click();
    await expect(toggle).toHaveText('×10');

    await grant(page, s0.derived.nextCosts[TIER1] * 100);
    const before = await snap(page);
    const quoted = (await page.getByTestId(tid(TID.toolCost, TIER1)).textContent())?.trim() ?? '';
    await toolRow(page, TIER1).click();
    await frames(page, 2);
    const after = await snap(page);
    expect(after.run.tools[TIER1]).toBe(10);
    expect(formatTokens(before.run.tokens - after.run.tokens)).toBe(quoted);

    await toggle.click();
    await expect(toggle).toHaveText('×100');
    await toggle.click();
    await expect(toggle).toHaveText('×1');
  });

  test('×100 stops at the tier cap: it buys what fits, then the row reads maxed and refuses', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    const cap = s0.derived.headroom[TIER1];
    expect(cap).toBeGreaterThan(0);
    const toggle = page.getByTestId(TID.buyQtyToggle);
    await toggle.click();
    await toggle.click();
    await expect(toggle).toHaveText('×100');
    await grant(page, 1e15);
    // The price is quoted for what fits, not for a hundred.
    await expect(page.getByTestId(tid(TID.toolCost, TIER1))).toContainText(`(${cap})`);
    await toolRow(page, TIER1).click();
    await frames(page, 2);
    const s1 = await snap(page);
    expect(s1.run.tools[TIER1]).toBe(cap);
    expect(s1.derived.headroom[TIER1]).toBe(0);
    await expect(toolRow(page, TIER1)).toBeDisabled();
    const spent = s1.run.tokensSpent;
    await page.keyboard.press('1');
    await frames(page, 2);
    const s2 = await snap(page);
    expect(s2.run.tools[TIER1]).toBe(cap);
    expect(s2.run.tokensSpent).toBe(spent);
  });

  // BUG (src/ui/shop.ts:204-207): `buyVisibleIndex` toasts "Not enough tokens"
  // for any disabled row, so pressing 1 on a maxed tool with 1e15 tokens in the
  // wallet claims you are broke. Expected: say the tool is maxed (or nothing).
  test('a hotkey on a maxed tool does not claim the wallet is short', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const toggle = page.getByTestId(TID.buyQtyToggle);
    await toggle.click();
    await toggle.click();
    await grant(page, 1e15);
    await toolRow(page, TIER1).click();
    await expect(toolRow(page, TIER1)).toBeDisabled();
    await page.keyboard.press('1');
    await frames(page, 3);
    const said = await page.getByTestId(TID.toast).allTextContents();
    expect(said, 'a maxed tool is not an empty wallet').not.toContain('Not enough tokens');
  });

  test('the Upgrades tab sells one-offs: Streaming raises click power', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    await page.getByTestId(TID.tabUpgrades).click();
    await expect(page.getByTestId(TID.tabUpgrades)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(TID.upgradeList)).toBeVisible();
    await expect(page.getByTestId(TID.toolList)).toBeHidden();
    const row = page.getByTestId(tid(TID.upgradeRow, 'streaming'));
    await expect(row).toBeVisible();
    await expect(row).toBeDisabled();
    await grant(page, 10_000);
    await expect(row).toBeEnabled();
    await row.click();
    await frames(page, 2);
    const s1 = await snap(page);
    expect(s1.run.owned).toContain('streaming');
    expect(s1.derived.clickPower).toBeGreaterThan(s0.derived.clickPower);
    await expect(page.getByTestId(TID.clickPower)).toContainText(String(s1.derived.clickPower));
    // Bought once, gone from the list.
    await expect(row).toHaveCount(0);
  });

  test('report, a two-step draft, then the next prompt', async ({ page }) => {
    const w = await bootPage(page);
    const p1 = await startRun(page);
    const button = page.getByTestId(TID.reportButton);
    await expect(button).toHaveAttribute('data-state', 'working');
    await expect(button).toBeDisabled();
    await expect(page.getByTestId(TID.promptNum)).toHaveText('PROMPT 1/10');

    const funded = await fundReport(page);
    await expect(button).toHaveAttribute('data-state', 'report');
    await expect(button).toBeEnabled();
    await button.click();
    await frames(page, 2);

    // Reporting spends the requirement and enters the celebration beat. The
    // prompt only advances once the draft pick lands.
    const reported = await snap(page);
    expect(reported.run.phase).toBe('reported');
    expect(reported.run.reported).toBe(1);
    expect(reported.run.tokens).toBeCloseTo(funded.run.tokens - funded.derived.requirement, 6);
    expect(reported.run.promptIndex).toBe(0);
    expect(reported.run.pendingThumbs).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId(TID.thumbsTally)).toContainText(String(reported.derived.thumbsIfEndedNow));
    await expect(button).toBeDisabled();

    const drafting = await advanceUntil(page, (s) => s.run.phase === 'drafting', { what: 'the draft' });
    const modal = page.getByTestId(TID.draftModal);
    await expect(modal).toBeVisible();
    const offer = drafting.run.draftOffer;
    expect(offer.length).toBeGreaterThan(1);
    expect(new Set(offer).size, 'the draft must not offer duplicates').toBe(offer.length);
    await expect(draftCards(page)).toHaveCount(offer.length);
    // A fresh save has no rerolls.
    await expect(page.getByTestId(TID.draftRerollCount)).toHaveText(String(drafting.run.draftRerollsLeft));
    await expect(page.getByTestId(TID.draftReroll)).toBeDisabled();

    // Two-step: a click only highlights. Nothing is picked until Confirm.
    const confirm = page.getByTestId(TID.draftConfirm);
    await expect(confirm).toBeDisabled();
    const pick = offer[1]!;
    await page.getByTestId(tid(TID.draftCard, pick)).click();
    await expect(page.getByTestId(tid(TID.draftCard, pick))).toHaveAttribute('aria-pressed', 'true');
    await frames(page, 2);
    expect((await snap(page)).run.phase, 'a click must not commit the pick').toBe('drafting');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(modal).toBeHidden();

    const p2 = await snap(page);
    expect(p2.run.phase).toBe('running');
    expect(p2.run.promptIndex).toBe(1);
    expect(p2.run.cards).toEqual([pick]);
    await expect(activeCards(page)).toHaveCount(1);
    await expect(page.getByTestId(tid(TID.activeCard, pick))).toBeVisible();
    await expect(page.getByTestId(TID.promptNum)).toHaveText('PROMPT 2/10');
    // Harder prompt, less patient human, and a full bar to start it on.
    expect(p2.derived.requirement).toBeGreaterThan(p1.derived.requirement);
    expect(p2.derived.patienceMaxMs).toBeLessThanOrEqual(p1.derived.patienceMaxMs);
    expect(p2.run.patienceMs).toBeCloseTo(p2.derived.patienceMaxMs, 6);
    expectClean(w);
  });

  test('S reports when the button is live, and says why when it is not', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    await page.keyboard.press('s');
    await frames(page, 2);
    expect((await snap(page)).run.reported, 'S with an empty wallet must not report').toBe(0);
    await expect(page.getByTestId(TID.toast).last()).toBeVisible();

    await fundReport(page);
    await page.keyboard.press('s');
    await frames(page, 2);
    const s = await snap(page);
    expect(s.run.reported).toBe(1);
    expect(s.run.phase).toBe('reported');
  });

  test('the draft keeps each card once and the strip accumulates picks', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const first = await (async () => {
      await reportAndOpenDraft(page);
      return takeCard(page);
    })();
    await reportAndOpenDraft(page);
    const offer = (await snap(page)).run.draftOffer;
    expect(offer, 'a held card is not offered again').not.toContain(first);
    const second = await takeCard(page);
    const s = await snap(page);
    expect(s.run.cards).toEqual([first, second]);
    await expect(activeCards(page)).toHaveCount(2);
    expect(s.run.promptIndex).toBe(2);
  });
});
