/**
 * Drives soundboard.html: every SfxName (plus the internal toolLost) and the
 * score, through the real engine. Dev only; not part of the game build.
 *
 *   http://localhost:5185/tools/audio/soundboard.html
 *
 * Sounds that take detail from their event go through `handle()` with a real
 * event (sycophancy heat, context fill, who is speaking), exactly as the game
 * fires them. Everything else goes through `play()`.
 */

import {
  attachUnlockOnFirstGesture,
  contextUrgency,
  createAudioEngine,
  SCENES,
  sycophancyThinness,
} from '../../src/audio/index.ts';
import type { GameEvent, SceneKey, SfxName } from '../../src/sim/types.ts';

const engine = createAudioEngine({ music: 0, sfx: 0.8 });
attachUnlockOnFirstGesture(engine);

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function input(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

const state = {
  scene: 'bedroom' as SceneKey,
  playing: false,
};

function volumes(): { music: number; sfx: number } {
  return { music: state.playing ? Number(input('musicVol').value) : 0, sfx: Number(input('sfxVol').value) };
}

/** Unlock (idempotent), then run `fn`: the first click both unlocks and plays. */
async function withAudio(fn: () => void): Promise<void> {
  await engine.unlock();
  const status = $('status');
  if (engine.unlocked) {
    status.textContent = 'audio unlocked';
    status.classList.add('on');
  } else {
    status.textContent = 'audio refused to start (no WebAudio?)';
  }
  fn();
}

function click(crit: boolean, auto: boolean): GameEvent {
  return { t: 'click', amount: 3, x: 160, y: 90, crit, auto };
}

// ---------------------------------------------------------------------------
// SFX
// ---------------------------------------------------------------------------

interface Pad {
  readonly label: string;
  readonly note?: string;
  readonly fire: () => void;
  readonly testid: string;
}

interface Group {
  readonly title: string;
  readonly color: string;
  readonly pads: readonly Pad[];
  readonly sliders?: readonly { id: string; label: string; min: number; max: number; step: number; value: number; show: (v: number) => string }[];
}

const play = (name: SfxName, note?: string): Pad => ({ label: name, note, testid: `sfx-${name}`, fire: () => engine.play(name) });
const handle = (label: string, testid: string, event: () => GameEvent, note?: string): Pad => ({
  label,
  note,
  testid,
  fire: () => engine.handle(event()),
});

function slider(id: string): number {
  return Number(input(id).value);
}

let mashTimer: ReturnType<typeof setInterval> | null = null;
function mash(count: number, hz: number, auto: boolean): void {
  if (mashTimer !== null) clearInterval(mashTimer);
  let left = count;
  mashTimer = setInterval(() => {
    engine.handle(click(!auto && Math.random() < 0.08, auto));
    if (--left <= 0 && mashTimer !== null) {
      clearInterval(mashTimer);
      mashTimer = null;
    }
  }, 1000 / hz);
}

const GROUPS: readonly Group[] = [
  {
    title: 'THE AGENT AT WORK',
    color: 'var(--green)',
    pads: [
      handle('click', 'sfx-click', () => click(false, false), 'walks up'),
      handle('click', 'sfx-click-auto', () => click(false, true), 'auto'),
      { label: 'mash ×16', note: '9 Hz', testid: 'sfx-mash', fire: () => mash(16, 9, false) },
      { label: 'autoclicker', note: '30 Hz, 3 s', testid: 'sfx-autoclicker', fire: () => mash(90, 30, true) },
      handle('clickCrit', 'sfx-clickCrit', () => click(true, false), 'NAILED IT'),
      play('oneShot'),
      handle('sycophancy', 'sfx-sycophancy', () => ({ t: 'sycophancy', restored: 0.01, heat: slider('heat') }), 'heat ↓'),
    ],
    sliders: [
      {
        id: 'heat',
        label: 'sycophancy heat',
        min: 0,
        max: 6,
        step: 0.25,
        value: 0,
        show: (v) => `${v.toFixed(2)} (thin ${sycophancyThinness(v).toFixed(2)})`,
      },
    ],
  },
  {
    title: 'ECONOMY',
    color: 'var(--amber)',
    pads: [
      play('buy', 'install'),
      play('denied'),
      play('metaBuy', 'Training'),
      handle('toolLost', 'sfx-toolLost', () => ({ t: 'toolLost', id: 'bash', owned: 1 }), 'rm -rf'),
      play('uiHover'),
    ],
  },
  {
    title: 'THE REPORT BUTTON',
    color: 'var(--green)',
    pads: [play('report', 'git push'), play('claim', 'sly'), play('caught', 'bonk')],
  },
  {
    title: 'THE TWO CLOCKS',
    color: 'var(--amber)',
    pads: [
      play('compact', '/compact'),
      play('compactForced', 'overflow'),
      handle('contextWarn', 'sfx-contextWarn', () => ({ t: 'contextWarn', fill: slider('warnFill') }), 'fill ↓'),
      play('warn', 'patience'),
    ],
    sliders: [
      {
        id: 'warnFill',
        label: 'context fill',
        min: 0.8,
        max: 1,
        step: 0.01,
        value: 0.8,
        show: (v) => `${v.toFixed(2)} (urgency ${contextUrgency(v).toFixed(2)})`,
      },
    ],
  },
  {
    title: 'PROMPT ENGINEERING (DRAFT)',
    color: 'var(--purple)',
    pads: [play('draftOpen', 'reveal'), play('draftPick', 'select'), play('reroll', 'dice')],
  },
  {
    title: 'THE HUMAN, AND THE WORLD',
    color: 'var(--blue)',
    pads: [
      play('incidentBad', 'world'),
      handle('incidentBad', 'sfx-incidentBad-human', () => ({ t: 'incidentStart', id: 'why_port', tone: 'bad' }), 'human'),
      play('incidentGood', 'world'),
      handle('incidentGood', 'sfx-incidentGood-human', () => ({ t: 'incidentStart', id: 'thanks', tone: 'good' }), 'human'),
      play('interrupt', 'wait stop'),
      play('permission'),
      play('incidentClear'),
    ],
  },
  {
    title: 'RUN END AND MILESTONES',
    color: 'var(--red)',
    pads: [play('win', 'shipped'), play('lose', 'switched models'), play('achievement')],
  },
];

function button(label: string, note: string | undefined, testid: string, color: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (note) {
    const small = document.createElement('small');
    small.textContent = note;
    b.appendChild(small);
  }
  b.dataset['testid'] = testid;
  b.setAttribute('data-testid', testid);
  b.style.setProperty('--c', color);
  b.addEventListener('click', () => void withAudio(onClick));
  b.addEventListener('mouseenter', () => {
    if (input('hoverTicks').checked && engine.unlocked) engine.play('uiHover');
  });
  return b;
}

function buildGroups(): void {
  const host = $('groups');
  for (const g of GROUPS) {
    const box = document.createElement('div');
    box.className = 'group';
    box.style.setProperty('--c', g.color);
    const h = document.createElement('h3');
    h.textContent = g.title;
    box.appendChild(h);
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    for (const p of g.pads) buttons.appendChild(button(p.label, p.note, p.testid, g.color, p.fire));
    box.appendChild(buttons);
    for (const s of g.sliders ?? []) {
      const row = document.createElement('div');
      row.className = 'sliders';
      const label = document.createElement('label');
      label.textContent = `${s.label} `;
      const range = document.createElement('input');
      range.type = 'range';
      range.id = s.id;
      range.min = String(s.min);
      range.max = String(s.max);
      range.step = String(s.step);
      range.value = String(s.value);
      const out = document.createElement('output');
      out.textContent = s.show(s.value);
      range.addEventListener('input', () => {
        out.textContent = s.show(Number(range.value));
      });
      label.append(range, out);
      row.appendChild(label);
      box.appendChild(row);
    }
    host.appendChild(box);
  }
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

const SCENE_KEYS = Object.keys(SCENES) as SceneKey[];

function buildScenes(): void {
  const host = $('scenes');
  for (const key of SCENE_KEYS) {
    const b = button(key, `${SCENES[key].bpm} bpm`, `scene-${key}`, 'var(--blue)', () => {
      state.scene = key;
      engine.setScene(key);
      paintScenes();
    });
    host.appendChild(b);
  }
  paintScenes();
}

function paintScenes(): void {
  for (const key of SCENE_KEYS) {
    const b = document.querySelector(`[data-testid="scene-${key}"]`);
    b?.classList.toggle('on', key === state.scene);
  }
  $('play').classList.toggle('on', state.playing);
}

function bindMusic(): void {
  $('play').addEventListener('click', () =>
    void withAudio(() => {
      state.playing = true;
      engine.setScene(state.scene);
      engine.setVolumes(volumes());
      paintScenes();
    }),
  );
  $('stop').addEventListener('click', () =>
    void withAudio(() => {
      state.playing = false;
      engine.setVolumes(volumes());
      paintScenes();
    }),
  );
  const bindRange = (id: string, out: string, apply: (v: number) => void): void => {
    const el = input(id);
    const show = (): void => {
      $(out).textContent = Number(el.value).toFixed(2);
    };
    el.addEventListener('input', () => {
      show();
      apply(Number(el.value));
    });
    show();
    apply(Number(el.value));
  };
  bindRange('tension', 'tensionOut', (v) => engine.setTension(v));
  bindRange('fill', 'fillOut', (v) => engine.setContextFill(v));
  bindRange('musicVol', 'musicVolOut', () => engine.setVolumes(volumes()));
  bindRange('sfxVol', 'sfxVolOut', () => engine.setVolumes(volumes()));
}

function readout(): void {
  const s = engine.inspect();
  const m = s.music;
  const el = $('readout');
  if (!s.unlocked || !m) {
    el.textContent = 'not playing (click play)';
  } else {
    const f = (v: number, d = 2): string => v.toFixed(d);
    el.innerHTML =
      `playing <b>${m.playing}</b>${m.crossfading ? ` → <b>${s.scene}</b> (crossfading)` : ''}` +
      `   bpm <b>${f(m.bpm, 1)}</b>   bar <b>${m.bar % 16}</b>.<b>${m.step}</b>` +
      `   tension <b>${f(m.tension)}</b>   shelf <b>${f(m.toneShelf, 1)} dB</b>\n` +
      `context fill <b>${f(m.contextFill)}</b>   pad cutoff <b>${Math.round(m.padCutoff)} Hz</b>` +
      `   pressure <b>${f(m.pressure)}</b>   duck <b>${f(m.duck)}</b>` +
      `   voices music <b>${m.voices}</b> sfx <b>${s.sfxVoices}</b>   dropped <b>${m.rejected}</b>`;
  }
  requestAnimationFrame(readout);
}

buildGroups();
buildScenes();
bindMusic();
requestAnimationFrame(readout);

// For the Playwright check and for poking at it from the console.
(window as unknown as { __soundboard: unknown }).__soundboard = { engine };
