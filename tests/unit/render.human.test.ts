/**
 * The human behind the glass: which face and pose, from the run and the
 * renderer's own timers. Incident behaviour is read from content.ts.
 */
import { describe, expect, it } from 'vitest';
import { INCIDENTS } from '../../src/sim/content.ts';
import {
  FURIOUS_BELOW,
  IMPATIENT_BELOW,
  drawHuman,
  humanBlinking,
  humanBreath,
  isAwayIncident,
  isHumanIncident,
  isPermissionIncident,
  isSuspicionIncident,
  selectHuman,
  type HumanInputs,
} from '../../src/render/human.ts';
import { SpriteSystem } from '../../src/render/sprites.ts';
import { createMockCtx } from './render.mock-ctx.ts';
import { derived, incident, input, mount, run } from './render.fixtures.ts';

function human(over: Partial<HumanInputs> = {}): ReturnType<typeof selectHuman> {
  return selectHuman({
    patience: 0.9,
    incidents: [],
    phase: 'running',
    now: 10,
    typingUntil: -1,
    suspiciousUntil: -1,
    leaningUntil: -1,
    ...over,
  });
}

describe('incident classification comes from content', () => {
  it('lunch and meetings take the human away; nothing else does', () => {
    expect(isAwayIncident('lunch')).toBe(true);
    expect(isAwayIncident('meeting')).toBe(true);
    for (const def of INCIDENTS) {
      const away = def.speaker === 'human' && def.effects.some((e) => e.t === 'patienceFreeze');
      expect(isAwayIncident(def.id), def.id).toBe(away);
    }
    expect(isAwayIncident('no_such_incident')).toBe(false);
  });

  it('"did you actually test this?" makes the human suspicious', () => {
    expect(isSuspicionIncident('did_you_test')).toBe(true);
    expect(isSuspicionIncident('wait_stop')).toBe(false);
  });

  it('knows who is speaking and which incidents are permission prompts', () => {
    expect(isHumanIncident('wait_stop')).toBe(true);
    expect(isHumanIncident('overloaded')).toBe(false);
    expect(isPermissionIncident('bash_permission')).toBe(true);
    expect(isPermissionIncident('mcp_auth')).toBe(true);
    expect(isPermissionIncident('wait_stop')).toBe(false);
  });
});

describe('selectHuman', () => {
  it('is tired by default', () => {
    expect(human()).toEqual({ state: 'tired', mood: 'tired', pose: 'idle' });
  });

  it('gets impatient below 40% and furious below 15%', () => {
    expect(human({ patience: IMPATIENT_BELOW + 0.01 }).mood).toBe('tired');
    expect(human({ patience: IMPATIENT_BELOW - 0.01 }).state).toBe('impatient');
    expect(human({ patience: FURIOUS_BELOW + 0.01 }).state).toBe('impatient');
    expect(human({ patience: FURIOUS_BELOW - 0.01 }).state).toBe('furious');
    expect(human({ patience: 0 }).state).toBe('furious');
  });

  it('is suspicious right after a claim, and during "did you test this?"', () => {
    expect(human({ suspiciousUntil: 12 }).state).toBe('suspicious');
    expect(human({ suspiciousUntil: 9 }).state).toBe('tired');
    expect(human({ incidents: [incident('did_you_test')] }).state).toBe('suspicious');
    // Suspicion shows through even when patience is gone.
    expect(human({ patience: 0.05, suspiciousUntil: 12 }).mood).toBe('suspicious');
  });

  it('is away, an empty chair, at lunch or in a meeting, whatever else is going on', () => {
    expect(human({ incidents: [incident('lunch')] }).state).toBe('away');
    expect(human({ incidents: [incident('meeting')], typingUntil: 99, leaningUntil: 99 }).pose).toBe('away');
  });

  it('types when a prompt arrives, while drafting, or after saying something', () => {
    expect(human({ typingUntil: 11 }).state).toBe('typing');
    expect(human({ phase: 'drafting' }).state).toBe('typing');
    // The face keeps its mood while typing.
    expect(human({ typingUntil: 11, patience: 0.1 }).mood).toBe('furious');
  });

  it('leans into the glass after catching a claim, over typing', () => {
    expect(human({ leaningUntil: 11, typingUntil: 11 }).state).toBe('leaning');
    expect(human({ leaningUntil: 9 }).state).toBe('tired');
  });

  it('survives a NaN patience', () => {
    expect(human({ patience: Number.NaN }).state).toBe('tired');
  });
});

