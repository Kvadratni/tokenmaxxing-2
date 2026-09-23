/**
 * The agent: state precedence, the click bounce, and what gets drawn.
 */
import { describe, expect, it } from 'vitest';
import {
  BOUNCE_S,
  PANIC_ABOVE,
  agentBlinking,
  agentSprite,
  bounceAt,
  drawAgent,
  selectAgent,
  type AgentInputs,
} from '../../src/render/agent.ts';
import { AGENT_RECT } from '../../src/render/atlas-types.ts';
import { AGENT_ORIGIN } from '../../src/render/layout.ts';
import { SpriteSystem } from '../../src/render/sprites.ts';
import { createMockCtx } from './render.mock-ctx.ts';
import { derived, incident, input, mount, run } from './render.fixtures.ts';

function agent(over: Partial<AgentInputs> = {}): ReturnType<typeof selectAgent> {
  return selectAgent({
    fill: 0.3,
    reportState: 'working',
    incidents: [],
    phase: 'running',
    compactingMs: 0,
    now: 10,
    dazedUntil: -1,
    grovelUntil: -1,
    panicUntil: -1,
    ...over,
  });
}

describe('selectAgent', () => {
  it('idles by default', () => {
    expect(agent()).toBe('idle');
  });

  it('panics above 90% context', () => {
    expect(agent({ fill: PANIC_ABOVE })).toBe('idle');
    expect(agent({ fill: PANIC_ABOVE + 0.001 })).toBe('panic');
    expect(agent({ panicUntil: 11 })).toBe('panic');
  });

  it('sweats while a claim is possible', () => {
    expect(agent({ reportState: 'claim' })).toBe('sweating');
    expect(agent({ reportState: 'report' })).toBe('idle');
  });

  it('waits while a permission prompt stalls a tool', () => {
    expect(agent({ incidents: [incident('bash_permission')] })).toBe('waiting');
    expect(agent({ incidents: [incident('overloaded')] })).toBe('idle');
  });

  it('is dazed just after a compaction, and while one is running', () => {
    expect(agent({ dazedUntil: 11 })).toBe('dazed');
    expect(agent({ compactingMs: 1200 })).toBe('dazed');
    expect(agent({ phase: 'compacting' })).toBe('dazed');
  });

  it('grovels for a beat after "You\'re absolutely right!"', () => {
    expect(agent({ grovelUntil: 11 })).toBe('grovel');
  });

  it('ranks dazed > grovel > panic > waiting > sweating', () => {
    const everything: Partial<AgentInputs> = {
      fill: 0.97,
      reportState: 'claim',
      incidents: [incident('bash_permission')],
      dazedUntil: 11,
      grovelUntil: 11,
    };
    expect(agent(everything)).toBe('dazed');
    expect(agent({ ...everything, dazedUntil: -1 })).toBe('grovel');
    expect(agent({ ...everything, dazedUntil: -1, grovelUntil: -1 })).toBe('panic');
    expect(agent({ ...everything, dazedUntil: -1, grovelUntil: -1, fill: 0.5 })).toBe('waiting');
    expect(agent({ reportState: 'claim', fill: 0.5 })).toBe('sweating');
  });

  it('maps every state to a sprite', () => {
    for (const s of ['idle', 'panic', 'sweating', 'dazed', 'waiting', 'grovel'] as const) {
      expect(agentSprite(s)).toMatch(/^agent_/);
    }
  });
});

describe('bounce and blink', () => {
  it('squashes, stretches and settles on a click', () => {
    expect(bounceAt(0, false).squash).toBe(0);
    expect(bounceAt(0.1, false)).toEqual({ squash: 1, hop: -2 });
    expect(bounceAt(0.16, false).hop).toBe(-1);
    expect(bounceAt(BOUNCE_S, false)).toEqual({ squash: -1, hop: 0 });
    expect(bounceAt(-1, false)).toEqual({ squash: -1, hop: 0 });
  });

  it('never hops with reduced motion', () => {
    for (let t = 0; t < BOUNCE_S; t += 0.01) expect(bounceAt(t, true).hop).toBe(0);
  });

  it('blinks briefly every few seconds', () => {
    let shut = 0;
    for (let i = 0; i < 3100; i++) if (agentBlinking(i * 0.01)) shut++;
    expect(shut).toBeGreaterThan(0);
    expect(shut).toBeLessThan(310);
  });
});

describe('drawAgent', () => {
  function drawn(state: Parameters<typeof drawAgent>[2], sinceClick = 99): { key: string; calls: string[] } {
    const s = new SpriteSystem({ sheetTimeoutMs: 1 });
    const calls: string[] = [];
    const base = s.draw.bind(s);
    s.draw = (ctx, key, x, y, o) => {
      calls.push(`${key}@${x},${y}`);
      base(ctx, key, x, y, o);
    };
    const c = createMockCtx(document.createElement('canvas'));
    const key = drawAgent(c as unknown as CanvasRenderingContext2D, s, state, { timeS: 0.5, reduced: false, sinceClick });
    s.destroy();
    return { key, calls };
  }

  it('draws the idle agent at its origin, inside the hit box', () => {
    const { key, calls } = drawn('idle');
    expect(key).toBe('agent_idle');
    expect(calls[0]).toBe(`agent_idle@${AGENT_ORIGIN.x},${AGENT_ORIGIN.y}`);
    expect(AGENT_ORIGIN.x).toBeGreaterThanOrEqual(AGENT_RECT.x);
    expect(AGENT_ORIGIN.x + 36).toBeLessThanOrEqual(AGENT_RECT.x + AGENT_RECT.w);
  });

  it('bounces on a click', () => {
    expect(drawn('idle', 0.01).key).toBe('agent_squash');
    // Non-idle poses hop instead of squashing.
    expect(drawn('sweating', 0.1).calls[0]).toBe(`agent_sweat@${AGENT_ORIGIN.x},${AGENT_ORIGIN.y - 2}`);
  });

  it('holds the SUMMARY scroll while dazed', () => {
    expect(drawn('dazed').calls.some((c) => c.startsWith('scroll_summary'))).toBe(true);
  });
});

describe('the renderer drives the agent from the run', () => {
  it('reports the agent state in renderStats', async () => {
    const { r } = mount();
    await r.whenReady();
    let t = 1;
    const at = (over: Parameters<typeof input>[0]): string => {
      t += 0.5;
      r.draw(input({ time: t, ...over }));
      return r.renderStats().stage.agent;
    };
    expect(at({})).toBe('idle');
    expect(at({ derived: derived({ contextFill: 0.95 }) })).toBe('panic');
    expect(at({ derived: derived({ reportState: 'claim' }) })).toBe('sweating');
    expect(at({ run: run({ incidents: [incident('web_permission', { tool: 'web_search' })] }) })).toBe('waiting');
    expect(at({ run: run({ compactingMs: 2000 }) })).toBe('dazed');
    r.handle({ t: 'sycophancy', restored: 0.06, heat: 1 });
    expect(at({})).toBe('grovel');
    r.destroy();
  });

  it('is dazed for a few seconds after a compaction', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ time: 1 }));
    r.handle({ t: 'compactStart', forced: true, kept: 10, lost: 30 });
    r.draw(input({ time: 1.1 }));
    expect(r.renderStats().stage.agent).toBe('dazed');
    r.draw(input({ time: 6 }));
    expect(r.renderStats().stage.agent).toBe('idle');
    r.destroy();
  });
});
