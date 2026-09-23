/**
 * Boot: the page comes up clean, the contract surfaces exist, and the hook
 * API is present exactly when it should be.
 */
import { expect, test } from '@playwright/test';
import { ACHIEVEMENTS, META_UPGRADES } from '../../src/sim/content.ts';
import {
  SAVE_KEY,
  SEED,
  TID,
  advance,
  bootPage,
  clickAgent,
  clickAgentHook,
  expectClean,
  forceDraft,
  forceIncident,
  forcePickup,
  frames,
  grant,
  grantThumbs,
  resetSave,
  sel,
  setContext,
  setPatience,
  setTimeScale,
  snap,
  startRun,
  takeCard,
  tid,
  watch,
} from './harness.ts';

/**
 * Testids that are prefixes (`${base}-${id}`) or that only exist once
 * something happens (a toast, an incident, a coach tip). Everything else in
 * the frozen TID table must be in the DOM from the first frame.
 */
const DYNAMIC = new Set<string>([
  TID.toolRow,
  TID.toolCost,
  TID.toolOwned,
  TID.toolFootprint,
  TID.upgradeRow,
  TID.draftCard,
  TID.summaryCard,
  TID.metaRow,
  TID.metaBuy,
  TID.achievementRow,
  TID.achievementPopupCard,
  TID.activeCard,
  TID.coachTip,
  TID.coachDismiss,
  TID.incidentName,
  TID.incidentTimer,
  TID.toast,
]);

