/**
 * The README screenshot set.
 *
 *   node scripts/screenshots.mjs        # needs `npm run dev` on :5185
 *   GAME_URL=https://... node scripts/screenshots.mjs
 *   SHOTS_OUT=artifacts/shots node scripts/screenshots.mjs   # anywhere else
 *
 * Writes docs/screenshots/ (committed, unlike artifacts/):
 *
 *   01-title.png               the title, for a player a few releases in
 *   02-run.png                 mid-session: tools running, cards held, context ~60%
 *   03-draft.png               "the human is prompt engineering", one card highlighted
 *   04-compaction.png          the summary picker after the window overflowed
 *   05-claim-caught.png        a claim the human checked
 *   06-training.png            the Training tree, mid-meta
 *   07-achievements.png        the achievements screen
 *   08-achievement-popup.png   an unlock sliding in
 *   09-tour.png                the first-run tour, on the context window
 *
 * Every shot but 09 marks the first-run tour seen (its own localStorage key,
 * outside the save), so NEW SESSION goes straight to the board.
 *
 * Deterministic: every shot injects a fixed save and plays a fixed seed with
 * real time frozen, so re-running produces the same images and a diff means
 * something changed. Everything is bought and reported through the real UI;
 * the test hooks only grant tokens and pin the dice.
 *
 * Shot at 1320x800 on a 2x screen, where the UI's --px lands on exactly 3 and
 * the canvas scale matches it. (At most other 2x sizes the UI picks a
 * fractional --px the canvas does not follow: see scripts/layoutsweep.mjs.)
 *
 * The saves already hold QA Engineer, because driving the game through the
 * hooks earns it and its popup would sit in the corner of every shot, and they
 * hold whatever else these sessions would unlock, so only 08 has a popup. No
 * hidden achievement is ever shown earned: the README spoils none of them.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const OUT = process.env.SHOTS_OUT ?? 'docs/screenshots';
const TOUR_KEY = 'tokenmaxxing2.tour';
const VIEW = { width: 1320, height: 800 };
const SEED = 0x51_09;
mkdirSync(OUT, { recursive: true });

/** A player six releases in: /compact, a 128K window, tools 5-6, some alignment. */
const LEVELS = {
  unlock_compact: 1,
  context_window: 2,
  longer_summaries: 1,
  unlock_web: 1,
  unlock_subagent: 1,
  helpful: 2,
  rlhf: 1,
  spec_gaming: 1,
  tool_use: 2,
  pretraining: 2,
  prompt_library: 1,
  temperature: 1,
};

/** Visible achievements a player like that has. */
const EARNED = { works_on_my_machine: 1, compacted: 1, human_said_thanks: 2, context_engineer: 4, shipped_to_prod: 6 };

/**
 * What these scripted sessions would otherwise unlock mid-shot. Only ever put
 * in the saves of the run shots, never on the achievements screen, so their
 * popups stay out of frame and the hidden ones stay hidden in the README.
 */
const QUIET = { qa_engineer: 6, ran_the_tests: 6, made_mistakes: 6, please_thank_you: 6, tokenmaxxed: 6 };

function save(extra = {}) {
  return {
    version: 1,
    thumbs: 11,
    totalThumbsEarned: 69,
    runs: 6,
    wins: 1,
    bestPrompt: 9,
    levels: LEVELS,
    achievements: EARNED,
    stats: { sycophancy: 23, compactions: 9, forcedCompactions: 6 },
    legacy: { verdict: 'none' },
    ...extra,
  };
}

const b = await chromium.launch();
const errs = [];

/**
 * A fresh browser context holding exactly `saveObj`, and a tour already seen
 * unless `tour` asks to meet it.
 */
