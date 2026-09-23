/**
 * Layout sanity across a matrix of real screen sizes.
 *
 *   node scripts/layoutsweep.mjs            # dev server on :5185
 *   GAME_URL=https://... node scripts/layoutsweep.mjs
 *
 * For each viewport it visits the title, the achievements screen and the run
 * screen, and checks the things that actually break: horizontal scroll,
 * content clipped off an edge, the stage wider than the viewport, and whether
 * the parts you cannot play without are on screen, big enough, and really the
 * thing under the pointer:
 *
 *   - the agent (the click target), including whether its DOM hit box
 *     (`agent-hit`) sits over the agent the canvas actually draws;
 *   - the report button, at least 44px tall wherever a thumb does the pointing;
 *   - the context bar and the patience bar, the two clocks;
 *   - the buttons that move you between screens.
 *
 * `isMobile` is set for the phone and tablet sizes on purpose: without it the
 * context is a narrow desktop, which hides overflow and dead touch surfaces.
 * Phones and tablets run at 2x, like the real thing.
 *
 * Exit code 1 when any viewport fails; the summary groups failures by check.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';

/** Apple's minimum comfortable touch target. */
const MIN_TAP = 44;
/** A clock bar narrower than this cannot be read at a glance. */
const MIN_BAR_W = 48;
/** How far `agent-hit` may sit from the agent the canvas draws, in CSS px. */
const MAX_AGENT_DRIFT = 2;

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

/**
 * A returning player's save: past the first session (so no coach marks float
 * over the controls) and already holding QA Engineer (so its popup, which the
 * test hooks would trigger, does not slide in over the corner). Unsigned saves
 * are trusted under `?testhooks=1` and simply get signed. The first-run tour
 * is marked seen too (its own key, outside the save), so NEW SESSION goes
 * straight to the board.
 */
const SAVE = JSON.stringify({
  version: 1,
  runs: 1,
  wins: 0,
  thumbs: 0,
  totalThumbsEarned: 0,
  achievements: { qa_engineer: 1 },
  legacy: { verdict: 'none' },
});
/** The first-run tour's "seen" (src/ui/tour-steps.ts). */
const TOUR_KEY = 'tokenmaxxing2.tour';

/** Everything measurable about the current layout. Runs in the page. */
function probe(hitIds) {
  const de = document.documentElement;
  const ui = document.querySelector('.tm-ui');
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  const rect = (n) => {
    if (!n || n.closest('[hidden]')) return null;
    const r = n.getBoundingClientRect();
    return r.width > 0 || r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  };
  const clipped = [];
  const app = q('app') ?? document.body;
  for (const n of app.querySelectorAll('*')) {
    if (n.closest('[hidden]')) continue;
    const r = n.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left < -1 || r.right > de.clientWidth + 1) {
      clipped.push(n.getAttribute('data-testid') ?? `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`);
    }
  }
  const hits = {};
  for (const id of hitIds) {
    const r = rect(q(id));
    if (!r) {
      hits[id] = 'missing';
      continue;
    }
    const top = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
    const owner = top?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
    // The root carries a testid too; name the element itself when that is all there is.
    hits[id] =
      owner && owner !== 'app'
        ? owner
        : top
          ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ')[0]}`
          : 'nothing';
  }
  const canvas = q('scene-canvas');
  const agentEl = q('agent-hit');
  let drift = null;
  if (canvas && agentEl) {
    // The UI places agent-hit from the scene rect the host handed it, kept in
    // these custom properties; the canvas draws that same rect at its own scale.
    const cs = getComputedStyle(agentEl);
    const v = (k) => Number.parseFloat(cs.getPropertyValue(k));
    const c = canvas.getBoundingClientRect();
    const a = agentEl.getBoundingClientRect();
    const s = c.width / 320;
    const drawn = { x: c.x + v('--ax') * s, y: c.y + v('--ay') * s, w: v('--aw') * s, h: v('--ah') * s };
    drift = Math.max(
      Math.abs(a.x - drawn.x),
      Math.abs(a.y - drawn.y),
      Math.abs(a.width - drawn.w),
      Math.abs(a.height - drawn.h),
    );
  }
  // How much of the screen the game uses. Passing every "nothing is broken"
  // check while filling half the window is still worth knowing about.
  const used = (sels) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of document.querySelectorAll(sels)) {
      const r = n.getBoundingClientRect();
      if (r.width === 0) continue;
      // A shut bottom-sheet shop is parked just off the bottom: not in use.
      if (r.top >= de.clientHeight - 1 || r.bottom <= 1) continue;
      x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right);
      y0 = Math.min(y0, Math.max(0, r.top)); y1 = Math.max(y1, Math.min(de.clientHeight, r.bottom));
    }
    return Number.isFinite(x0) ? { w: x1 - x0, h: y1 - y0 } : { w: 0, h: 0 };
  };
  const fill = used('.tm-topbar, .tm-hud, .tm-stage, .tm-shop, .tm-strip');
  return {
    clientW: de.clientWidth,
    clientH: de.clientHeight,
    scrollW: de.scrollWidth,
    px: ui ? Number.parseFloat(getComputedStyle(ui).getPropertyValue('--px')) : 0,
    layout: ui?.dataset.layout ?? '-',
    stageW: canvas?.parentElement ? canvas.parentElement.getBoundingClientRect().width : 0,
    agent: rect(agentEl),
    report: rect(q('report-button')),
    context: rect(q('hud-context-bar')),
    patience: rect(q('hud-patience-bar')),
    drift,
    hits,
    clipped: [...new Set(clipped)].slice(0, 4),
    usedW: fill.w,
    usedH: fill.h,
  };
}

