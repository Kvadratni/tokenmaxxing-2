/**
 * Pickups drift across the stage and pay out when clicked. `forcePickup`
 * parks one at a known scene position (it does not drift), and a real mouse
 * click at the matching client position goes through the renderer's
 * `toScene()` mapping, which is the part a unit test cannot reach.
 */
import { expect, test, type Page } from '@playwright/test';
import { PICKUP_BY_ID } from '../../src/sim/content.ts';
import { AGENT_RECT } from '../../src/render/atlas-types.ts';
import {
  TID,
  advanceUntil,
  bootPage,
  expectClean,
  forceIncident,
  forcePickup,
  frames,
  grant,
  sceneToClient,
  setContext,
  setPatience,
  snap,
  startRun,
  toolRow,
  dismissCoach,
  type Snap,
} from './harness.ts';

/** Clear of the agent, the incident banner and the caption. */
const SPOT = { x: 64, y: 70 };

async function collectAt(page: Page, x: number, y: number): Promise<void> {
  // A raw mouse click skips Playwright's overlay handling, so clear the way.
  await dismissCoach(page);
  const p = await sceneToClient(page, x, y);
  await page.mouse.click(p.x, p.y);
  await frames(page, 2);
}

async function forceAndCollect(page: Page, id: string): Promise<{ before: Snap; after: Snap }> {
  await forcePickup(page, id, SPOT.x, SPOT.y);
  const before = await snap(page);
  expect(before.run.pickup?.id).toBe(id);
  await collectAt(page, SPOT.x, SPOT.y);
  const after = await snap(page);
  expect(after.run.pickup, `${id} was collected`).toBeNull();
  return { before, after };
}

test.describe('pickups', () => {
  test('a Golden Token can be clicked on the stage and pays out', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    const { before, after } = await forceAndCollect(page, 'golden_token');
    const pays = PICKUP_BY_ID['golden_token']!.action as { t: string; ofRequirement: number };
    expect(pays.t).toBe('tokens');
    expect(after.run.tokens - before.run.tokens).toBeCloseTo(pays.ofRequirement * before.derived.requirement, 6);
    expect(after.run.clicks, 'collecting is not generating').toBe(before.run.clicks);
    await expect(page.getByTestId(TID.toast).last()).toContainText(PICKUP_BY_ID['golden_token']!.label);
    expectClean(w);
  });

  test('a pickup over the agent wins the click', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const cx = AGENT_RECT.x + AGENT_RECT.w / 2;
    const cy = AGENT_RECT.y + AGENT_RECT.h / 2;
    await forcePickup(page, 'golden_token', cx, cy);
    const before = await snap(page);
    await page.getByTestId(TID.agent).click();
    await frames(page, 2);
    const after = await snap(page);
    expect(after.run.pickup).toBeNull();
    expect(after.run.clicks).toBe(before.run.clicks);
    expect(after.run.tokens).toBeGreaterThan(before.run.tokens);
  });

  test('a miss is just a miss', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forcePickup(page, 'golden_token', SPOT.x, SPOT.y);
    await collectAt(page, SPOT.x + 60, SPOT.y);
    const s = await snap(page);
    expect(s.run.pickup?.id).toBe('golden_token');
    expect(s.run.tokens).toBe(0);
  });

  test('each kind does its thing: context, patience, a buff, a cleanse', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    await setContext(page, 0.6);
    const cache = await forceAndCollect(page, 'cache_hit');
    expect(cache.after.run.context, 'Cache Hit frees context').toBeLessThan(cache.before.run.context);

    await setPatience(page, 0.4);
    const thanks = await forceAndCollect(page, 'thanks_note');
    expect(thanks.after.run.patienceMs, '"thanks!" restores patience').toBeGreaterThan(thanks.before.run.patienceMs);

    await grant(page, 1_000);
    await toolRow(page, 'grep').click();
    const docs = await forceAndCollect(page, 'documentation');
    expect(docs.after.run.incidents.some((i) => i.id === 'pk_docs'), 'Documentation is a timed buff').toBe(true);
    expect(docs.after.derived.idleRate).toBeGreaterThan(docs.before.derived.idleRate);

    await forceIncident(page, 'wait_stop');
    const duck = await forceAndCollect(page, 'rubber_duck');
    expect(duck.before.run.incidents.some((i) => i.id === 'wait_stop')).toBe(true);
    expect(duck.after.run.incidents.some((i) => i.id === 'wait_stop'), 'the duck clears bad incidents').toBe(false);
    expect(duck.after.run.incidents.some((i) => i.id === 'pk_docs'), 'and leaves the good ones').toBe(true);
  });

  test('an ignored pickup expires', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forcePickup(page, 'golden_token', SPOT.x, SPOT.y);
    await advanceUntil(page, (s) => s.run.pickup === null, { step: 250, maxMs: 20_000, what: 'the pickup to expire' });
    await collectAt(page, SPOT.x, SPOT.y);
    expect((await snap(page)).run.tokens).toBe(0);
  });
});
