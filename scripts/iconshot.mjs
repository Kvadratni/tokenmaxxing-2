/**
 * Proof that the grown 8x10 sheet still slices correctly.
 *
 * Checks the CSS grid vars, then reads the actual sheet pixels for every icon
 * the tree renders: an id can exist in the manifest and still point at an empty
 * cell, which looks identical to a missing icon on screen.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 3 });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
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
await p.evaluate(() => {
  // Clone the live meta so the save carries `version`; loadMeta drops it otherwise.
  const meta = { ...window.__TOKENMAXXING__.snapshot().meta, demos: 4000 };
  localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(meta));
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.getByTestId('title-meta').click();
await p.waitForTimeout(400);

const vars = await p.evaluate(() => {
  const root = document.querySelector('.tm-ui');
  const s = getComputedStyle(root);
  const icon = document.querySelector('.tm-icon');
  return {
    cols: s.getPropertyValue('--icon-cols').trim(),
    rows: s.getPropertyValue('--icon-rows').trim(),
    bgSize: icon ? getComputedStyle(icon).backgroundSize : null,
  };
});
console.log('grid vars:', JSON.stringify(vars));

const scan = await p.evaluate(async () => {
  const first = document.querySelector('.tm-icon');
  const img = new Image();
  img.src = first ? getComputedStyle(first).backgroundImage.slice(5, -2) : '';
  await new Promise((r) => {
    img.onload = r;
    img.onerror = r;
  });
  const out = { sheet: `${img.naturalWidth}x${img.naturalHeight}`, blank: [], offSheet: [] };
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const px = c.getContext('2d');
  px.drawImage(img, 0, 0);
  for (const n of document.querySelectorAll('.tm-node')) {
    const tile = n.querySelector('.tm-icon');
    const id = (n.dataset.testid ?? '?').replace('meta-buy-', '');
    if (!tile || tile.classList.contains('tm-icon--missing')) {
      out.blank.push(`${id} (no manifest entry)`);
      continue;
    }
    const cs = getComputedStyle(tile);
    const x = Number(cs.getPropertyValue('--ix'));
    const y = Number(cs.getPropertyValue('--iy'));
    if (!(x * 16 < img.naturalWidth && y * 16 < img.naturalHeight)) {
      out.offSheet.push(`${id} @ ${x},${y}`);
      continue;
    }
    const d = px.getImageData(x * 16, y * 16, 16, 16).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
    if (ink < 12) out.blank.push(`${id} (empty cell ${x},${y})`);
  }
  return out;
});
console.log(
  `sheet: ${scan.sheet} | blank: ${scan.blank.length} | off-sheet: ${scan.offSheet.length}`,
);
for (const s of scan.blank) console.log(`  blank: ${s}`);
for (const s of scan.offSheet) console.log(`  off-sheet: ${s}`);

await p.locator('.tm-tree').screenshot({ path: 'artifacts/icons-in-tree.png' });
console.log(`console errors: ${errs.length} ${errs.slice(0, 3).join(' | ')}`);
await b.close();
