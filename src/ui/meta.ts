/**
 * The Demos tree.
 *
 * Unlocks (which add content) and levelled upgrades live in one tree rather
 * than two tabs, because the interesting information is the *shape* — which
 * branch you have committed to, and what the next rung costs.
 *
 * Nodes are real buttons positioned absolutely; edges are an SVG layer behind
 * them. Canvas would look glossier and lose keyboard access, which is a bad
 * trade for a menu.
 */
import { META_BY_ID, META_UPGRADES } from '../sim/content.ts';
import { metaRequirementsMet } from '../sim/effects.ts';
import type { MetaState, MetaUpgradeDef } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, Dis, el, Flag, Hide, on, Txt, layoutViewport } from './dom.ts';
import { fmtInt } from './format.ts';
import { iconEl } from './icon.ts';
import type { UICtx } from './types.ts';

/** Tree-space geometry, in CSS px. Hand-tuned to fit a 1440-wide viewport. */
// Nodes are a FIXED height and the row pitch clears it. Letting a node grow
// with its text meant long blurbs overlapped the row below.
const COL = 190;
const ROW = 112;
const NODE_W = 170;
const NODE_H = 92;
const PAD = 16;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Which icon a node wears. An unlock has no art of its own — it borrows the
 * icon of the thing it grants, which is also the clearer signal: the node that
 * unlocks Subagent Swarm should look like Subagent Swarm.
 */
export function iconIdFor(def: MetaUpgradeDef): string {
  const g = def.grants;
  if (!g) return def.id;
  switch (g.t) {
    case 'agentTier':
      return g.id;
    case 'upgrades':
      return g.ids[0] ?? def.id;
    case 'cards':
      return g.ids[0] ?? def.id;
    default:
      return def.id;
  }
}

/** How a node presents right now. */
type NodeState = 'owned' | 'partial' | 'available' | 'tooDear' | 'teased' | 'hidden';

interface TreeNode {
  def: MetaUpgradeDef;
  el: HTMLButtonElement;
  name: Txt;
  cost: Txt;
  effect: Txt;
  pips: HTMLElement[];
  dis: Dis;
  owned: Flag;
  teased: Flag;
  hidden: Flag;
  dear: Flag;
}

export class MetaScreen {
  readonly el: HTMLElement;
  private readonly hide: Hide;
  private readonly demos: Txt;
  private readonly nodes = new Map<string, TreeNode>();
  private readonly edges: SVGLineElement[] = [];
  private readonly disposers: Array<() => void> = [];
  private sig = '';
  private visible = false;
  private backBtn!: HTMLButtonElement;
  private tip!: HTMLElement;
  private tipHide!: Hide;
  private tipTitle!: Txt;
  private tipKind!: Txt;
  private tipBlurb!: Txt;
  private tipEffect!: Txt;
  private tipMeta!: Txt;
  private lastMeta: MetaState | null = null;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.el = el('div', {
      cls: 'tm-screen tm-meta',
      tid: TID.metaScreen,
      parent,
      attrs: { 'aria-label': 'Demos tree' },
    });
    this.hide = new Hide(this.el);
    this.hide.set(true);

    const head = el('div', { cls: 'tm-meta__head', parent: this.el });
    el('h2', { cls: 'tm-modal__title', text: 'Demos', parent: head });
    this.demos = new Txt(el('div', { cls: 'tm-meta__demos', tid: TID.metaDemos, parent: head }));
    el('span', { cls: 'tm-topbar__spacer', parent: head });
    this.backBtn = btn({ cls: 'tm-btn', text: '← Back', parent: head, tid: 'meta-back' });
    this.disposers.push(on(this.backBtn, 'click', () => this.ctx.setScreen('title')));

    el('p', {
      cls: 'tm-title__pitch',
      text:
        'Demos are permanent — they are what your last startup was worth. Unlocks ' +
        'add content to the game; upgrades raise numbers. Everything else dies with ' +
        'the venture that earned them.',
      parent: this.el,
    });

