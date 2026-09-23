/**
 * Incidents: the human says things, the world does things. Some run on a
 * timer, some clear once you click them down, and outages block reporting.
 */
import { expect, test, type Page } from '@playwright/test';
import { INCIDENT_BY_ID } from '../../src/sim/content.ts';
import {
  TID,
  advance,
  advanceUntil,
  bootPage,
  clickAgent,
  expectClean,
  forceIncident,
  frames,
  fundReport,
  grant,
  snap,
  startRun,
  toolRow,
} from './harness.ts';

/** Buy one of each tool up to and including `last`, through the real rows. */
async function buyLadder(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    const s = await snap(page);
    const cost = s.derived.nextCosts[id as keyof typeof s.derived.nextCosts];
    if (s.run.tokens < cost) await grant(page, cost - s.run.tokens);
    await toolRow(page, id).click();
    await frames(page, 2);
    expect((await snap(page)).run.tools[id as keyof typeof s.run.tools], `bought ${id}`).toBe(1);
  }
}

test.describe('incidents', () => {
  test('a permission prompt stalls its tool until you click it down', async ({ page }) => {
    const w = await bootPage(page);
    await startRun(page);
    await buyLadder(page, ['grep', 'read', 'edit', 'bash']);
    const before = await snap(page);
    expect(before.derived.toolRates.bash).toBeGreaterThan(0);
    const banner = page.getByTestId(TID.incidentBanner);
    await expect(banner).toBeHidden();

    await forceIncident(page, 'bash_permission');
    const during = await snap(page);
    const inc = during.run.incidents.find((i) => i.id === 'bash_permission');
    expect(inc, 'the incident is active').toBeTruthy();
    expect(INCIDENT_BY_ID['bash_permission']?.permission).toBe(true);
    expect(during.derived.toolHalted.bash).toBe(true);
    expect(during.derived.toolRates.bash).toBe(0);
    expect(during.derived.toolHalted.grep, 'only the tool that asked is stalled').toBe(false);
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId(TID.incidentName)).toBeVisible();
    await expect(banner.getByTestId(TID.incidentTimer)).toBeVisible();

    // Every click asks again; the last one gets the answer.
    const need = inc!.clicksRemaining;
    expect(need).toBeGreaterThan(0);
    if (need > 1) {
      await clickAgent(page, need - 1);
      const almost = await snap(page);
      expect(almost.run.incidents.find((i) => i.id === 'bash_permission')?.clicksRemaining).toBe(1);
      expect(almost.derived.toolHalted.bash, 'still stalled one click short').toBe(true);
    }
    await clickAgent(page, 1);
    const after = await snap(page);
    expect(after.run.incidents.some((i) => i.id === 'bash_permission')).toBe(false);
    expect(after.derived.toolHalted.bash).toBe(false);
    expect(after.derived.toolRates.bash).toBeGreaterThan(0);
    await expect(banner).toBeHidden();
    expectClean(w);
  });

  test('GitHub Is Down blocks reporting until it clears', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await fundReport(page);
    const button = page.getByTestId(TID.reportButton);
    await expect(button).toHaveAttribute('data-state', 'report');

    await forceIncident(page, 'github_down');
    const s = await snap(page);
    expect(s.derived.reportState).toBe('blocked');
    expect(s.derived.reportBlockedBy).toBe(INCIDENT_BY_ID['github_down']!.name);
    await expect(button).toHaveAttribute('data-state', 'blocked');
    await expect(button).toBeDisabled();

    // S is refused too, and says why.
    await page.keyboard.press('s');
    await frames(page, 2);
    expect((await snap(page)).run.reported).toBe(0);
    await expect(page.getByTestId(TID.toast).last()).toBeVisible();

    await advanceUntil(page, (x) => !x.run.incidents.some((i) => i.id === 'github_down'), {
      step: 500,
      what: 'the outage to end',
    });
    await expect(button).toHaveAttribute('data-state', 'report');
    await button.click();
    await frames(page, 2);
    expect((await snap(page)).run.reported).toBe(1);
  });

  test('a timed incident runs its clock in the banner, then ends', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    await forceIncident(page, 'overloaded');
    const s1 = await snap(page);
    expect(s1.derived.clickPower, '529 Overloaded slows everything').toBeLessThan(s0.derived.clickPower);
    const timer = page.getByTestId(TID.incidentTimer);
    const t0 = (await timer.textContent())?.trim();
    await advance(page, 1_000);
    await expect(timer).not.toHaveText(t0 ?? '');

    await advanceUntil(page, (x) => x.run.incidents.length === 0, { step: 500, what: 'the incident to end' });
    const s2 = await snap(page);
    expect(s2.derived.clickPower).toBe(s0.derived.clickPower);
    await expect(page.getByTestId(TID.incidentBanner)).toBeHidden();
  });

  test('rm -rf takes a share of the wallet and a tool with it', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await buyLadder(page, ['grep']);
    await grant(page, 1_000);
    const before = await snap(page);
    await forceIncident(page, 'rm_rf');
    const after = await snap(page);
    expect(after.run.tokens).toBeLessThan(before.run.tokens);
    expect(after.run.tools.grep, 'the only tool owned is the one it took').toBe(before.run.tools.grep - 1);
    expect(after.meta.achievements['rm_rf']).toBeGreaterThan(0);
    await expect(page.getByTestId(TID.toast).last()).toBeVisible();
  });

  test('the human went to lunch: patience stops', async ({ page }) => {
    await bootPage(page);
    await startRun(page);
    await forceIncident(page, 'lunch');
    const s1 = await snap(page);
    expect(s1.derived.patienceFrozen).toBe(true);
    await advance(page, 5_000);
    const s2 = await snap(page);
    expect(s2.run.patienceMs).toBe(s1.run.patienceMs);
    expect(s2.run.elapsedMs).toBeGreaterThan(s1.run.elapsedMs);
  });

  test('a context dump lands in one go, and reporting clears what is active', async ({ page }) => {
    await bootPage(page);
    const s0 = await startRun(page);
    await forceIncident(page, 'screenshot');
    const s1 = await snap(page);
    const dump = INCIDENT_BY_ID['screenshot']!.onStart!.find((a) => a.t === 'context');
    expect(dump).toBeTruthy();
    expect((s1.run.context - s0.run.context) / s1.derived.contextMax).toBeCloseTo(
      (dump as { ofMax: number }).ofMax,
      6,
    );

    await forceIncident(page, 'wait_stop');
    expect((await snap(page)).run.incidents.length).toBeGreaterThan(0);
    await fundReport(page);
    await page.getByTestId(TID.reportButton).click();
    await frames(page, 2);
    expect((await snap(page)).run.incidents, 'a done prompt clears its incidents').toEqual([]);
  });
});
