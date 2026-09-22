import { chromium, devices } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext(devices['iPhone 13']);
const p = await ctx.newPage();
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.getByTestId('start-run').tap();
await p.evaluate(() => window.__TOKENMAXXING__.setTimeScale(0));
await p.waitForTimeout(300);

// Record every event that reaches the hit area, before tapping.
await p.evaluate(() => {
  window.__EV__ = [];
  const el = document.querySelector('[data-testid="laptop-hit"]');
  for (const n of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'mousedown', 'click']) {
    el.addEventListener(n, (e) => window.__EV__.push({ n, x: e.clientX ?? null, t: e.pointerType ?? null }));
  }
});

const box = await p.getByTestId('laptop-hit').boundingBox();
const x = box.x + box.width * 0.5;
const y = box.y + box.height * 0.6556;
console.log('viewport   :', await p.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })));
console.log('hit box    :', JSON.stringify(box));
console.log('tap at     :', x.toFixed(1), y.toFixed(1));
console.log('elementAt  :', await p.evaluate(([a, c]) => {
  const n = document.elementFromPoint(a, c);
  return n ? (n.dataset?.testid ?? n.className) : null;
}, [x, y]));
console.log('px scale   :', await p.evaluate(() => getComputedStyle(document.querySelector('.tm-ui')).getPropertyValue('--px')));

await p.touchscreen.tap(x, y);
await p.waitForTimeout(300);
console.log('events     :', JSON.stringify(await p.evaluate(() => window.__EV__)));
console.log('clicks     :', await p.evaluate(() => window.__TOKENMAXXING__.snapshot().run.clicks));
await b.close();
