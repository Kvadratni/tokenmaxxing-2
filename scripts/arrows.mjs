import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__TOKENMAXXING__);
await p.getByTestId('start-run').click();
await p.evaluate(() => window.__TOKENMAXXING__.forceDraft(['haiku','sonnet','opus']));
await p.waitForTimeout(400);
const cards = async () => p.evaluate(() =>
  [...document.querySelectorAll('[data-testid^="draft-card-"]')]
    .map(n => n.getAttribute('data-testid').replace('draft-card-','') + (n.classList.contains('is-selected') ? '*' : '')).join(' '));
console.log('on open      :', await cards());
await p.keyboard.press('Enter');
await p.waitForTimeout(200);
console.log('Enter (inert):', await cards(), '| cards taken:', (await p.evaluate(() => window.__TOKENMAXXING__.snapshot().run.cards)).length);
await p.keyboard.press('ArrowRight');
console.log('ArrowRight   :', await cards());
await p.keyboard.press('ArrowRight');
console.log('ArrowRight   :', await cards());
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
console.log('Enter (take) :', JSON.stringify(await p.evaluate(() => window.__TOKENMAXXING__.snapshot().run.cards)));
await p.screenshot({ path: 'artifacts/draft-arrows.png' });
await b.close();
