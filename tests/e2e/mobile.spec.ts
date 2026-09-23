/**
 * The phone. Runs only in the `mobile` project (390x844, touch, isMobile,
 * pointer: coarse), selected by the `@mobile` tag in each title.
 *
 * `tap()`, not `click()`: Playwright's click sends mouse events even in a
 * touch context, which would hide a dead touch surface.
 */
import { expect, test } from '@playwright/test';
import { AGENT_RECT } from '../../src/render/atlas-types.ts';
import {
  TID,
  advanceUntil,
  bootPage,
  drainCoach,
  expectAgentAligned,
  expectClean,
  frames,
  fundReport,
  grant,
  hOverflow,
  sceneToClient,
  snap,
  startRun,
  takeCard,
  toolRow,
} from './harness.ts';

const MIN_TAP = 44;

test.describe('phone @mobile', () => {
  test('tapping the agent generates tokens @mobile', async ({ page }) => {
    const w = await bootPage(page);
    const before = await startRun(page);
    const agent = page.getByTestId(TID.agent);
    for (let i = 0; i < 5; i++) await agent.tap();
    await frames(page, 2);
    const after = await snap(page);
    expect(after.run.clicks, 'taps must register as clicks').toBe(5);
    expect(after.run.tokens).toBeGreaterThan(before.run.tokens);
    expectClean(w);
  });

  test('the report button is on screen and a thumb-sized target @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await drainCoach(page);
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    for (const id of [TID.reportButton, TID.agent, TID.sycophancyButton]) {
      const el = page.getByTestId(id);
      await expect(el, `${id} is visible`).toBeVisible();
      await expect(el, `${id} is on screen without scrolling`).toBeInViewport();
      const box = (await el.boundingBox())!;
      expect(box.height, `${id} is ${box.height}px tall`).toBeGreaterThanOrEqual(MIN_TAP);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
    }
    const agent = (await page.getByTestId(TID.agent).boundingBox())!;
    expect(agent.width).toBeGreaterThanOrEqual(MIN_TAP);

    // And it works by touch.
    await fundReport(page);
    await page.getByTestId(TID.reportButton).tap();
    await frames(page, 2);
    expect((await snap(page)).run.reported).toBe(1);
  });

  test('no horizontal overflow on the title, the run, the draft, run over or Training @mobile', async ({ page }) => {
    await bootPage(page);
    expect(await hOverflow(page), 'title').toBeLessThanOrEqual(0);

    await startRun(page);
    expect(await hOverflow(page), 'run').toBeLessThanOrEqual(0);
    await grant(page, 1_000);
    await toolRow(page, 'grep').tap();
    expect(await hOverflow(page), 'run with a tool').toBeLessThanOrEqual(0);

    await fundReport(page);
    await page.getByTestId(TID.reportButton).tap();
    await advanceUntil(page, (s) => s.run.phase === 'drafting', { what: 'the draft' });
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    expect(await hOverflow(page), 'draft').toBeLessThanOrEqual(0);
    await takeCard(page);

    await page.evaluate(() => window.__TOKENMAXXING2__!.setPatience(0));
    await expect(page.getByTestId(TID.runOverModal)).toBeVisible();
    expect(await hOverflow(page), 'run over').toBeLessThanOrEqual(0);
    await page.getByTestId(TID.runOverContinue).tap();
    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
    expect(await hOverflow(page), 'Training').toBeLessThanOrEqual(0);
  });

  test('the shop is reachable in portrait and a tool can be bought by tap @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 1_000);
    const row = toolRow(page, 'grep');
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    await frames(page, 2);
    expect((await snap(page)).run.tools.grep).toBe(1);
  });

  test('on its side the shop is a drawer: open, buy, close @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await frames(page, 6);
    const toggle = page.getByTestId(TID.shopToggle);
    await expect(toggle, 'a landscape phone is short, so the shop becomes a drawer').toBeVisible();
    expect(await hOverflow(page)).toBeLessThanOrEqual(0);

    await grant(page, 1_000);
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const row = toolRow(page, 'grep');
    await expect(row).toBeInViewport();
    await row.tap();
    await frames(page, 2);
    expect((await snap(page)).run.tools.grep).toBe(1);

    // Escape hands the board back: a tap on the agent the canvas draws counts.
    // (Tapped at its drawn centre, not at `agent-hit`: see the fixme below.)
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await drainCoach(page);
    const c = await sceneToClient(page, AGENT_RECT.x + AGENT_RECT.w / 2, AGENT_RECT.y + AGENT_RECT.h / 2);
    await page.touchscreen.tap(c.x, c.y);
    await frames(page, 2);
    expect((await snap(page)).run.clicks).toBe(1);
  });

  // Regression guard (was a bug, now fixed): on a DPR >= 2 phone the UI's --px is fractional (src/ui/scale.ts:110-111)
  // and `agent-hit` is positioned in --px units (src/styles/ui.css:1017-1020),
  // but the renderer draws the canvas at an integer scale with a pinned inline
  // size, centred in the stage (src/render/canvas.ts:40, :201-204). Portrait
  // 390x844: the box is 16px low and 9px too tall. On its side (844x390) it is
  // 51px low: its centre maps to scene y=201, off the bottom of the 180-tall
  // scene, so tapping the agent's own hit box does nothing and its focus ring
  // is drawn under the agent. Expected: agent-hit covers the drawn agent.
  test('the agent hit box sits over the drawn agent, upright and on its side @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await expectAgentAligned(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await frames(page, 6);
    await expectAgentAligned(page);
    await page.getByTestId(TID.agent).tap();
    await frames(page, 2);
    expect((await snap(page)).run.clicks).toBe(1);
  });
});
