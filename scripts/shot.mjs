/**
 * Visual capture pass. Drives the game through every screen and writes PNGs.
 *   node scripts/shot.mjs [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:5185';
const OUT = process.argv[2] ?? 'artifacts/shots';
const errors = [];

const T = (id) => `[data-testid="${id}"]`;

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    process.stdout.write(`  ${name}.png\n`);
  };
  const hook = (fn, ...a) => page.evaluate(([f, args]) => window.__TOKENMAXXING__[f](...args), [fn, a]);

  await page.goto(`${BASE}/?testhooks=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__TOKENMAXXING__, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await shot('01-title');

  // Meta / Demos shop, straight off the title screen.
  if (await page.locator(T('title-meta')).count()) {
    await page.locator(T('title-meta')).first().click();
    await page.waitForTimeout(400);
    await shot('02-meta-shop');
    await page.locator(T('meta-back')).first().click();
    await page.waitForTimeout(300);
  }

  await page.locator(T('start-run')).first().click();
  await page.waitForTimeout(500);
  await shot('03-run-start');

  await hook('clickLaptop', 45);
  await page.waitForTimeout(400);
  await shot('04-clicking');

  // Buy a spread of agents so the desk clutter and the shop fill out.
  await hook('grant', 4_000_000);
  await page.waitForTimeout(200);
  for (const n of ['1', '1', '1', '2', '2', '3', '3', '4']) {
    await page.keyboard.press(n);
    await page.waitForTimeout(60);
  }
  await hook('advance', 4000);
  await page.waitForTimeout(500);
  await shot('05-agents-and-clutter');

  await page.locator(T('tab-upgrades')).first().click();
  await page.waitForTimeout(350);
  await shot('06-upgrades-rail');
  await page.locator(T('tab-agents')).first().click();

  await hook('forceIncident', 'hallucinated_dep');
  await page.waitForTimeout(500);
  await shot('07-incident');

  // Ship it — confetti + screenshake.
  await hook('grant', 5000);
  await page.waitForTimeout(300);
  await page.locator(T('ship-button')).first().click();
  await page.waitForTimeout(260);
  await shot('08-shipping');

  await page.waitForTimeout(900);
  await shot('09-draft');
  const card = page.locator('[data-testid^="draft-card-"]').first();
  if (await card.count()) await card.click();
  await page.waitForTimeout(500);
  await shot('10-project-2');

  // Lose the run: burn the clock down.
  await hook('setTimeScale', 0);
  await hook('advance', 200_000);
  await page.waitForTimeout(700);
  await shot('11-run-over');

  // Mobile stacked layout.
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await m.goto(`${BASE}/?testhooks=1`, { waitUntil: 'networkidle' });
  await m.waitForFunction(() => !!window.__TOKENMAXXING__, null, { timeout: 20000 });
  await m.locator(T('start-run')).first().click();
  await m.waitForTimeout(600);
  await m.evaluate(() => window.__TOKENMAXXING__.clickLaptop(20));
  await m.waitForTimeout(400);
  await m.screenshot({ path: `${OUT}/12-mobile.png` });
  process.stdout.write('  12-mobile.png\n');
  const overflow = await m.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  process.stdout.write(`\nmobile horizontal overflow: ${overflow}px\n`);

  const stats = await page.evaluate(() => window.__TOKENMAXXING__.renderStats());
  process.stdout.write(`renderStats: ${JSON.stringify(stats)}\n`);
  await browser.close();

  if (errors.length) {
    process.stdout.write(`\nPAGE ERRORS (${errors.length}):\n${errors.join('\n')}\n`);
    process.exitCode = 1;
  } else process.stdout.write('no console errors\n');
}

main().catch((e) => {
  process.stdout.write(`FAILED: ${e.message}\n`);
  process.exit(1);
});
