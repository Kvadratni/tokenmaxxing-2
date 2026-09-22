/**
 * Tokenmaxxing — integration layer.
 *
 * Owns exactly three things:
 *   1. the frame loop (sim.tick -> ui.update -> renderer.draw),
 *   2. fan-out of sim events to render / audio / ui,
 *   3. the host-side side effects the UI deliberately cannot do itself
 *      (audio unlock, coordinate conversion, wiping storage).
 *
 * No game logic lives here. If something here starts making a decision about
 * slop, it belongs in src/sim.
 */
import {
  INCIDENT_BY_ID,
  PICKUP_BY_ID,
  PICKUP_TUNING,
  clearMeta,
  createSim,
  makeActiveIncident,
  projectAt,
} from './sim/index.ts';
import type { ActiveIncident, GameEvent, SceneKey, Settings } from './sim/types.ts';
import { createRenderer } from './render/index.ts';
import type { SceneRenderer } from './render/index.ts';
import { LAPTOP_RECT } from './render/atlas-types.ts';
import { attachUnlockOnFirstGesture, createAudioEngine } from './audio/index.ts';
import { createUI } from './ui/index.ts';
import type { UIAction } from './ui/types.ts';
import type { TestHooks } from './testids.ts';

/** Largest frame delta we will integrate. Longer gaps are treated as a pause. */
const MAX_FRAME_MS = 250;

function bootError(message: string, detail: unknown): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.textContent = '';
  const box = document.createElement('div');
  box.style.cssText =
    'max-width:56ch;margin:auto;padding:24px;color:#e5484d;font:12px/1.7 ui-monospace,monospace;';
  const h = document.createElement('strong');
  h.textContent = 'SIGKILL — the game failed to boot.';
  const p = document.createElement('p');
  p.textContent = message;
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;color:#9aa4b2;';
  pre.textContent = detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail);
  box.append(h, p, pre);
  root.appendChild(box);
}