async function open(saveObj, { hooks = true, tour = false } = {}) {
  const ctx = await b.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  await ctx.addInitScript(
    ({ text, tourKey, keepTour }) => {
      try {
        if (sessionStorage.getItem('tm2-shot') !== '1') {
          localStorage.clear();
          localStorage.setItem('tokenmaxxing2.save.v1', text);
          if (!keepTour) localStorage.setItem(tourKey, '1');
          sessionStorage.setItem('tm2-shot', '1');
        }
      } catch {
        /* private mode */
      }
    },
    { text: JSON.stringify(saveObj), tourKey: TOUR_KEY, keepTour: tour },
  );
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`${URL}${hooks ? '?testhooks=1' : ''}`, { waitUntil: 'networkidle' });
  if (hooks) await p.waitForFunction(() => Boolean(window.__TOKENMAXXING2__));
  await p.getByTestId('title-screen').waitFor();
  await p.waitForTimeout(300);
  return { ctx, p };
}

const snap = (p) => p.evaluate(() => window.__TOKENMAXXING2__.snapshot());
const frames = (p, n = 3) =>
  p.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(() => r()));
  }, n);
const grant = async (p, n) => {
  if (n > 0) await p.evaluate((k) => window.__TOKENMAXXING2__.grant(k), n);
  await frames(p, 2);
};

/** No focus ring, no hover tooltip, no stray toast: the shot shows the game. */
async function tidy(p, { toasts = true } = {}) {
  await p.mouse.move(2, 2);
  await p.evaluate(() => document.activeElement?.blur?.());
  if (toasts) {
    await p
      .waitForFunction(() => document.querySelector('[data-testid="toast"]') === null, undefined, { timeout: 4_000 })
      .catch(() => {});
  }
  await frames(p, 4);
  await p.waitForTimeout(150);
}

async function shoot(p, name) {
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name);
}

async function startRun(p) {
  await p.evaluate(() => window.__TOKENMAXXING2__.setTimeScale(0));
  await p.getByTestId('start-run').click();
  await p.evaluate((s) => window.__TOKENMAXXING2__.startRun(s), SEED);
  await p.getByTestId('report-button').waitFor();
  await frames(p, 3);
}

/** Buy `n` units of a tool through its shop row, granting each price first. */
async function buy(p, id, n) {
  for (let i = 0; i < n; i++) {
    const s = await snap(p);
    await grant(p, s.derived.nextCosts[id] - s.run.tokens);
    await p.getByTestId(`tool-row-${id}`).click();
    await frames(p, 2);
  }
}

/** `formatTokens` read back: "60", "1.20K", "3.08M", "4.00G". */
function parseTokens(text) {
  const m = /([\d.]+)\s*([KMGTP])?/.exec(String(text ?? '').replace(/,/g, ''));
  if (!m) return 0;
  return Number(m[1]) * ({ K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }[m[2]] ?? 1);
}

/**
 * Buy the first `n` upgrades on the Upgrades tab, granting only what each
 * costs (read off its row, plus the rounding in the label), then go back to
 * Tools. A spare billion in the wallet would read as a cheat in the shot.
 */
async function buyUpgrades(p, n) {
  await p.getByTestId('tab-upgrades').click();
  for (let i = 0; i < n; i++) {
    const row = p.locator('[data-testid^="upgrade-row-"]').first();
    if ((await row.count()) === 0) break;
    const price = parseTokens(await row.locator('.tm-row__cost').textContent());
    const s = await snap(p);
    await grant(p, Math.ceil(price * 1.01) - s.run.tokens);
    await row.click();
    await frames(p, 2);
  }
  await p.getByTestId('tab-tools').click();
}

/** Report through the button, wait out the beat, and draft `pick` (offered alongside `others`). */
async function reportAndDraft(p, pick, others) {
  const s = await snap(p);
  await grant(p, s.derived.requirement - s.run.tokens);
  await p.getByTestId('report-button').click();
  for (let i = 0; i < 60 && (await snap(p)).run.phase !== 'drafting'; i++) {
    await p.evaluate(() => window.__TOKENMAXXING2__.advance(100));
  }
  await p.evaluate((ids) => window.__TOKENMAXXING2__.forceDraft(ids), [pick, ...others]);
  await frames(p, 3);
  await p.getByTestId(`draft-card-${pick}`).click();
  await p.getByTestId('draft-confirm').click();
  await p.getByTestId('draft-modal').waitFor({ state: 'hidden' });
  await frames(p, 2);
}

