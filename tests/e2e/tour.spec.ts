/**
 * The first-run tour: the first NEW SESSION a browser ever presses opens on a
 * spotlight tour with the clock held, one step at a time.
 *
 * Every other spec boots with the tour marked seen (the harness does it); these
 * boot with `tour: true` to meet it. Real time runs here (no `setTimeScale(0)`):
 * the whole point is that the tour, not the spec, stops the clock.
 *
 * The steps are read out of src/ui/tour-steps.ts, the same list the game runs.
 */
import { expect, test, type Page } from '@playwright/test';
import { TOUR_CLICKS, TOUR_STEPS, type TourStep } from '../../src/ui/tour-steps.ts';
import {
  TID,
  TOUR_KEY,
  bootPage,
  expectClean,
  focused,
  frames,
  loseRunToTraining,
  snap,
  tid,
} from './harness.ts';

const card = (page: Page, id: string) => page.getByTestId(tid(TID.tourStep, id));
const tourSeenFlag = (page: Page): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), TOUR_KEY);

/** Patience drains again: the clock is back in the sim's hands. */
async function expectClockRunning(page: Page): Promise<void> {
  const s0 = await snap(page);
  await expect.poll(async () => (await snap(page)).run.patienceMs, { timeout: 10_000 }).toBeLessThan(s0.run.patienceMs);
}