    // --- the tree ---------------------------------------------------------
    const cols = Math.max(...META_UPGRADES.map((d) => d.pos.x)) + 1;
    const rows = Math.max(...META_UPGRADES.map((d) => d.pos.y)) + 1;
    // The last row still needs room for a full-height node, not just its pitch.
    const width = cols * COL + PAD * 2;
    const height = (rows - 1) * ROW + NODE_H + PAD * 2;

    // One shared tooltip, parented to the screen rather than the scroll box so
    // it is never clipped by it.
    this.tip = el('div', { cls: 'tm-tip', tid: TID.metaTip, parent: this.el });
    this.tip.setAttribute('role', 'tooltip');
    this.tipHide = new Hide(this.tip);
    this.tipHide.set(true);
    this.tipTitle = new Txt(el('div', { cls: 'tm-tip__title', parent: this.tip }));
    this.tipKind = new Txt(el('div', { cls: 'tm-tip__kind', parent: this.tip }));
    this.tipBlurb = new Txt(el('p', { cls: 'tm-tip__blurb', parent: this.tip }));
    this.tipEffect = new Txt(el('p', { cls: 'tm-tip__effect', parent: this.tip }));
    this.tipMeta = new Txt(el('div', { cls: 'tm-tip__meta', parent: this.tip }));

    const scroll = el('div', { cls: 'tm-tree__scroll', parent: this.el });
    const tree = el('div', { cls: 'tm-tree', parent: scroll });
    tree.style.width = `${width}px`;
    tree.style.height = `${height}px`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tm-tree__edges');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('aria-hidden', 'true');
    tree.appendChild(svg);

    // Root marker: everything with no prerequisites hangs off it.
    const root = el('div', { cls: 'tm-tree__root', text: 'git init', parent: tree });
    root.style.left = `${PAD + ((cols - 1) * COL) / 2 + (COL - NODE_W) / 2}px`;
    root.style.top = `${PAD}px`;
    root.style.width = `${NODE_W}px`;

    for (const def of META_UPGRADES) this.nodes.set(def.id, this.makeNode(tree, def));

