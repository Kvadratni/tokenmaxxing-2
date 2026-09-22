import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', m => console.log('['+m.type()+']', m.text().slice(0,200)));
p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,300)));
await p.goto('http://localhost:4199/tokenmaxxing.html', { waitUntil: 'load' });
await p.waitForTimeout(2500);
console.log('BODY:', (await p.locator('#app').innerText().catch(()=>'(none)')).slice(0,400));
await b.close();
