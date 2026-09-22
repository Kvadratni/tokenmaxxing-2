/**
 * Walks the agent ladder on a *fresh* save and dumps the rail after every rung.
 *
 * Guards the reported bug: buying the first CLI Agent used to make Subagent
 * Swarm vanish and Ralph Loop appear in its slot, because the locked-preview
 * list was computed without the meta gate.
 */
import { chromium } from '@playwright/test';

const URL = process.env.GAME_URL ?? 'http://localhost:5185/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
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
// The reported save: Subagent Swarm bought in the tree, nothing owned in-run.
await p.evaluate(() => {
  const meta = { ...window.__TOKENMAXXING__.snapshot().meta };
  meta.levels = { ...meta.levels, unlock_swarm: 1, unlock_ralph: 1 };
  localStorage.setItem('tokenmaxxing2.save.v1', JSON.stringify(meta));
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForFunction(() => Boolean(window.__TOKENMAXXING__));

await p.getByTestId('start-run').click();
await p.evaluate(() => {
  window.__TOKENMAXXING__.setTimeScale(0);
  window.__TOKENMAXXING__.startRun(1);
});
await p.waitForTimeout(200);

const rail = async () =>
  p.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="agent-row-"]'), (n) => {
      const id = (n.dataset.testid ?? '').replace('agent-row-', '');
      return n.classList.contains('is-locked') || n.hasAttribute('disabled')
        ? `${id}${n.classList.contains('is-locked') ? '(locked)' : '(unaffordable)'}`
        : id;
    }),
  );

const LADDER = ['tab_autocomplete', 'copy_paste_chatbot', 'agentic_ide', 'cli_agent', 'subagent_swarm'];
console.log('start        :', (await rail()).join('  '));
for (const id of LADDER) {
  await p.evaluate((tier) => {
    window.__TOKENMAXXING__.grant(1e12);
    window.__TOKENMAXXING__.snapshot();
    document.querySelector(`[data-testid="agent-row-${tier}"]`)?.click();
  }, id);
  await p.waitForTimeout(200);
  console.log(`+1 ${id.padEnd(19)}:`, (await rail()).join('  '));
}

const leak = await p.evaluate(() => {
  const s = window.__TOKENMAXXING__.snapshot();
  const shown = Array.from(document.querySelectorAll('[data-testid^="agent-row-"]'), (n) =>
    (n.dataset.testid ?? '').replace('agent-row-', ''),
  );
  return { shown, agents: s.run.agents };
});
console.log('\nrail ids     :', leak.shown.join(', '));
console.log('console errs :', errs.length, errs.slice(0, 3).join(' | '));
await p.locator('[data-testid="shop"]').screenshot({ path: 'artifacts/rail-fresh.png' });
await b.close();
