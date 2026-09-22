/**
 * Shop rail: agents + upgrades, with the buy-quantity toggle.
 *
 * The load-bearing UX idea lives here. Buying spends slop, and slop *is* the
 * ship bar, so every affordable row states its cost twice: in slop, and as the
 * slice of the ship bar it eats. Hovering or focusing a row also paints a
 * ghost segment on the ship bar showing exactly where the bar drops to.
 */
import { AGENT_BY_ID } from '../sim/content.ts';
import { lockedTierList, unlockHint } from '../sim/derive.ts';
import type { AgentTierDef, AgentTierId, DerivedStats, RunState, UpgradeDef } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, Dis, el, Flag, Hide, KeyedRows, on, Txt } from './dom.ts';
import { fmtBarCost, fmtInt, fmtNum } from './format.ts';
import { iconEl } from './icon.ts';
import type { BuyQty, UICtx } from './types.ts';

/** Rows costing at least this share of the requirement get the loud treatment. */
const HEAVY_BAR_COST = 0.25;

const QTY_CYCLE: readonly BuyQty[] = [1, 10, 'max'];

/**
 * Which way a `kind: 'risk'` upgrade moves the incident dial. Both directions
 * get the loud treatment — the risk dial is the interesting decision either
 * way — but only the one that *raises* incidents gets to be red.
 */
function riskDirection(def: UpgradeDef | undefined): 'raise' | 'lower' | null {
  if (def === undefined || def.kind !== 'risk') return null;
  for (const e of def.effects) {
    if (e.t === 'incidentRateMult') return e.v > 1 ? 'raise' : 'lower';
  }
  return 'raise';
}

export function qtyLabel(q: BuyQty): string {
  return q === 'max' ? 'MAX' : `×${q}`;
}

/** `count` argument handed to `sim.buyAgent`. MAX means "as many as I can". */
export function qtyCount(q: BuyQty): number {
  return q === 'max' ? Infinity : q;
}

/**
 * Total cost of `n` more units on a geometric cost curve, given the cost of
 * the next single unit. Mirrors the standard idle-game formula; used for the
 * ×10 / MAX previews only — ×1 always shows the sim's exact `nextCosts`.
 */
export function bulkCost(next: number, growth: number, n: number): number {
  if (n <= 0) return 0;
  if (growth === 1) return next * n;
  return (next * (Math.pow(growth, n) - 1)) / (growth - 1);
}

/** Largest `n` affordable with `budget` on that same curve. */
export function maxAffordable(next: number, growth: number, budget: number): number {
  if (budget < next) return 0;
  if (growth <= 1) return Math.floor(budget / next);
  const n = Math.floor(Math.log(1 + (budget * (growth - 1)) / next) / Math.log(growth));
  return Math.max(0, n);
}

interface AgentRow {
  el: HTMLButtonElement;
  key: Txt;
  lock: Txt;
  locked: Flag;
  capped: Flag;
  owned: Txt;
  rate: Txt;
  cost: Txt;
  barCost: Txt;
  dis: Dis;
  heavy: Flag;
}

interface UpgradeRow {
  el: HTMLButtonElement;
  cost: Txt;
  barCost: Txt;
  dis: Dis;
  heavy: Flag;
}

export class Shop {
  readonly el: HTMLElement;

  private readonly agentList: HTMLElement;
  private readonly upgradeList: HTMLElement;
  private readonly agentRows: KeyedRows<AgentRow>;
  private readonly upgradeRows: KeyedRows<UpgradeRow>;
  private readonly agentIds: string[] = [];
  private readonly upgradeIds: string[] = [];
  private readonly upgradeDefs = new Map<string, UpgradeDef>();

  private readonly tabAgents: HTMLButtonElement;
  private readonly tabUpgrades: HTMLButtonElement;
  private readonly qtyBtn: HTMLButtonElement;
  private readonly qtyTxt: Txt;
  private readonly agentsHide: Hide;
  private readonly upgradesHide: Hide;
  private readonly emptyHide: Hide;

  private readonly disposers: Array<() => void> = [];
  private tab: 'agents' | 'upgrades' = 'agents';
  private qty: BuyQty = 1;
  private visible: readonly AgentTierDef[] = [];

