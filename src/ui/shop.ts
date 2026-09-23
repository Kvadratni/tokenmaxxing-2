/**
 * The shop rail: TOOLS | UPGRADES, with the ×1/×10/×100 buy toggle.
 *
 * Two costs on every tool row. The price in tokens, which comes straight off
 * the wallet (and so off the report bar: hovering a row paints a ghost there
 * showing where the wallet drops to), and the *footprint*: how much context the
 * tool adds every second it runs. A strong tool with a heavy footprint gets
 * you compacted; the rail makes that visible before you buy.
 *
 * The rail never buys anything itself: rows emit `buyTool` / `buyUpgrade` and
 * the host applies them.
 */
import { TOOL_BY_ID, TOOLS, UPGRADE_BY_ID } from '../sim/content.ts';
import { bulkToolCost, unlockHint } from '../sim/index.ts';
import type { DerivedStats, RunState, ToolDef, ToolId, UpgradeDef } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { Attr, btn, Dis, el, Flag, Hide, KeyedRows, on, Txt } from './dom.ts';
import { effectsLine } from './effect-text.ts';
import { fmtRate, formatInt, formatTokens } from './format.ts';
import { toolIcon, upgradeIcon } from './icon-ids.ts';
import { iconEl } from './icon.ts';
import type { BuyQty, UICtx } from './types.ts';

export const QTY_CYCLE: readonly BuyQty[] = [1, 10, 100];
/** Locked tools previewed below the frontier. Enough to see the ladder, not a wall of padlocks. */
export const LOCKED_TEASERS = 2;

export function qtyLabel(q: BuyQty): string {
  return `×${q}`;
}

/** `1.5` -> `1.5`, `7` -> `7`, `0.6` -> `0.6`: context per second, per unit. */
export function fmtFootprint(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 100) return formatInt(v);
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** How heavy a footprint reads: the colour on the row. */
export function footprintWeight(v: number): 'tiny' | 'light' | 'heavy' | 'huge' {
  if (v < 1) return 'tiny';
  if (v < 3) return 'light';
  if (v < 6) return 'heavy';
  return 'huge';
}

interface ToolRow {
  el: HTMLButtonElement;
  key: Txt;
  owned: Txt;
  rate: Txt;
  foot: Txt;
  footWeight: Attr;
  lock: Txt;
  cost: Txt;
  dis: Dis;
  maxed: Attr;
  locked: Flag;
  capped: Flag;
  halted: Flag;
}

interface UpgradeRow {
  el: HTMLButtonElement;
  cost: Txt;
  dis: Dis;
}

export class Shop {
  readonly el: HTMLElement;

  private readonly toolList: HTMLElement;
  private readonly upgradeList: HTMLElement;
  private readonly toolRows: KeyedRows<ToolRow>;
  private readonly upgradeRows: KeyedRows<UpgradeRow>;
  private readonly toolIds: string[] = [];
  private readonly upgradeIds: string[] = [];
  private readonly upgradeDefs = new Map<string, UpgradeDef>();

  private readonly tabTools: HTMLButtonElement;
  private readonly tabUpgrades: HTMLButtonElement;
  private readonly upgradeCount: Txt;
  private readonly qtyBtn: HTMLButtonElement;
  private readonly qtyTxt: Txt;
  private readonly toolsHide: Hide;
  private readonly upgradesHide: Hide;
  private readonly emptyHide: Hide;

  private readonly disposers: Array<() => void> = [];
  private tab: 'tools' | 'upgrades' = 'tools';
  private qty: BuyQty = 1;
  private visible: readonly ToolDef[] = [];
  private lastRun: RunState | null = null;
  private lastDerived: DerivedStats | null = null;

