/**
 * Boot: the page loads clean, the title screen renders, the test hooks are
 * installed at the contracted version, and the renderer found every sprite.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { TID, bootPage, frames, renderStats, snap, startRun } from './harness.ts';

const ATLAS_PATH = fileURLToPath(new URL('../../src/render/atlas.ts', import.meta.url));

test.describe('boot', () => {
  test('loads with zero console errors and zero page errors', async ({ page }) => {
    const w = await bootPage(page);
    await expect(page.getByTestId(TID.app)).toBeVisible();
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
    await frames(page, 10);
    expect(w.errors, `page produced errors:\n${w.errors.join('\n')}`).toEqual([]);
  });

  test('installs TestHooks at version 1', async ({ page }) => {
    await bootPage(page);
    const version = await page.evaluate(() => window.__TOKENMAXXING__?.version);
    expect(version).toBe(1);
  });

  test('production build without ?testhooks= stays inert', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
    const hooks = await page.evaluate(() => Boolean(window.__TOKENMAXXING__));
    expect(hooks, 'hooks must not leak into a normal production load').toBe(false);
  });

  test('title screen exposes the start control and the scene canvas', async ({ page }) => {
    await bootPage(page);
    await expect(page.getByTestId(TID.startRun)).toBeVisible();
    await expect(page.getByTestId(TID.startRun)).toBeEnabled();
    const canvas = page.getByTestId(TID.scene);
    await expect(canvas).toBeAttached();
    // The scene *coordinate space* is 320x180; the backing store is that space
    // times an integer scale, so the ratio must be exact and the factor whole.
    const dims = await canvas.evaluate((el) => ({
      w: (el as HTMLCanvasElement).width,
      h: (el as HTMLCanvasElement).height,
    }));
    expect(dims.w % 320, `canvas width ${dims.w} is not an integer multiple of 320`).toBe(0);
    expect(dims.h % 180, `canvas height ${dims.h} is not an integer multiple of 180`).toBe(0);
    expect(dims.w / 320).toBe(dims.h / 180);
  });

  test('snapshot is structured-cloneable and reports the run phase', async ({ page }) => {
    await bootPage(page);
    const s = await snap(page);
    expect(s.run).toBeTruthy();
    expect(s.meta).toBeTruthy();
    expect(s.derived).toBeTruthy();
    expect(typeof s.run.phase).toBe('string');
  });

  test('renderer reports no missing sprites', async ({ page }) => {
    test.skip(
      !existsSync(ATLAS_PATH),
      'src/render/atlas.ts does not exist yet — the ART agent has not landed the atlas.',
    );
    const w = await bootPage(page);
    await startRun(page);
    // Give the atlas image load a moment; sprites resolve asynchronously.
    await page.waitForTimeout(1500);
    await frames(page, 5);
    const stats = await renderStats(page);
    expect(
      stats.missingSprites,
      `renderer could not resolve: ${stats.missingSprites.join(', ')}`,
    ).toEqual([]);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });
});