test.describe('the first-run tour', () => {
  test('on a fresh save, NEW SESSION opens it and the human waits: no drain in 3s', async ({ page }) => {
    const w = await bootPage(page, { tour: true });
    await page.getByTestId(TID.startRun).click();
    await expect(page.getByTestId(TID.tour)).toBeVisible();
    await expect(card(page, 'intro')).toBeVisible();
    await expect(page.getByTestId(TID.tourNext)).toBeFocused();

    const before = await snap(page);
    expect(before.screen).toBe('run');
    expect(before.run.phase).toBe('running');
    await page.waitForTimeout(3_000);
    const after = await snap(page);
    expect(after.run.patienceMs, 'patience drained under the tour').toBe(before.run.patienceMs);
    expect(after.run.elapsedMs).toBe(before.run.elapsedMs);
    expectClean(w);
  });

  test('walking every step ends on a running session, with the clock going', async ({ page }) => {
    const w = await bootPage(page, { tour: true });
    await page.getByTestId(TID.startRun).click();
    for (const [i, step] of TOUR_STEPS.entries()) {
      const c = card(page, step.id);
      await expect(c, step.id).toBeVisible();
      await expect(c).toContainText(`${i + 1}/${TOUR_STEPS.length}`);
      await expect(c).toContainText(step.title);
      if (step.clicks !== undefined) {
        // "Try it": real clicks on the agent, which the sim takes with time held.
        await expect(c).toContainText(`0/${step.clicks}`);
        const agent = page.getByTestId(TID.agent);
        for (let k = 1; k < step.clicks; k++) await agent.click();
        await expect(c).toContainText(`${step.clicks - 1}/${step.clicks}`);
        await agent.click();
        continue; // it moves on by itself
      }
      await page.getByTestId(TID.tourNext).click();
    }
    await expect(page.getByTestId(TID.tour)).toBeHidden();
    const s = await snap(page);
    expect(s.run.clicks, 'the three clicks were real').toBe(TOUR_CLICKS);
    expect(s.run.tokens).toBeGreaterThan(0);
    expect(s.run.context).toBeGreaterThan(0);
    await expect(page.getByTestId(TID.agent)).toBeFocused();
    await expectClockRunning(page);
    expect(await tourSeenFlag(page)).not.toBeNull();
    expectClean(w);
  });

  test('the keyboard alone: → and Enter go on, ← goes back, Space is the three clicks, Esc skips', async ({ page }) => {
    const w = await bootPage(page, { tour: true });
    await page.getByTestId(TID.startRun).click();
    await expect(card(page, 'intro')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(card(page, 'agent')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(card(page, 'intro')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(card(page, 'agent')).toBeVisible();
    for (let k = 0; k < TOUR_CLICKS; k++) await page.keyboard.press('Space');
    await expect(card(page, 'tokens')).toBeVisible();
    expect((await snap(page)).run.clicks).toBe(TOUR_CLICKS);

    // Tab never leaves the card, and the game's hotkeys wait.
    for (let k = 0; k < 5; k++) {
      await page.keyboard.press('Tab');
      expect(await focused(page)).toMatch(/^tour-/);
    }
    for (const k of ['y', 's', '1', 'Space']) await page.keyboard.press(k);
    await frames(page, 2);
    const s = await snap(page);
    expect(s.run.sycophancy).toBe(0);
    expect(s.run.tools['grep']).toBe(0);
    await expect(card(page, 'tokens'), 'Space off the interactive step presses nothing').toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId(TID.tour)).toBeHidden();
    expect(await tourSeenFlag(page)).not.toBeNull();
    expectClean(w);
  });

  test('Skip ends it on the spot, and marks it seen', async ({ page }) => {
    const w = await bootPage(page, { tour: true });
    await page.getByTestId(TID.startRun).click();
    await page.getByTestId(TID.tourNext).click();
    await page.getByTestId(TID.tourNext).click();
    await expect(card(page, TOUR_STEPS[2]!.id)).toBeVisible();
    expect(await tourSeenFlag(page)).toBeNull();
    await page.getByTestId(TID.tourSkip).click();
    await expect(page.getByTestId(TID.tour)).toBeHidden();
    expect(await tourSeenFlag(page)).not.toBeNull();
    await expect(page.getByTestId(TID.agent)).toBeFocused();
    await expectClockRunning(page);
    expectClean(w);
  });

  test('the second session has no tour, and neither does a reload', async ({ page }) => {
    const w = await bootPage(page, { tour: true });
    await page.getByTestId(TID.startRun).click();
    await expect(card(page, 'intro')).toBeVisible();
    await page.getByTestId(TID.tourSkip).click();
    await expect(page.getByTestId(TID.tour)).toBeHidden();

    await loseRunToTraining(page);
    await page.getByTestId(TID.metaStart).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    await frames(page, 4);
    await expect(page.getByTestId(TID.tour)).toBeHidden();
    await expectClockRunning(page);

    await page.reload();
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
    await page.getByTestId(TID.startRun).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    await frames(page, 4);
    await expect(page.getByTestId(TID.tour)).toBeHidden();
    expectClean(w);
  });

  test('Replay, from How to play: from the title it starts a session first', async ({ page }) => {
    const w = await bootPage(page);
    await page.getByTestId(TID.helpButton).click();
    await expect(page.getByTestId(TID.helpModal)).toBeVisible();
    await page.getByTestId(TID.tourReplay).click();
    await expect(page.getByTestId(TID.helpModal)).toBeHidden();
    await expect(card(page, 'intro')).toBeVisible();
    const s0 = await snap(page);
    expect(s0.screen).toBe('run');
    expect(s0.run.phase).toBe('running');
    await page.waitForTimeout(1_000);
    expect((await snap(page)).run.patienceMs, 'held under a replay too').toBe(s0.run.patienceMs);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(TID.tour)).toBeHidden();
    expectClean(w);
  });

  test('Replay, from How to play, over a session already running', async ({ page }) => {
    const w = await bootPage(page);
    await page.getByTestId(TID.startRun).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    await frames(page, 4);
    await expect(page.getByTestId(TID.tour), 'seen: no tour of its own').toBeHidden();
    await page.getByTestId(TID.agent).click();

    await page.getByTestId(TID.helpButton).click();
    await page.getByTestId(TID.tourReplay).click();
    await expect(page.getByTestId(TID.helpModal)).toBeHidden();
    await expect(card(page, 'intro')).toBeVisible();
    const s0 = await snap(page);
    expect(s0.run.clicks, 'the same session, not a new one').toBe(1);
    await page.waitForTimeout(1_000);
    expect((await snap(page)).run.patienceMs).toBe(s0.run.patienceMs);
    await page.getByTestId(TID.tourNext).click();
    await page.getByTestId(TID.tourSkip).click();
    await expect(page.getByTestId(TID.tour)).toBeHidden();
    await expectClockRunning(page);
    expectClean(w);
  });
});

// ---------------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface StepGeometry {
  vw: number;
  vh: number;
  card: Box;
  targets: Array<{ id: string; box: Box; hit: string | null; clear: boolean }>;
}

