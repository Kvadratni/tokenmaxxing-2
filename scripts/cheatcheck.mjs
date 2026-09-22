/**
 * Cheat detection on the *dev* server, without ?testhooks=1 — i.e. exactly what
 * a developer playing locally and editing their own save experiences.
 */
import { chromium } from '@playwright/test';
const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

// Play a little so a real, signed save exists.
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
await p.waitForTimeout(500);

for (const [label, edit] of [
  ['honeypot true   ', (r) => { r.cheats_enabled = true; }],
  ['honeypot "true" ', (r) => { r.cheats_enabled = 'true'; }],
  ['demos bumped    ', (r) => { r.demos = 999999; }],
  // Not a `nice_try` case: this probe cannot recompute the signature from
  // outside the bundle, so an absurd save still reads as a plain edit. The
  // forged-signature path is covered in tests/unit/sim.achievements.test.ts,
  // which can import signSave directly.
  ['absurd, unsigned', (r) => { r.wins = 99; r.runs = 0; }],
]) {
  await p.evaluate((fnBody) => {
    const raw = JSON.parse(localStorage.getItem('tokenmaxxing2.save.v1'));
    delete raw.achievements.script_kiddie;
    delete raw.achievements.nice_try;
    // eslint-disable-next-line no-new-func
    new Function('r', fnBody)(raw);
    localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(raw));
  }, `(${edit.toString()})(r)`);

  // Plain dev URL: no testhooks, so detection must be live.
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const got = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('tokenmaxxing2.save.v1'));
    return Object.keys(raw.achievements ?? {}).filter((k) => k === 'script_kiddie' || k === 'nice_try');
  });
  const popup = await p.locator('.tm-achv-pop__name').first().textContent().catch(() => null);
  console.log(`${label} -> ${JSON.stringify(got).padEnd(20)} popup: ${popup}`);
}
console.log('errors:', errs.length);
await b.close();
