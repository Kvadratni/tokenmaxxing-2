/**
 * Layout sanity across a matrix of real screen sizes.
 *
 *   node scripts/layoutsweep.mjs            # dev server on :5185
 *   GAME_URL=https://... node scripts/layoutsweep.mjs
 *
 * For each viewport, on both the title and the run screen, checks the things
 * that actually break: horizontal scroll, content clipped off an edge, the
 * stage wider than the viewport, and whether the two controls you cannot play
 * without — the laptop and Ship It — are on screen and big enough to hit.
 *
 * `isMobile` is set for the phone sizes on purpose. Without it the context is a
 * narrow desktop, which hid a 125px overflow and a dead touch surface.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';

/** Apple's minimum comfortable touch target. */
const MIN_TAP = 44;

const SIZES = [
  // phones, portrait
  { name: 'iPhone SE', w: 375, h: 667, mobile: true },
  { name: 'iPhone 13', w: 390, h: 844, mobile: true },
  { name: 'iPhone 15 Pro Max', w: 430, h: 932, mobile: true },
  { name: 'Pixel 7', w: 412, h: 915, mobile: true },
  { name: 'Galaxy S8 (narrow)', w: 360, h: 740, mobile: true },
  { name: 'tiny phone', w: 320, h: 568, mobile: true },
  // phones, landscape
  { name: 'iPhone 13 landscape', w: 844, h: 390, mobile: true },
  { name: 'iPhone SE landscape', w: 667, h: 375, mobile: true },
  // tablets
  { name: 'iPad mini', w: 768, h: 1024, mobile: true },
  { name: 'iPad Pro 11', w: 834, h: 1194, mobile: true },
  { name: 'iPad Pro landscape', w: 1194, h: 834, mobile: true },
  // desktop
  { name: 'small laptop', w: 1280, h: 720, mobile: false },
  { name: 'laptop', w: 1440, h: 900, mobile: false },
  { name: 'desktop', w: 1920, h: 1080, mobile: false },
  { name: 'ultrawide', w: 2560, h: 1080, mobile: false },
  { name: 'short window', w: 1440, h: 560, mobile: false },
  { name: 'very short', w: 1280, h: 420, mobile: false },
];

const b = await chromium.launch();
let failures = 0;

/** Everything measurable about the current layout. */
const probe = () => {
  const de = document.documentElement;
  const ui = document.querySelector('.tm-ui');
  const stage = document.querySelector('.tm-stage');
  const box = (sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const clipped = [];
  for (const n of document.querySelectorAll('.tm-ui *')) {
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left < -1 || r.right > de.clientWidth + 1) {
      clipped.push(`${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`);
    }
  }
  return {
    clientW: de.clientWidth,
    clientH: de.clientHeight,
    scrollW: de.scrollWidth,
    px: ui ? Number.parseFloat(getComputedStyle(ui).getPropertyValue('--px')) : 0,
    layout: ui?.dataset.layout ?? '-',
    stageW: stage ? stage.getBoundingClientRect().width : 0,
    laptop: box('[data-testid="laptop-hit"]'),
    // How much of the screen the game actually occupies. Passing every
    // "nothing is broken" check while using half the screen is still a fail.
    usedW: (() => {
      let min = Infinity, max = -Infinity;
      for (const n of document.querySelectorAll('.tm-hud, .tm-stage, .tm-shop, .tm-title__actions')) {
        const r = n.getBoundingClientRect();
        if (r.width === 0) continue;
        // Same skip as usedH: a shut bottom-sheet shop is full-bleed and parked
        // at translateY(100%), so counting it reported 100%w on a landscape
        // phone that is really only using half its width.
        if (r.top >= de.clientHeight - 1 || r.bottom <= 1) continue;
        min = Math.min(min, r.left); max = Math.max(max, r.right);
      }
      return Number.isFinite(min) ? max - min : 0;
    })(),
    usedH: (() => {
      let min = Infinity, max = -Infinity;
      for (const n of document.querySelectorAll('.tm-topbar, .tm-hud, .tm-stage, .tm-shop, .tm-cards')) {
        const r = n.getBoundingClientRect();
        if (r.width === 0) continue;
        // Skip anything parked off-screen: a closed bottom-sheet shop sits at
        // translateY(100%) by design, and counting it read as 171% utilisation.
        if (r.top >= de.clientHeight - 1 || r.bottom <= 1) continue;
        min = Math.min(min, Math.max(0, r.top));
        max = Math.max(max, Math.min(de.clientHeight, r.bottom));
      }
      return Number.isFinite(min) ? max - min : 0;
    })(),
    ship: box('[data-testid="ship-button"]'),
    clipped: [...new Set(clipped)].slice(0, 4),
  };
};

for (const s of SIZES) {
  const ctx = await b.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: s.mobile ? 2 : 1,
    hasTouch: s.mobile,
    isMobile: s.mobile,
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.evaluate(() => {
    try {
      localStorage.clear();
    } catch {
      /* private mode */
    }
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.waitForTimeout(400);

  const title = await p.evaluate(probe);
  // Into a run, where the stage and the shop rail both exist.
  await p.getByTestId('start-run').click();
  await p.evaluate(() => window.__TOKENMAXXING__.setTimeScale(0));
  await p.waitForTimeout(400);
  const run = await p.evaluate(probe);

  const bad = [];
  for (const [where, m] of [
    ['title', title],
    ['run', run],
  ]) {
    if (m.scrollW > m.clientW + 1) bad.push(`${where}: h-scroll ${m.scrollW}>${m.clientW}`);
    if (m.clipped.length) bad.push(`${where}: clipped ${m.clipped.join(',')}`);
    if (m.stageW > m.clientW + 1) bad.push(`${where}: stage ${Math.round(m.stageW)}>${m.clientW}`);
  }
  if (!run.laptop || run.laptop.w < MIN_TAP || run.laptop.h < MIN_TAP) {
    bad.push(`laptop too small ${run.laptop ? `${Math.round(run.laptop.w)}x${Math.round(run.laptop.h)}` : 'missing'}`);
  }
  // Only enforced where a thumb is doing the pointing. On a mouse-driven
  // screen a 34px control is perfectly clickable and the integer pixel layout
  // matters more.
  if (!run.ship || (s.mobile && run.ship.h < MIN_TAP)) {
    bad.push(`ship target ${run.ship ? `${Math.round(run.ship.h)}px tall` : 'missing'}`);
  }
  if (run.ship && (run.ship.y < 0 || run.ship.y + run.ship.h > run.clientH + 1)) {
    bad.push(`ship off-screen vertically (y=${Math.round(run.ship.y)})`);
  }
  if (errs.length) bad.push(`${errs.length} page errors`);

  const ok = bad.length === 0;
  if (!ok) failures += 1;
  const fillW = Math.round((run.usedW / run.clientW) * 100);
  const fillH = Math.round((run.usedH / run.clientH) * 100);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(20)} ${String(s.w).padStart(4)}x${String(s.h).padEnd(5)} px=${String(run.px).padEnd(4)} ${run.layout.padEnd(8)} fill ${String(fillW).padStart(3)}%w ${String(fillH).padStart(3)}%h${ok ? '' : '   ' + bad.join(' | ')}`,
  );
  await ctx.close();
}

console.log(`\n${SIZES.length - failures}/${SIZES.length} viewports clean`);
await b.close();
process.exitCode = failures > 0 ? 1 : 0;
