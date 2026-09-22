import { chromium } from '@playwright/test';
const URL = 'https://kvadratni.github.io/tokenmaxxing/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const bad = [], errs = [];
p.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
const state = await p.evaluate(() => ({
  title: document.querySelector('[data-testid="title-screen"]') !== null,
  cliLines: document.querySelectorAll('.tm-cli__line').length,
  icons: getComputedStyle(document.querySelector('.tm-icon') ?? document.body).backgroundImage.slice(0, 60),
  hooks: Boolean(window.__TOKENMAXXING__),
}));
console.log('state :', JSON.stringify(state));
console.log('4xx/5xx:', bad.length, bad.slice(0, 5).join(' | '));
console.log('errors :', errs.length, errs.slice(0, 3).join(' | '));
await p.screenshot({ path: 'artifacts/live-pages.png' });
await b.close();
