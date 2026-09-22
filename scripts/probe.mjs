import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 3 });
// Genuinely blank: no save at all.
await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__TOKENMAXXING__);
await p.getByTestId('start-run').click();
await p.waitForTimeout(700);
const s = await p.evaluate(() => {
  const h = window.__TOKENMAXXING__.snapshot();
  return {
    agents: h.run.agents,
    owned: h.run.owned,
    slop: h.run.slop,
    metaLevels: h.meta.levels,
    demos: h.meta.demos,
  };
});
console.log('agents at run start:', JSON.stringify(s.agents));
console.log('meta levels:', JSON.stringify(s.metaLevels), '| demos:', s.demos);
console.log('starting slop:', s.slop, '| owned upgrades:', JSON.stringify(s.owned));
await p.locator('[data-testid="scene-canvas"]').screenshot({ path: 'artifacts/blank-run.png' });
await b.close();