    // Edges last so they can read the final node positions.
    for (const def of META_UPGRADES) {
      const to = this.centreOf(def);
      const parents = def.requires.length
        ? def.requires.map((r) => META_BY_ID[r]).filter((d): d is MetaUpgradeDef => Boolean(d))
        : [];
      if (parents.length === 0) {
        this.edges.push(this.makeEdge(svg, this.rootAnchor(cols), to, def.id));
        continue;
      }
      for (const p of parents) this.edges.push(this.makeEdge(svg, this.centreOf(p, true), to, def.id));
    }
  }

  private rootAnchor(cols: number): { x: number; y: number } {
    return { x: PAD + ((cols - 1) * COL) / 2 + COL / 2, y: PAD + 26 };
  }

  /** Top-centre of a node, or bottom-centre when `bottom` is set. */
  private centreOf(def: MetaUpgradeDef, bottom = false): { x: number; y: number } {
    const x = PAD + def.pos.x * COL + COL / 2;
    const y = PAD + def.pos.y * ROW + (bottom ? NODE_H : 0);
    return { x, y };
  }

  private makeEdge(
    svg: SVGSVGElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
    childId: string,
  ): SVGLineElement {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x));
    line.setAttribute('y2', String(to.y));
    line.setAttribute('class', 'tm-tree__edge');
    line.dataset['child'] = childId;
    svg.appendChild(line);
    return line;
  }

  private makeNode(tree: HTMLElement, def: MetaUpgradeDef): TreeNode {
    // The positioned wrapper carries the row id; the button inside carries the
    // buy id, so both testids land on the element that actually means them —
    // a `disabled` assertion has to be against a real button.
    const wrap = el('div', { cls: 'tm-node-wrap', tid: tid(TID.metaRow, def.id), parent: tree });
    wrap.style.left = `${PAD + def.pos.x * COL + (COL - NODE_W) / 2}px`;
    wrap.style.top = `${PAD + def.pos.y * ROW}px`;
    wrap.style.width = `${NODE_W}px`;

    const node = btn({
      cls: `tm-node tm-node--${def.kind} tm-node--${def.branch}`,
      tid: tid(TID.metaBuy, def.id),
      parent: wrap,
    });
    node.style.height = `${NODE_H}px`;

    iconEl(iconIdFor(def), node);
    const body = el('span', { cls: 'tm-node__body', parent: node });
    const name = new Txt(el('span', { cls: 'tm-node__name', parent: body }));
    const effect = new Txt(el('span', { cls: 'tm-node__effect', parent: body }));

    const pipRow = el('span', { cls: 'tm-node__pips', parent: body });
    const pips: HTMLElement[] = [];
    // Single-level nodes are a yes/no, so pips would be noise.
    if (def.maxLevel > 1) {
      for (let i = 0; i < def.maxLevel; i++) {
        pips.push(el('span', { cls: 'tm-node__pip', parent: pipRow }));
      }
    }

    const cost = new Txt(el('span', { cls: 'tm-node__cost', parent: node }));

    const row: TreeNode = {
      def,
      el: node,
      name,
      cost,
      effect,
      pips,
      dis: new Dis(node),
      owned: new Flag(node, 'is-owned'),
      teased: new Flag(node, 'is-teased'),
      hidden: new Flag(node, 'is-hidden'),
      dear: new Flag(node, 'is-dear'),
    };

    const show = (): void => this.showTip(node, def);
    const hide = (): void => this.tipHide.set(true);
    this.disposers.push(
      on(node, 'pointerenter', show),
      on(node, 'focus', show),
      on(node, 'pointerleave', hide),
      on(node, 'blur', hide),
      on(node, 'click', () => {
        if (node.disabled) return;
        const ok = this.ctx.sim.buyMeta(def.id);
        this.ctx.emit({ t: 'buyMeta', id: def.id, ok });
        this.sig = '';
        // Only the success case toasts here: a failure already emits `denied`,
        // which the shell turns into exactly one message.
        if (ok) this.ctx.toast(`${def.name} unlocked`, 'good');
      }),
    );
    return row;
  }

  /**
   * A locked node is *teased* (shown as `???` with its silhouette) only when it
   * sits one step past the frontier. Anything deeper stays a dim stub —
   * otherwise a new player faces a wall of question marks, which reads as
   * noise rather than as promise.
   */
  private stateOf(def: MetaUpgradeDef, meta: MetaState): NodeState {
    const level = meta.levels[def.id] ?? 0;
    if (level >= def.maxLevel) return 'owned';
    const reachable = metaRequirementsMet(meta, def.id);
    if (level > 0) return 'partial';
    if (reachable) {
      const cost = def.costs[level] ?? Infinity;
      return meta.demos >= cost ? 'available' : 'tooDear';
    }
    const oneStep = def.requires.every((r) => {
      const parent = META_BY_ID[r];
      if (!parent) return false;
      const plevel = meta.levels[r] ?? 0;
      return plevel >= parent.maxLevel || metaRequirementsMet(meta, r);
    });
    return oneStep ? 'teased' : 'hidden';
  }

  /**
   * Node copy is clamped to keep the grid tidy, so the full text lives here.
   * Positioned against the viewport because the tree scrolls.
   */
  private showTip(node: HTMLElement, def: MetaUpgradeDef): void {
    const meta = this.lastMeta;
    const level = meta ? (meta.levels[def.id] ?? 0) : 0;
    const state = meta ? this.stateOf(def, meta) : 'hidden';
    const secret = state === 'teased' || state === 'hidden';

    this.tipTitle.set(secret ? 'Locked' : def.name);
    this.tipKind.set(
      secret
        ? 'Unlock its prerequisites to reveal this'
        : def.kind === 'unlock'
          ? 'UNLOCK · adds content'
          : `UPGRADE · level ${level} of ${def.maxLevel}`,
    );
    this.tipBlurb.set(secret ? '' : def.blurb);
    this.tipEffect.set(secret ? '' : def.describe(level));

    const bits: string[] = [];
    if (!secret) {
      if (state === 'owned') bits.push(def.kind === 'unlock' ? 'Owned' : 'Fully upgraded');
      else bits.push(`Costs ◈${fmtInt(def.costs[level] ?? 0)}`);
    }
    const missing = def.requires
      .filter((r) => !meta || (meta.levels[r] ?? 0) < 1)
      .map((r) => META_BY_ID[r]?.name ?? r);
    if (missing.length) bits.push(`Needs: ${missing.join(', ')}`);
    this.tipMeta.set(bits.join('  ·  '));

    node.setAttribute('aria-describedby', TID.metaTip);
    this.tipHide.set(false);

    // Measure after showing, then clamp inside the viewport.
    const r = node.getBoundingClientRect();
    const t = this.tip.getBoundingClientRect();
    const gap = 10;
    let left = r.left + r.width / 2 - t.width / 2;
    const vp = layoutViewport();
    left = Math.max(8, Math.min(left, vp.vw - t.width - 8));
    // Prefer below; flip above when there is no room.
    const below = r.bottom + gap;
    const top = below + t.height > vp.vh - 8 ? r.top - t.height - gap : below;
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.hide.set(!v);
    if (!v) this.tipHide.set(true);
    if (v) this.sig = '';
  }

  get primary(): HTMLElement {
    return this.backBtn;
  }

  update(meta: MetaState): void {
    if (!this.visible) return;
    let sig = `${meta.demos}`;
    for (const [id] of this.nodes) sig += `|${meta.levels[id] ?? 0}`;
    this.lastMeta = meta;
    if (sig === this.sig) return;
    this.sig = sig;

    this.demos.set(`◈ ${fmtInt(meta.demos)}`);

    for (const [id, row] of this.nodes) {
      const def = row.def;
      const level = meta.levels[id] ?? 0;
      const state = this.stateOf(def, meta);
      const secret = state === 'teased' || state === 'hidden';

      row.name.set(secret ? '???' : def.name);
      row.effect.set(secret ? 'Locked' : def.describe(level));
      row.owned.set(state === 'owned');
      row.teased.set(state === 'teased');
      row.hidden.set(state === 'hidden');
      // Affordability is orthogonal to the node's place in the tree, so it is
      // computed here rather than folded into `state`. `partial` used to return
      // early from `stateOf` without ever checking Demos, which left a
      // half-levelled node amber and clickable no matter how broke you were —
      // clicking it then produced a denial toast for a currency it never spends.
      const buyable = state === 'available' || state === 'partial';
      const nextCost = def.costs[level] ?? Number.POSITIVE_INFINITY;
      const affordable = buyable && meta.demos >= nextCost;
      row.dear.set(state === 'tooDear' || (buyable && !affordable));
      row.dis.set(!affordable);

      if (state === 'owned') {
        row.cost.set(def.kind === 'unlock' ? 'OWNED' : 'MAX');
      } else if (secret) {
        row.cost.set('');
      } else {
        row.cost.set(`◈ ${fmtInt(def.costs[level] ?? 0)}`);
      }

      if (state === 'partial' || state === 'available' || state === 'tooDear') {
        const cost = def.costs[level] ?? Infinity;
        row.el.setAttribute(
          'aria-label',
          `${def.name}. ${def.describe(level)}. Costs ${fmtInt(cost)} demos.`,
        );
      } else {
        row.el.setAttribute('aria-label', secret ? 'Locked node' : `${def.name}, fully upgraded`);
      }

      for (let i = 0; i < row.pips.length; i++) row.pips[i]?.classList.toggle('is-on', i < level);
    }

    // Edges light up once the child is reachable, so the path you have opened
    // reads at a glance.
    for (const line of this.edges) {
      const childId = line.dataset['child'] ?? '';
      const child = META_BY_ID[childId];
      const lit = child ? metaRequirementsMet(meta, childId) : false;
      line.classList.toggle('is-lit', lit);
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.nodes.clear();
    this.el.remove();
  }
}
