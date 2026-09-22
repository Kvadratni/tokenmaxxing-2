/**
 * Phone screenshots, portrait and landscape, shop shut and shop showing.
 *
 *   node scripts/phoneshot.mjs            # dev server on :5185
 *   GAME_URL=https://... node scripts/phoneshot.mjs
 *
 * Four files land in artifacts/:
 *   phone-portrait.png        the board, shop in the flow below it
 *   phone-portrait-shop.png   scrolled to the shop, to judge the rows
 *   phone-landscape.png       the board, shop drawer shut
 *   phone-landscape-shop.png  the drawer open over the board
 *
 * Portrait has height to spare so the shop stays in the flow and there is no
 * drawer to open — see `DRAWER_MAX_VH` in src/ui/scale.ts. The second portrait
 * shot scrolls the in-flow shop into view instead, so both form factors get a
 * before/after pair of the same thing: can you read and hit a shop row.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';

const VIEWPORTS = [
  ['portrait', 430, 932],
  ['landscape', 932, 430],
];

const b = await chromium.launch();

for (const [name, w, h] of VIEWPORTS) {
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const p = await ctx.newPage();
  await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.getByTestId('start-run').click();

  // Some slop and a few agents owned, so the rows have real numbers in them.
  // Clicked through the DOM rather than the pointer: in landscape the rows are
  // inside a shut drawer, parked off the bottom of the screen.
  await p.evaluate(() => {
    const hooks = window.__TOKENMAXXING__;
    hooks.setTimeScale(0);
    hooks.grant(400);
    for (const id of ['tab_autocomplete', 'copy_paste_chatbot']) {
      for (let i = 0; i < 3; i++) {
        document.querySelector(`[data-testid="agent-row-${id}"]`)?.click();
      }
    }
  });
  await p.waitForTimeout(500);
  // Park the cursor in the corner: a row left under the mouse paints its hover
  // state and its ghost segment on the ship bar.
  await p.mouse.move(2, 2);
  await p.screenshot({ path: `artifacts/phone-${name}.png` });

  // `isVisible`, not `count`: the toggle is in the DOM at every size and merely
  // hidden where the shop is in the flow, so counting it always found one and
  // then timed out clicking something that cannot be clicked.
  const toggle = p.getByTestId('shop-toggle');
  const isDrawer = await toggle.isVisible();
  if (isDrawer) {
    await toggle.click();
    await p.waitForTimeout(450);
  } else {
    await p.getByTestId('shop').scrollIntoViewIfNeeded();
    await p.waitForTimeout(150);
  }
  await p.screenshot({ path: `artifacts/phone-${name}-shop.png` });

  const px = await p.evaluate(() => {
    const ui = document.querySelector('.tm-ui');
    return {
      px: ui ? getComputedStyle(ui).getPropertyValue('--px').trim() : '?',
      layout: ui?.dataset.layout ?? '?',
    };
  });
  console.log(
    `${name.padEnd(10)} ${w}x${h}  --px=${px.px.padEnd(8)} ${px.layout.padEnd(8)} ` +
      `shop=${isDrawer ? 'drawer' : 'in flow'}`,
  );
  await ctx.close();
}

await b.close();
