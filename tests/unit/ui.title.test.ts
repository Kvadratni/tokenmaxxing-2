/**
 * The title screen, and the legacy notice for players arriving with a
 * Tokenmaxxing 1 save.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { modelVersion } from '../../src/sim/content.ts';
import { TID } from '../../src/testids.ts';
import { KOFI_URL, PREQUEL_URL, REPO_URL } from '../../src/ui/about.ts';
import { legacyLines } from '../../src/ui/legacy.ts';
import { META_PITCH, SUBTITLE, TAGLINE, TITLE } from '../../src/ui/title.ts';
import { isHidden, key, makeMeta, mountUI, must, q, text, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

describe('title screen', () => {
  it('names the game and pitches it from the agent side', () => {
    const m = mountUI({ screen: 'title' });
    const title = must(m.root, TID.titleScreen);
    expect(isHidden(title)).toBe(false);
    expect(TITLE).toBe('TOKENMAXXING 2');
    expect(SUBTITLE).toBe("YOU'RE ABSOLUTELY RIGHT");
    expect(TAGLINE).toBe(
      "You're the agent now. Every token you generate fills your context window. When it's full, you forget. The human is watching.",
    );
    for (const s of [TITLE, SUBTITLE, TAGLINE]) expect(title.textContent).toContain(s);
  });

  it('explains the meta loop: every session ends, the 👍 train the next version in Training', () => {
    const m = mountUI({ screen: 'title' });
    const pitch = must(m.root, 'title-meta-pitch');
    expect(pitch.textContent).toBe(META_PITCH);
    expect(META_PITCH).toContain('👍');
    expect(META_PITCH).toContain('Training');
    expect(META_PITCH).toContain('next version');
  });

  it('starts a session: sends `startRun` and shows the run', () => {
    const m = mountUI({ screen: 'title' });
    (must(m.root, TID.startRun) as HTMLButtonElement).click();
    expect(m.sent('startRun')).toHaveLength(1);
    expect(m.ui.screen).toBe('run');
    expect(document.activeElement).toBe(must(m.root, TID.agent));
  });

  it('goes to Training and to the achievements', () => {
    const m = mountUI({ screen: 'title' });
    (must(m.root, TID.titleMeta) as HTMLButtonElement).click();
    expect(m.ui.screen).toBe('meta');
    key(window, 'Escape');
    expect(m.ui.screen).toBe('title');
    (must(m.root, TID.achievementsButton) as HTMLButtonElement).click();
    expect(m.ui.screen).toBe('achievements');
  });

  it('links the source, the prequel and the coffee, safely', () => {
    const m = mountUI({ screen: 'title' });
    const title = must(m.root, TID.titleScreen);
    const link = (id: string): HTMLAnchorElement => title.querySelector(`[data-testid="${id}"]`) as HTMLAnchorElement;
    expect(REPO_URL).toBe('https://github.com/Kvadratni/tokenmaxxing-2');
    expect(PREQUEL_URL).toBe('https://kvadratni.github.io/tokenmaxxing/');
    expect(link(TID.repoLink).getAttribute('href')).toBe(REPO_URL);
    expect(link(TID.prequelLink).getAttribute('href')).toBe(PREQUEL_URL);
    expect(link(TID.kofiLink).getAttribute('href')).toBe(KOFI_URL);
    for (const id of [TID.repoLink, TID.prequelLink, TID.kofiLink]) {
      expect(link(id).getAttribute('target')).toBe('_blank');
      expect(link(id).getAttribute('rel')).toContain('noopener');
    }
    expect(q(title, TID.aboutButton)).not.toBeNull();
  });

  it('hides the stats on a fresh save', () => {
    const m = mountUI({ screen: 'title' });
    expect(isHidden(must(m.root, TID.titleStats))).toBe(true);
  });

  it('lists runs, wins, best prompt, 👍 and the version on a played save', () => {
    const m = mountUI({ screen: 'title', meta: makeMeta({ runs: 3, wins: 1, bestPrompt: 6, thumbs: 14 }) });
    const stats = must(m.root, TID.titleStats);
    expect(isHidden(stats)).toBe(false);
    expect(stats.textContent).toBe(`RUNS 3 · WINS 1 · BEST PROMPT 7/10 · 👍 14 · v${modelVersion(4)}`);
    expect(must(m.root, TID.titleScreen).textContent).toContain(`Tokenmaxxing ${modelVersion(4)}`);
  });

  it('keeps the CLI backdrop running behind the title, and only there', () => {
    const m = mountUI({ screen: 'title' });
    const cli = must(m.root, TID.cliBackdrop);
    expect(must(m.root, TID.titleScreen).contains(cli)).toBe(true);
    expect(cli.querySelectorAll('.tm-cli__line').length).toBeGreaterThan(0);
  });
});

describe('legacy notice', () => {
  it('reads as a returning customer on a clean save', () => {
    const l = legacyLines('clean', 5);
    expect(l.body).toBe('Found a Tokenmaxxing 1 save. You were the human last time. +5 👍');
    expect(l.legal).toBeNull();
    // An unsigned save is old, not tampered.
    expect(legacyLines('legacy', 3).legal).toBeNull();
  });

  it('adds a word from Legal on a tampered one, and gives the gift anyway', () => {
    for (const verdict of ['edited', 'forged'] as const) {
      const l = legacyLines(verdict, 7);
      expect(l.body).toContain('+7 👍');
      expect(l.legal).toContain('Legal has been notified.');
    }
    // Clean on disk, but the old save carried game 1's cheating achievements.
    expect(legacyLines('clean', 3, true).legal).toContain('Legal has been notified.');
  });

  it('shows once, on the legacyImport event', () => {
    const m = mountUI({ screen: 'title' });
    const notice = must(m.root, TID.legacyNotice);
    expect(isHidden(notice)).toBe(true);
    m.ui.handle({ t: 'legacyImport', verdict: 'clean', gift: 5, cheater: false });
    expect(isHidden(notice)).toBe(false);
    expect(notice.getAttribute('role')).toBe('dialog');
    expect(notice.textContent).toContain('You were the human last time. +5 👍');
    expect(notice.textContent).not.toContain('Legal');
    (must(m.root, TID.legacyOk) as HTMLButtonElement).click();
    expect(isHidden(notice)).toBe(true);
    m.ui.handle({ t: 'legacyImport', verdict: 'clean', gift: 5, cheater: false });
    expect(isHidden(notice)).toBe(true);
  });

  it('shows the tampered copy for a tampered save, and closes on Escape', () => {
    const m = mountUI({ screen: 'title' });
    m.ui.handle({ t: 'legacyImport', verdict: 'forged', gift: 3, cheater: true });
    const notice = must(m.root, TID.legacyNotice);
    expect(notice.textContent).toContain('Legal has been notified.');
    expect(notice.textContent).toContain('+3 👍');
    key(notice, 'Escape');
    expect(isHidden(notice)).toBe(true);
  });

  it("trusts the event's cheater flag, even on a clean checksum", () => {
    const m = mountUI({ screen: 'title' });
    m.ui.handle({ t: 'legacyImport', verdict: 'clean', gift: 7, cheater: true });
    expect(text(m.root, TID.legacyNotice)).toContain('Legal has been notified.');
  });
});
