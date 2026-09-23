/**
 * Smoke-check a build the way a player meets it: no 4xx/5xx responses, no
 * failed requests, no page errors or console errors, and a session that starts
 * and takes a click.
 *
 *   node scripts/livecheck.mjs                                     # dev server on :5185
 *   node scripts/livecheck.mjs https://kvadratni.github.io/tokenmaxxing-2/
 *   GAME_URL=http://localhost:4185/ node scripts/livecheck.mjs     # a preview build
 *
 * Deliberately without `?testhooks=1`: this is the page as shipped. Writes a
 * screenshot to artifacts/livecheck.png and exits 1 on any finding.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? process.env.GAME_URL ?? 'http://localhost:5185/';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const bad = [];
const errs = [];
p.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
});
p.on('requestfailed', (r) => bad.push(`failed ${r.url()} ${r.failure()?.errorText ?? ''}`));
p.on('console', (m) => m.type() === 'error' && errs.push(`console: ${m.text()}`));
p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

await p.goto(URL, { waitUntil: 'networkidle' });
const title = await p.getByTestId('title-screen').isVisible().catch(() => false);
await p.waitForTimeout(1_500);

// Play for a moment: start a session and click the agent. A fresh visitor
// gets the first-run tour first, so skip it the way a player would.
let played = false;
let tour = 'not shown';
if (title) {
  await p.getByTestId('start-run').click();
  await p.getByTestId('report-button').waitFor({ timeout: 10_000 });
  const skip = p.getByTestId('tour-skip');
  if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skip.click();
    await p.getByTestId('tour').waitFor({ state: 'hidden', timeout: 5_000 });
    tour = 'shown, skipped';
  }
  const before = (await p.getByTestId('hud-tokens').textContent())?.trim();
  for (let i = 0; i < 5; i++) await p.getByTestId('agent-hit').click();
  await p.waitForTimeout(600);
  const after = (await p.getByTestId('hud-tokens').textContent())?.trim();
  played = before !== after;
}
const state = await p.evaluate(() => ({ hooks: typeof window.__TOKENMAXXING2__ !== 'undefined' }));
mkdirSync('artifacts', { recursive: true });
await p.screenshot({ path: 'artifacts/livecheck.png' });

// The dev server always exposes the hooks (import.meta.env.DEV); only a
// production build must hide them.
const isDev = /:5185\b/.test(URL);
console.log('url     :', URL);
console.log('title   :', title ? 'yes' : 'NO');
console.log('tour    :', tour);
console.log('played  :', played ? 'clicks generate tokens' : 'NO: the wallet did not move');
console.log(
  'hooks   :',
  state.hooks ? (isDev ? 'exposed (expected on the dev server)' : 'EXPOSED without ?testhooks') : 'hidden',
);
console.log('4xx/5xx :', bad.length, bad.slice(0, 5).join(' | '));
console.log('errors  :', errs.length, errs.slice(0, 3).join(' | '));
await b.close();

const ok = title && played && bad.length === 0 && errs.length === 0 && (isDev || !state.hooks);
process.exitCode = ok ? 0 : 1;
