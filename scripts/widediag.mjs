import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
console.log(JSON.stringify(await p.evaluate(() => {
  const out = { innerWidth: innerWidth, docScrollW: document.documentElement.scrollWidth, px: getComputedStyle(document.querySelector('.tm-ui')).getPropertyValue('--px'), wide: [] };
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > innerWidth + 1) {
      out.wide.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 34), w: Math.round(r.width), left: Math.round(r.left) });
    }
  }
  out.wide = out.wide.slice(0, 8);
  return out;
}), null, 1));
await b.close();