// ---- 1. title -----------------------------------------------------------------
{
  const { ctx, p } = await open(save(), { hooks: false });
  await p.waitForTimeout(4_200); // let the ambient CLI fill its columns
  await tidy(p);
  await shoot(p, '01-title');
  await ctx.close();
}

// ---- 2-5. one session, mid-game ------------------------------------------------
{
  const { ctx, p } = await open(save({ achievements: { ...EARNED, ...QUIET } }));
  await startRun(p);

  // Five prompts in, holding what the human typed along the way.
  await reportAndDraft(p, 'make_no_mistakes', ['grandma', 'be_concise']);
  await reportAndDraft(p, 'please', ['deep_breath', 'answer_in_json']);
  await reportAndDraft(p, 'think_step_by_step', ['tip_200', 'best_practices']);
  await reportAndDraft(p, 'ultrathink', ['you_are_expert', 'remember_this']);
  await reportAndDraft(p, 'tip_200', ['dont_hallucinate', 'ten_x']);

  // The ladder, bought row by row.
  for (const [id, n] of [
    ['grep', 12],
    ['read', 8],
    ['edit', 6],
    ['bash', 5],
    ['web_search', 3],
    ['subagent', 4],
  ]) {
    await buy(p, id, n);
  }
  await buyUpgrades(p, 4);

  // The moment: context filling, the human a little impatient, a claim on offer.
  let s = await snap(p);
  await grant(p, s.derived.requirement * 0.58 - s.run.tokens);
  await p.evaluate(() => {
    const h = window.__TOKENMAXXING2__;
    h.setContext(0.6);
    h.setPatience(0.71);
    h.forceIncident('why_port');
  });
  await tidy(p);
  for (let i = 0; i < 3; i++) await p.getByTestId('agent-hit').click();
  await p.mouse.move(2, 2);
  await p.evaluate(() => document.activeElement?.blur?.());
  await p.waitForTimeout(160);
  await shoot(p, '02-run');

  // ---- 3. the draft: report, and the human starts prompt engineering ----------
  s = await snap(p);
  await grant(p, s.derived.requirement - s.run.tokens);
  await p.getByTestId('report-button').click();
  for (let i = 0; i < 60 && (await snap(p)).run.phase !== 'drafting'; i++) {
    await p.evaluate(() => window.__TOKENMAXXING2__.advance(100));
  }
  await p.evaluate(() => window.__TOKENMAXXING2__.forceDraft(['grandma', 'you_are_expert', 'dont_hallucinate']));
  await frames(p, 3);
  await p.getByTestId('draft-card-you_are_expert').click();
  await tidy(p);
  await shoot(p, '03-draft');
  await p.getByTestId('draft-confirm').click();
  await p.getByTestId('draft-modal').waitFor({ state: 'hidden' });

  // ---- 4. the window overflows: choose what the summary keeps ------------------
  await buy(p, 'read', 2);
  s = await snap(p);
  await grant(p, s.derived.requirement * 0.4 - s.run.tokens);
  await p.evaluate(() => window.__TOKENMAXXING2__.setContext(1));
  await p.getByTestId('summary-modal').waitFor();
  await p.getByTestId('summary-card-ultrathink').click();
  // The picker holds the sim, so the compaction toasts can expire first.
  await tidy(p);
  await shoot(p, '04-compaction');
  await p.getByTestId('summary-confirm').click();
  await p.getByTestId('summary-modal').waitFor({ state: 'hidden' });

  // ---- 5. a claim the human checked ------------------------------------------------
  await tidy(p);
  s = await snap(p);
  const want = s.derived.requirement * ((s.derived.claimThreshold + 1) / 2);
  await grant(p, want - s.run.tokens);
  await p.evaluate(() => window.__TOKENMAXXING2__.forceVerify('catch'));
  await p.getByTestId('report-button').click();
  await frames(p, 4);
  await p.mouse.move(2, 2);
  await p.evaluate(() => document.activeElement?.blur?.());
  // The wallet rolls down to the nothing that is left (it closes 95% of the gap
  // every 250ms, so a few hundred million takes ~1.8s to read 0), while the
  // CAUGHT stamp (2.8s) and the toast (2.2s) are still up.
  await p.waitForTimeout(1_850);
  await shoot(p, '05-claim-caught');
  await ctx.close();
}

