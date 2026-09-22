import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1320, height: 1150 }, deviceScaleFactor: 2 });
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
console.log('loaded levels:', JSON.stringify((await p.evaluate(() => window.__TOKENMAXXING__.snapshot().meta.levels))).slice(0,200));
console.log('loaded demos:', await p.evaluate(() => window.__TOKENMAXXING__.snapshot().meta.demos));
await p.getByTestId('title-meta').click();
await p.waitForTimeout(400);
await p.getByTestId('meta-buy-unlock_harness').hover();
await p.waitForTimeout(400);
const tip = await p.getByTestId('meta-tip').innerText();
console.log('TOOLTIP:\n' + tip);
await p.screenshot({ path: 'artifacts/tree-tooltip.png' });
// A locked node should say so, not spoil itself.
await p.getByTestId('meta-buy-unlock_agi').hover();
await p.waitForTimeout(300);
console.log('\nLOCKED TOOLTIP:\n' + (await p.getByTestId('meta-tip').innerText()));
await b.close();
