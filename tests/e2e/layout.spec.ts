/**
 * Layout stability and the stacked mobile form factor.
 *
 * The HUD is expected to reserve width for the numbers it will eventually
 * show. If the ship button drifts as the wallet crosses an order of magnitude,
 * the player's aim moves out from under their cursor mid-run.
 */
import { expect, test, type Page } from '@playwright/test';
import { TID, advance, agentRow, bootPage, frames, grant, snap, startRun, tid } from './harness.ts';

/** Phone on its side. Short enough that the shop becomes a bottom sheet. */
const LANDSCAPE = { width: 844, height: 390 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(page: Page, testid: string): Promise<Box> {
  const b = await page.getByTestId(testid).boundingBox();
  expect(b, `${testid} has no bounding box`).not.toBeNull();
  return { x: b!.x, y: b!.y, width: b!.width, height: b!.height };
}

/** Round to whole pixels: sub-pixel jitter from font metrics is not a shift. */
function round(b: Box): Box {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  };
}

/** Wait for the wallet roll-up (250ms window) to converge on the true value. */
async function settleRollUp(page: Page): Promise<void> {
  await page.waitForTimeout(450);
  await frames(page, 4);
}

/** The *layout* viewport — never `innerWidth`, which mobile Chrome inflates. */
async function viewport(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => ({
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
  }));
}

/**
 * Turn the phone sideways and let the scale settle. The scale controller reacts
 * to `resize` on the next frame, and the sheet's slide is 220ms, so this waits
 * for both rather than for a fixed number of frames.
 */
async function rotateToLandscape(page: Page): Promise<void> {
  await page.setViewportSize(LANDSCAPE);
  await frames(page, 6);
  await expect(
    page.getByTestId(TID.shopToggle),
    'a landscape phone is short, so the shop must become a drawer',
  ).toBeVisible();
  await page.waitForTimeout(300);
}

/**
 * Assert where the sheet has come to rest.
 *
 * Polled, because the slide is a 220ms CSS transition and animation frames are
 * the wrong unit for it — ten of them is 160ms, and the sheet was still moving.
 * A sheet that never lands where it should still fails, on the timeout.
 */
async function expectSheet(page: Page, where: 'open' | 'shut'): Promise<void> {
  const vp = await viewport(page);
  await expect(async () => {
    const b = await box(page, TID.shop);
    if (where === 'shut') {
      expect(
        b.y,
        `a shut drawer must be parked off the bottom of the screen (top=${b.y}, viewport=${vp.h})`,
      ).toBeGreaterThanOrEqual(vp.h - 1);
      return;
    }
    expect(b.y, 'the open sheet must actually be on screen').toBeLessThan(vp.h - 40);
    expect(b.y + b.height, 'the open sheet must not hang off the bottom').toBeLessThanOrEqual(
      vp.h + 1,
    );
  }).toPass({ timeout: 5_000 });
}

test.describe('layout stability', () => {
  test('the ship button does not move as slop crosses orders of magnitude', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 10);
    await settleRollUp(page);

    const start = round(await box(page, TID.shipButton));
    const barStart = round(await box(page, TID.shipBar));
    const observed: Array<{ slop: number; text: string; btn: Box }> = [];

    for (const target of [1e3, 1e6, 1e9, 1e12, 1e15]) {
      const s = await snap(page);
      await grant(page, target - s.run.slop);
      await settleRollUp(page);
      observed.push({
        slop: target,
        text: (await page.getByTestId(TID.slop).textContent()) ?? '',
        btn: round(await box(page, TID.shipButton)),
      });
    }

    for (const o of observed) {
      expect(
        o.btn,
        `ship button moved at slop=${o.slop} (wallet read "${o.text}") — the HUD must ` +
          `reserve width and use tabular figures`,
      ).toEqual(start);
    }
    expect(round(await box(page, TID.shipBar)), 'the ship bar also must not reflow').toEqual(
      barStart,
    );
  });

  test('the deadline readout is fixed-width as it counts down', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const first = round(await box(page, TID.deadlineText));
    const widths = new Set<number>([first.width]);
    for (let i = 0; i < 6; i++) {
      await advance(page, 17_000);
      await frames(page, 3);
      widths.add(round(await box(page, TID.deadlineText)).width);
    }
    expect(
      widths.size,
      `the deadline text reflowed across ${widths.size} widths: ${[...widths].join(', ')}`,
    ).toBe(1);
  });

  test('buying does not reflow the shop rail', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 5_000);
    await frames(page, 4);
    const before = round(await box(page, TID.shop));

    for (let i = 0; i < 5; i++) {
      await page.getByTestId(tid(TID.agentRow, 'tab_autocomplete')).click();
      await frames(page, 3);
    }
    expect(round(await box(page, TID.shop))).toEqual(before);
  });
});

