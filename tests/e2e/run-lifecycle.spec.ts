/**
 * Run lifecycle: deadlines, incidents and Demo banking.
 *
 * Two locked design decisions get their own explicit tests here, because both
 * are the kind of thing a well-meaning refactor "fixes" into a regression:
 *   1. Demos bank at run *end*, never mid-run.
 *   2. Incidents do not pause the deadline.
 */
import { expect, test } from '@playwright/test';
import {
  TID,
  advance,
  agentRow,
  bootPage,
  clickLaptop,
  clickLaptopHook,
  forceIncident,
  frames,
  grant,
  snap,
  startRun,
  takeCard,
} from './harness.ts';

const TIER1 = 'tab_autocomplete';

test.describe('run lifecycle', () => {
  test('missing the deadline ends the run with the loss title and banks the tally', async ({
    page,
  }) => {
    const w = await bootPage(page);
    await startRun(page);

    const start = await snap(page);
    expect(start.meta.runs).toBe(0);
    expect(start.run.timeLeftMs).toBeGreaterThan(0);

    await advance(page, start.run.timeLeftMs + 500);
    await frames(page, 4);

    const over = await snap(page);
    expect(over.run.phase).toBe('lost');
    expect(over.run.timeLeftMs).toBe(0);

    const modal = page.getByTestId(TID.runOverModal);
    await expect(modal).toBeVisible();
    await expect(page.getByTestId(TID.runOverTitle)).toHaveText('SIGKILL');
    await expect(page.getByTestId(TID.runOverDemos)).toBeVisible();

    // Nothing shipped, so the bank is zero — but the run itself is recorded.
    expect(over.meta.runs).toBe(1);
    expect(over.meta.demos).toBe(over.run.pendingDemos);
    expect(w.errors, w.errors.join('\n')).toEqual([]);
  });

  test('Demos bank at run end, not mid-run', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    const start = await snap(page);
    expect(start.meta.demos).toBe(0);

    // Ship project 1.
    await grant(page, start.derived.requirement);
    await page.getByTestId(TID.shipButton).click();
    await advance(page, 1200);
    await expect(page.getByTestId(TID.draftModal)).toBeVisible();
    await takeCard(page);
    await frames(page, 4);

    const mid = await snap(page);
    expect(mid.run.shipped).toBe(1);
    expect(mid.run.pendingDemos, 'the live tally must move immediately').toBeGreaterThan(0);
    expect(mid.meta.demos, 'meta.demos must NOT move mid-run').toBe(0);
    expect(mid.derived.demosIfEndedNow).toBe(mid.run.pendingDemos);
    // The HUD shows the live tally with an explicit "banked at run end" label.
    await expect(page.getByTestId(TID.demoTally)).toContainText(String(mid.run.pendingDemos));

    // End the run by blowing the next deadline.
    await advance(page, mid.run.timeLeftMs + 500);
    await frames(page, 4);

    const end = await snap(page);
    expect(end.run.phase).toBe('lost');
    expect(end.meta.demos, 'meta.demos banks exactly the pending tally').toBe(mid.run.pendingDemos);
    expect(end.meta.totalDemosEarned).toBe(mid.run.pendingDemos);
  });

  test('incidents do NOT pause the deadline', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    await forceIncident(page, 'rate_limited');
    const before = await snap(page);
    expect(before.run.incidents.map((i) => i.id)).toContain('rate_limited');
    await expect(page.getByTestId(TID.incidentBanner)).toBeVisible();
    await expect(page.getByTestId(TID.incidentName)).toHaveText('Rate Limited');

    await advance(page, 5_000);

    const after = await snap(page);
    const drop = before.run.timeLeftMs - after.run.timeLeftMs;
    expect(drop, 'the deadline must burn at full speed during an incident').toBeCloseTo(5_000, 0);
  });

  test('rate_limited halts idle production while it is active', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 1_000);
    await agentRow(page, TIER1).click();
    await frames(page, 3);

    const healthy = await snap(page);
    expect(healthy.derived.idleRate).toBeGreaterThan(0);

    await forceIncident(page, 'rate_limited');
    const halted = await snap(page);
    expect(halted.derived.idleRate).toBe(0);

    const slopBefore = halted.run.slop;
    await advance(page, 3_000);
    const during = await snap(page);
    expect(during.run.slop).toBeCloseTo(slopBefore, 5);

    // 8s duration: it clears on its own and idle comes back.
    await advance(page, 6_000);
    const recovered = await snap(page);
    expect(recovered.run.incidents).toHaveLength(0);
    expect(recovered.derived.idleRate).toBeCloseTo(healthy.derived.idleRate, 5);
  });

  test('a click-clearable incident clears early and idle recovers', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await grant(page, 1_000);
    await agentRow(page, TIER1).click();
    await frames(page, 3);
    const healthy = await snap(page);

    await forceIncident(page, 'hallucinated_dep');
    const active = await snap(page);
    const inc = active.run.incidents.find((i) => i.id === 'hallucinated_dep');
    expect(inc, 'forceIncident must install the incident').toBeTruthy();
    expect(inc!.clicksRemaining).toBe(10);
    expect(inc!.remainingMs).toBeGreaterThan(20_000);
    // idleMult 0.5 while it is up.
    expect(active.derived.idleRate).toBeCloseTo(healthy.derived.idleRate * 0.5, 5);
    await expect(page.getByTestId(TID.incidentName)).toHaveText('Hallucinated Dependency');

    await clickLaptopHook(page, 10);
    await frames(page, 4);

    const cleared = await snap(page);
    expect(cleared.run.incidents, 'ten clicks must clear it long before 22s').toHaveLength(0);
    expect(cleared.run.elapsedMs).toBeLessThan(22_000);
    expect(cleared.derived.idleRate).toBeCloseTo(healthy.derived.idleRate, 5);
    await expect(page.getByTestId(TID.incidentBanner)).toBeHidden();
  });

  test('real pointer clicks also count down a click-clearable incident', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forceIncident(page, 'merge_conflict'); // clearWithClicks: 8

    await clickLaptop(page, 4);
    const partway = await snap(page);
    const inc = partway.run.incidents.find((i) => i.id === 'merge_conflict');
    expect(inc?.clicksRemaining).toBe(4);
    await expect(page.getByTestId(TID.incidentTimer)).toBeVisible();

    await clickLaptop(page, 4);
    const done = await snap(page);
    expect(done.run.incidents).toHaveLength(0);
  });

  test('the run-over modal cannot be escaped and leads to the Demos shop', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    const s = await snap(page);
    await advance(page, s.run.timeLeftMs + 500);

    const modal = page.getByTestId(TID.runOverModal);
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await frames(page, 3);
    await expect(modal, 'the run-over modal is not dismissable').toBeVisible();

    await page.getByTestId(TID.runOverContinue).click();
    await frames(page, 3);
    await expect(page.getByTestId(TID.metaScreen)).toBeVisible();
    expect((await snap(page)).screen).toBe('meta');
  });

  test('the deadline strictly decreases while the run is live', async ({ page }) => {
    await bootPage(page);
    await startRun(page);

    let last = (await snap(page)).run.timeLeftMs;
    for (let i = 0; i < 8; i++) {
      await advance(page, 2_000);
      const s = await snap(page);
      expect(s.run.phase).toBe('running');
      expect(s.run.timeLeftMs).toBeLessThan(last);
      expect(s.run.timeLeftMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.run.timeLeftMs)).toBe(true);
      last = s.run.timeLeftMs;
    }
  });
});
