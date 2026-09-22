/**
 * Does tapping the laptop actually produce slop on a touchscreen?
 *
 * Uses `tap()`, not `click()`: Playwright's click dispatches mouse events even
 * on a mobile context, so the existing @mobile suite would not catch a
 * touch-only failure.
 */
import { chromium, devices } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();

for (const [label, ctxOpts] of [
  ['iPhone 13   ', devices['iPhone 13']],
  ['Pixel 5     ', devices['Pixel 5']],
  ['touch+mouse ', { viewport: { width: 900, height: 700 }, hasTouch: true }],
]) {
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.getByTestId('start-run').tap();
  await p.evaluate(() => window.__TOKENMAXXING__.setTimeScale(0));
  await p.waitForTimeout(200);

  const before = await p.evaluate(() => window.__TOKENMAXXING__.snapshot().run);
  // Tap the laptop art, same spot the harness clicks.
  const box = await p.getByTestId('laptop-hit').boundingBox();
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.6556;
  for (let i = 0; i < 5; i++) await p.touchscreen.tap(x, y);
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__TOKENMAXXING__.snapshot().run);

  // Which events actually reach the hit area?
  const seen = await p.evaluate(async ([tx, ty]) => {
    const el = document.querySelector('[data-testid="laptop-hit"]');
    const got = [];
    const names = ['pointerdown', 'touchstart', 'mousedown', 'click', 'pointercancel'];
    const fns = names.map((n) => {
      const fn = () => got.push(n);
      el.addEventListener(n, fn);
      return [n, fn];
    });
    await new Promise((r) => setTimeout(r, 50));
    return { got, tx, ty, fns: fns.length };
  }, [x, y]);

  console.log(
    `${label} taps=5  clicks ${before.clicks} -> ${after.clicks}  slop ${before.slop.toFixed(0)} -> ${after.slop.toFixed(0)}  ${
      after.clicks > before.clicks ? 'OK' : '*** BROKEN ***'
    }  errors=${errs.length}`,
  );
  void seen;
  await ctx.close();
}
await b.close();
