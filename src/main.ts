/**
 * Tokenmaxxing 2 — integration layer.
 *
 * Owns exactly three things:
 *   1. the frame loop (sim.tick -> ui.update -> renderer.draw),
 *   2. fan-out of sim events to render / audio / ui,
 *   3. the host-side side effects the UI deliberately cannot do itself
 *      (audio unlock, coordinate conversion, wiping storage).
 *
 * No game logic lives here. If something here starts making a decision about
 * tokens, context or the human, it belongs in src/sim.
 */
import { clearMeta, createSim } from './sim/index.ts';
import type { GameEvent, SceneKey, Settings } from './sim/types.ts';
import { createRenderer } from './render/index.ts';
import type { SceneRenderer } from './render/index.ts';
import { AGENT_RECT } from './render/atlas-types.ts';
import { attachUnlockOnFirstGesture, createAudioEngine, tensionFor } from './audio/index.ts';
import { createUI } from './ui/index.ts';
import { applySimAction } from './ui/actions.ts';
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
  h.textContent = 'Compacted to nothing: the game failed to boot.';
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
  const ui = createUI({ root, sim, onAction: handleAction, agentRect: AGENT_RECT });
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
    // Sim-bound intents are one sim call each; the UI never mutates the sim.
    if (applySimAction(sim, a)) {
      if (a.t === 'settings') applySettings(sim.meta.settings);
      return;
    }
    switch (a.t) {
      case 'canvasPointer': {
        if (!renderer) break;
        const p = renderer.toScene(a.clientX, a.clientY);
        // A drifting collectible wins over the agent: it is small, timed, and
        // often floats right over the hit box.
        if (sim.collectPickup(p.x, p.y)) break;
        if (renderer.hitsAgent(p.x, p.y)) clickAtScene(p.x, p.y);
        break;
      }
      case 'canvasKey': {
        // Keyboard activation always lands on the agent's centre.
        clickAtScene(AGENT_RECT.x + AGENT_RECT.w / 2, AGENT_RECT.y + AGENT_RECT.h / 2);
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
    // rather than fast-forwarding the player into an empty patience bar.
    const frameMs = rawMs > MAX_FRAME_MS ? 0 : rawMs;
    fps += (1000 / Math.max(rawMs, 1) - fps) * 0.08;

    // The title and Training screens are outside the run: the human's patience
    // must not burn while the player is shopping for Training.
    if (ui.screen === 'run') sim.tick(frameMs * timeScale);

    const derived = sim.derived();
    ui.update(sim.run, derived, sim.meta);

    const scene = derived.scene;
    if (scene !== lastScene) {
      lastScene = scene;
      audio.setScene(scene);
    }
    audio.setTension(ui.screen === 'run' ? tensionFor(derived) : 0);

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
     * A player of the first game found `?testhooks=1` works in production and
     * wrote an autoclicker on top of this API. So driving the game this way is
     * content: the QA Engineer achievement. `snapshot` and `renderStats` are deliberately not wrapped:
     * looking at state is not playing through it.
     */
    const cheeky = <A extends unknown[], R>(fn: (...a: A) => R): ((...a: A) => R) => {
      return (...a: A): R => {
        sim.noteDebugHookUsed();
        return fn(...a);
      };
    };

    const agentCentre = (): { x: number; y: number } => ({
      x: AGENT_RECT.x + AGENT_RECT.w / 2,
      y: AGENT_RECT.y + AGENT_RECT.h / 2,
    });

    const hooks: TestHooks = {
      version: 2,
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
        // Feed the sim in sane slices so incidents, compactions and patience
        // resolve in order rather than in one giant leap.
        let left = Math.max(0, ms);
        while (left > 0) {
          const step = Math.min(left, 100);
          sim.tick(step);
          left -= step;
        }
      }),
      grant: cheeky((amount: number) => sim.debug.grantTokens(amount)),
      grantThumbs: cheeky((n: number) => sim.debug.grantThumbs(n)),
      startRun: cheeky((seed: number) => sim.startRun(seed)),
      forceIncident: cheeky((id: string) => {
        if (!sim.debug.forceIncident(id)) throw new Error(`could not force incident: ${id}`);
      }),
      forcePickup: cheeky((id: string, x?: number, y?: number) => {
        if (!sim.debug.forcePickup(id, x, y)) throw new Error(`could not force pickup: ${id}`);
      }),
      forceDraft: cheeky((ids: string[]) => {
        if (!sim.debug.forceDraft(ids)) throw new Error(`could not force draft: ${ids.join(',')}`);
      }),
      clickAgent: cheeky((n: number) => {
        const c = agentCentre();
        for (let i = 0; i < n; i++) clickAtScene(c.x, c.y);
      }),
      setContext: cheeky((fill: number) => sim.debug.setContext(fill)),
      setPatience: cheeky((fill: number) => sim.debug.setPatience(fill)),
      forceVerify: cheeky((outcome: 'pass' | 'catch' | null) => sim.debug.forceVerify(outcome)),
      importLegacy: cheeky((raw: string) => sim.debug.importLegacy(raw)),
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
    window.__TOKENMAXXING2__ = hooks;
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
    delete window.__TOKENMAXXING2__;
  }
  if (import.meta.hot) import.meta.hot.dispose(destroy);
}

try {
  boot();
} catch (err) {
  bootError('Something in the context window threw during startup.', err);
  throw err;
}
