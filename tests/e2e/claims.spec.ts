/**
 * Reward hacking: CLAIM DONE.
 *
 * One button, three faces. Past the claim threshold it offers to claim, with
 * the live verify chance on it. A claim spends the whole wallet and rolls:
 * not verified is a done prompt plus tech debt; caught costs patience and the
 * prompt stays open. `forceVerify` pins the roll so both branches are
 * deterministic.
 */
import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/sim/content.ts';
import {
  TID,
  advanceUntil,
  bootPage,
  expectClean,
  forceVerify,
  frames,
  grant,
  setPatience,
  snap,
  startRun,
  takeCard,
  type Snap,
} from './harness.ts';

const pct = (f: number): string => `${Math.round(f * 100)}%`;

/** Put the wallet halfway between the claim threshold and the requirement. */
async function fundClaim(page: Page): Promise<Snap> {
  const s = await snap(page);
  const target = s.derived.requirement * ((s.derived.claimThreshold + 1) / 2);
  await grant(page, target - s.run.tokens);
  const after = await snap(page);
  expect(after.derived.reportState).toBe('claim');
  return after;
}

test.describe('claims', () => {
  test('the report button flips WORKING -> CLAIM DONE (with the verify chance) -> REPORT DONE', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    const button = page.getByTestId(TID.reportButton);
    const verify = page.getByTestId(TID.verifyChance);

    await expect(button).toHaveAttribute('data-state', 'working');
    await expect(button).toContainText('WORKING');
    await expect(button).toBeDisabled();
    await expect(verify).toBeHidden();

    // Just under the threshold is still working.
    await grant(page, s0.derived.requirement * s0.derived.claimThreshold * 0.9);
    await expect(button).toHaveAttribute('data-state', 'working');

    const s1 = await fundClaim(page);
    await expect(button).toHaveAttribute('data-state', 'claim');
    await expect(button).toContainText('CLAIM DONE');
    await expect(button).toBeEnabled();
    await expect(verify).toBeVisible();
    await expect(verify).toContainText(pct(s1.derived.verifyChance));
    await expect(button).toHaveAttribute('aria-label', new RegExp(pct(s1.derived.verifyChance)));

    await grant(page, s1.derived.requirement - s1.run.tokens);
    await expect(button).toHaveAttribute('data-state', 'report');
    await expect(button).toContainText('REPORT DONE');
    await expect(verify).toBeHidden();
  });

  test('a claim that passes: wallet spent, prompt done, +1 tech debt, a warier human', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    const before = await fundClaim(page);
    expect(before.run.techDebt).toBe(0);
    await expect(page.getByTestId(TID.techDebt)).toBeHidden();

    await forceVerify(page, 'pass');
    await page.getByTestId(TID.reportButton).click();
    await frames(page, 2);

    const after = await snap(page);
    expect(after.run.phase).toBe('reported');
    expect(after.run.tokens, 'a claim spends the whole wallet').toBe(0);
    expect(after.run.claimed).toBe(1);
    expect(after.run.reported).toBe(1);
    expect(after.run.caught).toBe(0);
    expect(after.run.techDebt).toBe(1);
    // A claim earns the flat per-prompt 👍, never the honest time bonus.
    expect(after.run.pendingThumbs - before.run.pendingThumbs).toBe(BALANCE.THUMBS_PER_REPORT);
    await expect(page.getByTestId(TID.techDebt)).toBeVisible();
    await expect(page.getByTestId(TID.techDebt)).toContainText('1');
    // Tech debt makes incidents likelier, and the HUD says so.
    expect(after.derived.incidentRateMult).toBeGreaterThan(before.derived.incidentRateMult);
    await expect(page.getByTestId(TID.incidentRisk)).toContainText(`×${after.derived.incidentRateMult.toFixed(2)}`);

    // It counted as done: the draft opens and the session moves on.
    await advanceUntil(page, (s) => s.run.phase === 'drafting', { what: 'the draft after a passed claim' });
    await takeCard(page);
    const next = await snap(page);
    expect(next.run.promptIndex).toBe(1);
    expect(next.run.techDebt, 'tech debt lasts the whole run').toBe(1);
    expect(next.derived.verifyChance, 'every claim that gets past the human makes them warier').toBeGreaterThan(
      before.derived.verifyChance,
    );
    expectClean(w);
  });

  test('a caught claim: wallet gone, patience docked, the prompt stays open', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    const before = await fundClaim(page);

    await forceVerify(page, 'catch');
    // S claims too: it does whatever the button says.
    await page.keyboard.press('s');
    await frames(page, 2);

    const after = await snap(page);
    expect(after.run.phase, 'caught is not done').toBe('running');
    expect(after.run.promptIndex).toBe(0);
    expect(after.run.reported).toBe(0);
    expect(after.run.claimed).toBe(0);
    expect(after.run.caught).toBe(1);
    expect(after.run.techDebt).toBe(0);
    expect(after.run.tokens, 'the tokens are gone').toBe(0);
    const docked = (before.run.patienceMs - after.run.patienceMs) / before.derived.patienceMaxMs;
    expect(docked).toBeCloseTo(BALANCE.CAUGHT_PENALTY, 3);
    await expect(page.getByTestId(TID.patienceBar)).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(after.derived.patienceProgress * 100)),
    );
    await expect(page.getByTestId(TID.reportButton)).toHaveAttribute('data-state', 'working');
    await expect(page.getByTestId(TID.toast).last()).toBeVisible();
    expect(after.derived.verifyChance, 'being caught makes the next claim riskier').toBeGreaterThan(
      before.derived.verifyChance,
    );
    // The hidden one for getting caught.
    expect(after.meta.achievements['ran_the_tests']).toBeGreaterThan(0);
    expectClean(w);
  });

  test('getting caught with the human nearly out of patience ends the session', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await fundClaim(page);
    await setPatience(page, BALANCE.CAUGHT_PENALTY / 2);
    await forceVerify(page, 'catch');
    await page.getByTestId(TID.reportButton).click();
    await expect(page.getByTestId(TID.runOverModal)).toBeVisible();
    const s = await snap(page);
    expect(s.run.phase).toBe('lost');
    expect(s.run.patienceMs).toBe(0);
  });

  test('a forced outcome waits for the next claim, and each claim takes its own', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    // Forced before there is anything to claim: it must survive until a claim.
    await forceVerify(page, 'catch');
    await fundClaim(page);
    await page.getByTestId(TID.reportButton).click();
    await frames(page, 2);
    expect((await snap(page)).run.caught).toBe(1);

    await forceVerify(page, 'pass');
    await fundClaim(page);
    await page.getByTestId(TID.reportButton).click();
    await frames(page, 2);
    const s = await snap(page);
    expect(s.run.caught).toBe(1);
    expect(s.run.claimed).toBe(1);
  });
});
