/**
 * Training: the permanent tree, bought with 👍.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { META_BY_ID, META_UPGRADES } from '../../src/sim/content.ts';
import type { MetaBranch } from '../../src/sim/types.ts';
import { TID, tid } from '../../src/testids.ts';
import { BRANCH_LABELS, iconIdFor, nodeState } from '../../src/ui/meta.ts';
import { isHidden, makeMeta, mountUI, must, text, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

const buy = (root: HTMLElement, id: string): HTMLButtonElement => must(root, tid(TID.metaBuy, id)) as HTMLButtonElement;

function training(meta = makeMeta()) {
  return mountUI({ screen: 'meta', meta });
}

describe('Training', () => {
  it('renders every node, each with a row and a buy button', () => {
    const m = training();
    expect(isHidden(must(m.root, TID.metaScreen))).toBe(false);
    for (const def of META_UPGRADES) {
      expect(must(m.root, tid(TID.metaRow, def.id))).toBeTruthy();
      expect(buy(m.root, def.id).querySelector('.tm-icon')!.getAttribute('data-icon')).toBe(`meta_${def.id}`);
    }
    expect(iconIdFor(META_BY_ID['helpful']!)).toBe('meta_helpful');
  });

  it('heads every branch, including the new ones', () => {
    const m = training();
    const heads = Array.from(m.root.querySelectorAll('.tm-tree__branch'), (n) => n.textContent);
    const branches = new Set<MetaBranch>(META_UPGRADES.map((d) => d.branch));
    for (const b of branches) {
      if (b === 'root') continue;
      expect(heads).toContain(BRANCH_LABELS[b]);
    }
    for (const b of ['context', 'tools', 'alignment', 'hacking', 'inference', 'prompting'] as const) {
      expect(branches.has(b), b).toBe(true);
    }
    // The capstone hangs off all six.
    expect(META_BY_ID['endless_mode']!.branch).toBe('root');
  });

  it('shows the unspent 👍', () => {
    const m = training(makeMeta({ thumbs: 12 }));
    expect(text(m.root, TID.metaThumbs)).toBe('12');
  });

  it('prices nodes with the sim, in 👍', () => {
    const m = training(makeMeta({ thumbs: 50 }));
    m.sim.setMetaCost((id) => (id === 'helpful' ? 7 : 3));
    m.ui.setScreen('title');
    m.ui.setScreen('meta');
    m.frame();
    expect(buy(m.root, 'helpful').textContent).toContain('7 👍');
  });

  it('asks to buy an affordable node and nothing else', () => {
    const m = training(makeMeta({ thumbs: 3 }));
    const helpful = buy(m.root, 'helpful');
    expect(helpful.disabled).toBe(false);
    helpful.click();
    expect(m.sent('buyMeta')).toEqual([{ t: 'buyMeta', id: 'helpful' }]);
    // Too dear: 13 👍 for Honest's parent chain, and not yet reachable anyway.
    const rlhf = buy(m.root, 'rlhf');
    expect(rlhf.disabled).toBe(true);
    rlhf.click();
    expect(m.sent('buyMeta')).toHaveLength(1);
  });

  it('works out every presentation state', () => {
    const helpfulMax = META_BY_ID['helpful']!.maxLevel;
    const meta = makeMeta({ levels: { helpful: helpfulMax, unlock_compact: 1 } });
    const cost = (id: string): number => META_BY_ID[id]!.costs[meta.levels[id] ?? 0] ?? Infinity;
    // Numbers come from content (BALANCE tunes them): one 👍 short of RLHF.
    meta.thumbs = cost('rlhf') - 1;
    expect(nodeState(META_BY_ID['helpful']!, meta, cost('helpful'))).toBe('owned');
    expect(nodeState(META_BY_ID['rlhf']!, meta, cost('rlhf'))).toBe('tooDear');
    meta.thumbs = cost('tool_use');
    expect(nodeState(META_BY_ID['tool_use']!, meta, cost('tool_use'))).toBe('available');
    expect(nodeState(META_BY_ID['harmless']!, meta, cost('harmless'))).toBe('teased');
    expect(nodeState(META_BY_ID['honest']!, meta, cost('honest'))).toBe('hidden');
    const partial = makeMeta({ thumbs: 99, levels: { context_window: 2, unlock_compact: 1 } });
    expect(nodeState(META_BY_ID['context_window']!, partial, 13)).toBe('partial');
  });

  it('hides what is past the frontier behind ???', () => {
    const m = training();
    expect(buy(m.root, 'honest').textContent).toContain('???');
    expect(buy(m.root, 'honest').classList.contains('is-hidden')).toBe(true);
    expect(buy(m.root, 'helpful').textContent).toContain('Helpful');
  });

  it('marks owned nodes and fills their pips', () => {
    const m = training(makeMeta({ levels: { helpful: 2 } }));
    const node = buy(m.root, 'helpful');
    expect(node.querySelectorAll('.tm-node__pip.is-on')).toHaveLength(2);
    expect(node.classList.contains('is-owned')).toBe(false);
    m.sim.meta.levels['helpful'] = 4;
    m.frame();
    expect(node.classList.contains('is-owned')).toBe(true);
    expect(node.textContent).toContain('MAX');
  });

  it("explains a node in the tooltip with describe(level): now, and what the next level gives", () => {
    const m = training(makeMeta({ thumbs: 20, levels: { helpful: 1 } }));
    const def = META_BY_ID['helpful']!;
    buy(m.root, 'helpful').dispatchEvent(new Event('pointerenter'));
    const tip = must(m.root, TID.metaTip);
    expect(isHidden(tip)).toBe(false);
    expect(tip.textContent).toContain(def.name);
    expect(tip.textContent).toContain(def.blurb);
    expect(tip.textContent).toContain(`Now: ${def.describe(1)}`);
    expect(tip.textContent).toContain(`Next: ${def.describe(2)}`);
    buy(m.root, 'helpful').dispatchEvent(new Event('pointerleave'));
    expect(isHidden(tip)).toBe(true);
  });

  it('keeps a locked node secret in its tooltip too', () => {
    const m = training();
    buy(m.root, 'honest').dispatchEvent(new Event('pointerenter'));
    const tip = must(m.root, TID.metaTip);
    expect(tip.textContent).toContain('Locked');
    expect(tip.textContent).not.toContain(META_BY_ID['honest']!.blurb);
  });

  it('starts a new session from Training, or goes back to the title', () => {
    const m = training();
    (must(m.root, TID.metaBack) as HTMLButtonElement).click();
    expect(m.ui.screen).toBe('title');
    m.ui.setScreen('meta');
    (must(m.root, TID.metaStart) as HTMLButtonElement).click();
    expect(m.sent('startRun')).toHaveLength(1);
    expect(m.ui.screen).toBe('run');
  });
});
