/**
 * Every card's blurb is a joke and every card has a real effect, so the draft
 * prints both. Every effect in the content must have words.
 */
import { describe, expect, it } from 'vitest';
import { CARDS, INCIDENTS, UPGRADES } from '../../src/sim/content.ts';
import { effectsLine, effectText, instantText } from '../../src/ui/effect-text.ts';

describe('effect text', () => {
  it('has words for every effect a card or an upgrade carries', () => {
    for (const def of [...CARDS, ...UPGRADES]) {
      for (const e of def.effects) expect(effectText(e), `${def.id}: ${e.t}`).not.toBeNull();
      expect(effectsLine(def.effects), def.id).not.toBe('');
    }
    for (const c of CARDS) for (const a of c.onPick ?? []) expect(instantText(a), c.id).not.toBeNull();
    for (const i of INCIDENTS) for (const a of i.onStart ?? []) expect(instantText(a), i.id).not.toBeNull();
  });

  it('reads off the definition', () => {
    expect(effectText({ t: 'clickMult', v: 3 })).toBe('Clicks ×3');
    expect(effectText({ t: 'patienceMult', v: 1.12 })).toBe('Patience ×1.12');
    expect(effectText({ t: 'footprintMult', v: 0.85 })).toBe('Tool footprint ×0.85');
    expect(effectText({ t: 'verifyChance', v: -0.08 })).toBe('Verify chance −8%');
    expect(effectText({ t: 'toolMult', id: 'subagent', v: 2.5 })).toBe('Subagent ×2.5');
    expect(effectText({ t: 'summarySlots', v: 1 })).toBe('+1 summary slot');
    expect(instantText({ t: 'context', ofMax: 0.3 })).toBe('+30% context now');
    expect(
      effectsLine([
        { t: 'clickMult', v: 3 },
        { t: 'clickContextMult', v: 2 },
      ]),
    ).toBe('Clicks ×3 · Click context ×2');
  });
});
