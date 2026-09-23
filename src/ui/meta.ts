/**
 * Training: the permanent tree, bought with 👍.
 *
 * Unlocks (which add content) and levelled upgrades live in one tree, because
 * the interesting information is the *shape*: which branch you have committed
 * to, and what the next rung costs. Six columns hang off the base model
 * (Context, Tool Use, Alignment, Reward Hacking, Inference, Prompting) and the
 * capstone, Endless Mode, hangs under all of them.
 *
 * Nodes are real buttons positioned absolutely; edges are an SVG layer behind
 * them. Canvas would look glossier and lose keyboard access, a bad trade for a
 * menu. Buying emits `buyMeta`; the tree repaints when `meta.levels` changes.
 */
import { META_BY_ID, META_UPGRADES } from '../sim/content.ts';
import { metaRequirementsMet } from '../sim/index.ts';
import type { MetaBranch, MetaState, MetaUpgradeDef } from '../sim/types.ts';
import { TID, tid } from '../testids.ts';
import { btn, Dis, el, Flag, Hide, layoutViewport, on, Txt } from './dom.ts';
import { formatInt } from './format.ts';
import { metaIcon, UI_ICONS } from './icon-ids.ts';
import { iconEl, iconOrGlyph } from './icon.ts';
import type { UICtx } from './types.ts';

/** Tree-space geometry, in CSS px. Nodes are a fixed height and the row pitch clears it. */
const COL = 190;
const ROW = 112;
const NODE_W = 170;
const NODE_H = 92;
const PAD = 16;
/** Room above the first row for the branch headings. */
const HEAD_H = 28;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Column headings, by branch. The root has none: it is the node on top. */
export const BRANCH_LABELS: Readonly<Record<MetaBranch, string>> = {
  root: 'Base model',
  context: 'Context',
  tools: 'Tool use',
  alignment: 'Alignment',
  hacking: 'Reward hacking',
  inference: 'Inference',
  prompting: 'Prompting',
};

/** Which icon a node wears: `meta_<id>`. Kept as a function for scripts/iconcheck.ts. */
export function iconIdFor(def: MetaUpgradeDef): string {
  return metaIcon(def.id);
}

/** How a node presents right now. */
export type NodeState = 'owned' | 'partial' | 'available' | 'tooDear' | 'teased' | 'hidden';

/**
 * A locked node is *teased* (`???` with its silhouette) only one step past the
 * frontier. Deeper stays a dim stub, or a new player faces a wall of question
 * marks, which reads as noise rather than promise.
 */
export function nodeState(def: MetaUpgradeDef, meta: MetaState, cost: number): NodeState {
  const level = meta.levels[def.id] ?? 0;
  if (level >= def.maxLevel) return 'owned';
  const reachable = metaRequirementsMet(meta, def.id);
  if (level > 0) return 'partial';
  if (reachable) return meta.thumbs >= cost ? 'available' : 'tooDear';
  const oneStep = def.requires.every((r) => metaRequirementsMet(meta, r));
  return oneStep ? 'teased' : 'hidden';
}

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
  live: Flag;
}

export class MetaScreen {
  readonly el: HTMLElement;
  private readonly hide: Hide;
  private readonly thumbs: Txt;
  private readonly nodes = new Map<string, TreeNode>();
  private readonly edges: SVGLineElement[] = [];
  private readonly disposers: Array<() => void> = [];
  private readonly backBtn: HTMLButtonElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly tip: HTMLElement;
  private readonly tipHide: Hide;
  private readonly tipTitle: Txt;
  private readonly tipKind: Txt;
  private readonly tipBlurb: Txt;
  private readonly tipEffect: Txt;
  private readonly tipNext: Txt;
  private readonly tipMeta: Txt;
  private sig = '';
  private visible = false;
  private lastMeta: MetaState | null = null;