test.describe('mobile layout @mobile', () => {
  test('no horizontal overflow at 390x844 @mobile', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    await grant(page, 5_000);
    await frames(page, 6);

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(
      metrics.scrollWidth,
      `page scrolls horizontally: scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
    ).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.bodyScroll).toBeLessThanOrEqual(metrics.inner);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('nothing is clipped off the left or right edge @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 5_000);
    await frames(page, 6);

    const width = await page.evaluate(() => window.innerWidth);
    const ids = [
      TID.slop,
      TID.shipBar,
      TID.deadlineBar,
      TID.shipButton,
      TID.demoTally,
      TID.scene,
      TID.shop,
      TID.tabAgents,
      TID.tabUpgrades,
      TID.buyQtyToggle,
      tid(TID.agentRow, 'tab_autocomplete'),
    ];
    for (const id of ids) {
      const b = await box(page, id);
      expect(b.x, `${id} is clipped off the left edge (x=${b.x})`).toBeGreaterThanOrEqual(-1);
      expect(
        b.x + b.width,
        `${id} overflows the right edge (right=${b.x + b.width}, viewport=${width})`,
      ).toBeLessThanOrEqual(width + 1);
      expect(b.width, `${id} collapsed to zero width`).toBeGreaterThan(0);
    }
  });

  test('the ship button and the shop are both usable on a phone @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    const shipBtn = page.getByTestId(TID.shipButton);
    const shop = page.getByTestId(TID.shop);
    await expect(shipBtn).toBeVisible();
    await expect(shop).toBeVisible();
    /*
     * A portrait phone has height to spare, so the shop stays in the flow and
     * there is nothing to open: no toggle, no sheet in the way. Asserted rather
     * than assumed, because if this ever flips to a drawer every line below it
     * would quietly start testing a shop nobody can see.
     */
    await expect(
      page.getByTestId(TID.shopToggle),
      'portrait must keep the shop in the flow, not behind a toggle',
    ).toBeHidden();

    // Buy through the shop with a real tap-sized click.
    await grant(page, 5_000);
    await frames(page, 4);
    const row = page.getByTestId(tid(TID.agentRow, 'tab_autocomplete'));
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeEnabled();
    await row.click();
    await frames(page, 3);
    expect((await snap(page)).run.agents['tab_autocomplete']).toBe(1);

    // Then ship, from the button, without scrolling it off screen.
    const s = await snap(page);
    await grant(page, s.derived.requirement);
    await shipBtn.scrollIntoViewIfNeeded();
    await expect(shipBtn).toBeEnabled();
    await shipBtn.click();
    await frames(page, 3);
    expect((await snap(page)).run.shipped).toBe(1);
  });

  /**
   * Landscape is what the drawer exists for: there the in-flow shop squeezed the
   * rail to one character per line, and stacking it below the stage costs 420
   * units of height a phone on its side has not got.
   */
  test('the shop drawer opens and the shop is usable in landscape @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await rotateToLandscape(page);

    const toggle = page.getByTestId(TID.shopToggle);
    const vp = await viewport(page);
    await expect(toggle, 'a short viewport must offer a way into the shop').toBeVisible();

    // Shut, the sheet is parked off the bottom of the screen.
    await expectSheet(page, 'shut');

    await grant(page, 5_000);
    await frames(page, 4);
    await toggle.click();
    await expectSheet(page, 'open');

    // The payoff: a full-bleed sheet instead of a 150px rail, so a row has room
    // for its name and its blurb on one line each.
    const row = agentRow(page, 'tab_autocomplete');
    await expect(row).toBeEnabled();
    const rb = round(await box(page, tid(TID.agentRow, 'tab_autocomplete')));
    expect(
      rb.width,
      `a shop row got ${rb.width}px of ${vp.w} — the drawer is supposed to give it the ` +
        `screen width, not a cramped rail`,
    ).toBeGreaterThan(vp.w * 0.9);
    expect(rb.height, `shop rows must stay thumb-sized (got ${rb.height}px)`).toBeGreaterThanOrEqual(
      44,
    );

    // And buying through it works, with a real tap-sized click.
    await row.click();
    await frames(page, 3);
    expect((await snap(page)).run.agents['tab_autocomplete']).toBe(1);

    /*
     * The sheet closes again and the board comes back. Aimed at the dimmed board
     * above the sheet rather than the scrim's centre: the scrim is the whole
     * viewport and the sheet sits on top of its lower half, so a centre-of-element
     * click lands on the shop instead — which is also the real gesture, since what
     * a thumb reaches for is the dimmed game, not the layer over it.
     */
    const sheet = await box(page, TID.shop);
    await page
      .getByTestId(TID.shopScrim)
      .click({ position: { x: 8, y: Math.round(sheet.y / 2) } });
    await expectSheet(page, 'shut');

    // Then ship, from the button that was behind the scrim a moment ago.
    const s = await snap(page);
    await grant(page, s.derived.requirement);
    const shipBtn = page.getByTestId(TID.shipButton);
    await expect(shipBtn).toBeEnabled();
    await shipBtn.click();
    await frames(page, 3);
    expect((await snap(page)).run.shipped).toBe(1);
  });

  test('an open drawer holds the board behind it inert @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await rotateToLandscape(page);
    await grant(page, 5_000);
    await frames(page, 4);

    await page.getByTestId(TID.shopToggle).click();
    await frames(page, 10);

    // Opening moves focus into the sheet.
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null),
      'opening the drawer must move focus into it',
    ).toBe(TID.tabAgents);

    // And Tab cannot walk out of it into the content behind the scrim. Cycled
    // well past the number of controls in the sheet.
    const visited: string[] = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement;
        const sheet = document.querySelector('[data-testid="shop"]');
        return {
          id: a?.getAttribute('data-testid') ?? a?.tagName ?? 'null',
          inside: Boolean(sheet && a && sheet.contains(a)),
        };
      });
      expect(info.inside, `Tab #${i + 1} escaped the shop drawer to ${info.id}`).toBe(true);
      visited.push(info.id);
    }
    expect(new Set(visited).size, 'the trap must cycle, not pin focus to one control').toBeGreaterThan(
      1,
    );

    // Shift+Tab wraps backwards without leaking either.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(() => {
        const sheet = document.querySelector('[data-testid="shop"]');
        return Boolean(sheet && document.activeElement && sheet.contains(document.activeElement));
      });
      expect(inside, `Shift+Tab #${i + 1} escaped the shop drawer`).toBe(true);
    }

    // The board is inert, so a tap cannot land on the laptop through the scrim.
    expect(
      await page.evaluate(() =>
        Boolean(document.querySelector('[data-testid="laptop-hit"]')?.closest('[inert]')),
      ),
      'the board behind the scrim must be inert while the sheet is open',
    ).toBe(true);

    // Escape closes it and hands focus back to the toggle that opened it.
    await page.keyboard.press('Escape');
    await frames(page, 10);
    await expect(page.getByTestId(TID.shopToggle)).toBeFocused();
    expect(
      await page.evaluate(() =>
        Boolean(document.querySelector('[data-testid="laptop-hit"]')?.closest('[inert]')),
      ),
      'closing must give the board back',
    ).toBe(false);
  });

  test('the draft modal fits the viewport @mobile', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await page.evaluate(() =>
      window.__TOKENMAXXING__!.forceDraft(['haiku', 'sonnet', 'opus']),
    );
    await frames(page, 4);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();

    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    for (const card of ['haiku', 'sonnet', 'opus']) {
      const b = await box(page, tid(TID.draftCard, card));
      expect(b.x, `draft card ${card} is off the left edge`).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width, `draft card ${card} is off the right edge`).toBeLessThanOrEqual(vp.w + 1);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the draft modal must not introduce horizontal scroll').toBeLessThanOrEqual(0);
  });
});

test.describe('touch input @mobile', () => {
  test('tapping the laptop produces slop', async ({ page }) => {
    // `tap()`, not `click()`: Playwright's click dispatches mouse events even in
    // a touch context, which is exactly why this went unnoticed. The scene
    // mapping read a cached canvas origin, and on a viewport too narrow for the
    // stage the canvas is offset — so every tap missed the laptop entirely.
    const w = await bootPage(page);
    await startRun(page);
    const before = await snap(page);

    const box = (await page.getByTestId(TID.laptop).boundingBox())!;
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.6556;
    for (let i = 0; i < 5; i++) await page.touchscreen.tap(x, y);
    await frames(page, 3);

    const after = await snap(page);
    expect(after.run.clicks, 'taps did not register').toBeGreaterThan(before.run.clicks);
    expect(after.run.slop).toBeGreaterThan(before.run.slop);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });
});
