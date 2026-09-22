import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.waitForTimeout(4500);

const geom = await p.evaluate(() => {
  const r = (n) => {
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const cli = document.querySelector('.tm-cli');
  return {
    viewport: { w: innerWidth, h: innerHeight },
    cli: r(cli),
    cliParent: r(cli?.parentElement),
    lines: document.querySelectorAll('.tm-cli__line').length,
    opacity: cli ? getComputedStyle(cli).opacity : null,
  };
});
console.log(JSON.stringify(geom, null, 2));
await p.screenshot({ path: 'artifacts/title-cli.png' });
await b.close();
