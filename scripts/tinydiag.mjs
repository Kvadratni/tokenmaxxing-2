import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.goto('http://localhost:5185/?testhooks=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.getByTestId('start-run').click();
await p.waitForTimeout(600);
console.log(JSON.stringify(await p.evaluate(() => {
  const de = document.documentElement;
  const out = { clientW: de.clientWidth, scrollW: de.scrollWidth, offenders: [] };
  for (const n of document.querySelectorAll('*')) {
    const r = n.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > de.clientWidth + 0.5 || r.left < -0.5) {
      const cs = getComputedStyle(n);
      out.offenders.push({
        sel: n.tagName.toLowerCase() + '.' + String(n.className).split(' ').slice(0,2).join('.'),
        left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1),
        pos: cs.position, inset: `${cs.left}/${cs.right}`,
      });
    }
  }
  out.offenders = out.offenders.slice(0, 6);
  return out;
}), null, 1));
await b.close();