  constructor(parent: HTMLElement, private readonly ctx: UICtx) {
    this.el = el('div', {
      cls: 'tm-screen tm-meta',
      tid: TID.metaScreen,
      parent,
      attrs: { 'aria-label': 'Training' },
    });
    this.hide = new Hide(this.el);
    this.hide.set(true);

    const head = el('div', { cls: 'tm-meta__head', parent: this.el });
    this.backBtn = btn({ cls: 'tm-btn', text: '← Back', parent: head, tid: TID.metaBack });
    el('h2', { cls: 'tm-modal__title tm-meta__title', text: 'Training', parent: head });
    const bal = el('div', {
      cls: 'tm-meta__thumbs',
      tid: TID.metaThumbs,
      parent: head,
      attrs: { title: 'Unspent 👍' },
    });
    iconOrGlyph(UI_ICONS.thumbs, '👍', bal).classList.add('tm-meta__thumbs-icon');
    this.thumbs = new Txt(el('span', { text: '0', parent: bal }));
    el('span', { cls: 'tm-spacer', parent: head });
    this.startBtn = btn({
      cls: 'tm-btn tm-btn--primary',
      text: 'New session',
      parent: head,
      tid: TID.metaStart,
    });

    el('p', {
      cls: 'tm-meta__pitch',
      text:
        'Every 👍 the human gave you is training data now. Unlocks add content to every future ' +
        'session; upgrades raise numbers you already have. Tokens, tools and cards all die with ' +
        'the session. This does not.',
      parent: this.el,
    });

    // --- the tree ---------------------------------------------------------
    const cols = Math.max(...META_UPGRADES.map((d) => d.pos.x)) + 1;
    const rows = Math.max(...META_UPGRADES.map((d) => d.pos.y)) + 1;
    const width = Math.ceil(cols) * COL + PAD * 2;
    const height = HEAD_H + (rows - 1) * ROW + NODE_H + PAD * 2;

    // One shared tooltip, parented to the screen rather than the scroll box so
    // it is never clipped by it.
    this.tip = el('div', { cls: 'tm-tip', tid: TID.metaTip, parent: this.el, attrs: { role: 'tooltip', id: 'tm-meta-tip' } });
    this.tipHide = new Hide(this.tip);
    this.tipHide.set(true);
    this.tipTitle = new Txt(el('div', { cls: 'tm-tip__title', parent: this.tip }));
    this.tipKind = new Txt(el('div', { cls: 'tm-tip__kind', parent: this.tip }));
    this.tipBlurb = new Txt(el('p', { cls: 'tm-tip__blurb', parent: this.tip }));
    this.tipEffect = new Txt(el('p', { cls: 'tm-tip__effect', parent: this.tip }));
    this.tipNext = new Txt(el('p', { cls: 'tm-tip__next', parent: this.tip }));
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

    // Branch headings over each column, read off the nodes themselves.
    const branchCol = new Map<MetaBranch, number>();
    for (const def of META_UPGRADES) {
      if (def.branch === 'root' || branchCol.has(def.branch)) continue;
      branchCol.set(def.branch, def.pos.x);
    }
    for (const [branch, x] of branchCol) {
      const h = el('div', {
        cls: `tm-tree__branch tm-tree__branch--${branch}`,
        text: BRANCH_LABELS[branch],
        parent: tree,
      });
      h.style.left = `${PAD + x * COL + (COL - NODE_W) / 2}px`;
      h.style.top = `${PAD + HEAD_H + ROW - 30}px`;
      h.style.width = `${NODE_W}px`;
    }

    // The base model: every node with no prerequisite hangs off it.
    const root = el('div', { cls: 'tm-tree__root', text: 'Base model · 2.0', parent: tree });
    root.style.left = `${PAD + ((cols - 1) * COL) / 2 + (COL - NODE_W) / 2}px`;
    root.style.top = `${PAD}px`;
    root.style.width = `${NODE_W}px`;

    for (const def of META_UPGRADES) this.nodes.set(def.id, this.makeNode(tree, def));

    // Edges last so they can read the final node positions.
    for (const def of META_UPGRADES) {
      const to = this.anchorOf(def);
      const parents = def.requires
        .map((r) => META_BY_ID[r])
        .filter((d): d is MetaUpgradeDef => Boolean(d));
      if (parents.length === 0) {
        this.edges.push(this.makeEdge(svg, this.rootAnchor(cols), to, def.id));
        continue;
      }
      for (const p of parents) this.edges.push(this.makeEdge(svg, this.anchorOf(p, true), to, def.id));
    }

    this.disposers.push(
      on(this.backBtn, 'click', () => this.ctx.setScreen('title')),
      on(this.startBtn, 'click', () => {
        this.ctx.emit({ t: 'startRun' });
        this.ctx.setScreen('run');
      }),
      on(scroll, 'scroll', () => this.tipHide.set(true)),
    );
  }

  get primary(): HTMLElement {
    return this.startBtn;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.hide.set(!v);
    if (!v) this.tipHide.set(true);
    if (v) this.sig = '';
  }

  update(meta: MetaState): void {
    if (!this.visible) return;
    this.lastMeta = meta;
    let sig = `${meta.thumbs}`;
    for (const [id] of this.nodes) sig += `|${meta.levels[id] ?? 0}`;
    if (sig === this.sig) return;
    this.sig = sig;

    this.thumbs.set(formatInt(meta.thumbs));

    for (const [id, row] of this.nodes) {
      const def = row.def;
      const level = meta.levels[id] ?? 0;
      const cost = this.ctx.sim.metaCost(id);
      const state = nodeState(def, meta, cost);
      const secret = state === 'teased' || state === 'hidden';

      row.name.set(secret ? '???' : def.name);
      row.effect.set(secret ? 'Locked' : def.describe(Math.max(1, level)));
      row.owned.set(state === 'owned');
      row.teased.set(state === 'teased');
      row.hidden.set(state === 'hidden');
      const buyable = state === 'available' || state === 'partial';
      const affordable = buyable && Number.isFinite(cost) && meta.thumbs >= cost;
      row.dear.set(state === 'tooDear' || (buyable && !affordable));
      row.live.set(affordable);
      row.dis.set(!affordable);

      if (state === 'owned') {
        row.cost.set(def.kind === 'unlock' ? 'OWNED' : 'MAX');
      } else if (secret) {
        row.cost.set('');
      } else {
        row.cost.set(`${formatInt(cost)} 👍`);
      }

      if (state === 'owned') {
        row.el.setAttribute('aria-label', `${def.name}, ${def.kind === 'unlock' ? 'owned' : 'fully trained'}`);
      } else if (secret) {
        row.el.setAttribute('aria-label', 'Locked node');
      } else {
        row.el.setAttribute(
          'aria-label',
          `${def.name}. ${def.describe(level + 1)}. Costs ${formatInt(cost)} thumbs up.`,
        );
      }
      for (let i = 0; i < row.pips.length; i++) row.pips[i]?.classList.toggle('is-on', i < level);
    }

    // Edges light up once the child is reachable, so the opened path reads at a glance.
    for (const line of this.edges) {
      const childId = line.dataset['child'] ?? '';
      line.classList.toggle('is-lit', META_BY_ID[childId] ? metaRequirementsMet(meta, childId) : false);
    }
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.nodes.clear();
    this.el.remove();
  }