function boot(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app is missing from index.html');
  root.textContent = '';

  const params = new URLSearchParams(location.search);
  // Hooks are also on in dev, purely for convenience at the console.
  const wantHooks = import.meta.env.DEV || params.has('testhooks');
  /**
   * Tampering detection is off *only* for the explicit `?testhooks=1` harness,
   * which injects raw saves by design and would otherwise earn Script Kiddie on
   * every e2e run. It deliberately does not key off `import.meta.env.DEV`:
   * that also covered anyone simply playing on the dev server, so editing your
   * own save locally was silently undetectable.
   */
  const trustSave = params.has('testhooks');

  // --- core objects -------------------------------------------------------
  const sim = createSim({ autoStart: true, trustSave });
  // `createUI` emits actions (notably 'scale') during construction, before the
  // renderer can exist — it needs the canvas the UI is still building. So the
  // renderer binding is mutable and every handler tolerates it being absent.
  let renderer: SceneRenderer | null = null;
  const ui = createUI({ root, sim, onAction: handleAction });
  renderer = createRenderer(ui.canvas);
  // From here on the renderer is guaranteed; `view` spares every later call site
  // a null check the construction-order dance only needed once.
  const view: SceneRenderer = renderer;
  const audio = createAudioEngine();

  const detachUnlock = attachUnlockOnFirstGesture(audio);
  audio.setVolumes({ music: sim.meta.settings.musicVolume, sfx: sim.meta.settings.sfxVolume });

  // Sim events fan out to every consumer. The sim already isolates throwing
  // listeners, so one broken consumer cannot wedge the others.
  const unsubscribe = sim.subscribe((e: GameEvent) => {
    view.handle(e);
    audio.handle(e);
    ui.handle(e);
  });

  // --- host-side actions --------------------------------------------------
  function clickAtScene(x: number, y: number): void {
    if (sim.run.phase !== 'running') return;
    sim.click(x, y);
  }

  function handleAction(a: UIAction): void {
    switch (a.t) {
      case 'canvasPointer': {
        if (!renderer) break;
        const p = renderer.toScene(a.clientX, a.clientY);
        // A drifting collectible wins over the laptop: it is small, timed, and
        // often floats right over the hit box.
        if (sim.collectPickup(p.x, p.y)) break;
        if (renderer.hitsLaptop(p.x, p.y)) clickAtScene(p.x, p.y);
        break;
      }
      case 'canvasKey': {
        // Keyboard activation always lands on the laptop centre.
        clickAtScene(LAPTOP_RECT.x + LAPTOP_RECT.w / 2, LAPTOP_RECT.y + LAPTOP_RECT.h / 2);
        break;
      }
      case 'settingsChange': {
        applySettings(a.settings);
        break;
      }
      case 'resetSave': {
        clearMeta();
        location.reload();
        break;
      }
      case 'scale': {
        renderer?.resize();
        break;
      }
      case 'uiHover': {
        audio.play('uiHover');
        break;
      }
      default:
        break;
    }
  }

  function applySettings(s: Settings): void {
    audio.setVolumes({ music: s.musicVolume, sfx: s.sfxVolume });
  }

  // --- frame loop ---------------------------------------------------------
  const t0 = performance.now();
  let last = t0;
  let timeScale = 1;
  let raf = 0;
  let lastScene: SceneKey | null = null;
  let fps = 60;

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);

    const rawMs = now - last;
    last = now;
    // A backgrounded tab produces one enormous delta. Treat it as a pause
    // rather than fast-forwarding the player into a missed deadline.
    const frameMs = rawMs > MAX_FRAME_MS ? 0 : rawMs;
    fps += (1000 / Math.max(rawMs, 1) - fps) * 0.08;

    // The title and meta screens are outside the run — the deadline must not
    // burn while the player is shopping for meta upgrades.
    if (ui.screen === 'run') sim.tick(frameMs * timeScale);

    const derived = sim.derived();
    ui.update(sim.run, derived, sim.meta);

    const scene = projectAt(sim.run.projectIndex).scene;
    if (scene !== lastScene) {
      lastScene = scene;
      audio.setScene(scene);
    }
    audio.setTension(ui.screen === 'run' ? 1 - derived.deadlineProgress : 0);

    view.draw({
      run: sim.run,
      derived,
      settings: sim.meta.settings,
      dt: frameMs / 1000,
      time: (now - t0) / 1000,
    });
  }
  raf = requestAnimationFrame(frame);

  // Coming back from a hidden tab: drop the accumulated delta on the floor.
  function onVisibility(): void {
    if (!document.hidden) last = performance.now();
  }
  document.addEventListener('visibilitychange', onVisibility);

  // --- test hooks ---------------------------------------------------------
  if (wantHooks) {
    /**
     * Wrap a mutating hook so using it earns the QA Engineer achievement.
     *
     * A player found `?testhooks=1` works in production — it is documented, and
     * the verification scripts depend on it against the deployed build — and
     * wrote an autoclicker on top of this API. So driving the game this way is
     * content now. `snapshot` and `renderStats` are deliberately not wrapped:
     * looking at state is not playing through it.
     */
    const cheeky = <A extends unknown[], R>(fn: (...a: A) => R): ((...a: A) => R) => {
      return (...a: A): R => {
        sim.noteDebugHookUsed();
        return fn(...a);
      };
    };

    const hooks: TestHooks = {
      version: 1,
      snapshot: () =>
        JSON.parse(
          JSON.stringify({
            run: sim.run,
            meta: sim.meta,
            derived: sim.derived(),
            screen: ui.screen,
          }),
        ),
      advance: cheeky((ms: number) => {
        // Feed the sim in sane slices so incidents and deadlines resolve in
        // order rather than in one giant leap.
        let left = Math.max(0, ms);
        while (left > 0) {
          const step = Math.min(left, 100);
          sim.tick(step);
          left -= step;
        }
      }),
      grant: cheeky((amount: number) => {
        sim.run.slop += amount;
      }),
      startRun: cheeky((seed: number) => sim.startRun(seed)),
      forceIncident: cheeky((id: string) => {
        const def = INCIDENT_BY_ID[id];
        if (!def) throw new Error(`unknown incident: ${id}`);
        if (sim.run.incidents.some((i: ActiveIncident) => i.id === id)) return;
        sim.run.incidents.push(makeActiveIncident(def, sim.run.elapsedMs));
      }),
      forcePickup: cheeky((id: string, x = 160, y = 80) => {
        if (!PICKUP_BY_ID[id]) throw new Error(`unknown pickup: ${id}`);
        sim.run.pickup = {
          id,
          x,
          y,
          vx: 0,
          baseY: y,
          ageS: 0,
          remainingMs: PICKUP_TUNING.LIFETIME_MS,
        };
      }),
      forceDraft: cheeky((ids: string[]) => {
        sim.run.draftOffer = ids.slice();
        sim.run.phase = 'drafting';
      }),
      clickLaptop: cheeky((n: number) => {
        for (let i = 0; i < n; i++) {
          clickAtScene(LAPTOP_RECT.x + LAPTOP_RECT.w / 2, LAPTOP_RECT.y + LAPTOP_RECT.h / 2);
        }
      }),
      setTimeScale: cheeky((k: number) => {
        timeScale = Math.max(0, k);
      }),
      // Wiping the save is how you *stop* cheating; no trophy for that.
      resetSave: () => clearMeta(),
      renderStats: () => {
        const s = view.renderStats();
        return { ...s, fps: Math.round(fps) };
      },
    };
    window.__TOKENMAXXING__ = hooks;
  }

  // --- teardown (dev HMR / tests) ----------------------------------------
  function destroy(): void {
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
    unsubscribe();
    detachUnlock();
    ui.destroy();
    view.destroy();
    audio.destroy();
    delete window.__TOKENMAXXING__;
  }
  if (import.meta.hot) import.meta.hot.dispose(destroy);
}

try {
  boot();
} catch (err) {
  bootError('Something in the slop pipeline threw during startup.', err);
  throw err;
}
