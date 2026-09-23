/**
 * Drives stage-demo.html: one scenario from stage-scenarios.mjs, looped in
 * real time, with its events replayed every cycle. `window.__stage` exposes the
 * renderer's stats for inspection.
 */
import { createRenderer } from '../../src/render/index.ts';
import { SCENARIOS, SETTINGS } from './stage-scenarios.mjs';

const canvas = document.getElementById('stage');
const nav = document.getElementById('nav');
for (const name of Object.keys(SCENARIOS)) {
  const a = document.createElement('a');
  a.href = `#${name}`;
  a.textContent = name;
  nav.appendChild(a);
}

const renderer = createRenderer(canvas);
let stepping = false;

/**
 * Play a scenario from its start to its capture moment synchronously, with a
 * synthetic 60 fps clock. Works in a hidden tab, where rAF never fires.
 */
function step(which) {
  stepping = true;
  const sc = SCENARIOS[which] ?? SCENARIOS.working;
  const events = [...sc.events].sort((a, b) => a[0] - b[0]);
  renderer.handle({ t: 'runStart', seed: 1 });
  const base = 1000 + Math.random() * 1000;
  for (let t = 0; t <= sc.at + 1e-9; t += 1 / 60) {
    while (events.length && events[0][0] <= t) renderer.handle(events.shift()[1]);
    const pre = sc.before && events.some(([, e]) => e.t === 'compactStart');
    const derived = pre ? { ...sc.derived, contextFill: sc.before.contextFill } : sc.derived;
    const run = pre ? { ...sc.run, context: sc.before.context } : sc.run;
    renderer.draw({ run, derived, settings: SETTINGS, dt: 1 / 60, time: base + t });
  }
  return renderer.renderStats();
}

window.__stage = { renderer, step, stats: () => renderer.renderStats() };

let name = '';
let scenario = null;
let t0 = 0;
let pending = [];
let last = performance.now();

function pick() {
  name = decodeURIComponent(location.hash.slice(1)) || 'working';
  scenario = SCENARIOS[name] ?? SCENARIOS.working;
  t0 = performance.now() / 1000;
  pending = [...scenario.events].sort((a, b) => a[0] - b[0]);
  renderer.handle({ t: 'runStart', seed: 1 });
}
window.addEventListener('hashchange', pick);
pick();

canvas.addEventListener('pointerdown', (e) => {
  const p = renderer.toScene(e.clientX, e.clientY);
  if (renderer.hitsAgent(p.x, p.y)) {
    renderer.handle({ t: 'click', amount: 3, x: p.x, y: p.y, crit: Math.random() < 0.15, auto: false });
  }
});

function frame(now) {
  if (stepping) return;
  const time = now / 1000;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Loop each scenario: capture moment plus two seconds, then start over.
  let local = time - t0;
  if (local > scenario.at + 2) {
    pick();
    local = 0;
  }
  while (pending.length && pending[0][0] <= local) renderer.handle(pending.shift()[1]);
  const pre = scenario.before && pending.some(([, e]) => e.t === 'compactStart');
  const derived = pre ? { ...scenario.derived, contextFill: scenario.before.contextFill } : scenario.derived;
  const run = pre ? { ...scenario.run, context: scenario.before.context } : scenario.run;
  renderer.draw({ run, derived, settings: { ...SETTINGS, screenShake: true }, dt, time });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
