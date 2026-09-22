/**
 * The `?` help overlay and the first-run coach marks.
 *
 * Both modules are mounted standalone (no `createUI`) so the tutorial is proven
 * against the DOM contract alone: a host element, `src/sim/types.ts` state and
 * the shared `data-testid` values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TIERS, PROJECT_NAMES } from '../../src/sim/content.ts';
import { SLOP_UNITS } from '../../src/sim/format.ts';
import type { DerivedStats, RunState } from '../../src/sim/types.ts';
import { TID } from '../../src/testids.ts';
import { COACH_TID, COACH_TIP_MS, COACH_TIPS, createCoach, type Coach } from '../../src/ui/coach.ts';
import { createHelp, HELP_CONTROLS, HELP_TID, type Help } from '../../src/ui/help.ts';
import { isHidden, key, makeDerived, makeIncident, makeRun, must, q } from './ui.fake-sim.ts';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let host: HTMLElement | null = null;
let help: Help | null = null;
let coach: Coach | null = null;

function mountHost(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'tm-ui';
  document.body.appendChild(root);
  host = root;
  return root;
}

afterEach(() => {
  help?.destroy();
  help = null;
  coach?.destroy();
  coach = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

// ---------------------------------------------------------------------------
// help overlay
// ---------------------------------------------------------------------------

describe('help overlay', () => {
  function mountHelp(onDismiss?: () => void): { root: HTMLElement; h: Help } {
    const root = mountHost();
    const h = createHelp(root, onDismiss ? { onDismiss } : {});
    help = h;
    return { root, h };
  }

  it('mounts closed and hidden', () => {
    const { root, h } = mountHelp();
    expect(h.isOpen).toBe(false);
    expect(isHidden(q(root, HELP_TID.modal))).toBe(true);
  });

  it('opens and closes, and toggles between the two', () => {
    const { root, h } = mountHelp();
    h.open();
    expect(h.isOpen).toBe(true);
    expect(isHidden(must(root, HELP_TID.modal))).toBe(false);

    h.close();
    expect(h.isOpen).toBe(false);
    expect(isHidden(must(root, HELP_TID.modal))).toBe(true);

    h.toggle();
    expect(h.isOpen).toBe(true);
    h.toggle();
    expect(h.isOpen).toBe(false);
  });

  it('is a labelled modal dialog', () => {
    const { root } = mountHelp();
    const modal = must(root, HELP_TID.modal);
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-label')).toBeTruthy();
  });

  it('closes on Escape and reports the dismissal once', () => {
    const onDismiss = vi.fn();
    const { root, h } = mountHelp(onDismiss);
    h.open();

    const ev = key(must(root, HELP_TID.modal), 'Escape');
    expect(h.isOpen).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // The key stops at the modal: the game must not also react to it.
    expect(ev.defaultPrevented).toBe(true);
  });

  it('closes on the Got it button', () => {
    const onDismiss = vi.fn();
    const { root, h } = mountHelp(onDismiss);
    h.open();
    must(root, HELP_TID.close).click();
    expect(h.isOpen).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not report a dismissal for a programmatic close', () => {
    const onDismiss = vi.fn();
    const { h } = mountHelp(onDismiss);
    h.open();
    h.close();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('moves focus into the panel on open and restores it on close', () => {
    const root = mountHost();
    const opener = document.createElement('button');
    root.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const h = createHelp(root, {});
    help = h;
    h.open();
    const panel = must(root, HELP_TID.modal).querySelector('.tm-modal__panel');
    expect(panel).not.toBeNull();
    expect(panel?.contains(document.activeElement)).toBe(true);

    h.close();
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab inside the panel', () => {
    const { root, h } = mountHelp();
    h.open();
    const modal = must(root, HELP_TID.modal);
    const close = must(root, HELP_TID.close);

    // Only one focusable in the panel, so Tab in either direction lands on it.
    close.focus();
    const fwd = key(modal, 'Tab');
    expect(fwd.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    const back = key(modal, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('states the one rule in its own block', () => {
    const { root } = mountHelp();
    const rule = root.querySelector('.tm-help__rule-line');
    expect(rule?.textContent).toBe('Your wallet is the ship bar.');
  });

  it('renders the loop, ending on the death-and-respend beat', () => {
    const { root } = mountHelp();
    const steps = must(root, HELP_TID.loop).querySelectorAll('ol > li');
    expect(steps.length).toBe(5);
    // The last step is the one players miss: dying is not the end of the game.
    expect(steps[steps.length - 1]?.textContent ?? '').toMatch(/Demos/);
  });

  it('explains the meta loop, because players miss it entirely', () => {
    const { root } = mountHelp();
    const meta = must(root, HELP_TID.meta);
    const text = meta.textContent ?? '';
    expect(meta.querySelectorAll('ul > li').length).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/permanent/i);
    // It has to say what does *not* carry over, or "permanent" means nothing.
    expect(text).toMatch(/nothing else carries over/i);
  });

  it('reads the project count out of content rather than hard-coding it', () => {
    const { root } = mountHelp();
    const text = must(root, HELP_TID.loop).textContent ?? '';
    expect(text).toContain(String(PROJECT_NAMES.length));
    expect(text).toContain(PROJECT_NAMES[0] ?? '');
  });

  it('explains slop vs slops and lists the whole unit ladder', () => {
    const { root } = mountHelp();
    const units = must(root, HELP_TID.units);
    const text = units.textContent ?? '';
    expect(text).toContain('TSLOP');
    expect(text).toContain('GSLOPS');

    const items = units.querySelectorAll('.tm-help__ladder li');
    const symbols = Array.from(items).map((li) => li.querySelector('b')?.textContent ?? '');
    for (const s of ['k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q']) {
      expect(symbols, `ladder is missing ${s}`).toContain(s);
    }
    // Everything the formatter knows about, minus the bare unit.
    expect(items.length).toBe(SLOP_UNITS.filter((u) => u !== '').length);
  });

  it('renders every controls row with its keys and its description', () => {
    const { root } = mountHelp();
    const table = must(root, HELP_TID.controls);
    const rows = table.querySelectorAll('tbody > tr');
    expect(rows.length).toBe(HELP_CONTROLS.length);

    for (const row of HELP_CONTROLS) {
      const tr = must(root, `${HELP_TID.controlRow}-${row.id}`);
      const kbds = Array.from(tr.querySelectorAll('kbd')).map((k) => k.textContent);
      expect(kbds, row.id).toEqual([...row.keys]);
      expect(tr.querySelector('th')?.getAttribute('scope')).toBe('row');
      expect(tr.querySelector('td')?.textContent).toBe(row.what);
    }
  });

  it('documents the deliberate absence of a Q hotkey', () => {
    const { root } = mountHelp();
    const keys = Array.from(
      must(root, HELP_TID.controls).querySelectorAll('kbd'),
    ).map((k) => (k.textContent ?? '').toLowerCase());
    expect(keys).not.toContain('q');
    expect(must(root, HELP_TID.controls).textContent ?? '').toContain('no Q hotkey');
  });

  it('says incidents never pause the clock and that outages block shipping', () => {
    const { root } = mountHelp();
    const text = must(root, HELP_TID.incidents).textContent ?? '';
    expect(text).toContain('never pause the deadline');
    expect(text.toLowerCase()).toContain('blocked');
    expect(text).toContain('Hotfix');
  });

  it('removes itself from the DOM on destroy', () => {
    const { root, h } = mountHelp();
    h.open();
    h.destroy();
    help = null;
    expect(q(root, HELP_TID.modal)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coach marks
// ---------------------------------------------------------------------------

describe('coach marks', () => {
  interface Setup {
    root: HTMLElement;
    c: Coach;
    seen: string[];
    setEnabled(v: boolean): void;
  }

  /** A stand-in for the bits of the HUD the coach anchors against. */
  function stubAnchors(root: HTMLElement): void {
    for (const id of [
      TID.laptop,
      TID.slop,
      TID.slopRate,
      TID.shipBar,
      TID.shipButton,
      TID.deadlineBar,
      TID.deadlineText,
      TID.shop,
      TID.agentList,
    ]) {
      const node = document.createElement('div');
      node.setAttribute('data-testid', id);
      root.appendChild(node);
    }
  }

  function mountCoach(enabled = true): Setup {
    const root = mountHost();
    stubAnchors(root);
    const seen: string[] = [];
    let on = enabled;
    const c = createCoach(root, {
      enabled: () => on,
      onSeen: (id) => seen.push(id),
      seen: () => new Set(seen),
    });
    coach = c;
    return { root, c, seen, setEnabled: (v) => (on = v) };
  }

  function tips(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(`[data-testid^="${COACH_TID.tip}-"]`));
  }

  function tipIds(root: HTMLElement): string[] {
    return tips(root).map((n) => (n.getAttribute('data-testid') ?? '').slice(COACH_TID.tip.length + 1));
  }

  function frame(c: Coach, over: Partial<RunState> = {}, d: Partial<DerivedStats> = {}): RunState {
    const run = makeRun(over);
    c.update(run, makeDerived(run, d));
    return run;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('renders nothing at all while enabled() is false', () => {
    const { root, c, seen, setEnabled } = mountCoach(false);
    for (let i = 0; i < 5; i++) frame(c, { slop: 1e9, incidents: [makeIncident('github_down')] });
    expect(tips(root)).toEqual([]);
    expect(seen).toEqual([]);
    expect(isHidden(q(root, COACH_TID.layer))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // ...and wakes up the moment the host flips the flag.
    setEnabled(true);
    frame(c);
    expect(tipIds(root)).toEqual(['click']);
  });

  it('has an aria-live layer so a bubble is announced', () => {
    const { root } = mountCoach();
    const layer = must(root, COACH_TID.layer);
    expect(layer.getAttribute('aria-live')).toBe('polite');
  });

  it('fires the run-start tip first', () => {
    const { root, c } = mountCoach();
    frame(c);
    expect(tipIds(root)).toEqual(['click']);
    expect(must(root, `${COACH_TID.tip}-click`).textContent).toContain('Click the laptop');
  });

  it('shows at most one bubble at a time', () => {
    const { root, c } = mountCoach();
    // Every predicate below is true at once; only the top one may appear.
    frame(
      c,
      { slop: 1e9, agents: { ...makeRun().agents, tab_autocomplete: 3 }, incidents: [makeIncident('x')] },
      { canShip: true },
    );
    expect(tips(root).length).toBe(1);
  });

  it('fires the affordability tip once the wallet covers the first agent', () => {
    const { root, c } = mountCoach();
    const cost = AGENT_TIERS[0]?.baseCost ?? 0;

    frame(c); // 'click'
    vi.advanceTimersByTime(COACH_TIP_MS);
    frame(c, { slop: cost - 1 });
    expect(tips(root)).toEqual([]);

    frame(c, { slop: cost });
    expect(tipIds(root)).toEqual(['afford']);
  });

  it('fires the ownership tip once an agent exists', () => {
    const { root, c } = mountCoach();
    const agents = { ...makeRun().agents, tab_autocomplete: 1 };
    // Keep the wallet empty so the affordability tip does not win the frame.
    frame(c); // 'click'
    vi.advanceTimersByTime(COACH_TIP_MS);
    frame(c, { agents });
    expect(tipIds(root)).toEqual(['owned']);
  });

  it('fires the ship tip on derived.canShip', () => {
    const { root, c } = mountCoach();
    frame(c);
    vi.advanceTimersByTime(COACH_TIP_MS);
    // canShip is forced, wallet left at zero, so 'afford' cannot pre-empt it.
    frame(c, {}, { canShip: true });
    expect(tipIds(root)).toEqual(['ship']);
  });

  it('fires the incident tip on the first incident', () => {
    const { root, c } = mountCoach();
    frame(c);
    vi.advanceTimersByTime(COACH_TIP_MS);
    frame(c, { incidents: [makeIncident('github_down')] });
    expect(tipIds(root)).toEqual(['incident']);
    expect(must(root, `${COACH_TID.tip}-incident`).textContent).toContain('never pause the clock');
  });

  it('fires the low-time tip under 20s when shipping is out of reach', () => {
    const { root, c } = mountCoach();
    frame(c);
    vi.advanceTimersByTime(COACH_TIP_MS);

    frame(c, { timeLeftMs: 25_000 });
    expect(tips(root)).toEqual([]);

    frame(c, { timeLeftMs: 19_000 });
    expect(tipIds(root)).toEqual(['lowtime']);
  });

  it('does not fire the low-time tip when the player can still ship', () => {
    const { root, c } = mountCoach();
    frame(c);
    vi.advanceTimersByTime(COACH_TIP_MS);
    // canShip wins the frame; the panic tip must never appear afterwards.
    frame(c, { timeLeftMs: 5_000 }, { canShip: true });
    expect(tipIds(root)).toEqual(['ship']);
    vi.advanceTimersByTime(COACH_TIP_MS);
    frame(c, { timeLeftMs: 5_000 }, { canShip: true });
    expect(tips(root)).toEqual([]);
  });

  it('shows each tip at most once, ever', () => {
    const { root, c, seen } = mountCoach();
    for (let i = 0; i < 4; i++) {
      frame(c);
      vi.advanceTimersByTime(COACH_TIP_MS);
    }
    expect(seen).toEqual(['click']);
    expect(tips(root)).toEqual([]);
  });

  it('never re-offers a tip the host has already persisted', () => {
    const root = mountHost();
    stubAnchors(root);
    const c = createCoach(root, {
      enabled: () => true,
      seen: () => new Set(['click']),
    });
    coach = c;
    frame(c);
    // 'click' is retired, so the next satisfiable tip takes the frame instead.
    expect(tipIds(root)).toEqual([]);
    frame(c, { incidents: [makeIncident('github_down')] });
    expect(tipIds(root)).toEqual(['incident']);
  });

  it('self-dismisses after the timeout', () => {
    const { root, c } = mountCoach();
    frame(c);
    expect(tips(root).length).toBe(1);
    vi.advanceTimersByTime(COACH_TIP_MS - 1);
    expect(tips(root).length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(tips(root)).toEqual([]);
    expect(isHidden(q(root, COACH_TID.layer))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dismisses on click and on the close button, and clears the timer', () => {
    const { root, c } = mountCoach();
    frame(c);
    must(root, `${COACH_TID.tip}-click`).click();
    expect(tips(root)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    frame(c, { incidents: [makeIncident('github_down')] });
    const x = must(root, `${COACH_TID.dismiss}-incident`);
    expect(x.tagName.toLowerCase()).toBe('button');
    expect(x.getAttribute('aria-label')).toBeTruthy();
    x.click();
    expect(tips(root)).toEqual([]);
  });

  it('degrades to the corner when no anchor is on the page', () => {
    const root = mountHost(); // no stubbed HUD at all
    const c = createCoach(root, { enabled: () => true });
    coach = c;
    frame(c);
    const bubble = must(root, `${COACH_TID.tip}-click`);
    expect(bubble.classList.contains('is-corner')).toBe(true);
  });

  it('dismissAll() clears the screen and retires every remaining tip', () => {
    const { root, c, seen } = mountCoach();
    frame(c);
    expect(tips(root).length).toBe(1);

    c.dismissAll();
    expect(tips(root)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(new Set(seen)).toEqual(new Set(COACH_TIPS.map((t) => t.id)));

    // Nothing comes back, whatever the state does next.
    frame(c, { incidents: [makeIncident('github_down')] }, { canShip: true });
    expect(tips(root)).toEqual([]);
  });

  it('destroy() detaches the layer and leaves no timers behind', () => {
    const { root, c } = mountCoach();
    frame(c);
    expect(vi.getTimerCount()).toBe(1);

    c.destroy();
    coach = null;
    expect(q(root, COACH_TID.layer)).toBeNull();
    expect(tips(root)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    // Post-mortem updates are inert rather than fatal.
    expect(() => frame(c)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
  });
});
