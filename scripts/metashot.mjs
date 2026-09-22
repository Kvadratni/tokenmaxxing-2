/**
 * Shots of the three places the meta loop is now explained: the run-over
 * modal, the `?` overlay's "Between runs" section, and the tree itself.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.evaluate(() => {
  try {
    localStorage.clear();
  } catch {
    /* private mode */
  }
});

// ---- help overlay, scrolled to the new section ----------------------------
await p.getByTestId('help-button').click();
await p.waitForTimeout(250);
await p.getByTestId('help-meta').scrollIntoViewIfNeeded();
await p.waitForTimeout(150);
await p.locator('.tm-help .tm-modal__panel').screenshot({ path: 'artifacts/help-meta.png' });
console.log('between-runs:', ((await p.getByTestId('help-meta').textContent()) ?? '').slice(0, 120));
await p.keyboard.press('Escape');

// ---- run over -------------------------------------------------------------
// The Start button switches the *screen*; the hook only restarts the sim.
await p.getByTestId('start-run').click();
await p.evaluate(() => {
  window.__TOKENMAXXING__.setTimeScale(0);
  window.__TOKENMAXXING__.startRun(7);
});
await p.waitForTimeout(200);
await p.evaluate(() => {
  const s = window.__TOKENMAXXING__.snapshot();
  window.__TOKENMAXXING__.grant(s.derived.requirement + 10);
});
await p.waitForTimeout(150);
await p.getByTestId('ship-button').click();
await p.evaluate(() => window.__TOKENMAXXING__.advance(1400));
await p.waitForTimeout(200);
const draft = p.getByTestId('draft-modal');
if (await draft.isVisible()) {
  await p.locator('[data-testid^="draft-card-"]').first().click();
  await p.getByTestId('draft-confirm').click();
  await p.waitForTimeout(200);
}
await p.evaluate(() => {
  const s = window.__TOKENMAXXING__.snapshot();
  window.__TOKENMAXXING__.advance(s.run.timeLeftMs + 800);
});
await p.waitForTimeout(300);
await p.locator('.tm-over .tm-modal__panel').screenshot({ path: 'artifacts/runover-meta.png' });
console.log('carry line:', await p.getByTestId('run-over-carry').textContent());
console.log('button    :', await p.getByTestId('run-over-continue').textContent());
console.log('errors    :', errs.length, errs.slice(0, 3).join(' | '));
await b.close();
