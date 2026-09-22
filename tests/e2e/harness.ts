/**
 * Shared e2e harness.
 *
 * Every spec drives the game through two surfaces and nothing else:
 *   - `TID` selectors from `src/testids.ts` (the frozen contract), and
 *   - `window.__TOKENMAXXING__` (the `TestHooks` interface).
 *
 * No CSS-class selectors, no text matching on strings the UI owns.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { TID, tid } from '../../src/testids.ts';
import type { DerivedStats, MetaState, RunState } from '../../src/sim/types.ts';

export { TID, tid };

/**
 * `TestHooks.snapshot()` is declared `unknown` and travels through
 * `JSON.parse(JSON.stringify(...))`, so non-finite numbers arrive as `null`.
 * That is deliberate: a `null` here is itself a finding.
 */
export interface Snap {
  run: RunState;
  meta: MetaState;
  derived: DerivedStats;
  screen: string;
}

/** Errors the page produced. Asserted empty by every spec that boots. */
export interface Watcher {
  readonly errors: string[];
}

/** CSS attribute selector for a testid, for the rare case a Locator is wrong. */
export function sel(id: string): string {
  return `[data-testid="${id}"]`;
}

/** Attach console-error / pageerror capture. Must run before `goto`. */
export function watch(page: Page): Watcher {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.name}: ${err.message}`);
  });
  return { errors };
}

/**
 * Boot the production preview with test hooks on and a hermetic save.
 *
 * localStorage is cleared exactly once per page session (guarded through
 * sessionStorage) so a deliberate `page.reload()` in the persistence spec still
 * sees the save it just wrote.
 */
export async function bootPage(page: Page): Promise<Watcher> {
  const w = watch(page);
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('tm-e2e-cleared') !== '1') {
        localStorage.clear();
        sessionStorage.setItem('tm-e2e-cleared', '1');
      }
    } catch {
      /* storage unavailable — nothing to clear */
    }
  });
  await page.goto('/?testhooks=1');
  await page.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  return w;
}

/** Wait for `n` animation frames so the HUD has re-rendered. */
export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  }, n);
}

/** Live sim snapshot. */
export async function snap(page: Page): Promise<Snap> {
  return (await page.evaluate(() => window.__TOKENMAXXING__!.snapshot())) as Snap;
}

/** Fast-forward the sim, then let the UI catch up. */
export async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((n) => window.__TOKENMAXXING__!.advance(n), ms);
  await frames(page, 2);
}

export async function grant(page: Page, amount: number): Promise<void> {
  await page.evaluate((n) => window.__TOKENMAXXING__!.grant(n), amount);
  await frames(page, 2);
}

export async function setTimeScale(page: Page, k: number): Promise<void> {
  await page.evaluate((n) => window.__TOKENMAXXING__!.setTimeScale(n), k);
}

export async function clickLaptopHook(page: Page, n: number): Promise<void> {
  await page.evaluate((count) => window.__TOKENMAXXING__!.clickLaptop(count), n);
  await frames(page, 2);
}

export async function forceIncident(page: Page, id: string): Promise<void> {
  await page.evaluate((incident) => window.__TOKENMAXXING__!.forceIncident(incident), id);
  await frames(page, 2);
}

export async function forceDraft(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((cards) => window.__TOKENMAXXING__!.forceDraft(cards), ids);
  await frames(page, 2);
}

export async function resetSave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TOKENMAXXING__!.resetSave());
}

export async function renderStats(page: Page): Promise<{
  fps: number;
  particles: number;
  sprites: number;
  missingSprites: string[];
}> {
  return page.evaluate(() => window.__TOKENMAXXING__!.renderStats());
}

/**
 * Leave the title screen and restart the sim on a fixed seed with real time
 * frozen, so every later `advance()` is the only source of elapsed time.
 */
export async function startRun(page: Page, seed = 0x7a11): Promise<void> {
  await page.getByTestId(TID.startRun).click();
  await page.evaluate((s) => {
    const h = window.__TOKENMAXXING__!;
    h.setTimeScale(0);
    h.startRun(s);
  }, seed);
  await frames(page, 3);
  await expect(page.getByTestId(TID.shipButton)).toBeVisible();
}

/**
 * A real pointer click on the laptop art.
 *
 * `LAPTOP_RECT` is `{x:128, y:96, w:64, h:44}` in the 320x180 scene and the hit
 * surface is `inset: 0` over a stage that is exactly 320:180, so the centre of
 * the rect is at (0.5, 0.6556) of the element box.
 */
export async function clickLaptop(page: Page, times = 1): Promise<void> {
  const laptop = page.getByTestId(TID.laptop);
  const box = await laptop.boundingBox();
  expect(box, 'laptop hit area must have a box').not.toBeNull();
  const pos = { x: box!.width * 0.5, y: box!.height * 0.6556 };
  for (let i = 0; i < times; i++) {
    await laptop.click({ position: pos });
  }
  await frames(page, 2);
}

/** Locator for an agent shop row. */
export function agentRow(page: Page, id: string): Locator {
  return page.getByTestId(tid(TID.agentRow, id));
}

/** All draft cards currently offered. */
export function draftCards(page: Page): Locator {
  return page.locator(`[data-testid^="${TID.draftCard}-"]`);
}

/**
 * Ship the current project and take the first offered card, leaving the run on
 * the next project in `running` phase. Returns the number of ms advanced.
 */
export async function shipAndDraft(page: Page): Promise<void> {
  const before = await snap(page);
  const need = before.derived.requirement - before.run.slop;
  if (need > 0) await grant(page, need + 1);

  const shipBtn = page.getByTestId(TID.shipButton);
  await expect(shipBtn).toBeEnabled();
  await shipBtn.click();

  // 900ms celebration beat, then the draft opens on the next frame.
  await advance(page, 1200);
  await expect(page.getByTestId(TID.draftModal)).toBeVisible();
  await takeCard(page);
}

/**
 * Complete an open draft. Picking is two-step by design — clicking a card only
 * highlights it, and Confirm commits — so every caller goes through here rather
 * than assuming a click is a purchase.
 */
export async function takeCard(page: Page, id?: string): Promise<void> {
  const card = id ? page.getByTestId(tid(TID.draftCard, id)) : draftCards(page).first();
  await card.click();
  const confirm = page.getByTestId(TID.draftConfirm);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await frames(page, 3);
  await expect(page.getByTestId(TID.draftModal)).toBeHidden();
}

/** Rendered width of the ship-bar fill, in CSS pixels. */
export async function shipFillWidth(page: Page): Promise<number> {
  const box = await page.getByTestId(TID.shipBarFill).boundingBox();
  return box ? box.width : -1;
}
