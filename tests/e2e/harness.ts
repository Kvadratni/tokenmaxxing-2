/**
 * Shared e2e harness for Tokenmaxxing 2.
 *
 * Every spec drives the game through two surfaces and nothing else:
 *   - `TID` selectors from `src/testids.ts` (the frozen contract), and
 *   - `window.__TOKENMAXXING2__` (TestHooks v2, live with `?testhooks=1`).
 *
 * No CSS-class selectors. Numbers the BALANCE pass tunes (requirements,
 * patience, costs, penalties) are read out of `snapshot().derived` at run time
 * rather than typed into a spec, so a retune cannot break the suite.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { TID, tid } from '../../src/testids.ts';
import type { DerivedStats, MetaState, RunState } from '../../src/sim/types.ts';
import { AGENT_RECT } from '../../src/render/atlas-types.ts';
import { TOUR_KEY } from '../../src/ui/tour-steps.ts';

export { TID, tid, TOUR_KEY };

/** The game 2 save key, and the game 1 key the sequel imports from. */
export const SAVE_KEY = 'tokenmaxxing2.save.v1';
export const LEGACY_KEY = 'tokenmaxxing.save.v1';

/** Every spec's default run seed. Any fixed value works; this one is just ours. */
export const SEED = 0x7a11;

/**
 * `TestHooks.snapshot()` travels through `JSON.parse(JSON.stringify(...))`, so
 * non-finite numbers arrive as `null`. That is deliberate: a `null` where a
 * number belongs is itself a finding.
 */
export interface Snap {
  run: RunState;
  meta: MetaState;
  derived: DerivedStats;
  screen: 'title' | 'run' | 'meta' | 'achievements';
}

/** Errors the page produced. Asserted empty by every spec that boots. */
export interface Watcher {
  readonly errors: string[];
  /** Responses with a 4xx/5xx status, and requests that failed outright. */
  readonly badResponses: string[];
}

/** CSS attribute selector for a testid, for page-side `querySelector` code. */
export function sel(id: string): string {
  return `[data-testid="${id}"]`;
}

/** Locator for every testid that starts with `${prefix}-`. */
export function byPrefix(page: Page | Locator, prefix: string): Locator {
  return page.locator(`[data-testid^="${prefix}-"]`);
}

/** Attach console-error / pageerror / bad-response capture. Must run before `goto`. */
export function watch(page: Page): Watcher {
  const errors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.name}: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    // A navigation away (reload) aborts in-flight requests; that is not a bug.
    const why = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(why)) badResponses.push(`failed ${r.url()} ${why}`);
  });
  return { errors, badResponses };
}

export function expectClean(w: Watcher): void {
  expect(w.errors, w.errors.join('\n')).toEqual([]);
}

export interface BootOpts {
  /** Load with `?testhooks=1`. Default true. Without it there is no hook API. */
  hooks?: boolean;
  /** Raw text for the game 2 save, written before the first load. */
  save?: string;
  /** Raw text for a Tokenmaxxing 1 save on the same origin. */
  legacySave?: string;
  /**
   * First-run coach marks pop up over the controls on state changes. By
   * default the harness retires each one the moment it appears; the coach spec
   * opts out to test them.
   */
  keepCoach?: boolean;
  /**
   * The first-run tour opens over the run screen, clock held, on the first NEW
   * SESSION a browser ever presses. The harness marks it seen (its own key,
   * `TOUR_KEY`, outside the signed save) so every other spec starts on a quiet
   * board; the tour spec sets this to meet it.
   */
  tour?: boolean;
}

/**
 * Boot the production preview with a hermetic save.
 *
 * localStorage is cleared (and optionally seeded) exactly once per page
 * session, guarded through sessionStorage, so a deliberate `page.reload()` in
 * a persistence spec still sees the save it just wrote.
 */