describe('idle life', () => {
  it('blinks now and then, never most of the time', () => {
    let shut = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i++) if (humanBlinking(i * 0.01)) shut++;
    expect(shut).toBeGreaterThan(0);
    expect(shut / samples).toBeLessThan(0.15);
  });

  it('breathes in whole pixels, and holds still with reduced motion', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) seen.add(humanBreath(i * 0.02, false));
    expect([...seen].sort()).toEqual([-1, 0]);
    for (let i = 0; i < 100; i++) expect(humanBreath(i * 0.05, true)).toBe(0);
  });
});

describe('drawHuman', () => {
  function keys(view: ReturnType<typeof selectHuman>): string[] {
    const s = new SpriteSystem({ sheetTimeoutMs: 1 });
    const drawn: string[] = [];
    const draw = s.draw.bind(s);
    s.draw = (ctx, key, x, y, o) => {
      drawn.push(key);
      draw(ctx, key, x, y, o);
    };
    const c = createMockCtx(document.createElement('canvas'));
    drawHuman(c as unknown as CanvasRenderingContext2D, s, view, { timeS: 1, reduced: false, lean: view.pose === 'leaning' ? 1 : 0 });
    s.destroy();
    return drawn;
  }

  it('stacks body, eyes for the mood, and the mug', () => {
    expect(keys(human())).toEqual(['human_body', 'human_eyes_tired', 'human_mug']);
    expect(keys(human({ patience: 0.1 }))).toContain('human_eyes_furious');
  });

  it('puts the mug down to type', () => {
    expect(keys(human({ typingUntil: 11 }))).toEqual(['human_body', 'human_eyes_tired', 'human_typing']);
  });

  it('draws only the empty chair when away', () => {
    expect(keys(human({ incidents: [incident('lunch')] }))).toEqual(['human_chair']);
  });

  it('leans in at twice the size', () => {
    const s = new SpriteSystem({ sheetTimeoutMs: 1 });
    const c = createMockCtx(document.createElement('canvas'));
    drawHuman(c as unknown as CanvasRenderingContext2D, s, human({ leaningUntil: 11 }), { timeS: 1, reduced: false, lean: 1 });
    expect(c.ops('scale').some((op) => op.args[0] === 2 && op.args[1] === 2)).toBe(true);
    s.destroy();
  });
});

describe('the renderer drives the human from the run', () => {
  it('reports the human state in renderStats', async () => {
    const { r } = mount();
    await r.whenReady();
    let t = 5;
    const at = (over: Parameters<typeof input>[0]): string => {
      t += 0.5;
      r.draw(input({ time: t, ...over }));
      return r.renderStats().stage.human;
    };
    at({});
    // Let the first prompt finish typing.
    for (let i = 0; i < 6; i++) at({});
    expect(at({ derived: derived({ patienceProgress: 0.9 }) })).toBe('tired');
    expect(at({ derived: derived({ patienceProgress: 0.3 }) })).toBe('impatient');
    expect(at({ derived: derived({ patienceProgress: 0.1 }) })).toBe('furious');
    expect(at({ run: run({ incidents: [incident('lunch')] }) })).toBe('away');
    expect(at({ run: run({ phase: 'drafting' }) })).toBe('typing');
    r.destroy();
  });

  it('types when a new prompt arrives', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ time: 1, run: run({ promptIndex: 0 }) }));
    for (let i = 0; i < 5; i++) r.draw(input({ time: 2 + i, run: run({ promptIndex: 0 }) }));
    expect(r.renderStats().stage.human).toBe('tired');
    r.draw(input({ time: 8, run: run({ promptIndex: 1 }) }));
    expect(r.renderStats().stage.human).toBe('typing');
    r.destroy();
  });
});
