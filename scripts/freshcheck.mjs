import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('https://kvadratni.github.io/tokenmaxxing/', { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.getByTestId('title-achievements').click();
await p.waitForTimeout(500);
console.log(JSON.stringify(await p.evaluate(() => ({
  count: document.querySelector('[data-testid="achievements-count"]')?.textContent,
  withText: Array.from(document.querySelectorAll('.tm-achv__name')).filter(n => (n.textContent ?? '').length > 0).length,
  secret: document.querySelectorAll('.tm-achv__row.is-secret').length,
  blurbs: Array.from(document.querySelectorAll('.tm-achv__blurb')).filter(n => (n.textContent ?? '').length > 0).length,
}))));
await b.close();