test.describe('boot', () => {
  test('boots to the title and plays a little with no errors or failed requests', async ({ page }) => {
    const w = await bootPage(page);
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
    await expect(page.getByTestId(TID.startRun)).toBeEnabled();
    // Let the async boot work land: the pixel font, the sprite atlas, the CLI.
    await page.waitForTimeout(1200);

    await startRun(page);
    await clickAgent(page, 3);
    await page.keyboard.press('Space');
    await advance(page, 5_000);
    await frames(page, 4);

    const stats = await page.evaluate(() => window.__TOKENMAXXING2__!.renderStats());
    expect(stats.missingSprites, 'every sprite the scene asks for is in the atlas').toEqual([]);
    expect(stats.sprites).toBeGreaterThan(0);
    expectClean(w);
    expect(w.badResponses, w.badResponses.join('\n')).toEqual([]);
  });

  test('without ?testhooks the hook API is absent and the game still plays', async ({ page }) => {
    const w = await bootPage(page, { hooks: false });
    expect(await page.evaluate(() => typeof window.__TOKENMAXXING2__)).toBe('undefined');

    await page.getByTestId(TID.startRun).click();
    await expect(page.getByTestId(TID.reportButton)).toBeVisible();
    const tokens = page.getByTestId(TID.tokens);
    await expect(tokens).toHaveText('0');
    await clickAgent(page, 4);
    // The wallet rolls up over a quarter second; poll until it lands.
    await expect.poll(async () => (await tokens.textContent())?.trim()).not.toBe('0');
    expectClean(w);
    expect(w.badResponses, w.badResponses.join('\n')).toEqual([]);
  });

  test('the hooks are TestHooks v2, with exactly the documented surface', async ({ page }) => {
    await bootPage(page);
    const shape = await page.evaluate(() => {
      const h = window.__TOKENMAXXING2__ as unknown as Record<string, unknown>;
      return {
        version: h['version'],
        fns: Object.keys(h).filter((k) => typeof h[k] === 'function').sort(),
      };
    });
    expect(shape.version).toBe(2);
    expect(shape.fns).toEqual(
      [
        'advance',
        'clickAgent',
        'forceDraft',
        'forceIncident',
        'forcePickup',
        'forceVerify',
        'grant',
        'grantThumbs',
        'importLegacy',
        'renderStats',
        'resetSave',
        'setContext',
        'setPatience',
        'setTimeScale',
        'snapshot',
        'startRun',
      ].sort(),
    );
    const s = await snap(page);
    expect(s.screen).toBe('title');
    expect(s.meta.runs).toBe(0);
    // A clean origin has no Tokenmaxxing 1 save to import, and says so once.
    expect(s.meta.legacy).toEqual({ verdict: 'none' });
  });

  test('the hooks do what TestHooks v2 says they do', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page); // setTimeScale(0) + startRun(seed)
    expect(s0.run.seed).toBe(SEED);

    await clickAgentHook(page, 3);
    let s = await snap(page);
    expect(s.run.clicks).toBe(3);

    const before = s.run.tokens;
    await grant(page, 123);
    s = await snap(page);
    expect(s.run.tokens).toBeCloseTo(before + 123, 6);

    await advance(page, 1_500);
    expect((await snap(page)).run.elapsedMs).toBeCloseTo(s.run.elapsedMs + 1_500, 6);

    await setContext(page, 0.5);
    expect((await snap(page)).derived.contextFill).toBeCloseTo(0.5, 6);
    await setPatience(page, 0.5);
    expect((await snap(page)).derived.patienceProgress).toBeCloseTo(0.5, 6);

    await forceIncident(page, 'lunch');
    expect((await snap(page)).run.incidents.map((i) => i.id)).toContain('lunch');
    await forcePickup(page, 'golden_token', 40, 40);
    expect((await snap(page)).run.pickup).toMatchObject({ id: 'golden_token', x: 40, y: 40 });

    await forceDraft(page, ['please', 'tip_200']);
    s = await snap(page);
    expect(s.run.phase).toBe('drafting');
    expect(s.run.draftOffer).toEqual(['please', 'tip_200']);

    const thumbs = s.meta.thumbs;
    await grantThumbs(page, 2);
    expect((await snap(page)).meta.thumbs).toBe(thumbs + 2);

    // Unknown ids are refused loudly rather than silently ignored.
    await expect(page.evaluate(() => window.__TOKENMAXXING2__!.forceIncident('no_such_incident'))).rejects.toThrow();

    // Real time runs again at scale 1.
    await takeCard(page);
    const t0 = (await snap(page)).run.elapsedMs;
    await setTimeScale(page, 1);
    await expect.poll(async () => (await snap(page)).run.elapsedMs).toBeGreaterThan(t0);
    await setTimeScale(page, 0);

    await resetSave(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).toBeNull();
  });

  test('every static testid is rendered, and the per-item ones cover their content', async ({ page }) => {
    await bootPage(page);
    // TID.cliBackdrop is retired (game 1's CLI backdrop): kept, never rendered.
    const staticIds = Object.values(TID).filter((id) => !DYNAMIC.has(id) && id !== TID.cliBackdrop);
    const missing = await page.evaluate(
      (ids) => ids.filter((id) => document.querySelector(`[data-testid="${id}"]`) === null),
      staticIds,
    );
    expect(missing, `testids missing from the DOM: ${missing.join(', ')}`).toEqual([]);

    // Training and achievements render one row per content entry.
    for (const def of META_UPGRADES) {
      await expect(page.getByTestId(tid(TID.metaRow, def.id))).toBeAttached();
      await expect(page.getByTestId(tid(TID.metaBuy, def.id))).toBeAttached();
    }
    for (const def of ACHIEVEMENTS) {
      await expect(page.getByTestId(tid(TID.achievementRow, def.id))).toBeAttached();
    }

    // The shop rail: the tier-1 tool has its row, price, count and footprint,
    // and the next rungs of the ladder are previewed, locked.
    await startRun(page);
    for (const base of [TID.toolRow, TID.toolCost, TID.toolOwned, TID.toolFootprint]) {
      await expect(page.getByTestId(tid(base, 'grep'))).toBeAttached();
    }
    await expect(page.getByTestId(tid(TID.toolRow, 'read'))).toBeDisabled();
  });

  test('the neural net behind the title never eats the New session click', async ({ page }) => {
    const w = await bootPage(page);
    const net = page.getByTestId(TID.netBackdrop);
    await expect(net).toBeAttached();
    await expect(net).toHaveAttribute('aria-hidden', 'true');
    await expect(net).toHaveCSS('pointer-events', 'none');

    const start = page.getByTestId(TID.startRun);
    const box = (await start.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x as number, y as number)?.closest('[data-testid]')?.getAttribute('data-testid') ??
        null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit, 'the backdrop is intercepting the New session button').toBe(TID.startRun);
    await start.click();
    await expect(page.getByTestId(TID.netBackdrop)).toBeHidden();
    expect((await snap(page)).screen).toBe('run');
    expectClean(w);
  });

  test('a production load with no save is quiet: no achievement, no notice', async ({ page }) => {
    const w = watch(page);
    await page.goto('/');
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.locator(sel(TID.legacyNotice))).toBeHidden();
    await expect(page.locator(`[data-testid^="${TID.achievementPopupCard}-"]`)).toHaveCount(0);
    expectClean(w);
  });
});
