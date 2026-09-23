/**
 * The shop rail: tool rows with their footprint, locked teasers, the upgrade
 * list, and the ×1/×10/×100 toggle. The rail only ever *asks* to buy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_BY_ID, UPGRADE_BY_ID } from '../../src/sim/content.ts';
import { bulkToolCost, formatTokens } from '../../src/sim/index.ts';
import { TID, tid } from '../../src/testids.ts';
import { fmtFootprint, footprintWeight, LOCKED_TEASERS, QTY_CYCLE } from '../../src/ui/shop.ts';
import { isHidden, makeMeta, makeRun, mountUI, must, q, unmountAll } from './ui.fake-sim.ts';

afterEach(unmountAll);

const row = (root: HTMLElement, id: string): HTMLButtonElement => must(root, tid(TID.toolRow, id)) as HTMLButtonElement;

describe('tool rows', () => {
  it('shows the icon, name, blurb, owned count, rate, footprint and cost', () => {
    const m = mountUI({ run: makeRun({ tokens: 10_000, tools: { read: 3 } as never }) });
    const r = row(m.root, 'read');
    const def = TOOL_BY_ID.read;
    expect(r.querySelector('.tm-icon')!.getAttribute('data-icon')).toBe('tool_read');
    expect(r.textContent).toContain(def.name);
    expect(r.textContent).toContain(def.blurb);
    expect(must(m.root, tid(TID.toolOwned, 'read')).textContent).toBe('×3');
    expect(must(m.root, tid(TID.toolFootprint, 'read')).textContent).toBe('+7 ctx/s');
    expect(must(m.root, tid(TID.toolCost, 'read')).textContent).toBe(
      formatTokens(Math.round(def.baseCost * Math.pow(def.costGrowth, 3))),
    );
    expect(r.querySelector('.tm-row__rate')!.textContent).toBe(`${(def.baseRate * 3).toFixed(1)}/s`);
  });

  it('flags a heavy footprint and a feather-light one differently', () => {
    expect(footprintWeight(TOOL_BY_ID.read.footprint)).toBe('huge');
    expect(footprintWeight(TOOL_BY_ID.subagent.footprint)).toBe('tiny');
    expect(fmtFootprint(1.5)).toBe('1.5');
    expect(fmtFootprint(7)).toBe('7');
    const m = mountUI();
    expect(must(m.root, tid(TID.toolFootprint, 'read')).getAttribute('data-weight')).toBe('huge');
  });

  it('shows the effective footprint, after every cut', () => {
    const m = mountUI();
    const foot = (): HTMLElement => must(m.root, tid(TID.toolFootprint, 'read'));
    expect(foot().textContent).toBe('+7 ctx/s');
    // Prompt Caching and Line Ranges: Read is a lot lighter now.
    const cut = { ...m.sim.run.tools } as Record<string, number>;
    for (const k of Object.keys(cut)) cut[k] = TOOL_BY_ID[k as keyof typeof TOOL_BY_ID].footprint;
    m.derived = { toolFootprint: { ...cut, read: 2.6 } as never };
    m.frame();
    expect(foot().textContent).toBe('+2.6 ctx/s');
    expect(foot().getAttribute('data-weight')).toBe('light');
  });

  it("names the MCP Server's permanent floor, per unit, as the sim counts it", () => {
    const m = mountUI();
    m.sim.setVisibleTools(['grep', 'read', 'edit', 'bash', 'web_search', 'subagent', 'mcp_server']);
    m.frame();
    expect(must(m.root, tid(TID.toolFootprint, 'mcp_server')).textContent).toBe('+6 ctx/s +900 floor');
    // Two servers behind Tool Search: the manuals weigh a tenth.
    m.sim.run.tools.mcp_server = 2;
    m.derived = { contextFloor: 180 };
    m.frame();
    expect(must(m.root, tid(TID.toolFootprint, 'mcp_server')).textContent).toBe('+6 ctx/s +90 floor');
  });

  it('numbers the first nine rows for the hotkeys', () => {
    const m = mountUI();
    expect(row(m.root, 'grep').querySelector('.tm-row__key')!.textContent).toBe('1');
    expect(row(m.root, 'edit').querySelector('.tm-row__key')!.textContent).toBe('3');
  });

  it('asks to buy at the current quantity, and never buys anything itself', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e9 }) });
    row(m.root, 'grep').click();
    expect(m.sent('buyTool')).toEqual([{ t: 'buyTool', id: 'grep', count: 1 }]);
    expect(m.sim.run.tools.grep).toBe(0);
  });

  it('disables a row the wallet cannot cover, and outside a running prompt', () => {
    const m = mountUI({ run: makeRun({ tokens: 0 }) });
    expect(row(m.root, 'grep').disabled).toBe(true);
    row(m.root, 'grep').click();
    expect(m.sent('buyTool')).toHaveLength(0);
    m.sim.run.tokens = 1e9;
    m.frame();
    expect(row(m.root, 'grep').disabled).toBe(false);
    m.sim.run.phase = 'drafting';
    m.frame();
    expect(row(m.root, 'grep').disabled).toBe(true);
  });

  it('shows a tool at its cap as MAXED', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e12, tools: { grep: 60 } as never }) });
    expect(must(m.root, tid(TID.toolCost, 'grep')).textContent).toBe('MAXED');
    expect(row(m.root, 'grep').disabled).toBe(true);
    expect(must(m.root, tid(TID.toolOwned, 'grep')).textContent).toBe('×60/60');
  });

  it('marks a tool an incident has stalled', () => {
    const m = mountUI({ run: makeRun({ tools: { grep: 2 } as never }) });
    m.derived = { toolHalted: { ...Object.fromEntries(Object.keys(TOOL_BY_ID).map((k) => [k, false])), grep: true } as never };
    m.frame();
    expect(row(m.root, 'grep').classList.contains('tm-row--halted')).toBe(true);
    expect(row(m.root, 'grep').textContent).toContain('Stalled');
  });
});

describe('the ×1 / ×10 / ×100 toggle', () => {
  it('cycles ×1, ×10, ×100 and buys that many', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e12 }) });
    const toggle = must(m.root, TID.buyQtyToggle);
    expect(QTY_CYCLE).toEqual([1, 10, 100]);
    expect(toggle.textContent).toBe('×1');
    toggle.click();
    expect(toggle.textContent).toBe('×10');
    m.frame();
    row(m.root, 'grep').click();
    toggle.click();
    expect(toggle.textContent).toBe('×100');
    m.frame();
    row(m.root, 'grep').click();
    toggle.click();
    expect(toggle.textContent).toBe('×1');
    expect(m.sent('buyTool').map((a) => a.count)).toEqual([10, 100]);
  });

  it('prices the batch exactly as the sim will charge it', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e15, tools: { grep: 4 } as never }), derived: { toolCostMult: 0.85 } });
    must(m.root, TID.buyQtyToggle).click();
    m.frame();
    const def = TOOL_BY_ID.grep;
    expect(must(m.root, tid(TID.toolCost, 'grep')).textContent).toBe(formatTokens(bulkToolCost(def, 4, 10, 0.85)));
  });

  it('caps the batch at the headroom left under the tier cap, and says so', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e15, tools: { grep: 55 } as never }) });
    must(m.root, TID.buyQtyToggle).click();
    m.frame();
    const def = TOOL_BY_ID.grep;
    expect(must(m.root, tid(TID.toolCost, 'grep')).textContent).toBe(`${formatTokens(bulkToolCost(def, 55, 5, 1))} (5)`);
  });

  it('disables a batch the wallet cannot cover whole', () => {
    const def = TOOL_BY_ID.grep;
    const m = mountUI({ run: makeRun({ tokens: def.baseCost * 3 }) });
    expect(row(m.root, 'grep').disabled).toBe(false);
    must(m.root, TID.buyQtyToggle).click();
    m.frame();
    expect(row(m.root, 'grep').disabled).toBe(true);
  });
});

describe('locked teasers', () => {
  it('previews the next tools: a reveal hint, or Unlock in Training', () => {
    const m = mountUI();
    m.sim.setVisibleTools(['grep', 'read']);
    m.frame();
    // Edit is in the save but not yet revealed; nothing past Bash is unlocked.
    const edit = row(m.root, 'edit');
    expect(edit.classList.contains('tm-row--locked')).toBe(true);
    expect(edit.disabled).toBe(true);
    expect(edit.textContent).toContain('LOCKED');
    expect(edit.textContent).toContain('Needs 1 × Read');
    expect(q(m.root, tid(TID.toolRow, 'web_search'))).toBeNull();

    m.sim.setVisibleTools(['grep', 'read', 'edit', 'bash']);
    m.frame();
    const web = row(m.root, 'web_search');
    expect(web.textContent).toContain('Unlock in Training');
    expect(web.textContent).toContain(TOOL_BY_ID.web_search.blurb);
  });

  it('never shows more than a couple of padlocks', () => {
    const m = mountUI();
    m.sim.setVisibleTools(['grep']);
    m.frame();
    expect(m.root.querySelectorAll('.tm-row--locked')).toHaveLength(LOCKED_TEASERS);
  });

  it('drops the Training hint once Training has unlocked the tool', () => {
    const m = mountUI({ meta: makeMeta({ levels: { unlock_web: 1 } }) });
    m.sim.setVisibleTools(['grep', 'read', 'edit', 'bash']);
    m.frame();
    expect(row(m.root, 'web_search').textContent).not.toContain('Unlock in Training');
    expect(row(m.root, 'web_search').textContent).toContain('Needs 1 × Bash');
  });
});

describe('upgrades', () => {
  it('lives on its own tab with a count of what the wallet covers', () => {
    const m = mountUI({ run: makeRun({ tokens: 200 }), upgrades: ['streaming', 'concise_mode', 'prompt_caching'] });
    const tools = must(m.root, TID.tabTools);
    const ups = must(m.root, TID.tabUpgrades);
    expect(tools.getAttribute('aria-selected')).toBe('true');
    expect(isHidden(must(m.root, TID.upgradeList))).toBe(true);
    expect(ups.textContent).toContain('1'); // only Streaming (60) is affordable at 200
    ups.click();
    expect(ups.getAttribute('aria-selected')).toBe('true');
    expect(isHidden(must(m.root, TID.upgradeList))).toBe(false);
    expect(isHidden(must(m.root, TID.toolList))).toBe(true);
  });

  it('shows name, blurb, kind, effect and cost, and asks to buy', () => {
    const m = mountUI({ run: makeRun({ tokens: 1e6 }), upgrades: ['prompt_caching'] });
    const r = must(m.root, tid(TID.upgradeRow, 'prompt_caching')) as HTMLButtonElement;
    const def = UPGRADE_BY_ID['prompt_caching']!;
    expect(r.querySelector('.tm-icon')!.getAttribute('data-icon')).toBe('upg_prompt_caching');
    expect(r.textContent).toContain(def.name);
    expect(r.textContent).toContain(def.blurb);
    expect(r.textContent).toContain('context');
    expect(r.textContent).toContain('Tool footprint ×0.75');
    expect(r.textContent).toContain(formatTokens(def.cost));
    r.click();
    expect(m.sent('buyUpgrade')).toEqual([{ t: 'buyUpgrade', id: 'prompt_caching' }]);
  });

  it('removes a row once the sim stops offering it', () => {
    const m = mountUI({ upgrades: ['streaming', 'concise_mode'] });
    expect(q(m.root, tid(TID.upgradeRow, 'streaming'))).not.toBeNull();
    m.sim.setUpgrades(['concise_mode']);
    m.frame();
    expect(q(m.root, tid(TID.upgradeRow, 'streaming'))).toBeNull();
  });

  it('says so when there is nothing to buy', () => {
    const m = mountUI({ upgrades: [] });
    must(m.root, TID.tabUpgrades).click();
    const empty = must(m.root, TID.upgradeList).querySelector<HTMLElement>('.tm-list__empty')!;
    expect(isHidden(empty)).toBe(false);
    m.sim.setUpgrades(['streaming']);
    m.frame();
    expect(isHidden(empty)).toBe(true);
  });
});
