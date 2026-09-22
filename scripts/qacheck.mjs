/**
 * Does driving the game through the debug API actually earn QA Engineer?
 *
 * This is the path the player's autoclicker overlay uses: `?testhooks=1`, then
 * clickLaptop/setTimeScale on a loop.
 */
import { chromium } from '@playwright/test';
const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));

// Reading state must NOT count: looking is not playing.
const afterRead = await p.evaluate(() => {
  const h = window.__TOKENMAXXING__;
  h.snapshot();
  h.renderStats();
  return h.snapshot().meta.achievements;
});
console.log('after snapshot/renderStats :', JSON.stringify(afterRead));

// Now do what the overlay does.
await p.getByTestId('start-run').click();
const afterDrive = await p.evaluate(() => {
  const h = window.__TOKENMAXXING__;
  h.setTimeScale(0);
  for (let i = 0; i < 5; i++) h.clickLaptop(400);
  return h.snapshot().meta.achievements;
});
await p.waitForTimeout(800);
console.log('after setTimeScale+clicks  :', JSON.stringify(afterDrive));
const popup = await p.locator('.tm-achv-pop__name').first().textContent().catch(() => null);
const blurb = await p.locator('.tm-achv-pop__blurb').first().textContent().catch(() => null);
console.log('popup                      :', popup, '|', blurb);
console.log('errors                     :', errs.length);
await b.close();