  constructor(
    parent: HTMLElement,
    private readonly ctx: UICtx,
    private readonly onPreview: (cost: number | null) => void,
  ) {
    this.el = el('aside', {
      cls: 'tm-shop',
      tid: TID.shop,
      parent,
      attrs: { 'aria-label': 'Shop' },
    });

    const tabs = el('div', { cls: 'tm-shop__tabs', parent: this.el, attrs: { role: 'tablist' } });
    this.tabAgents = btn({
      cls: 'tm-tab',
      tid: TID.tabAgents,
      text: 'Agents',
      parent: tabs,
      attrs: { role: 'tab', 'aria-selected': 'true', 'aria-controls': TID.agentList },
    });
    this.tabUpgrades = btn({
      cls: 'tm-tab',
      tid: TID.tabUpgrades,
      text: 'Upgrades',
      parent: tabs,
      attrs: { role: 'tab', 'aria-selected': 'false', 'aria-controls': TID.upgradeList },
    });
    this.qtyBtn = btn({
      cls: 'tm-qty',
      tid: TID.buyQtyToggle,
      text: '×1',
      parent: tabs,
      label: 'Buy quantity: ×1. Press Q to cycle.',
      attrs: { 'aria-keyshortcuts': 'Q' },
    });
    this.qtyTxt = new Txt(this.qtyBtn);

    const body = el('div', { cls: 'tm-shop__body', parent: this.el });
    this.agentList = el('div', {
      cls: 'tm-list',
      tid: TID.agentList,
      parent: body,
      attrs: { role: 'tabpanel', 'aria-label': 'Agents' },
    });
    this.upgradeList = el('div', {
      cls: 'tm-list',
      tid: TID.upgradeList,
      parent: body,
      attrs: { role: 'tabpanel', 'aria-label': 'Upgrades' },
    });
    // Row hosts are nested so the keyed reconciler owns 100% of their children.
    const agentHost = el('div', { cls: 'tm-list__rows', parent: this.agentList });
    const upgradeHost = el('div', { cls: 'tm-list__rows', parent: this.upgradeList });
    const empty = el('div', {
      cls: 'tm-list__empty',
      text: 'Nothing new. Ship something.',
      parent: this.upgradeList,
    });
    this.emptyHide = new Hide(empty);
    this.agentsHide = new Hide(this.agentList);
    this.upgradesHide = new Hide(this.upgradeList);
    this.upgradesHide.set(true);

    this.agentRows = new KeyedRows<AgentRow>(
      agentHost,
      (id) => this.makeAgentRow(id as AgentTierId),
      (r) => r.el,
    );
    this.upgradeRows = new KeyedRows<UpgradeRow>(
      upgradeHost,
      (id) => this.makeUpgradeRow(id),
      (r) => r.el,
    );

    this.disposers.push(
      on(this.tabAgents, 'click', () => this.setTab('agents')),
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
      `Buy quantity: ${qtyLabel(this.qty)}. Press Q to cycle.`,
    );
    return this.qty;
  }

  setTab(tab: 'agents' | 'upgrades'): void {
    if (this.tab === tab) return;
    this.tab = tab;
    const agents = tab === 'agents';
    this.agentsHide.set(!agents);
    this.upgradesHide.set(agents);
    this.tabAgents.setAttribute('aria-selected', String(agents));
    this.tabUpgrades.setAttribute('aria-selected', String(!agents));
  }

  /** Hotkeys 1-9 index into the *visible* tier list. */
  buyVisibleIndex(index: number): void {
    const def = this.visible[index];
    if (def === undefined) return;
    this.buyAgent(def.id);
  }

  // ---- frame update -------------------------------------------------------

