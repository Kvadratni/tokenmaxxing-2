import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 1200 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__TOKENMAXXING__);
await p.evaluate(() => { try { localStorage.clear(); } catch {} });
await p.evaluate(() => {
  // A save without `version` is rejected by loadMeta and silently replaced
  // with a fresh one, so write a complete record.
  const snap = window.__TOKENMAXXING__.snapshot();
  const meta = { ...snap.meta };
  meta.demos = 200;
  meta.levels = { ...meta.levels, unlock_swarm:1, unlock_ralph:1, cracked:3,
                  unlock_autoclicker:1, seed_funding:2, unlock_model_cards:1,
                  unlock_yolo:1, unlock_skip:1 };
  localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(meta));
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__TOKENMAXXING__);
await p.getByTestId('title-meta').click();
await p.waitForTimeout(500);
await p.locator('.tm-tree').screenshot({ path: 'artifacts/tree-even.png' });
await b.close();
