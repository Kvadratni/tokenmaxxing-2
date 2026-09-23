import { describe, expect, it } from 'vitest';
import * as simIndex from '../../src/sim/index.ts';
import type { Sim } from '../../src/sim/index.ts';
import { createSim } from '../../src/sim/index.ts';

/** Exactly what BUILD_BRIEF.md says index.ts must export. */
const REQUIRED_VALUES = [
  'createSim',
  'DEFAULT_SEED',
  'unlockedContent',
  'metaLevel',
  'metaRequirementsMet',
  'toolCostAt',
  'bulkToolCost',
  'cappedCount',
  'MAX_BULK_BUY',
  'visibleToolList',
  'lockedToolList',
  'unlockHint',
  'availableUpgradeList',
  'makeActiveIncident',
  'SAVE_KEY',
  'loadMeta',
  'saveMeta',
  'clearMeta',
  'defaultMeta',
  'defaultSettings',
  'metaNextCost',
  'formatTokens',
  'formatContext',
  'formatRate',
  'formatTime',
  'formatInt',
  'formatMult',
  'formatPercent',
  'formatEta',
  // content.ts is re-exported wholesale
  'BALANCE',
  'TOOLS',
  'PROMPTS',
  'ACHIEVEMENTS',
  'META_UPGRADES',
  'modelVersion',
] as const;

const SIM_API = [
  'derived',
  'tick',
  'click',
  'collectPickup',
  'buyTool',
  'buyUpgrade',
  'report',
  'claim',
  'compact',
  'keepCards',
  'absolutelyRight',
  'pickCard',
  'rerollDraft',
  'buyMeta',
  'endRun',
  'startRun',
  'availableUpgrades',
  'visibleTools',
  'subscribe',
  'metaCost',
  'setSettings',
  'save',
  'noteDebugHookUsed',
  'unlocked',
  'lockedTools',
] as const;

const DEBUG_API = [
  'grantTokens',
  'grantThumbs',
  'forceIncident',
  'forcePickup',
  'forceDraft',
  'setContext',
  'setPatience',
  'forceVerify',
  'importLegacy',
] as const;

function mk(): Sim {
  return createSim({ seed: 1, storage: null, persist: false });
}

describe('src/sim/index.ts', () => {
  it('exports everything the brief promises', () => {
    const exported = simIndex as Record<string, unknown>;
    for (const name of REQUIRED_VALUES) expect(exported[name], name).toBeDefined();
    expect(simIndex.SAVE_KEY).toBe('tokenmaxxing2.save.v1');
    expect(simIndex.MAX_BULK_BUY).toBeGreaterThan(0);
  });

  it('keeps the save auditor for game 1 private', () => {
    const exported = simIndex as Record<string, unknown>;
    expect(exported['legacySignSave']).toBeUndefined();
    expect(exported['legacyAuditSave']).toBeUndefined();
    expect(exported['readLegacySave']).toBeUndefined();
  });
});

describe('the Sim surface', () => {
  it('implements SimApi plus the shell conveniences', () => {
    const s = mk() as unknown as Record<string, unknown>;
    for (const name of SIM_API) expect(typeof s[name], name).toBe('function');
    for (const name of DEBUG_API) expect(typeof (s['debug'] as Record<string, unknown>)[name], name).toBe('function');
    const sim = mk();
    expect(sim.run.phase).toBe('running');
    expect(sim.meta.version).toBe(1);
    expect(sim.patienceMaxMs).toBe(sim.derived().patienceMaxMs);
  });

  it('subscribe returns an idempotent unsubscribe and survives a throwing sink', () => {
    const s = mk();
    let n = 0;
    s.subscribe(() => {
      throw new Error('broken listener');
    });
    const off = s.subscribe(() => {
      n += 1;
    });
    s.click(160, 112);
    expect(n).toBeGreaterThan(0);
    const seen = n;
    off();
    off();
    s.click(160, 112);
    expect(n).toBe(seen);
  });

  it('onEvent hears events from construction on', () => {
    const kinds: string[] = [];
    createSim({ seed: 1, storage: null, persist: false, onEvent: (e) => kinds.push(e.t) });
    expect(kinds).toEqual(['runStart']);
  });

  it('autoStart: false leaves a valid, tickable placeholder', () => {
    const s = createSim({ seed: 1, storage: null, persist: false, autoStart: false });
    expect(s.run.patienceMs).toBe(s.patienceMaxMs);
    s.tick(100);
    expect(s.run.elapsedMs).toBe(100);
    expect(() => s.derived()).not.toThrow();
  });

  it('setSettings clamps and ignores junk', () => {
    const s = mk();
    s.setSettings({ musicVolume: 3, sfxVolume: -1, reducedMotion: true });
    expect(s.meta.settings.musicVolume).toBe(1);
    expect(s.meta.settings.sfxVolume).toBe(0);
    expect(s.meta.settings.reducedMotion).toBe(true);
    s.setSettings({ musicVolume: Number.NaN } as never);
    expect(s.meta.settings.musicVolume).toBe(1);
  });

  it('unlocked() and lockedTools() reflect the save', () => {
    const s = mk();
    expect([...s.unlocked().tools]).toEqual(['grep', 'read', 'edit', 'bash']);
    expect(s.lockedTools().map((t) => t.id)).toEqual(['read', 'edit', 'bash']);
  });
});

describe('debug hooks', () => {
  it('grantTokens adds to the wallet and to tokensEarned', () => {
    const s = mk();
    s.debug.grantTokens(500);
    s.debug.grantTokens(-5);
    s.debug.grantTokens(Number.NaN);
    expect(s.run.tokens).toBe(500);
    expect(s.run.tokensEarned).toBe(500);
  });

  it('grantThumbs counts as earned, so the save stays coherent', () => {
    const s = mk();
    s.debug.grantThumbs(12);
    expect(s.meta.thumbs).toBe(12);
    expect(s.meta.totalThumbsEarned).toBe(12);
  });

  it('setContext and setPatience take fractions', () => {
    const s = mk();
    s.debug.setContext(0.5);
    expect(s.derived().contextFill).toBeCloseTo(0.5, 10);
    s.debug.setPatience(0.25);
    expect(s.derived().patienceProgress).toBeCloseTo(0.25, 10);
    s.debug.setPatience(0);
    expect(s.run.phase).toBe('lost');
  });

  it('none of them count as the player touching the game', () => {
    const s = mk();
    s.debug.grantTokens(10);
    s.debug.setPatience(1);
    expect(s.run.clicks).toBe(0);
  });
});
