/**
 * Layout on the desktop: the DOM laid over the canvas lines up with what the
 * canvas draws, the HUD does not reflow as numbers grow, and the controls you
 * cannot play without are really the thing under the pointer.
 */
import { expect, test, type Page } from '@playwright/test';
import { PROMPT_TEXTS } from '../../src/sim/content.ts';
import { TID, bootPage, drainCoach, expectAgentAligned, grant, hOverflow, snap, startRun } from './harness.ts';

/** The testid of whatever the pointer would actually hit at the centre of `id`. */
async function hitAt(page: Page, id: string): Promise<string | null> {
  const b = (await page.getByTestId(id).boundingBox())!;
  return page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x as number, y as number)?.closest('[data-testid]')?.getAttribute('data-testid') ??
      null,
    [b.x + b.width / 2, b.y + b.height / 2],
  );
}

test.describe('layout', () => {
  test('the agent hit box sits exactly over the agent the canvas draws (1x)', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await expectAgentAligned(page);
  });

  test('the report button and the report bar do not move as the wallet crosses orders of magnitude', async ({
    page,
  }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    // Held on one face (REPORT DONE) throughout: this is about the digits, not
    // about the button changing state.
    await grant(page, s0.derived.requirement);
    await drainCoach(page);
    await page.waitForTimeout(350);
    const round = (b: { x: number; y: number; width: number; height: number }): number[] =>
      [b.x, b.y, b.width, b.height].map(Math.round);
    const btn = page.getByTestId(TID.reportButton);
    const bar = page.getByTestId(TID.reportBar);
    await expect(btn).toHaveAttribute('data-state', 'report');
    const start = { btn: round((await btn.boundingBox())!), bar: round((await bar.boundingBox())!) };
    for (const target of [999, 1e4, 1e6, 1e9, 1e12, 1e15]) {
      const s = await snap(page);
      if (target > s.run.tokens) await grant(page, target - s.run.tokens);
      await page.waitForTimeout(350); // the wallet rolls up
      expect(round((await btn.boundingBox())!), `report button moved at ${target} tokens`).toEqual(start.btn);
      expect(round((await bar.boundingBox())!), `report bar moved at ${target} tokens`).toEqual(start.bar);
    }
  });

  test('no horizontal overflow, and the key controls are what the pointer hits', async ({ page }) => {
    await bootPage(page);
    expect(await hOverflow(page)).toBeLessThanOrEqual(0);
    for (const id of [TID.startRun, TID.titleMeta, TID.achievementsButton, TID.aboutButton]) {
      expect(await hitAt(page, id), `${id} is covered`).toBe(id);
    }
    await startRun(page);
    await drainCoach(page);
    expect(await hOverflow(page)).toBeLessThanOrEqual(0);
    for (const id of [TID.reportButton, TID.sycophancyButton, TID.agent, TID.tabTools, TID.optionsButton]) {
      expect(await hitAt(page, id), `${id} is covered`).toBe(id);
    }
    await page.evaluate(() => window.__TOKENMAXXING2__!.setPatience(0));
    await page.getByTestId(TID.runOverContinue).click();
    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
    for (const id of [TID.metaBack, TID.metaStart]) {
      expect(await hitAt(page, id), `${id} is covered`).toBe(id);
    }
  });
});

test.describe('the stage caption', () => {
  // Regression guard (was a bug, now fixed): the prompt line along the bottom of the stage is drawn twice. The
  // renderer types it onto the canvas (src/render/scene.ts:829-843,
  // `drawPromptLine`, which also shows the "Compacted 77K -> 6.4K" line), and
  // the UI lays a DOM caption with the same job over the same strip
  // (src/ui/stage.ts:135-137 and :164-187, styled at src/styles/ui.css:1173).
  // The two are offset and in different cases, so the line reads as garbled
  // double text on every run screen; during a compaction they even disagree
  // ("COMPACTED ..." under "Context low - compacting."). Expected: one owner.
  test('the prompt line is drawn once', async ({ page }) => {
    await bootPage(page);
    const s = await startRun(page);
    await page.waitForTimeout(2_000); // the canvas types the prompt out
    const stats = (await page.evaluate(() => window.__TOKENMAXXING2__!.renderStats())) as {
      stage?: { promptLine?: string; promptShown?: number };
    };
    const canvasDraws = (stats.stage?.promptShown ?? 0) > 0;
    const text = PROMPT_TEXTS[s.run.promptIndex] ?? '';
    // The DOM keeps the prompt for screen readers, visually hidden inside a
    // 1px clipped box. A child's own rect ignores its ancestors' clipping, so
    // measure what actually paints: the rect intersected with every clipping
    // ancestor.
    const dom = page.getByTestId(TID.scene).locator('xpath=..').getByText(text);
    const painted =
      (await dom.count()) === 0
        ? 0
        : await dom.first().evaluate((node) => {
            const r = node.getBoundingClientRect();
            let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom];
            for (let a = node.parentElement; a; a = a.parentElement) {
              const cs = getComputedStyle(a);
              if (cs.overflow === 'visible' && cs.clipPath === 'none') continue;
              const ar = a.getBoundingClientRect();
              [l, t, rt, b] = [Math.max(l, ar.left), Math.max(t, ar.top), Math.min(rt, ar.right), Math.min(b, ar.bottom)];
            }
            return Math.max(0, rt - l) * Math.max(0, b - t);
          });
    const domDraws = painted > 4;
    expect(canvasDraws && domDraws, 'both the canvas and the DOM caption draw the prompt').toBe(false);
  });
});

test.describe('layout on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } });

  // Regression guard (was a bug, now fixed): the renderer floors the canvas to an integer scale and pins its inline
  // size (src/render/canvas.ts:40 and :201-204), but on a DPR >= 2 screen the
  // UI picks a fractional --px (src/ui/scale.ts:110-111, `useFraction`)
  // and positions `agent-hit` in --px units (src/styles/ui.css:1017-1020). At
  // 1280x720@2x the box is 83px low and 47px too tall: its centre maps to scene
  // y=189, below the 180-tall scene, so a click there generates nothing, and
  // the pointer cursor and focus ring sit under the agent instead of on it.
  // Expected: agent-hit covers exactly the agent the canvas draws.
  test('the agent hit box sits over the drawn agent on a Retina laptop', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await expectAgentAligned(page);
    await page.getByTestId(TID.agent).click();
    expect((await snap(page)).run.clicks).toBe(1);
  });
});
