/**
 * Help, About, Options, toasts and the achievement popup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_BY_ID, BALANCE, CARD_BY_ID, UPGRADE_BY_ID } from '../../src/sim/content.ts';
import { TID } from '../../src/testids.ts';
import { HELP_CONTROLS } from '../../src/ui/help.ts';
import { DENIED_TEXT } from '../../src/ui/index.ts';
import { isHidden, key, makeMeta, makeSettings, mountUI, must, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

const toasts = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll(`[data-testid="${TID.toast}"]`), (n) => n.textContent ?? '');

describe('help', () => {
  it('opens from ? and covers the mechanics and the controls', () => {
    const m = mountUI();
    (must(m.root, TID.helpButton) as HTMLButtonElement).click();
    const modal = must(m.root, TID.helpModal);
    expect(isHidden(modal)).toBe(false);
    const all = modal.textContent ?? '';
    expect(all).toContain('context window');
    expect(all).toContain('CLAIM DONE');
    expect(all).toContain('/compact');
    expect(all).toContain('(contents too large to include)');
    // Numbers come from content, never typed in.
    expect(all).toContain(`${Math.round(BALANCE.COMPACT_KEEP_FORCED * 100)}%`);
    expect(all).toContain(`${Math.round(BALANCE.CLAIM_THRESHOLD * 100)}%`);
  });

  it('lists every control: the agent or Space, 1-9, S, Y, C, Esc', () => {
    const m = mountUI();
    const controls = must(m.root, TID.helpControls);
    const keys = Array.from(controls.querySelectorAll('kbd'), (k) => k.textContent);
    for (const k of ['Space', '1–9', 'S', 'Y', 'C', 'Esc']) expect(keys).toContain(k);
    expect(controls.textContent).toContain('agent');
    expect(controls.querySelectorAll('tr')).toHaveLength(HELP_CONTROLS.length);
  });

  it('has a Between sessions section on Training', () => {
    const m = mountUI();
    const meta = must(m.root, TID.helpMeta);
    expect(meta.textContent).toContain('Between sessions');
    expect(meta.textContent).toContain('Training');
    expect(meta.textContent).toContain('👍');
  });

  it('opens on Got it, not on Replay the tour, which sits beside it', () => {
    const m = mountUI();
    (must(m.root, TID.helpButton) as HTMLButtonElement).click();
    expect(document.activeElement).toBe(must(m.root, TID.helpClose));
    expect(must(m.root, TID.tourReplay).textContent).toBe('Replay the tour');
    expect(must(m.root, TID.helpModal).contains(must(m.root, TID.tourReplay))).toBe(true);
  });

  it('closes on Got it, and on Escape', () => {
    const m = mountUI();
    (must(m.root, TID.helpButton) as HTMLButtonElement).click();
    (must(m.root, TID.helpClose) as HTMLButtonElement).click();
    expect(isHidden(must(m.root, TID.helpModal))).toBe(true);
    (must(m.root, TID.helpButton) as HTMLButtonElement).click();
    key(must(m.root, TID.helpModal), 'Escape');
    expect(isHidden(must(m.root, TID.helpModal))).toBe(true);
  });
});

describe('about', () => {
  it('opens from the title and closes again', () => {
    const m = mountUI({ screen: 'title' });
    (must(m.root, TID.aboutButton) as HTMLButtonElement).click();
    const modal = must(m.root, TID.aboutModal);
    expect(isHidden(modal)).toBe(false);
    expect(modal.textContent).toContain('Tokenmaxxing 2');
    expect(modal.querySelector(`[data-testid="${TID.prequelLink}"]`)).not.toBeNull();
    (must(m.root, TID.aboutClose) as HTMLButtonElement).click();
    expect(isHidden(modal)).toBe(true);
  });
});

describe('options', () => {
  function open() {
    const m = mountUI({
      meta: makeMeta({ settings: makeSettings() }),
      onAction: (a, mm) => {
        // Behave like a host: apply the patch the way `sim.setSettings` would.
        if (a.t === 'settings') Object.assign(mm.sim.meta.settings, a.patch);
      },
    });
    (must(m.root, TID.optionsButton) as HTMLButtonElement).click();
    return m;
  }

  it('sends a settings patch per control, and reflects what the sim holds', () => {
    const m = open();
    const motion = must(m.root, TID.reducedMotion) as HTMLButtonElement;
    expect(motion.getAttribute('aria-pressed')).toBe('false');
    motion.click();
    expect(m.sent('settings')).toEqual([{ t: 'settings', patch: { reducedMotion: true } }]);
    expect(motion.getAttribute('aria-pressed')).toBe('true');
    m.frame();
    expect(m.ui.el.getAttribute('data-reduced-motion')).toBe('1');
  });

  it('mutes both volumes and restores them', () => {
    const m = open();
    const mute = must(m.root, TID.muteToggle) as HTMLButtonElement;
    mute.click();
    expect(m.sent('settings').at(-1)).toEqual({ t: 'settings', patch: { musicVolume: 0, sfxVolume: 0 } });
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    mute.click();
    expect(m.sent('settings').at(-1)).toEqual({ t: 'settings', patch: { musicVolume: 0.6, sfxVolume: 0.8 } });
  });

  it('moves a volume slider into a patch', () => {
    const m = open();
    const music = must(m.root, 'music-volume') as HTMLInputElement;
    music.value = '25';
    music.dispatchEvent(new Event('input'));
    expect(m.sent('settings').at(-1)).toEqual({ t: 'settings', patch: { musicVolume: 0.25 } });
  });

  it('asks twice before wiping the save, then leaves the wiping to the host', () => {
    const m = open();
    const reset = must(m.root, TID.resetSave) as HTMLButtonElement;
    reset.click();
    expect(m.sent('resetSave')).toHaveLength(0);
    expect(reset.textContent).toContain('Really');
    reset.click();
    expect(m.sent('resetSave')).toHaveLength(1);
    expect(isHidden(must(m.root, TID.optionsPanel))).toBe(true);
  });
});

describe('toasts', () => {
  it('turns a denial into words: tokens for cost, 👍 for thumbs', () => {
    const m = mountUI();
    m.ui.handle({ t: 'denied', reason: 'cost' });
    m.ui.handle({ t: 'denied', reason: 'thumbs' });
    expect(DENIED_TEXT.cost).toBe('Not enough tokens');
    expect(DENIED_TEXT.thumbs).toBe('Not enough 👍');
    expect(toasts(m.root)).toEqual(['Not enough tokens', 'Not enough 👍']);
  });

  it('collapses a rapid-fire duplicate', () => {
    const m = mountUI();
    m.ui.handle({ t: 'denied', reason: 'cost' });
    m.ui.handle({ t: 'denied', reason: 'cost' });
    expect(toasts(m.root)).toHaveLength(1);
  });

  it('narrates the session: reports, claims, compactions, picks, pickups', () => {
    const m = mountUI();
    // Every line checked as it lands: the stack only keeps the last few.
    const say = (e: Parameters<typeof m.ui.handle>[0]): string => {
      m.tick(1_000);
      m.ui.handle(e);
      return toasts(m.root).at(-1) ?? '';
    };
    expect(say({ t: 'report', promptIndex: 0, thumbs: 2, patienceLeft: 0.5 })).toBe('Reported done · +2 👍');
    expect(say({ t: 'claim', promptIndex: 1, caught: true, verifyChance: 0.4, spent: 50 })).toContain(
      'The human ran the tests',
    );
    expect(say({ t: 'claim', promptIndex: 1, caught: false, verifyChance: 0.4, spent: 50 })).toContain('+1 tech debt');
    expect(say({ t: 'compactEnd', keptCards: ['please'], droppedCards: ['grandma'] })).toBe(
      `Forgot ${CARD_BY_ID['grandma']!.name}`,
    );
    expect(say({ t: 'draftPick', id: 'please' })).toBe('The human typed PLEASE');
    expect(say({ t: 'buyUpgrade', id: 'streaming', cost: 60 })).toBe(`Installed ${UPGRADE_BY_ID['streaming']!.name}`);
    expect(say({ t: 'pickupCollect', id: 'golden_token', x: 1, y: 1 })).toContain('Golden Token');
    expect(say({ t: 'toolLost', id: 'bash', owned: 3 })).toBe('rm -rf took a Bash with it');
    expect(say({ t: 'contextWarn', fill: 0.95 })).toContain('compaction imminent');
    expect(toasts(m.root).length).toBeLessThanOrEqual(4);
  });
});

describe('achievement popup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('slides in the earned achievement with its name and blurb', () => {
    const m = mountUI();
    m.ui.handle({ t: 'achievement', id: 'compacted' });
    const card = must(m.root, `${TID.achievementPopupCard}-compacted`);
    const def = ACHIEVEMENT_BY_ID['compacted']!;
    expect(card.textContent).toContain(def.name);
    expect(card.textContent).toContain(def.blurb);
    expect(card.querySelector('.tm-icon')!.getAttribute('data-icon')).toBe(def.icon);
    vi.advanceTimersByTime(20_000);
    expect(m.root.querySelector(`[data-testid="${TID.achievementPopupCard}-compacted"]`)).toBeNull();
  });
});
