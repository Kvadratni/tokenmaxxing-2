/**
 * Keyboard: hotkeys, focus management and the draft modal's focus trap.
 */
import { expect, test } from '@playwright/test';
import {
  TID,
  advance,
  bootPage,
  draftCards,
  forceDraft,
  frames,
  grant,
  snap,
  startRun,
  tid,
} from './harness.ts';

const TIER1 = 'tab_autocomplete';

/** Same selector `src/ui/dom.ts#focusables` uses, so the two lists agree. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

test.describe('hotkeys', () => {
  test('S ships when affordable and is refused when it is not', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    await page.keyboard.press('s');
    await frames(page, 3);
    const refused = await snap(page);
    expect(refused.run.shipped, 'S with an empty wallet must not ship').toBe(0);
    await expect(page.getByTestId(TID.toast).first()).toBeVisible();

    await grant(page, refused.derived.requirement);
    await expect(page.getByTestId(TID.shipButton)).toBeEnabled();
    await page.keyboard.press('s');
    await frames(page, 3);

    const shipped = await snap(page);
    expect(shipped.run.shipped).toBe(1);
    expect(shipped.run.phase).toBe('shipped');
  });

  test('1 buys the first visible agent tier', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 1_000);
    await frames(page, 3);

    const before = await snap(page);
    expect(before.run.agents[TIER1]).toBe(0);
    const cost = before.derived.nextCosts[TIER1];

    await page.keyboard.press('1');
    await frames(page, 3);

    const after = await snap(page);
    expect(after.run.agents[TIER1]).toBe(1);
    expect(after.run.slop).toBeCloseTo(before.run.slop - cost, 5);
  });

  test('the buy-quantity toggle cycles x1 -> x10 -> MAX -> x1 on click', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const toggle = page.getByTestId(TID.buyQtyToggle);
    await expect(toggle).toHaveText('×1');

    await toggle.click();
    await expect(toggle).toHaveText('×10');
    await toggle.click();
    await expect(toggle).toHaveText('MAX');
    await toggle.click();
    await expect(toggle).toHaveText('×1');
  });

  test('x10 actually buys ten units at the quoted bulk price', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 100_000);
    // Quantity is a button, never a hotkey: how much you are about to spend
    // should not be one stray keystroke away.
    await page.getByTestId(TID.buyQtyToggle).click();
    await expect(page.getByTestId(TID.buyQtyToggle)).toHaveText('×10');
    await frames(page, 3);

    const before = await snap(page);
    await page.getByTestId(tid(TID.agentRow, TIER1)).click();
    await frames(page, 3);
    const after = await snap(page);

    expect(after.run.agents[TIER1]).toBe(10);
    expect(after.run.slop).toBeLessThan(before.run.slop);
    expect(after.run.slop).toBeGreaterThanOrEqual(0);
    expect(after.run.slopSpent).toBeCloseTo(before.run.slop - after.run.slop, 5);
  });

  test('hotkeys are inert while a modal owns the keyboard', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 100_000);
    await forceDraft(page, ['haiku', 'sonnet', 'opus']);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();

    const before = await snap(page);
    await page.keyboard.press('1');
    await page.keyboard.press('s');
    await frames(page, 3);
    const after = await snap(page);

    expect(after.run.agents[TIER1]).toBe(before.run.agents[TIER1]);
    expect(after.run.shipped).toBe(before.run.shipped);
  });
});

test.describe('accessibility', () => {
  test('the draft modal traps focus and refuses Escape', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forceDraft(page, ['haiku', 'sonnet', 'opus']);

    const modal = page.getByTestId(TID.draftModal);
    await expect(modal).toBeVisible();
    await expect(draftCards(page)).toHaveCount(3);

    // Opening moves focus into the dialog.
    const first = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    expect(first).toBe('draft-card-haiku');

    await page.keyboard.press('Escape');
    await frames(page, 3);
    await expect(modal, 'a mandatory pick must not be dismissable').toBeVisible();
    expect((await snap(page)).run.phase).toBe('drafting');

    // Cycle well past the number of cards: focus must stay inside the panel.
    const visited: string[] = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement;
        const modalEl = document.querySelector('[data-testid="draft-modal"]');
        return {
          testid: a?.getAttribute('data-testid') ?? a?.tagName ?? 'null',
          inside: Boolean(modalEl && a && modalEl.contains(a)),
        };
      });
      expect(info.inside, `Tab #${i + 1} escaped the draft modal to ${info.testid}`).toBe(true);
      visited.push(info.testid);
    }
    expect(new Set(visited).size, 'the trap must cycle through all three cards').toBe(3);

    // Shift+Tab wraps backwards without leaking either.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(() => {
        const modalEl = document.querySelector('[data-testid="draft-modal"]');
        return Boolean(modalEl && document.activeElement && modalEl.contains(document.activeElement));
      });
      expect(inside, `Shift+Tab #${i + 1} escaped the draft modal`).toBe(true);
    }
  });

  test('the draft can be completed with the keyboard alone', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forceDraft(page, ['haiku', 'sonnet', 'opus']);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();

    // Picking is two-step: Enter highlights, Confirm commits. Both halves must
    // be reachable without a mouse.
    await page.keyboard.press('Tab'); // haiku -> sonnet
    await page.keyboard.press('Enter');
    await frames(page, 2);

    // Highlighted, not taken — a keypress alone must never spend the draft.
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    expect((await snap(page)).run.cards).toEqual([]);
    await expect(page.getByTestId(tid(TID.draftCard, 'sonnet'))).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Tab round to Confirm and commit.
    for (let i = 0; i < 8; i++) {
      const onConfirm = await page.evaluate(
        (t) => document.activeElement?.getAttribute('data-testid') === t,
        TID.draftConfirm,
      );
      if (onConfirm) break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByTestId(TID.draftConfirm)).toBeFocused();
    await page.keyboard.press('Enter');
    await frames(page, 4);

    await expect(page.getByTestId(TID.draftModal)).toBeHidden();
    expect((await snap(page)).run.cards).toEqual(['sonnet']);
  });

  test('every run-screen control is reachable by Tab and focus never lands on body', async ({
    page,
  }) => {
    await bootPage(page);
    await startRun(page);
    // Enough slop that the ship button and the shop rows are all enabled, so
    // the tab ring is at its widest.
    await grant(page, 1_000);
    await frames(page, 6);

    const expected = await page.evaluate((sel) => {
      const root = document.querySelector('[data-testid="app"]');
      if (!root) return [] as string[];
      return Array.from(root.querySelectorAll<HTMLElement>(sel))
        .filter((n) => n.closest('[hidden]') === null)
        .filter((n) => n.getAttribute('aria-hidden') !== 'true')
        .map((n) => n.getAttribute('data-testid') ?? n.tagName);
    }, FOCUSABLE);

    expect(expected.length, 'the run screen must expose focusable controls').toBeGreaterThan(5);
    expect(expected).toContain(TID.optionsButton);
    expect(expected).toContain(TID.shipButton);
    expect(expected).toContain(TID.laptop);
    expect(expected).toContain(TID.tabAgents);
    expect(expected).toContain(TID.tabUpgrades);
    expect(expected).toContain(TID.buyQtyToggle);
    expect(expected).toContain(tid(TID.agentRow, TIER1));

    // Start on the first control and walk the whole ring.
    await page.getByTestId(expected[0]!).focus();
    const visited: string[] = [expected[0]!];
    for (let i = 1; i < expected.length; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement;
        return {
          id: a?.getAttribute('data-testid') ?? a?.tagName ?? 'null',
          inApp: Boolean(document.querySelector('[data-testid="app"]')?.contains(a)),
        };
      });
      expect(info.id, `Tab #${i} landed on <body> — focus escaped the app`).not.toBe('BODY');
      expect(info.inApp, `Tab #${i} left the app (landed on ${info.id})`).toBe(true);
      visited.push(info.id);
    }
    expect(new Set(visited)).toEqual(new Set(expected));
  });

  test('bars and dialogs carry the ARIA the screen reader needs', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 50);
    await frames(page, 4);

    const shipBar = page.getByTestId(TID.shipBar);
    await expect(shipBar).toHaveAttribute('role', 'progressbar');
    await expect(shipBar).toHaveAttribute('aria-valuenow', '50');

    const dlBar = page.getByTestId(TID.deadlineBar);
    await expect(dlBar).toHaveAttribute('role', 'progressbar');
    await advance(page, 60_000);
    await expect(dlBar).toHaveAttribute('aria-valuenow', '50');

    await forceDraft(page, ['haiku', 'sonnet', 'opus']);
    const modal = page.getByTestId(TID.draftModal);
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal).toHaveAttribute('aria-label', /.+/);
  });
});

test.describe('reduced motion @reduced', () => {
  test('prefers-reduced-motion collapses transitions and the game still plays @reduced', async ({
    page,
  }) => {
    const w = await bootPage(page);
    await startRun(page);

    // Chromium serialises the computed value as `1e-06s`, so parse rather than
    // string-compare against the `0.001ms` written in the stylesheet.
    const dur = await page
      .getByTestId(TID.shipBarFill)
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(dur).toMatch(/s$/);
    expect(
      Number.parseFloat(dur),
      `the ship bar must not animate under prefers-reduced-motion (got ${dur})`,
    ).toBeLessThan(0.01);

    // Stay *below* the requirement: shipProgress is clamped to 1, so granting
    // more than the bar holds would make the "buying shrinks the bar"
    // assertion below vacuously false.
    const start = await snap(page);
    await grant(page, start.derived.requirement * 0.6);
    await frames(page, 4);
    const mid = await snap(page);
    expect(mid.derived.shipProgress).toBeGreaterThan(0);
    expect(mid.derived.shipProgress).toBeLessThan(1);

    await page.getByTestId(tid(TID.agentRow, TIER1)).click();
    await frames(page, 4);
    const after = await snap(page);
    expect(after.run.agents[TIER1]).toBe(1);
    expect(after.derived.shipProgress).toBeLessThan(mid.derived.shipProgress);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });
});