  constructor(
    parent: HTMLElement,
    private readonly ctx: UICtx,
    private readonly onPreview: (cost: number | null) => void,
  ) {
    this.el = el('aside', { cls: 'tm-shop', tid: TID.shop, parent, attrs: { 'aria-label': 'Shop' } });

    const tabs = el('div', { cls: 'tm-shop__tabs', parent: this.el, attrs: { role: 'tablist' } });
    this.tabTools = btn({
      cls: 'tm-tab',
      tid: TID.tabTools,
      text: 'Tools',
      parent: tabs,
      attrs: { role: 'tab', 'aria-selected': 'true', 'aria-controls': 'tm-tool-list' },
    });
    this.tabUpgrades = btn({
      cls: 'tm-tab',
      tid: TID.tabUpgrades,
      parent: tabs,
      attrs: { role: 'tab', 'aria-selected': 'false', 'aria-controls': 'tm-upgrade-list' },
    });
    el('span', { text: 'Upgrades', parent: this.tabUpgrades });
    this.upgradeCount = new Txt(el('span', { cls: 'tm-tab__count', parent: this.tabUpgrades }));
    this.qtyBtn = btn({
      cls: 'tm-qty',
      tid: TID.buyQtyToggle,
      text: qtyLabel(1),
      parent: tabs,
      label: 'Buy quantity ×1. Click to cycle ×1, ×10, ×100.',
    });
    this.qtyTxt = new Txt(this.qtyBtn);

    const body = el('div', { cls: 'tm-shop__body', parent: this.el });
    this.toolList = el('div', {
      cls: 'tm-list',
      tid: TID.toolList,
      parent: body,
      attrs: { role: 'tabpanel', 'aria-label': 'Tools', id: 'tm-tool-list' },
    });
    this.upgradeList = el('div', {
      cls: 'tm-list',
      tid: TID.upgradeList,
      parent: body,
      attrs: { role: 'tabpanel', 'aria-label': 'Upgrades', id: 'tm-upgrade-list' },
    });
    // Row hosts are nested so the keyed reconciler owns all of their children.
    const toolHost = el('div', { cls: 'tm-list__rows', parent: this.toolList });
    const upgradeHost = el('div', { cls: 'tm-list__rows', parent: this.upgradeList });
    const empty = el('div', {
      cls: 'tm-list__empty',
      text: 'Nothing new. Report done: later prompts unlock more.',
      parent: this.upgradeList,
    });
    this.emptyHide = new Hide(empty);
    this.toolsHide = new Hide(this.toolList);
    this.upgradesHide = new Hide(this.upgradeList);
    this.upgradesHide.set(true);

    this.toolRows = new KeyedRows<ToolRow>(
      toolHost,
      (id) => this.makeToolRow(id as ToolId),
      (r) => r.el,
    );
    this.upgradeRows = new KeyedRows<UpgradeRow>(
      upgradeHost,
      (id) => this.makeUpgradeRow(id),
      (r) => r.el,
    );

    this.disposers.push(
      on(this.tabTools, 'click', () => this.setTab('tools')),
      on(this.tabUpgrades, 'click', () => this.setTab('upgrades')),
      on(this.qtyBtn, 'click', () => this.cycleQty()),
    );
  }

  // ---- public surface used by hotkeys / index -----------------------------

  get quantity(): BuyQty {
    return this.qty;
  }

  cycleQty(): BuyQty {
    const i = QTY_CYCLE.indexOf(this.qty);
    this.qty = QTY_CYCLE[(i + 1) % QTY_CYCLE.length] ?? 1;
    this.qtyTxt.set(qtyLabel(this.qty));
    this.qtyBtn.setAttribute(
      'aria-label',
      `Buy quantity ${qtyLabel(this.qty)}. Click to cycle ×1, ×10, ×100.`,
    );
    return this.qty;
  }

  setTab(tab: 'tools' | 'upgrades'): void {
    if (this.tab === tab) return;
    this.tab = tab;
    const tools = tab === 'tools';
    this.toolsHide.set(!tools);
    this.upgradesHide.set(tools);
    this.tabTools.setAttribute('aria-selected', String(tools));
    this.tabUpgrades.setAttribute('aria-selected', String(!tools));
  }

  /** Hotkeys 1-9 index into the *visible* tool list. */
  buyVisibleIndex(index: number): void {
    const def = this.visible[index];
    if (def === undefined) return;
    this.tryBuy(def);
  }

  // ---- frame update -------------------------------------------------------