// ---- 6. Training --------------------------------------------------------------
{
  const { ctx, p } = await open(save(), { hooks: false });
  await p.getByTestId('title-meta').click();
  await p.getByTestId('meta-screen').waitFor();
  await tidy(p);
  // A node the player can afford, hovered: the tooltip is how the tree reads.
  await p.getByTestId('meta-buy-unlock_mcp').hover();
  await p.waitForTimeout(250);
  await shoot(p, '06-training');
  await ctx.close();
}

// ---- 7. achievements ------------------------------------------------------------
{
  const { ctx, p } = await open(save(), { hooks: false });
  await p.getByTestId('title-achievements').click();
  await p.getByTestId('achievements-screen').waitFor();
  await tidy(p);
  await shoot(p, '07-achievements');
  await ctx.close();
}

// ---- 8. the unlock popup ---------------------------------------------------------
{
  const { works_on_my_machine: _first, ...rest } = EARNED;
  const { ctx, p } = await open(save({ runs: 2, wins: 0, achievements: { ...rest, ...QUIET } }));
  await startRun(p);
  await buy(p, 'grep', 3);
  await p.getByTestId('agent-hit').click();
  const s = await snap(p);
  await grant(p, s.derived.requirement - s.run.tokens);
  await tidy(p);
  await p.getByTestId('report-button').click();
  await p.getByTestId('achievement-popup-card-works_on_my_machine').waitFor();
  await p.mouse.move(2, 2);
  await p.evaluate(() => document.activeElement?.blur?.());
  await p.waitForTimeout(900); // fully slid in
  await shoot(p, '08-achievement-popup');
  await ctx.close();
}

// ---- 9. the first-run tour -------------------------------------------------------
{
  // A first session in a browser that has never seen the tour, on its sixth
  // step: the context window, lit, with the pile on the floor lit beside it.
  const first = {
    version: 1,
    thumbs: 0,
    totalThumbsEarned: 0,
    runs: 0,
    wins: 0,
    bestPrompt: -1,
    levels: {},
    achievements: { qa_engineer: 1 },
    stats: {},
    legacy: { verdict: 'none' },
  };
  const { ctx, p } = await open(first, { tour: true });
  await p.getByTestId('start-run').click();
  await p.evaluate((s) => window.__TOKENMAXXING2__.startRun(s), SEED);
  await p.getByTestId('tour-step-intro').waitFor();
  await p.getByTestId('tour-next').click();
  await p.getByTestId('tour-step-agent').waitFor();
  for (let i = 0; i < 3; i++) await p.getByTestId('agent-hit').click();
  await p.getByTestId('tour-step-tokens').waitFor();
  for (const id of ['prompt', 'patience', 'context']) {
    await p.getByTestId('tour-next').click();
    await p.getByTestId(`tour-step-${id}`).waitFor();
  }
  // The wallet rolls up to what the three clicks earned (it settles in ~1.3s).
  await p.waitForTimeout(1_500);
  await tidy(p);
  await shoot(p, '09-tour');
  await ctx.close();
}

console.log('console/page errors:', errs.length, errs.slice(0, 3).join(' | '));
await b.close();
process.exitCode = errs.length > 0 ? 1 : 0;