  update(run: RunState, d: DerivedStats): void {
    this.visible = this.ctx.sim.visibleTiers();
    this.agentIds.length = 0;
    for (const t of this.visible) this.agentIds.push(t.id);
    // Show a few rungs past the frontier so the ladder never looks like a
    // three-item list. These rows are inert previews, not purchases.
    // `visibleTiers()` is the authority on what is unlocked; filter against it
    // so a tier can never land in both lists and thrash its row every frame.
    const visibleIds = new Set(this.agentIds);
    // `meta` is mandatory here. Omitting it used to disable the unlock gate, so
    // the preview advertised tiers the save had never bought — and worse, a tier
    // the ladder had revealed but the tree had not unlocked fell out of *both*
    // lists and vanished from the rail mid-run.
    const locked = lockedTierList(run, this.ctx.sim.meta).filter((t) => !visibleIds.has(t.id));
    for (const t of locked) this.agentIds.push(t.id);
    this.agentRows.sync(this.agentIds);

    const req = d.requirement > 0 ? d.requirement : 1;

    for (let i = 0; i < this.visible.length; i++) {
      const def = this.visible[i];
      if (def === undefined) continue;
      const row = this.agentRows.rows.get(def.id);
      if (row === undefined) continue;

      const owned = run.agents[def.id] ?? 0;
      const next = d.nextCosts[def.id] ?? def.baseCost;
      const price = this.priceFor(next, def.costGrowth, run.slop);

      row.key.set(i < 9 ? String(i + 1) : '');
      // Show the ceiling once it is actually in sight, so hitting it is never
      // a surprise mid-purchase.
      const cap = def.maxOwned;
      row.owned.set(owned >= cap * 0.6 ? `×${fmtInt(owned)}/${fmtInt(cap)}` : `×${fmtInt(owned)}`);
      const atCap = owned >= cap;
      row.capped.set(atCap);
      row.rate.set(`${fmtNum(d.tierRates[def.id] ?? 0)}/s`);
      row.cost.set(price.label);
      row.barCost.set(price.cost > 0 ? `−${fmtBarCost(price.cost / req)} bar` : '—');
      row.heavy.set(price.cost / req >= HEAVY_BAR_COST);
      row.dis.set(atCap || !price.affordable || run.phase !== 'running');
      row.locked.set(false);
      row.lock.set(atCap ? 'MAXED — climb the ladder' : '');
    }

    for (const def of locked) {
      const row = this.agentRows.rows.get(def.id);
      if (row === undefined) continue;
      row.key.set('');
      row.owned.set('');
      row.rate.set('');
      row.cost.set(fmtNum(def.baseCost));
      row.barCost.set('');
      row.heavy.set(false);
      row.dis.set(true);
      row.locked.set(true);
      row.lock.set(unlockHint(run, def) ?? 'Locked');
    }

    // upgrades come and go as requirements unlock and purchases land
    const avail = this.ctx.sim.availableUpgrades();
    this.upgradeIds.length = 0;
    for (const u of avail) {
      this.upgradeIds.push(u.id);
      this.upgradeDefs.set(u.id, u);
    }
    this.upgradeRows.sync(this.upgradeIds);
    this.emptyHide.set(avail.length > 0);

    for (const u of avail) {
      const row = this.upgradeRows.rows.get(u.id);
      if (row === undefined) continue;
      row.cost.set(fmtNum(u.cost));
      row.barCost.set(`−${fmtBarCost(u.cost / req)} bar`);
      row.heavy.set(u.cost / req >= HEAVY_BAR_COST);
      row.dis.set(run.slop < u.cost || run.phase !== 'running');
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.agentRows.clear();
    this.upgradeRows.clear();
    this.el.remove();
  }

  // ---- internals ----------------------------------------------------------

  /** Cost + label for the current quantity setting. */
  private priceFor(
    next: number,
    growth: number,
    slop: number,
  ): { cost: number; label: string; affordable: boolean } {
    if (this.qty === 1) {
      return { cost: next, label: fmtNum(next), affordable: slop >= next };
    }
    if (this.qty === 10) {
      const c = bulkCost(next, growth, 10);
      return { cost: c, label: fmtNum(c), affordable: slop >= c };
    }
    const n = maxAffordable(next, growth, slop);
    if (n <= 0) return { cost: next, label: fmtNum(next), affordable: false };
    return { cost: bulkCost(next, growth, n), label: `${fmtNum(bulkCost(next, growth, n))} (${n})`, affordable: true };
  }

  private buyAgent(id: AgentTierId): void {
    const count = qtyCount(this.qty);
    const ok = this.ctx.sim.buyAgent(id, count);
    this.ctx.emit({ t: 'buyAgent', id, count, ok });
    if (!ok) this.ctx.toast('Not enough slop', 'bad');
  }

  private buyUpgrade(id: string): void {
    const ok = this.ctx.sim.buyUpgrade(id);
    this.ctx.emit({ t: 'buyUpgrade', id, ok });
    if (ok) {
      const def = this.upgradeDefs.get(id);
      this.ctx.toast(`Bought ${def?.name ?? id}`, 'good');
    } else {
      this.ctx.toast('Not enough slop', 'bad');
    }
  }

  /** Hover/focus paints the ghost segment on the ship bar. */
  private wirePreview(node: HTMLButtonElement, costOf: () => number): void {
    const enter = (): void => {
      if (node.disabled) {
        this.onPreview(null);
        return;
      }
      this.onPreview(costOf());
      this.ctx.emit({ t: 'uiHover' });
    };
    const leave = (): void => this.onPreview(null);
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('focus', enter);
    node.addEventListener('blur', leave);
  }

  private makeAgentRow(id: AgentTierId): AgentRow {
    const def = AGENT_BY_ID[id];
    const node = btn({ cls: 'tm-row tm-row--agent', tid: tid(TID.agentRow, id) });
    const glyph = el('span', { cls: 'tm-row__glyph', parent: node });
    iconEl(id, glyph);
    const key = new Txt(el('span', { cls: 'tm-row__key', parent: glyph }));

    const main = el('span', { cls: 'tm-row__main', parent: node });
    el('span', { cls: 'tm-row__name', text: def.name, parent: main });
    el('span', { cls: 'tm-row__blurb', text: def.blurb, parent: main });
    const stats = el('span', { cls: 'tm-row__stats', parent: main });
    const owned = new Txt(
      el('span', { cls: 'tm-row__owned', tid: tid(TID.agentOwned, id), parent: stats }),
    );
    const rate = new Txt(el('span', { cls: 'tm-row__rate', parent: stats }));
    const lock = new Txt(el('span', { cls: 'tm-row__lock', parent: stats }));

    const side = el('span', { cls: 'tm-row__side', parent: node });
    const cost = new Txt(el('span', { cls: 'tm-row__cost', tid: tid(TID.agentCost, id), parent: side }));
    const barCost = new Txt(el('span', { cls: 'tm-row__barcost', parent: side }));

    const row: AgentRow = {
      el: node,
      key,
      lock,
      locked: new Flag(node, 'tm-row--locked'),
      capped: new Flag(node, 'tm-row--capped'),
      owned,
      rate,
      cost,
      barCost,
      dis: new Dis(node),
      heavy: new Flag(node, 'is-heavy'),
    };
    node.addEventListener('click', () => {
      if (node.disabled) return;
      this.buyAgent(id);
    });
    this.wirePreview(node, () => {
      const next = this.ctx.sim.derived().nextCosts[id] ?? def.baseCost;
      return this.priceFor(next, def.costGrowth, this.ctx.sim.run.slop).cost;
    });
    return row;
  }

  private makeUpgradeRow(id: string): UpgradeRow {
    const def = this.upgradeDefs.get(id);
    const risk = riskDirection(def);
    const node = btn({
      cls:
        'tm-row tm-row--upgrade' +
        (risk === null ? '' : risk === 'raise' ? ' tm-row--risk' : ' tm-row--risk tm-row--risk-safe'),
      tid: tid(TID.upgradeRow, id),
    });
    const glyph = el('span', { cls: 'tm-row__glyph', parent: node });
    iconEl(id, glyph);
    const main = el('span', { cls: 'tm-row__main', parent: node });
    el('span', { cls: 'tm-row__name', text: def?.name ?? id, parent: main });
    el('span', { cls: 'tm-row__blurb', text: def?.blurb ?? '', parent: main });
    el('span', {
      cls: 'tm-row__stats',
      text:
        risk === 'raise'
          ? 'RISK · MORE INCIDENTS'
          : risk === 'lower'
            ? 'RISK · FEWER INCIDENTS'
            : (def?.kind ?? 'upgrade').toUpperCase(),
      parent: main,
    });

    const side = el('span', { cls: 'tm-row__side', parent: node });
    const cost = new Txt(el('span', { cls: 'tm-row__cost', parent: side }));
    const barCost = new Txt(el('span', { cls: 'tm-row__barcost', parent: side }));

    node.addEventListener('click', () => {
      if (node.disabled) return;
      this.buyUpgrade(id);
    });
    this.wirePreview(node, () => def?.cost ?? 0);

    return { el: node, cost, barCost, dis: new Dis(node), heavy: new Flag(node, 'is-heavy') };
  }
}