const b = await chromium.launch();
let failures = 0;
const byCheck = new Map();
const fail = (bad, check, detail) => {
  bad.push(detail);
  byCheck.set(check, (byCheck.get(check) ?? 0) + 1);
};

for (const s of SIZES) {
  const ctx = await b.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: s.mobile ? 2 : 1,
    hasTouch: s.mobile,
    isMobile: s.mobile,
  });
  await ctx.addInitScript(
    ({ save, tourKey }) => {
      try {
        if (sessionStorage.getItem('tm2-sweep') !== '1') {
          localStorage.clear();
          localStorage.setItem('tokenmaxxing2.save.v1', save);
          localStorage.setItem(tourKey, '1');
          sessionStorage.setItem('tm2-sweep', '1');
        }
      } catch {
        /* private mode */
      }
    },
    { save: SAVE, tourKey: TOUR_KEY },
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING2__));
  await p.waitForTimeout(400);
  const title = await p.evaluate(probe, ['start-run', 'title-meta', 'title-achievements']);

  await p.getByTestId('title-achievements').click();
  await p.waitForTimeout(250);
  const achv = await p.evaluate(probe, ['achv-back']);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);

  // Into a run, where the stage, the HUD and the shop all exist.
  await p.getByTestId('start-run').click();
  await p.evaluate(() => window.__TOKENMAXXING2__.setTimeScale(0));
  await p.waitForTimeout(400);
  const run = await p.evaluate(probe, ['report-button', 'sycophancy-button', 'agent-hit']);

  const bad = [];
  for (const [where, m] of [
    ['title', title],
    ['achievements', achv],
    ['run', run],
  ]) {
    if (m.scrollW > m.clientW + 1) fail(bad, 'h-scroll', `${where}: h-scroll ${m.scrollW}>${m.clientW}`);
    if (m.clipped.length) fail(bad, 'clipped', `${where}: clipped ${m.clipped.join(',')}`);
    for (const [id, hit] of Object.entries(m.hits)) {
      if (hit !== id) fail(bad, `${id} covered`, `${where}: ${id} is under ${hit}`);
    }
  }
  if (run.stageW > run.clientW + 1) fail(bad, 'stage too wide', `stage ${Math.round(run.stageW)}>${run.clientW}`);

  const onScreen = (r) => r && r.x >= -1 && r.y >= -1 && r.x + r.w <= run.clientW + 1 && r.y + r.h <= run.clientH + 1;
  if (!run.agent || run.agent.w < MIN_TAP || run.agent.h < MIN_TAP) {
    fail(bad, 'agent too small', `agent ${run.agent ? `${Math.round(run.agent.w)}x${Math.round(run.agent.h)}` : 'missing'}`);
  } else if (!onScreen(run.agent)) {
    fail(bad, 'agent off-screen', `agent off-screen (y=${Math.round(run.agent.y)})`);
  }
  if (run.drift !== null && run.drift > MAX_AGENT_DRIFT) {
    fail(bad, 'agent-hit drift', `agent-hit ${Math.round(run.drift)}px off the drawn agent`);
  }
  // The 44px floor is only enforced where a thumb does the pointing. On a
  // mouse-driven screen a 30px control is perfectly clickable.
  if (!run.report) fail(bad, 'report missing', 'report button missing');
  else {
    if (s.mobile && run.report.h < MIN_TAP) fail(bad, 'report too small', `report button ${Math.round(run.report.h)}px tall`);
    if (!onScreen(run.report)) fail(bad, 'report off-screen', `report button off-screen (y=${Math.round(run.report.y)})`);
  }
  for (const [name, r] of [
    ['context bar', run.context],
    ['patience bar', run.patience],
  ]) {
    if (!r) fail(bad, `${name} missing`, `${name} missing`);
    else if (r.w < MIN_BAR_W) fail(bad, `${name} too narrow`, `${name} ${Math.round(r.w)}px wide`);
    else if (!onScreen(r)) fail(bad, `${name} off-screen`, `${name} off-screen`);
  }
  if (errs.length) fail(bad, 'page errors', `${errs.length} page errors: ${errs[0]}`);

  const ok = bad.length === 0;
  if (!ok) failures += 1;
  const fillW = Math.round((run.usedW / run.clientW) * 100);
  const fillH = Math.round((run.usedH / run.clientH) * 100);
  const px = Number.isInteger(run.px) ? String(run.px) : run.px.toFixed(2);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(20)} ${String(s.w).padStart(4)}x${String(s.h).padEnd(5)} ${s.mobile ? '2x' : '1x'} px=${px.padEnd(4)} ${run.layout.padEnd(8)} fill ${String(fillW).padStart(3)}%w ${String(fillH).padStart(3)}%h${ok ? '' : '   ' + bad.join(' | ')}`,
  );
  await ctx.close();
}

console.log(`\n${SIZES.length - failures}/${SIZES.length} viewports clean`);
if (byCheck.size > 0) {
  console.log(`failing checks: ${[...byCheck].map(([k, n]) => `${k} x${n}`).join(', ')}`);
}
await b.close();
process.exitCode = failures > 0 ? 1 : 0;
