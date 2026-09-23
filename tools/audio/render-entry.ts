/**
 * The in-page half of tools/audio/render.mjs. Bundled into an IIFE and run in
 * headless Chromium, where it renders through the REAL engine and bus (limiter
 * and ceiling included) on an OfflineAudioContext:
 *
 *  - SFX: `engine.play()` / `engine.handle()` at scheduled times. Times after
 *    zero are hit with `ctx.suspend(t)`, so the engine sees the clock exactly
 *    where it would be live.
 *  - Music: the engine's scheduler interval is injected (`timers`) and ticked
 *    by hand every 1024 frames (~23 ms, like the live 25 ms interval) at
 *    suspend points, so the real lookahead scheduler runs faster than real time.
 *
 * Exposes `window.__tmAudio.run(job)`, which returns the measurements and a
 * 16-bit WAV as base64.
 */

import {
  createAudioBus,
  createAudioEngine,
  createMusic,
  type MusicTimers,
  type SoloPart,
} from '../../src/audio/index.ts';
import type { GameEvent, SceneKey, SfxName } from '../../src/sim/types.ts';
import { analyze, encodeWav, seam, toBase64, type Metrics, type SeamMetrics } from './analyze.ts';

export type JobEvent =
  | { readonly at: number; readonly play: SfxName }
  | { readonly at: number; readonly handle: GameEvent }
  | { readonly at: number; readonly scene: SceneKey }
  | { readonly at: number; readonly tension: number }
  | { readonly at: number; readonly fill: number };

export interface Job {
  readonly name: string;
  readonly seconds: number;
  readonly sampleRate?: number;
  /** Bus volumes, 0..1, as the options screen sets them. */
  readonly music: number;
  readonly sfx: number;
  readonly scene?: SceneKey;
  readonly tension?: number;
  readonly fill?: number;
  readonly events?: readonly JobEvent[];
  /** Measure the loop seam: the score's bar length in seconds and where bar 0 starts. */
  readonly seamAt?: { readonly startS: number; readonly barS: number; readonly loopBars: number };
  /**
   * Stems: render the score alone, through the same bus, with every part but
   * these muted. (The engine does not expose solo; this builds bus + score directly.)
   */
  readonly solo?: readonly SoloPart[];
}

export interface JobResult {
  readonly name: string;
  readonly metrics: Metrics;
  readonly seam?: SeamMetrics;
  readonly wav: string;
  readonly hidden: boolean;
  /** Score notes the voice budget refused (0 when no score ran). */
  readonly dropped: number;
}

const QUANTUM = 128;
/** Scheduler ticks every 8 render quanta: 23.2 ms at 44.1 kHz. */
const TICK_FRAMES = QUANTUM * 8;

function fire(engine: ReturnType<typeof createAudioEngine>, ev: JobEvent): void {
  if ('play' in ev) engine.play(ev.play);
  else if ('handle' in ev) engine.handle(ev.handle);
  else if ('scene' in ev) engine.setScene(ev.scene);
  else if ('tension' in ev) engine.setTension(ev.tension);
  else if ('fill' in ev) engine.setContextFill(ev.fill);
}

async function run(job: Job): Promise<JobResult> {
  const sr = job.sampleRate ?? 44100;
  const frames = Math.ceil(job.seconds * sr);
  const ctx = new OfflineAudioContext(2, frames, sr);

  // A holder, not a bare `let`: the callbacks assign it, which control-flow
  // narrowing cannot see.
  const clock: { tick: (() => void) | null } = { tick: null };
  const timers: MusicTimers = {
    setInterval: (fn) => {
      clock.tick = fn;
      return 1;
    },
    clearInterval: () => {
      clock.tick = null;
    },
  };

  if (job.solo) return runStem(job, ctx, clock, timers);

  const engine = createAudioEngine({
    contextFactory: () => ctx as unknown as AudioContext,
    music: job.music,
    sfx: job.sfx,
    handleVisibility: false,
    scene: job.scene ?? 'bedroom',
    timers,
  });
  if (job.tension !== undefined) engine.setTension(job.tension);
  if (job.fill !== undefined) engine.setContextFill(job.fill);
  await engine.unlock();

  // One suspend per render quantum at most: merge everything due at a frame.
  const timeline = new Map<number, Array<() => void>>();
  const at = (seconds: number, fn: () => void): void => {
    const frame = Math.max(0, Math.round((seconds * sr) / QUANTUM) * QUANTUM);
    if (frame >= frames) return;
    const list = timeline.get(frame);
    if (list) list.push(fn);
    else timeline.set(frame, [fn]);
  };
  for (const ev of job.events ?? []) at(ev.at, () => fire(engine, ev));
  if (job.music > 0) {
    for (let f = TICK_FRAMES; f < frames; f += TICK_FRAMES) at(f / sr, () => clock.tick?.());
  }

  // Frame zero runs now, before rendering starts.
  clock.tick?.();
  for (const fn of timeline.get(0) ?? []) fn();
  timeline.delete(0);
  for (const [frame, fns] of [...timeline.entries()].sort((a, b) => a[0] - b[0])) {
    void ctx.suspend(frame / sr).then(() => {
      for (const fn of fns) fn();
      return ctx.resume();
    });
  }

  const rendered = await ctx.startRendering();
  const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
  const metrics = analyze(channels, sr);
  const result: JobResult = {
    name: job.name,
    metrics,
    seam: job.seamAt ? seam(channels, sr, job.seamAt.startS, job.seamAt.barS, job.seamAt.loopBars) : undefined,
    wav: toBase64(encodeWav(channels, sr)),
    hidden: typeof document !== 'undefined' && document.hidden,
    dropped: engine.inspect().music?.rejected ?? 0,
  };
  engine.destroy();
  return result;
}

/** The score alone on the real bus, with a solo mask. */
async function runStem(
  job: Job,
  ctx: OfflineAudioContext,
  clock: { tick: (() => void) | null },
  timers: MusicTimers,
): Promise<JobResult> {
  const sr = ctx.sampleRate;
  const frames = ctx.length;
  const bus = createAudioBus(() => ctx as unknown as AudioContext);
  if (!bus) throw new Error('no bus');
  bus.setMusicVolume(job.music, 0);
  bus.setSfxVolume(job.sfx, 0);
  const music = createMusic(ctx, bus.music, { timers, solo: job.solo });
  music.setScene(job.scene ?? 'bedroom');
  music.setTension(job.tension ?? 0);
  music.setContextFill(job.fill ?? 0);
  music.start();
  clock.tick?.();
  for (let f = TICK_FRAMES; f < frames; f += TICK_FRAMES) {
    void ctx.suspend(f / sr).then(() => {
      clock.tick?.();
      return ctx.resume();
    });
  }
  const rendered = await ctx.startRendering();
  const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
  const dropped = music.inspect().rejected;
  music.destroy();
  return { name: job.name, metrics: analyze(channels, sr), wav: '', hidden: false, dropped };
}

declare global {
  interface Window {
    __tmAudio?: { run(job: Job): Promise<JobResult> };
  }
}

window.__tmAudio = { run };
