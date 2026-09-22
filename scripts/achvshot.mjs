/**
 * Achievements screen + the Script Kiddie path, end to end in a real browser.
 *
 * Note the deliberate absence of `?testhooks=1` for the cheating checks: the
 * hooks set `trustSave`, which switches tampering detection off so the QA suite
 * does not accuse itself. Catching a real edit has to be tested without them.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push(String(e)));

// ---- 1. earn something honestly, with hooks on ----------------------------
await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));

await p.getByTestId('start-run').click();
await p.evaluate(() => {
  const h = window.__TOKENMAXXING__;
  h.setTimeScale(0);
  h.startRun(5);
  const s = h.snapshot();
  h.grant(s.derived.requirement + 5);
});
await p.waitForTimeout(200);
await p.getByTestId('ship-button').click();
await p.waitForTimeout(400);
const earned = await p.evaluate(() => window.__TOKENMAXXING__.snapshot().meta.achievements);
console.log('earned by shipping :', JSON.stringify(earned));

// ---- 2. the screen -------------------------------------------------------
// A full goto rather than location.reload(): reload races waitForFunction,
// which can resolve against the pre-navigation page.
await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.getByTestId('title-achievements').waitFor({ state: 'visible' });
await p.getByTestId('title-achievements').click();
await p.waitForTimeout(400);
const shown = await p.evaluate(() => ({
  count: document.querySelector('[data-testid="achievements-count"]')?.textContent,
  rows: document.querySelectorAll('[data-testid^="achievement-row-"]').length,
  secret: document.querySelectorAll('.tm-achv__row.is-secret').length,
  earnedRows: document.querySelectorAll('.tm-achv__row.is-earned').length,
  // A hidden, unearned row must not leak its real name.
  leaks: Array.from(document.querySelectorAll('.tm-achv__row.is-secret .tm-achv__name'))
    .map((n) => n.textContent)
    .filter((t) => t !== '???'),
}));
console.log('screen             :', JSON.stringify(shown));
await p.mouse.move(2, 2);
await p.locator('[data-testid="achievements-screen"]').screenshot({
  path: 'docs/screenshots/06-achievements.png',
});

// ---- 3. now cheat, with hooks OFF ---------------------------------------
const cheated = await p.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tokenmaxxing2.save.v1'));
  raw.demos = 999999;
  localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(raw));
  return { hadSig: typeof raw.sig === 'string', honeypot: raw.cheats_enabled };
});
console.log('save fields        :', JSON.stringify(cheated));

await p.goto(URL, { waitUntil: 'networkidle' }); // no testhooks -> detection live
await p.waitForTimeout(900);
const caught = await p.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tokenmaxxing2.save.v1'));
  return { achievements: raw.achievements, demos: raw.demos };
});
console.log('after cheating     :', JSON.stringify(caught));
const toast = await p.locator('[data-testid^="toast"]').first().textContent().catch(() => null);
console.log('toast              :', toast);
console.log('console errors     :', errs.length, errs.slice(0, 3).join(' | '));
await b.close();
