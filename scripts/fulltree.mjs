import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1180, height: 1160 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__TOKENMAXXING__);
await p.evaluate(() => { try { localStorage.clear(); } catch {} });
await p.evaluate(() => {
  const meta = { ...window.__TOKENMAXXING__.snapshot().meta };
  meta.demos = 9999;
  for (const k of Object.keys(meta.levels)) meta.levels[k] = 99;
  localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(meta));
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__TOKENMAXXING__);
await p.getByTestId('title-meta').click();
await p.waitForTimeout(500);
await p.locator('.tm-tree').screenshot({ path: 'artifacts/tree-full.png' });
console.log('captured');
await b.close();
