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
await p.waitForTimeout(400);

const box = await p.getByTestId('laptop-hit').boundingBox();
const x = box.x + box.width * 0.5, y = box.y + box.height * 0.6556;
console.log(JSON.stringify(await p.evaluate(([tx, ty]) => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  const scale = r.width / 320;
  return {
    canvasRectFresh: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1) },
    scale,
    // What toScene *should* produce with a fresh rect:
    sceneFresh: { x: +((tx - r.left) / scale).toFixed(1), y: +((ty - r.top) / scale).toFixed(1) },
    // What it produces if left/top were cached as 0 (never re-measured):
    sceneIfStale: { x: +(tx / scale).toFixed(1), y: +(ty / scale).toFixed(1) },
    laptopRect: 'x 128..192, y 96..140',
    scrollX: window.scrollX, scrollY: window.scrollY,
  };
}, [x, y]), null, 1));
await b.close();