/** Where the card and each of the step's targets are, and what a tap on each target's centre would hit. */
async function measure(page: Page, step: TourStep): Promise<StepGeometry> {
  return page.evaluate(
    ({ ids, panel, cardId }) => {
      const q = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      const boxOf = (n: Element): Box => {
        const r = n.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      const targets = ids.map((id) => {
        let n: HTMLElement = q(id);
        // The panel the target sits in, the way the tour lights it.
        const parent = n.parentElement;
        if (panel && parent !== null && parent.getBoundingClientRect().width > 0) n = parent;
        const b = boxOf(n);
        const top = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
        return {
          id,
          box: b,
          hit: top?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
          clear: top !== null && n.contains(top),
        };
      });
      return {
        vw: document.documentElement.clientWidth,
        vh: document.documentElement.clientHeight,
        card: boxOf(q(cardId)),
        targets,
      };
    },
    { ids: step.targets.flat() as string[], panel: step.panel === true, cardId: tid(TID.tourStep, step.id) },
  );
}

const inside = (b: Box, vw: number, vh: number): boolean =>
  b.x >= -1 && b.y >= -1 && b.x + b.w <= vw + 1 && b.y + b.h <= vh + 1;
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Every step: its targets are on screen and uncovered, its card is on screen and off them. */
async function walkChecked(page: Page, where: string): Promise<void> {
  for (const step of TOUR_STEPS) {
    const c = card(page, step.id);
    await expect(c, `${where}: ${step.id}`).toBeVisible();
    // The drawer slides up for the tools step (220ms); let everything land.
    await page.waitForTimeout(step.drawer === true ? 400 : 120);
    await frames(page, 2);
    const g = await measure(page, step);
    const at = `${where}: ${step.id}`;
    expect(inside(g.card, g.vw, g.vh), `${at}: card ${JSON.stringify(g.card)} is off a ${g.vw}x${g.vh} screen`).toBe(true);
    for (const t of g.targets) {
      expect(t.box.w * t.box.h, `${at}: ${t.id} has no box`).toBeGreaterThan(0);
      expect(inside(t.box, g.vw, g.vh), `${at}: ${t.id} ${JSON.stringify(t.box)} is off screen`).toBe(true);
      expect(t.clear, `${at}: ${t.id} is covered by ${t.hit}`).toBe(true);
      expect(overlap(g.card, t.box), `${at}: the card covers ${t.id}`).toBe(false);
    }
    if (step.clicks !== undefined) {
      for (let k = 0; k < step.clicks; k++) await page.getByTestId(TID.agent).tap();
      continue;
    }
    await page.getByTestId(TID.tourNext).tap();
  }
  await expect(page.getByTestId(TID.tour)).toBeHidden();
}

test.describe('the tour on a phone @mobile', () => {
  test('upright and on its side, every target is on screen and uncovered, and every card fits @mobile', async ({
    page,
  }) => {
    const w = await bootPage(page, { tour: true });
    await page.getByTestId(TID.startRun).tap();
    await walkChecked(page, 'portrait 390x844');

    await page.setViewportSize({ width: 844, height: 390 });
    await frames(page, 6);
    await page.getByTestId(TID.helpButton).tap();
    await page.getByTestId(TID.tourReplay).tap();
    await walkChecked(page, 'landscape 844x390');
    expectClean(w);
  });

  test('on its side, the tools step opens the shop drawer and shuts it after @mobile', async ({ page }) => {
    await bootPage(page, { tour: true });
    await page.setViewportSize({ width: 844, height: 390 });
    await frames(page, 6);
    await page.getByTestId(TID.startRun).tap();
    const toggle = page.getByTestId(TID.shopToggle);
    const tools = TOUR_STEPS.findIndex((s) => s.id === 'tools');
    for (let i = 0; i < tools; i++) {
      await expect(card(page, TOUR_STEPS[i]!.id)).toBeVisible();
      await page.getByTestId(TID.tourNext).tap();
    }
    await expect(card(page, 'tools')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId(TID.toolList)).toBeInViewport();
    await page.getByTestId(TID.tourNext).tap();
    await expect(card(page, TOUR_STEPS[tools + 1]!.id)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
