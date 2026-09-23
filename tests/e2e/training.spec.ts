/**
 * Training, the meta tree bought with 👍: unlocks add content to every later
 * session, levels raise numbers, and the tree's edges are real gates.
 */
import { expect, test, type Page } from '@playwright/test';
import { META_BY_ID } from '../../src/sim/content.ts';
import {
  TID,
  advanceUntil,
  bootPage,
  expectClean,
  frames,
  fundReport,
  grant,
  grantThumbs,
  loseRunToTraining,
  snap,
  startRun,
  takeCard,
  tid,
  toolRow,
} from './harness.ts';

const LADDER = ['grep', 'read', 'edit', 'bash'] as const;
const cost = (id: string): number => META_BY_ID[id]!.costs[0]!;

/** Buy one of each rung through the real rows, granting exactly what each costs. */
async function climb(page: Page, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const s = await snap(page);
    const price = s.derived.nextCosts[id as keyof typeof s.derived.nextCosts];
    if (s.run.tokens < price) await grant(page, price - s.run.tokens);
    await toolRow(page, id).click();
    await frames(page, 2);
  }
}

/** Buy a Training node through its button, from the Training screen. */
async function train(page: Page, id: string): Promise<void> {
  const node = page.getByTestId(tid(TID.metaBuy, id));
  await expect(node, `${id} is buyable`).toBeEnabled();
  await node.click();
  await frames(page, 2);
  expect((await snap(page)).meta.levels[id], `${id} was trained`).toBeGreaterThan(0);
}

test.describe('Training', () => {
  test('tool 5 is locked until Training unlocks it, then it is on the rail', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    await climb(page, LADDER);
    await grant(page, 1e9);
    const web = toolRow(page, 'web_search');
    await expect(web, 'Web Search is previewed on the rail').toBeVisible();
    await expect(web, 'but not for sale before Training unlocks it').toBeDisabled();
    await web.click({ force: true });
    await frames(page, 2);
    expect((await snap(page)).run.tools.web_search).toBe(0);

    await loseRunToTraining(page);
    await grantThumbs(page, cost('unlock_web'));
    await train(page, 'unlock_web');
    await page.getByTestId(TID.metaStart).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    await page.evaluate(() => window.__TOKENMAXXING2__!.startRun(0x7a11));
    await frames(page, 2);

    await climb(page, [...LADDER, 'web_search']);
    expect((await snap(page)).run.tools.web_search).toBe(1);
    expectClean(w);
  });

  test('edges are gates: a node stays shut until its parent is owned', async ({ page }) => {
    await bootPage(page);
    await grantThumbs(page, cost('prompt_library') + cost('temperature'));
    await page.getByTestId(TID.titleMeta).click();
    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
    const child = page.getByTestId(tid(TID.metaBuy, 'temperature'));
    await expect(child, 'enough 👍, but the parent is not owned').toBeDisabled();
    await train(page, 'prompt_library');
    await expect(child).toBeEnabled();
    const before = (await snap(page)).meta.thumbs;
    await train(page, 'temperature');
    const after = await snap(page);
    expect(after.meta.thumbs).toBe(before - cost('temperature'));
    await expect(page.getByTestId(TID.metaThumbs)).toContainText(String(after.meta.thumbs));
  });

  test('Temperature buys a reroll: the draft can be rephrased once', async ({ page }) => {
    const w = await bootPage(page);
    await grantThumbs(page, cost('prompt_library') + cost('temperature'));
    await page.getByTestId(TID.titleMeta).click();
    await train(page, 'prompt_library');
    await train(page, 'temperature');
    await page.getByTestId(TID.metaStart).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    await page.evaluate(() => window.__TOKENMAXXING2__!.startRun(0x7a11));
    await frames(page, 2);

    await fundReport(page);
    await page.getByTestId(TID.reportButton).click();
    const open = await advanceUntil(page, (s) => s.run.phase === 'drafting', { what: 'the draft' });
    expect(open.run.draftRerollsLeft).toBe(1);
    const reroll = page.getByTestId(TID.draftReroll);
    await expect(page.getByTestId(TID.draftRerollCount)).toHaveText('1');
    await expect(reroll).toBeEnabled();
    await reroll.click();
    await frames(page, 2);
    const rerolled = await snap(page);
    expect(rerolled.run.phase).toBe('drafting');
    expect(rerolled.run.draftRerollsLeft).toBe(0);
    expect(rerolled.run.draftOffer.length).toBeGreaterThan(0);
    await expect(page.getByTestId(TID.draftRerollCount)).toHaveText('0');
    await expect(reroll).toBeDisabled();
    const picked = await takeCard(page);
    expect(rerolled.run.draftOffer).toContain(picked);
    expectClean(w);
  });
});
