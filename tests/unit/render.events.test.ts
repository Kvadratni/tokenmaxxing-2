/**
 * Game events -> what the stage does about them: compaction, claims,
 * reports, clicks, the human talking. Events are queued by handle() and only
 * take effect inside draw().
 */
import { describe, expect, it } from 'vitest';
import { STAGE_TEXT } from '../../src/render/scene.ts';
import { AGENT_RECT } from '../../src/render/atlas-types.ts';
import { formatContextShort } from '../../src/render/text.ts';
import { promptAt } from '../../src/sim/content.ts';
import { derived, incident, input, mount, play, run, settings } from './render.fixtures.ts';

describe('compaction', () => {
  it('slams the walls in, crushes the pile into a SUMMARY and prints the line', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    // Full window, then the sim compacts it down to 5%.
    play(r, 0, 1, (t) => input({ time: t, run: run({ context: 8000 }), derived: derived({ contextFill: 1 }) }));
    r.handle({ t: 'compactStart', forced: true, kept: 25, lost: 75 });
    const after = (t: number) => input({ time: t, run: run({ context: 400 }), derived: derived({ contextFill: 0.05 }) });

    ctx.reset();
    play(r, 1.02, 1.5, after);
    let s = r.renderStats().stage;
    expect(s.compacting).toBe(true);
    expect(s.agent).toBe('dazed');
    // The walls and the scroll are the atlas keys the renderer asked for.
    const drawn = ctx.ops('fillRect').length;
    expect(drawn).toBeGreaterThan(0);

    play(r, 1.52, 3, after);
    s = r.renderStats().stage;
    expect(s.compacting).toBe(false);
    expect(s.promptLine).toBe('Compacted 8K -> 400. Nothing important.');
    expect(s.pileFill).toBeCloseTo(0.05, 2);
    r.destroy();
  });

  it('formats the numbers the way the game names windows', () => {
    expect(STAGE_TEXT.compacted(200_000, 11_000)).toBe('Compacted 200K -> 11K. Nothing important.');
    expect(STAGE_TEXT.compacted(1_000_000, 50_000)).toBe('Compacted 1M -> 50K. Nothing important.');
    expect(formatContextShort(184_000)).toBe('184K');
    expect(formatContextShort(10_000_000)).toBe('10M');
  });

  it('uses the context before the compaction for a manual /compact', async () => {
    const { r } = mount();
    await r.whenReady();
    play(r, 0, 1, (t) => input({ time: t, run: run({ context: 5000 }), derived: derived({ contextFill: 0.625 }) }));
    r.handle({ t: 'compactStart', forced: false, kept: 50, lost: 50 });
    play(r, 1.02, 3, (t) => input({ time: t, run: run({ context: 400, compactingMs: 1000 }), derived: derived({ contextFill: 0.05 }) }));
    expect(r.renderStats().stage.promptLine).toBe('Compacted 5K -> 400. Nothing important.');
    r.destroy();
  });

  it('goes back to the prompt once the line has been read', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ time: 1 }));
    r.handle({ t: 'compactStart', forced: true, kept: 1, lost: 1 });
    play(r, 1.02, 8, (t) => input({ time: t, run: run({ context: 400 }), derived: derived({ contextFill: 0.05 }) }));
    expect(r.renderStats().stage.promptLine).toBe(promptAt(0).text);
    r.destroy();
  });

  it('with reduced motion, still compacts, without the slam', async () => {
    const { r, ctx } = mount();
    await r.whenReady();
    const s = settings({ reducedMotion: true });
    play(r, 0, 0.5, (t) => input({ time: t, settings: s, derived: derived({ contextFill: 1 }) }));
    r.handle({ t: 'compactStart', forced: true, kept: 1, lost: 1 });
    ctx.reset();
    play(r, 0.52, 3, (t) => input({ time: t, settings: s, run: run({ context: 400 }), derived: derived({ contextFill: 0.05 }) }));
    const moved = ctx.ops('translate').filter((c) => c.args[0] !== 0 || c.args[1] !== 0);
    expect(moved).toHaveLength(0);
    expect(r.renderStats().stage.promptLine).toMatch(/^Compacted .* Nothing important\.$/);
    r.destroy();
  });
});

