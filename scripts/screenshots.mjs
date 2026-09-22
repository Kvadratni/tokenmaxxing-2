/**
 * The README / release screenshot set.
 *
 *   node scripts/screenshots.mjs        # needs `npm run dev` on :5185
 *
 * Writes to docs/screenshots/ (committed, unlike artifacts/). Deterministic:
 * every shot injects a fixed save and a fixed run seed, so re-running produces
 * the same images and a diff is meaningful.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const OUT = 'docs/screenshots';
const VIEW = { width: 1280, height: 800 };

const b = await chromium.launch();
const p = await b.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push(String(e)));

const hook = (fn, arg) => p.evaluate(fn, arg);
const settle = (ms = 300) => p.waitForTimeout(ms);
/** Park the cursor off every hoverable, or a stray tooltip lands in the shot. */
const unhover = async () => {
  await p.mouse.move(2, 2);
  await p.waitForTimeout(120);
};

async function boot(levels = {}, demos = 0) {
  await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await p.evaluate(
    ([lv, d]) => {
      try {
        localStorage.clear();
      } catch {
        /* private mode */
      }
      const meta = { ...window.__TOKENMAXXING__.snapshot().meta };
      meta.levels = { ...meta.levels, ...lv };
      meta.demos = d;
      meta.runs = 4;
      meta.wins = 1;
      localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(meta));
    },
    [levels, demos],
  );
  await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
  await settle(400);
}

/** Climb the agent ladder so the desk is full and several tiers are on the rail. */
async function stockUp(counts) {
  await hook((c) => {
    const h = window.__TOKENMAXXING__;
    h.setTimeScale(0);
    for (const [id, n] of Object.entries(c)) {
      h.grant(1e18);
      window.__TM_BUY__?.(id, n);
    }
  }, counts);
}

const DEEP = {
  unlock_swarm: 1,
  unlock_ralph: 1,
  unlock_harness: 1,
  cracked: 3,
  unlock_autoclicker: 1,
  idle_hands: 2,
  seed_funding: 3,
  technical_cofounder: 2,
  incubator: 2,
  founder_mode: 3,
  unlock_model_cards: 1,
  prompt_library: 1,
  reroll_token: 1,
  unlock_rare_cards: 1,
  unlock_yolo: 1,
  unlock_skip: 1,
  hype_machine: 1,
  snack_drawer: 1,
};

// ---- 1. title -------------------------------------------------------------
await boot(DEEP, 40);
await settle(4200); // let the ambient CLI fill all three columns
await unhover();
await p.screenshot({ path: `${OUT}/01-title.png` });
console.log('01-title');

// ---- 2. a run in progress -------------------------------------------------
await p.getByTestId('start-run').click();
await hook(() => {
  const h = window.__TOKENMAXXING__;
  h.setTimeScale(0);
  h.startRun(0x51_09);
});
await settle(200);
// Buy up the ladder through the real API so costs and clutter stay consistent.
await hook(() => {
  const h = window.__TOKENMAXXING__;
  const rows = ['tab_autocomplete', 'copy_paste_chatbot', 'agentic_ide', 'cli_agent'];
  for (const id of rows) {
    for (let i = 0; i < 8; i++) {
      h.grant(1e12);
      document.querySelector(`[data-testid="agent-row-${id}"]`)?.click();
    }
  }
});
await settle(300);
await hook(() => {
  window.__TOKENMAXXING__.setTimeScale(1);
  window.__TOKENMAXXING__.advance(9000);
});
await settle(700);
await unhover();
await p.screenshot({ path: `${OUT}/02-run.png` });
console.log('02-run');

// ---- 3. the draft ---------------------------------------------------------
await hook(() => {
  const h = window.__TOKENMAXXING__;
  h.forceDraft(['gpu_cluster', 'opus', 'temperature_zero']);
});
await settle(500);
if (await p.getByTestId('draft-modal').isVisible()) {
  await p.locator('[data-testid^="draft-card-"]').nth(1).click();
  await settle(200);
  await p.screenshot({ path: `${OUT}/03-draft.png` });
  console.log('03-draft');
  await p.getByTestId('draft-confirm').click();
  await settle(300);
}

// ---- 4. the Demos tree ----------------------------------------------------
await boot(DEEP, 120);
await p.getByTestId('title-meta').click();
await settle(500);
await unhover();
await p.screenshot({ path: `${OUT}/04-tree.png` });
console.log('04-tree');

// ---- 5. how to play -------------------------------------------------------
await boot(DEEP, 40);
await p.getByTestId('help-button').click();
await settle(400);
await unhover();
await p.screenshot({ path: `${OUT}/05-help.png` });
console.log('05-help');

// ---- 6. achievements, on a nearly-fresh save ------------------------------
// Deliberately only a couple earned: the mostly-locked grid is what a new
// player sees, and it is the state a dirty-check bug once blanked entirely.
await boot({}, 0);
await p.evaluate(() => {
  const meta = { ...window.__TOKENMAXXING__.snapshot().meta };
  meta.achievements = { first_ship: 1, no_hands: 1, friday: 3 };
  meta.runs = 3;
  localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(meta));
});
await p.goto(`${URL}?testhooks=1`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));
await p.getByTestId('title-achievements').click();
await settle(500);
await unhover();
await p.locator('[data-testid="achievements-screen"]').screenshot({
  path: `${OUT}/06-achievements.png`,
});
console.log('06-achievements');

// ---- 7. the unlock popup -------------------------------------------------
await boot({}, 0);
await p.getByTestId('start-run').click();
await p.evaluate(() => {
  const h = window.__TOKENMAXXING__;
  h.setTimeScale(0);
  h.startRun(5);
  h.grant(h.snapshot().derived.requirement + 5);
});
await settle(250);
await p.getByTestId('ship-button').click();
await settle(900); // fully slid in
await unhover();
await p.screenshot({ path: `${OUT}/07-achievement-popup.png` });
console.log('07-popup');

console.log('console errors:', errs.length, errs.slice(0, 3).join(' | '));
await b.close();