export async function bootPage(page: Page, opts: BootOpts = {}): Promise<Watcher> {
  const w = watch(page);
  await page.addInitScript(
    ({ save, legacy, saveKey, legacyKey, tourKey, tour }) => {
      try {
        if (sessionStorage.getItem('tm2-e2e-booted') !== '1') {
          localStorage.clear();
          if (save !== null) localStorage.setItem(saveKey, save);
          if (legacy !== null) localStorage.setItem(legacyKey, legacy);
          if (!tour) localStorage.setItem(tourKey, '1');
          sessionStorage.setItem('tm2-e2e-booted', '1');
        }
      } catch {
        /* storage unavailable: nothing to clear */
      }
    },
    {
      save: opts.save ?? null,
      legacy: opts.legacySave ?? null,
      saveKey: SAVE_KEY,
      legacyKey: LEGACY_KEY,
      tourKey: TOUR_KEY,
      tour: opts.tour === true,
    },
  );
  if (!opts.keepCoach) await retireCoachMarks(page);
  const hooks = opts.hooks !== false;
  await page.goto(hooks ? '/?testhooks=1' : '/');
  if (hooks) await page.waitForFunction(() => Boolean(window.__TOKENMAXXING2__));
  await expect(page.getByTestId(TID.titleScreen)).toBeVisible();
  return w;
}

/**
 * Coach marks are real overlays (pointer-events: auto) pinned beside the
 * controls they explain, and they appear whenever their state first becomes
 * true. Dismiss them as soon as Playwright sees one, before any action.
 * `dispatchEvent`, not `click`: a tip can sit under a dialog's backdrop.
 */
async function retireCoachMarks(page: Page): Promise<void> {
  await page.addLocatorHandler(
    byPrefix(page, TID.coachTip).first(),
    async (tip) => {
      await byPrefix(tip, TID.coachDismiss).first().dispatchEvent('click');
    },
    { noWaitAfter: true },
  );
}

/**
 * Retire any coach tip on screen right now. For raw `page.mouse` / touchscreen
 * input, which bypasses the locator handler above.
 */
export async function dismissCoach(page: Page): Promise<void> {
  await page.evaluate((prefix) => {
    for (const b of document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}-"]`)) b.click();
  }, TID.coachDismiss);
  await frames(page, 1);
}

/**
 * Retire tips until none is left to show for the current state. Each dismissal
 * lets the next eligible tip in on the following frame, so one pass is not
 * enough before a raw keyboard walk or touch sequence.
 */
export async function drainCoach(page: Page): Promise<void> {
  const tips = byPrefix(page, TID.coachTip);
  let quiet = 0;
  for (let i = 0; i < 20 && quiet < 2; i++) {
    await dismissCoach(page);
    await frames(page, 2);
    quiet = (await tips.count()) === 0 ? quiet + 1 : 0;
  }
}

/** Wait for `n` animation frames so the HUD has re-rendered. */
export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  }, n);
}

/** Live sim snapshot. */
export async function snap(page: Page): Promise<Snap> {
  return (await page.evaluate(() => window.__TOKENMAXXING2__!.snapshot())) as Snap;
}

/** Fast-forward the sim, then let the UI catch up. */
export async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((n) => window.__TOKENMAXXING2__!.advance(n), ms);
  await frames(page, 2);
}

/**
 * Advance in `step` slices until `pred` holds on a snapshot. Used wherever the
 * wait is a tuned duration (the report beat, an incident's timer) that the
 * spec should not have to know.
 */
export async function advanceUntil(
  page: Page,
  pred: (s: Snap) => boolean,
  opts: { step?: number; maxMs?: number; what?: string } = {},
): Promise<Snap> {
  const step = opts.step ?? 100;
  const maxMs = opts.maxMs ?? 60_000;
  let s = await snap(page);
  let spent = 0;
  while (!pred(s)) {
    if (spent >= maxMs) {
      throw new Error(`advanceUntil: ${opts.what ?? 'condition'} not met after ${maxMs}ms of sim time`);
    }
    await page.evaluate((n) => window.__TOKENMAXXING2__!.advance(n), step);
    spent += step;
    s = await snap(page);
  }
  await frames(page, 2);
  return s;
}