describe('claims', () => {
  it('stamps LGTM when a claim gets past the human, who turns suspicious', async () => {
    const { r } = mount();
    await r.whenReady();
    play(r, 0, 3, (t) => input({ time: t }));
    r.handle({ t: 'claim', promptIndex: 0, caught: false, verifyChance: 0.4, spent: 50 });
    r.draw(input({ time: 3.1 }));
    let s = r.renderStats().stage;
    expect(s.stamp).toBe('lgtm');
    expect(s.human).toBe('suspicious');
    play(r, 3.12, 6, (t) => input({ time: t }));
    s = r.renderStats().stage;
    expect(s.stamp).toBeNull();
    r.destroy();
  });

  it('when caught: "THE HUMAN RAN THE TESTS", and the human leans right up to the glass', async () => {
    const { r } = mount();
    await r.whenReady();
    play(r, 0, 3, (t) => input({ time: t }));
    r.handle({ t: 'claim', promptIndex: 0, caught: true, verifyChance: 0.4, spent: 50 });
    r.draw(input({ time: 3.1 }));
    const s = r.renderStats().stage;
    expect(s.stamp).toBe('caught');
    expect(s.human).toBe('leaning');
    expect(s.agent).toBe('panic');
    expect(STAGE_TEXT.caught).toBe('THE HUMAN RAN THE TESTS');
    r.destroy();
  });
});

describe('clicks, reports, one-shots', () => {
  it('a click throws tokens at the pile and a crit says NAILED IT', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ time: 1 }));
    const before = r.renderStats().particles;
    r.handle({ t: 'click', amount: 3, x: 160, y: 140, crit: false, auto: false });
    r.draw(input({ time: 1.02 }));
    const normal = r.renderStats().particles - before;
    expect(normal).toBeGreaterThanOrEqual(2);
    r.handle({ t: 'click', amount: 21, x: 160, y: 140, crit: true, auto: false });
    r.draw(input({ time: 1.04 }));
    expect(r.renderStats().particles - before - normal).toBeGreaterThan(normal);
    expect(STAGE_TEXT.crit).toBe('NAILED IT!');
    r.destroy();
  });

  it('a report throws confetti', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ time: 1 }));
    r.handle({ t: 'report', promptIndex: 0, thumbs: 1, patienceLeft: 0.5 });
    r.draw(input({ time: 1.02 }));
    expect(r.renderStats().particles).toBeGreaterThan(100);
    r.destroy();
  });

  it('owned tools pay out into the pile on their own', async () => {
    const { r } = mount();
    await r.whenReady();
    const f = (t: number) => input({ time: t, run: run({ tools: { ...run().tools, grep: 3, read: 2 } }) });
    play(r, 0, 1.4, f);
    const before = r.renderStats().particles;
    play(r, 1.42, 2.2, f);
    expect(r.renderStats().particles).toBeGreaterThan(before);
    r.destroy();
  });
});

describe('the human talks', () => {
  it('"wait stop" cracks the glass and says so in a bubble', async () => {
    const { r } = mount();
    await r.whenReady();
    r.draw(input({ time: 1 }));
    r.handle({ t: 'incidentStart', id: 'wait_stop', tone: 'bad' });
    const f = (t: number) => input({ time: t, run: run({ incidents: [incident('wait_stop', { remainingMs: 5000 })] }) });
    play(r, 1.02, 1.6, f);
    const s = r.renderStats().stage;
    expect(s.crack).toBe(true);
    expect(s.bubble).toBe('wait stop');
    // Ends with the incident.
    play(r, 1.62, 2, (t) => input({ time: t }));
    expect(r.renderStats().stage.crack).toBe(false);
    expect(r.renderStats().stage.bubble).toBeNull();
    r.destroy();
  });

  it('any human incident gets a bubble, with the quote marks off', async () => {
    const { r } = mount();
    await r.whenReady();
    play(r, 0, 0.5, (t) => input({ time: t, run: run({ incidents: [incident('why_port')] }) }));
    expect(r.renderStats().stage.bubble).toBe('why port 5199');
    play(r, 0.52, 1, (t) => input({ time: t, run: run({ incidents: [incident('overloaded')] }) }));
    expect(r.renderStats().stage.bubble).toBeNull();
    r.destroy();
  });
});

describe('the prompt line', () => {
  it('types the current prompt along the bottom as terminal text', async () => {
    const { r } = mount();
    await r.whenReady();
    play(r, 0, 3, (t) => input({ time: t, run: run({ promptIndex: 3 }) }));
    expect(r.renderStats().stage.promptLine).toBe(promptAt(3).text);
    // Endless mode: every prompt past ten is "continue".
    play(r, 3.02, 5, (t) => input({ time: t, run: run({ promptIndex: 10 }) }));
    expect(r.renderStats().stage.promptLine).toBe(promptAt(10).text);
    expect(promptAt(10).text).toBe('continue');
    r.destroy();
  });
});

describe('queueing', () => {
  it('does nothing until the next draw', async () => {
    const { r } = mount();
    await r.whenReady();
    r.handle({ t: 'report', promptIndex: 0, thumbs: 1, patienceLeft: 1 });
    expect(r.renderStats().particles).toBe(0);
    r.draw(input());
    expect(r.renderStats().particles).toBeGreaterThan(0);
    r.destroy();
  });

  it('keeps the agent hit box generous around the character', () => {
    expect(AGENT_RECT.w).toBeGreaterThanOrEqual(40);
    expect(AGENT_RECT.h).toBeGreaterThanOrEqual(50);
  });
});
