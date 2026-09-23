/**
 * A session end to end: the human's patience is the only clock that ends a
 * run. Run over banks the 👍, Training spends them, and a new session starts
 * as the next model release. Plus the other ending: ten prompts shipped.
 */
import { expect, test } from '@playwright/test';
import { FINAL_PROMPT_INDEX, META_UPGRADES } from '../../src/sim/content.ts';
import {
  TID,
  advance,
  advanceUntil,
  bootPage,
  expectClean,
  frames,
  fundReport,
  reportAndTake,
  snap,
  startRun,
  takeCard,
} from './harness.ts';

const clock = (ms: number): string => {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

test.describe('the human is watching', () => {
  test('patience drains in sim time and the HUD follows it', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    expect(s0.run.patienceMs).toBeCloseTo(s0.derived.patienceMaxMs, 6);
    await expect(page.getByTestId(TID.patienceText)).toHaveText(clock(s0.run.patienceMs));
    await expect(page.getByTestId(TID.patienceBar)).toHaveAttribute('aria-valuenow', '100');

    // Frozen real time really is frozen.
    await page.waitForTimeout(400);
    expect((await snap(page)).run.patienceMs).toBe(s0.run.patienceMs);

    await advance(page, 10_000);
    const s1 = await snap(page);
    expect(s0.run.patienceMs - s1.run.patienceMs).toBeCloseTo(10_000, 3);
    await expect(page.getByTestId(TID.patienceText)).toHaveText(clock(s1.run.patienceMs));
    await expect(page.getByTestId(TID.patienceBar)).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(s1.derived.patienceProgress * 100)),
    );
  });

  test('patience runs out: run over, then Training, then a new session', async ({ page }) => {
    const w = await bootPage(page);
    const first = await startRun(page);
    // Report one prompt so there is something to bank.
    await reportAndTake(page);
    const mid = await snap(page);
    expect(mid.run.pendingThumbs).toBeGreaterThan(0);

    // Let the clock run out for real (an incident may pause it; keep going).
    const lost = await advanceUntil(page, (s) => s.run.phase === 'lost', {
      step: 2_000,
      maxMs: mid.derived.patienceMaxMs * 4,
      what: 'the human to run out of patience',
    });
    expect(lost.run.patienceMs).toBe(0);
    expect(lost.meta.runs).toBe(1);
    expect(lost.meta.wins).toBe(0);
    expect(lost.meta.thumbs, 'the tally is banked at run end').toBe(mid.derived.thumbsIfEndedNow);
    expect(lost.meta.bestPrompt).toBe(0);

    const over = page.getByTestId(TID.runOverModal);
    await expect(over).toBeVisible();
    await expect(page.getByTestId(TID.runOverTitle)).toBeVisible();
    await expect(page.getByTestId(TID.runOverThumbs)).toContainText(String(lost.meta.thumbs));
    await expect(page.getByTestId(TID.runOverVersion)).toBeVisible();
    const announced = (await page.getByTestId(TID.runOverVersion).textContent()) ?? '';
    await expect(page.getByTestId(TID.runOverCarry)).toBeVisible();
    // A mandatory stop: Escape does not dismiss it.
    await page.keyboard.press('Escape');
    await expect(over).toBeVisible();
    await expect(page.getByTestId(TID.runOverContinue)).toBeFocused();

    await page.getByTestId(TID.runOverContinue).click();
    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
    await expect(over).toBeHidden();
    expect((await snap(page)).screen).toBe('meta');
    await expect(page.getByTestId(TID.metaThumbs)).toContainText(String(lost.meta.thumbs));

    // Training's own start button: the next release plays the next session.
    await page.getByTestId(TID.metaStart).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    const next = await snap(page);
    expect(next.screen).toBe('run');
    expect(next.run.phase).toBe('running');
    expect(next.run.promptIndex).toBe(0);
    expect(next.run.reported).toBe(0);
    expect(next.run.cards).toEqual([]);
    expect(next.derived.modelVersion, 'every run is a new model release').not.toBe(first.derived.modelVersion);
    await expect(page.getByTestId(TID.modelVersion)).toHaveText(next.derived.modelVersion);
    expect(announced, 'run over announced the release that then played').toContain(next.derived.modelVersion);
    expectClean(w);
  });

  test('Training has a way back to the title, which now shows lifetime stats', async ({ page }) => {
    await bootPage(page);
    await expect(page.getByTestId(TID.titleStats)).toBeHidden();
    await startRun(page);
    await page.evaluate(() => window.__TOKENMAXXING2__!.setPatience(0));
    await page.getByTestId(TID.runOverContinue).click();
    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();

    await page.getByTestId(TID.metaBack).click();
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
    await expect(page.getByTestId(TID.titleStats)).toBeVisible();
    await expect(page.getByTestId(TID.titleStats)).toContainText('1');

    // And Escape leaves Training too.
    await page.getByTestId(TID.titleMeta).click();
    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
  });

  test('ten prompts shipped: the run is won and the win is banked', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    for (let i = 0; i < FINAL_PROMPT_INDEX; i++) {
      await reportAndTake(page);
      expect((await snap(page)).run.promptIndex).toBe(i + 1);
    }
    // The last prompt: no draft after it, just the ending.
    await fundReport(page);
    await page.getByTestId(TID.reportButton).click();
    const won = await advanceUntil(page, (s) => s.run.phase === 'won', { what: 'the win' });
    expect(won.run.reported).toBe(FINAL_PROMPT_INDEX + 1);
    expect(won.meta.wins).toBe(1);
    expect(won.meta.runs).toBe(1);
    expect(won.meta.bestPrompt).toBe(FINAL_PROMPT_INDEX);
    expect(won.meta.achievements['shipped_to_prod']).toBeGreaterThan(0);
    expect(won.meta.achievements['honest_work'], 'no claims were made').toBeGreaterThan(0);
    await expect(page.getByTestId(TID.runOverModal)).toBeVisible();
    await expect(page.getByTestId(TID.runOverThumbs)).toContainText(String(won.meta.thumbs));
    expect(won.meta.thumbs).toBeGreaterThan(FINAL_PROMPT_INDEX);
    await frames(page, 2);
    expectClean(w);
  });

  test('Endless Mode: prompt ten is the win on the spot, then the human types "continue"', async ({ page }) => {
    // A fully trained model, as a trusted (unsigned) save.
    const levels = Object.fromEntries(META_UPGRADES.map((d) => [d.id, d.maxLevel]));
    const w = await bootPage(page, {
      save: JSON.stringify({ version: 1, levels, runs: 3, wins: 1, legacy: { verdict: 'none' } }),
    });
    await startRun(page);
    for (let i = 0; i < FINAL_PROMPT_INDEX; i++) await reportAndTake(page);

    // The tenth: counted as a win right away, and still a draft after it.
    await fundReport(page);
    await page.getByTestId(TID.reportButton).click();
    const drafting = await advanceUntil(page, (s) => s.run.phase === 'drafting', { what: 'the draft after prompt ten' });
    expect(drafting.meta.wins, 'the win is recorded at prompt ten').toBe(2);
    expect(drafting.meta.runs).toBe(4);
    expect(drafting.meta.achievements['shipped_to_prod']).toBeGreaterThan(0);
    await takeCard(page);

    const cont = await snap(page);
    expect(cont.run.phase).toBe('running');
    expect(cont.run.promptIndex).toBe(FINAL_PROMPT_INDEX + 1);
    await expect(page.getByTestId(TID.promptNum)).toHaveText(`PROMPT ${FINAL_PROMPT_INDEX + 2}`);
    await expect(page.getByTestId(TID.promptText)).toContainText('continue');

    // Running out of patience later still ends a won session, counted once.
    await page.evaluate(() => window.__TOKENMAXXING2__!.setPatience(0));
    await expect(page.getByTestId(TID.runOverModal)).toBeVisible();
    const over = await snap(page);
    expect(over.run.phase).toBe('won');
    expect(over.meta.wins).toBe(2);
    expect(over.meta.runs, 'the run is not counted twice').toBe(4);
    expect(over.meta.bestPrompt).toBeGreaterThanOrEqual(FINAL_PROMPT_INDEX);
    expectClean(w);
  });

  test('the draft and the report beat hold the clock', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await fundReport(page);
    await page.getByTestId(TID.reportButton).click();
    const drafting = await advanceUntil(page, (s) => s.run.phase === 'drafting', { what: 'the draft' });
    await advance(page, 30_000);
    const held = await snap(page);
    expect(held.run.phase).toBe('drafting');
    expect(held.run.patienceMs, 'no patience burns while the human is prompt engineering').toBe(
      drafting.run.patienceMs,
    );
    await takeCard(page);
  });
});
