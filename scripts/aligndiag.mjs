import { chromium } from '@playwright/test';
const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
for (const [name, w, h] of [['portrait 430', 430, 932], ['portrait 390', 390, 844], ['portrait 375', 375, 667]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.getByTestId('start-run').click();
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => {
    const g = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), pad: cs.padding, box: cs.boxSizing };
    };
    return { hud: g('.tm-hud'), stage: g('.tm-stage'), shop: g('.tm-shop'), col: g('.tm-col'), main: g('.tm-main') };
  });
  console.log(`\n${name}`);
  for (const [k, v] of Object.entries(m)) {
    if (v) console.log(`  ${k.padEnd(6)} left=${String(v.l).padStart(6)} right=${String(v.r).padStart(6)} w=${String(v.w).padStart(6)}  pad=${v.pad}`);
  }
  const dl = Math.abs(m.stage.l - m.shop.l), dr = Math.abs(m.stage.r - m.shop.r);
  console.log(`  -> stage vs shop: left off by ${dl.toFixed(1)}px, right off by ${dr.toFixed(1)}px  ${dl < 0.6 && dr < 0.6 ? 'ALIGNED' : '*** MISALIGNED ***'}`);
  await ctx.close();
}
await b.close();