export async function grant(page: Page, amount: number): Promise<void> {
  await page.evaluate((n) => window.__TOKENMAXXING2__!.grant(n), amount);
  await frames(page, 2);
}

export async function grantThumbs(page: Page, n: number): Promise<void> {
  await page.evaluate((k) => window.__TOKENMAXXING2__!.grantThumbs(k), n);
  await frames(page, 2);
}

export async function setTimeScale(page: Page, k: number): Promise<void> {
  await page.evaluate((n) => window.__TOKENMAXXING2__!.setTimeScale(n), k);
}

export async function forceIncident(page: Page, id: string): Promise<void> {
  await page.evaluate((incident) => window.__TOKENMAXXING2__!.forceIncident(incident), id);
  await frames(page, 2);
}

export async function forcePickup(page: Page, id: string, x?: number, y?: number): Promise<void> {
  await page.evaluate(
    ([p, px, py]) => window.__TOKENMAXXING2__!.forcePickup(p as string, px as number | undefined, py as number | undefined),
    [id, x, y] as const,
  );
  await frames(page, 2);
}

export async function forceDraft(page: Page, ids: string[]): Promise<void> {
  await page.evaluate((cards) => window.__TOKENMAXXING2__!.forceDraft(cards), ids);
  await frames(page, 2);
}

export async function setContext(page: Page, fill: number): Promise<void> {
  await page.evaluate((f) => window.__TOKENMAXXING2__!.setContext(f), fill);
  await frames(page, 2);
}

export async function setPatience(page: Page, fill: number): Promise<void> {
  await page.evaluate((f) => window.__TOKENMAXXING2__!.setPatience(f), fill);
  await frames(page, 2);
}

export async function forceVerify(page: Page, outcome: 'pass' | 'catch' | null): Promise<void> {
  await page.evaluate((o) => window.__TOKENMAXXING2__!.forceVerify(o), outcome);
}

export async function importLegacy(page: Page, raw: string): Promise<void> {
  await page.evaluate((r) => window.__TOKENMAXXING2__!.importLegacy(r), raw);
  await frames(page, 2);
}

export async function clickAgentHook(page: Page, n: number): Promise<void> {
  await page.evaluate((count) => window.__TOKENMAXXING2__!.clickAgent(count), n);
  await frames(page, 2);
}

export async function resetSave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TOKENMAXXING2__!.resetSave());
}

/**
 * Leave the title screen for a fresh run on a fixed seed with real time
 * frozen, so every later `advance()` is the only source of elapsed time.
 */
export async function startRun(page: Page, seed = SEED): Promise<Snap> {
  await setTimeScale(page, 0);
  await page.getByTestId(TID.startRun).click();
  await page.evaluate((s) => window.__TOKENMAXXING2__!.startRun(s), seed);
  await frames(page, 3);
  await expect(page.getByTestId(TID.reportButton)).toBeVisible();
  const s = await snap(page);
  expect(s.screen).toBe('run');
  expect(s.run.phase).toBe('running');
  return s;
}

/**
 * A real pointer click on the agent.
 *
 * `agent-hit` is laid over the renderer's AGENT_RECT and a pointer-down on it
 * goes through `renderer.toScene()` + `hitsAgent()`, so this exercises the
 * whole coordinate chain, not just a DOM listener.
 */
export async function clickAgent(page: Page, times = 1): Promise<void> {
  const agent = page.getByTestId(TID.agent);
  for (let i = 0; i < times; i++) await agent.click();
  await frames(page, 2);
}

/** Client coordinates of a point in the 320x180 scene. */
export async function sceneToClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(TID.scene).boundingBox();
  expect(box, 'the scene canvas has no box').not.toBeNull();
  return { x: box!.x + (x / 320) * box!.width, y: box!.y + (y / 180) * box!.height };
}

