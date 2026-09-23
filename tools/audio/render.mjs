#!/usr/bin/env node
/**
 * Offline audio render + measurement.
 *
 *   node tools/audio/render.mjs            # everything
 *   node tools/audio/render.mjs click win  # only jobs whose name contains a filter
 *
 * Renders every SFX (and the variants the engine reaches through events) plus
 * 16 s of each scene's music through the REAL engine and bus, limiter and
 * ceiling included, in headless Chromium with an OfflineAudioContext. The
 * harness (render-entry.ts) is bundled in memory with Vite, so no server is
 * needed. Writes WAVs and report.json to artifacts/audio/, prints a table,
 * and checks:
 *
 *   - no clipping: peak <= -1 dBFS after the limiter;
 *   - nothing silent;
 *   - loudness tiers: clicks and hover quiet, UI medium, the big moments loud
 *     but under the limiter;
 *   - the score's RMS well under the loud SFX;
 *   - no DC offset;
 *   - loop seams that look like any other bar line (no click, no dropout).
 *
 * Exit code 1 when a check fails.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { build } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(ROOT, 'artifacts/audio');

/** The game's default settings (src/sim/save.ts), so levels are what a player hears. */
const MUSIC_VOL = 0.6;
const SFX_VOL = 0.8;

const SCENES = {
  bedroom: 84,
  coworking: 88,
  openplan: 92,
  datacenter: 94,
  orbital: 96,
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const SFX_NAMES = [
  'click',
  'clickCrit',
  'oneShot',
  'buy',
  'denied',
  'report',
  'claim',
  'caught',
  'compact',
  'compactForced',
  'sycophancy',
  'draftOpen',
  'draftPick',
  'reroll',
  'incidentBad',
  'incidentGood',
  'incidentClear',
  'interrupt',
  'permission',
  'warn',
  'contextWarn',
  'lose',
  'win',
  'uiHover',
  'metaBuy',
  'achievement',
];

/** Seconds of render for a one-shot: enough for the longest tail. */
const LONG = new Set(['win', 'lose', 'compactForced', 'report', 'achievement']);

const click = (crit = false, auto = false) => ({ t: 'click', amount: 3, x: 0, y: 0, crit, auto });
const incident = (id, tone) => ({ t: 'incidentStart', id, tone });

/**
 * The limiter starts life clamped down and needs a moment to open, so every
 * SFX job waits this long before its first event (the live game never plays
 * a sound in the first instant after unlock either).
 */
const PREROLL = 0.5;

function sfxJob(name, events, seconds) {
  return { name, seconds: seconds + PREROLL, music: 0, sfx: SFX_VOL, events: events.map((e) => ({ ...e, at: e.at + PREROLL })) };
}

function jobs() {
  const list = [];
  for (const name of SFX_NAMES) {
    list.push(sfxJob(name, [{ at: 0, play: name }], LONG.has(name) ? 3 : 1.6));
  }
  list.push(sfxJob('toolLost', [{ at: 0, handle: { t: 'toolLost', id: 'bash', owned: 1 } }], 1.2));

  // Variants the engine reaches through events.
  list.push(sfxJob('click.auto', [{ at: 0, handle: click(false, true) }], 0.6));
  list.push(sfxJob('clickCrit.auto', [{ at: 0, handle: click(true, true) }], 1.2));
  const run = [];
  for (let i = 0; i < 14; i++) run.push({ at: i * 0.11, handle: click(i === 9, false) });
  for (let i = 0; i < 4; i++) run.push({ at: 2.4 + i * 0.12, handle: click(false, false) });
  list.push(sfxJob('click.run', run, 3.4));
  const mash = [];
  for (let i = 0; i < 90; i++) mash.push({ at: i * 0.075, handle: click(false, false) });
  list.push(sfxJob('click.mash', mash, 7.5));
  const auto = [];
  for (let i = 0; i < 90; i++) auto.push({ at: i / 30, handle: click(i % 17 === 5, true) });
  list.push(sfxJob('click.autorun', auto, 3.4));
  for (const heat of [3, 6]) {
    list.push(sfxJob(`sycophancy.heat${heat}`, [{ at: 0, handle: { t: 'sycophancy', restored: 0.01, heat } }], 1.2));
  }
  list.push(sfxJob('contextWarn.95', [{ at: 0, handle: { t: 'contextWarn', fill: 0.95 } }], 1.6));
  list.push(sfxJob('incidentBad.human', [{ at: 0, handle: incident('why_port', 'bad') }], 1.2));
  list.push(sfxJob('incidentGood.human', [{ at: 0, handle: incident('thanks', 'good') }], 1.2));
  list.push(sfxJob('incidentBad.world', [{ at: 0, handle: incident('overloaded', 'bad') }], 1.4));
  list.push(sfxJob('incidentGood.world', [{ at: 0, handle: incident('flow_state', 'good') }], 1.6));
  list.push(sfxJob('permission.bash', [{ at: 0, handle: { t: 'incidentStart', id: 'bash_permission', tone: 'bad', tool: 'bash' } }], 1.6));
  list.push(sfxJob('pickup.thanks', [{ at: 0, handle: { t: 'pickupCollect', id: 'thanks_note', x: 0, y: 0 } }], 1.2));

  // Music: 16 s of every scene, calm, at the game's default music volume.
  for (const [scene, bpm] of Object.entries(SCENES)) {
    const barS = (4 * 60) / bpm;
    list.push({
      name: `music.${scene}`,
      seconds: 16,
      music: MUSIC_VOL,
      sfx: SFX_VOL,
      scene,
      tension: 0,
      fill: 0.3,
      seamAt: { startS: 0.06, barS, loopBars: 4 },
    });
  }
  // The extremes: panic and a nearly full window.
  list.push({ name: 'music.bedroom.tense', seconds: 12, music: MUSIC_VOL, sfx: SFX_VOL, scene: 'bedroom', tension: 1, fill: 0.5 });
  list.push({ name: 'music.openplan.tense', seconds: 12, music: MUSIC_VOL, sfx: SFX_VOL, scene: 'openplan', tension: 1, fill: 0.5 });
  list.push({ name: 'music.datacenter.full', seconds: 12, music: MUSIC_VOL, sfx: SFX_VOL, scene: 'datacenter', tension: 0.9, fill: 0.97 });
  list.push({ name: 'music.orbital.empty', seconds: 12, music: MUSIC_VOL, sfx: SFX_VOL, scene: 'orbital', tension: 0, fill: 0 });
  // The context filter, measured: the pad alone, window empty vs full, and the pressure drone.
  for (const fill of [0, 1]) {
    list.push({ name: `music.pad.fill${fill}`, seconds: 8, music: MUSIC_VOL, sfx: SFX_VOL, scene: 'coworking', tension: 0, fill, solo: ['pad'] });
  }
  list.push({ name: 'music.pressure', seconds: 8, music: MUSIC_VOL, sfx: SFX_VOL, scene: 'coworking', tension: 0, fill: 1, solo: ['pressure'] });
  // A scene change mid-song: the crossfade.
  list.push({
    name: 'music.xfade',
    seconds: 20,
    music: MUSIC_VOL,
    sfx: SFX_VOL,
    scene: 'bedroom',
    tension: 0.2,
    fill: 0.3,
    events: [{ at: 4, scene: 'coworking' }, { at: 13, scene: 'datacenter' }],
  });
  // The soundboard's torture test: a crossfade into the densest room, tense and nearly full.
  list.push({
    name: 'music.xfade.tense',
    seconds: 14,
    music: MUSIC_VOL,
    sfx: SFX_VOL,
    scene: 'bedroom',
    tension: 0,
    fill: 0.3,
    events: [{ at: 1.5, scene: 'datacenter' }, { at: 1.5, tension: 0.9 }, { at: 1.5, fill: 0.95 }],
  });
  list.push({
    name: 'music.xfade.orbital',
    seconds: 14,
    music: MUSIC_VOL,
    sfx: SFX_VOL,
    scene: 'datacenter',
    tension: 1,
    fill: 0.9,
    events: [{ at: 1.5, scene: 'orbital' }],
  });
  // The worst case: everything at once, at full volume, over the loudest score.
  const stress = [];
  stress.push({ at: 0.3, play: 'report' }, { at: 0.35, play: 'compactForced' }, { at: 0.4, play: 'win' });
  stress.push({ at: 0.45, play: 'caught' }, { at: 0.5, play: 'interrupt' }, { at: 0.55, play: 'achievement' });
  for (let i = 0; i < 30; i++) stress.push({ at: 0.2 + i * 0.04, handle: click(i % 4 === 0, false) });
  list.push({ name: 'stress.all', seconds: 5, music: 1, sfx: 1, scene: 'orbital', tension: 1, fill: 0.97, events: stress });
  return list;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Peak windows (dBFS) per tier. */
const TIERS = [
  { tier: 'subtle', peak: [-44, -28], names: ['uiHover'] },
  {
    tier: 'quiet',
    peak: [-34, -16],
    // The hollow, spammed "absolutely right" is meant to be faint.
    names: ['click', 'click.auto', 'click.run', 'click.mash', 'click.autorun', 'sycophancy.heat6'],
  },
  {
    tier: 'ui',
    peak: [-24, -8],
    names: [
      'clickCrit',
      'clickCrit.auto',
      'oneShot',
      'buy',
      'denied',
      'claim',
      'sycophancy',
      'sycophancy.heat3',
      'draftOpen',
      'draftPick',
      'reroll',
      'incidentBad',
      'incidentGood',
      'incidentClear',
      'permission',
      'permission.bash',
      'warn',
      'contextWarn',
      'contextWarn.95',
      'metaBuy',
      'achievement',
      'incidentBad.human',
      'incidentGood.human',
      'incidentBad.world',
      'incidentGood.world',
      'pickup.thanks',
      'interrupt',
      'toolLost',
    ],
  },
  { tier: 'loud', peak: [-10, -1], names: ['report', 'caught', 'compact', 'compactForced', 'win', 'lose'] },
];

function tierOf(name) {
  if (name.startsWith('music.')) return { tier: 'music', peak: [-40, -6] };
  if (name.startsWith('stress.')) return { tier: 'stress', peak: [-60, -1] };
  return TIERS.find((t) => t.names.includes(name)) ?? { tier: '?', peak: [-60, -1] };
}

function fmt(n, width, digits = 1) {
  const s = Number.isFinite(n) ? n.toFixed(digits) : String(n);
  return s.padStart(width);
}

function check(results) {
  const problems = [];
  const loud = results.filter((r) => tierOf(r.name).tier === 'loud');
  const loudRms = loud.map((r) => r.metrics.stRmsDb).sort((a, b) => a - b);
  const loudMedian = loudRms[Math.floor(loudRms.length / 2)] ?? -12;
  for (const r of results) {
    const m = r.metrics;
    const { tier, peak } = tierOf(r.name);
    const flags = [];
    if (m.peakDb > -1) flags.push('CLIP');
    if (m.clipped > 0) flags.push(`FULLSCALE×${m.clipped}`);
    if (m.spikes > 0) flags.push(`SPIKES×${m.spikes}`);
    if (m.peakDb < -60) flags.push('SILENT');
    if (m.peakDb < peak[0]) flags.push(`QUIET<${peak[0]}`);
    if (m.peakDb > peak[1]) flags.push(`LOUD>${peak[1]}`);
    if (Math.abs(m.dc) > 0.002) flags.push(`DC ${m.dc.toFixed(4)}`);
    if (m.monoLossDb < -4) flags.push(`MONO ${m.monoLossDb.toFixed(1)}`);
    if (tier === 'music' && m.rmsDb > loudMedian - 8) flags.push(`MUSIC HOT (loud SFX st ${loudMedian.toFixed(1)})`);
    // The score's note budget: a few refusals in a crossfade are fine, a steady trickle is not.
    const allowed = r.name.includes('xfade') || r.name.startsWith('stress') ? 20 : 0;
    if (r.dropped > allowed) flags.push(`DROPPED ${r.dropped} score notes`);
    if (r.seam) {
      const s = r.seam;
      if (s.seamJump > Math.max(1.5, s.barJump * 2)) flags.push(`SEAM JUMP ${s.seamJump.toFixed(2)}`);
      if (s.seamDipDb < Math.min(-24, s.barDipDb - 10)) flags.push(`SEAM DIP ${s.seamDipDb.toFixed(1)}`);
    }
    r.tier = tier;
    r.flags = flags;
    if (flags.length) problems.push(`${r.name}: ${flags.join(', ')}`);
  }
  return { problems, loudMedian };
}

function table(results, loudMedian) {
  const head = `${'name'.padEnd(24)}${'tier'.padEnd(8)}${'dur s'.padStart(7)}${'peak'.padStart(8)}${'rms'.padStart(8)}${'st-rms'.padStart(8)}${'centroid'.padStart(10)}${'dc'.padStart(9)}${'mono'.padStart(7)}  flags`;
  const lines = [head, '-'.repeat(head.length + 10)];
  for (const r of results) {
    const m = r.metrics;
    lines.push(
      `${r.name.padEnd(24)}${r.tier.padEnd(8)}${fmt(m.active, 7, 2)}${fmt(m.peakDb, 8)}${fmt(m.rmsDb, 8)}${fmt(m.stRmsDb, 8)}${fmt(m.centroidHz, 10, 0)}${fmt(m.dc, 9, 5)}${fmt(m.monoLossDb, 7)}  ${r.flags.join(', ') || 'ok'}`,
    );
  }
  lines.push('');
  lines.push(`levels in dBFS after the limiter; st-rms = loudest 50 ms; loud-SFX median st-rms ${loudMedian.toFixed(1)}`);
  const seams = results.filter((r) => r.seam);
  if (seams.length) {
    lines.push('');
    lines.push(`${'loop seam'.padEnd(24)}${'loop s'.padStart(8)}${'seam jump'.padStart(11)}${'bar jump'.padStart(10)}${'seam dip'.padStart(10)}${'bar dip'.padStart(9)}`);
    for (const r of seams) {
      const s = r.seam;
      lines.push(
        `${r.name.padEnd(24)}${fmt(s.loopS, 8, 2)}${fmt(s.seamJump, 11, 2)}${fmt(s.barJump, 10, 2)}${fmt(s.seamDipDb, 10)}${fmt(s.barDipDb, 9)}`,
      );
    }
    lines.push('(jump = biggest sample step within 3 ms, over the 99.9th-percentile step; dip = quietest 10 ms within 60 ms, dB vs median)');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function bundle() {
  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    publicDir: false,
    build: {
      write: false,
      emptyOutDir: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: join(HERE, 'render-entry.ts'),
        formats: ['iife'],
        name: 'TMAudioRender',
        fileName: () => 'render.js',
      },
    },
  });
  const out = Array.isArray(result) ? result[0] : result;
  const chunk = out.output.find((o) => o.type === 'chunk');
  if (!chunk) throw new Error('bundle produced no chunk');
  return chunk.code;
}

/** `--stems`: every part of every scene on its own, to balance the mix. */
const STEM_PARTS = ['pad', 'keys', 'lead', 'bass', 'kick', 'snare', 'rim', 'hat', 'arp', 'crackle', 'texture'];

function stemJobs() {
  const list = [];
  for (const scene of Object.keys(SCENES)) {
    list.push({ name: `stem.${scene}.all`, seconds: 11, music: MUSIC_VOL, sfx: SFX_VOL, scene, tension: 0.3, fill: 0.5 });
    for (const part of STEM_PARTS) {
      list.push({ name: `stem.${scene}.${part}`, seconds: 11, music: MUSIC_VOL, sfx: SFX_VOL, scene, tension: 0.3, fill: 0.5, solo: [part] });
    }
  }
  return list;
}

function stemTable(results) {
  const scenes = Object.keys(SCENES);
  const cols = ['all', ...STEM_PARTS];
  const lines = [`${'rms dBFS (peak)'.padEnd(12)}${cols.map((c) => c.padStart(13)).join('')}`];
  for (const scene of scenes) {
    const cells = cols.map((c) => {
      const r = results.find((x) => x.name === `stem.${scene}.${c}`);
      if (!r || r.metrics.peakDb < -80) return '-'.padStart(13);
      return `${r.metrics.rmsDb.toFixed(1)} (${r.metrics.peakDb.toFixed(0)})`.padStart(13);
    });
    lines.push(`${scene.padEnd(12)}${cells.join('')}`);
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const stems = argv.includes('--stems');
  const filters = argv.filter((a) => !a.startsWith('--'));
  const pool = stems ? stemJobs() : jobs();
  const selected = pool.filter((j) => filters.length === 0 || filters.some((f) => j.name.includes(f)));
  if (selected.length === 0) {
    console.error('no jobs match', filters);
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  const code = await bundle();

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setContent('<!doctype html><title>audio render</title>');
    await page.addScriptTag({ content: code });

    const results = [];
    for (const job of selected) {
      const t0 = Date.now();
      const r = await page.evaluate((j) => window.__tmAudio.run(j), job);
      if (r.wav) writeFileSync(join(OUT, `${job.name}.wav`), Buffer.from(r.wav, 'base64'));
      delete r.wav;
      results.push(r);
      process.stderr.write(`  rendered ${job.name} (${Date.now() - t0} ms)\n`);
      if (r.hidden) errors.push(`${job.name}: document.hidden in the render page, the score may not have run`);
    }
    if (stems) {
      console.log(stemTable(results));
      return;
    }
    const { problems, loudMedian } = check(results);
    console.log(table(results, loudMedian));
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ volumes: { music: MUSIC_VOL, sfx: SFX_VOL }, results }, null, 2));
    console.log(`\nwrote ${results.length} WAVs + report.json to ${OUT}`);
    if (errors.length) {
      console.log('\npage errors:');
      for (const e of errors) console.log(`  ${e}`);
    }
    if (problems.length || errors.length) {
      console.log(`\n${problems.length} problem(s):`);
      for (const p of problems) console.log(`  ${p}`);
      process.exitCode = 1;
    } else {
      console.log('\nall checks passed');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
