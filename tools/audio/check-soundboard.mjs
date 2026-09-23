#!/usr/bin/env node
/**
 * Smoke-checks the soundboard in Chromium against the running dev server:
 *
 *   node tools/audio/check-soundboard.mjs [url]
 *
 * Loads the page, clicks every SFX button, plays the score, switches scenes,
 * moves the sliders, and fails on any console error or page exception, or if
 * the engine never unlocks or the score never runs.
 */

import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? 'http://localhost:5185/tools/audio/soundboard.html';

const browser = await chromium.launch();
const errors = [];
let exit = 0;
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(URL, { waitUntil: 'networkidle' });

  const byId = (id) => page.locator(`[data-testid="${id}"]`);
  await byId('sfx-click').click();
  await page.waitForFunction(() => window.__soundboard?.engine.unlocked === true, null, { timeout: 5000 });

  // Every SFX button, once.
  const pads = await page.locator('[data-testid^="sfx-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  for (const id of pads) {
    await byId(id).click();
    await page.waitForTimeout(120);
  }

  // Sliders that shape the sounds.
  await page.locator('#heat').fill('5');
  await byId('sfx-sycophancy').click();
  await page.locator('#warnFill').fill('0.95');
  await byId('sfx-contextWarn').click();

  // The score: play, change rooms, lean on tension and context fill.
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  await byId('scene-datacenter').click();
  await page.locator('#tension').fill('0.9');
  await page.locator('#fill').fill('0.95');
  await page.waitForTimeout(7000);
  const state = await page.evaluate(() => window.__soundboard.engine.inspect());
  const readout = await byId('readout').innerText();
  await page.locator('#stop').click();
  await page.waitForTimeout(300);
  const stopped = await page.evaluate(() => window.__soundboard.engine.inspect());

  const checks = [
    ['engine unlocked', state.unlocked === true],
    ['score playing the datacenter after the crossfade', state.music?.playing === 'datacenter'],
    ['tension reached the score', (state.music?.tension ?? 0) > 0.8],
    ['context fill reached the score (pressure drone on)', (state.music?.pressure ?? 0) > 0.5],
    ['readout is live', readout.includes('bpm')],
    ['stop halts the scheduler', stopped.volumes.music === 0],
    [`clicked ${pads.length} SFX buttons`, pads.length >= 27],
  ];
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) exit = 1;
  }
  console.log(`\nreadout: ${readout.replace(/\n/g, ' | ')}`);
  if (errors.length) {
    exit = 1;
    console.log('\nconsole errors:');
    for (const e of errors) console.log(`  ${e}`);
  } else {
    console.log('\nno console errors or warnings');
  }
} finally {
  await browser.close();
}
process.exit(exit);
