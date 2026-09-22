/** Why does --px end up 2 when computeScale says 1? Trace it over the load. */
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
});
const p = await ctx.newPage();
await p.addInitScript(() => {
  window.__TRACE__ = [];
  const snap = (why) => {
    const ui = document.querySelector('.tm-ui');
    window.__TRACE__.push({
      why,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      docW: document.documentElement.clientWidth,
      px: ui ? getComputedStyle(ui).getPropertyValue('--px').trim() : '-',
      layout: ui ? (ui.dataset.layout ?? '-') : '-',
      scrollW: document.documentElement.scrollWidth,
    });
  };
  window.addEventListener('resize', () => snap('resize'));
  document.addEventListener('DOMContentLoaded', () => snap('domcontentloaded'));
  window.addEventListener('load', () => snap('load'));
  for (const ms of [0, 100, 400, 900, 1600]) setTimeout(() => snap(`t+${ms}`), ms);
});
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForTimeout(1900);
for (const r of await p.evaluate(() => window.__TRACE__)) {
  console.log(
    `${String(r.why).padEnd(18)} innerW=${String(r.innerW).padEnd(5)} docW=${String(r.docW).padEnd(5)} px=${String(r.px).padEnd(4)} layout=${String(r.layout).padEnd(8)} scrollW=${r.scrollW}`,
  );
}
await b.close();
