/** The unlock popup, mid-slide and settled, plus queue behaviour. */
import { chromium } from '@playwright/test';
const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push(String(e)));
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
  h.grant(h.snapshot().derived.requirement + 5);
});
await p.waitForTimeout(200);
await p.getByTestId('ship-button').click();
await p.waitForTimeout(900); // slid in

const card = await p.evaluate(() => {
  const c = document.querySelector('.tm-achv-pop__card');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const cs = getComputedStyle(c);
  return {
    testid: c.dataset.testid,
    name: c.querySelector('.tm-achv-pop__name')?.textContent,
    blurb: c.querySelector('.tm-achv-pop__blurb')?.textContent,
    onScreen: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left > 0,
    opacity: cs.opacity,
    transform: cs.transform,
    pointerEvents: getComputedStyle(document.querySelector('.tm-achv-pop')).pointerEvents,
    queued: document.querySelectorAll('.tm-achv-pop__card').length,
  };
});
console.log('card :', JSON.stringify(card));
await p.screenshot({ path: 'docs/screenshots/07-achievement-popup.png' });

// It must not be able to eat a click on the rail beneath it.
const hit = await p.evaluate(() => {
  const c = document.querySelector('.tm-achv-pop__card');
  const r = c.getBoundingClientRect();
  const n = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return n?.closest('[data-testid]')?.getAttribute('data-testid') ?? n?.className ?? null;
});
console.log('hit test under card:', hit);
console.log('errors:', errs.length, errs.slice(0, 2).join(' | '));
await b.close();
