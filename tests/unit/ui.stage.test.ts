/**
 * The stage: the canvas, the agent's hit target, the incident banner (the
 * human's chat lines against the world's system banners) and the caption.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { INCIDENT_BY_ID, promptAt } from '../../src/sim/content.ts';
import { TID } from '../../src/testids.ts';
import { DEFAULT_AGENT_RECT, incidentVoice } from '../../src/ui/stage.ts';
import { all, isHidden, key, makeIncident, makeRun, mountUI, must, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

describe('the agent', () => {
  it('lays the agent-hit button over the scene-space hit box', () => {
    const m = mountUI();
    const hit = must(m.root, TID.agent);
    expect(hit.style.getPropertyValue('--ax')).toBe(String(DEFAULT_AGENT_RECT.x));
    expect(hit.style.getPropertyValue('--aw')).toBe(String(DEFAULT_AGENT_RECT.w));
    m.ui.setAgentRect({ x: 150, y: 96, w: 20, h: 53 });
    expect(hit.style.getPropertyValue('--ax')).toBe('150');
    expect(hit.style.getPropertyValue('--ay')).toBe('96');
    expect(hit.style.getPropertyValue('--ah')).toBe('53');
  });

  it('reports a pointer-down on the agent in client coordinates', () => {
    const m = mountUI();
    const hit = must(m.root, TID.agent);
    hit.dispatchEvent(new PointerEvent('pointerdown', { clientX: 12, clientY: 34, bubbles: true, cancelable: true }));
    expect(m.sent('canvasPointer')).toEqual([{ t: 'canvasPointer', clientX: 12, clientY: 34 }]);
  });

  it('reports a pointer-down anywhere on the stage, because pickups drift anywhere', () => {
    const m = mountUI();
    const surface = must(m.root, TID.scene).parentElement!.querySelector('.tm-stage__surface')!;
    surface.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 6, bubbles: true, cancelable: true }));
    expect(m.sent('canvasPointer')).toHaveLength(1);
  });

  it('generates with Enter while the agent has focus', () => {
    const m = mountUI();
    const hit = must(m.root, TID.agent);
    hit.focus();
    key(hit, 'Enter');
    expect(m.sent('canvasKey')).toHaveLength(1);
    // A held key does not autoclick.
    key(hit, 'Enter', { repeat: true });
    expect(m.sent('canvasKey')).toHaveLength(1);
  });

  it('owns a 320x180 canvas for the renderer', () => {
    const m = mountUI();
    expect(m.ui.canvas.width).toBe(320);
    expect(m.ui.canvas.height).toBe(180);
    expect(m.ui.canvas.getAttribute('data-testid')).toBe(TID.scene);
  });
});

describe('incident banner', () => {
  it('is hidden with no incidents', () => {
    const m = mountUI();
    expect(isHidden(must(m.root, TID.incidentBanner))).toBe(true);
  });

  it('classifies what the human said, what the human did, and what the world did', () => {
    expect(incidentVoice('wait_stop')).toBe('chat');
    expect(incidentVoice('lunch')).toBe('human');
    expect(incidentVoice('github_down')).toBe('world');
    expect(incidentVoice('pk_docs')).toBe('world');
  });

  it("renders a human incident as the human's chat line", () => {
    const m = mountUI({ run: makeRun({ incidents: [makeIncident('wait_stop', { remainingMs: 4_200 })] }) });
    const banner = must(m.root, TID.incidentBanner);
    expect(isHidden(banner)).toBe(false);
    const row = banner.querySelector<HTMLElement>('[data-incident="wait_stop"]')!;
    expect(row.classList.contains('tm-incident--chat')).toBe(true);
    expect(row.textContent).toContain('> wait stop');
    expect(row.querySelector(`[data-testid="${TID.incidentName}"]`)!.textContent).toBe('wait stop');
    expect(row.querySelector(`[data-testid="${TID.incidentTimer}"]`)!.textContent).toBe('4.2s');
    expect(row.textContent).toContain(INCIDENT_BY_ID['wait_stop']!.flavor);
  });

  it('renders a world incident as a system banner', () => {
    const m = mountUI({ run: makeRun({ incidents: [makeIncident('github_down')] }) });
    const row = must(m.root, TID.incidentBanner).querySelector<HTMLElement>('[data-incident="github_down"]')!;
    expect(row.classList.contains('tm-incident--world')).toBe(true);
    expect(row.classList.contains('tm-incident--bad')).toBe(true);
    expect(row.textContent).toContain('INCIDENT');
    expect(row.textContent).toContain('GitHub Is Down');
    expect(row.textContent).not.toContain('>');
  });

  it('counts down the clicks a click-cleared incident still needs', () => {
    const m = mountUI({
      run: makeRun({ incidents: [makeIncident('continue', { clicksRemaining: 9, remainingMs: 14_000 })] }),
    });
    const row = must(m.root, TID.incidentBanner).querySelector<HTMLElement>('[data-incident="continue"]')!;
    const clicks = row.querySelector<HTMLElement>('.tm-incident__clicks')!;
    expect(isHidden(clicks)).toBe(false);
    expect(clicks.textContent).toBe('click ×9');
    m.sim.run.incidents[0]!.clicksRemaining = 0;
    m.frame();
    expect(isHidden(clicks)).toBe(true);
    expect(clicks.textContent).toBe('');
  });

  it('stacks several at once, keyed so rows are reused', () => {
    const m = mountUI({ run: makeRun({ incidents: [makeIncident('lunch'), makeIncident('overloaded')] }) });
    expect(all(m.root, TID.incidentName)).toHaveLength(2);
    const first = must(m.root, TID.incidentBanner).firstElementChild;
    m.frame();
    expect(must(m.root, TID.incidentBanner).firstElementChild).toBe(first);
  });
});

describe('caption', () => {
  const caption = (root: HTMLElement): string =>
    root.querySelector('.tm-stage__caption')?.textContent ?? '';

  it("shows the human's prompt, typed at a terminal", () => {
    const m = mountUI({ run: makeRun({ promptIndex: 3 }) });
    expect(caption(m.root)).toBe(`> ${promptAt(3).text}`);
  });

  it('says what a compaction forgot, then goes back to the prompt', () => {
    const m = mountUI({ run: makeRun({ context: 7_800 }) });
    m.frame();
    m.ui.handle({ t: 'compactStart', forced: true, kept: 20, lost: 60 });
    m.sim.run.context = 400;
    m.frame();
    expect(caption(m.root)).toBe('Compacted 7.8K → 400. Nothing important.');
    m.tick(10_000);
    m.frame();
    expect(caption(m.root)).toBe(`> ${promptAt(0).text}`);
  });

  it('waits for the summary picker before announcing the compaction', () => {
    const m = mountUI({ run: makeRun({ context: 8_000 }) });
    m.ui.handle({ t: 'compactStart', forced: true, kept: 20, lost: 60 });
    m.sim.run.phase = 'compacting';
    m.sim.run.summary = { offered: ['please', 'grandma'], slots: 1, forced: true };
    m.frame();
    expect(caption(m.root)).toContain('compacting');
    m.sim.run.phase = 'running';
    m.sim.run.summary = null;
    m.sim.run.context = 400;
    m.frame();
    expect(caption(m.root)).toBe('Compacted 8K → 400. Nothing important.');
  });
});
