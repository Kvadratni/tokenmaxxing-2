import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const w of [1145, 1440, 1920]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !!window.__TOKENMAXXING__);
  await p.getByTestId('title-meta').click();
  await p.waitForTimeout(400);
  const bad = await p.evaluate(() => {
    const ns = [...document.querySelectorAll('.tm-node')].map(n => n.getBoundingClientRect());
    let hits = 0;
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], c = ns[j];
        if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) hits++;
      }
    return hits;
  });
  console.log(`viewport ${w}: overlapping node pairs = ${bad}`);
  if (w === 1145) await p.screenshot({ path: 'artifacts/tree-fixed.png' });
  await p.close();
}
await b.close();