export function toolRow(page: Page, id: string): Locator {
  return page.getByTestId(tid(TID.toolRow, id));
}

export function draftCards(page: Page): Locator {
  return byPrefix(page, TID.draftCard);
}

export function activeCards(page: Page): Locator {
  return byPrefix(page.getByTestId(TID.activeCards), TID.activeCard);
}

/** Top up the wallet to exactly the requirement (or leave it if already there). */
export async function fundReport(page: Page): Promise<Snap> {
  const s = await snap(page);
  const need = s.derived.requirement - s.run.tokens;
  if (need > 0) await grant(page, need);
  const after = await snap(page);
  expect(after.derived.reportState).toBe('report');
  return after;
}

/** Report done through the real button, then wait out the celebration beat. */
export async function reportAndOpenDraft(page: Page): Promise<Snap> {
  await fundReport(page);
  const button = page.getByTestId(TID.reportButton);
  await expect(button).toHaveAttribute('data-state', 'report');
  await button.click();
  const s = await advanceUntil(page, (x) => x.run.phase === 'drafting', { what: 'the draft to open' });
  await expect(page.getByTestId(TID.draftModal)).toBeVisible();
  return s;
}

/**
 * Complete an open draft. Picking is two-step by design (a click highlights,
 * Confirm commits), so every caller goes through here.
 */
export async function takeCard(page: Page, id?: string): Promise<string> {
  const card = id ? page.getByTestId(tid(TID.draftCard, id)) : draftCards(page).first();
  const testid = (await card.getAttribute('data-testid')) ?? '';
  await card.click();
  const confirm = page.getByTestId(TID.draftConfirm);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId(TID.draftModal)).toBeHidden();
  await frames(page, 2);
  return testid.slice(TID.draftCard.length + 1);
}

/** Report, draft the first (or named) card, and land on the next prompt. */
export async function reportAndTake(page: Page, id?: string): Promise<string> {
  await reportAndOpenDraft(page);
  return takeCard(page, id);
}

/** Hold these cards by drafting them through forced offers. Each pick advances the prompt. */
export async function holdCards(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await forceDraft(page, [id]);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    await takeCard(page, id);
  }
}

/** Lose the run on the human's patience, and go through run over to Training. */
export async function loseRunToTraining(page: Page): Promise<void> {
  await setPatience(page, 0);
  await expect(page.getByTestId(TID.runOverModal)).toBeVisible();
  await page.getByTestId(TID.runOverContinue).click();
  await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
}

/** The active element's testid (or tag name), for focus assertions. */
export async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement;
    return a?.getAttribute('data-testid') ?? a?.tagName ?? 'null';
  });
}

/** Horizontal overflow of the layout viewport, in CSS px (0 when none). */
export async function hOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the canvas actually draws the agent's hit box, in client px. */
export async function drawnAgent(page: Page): Promise<Box> {
  const c = (await page.getByTestId(TID.scene).boundingBox())!;
  const s = c.width / 320;
  return { x: c.x + AGENT_RECT.x * s, y: c.y + AGENT_RECT.y * s, w: AGENT_RECT.w * s, h: AGENT_RECT.h * s };
}

export async function agentHit(page: Page): Promise<Box> {
  const b = (await page.getByTestId(TID.agent).boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

export async function expectAgentAligned(page: Page): Promise<void> {
  const drawn = await drawnAgent(page);
  const hit = await agentHit(page);
  const msg = `agent-hit ${JSON.stringify(hit)} vs the agent the canvas draws ${JSON.stringify(drawn)}`;
  expect(Math.abs(hit.x - drawn.x), msg).toBeLessThanOrEqual(1.5);
  expect(Math.abs(hit.y - drawn.y), msg).toBeLessThanOrEqual(1.5);
  expect(Math.abs(hit.w - drawn.w), msg).toBeLessThanOrEqual(1.5);
  expect(Math.abs(hit.h - drawn.h), msg).toBeLessThanOrEqual(1.5);
}