  // -------------------------------------------------------------------------

  private rootAnchor(cols: number): { x: number; y: number } {
    return { x: PAD + ((cols - 1) * COL) / 2 + COL / 2, y: PAD + 22 };
  }

  /** Top-centre of a node, or bottom-centre when `bottom` is set. */
  private anchorOf(def: MetaUpgradeDef, bottom = false): { x: number; y: number } {
    return {
      x: PAD + def.pos.x * COL + COL / 2,
      y: PAD + HEAD_H + def.pos.y * ROW + (bottom ? NODE_H : 0),
    };
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
    // buy id, so a `disabled` assertion lands on a real button.
    const wrap = el('div', { cls: 'tm-node-wrap', tid: tid(TID.metaRow, def.id), parent: tree });
    wrap.style.left = `${PAD + def.pos.x * COL + (COL - NODE_W) / 2}px`;
    wrap.style.top = `${PAD + HEAD_H + def.pos.y * ROW}px`;
    wrap.style.width = `${NODE_W}px`;

    const node = btn({
      cls: `tm-node tm-node--${def.kind} tm-node--${def.branch}`,
      tid: tid(TID.metaBuy, def.id),
      parent: wrap,
      attrs: { 'aria-describedby': 'tm-meta-tip' },
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
      for (let i = 0; i < def.maxLevel; i++) pips.push(el('span', { cls: 'tm-node__pip', parent: pipRow }));
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
      live: new Flag(node, 'is-live'),
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
        this.ctx.emit({ t: 'buyMeta', id: def.id });
        // Repaint on the next frame even if the balance happens to match.
        this.sig = '';
      }),
    );
    return row;
  }

  /**
   * Node copy is clamped to keep the grid tidy, so the full text lives here:
   * the blurb, what the current level does and what the next one would.
   */
  private showTip(node: HTMLElement, def: MetaUpgradeDef): void {
    const meta = this.lastMeta;
    const level = meta ? (meta.levels[def.id] ?? 0) : 0;
    const cost = this.ctx.sim.metaCost(def.id);
    const state = meta ? nodeState(def, meta, cost) : 'hidden';
    const secret = state === 'teased' || state === 'hidden';

    this.tipTitle.set(secret ? 'Locked' : def.name);
    this.tipKind.set(
      secret
        ? 'Train its prerequisites to reveal this'
        : def.kind === 'unlock'
          ? `UNLOCK · ${BRANCH_LABELS[def.branch]}`
          : `UPGRADE · level ${level} of ${def.maxLevel}`,
    );
    this.tipBlurb.set(secret ? '' : def.blurb);
    this.tipEffect.set(secret || level === 0 ? '' : `Now: ${def.describe(level)}`);
    this.tipNext.set(
      secret || level >= def.maxLevel ? '' : `${level === 0 ? 'Gives' : 'Next'}: ${def.describe(level + 1)}`,
    );

    const bits: string[] = [];
    if (!secret) {
      if (state === 'owned') bits.push(def.kind === 'unlock' ? 'Owned' : 'Fully trained');
      else if (Number.isFinite(cost)) bits.push(`Costs ${formatInt(cost)} 👍`);
    }
    const missing = def.requires
      .filter((r) => !meta || (meta.levels[r] ?? 0) < 1)
      .map((r) => META_BY_ID[r]?.name ?? r);
    if (missing.length) bits.push(`Needs: ${secret ? `${missing.length} more node${missing.length === 1 ? '' : 's'}` : missing.join(', ')}`);
    this.tipMeta.set(bits.join('  ·  '));

    this.tipHide.set(false);
    // Measure after showing, then clamp inside the viewport.
    const r = node.getBoundingClientRect();
    const t = this.tip.getBoundingClientRect();
    const gap = 10;
    const vp = layoutViewport();
    const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, vp.vw - t.width - 8));
    const below = r.bottom + gap;
    const top = below + t.height > vp.vh - 8 ? r.top - t.height - gap : below;
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(Math.max(8, top))}px`;
  }
}
