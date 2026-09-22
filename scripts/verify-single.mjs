import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errs = [];
p.on('console', m => m.type()==='error' && errs.push(m.text()));
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p.goto('http://localhost:4199/tokenmaxxing.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByTestId('start-run').click();
await p.waitForTimeout(400);
for (let i=0;i<25;i++){ await p.getByTestId('laptop-hit').click({position:{x:400,y:300}}); }
await p.waitForTimeout(600);
const slop = await p.getByTestId('hud-slop').textContent();
const reqs = await p.evaluate(() => document.querySelectorAll('[data-testid^="agent-row-"]').length);
await p.screenshot({ path: 'artifacts/single-file.png' });
console.log('slop after 25 clicks:', slop);
console.log('agent rows visible:', reqs);
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
