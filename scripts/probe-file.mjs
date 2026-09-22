import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('console', m => m.type()==='error' && errs.push(m.text().slice(0,140)));
p.on('pageerror', e => errs.push('pageerror: '+e.message.slice(0,140)));
await p.goto('file://' + resolve('dist-single/tokenmaxxing.html'), { waitUntil: 'load' });
await p.waitForTimeout(2500);
const started = await p.getByTestId('start-run').count();
console.log('boots from file:// ?', started > 0 ? 'YES' : 'no');
if (started) {
  await p.getByTestId('start-run').click();
  await p.waitForTimeout(400);
  for (let i=0;i<20;i++) await p.getByTestId('laptop-hit').click({position:{x:400,y:300}});
  await p.waitForTimeout(400);
  console.log('slop after 20 clicks:', await p.getByTestId('hud-slop').textContent());
}
console.log('errors:', errs.length ? errs.slice(0,2).join(' | ') : 'none');
await b.close();