  update(run: RunState, d: DerivedStats): void {
    this.lastRun = run;
    this.lastDerived = d;
    const running = run.phase === 'running';

    this.visible = this.ctx.sim.visibleTools();
    this.toolIds.length = 0;
    for (const t of this.visible) this.toolIds.push(t.id);
    // A couple of rungs past the frontier, so the ladder never looks four deep:
    // the next tools to reveal, then the ones only Training unlocks. They are
    // previews, not purchases, and `visibleTools()` is the authority on which
    // is which: a tool can never be in both lists.
    const visibleIds = new Set(this.toolIds);
    const locked = TOOLS.filter((t) => !visibleIds.has(t.id)).slice(0, LOCKED_TEASERS);
    for (const t of locked) this.toolIds.push(t.id);
    this.toolRows.sync(this.toolIds);

    for (let i = 0; i < this.visible.length; i++) {
      const def = this.visible[i];
      if (def === undefined) continue;
      const row = this.toolRows.rows.get(def.id);
      if (row === undefined) continue;
      const owned = run.tools[def.id] ?? 0;
      const price = this.priceFor(def, d, run);
      const cap = def.maxOwned;
      const atCap = owned >= cap || (d.headroom[def.id] ?? 1) <= 0;
      row.key.set(i < 9 ? String(i + 1) : '');
      row.owned.set(owned >= cap * 0.6 ? `×${formatInt(owned)}/${formatInt(cap)}` : `×${formatInt(owned)}`);
      row.rate.set(owned > 0 ? `${fmtRate(d.toolRates[def.id] ?? 0)}/s` : `${fmtRate(def.baseRate)}/s each`);
      // What one more unit costs in context, after every footprint cut.
      const foot = d.toolFootprint[def.id] ?? def.footprint;
      const floor = def.floor > 0 ? (owned > 0 ? d.contextFloor / owned : def.floor) : 0;
      row.foot.set(
        floor > 0 ? `+${fmtFootprint(foot)} ctx/s +${formatInt(floor)} floor` : `+${fmtFootprint(foot)} ctx/s`,
      );
      row.footWeight.set(footprintWeight(foot));
      row.cost.set(atCap ? 'MAXED' : price.label);
      row.capped.set(atCap);
      // A maxed row stays clickable so it can say why (aria-disabled, not disabled).
      row.maxed.set(atCap ? 'true' : null);
      row.halted.set(Boolean(d.toolHalted[def.id]) && owned > 0);
      row.locked.set(false);
      row.lock.set(d.toolHalted[def.id] && owned > 0 ? 'Stalled' : '');
      row.dis.set(!atCap && (!price.affordable || !running));
    }

    for (const def of locked) {
      const row = this.toolRows.rows.get(def.id);
      if (row === undefined) continue;
      row.key.set('');
      row.owned.set('');
      row.rate.set('');
      row.foot.set(def.floor > 0 ? `+${fmtFootprint(def.footprint)} ctx/s +${formatInt(def.floor)} floor` : `+${fmtFootprint(def.footprint)} ctx/s`);
      row.footWeight.set(footprintWeight(def.footprint));
      row.cost.set('LOCKED');
      row.capped.set(false);
      row.maxed.set(null);
      row.halted.set(false);
      row.locked.set(true);
      row.lock.set(unlockHint(run, this.ctx.sim.meta, def) ?? 'Locked');
      row.dis.set(true);
    }

    // Upgrades come and go as requirements unlock and purchases land.
    const avail = this.ctx.sim.availableUpgrades();
    this.upgradeIds.length = 0;
    let affordable = 0;
    for (const u of avail) {
      this.upgradeIds.push(u.id);
      this.upgradeDefs.set(u.id, u);
      if (run.tokens >= u.cost) affordable++;
    }
    this.upgradeRows.sync(this.upgradeIds);
    this.emptyHide.set(avail.length > 0);
    this.upgradeCount.set(affordable > 0 ? ` ${affordable}` : '');

    for (const u of avail) {
      const row = this.upgradeRows.rows.get(u.id);
      if (row === undefined) continue;
      row.cost.set(formatTokens(u.cost));
      row.dis.set(run.tokens < u.cost || !running);
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.toolRows.clear();
    this.upgradeRows.clear();
    this.el.remove();
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Cost and label for the current quantity, capped at what the tool has room
   * for. ×1 is the sim's own `nextCosts`; a batch is priced exactly as the sim
   * will charge it, one rounded unit at a time.
   */
  private priceFor(
    def: ToolDef,
    d: DerivedStats,
    run: RunState,
  ): { cost: number; label: string; affordable: boolean } {
    const tokens = run.tokens;
    const next = d.nextCosts[def.id] ?? def.baseCost;
    const room = d.headroom[def.id] ?? def.maxOwned;
    const n = Math.max(0, Math.min(this.qty, room));
    if (this.qty === 1 || n <= 1) {
      return { cost: next, label: formatTokens(next), affordable: tokens >= next };
    }
    const cost = bulkToolCost(def, run.tools[def.id] ?? 0, n, d.toolCostMult);
    const label = n < this.qty ? `${formatTokens(cost)} (${n})` : formatTokens(cost);
    return { cost, label, affordable: tokens >= cost };
  }

  private buyTool(id: ToolId): void {
    this.ctx.emit({ t: 'buyTool', id, count: this.qty });
  }

  /** At the cap. Checked before affordability: more tokens would not help. */
  private isMaxed(def: ToolDef): boolean {
    const run = this.lastRun;
    const d = this.lastDerived;
    const owned = run?.tools[def.id] ?? 0;
    return owned >= def.maxOwned || (d !== null && (d.headroom[def.id] ?? 1) <= 0);
  }

  /** A click or a hotkey: buy, or say why not. */
  private tryBuy(def: ToolDef): void {
    const run = this.lastRun;
    if (run === null || run.phase !== 'running') return;
    if (this.isMaxed(def)) {
      this.ctx.toast(`Maxed out: ${formatInt(def.maxOwned)} is the cap`, 'bad');
      return;
    }
    const row = this.toolRows.rows.get(def.id);
    if (row !== undefined && row.el.disabled) {
      this.ctx.toast('Not enough tokens', 'bad');
      return;
    }
    this.buyTool(def.id);
  }

  /** Hover/focus paints the ghost segment on the report bar. */
  private wirePreview(node: HTMLButtonElement, costOf: () => number): void {
    const enter = (): void => {
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') {
        this.onPreview(null);
        return;
      }
      this.onPreview(costOf());
      this.ctx.emit({ t: 'uiHover' });
    };
    const leave = (): void => this.onPreview(null);
    this.disposers.push(
      on(node, 'pointerenter', enter),
      on(node, 'pointerleave', leave),
      on(node, 'focus', enter),
      on(node, 'blur', leave),
    );
  }

  private makeToolRow(id: ToolId): ToolRow {
    const def = TOOL_BY_ID[id];
    const node = btn({ cls: 'tm-row tm-row--tool', tid: tid(TID.toolRow, id) });
    const glyph = el('span', { cls: 'tm-row__glyph', parent: node });
    iconEl(toolIcon(id), glyph);
    const key = new Txt(el('span', { cls: 'tm-row__key', parent: glyph }));

    const main = el('span', { cls: 'tm-row__main', parent: node });
    const head = el('span', { cls: 'tm-row__head', parent: main });
    el('span', { cls: 'tm-row__name', text: def.name, parent: head });
    const cost = new Txt(el('span', { cls: 'tm-row__cost', tid: tid(TID.toolCost, id), parent: head }));
    el('span', { cls: 'tm-row__blurb', text: def.blurb, parent: main });
    const stats = el('span', { cls: 'tm-row__stats', parent: main });
    const owned = new Txt(el('span', { cls: 'tm-row__owned', tid: tid(TID.toolOwned, id), parent: stats }));
    const rate = new Txt(el('span', { cls: 'tm-row__rate', parent: stats }));
    const footEl = el('span', {
      cls: 'tm-row__foot',
      tid: tid(TID.toolFootprint, id),
      parent: stats,
      attrs: {
        title:
          def.floor > 0
            ? 'Context one more unit adds per second, plus manuals that never leave your context'
            : 'Context one more unit adds per second while it runs',
      },
    });
    const foot = new Txt(footEl);
    const footWeight = new Attr(footEl, 'data-weight');
    const lock = new Txt(el('span', { cls: 'tm-row__lock', parent: main }));

    const row: ToolRow = {
      el: node,
      key,
      owned,
      rate,
      foot,
      footWeight,
      lock,
      cost,
      dis: new Dis(node),
      maxed: new Attr(node, 'aria-disabled'),
      locked: new Flag(node, 'tm-row--locked'),
      capped: new Flag(node, 'tm-row--capped'),
      halted: new Flag(node, 'tm-row--halted'),
    };
    this.disposers.push(
      on(node, 'click', () => {
        // Locked and unaffordable rows are disabled; a maxed one explains itself.
        if (node.disabled) return;
        this.tryBuy(def);
      }),
    );
    this.wirePreview(node, () => {
      const d = this.lastDerived;
      const run = this.lastRun;
      if (d === null || run === null) return 0;
      return this.priceFor(def, d, run).cost;
    });
    return row;
  }

  private makeUpgradeRow(id: string): UpgradeRow {
    const def = this.upgradeDefs.get(id) ?? UPGRADE_BY_ID[id];
    const kind = def?.kind ?? 'global';
    const node = btn({ cls: `tm-row tm-row--upgrade tm-row--${kind}`, tid: tid(TID.upgradeRow, id) });
    const glyph = el('span', { cls: 'tm-row__glyph', parent: node });
    iconEl(upgradeIcon(id), glyph);
    const main = el('span', { cls: 'tm-row__main', parent: node });
    const head = el('span', { cls: 'tm-row__head', parent: main });
    el('span', { cls: 'tm-row__name', text: def?.name ?? id, parent: head });
    const cost = new Txt(el('span', { cls: 'tm-row__cost', parent: head }));
    el('span', { cls: 'tm-row__blurb', text: def?.blurb ?? '', parent: main });
    const stats = el('span', { cls: 'tm-row__stats', parent: main });
    el('span', { cls: `tm-row__kind tm-row__kind--${kind}`, text: kind, parent: stats });
    const what = def ? effectsLine(def.effects) : '';
    if (what) el('span', { cls: 'tm-row__effect', text: what, parent: stats });

    this.disposers.push(
      on(node, 'click', () => {
        if (node.disabled) return;
        this.ctx.emit({ t: 'buyUpgrade', id });
      }),
    );
    this.wirePreview(node, () => def?.cost ?? 0);
    return { el: node, cost, dis: new Dis(node) };
  }
}
