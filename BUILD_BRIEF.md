# Tokenmaxxing 2: build brief and file ownership

Read `DESIGN.md` first. It is the game. This file is how we build it.

This repo is a **fork of Tokenmaxxing 1**. Every module still holds game 1's
code, which is now your reference implementation: same architecture, new game.
Rewrite in place, and reuse whatever carries over. The untouched original lives
at `../tokenmaxxing` (read-only).

## Non-negotiables

- **Every module codes against the frozen contracts:** `src/sim/types.ts`,
  `src/testids.ts`, and the public API listed below.
  - Additive changes only. Never rename or delete.
  - If you need a breaking change, STOP and report it in your summary.
- **`src/sim/content.ts` is the content.** Names, blurbs, numbers and jokes all
  live there. Read it, don't duplicate it. Only the integrator edits it.
  Propose changes in your summary.
- **Stay inside your owned paths.** Do not create, edit or delete files owned by
  another agent.
  - Do not touch `package.json`, any `tsconfig*`/`vite*`/`vitest*` config,
    `index.html` or `src/main.ts`. The integrator owns those.
  - No new dependencies of any kind.
- **Strict TypeScript:** `strict`, `noUncheckedIndexedAccess`,
  `noUnusedLocals`, `verbatimModuleSyntax`.
  - Use `import type` for types.
  - Relative imports inside `src/` carry the `.ts` extension.
- **Zero runtime dependencies:** vanilla TS + Canvas2D + WebAudio.
- **Determinism:** no `Math.random()` and no `Date.now()` inside `src/sim/`.
  The sim must be reproducible from a seed.
- **The whole-project `tsc` is red until everyone lands.** Typecheck your own
  paths by filtering: `npx tsc --noEmit 2>&1 | grep -E '^(src/ui|tests/unit/ui)'`.
  Your unit tests must pass: `npx vitest run tests/unit/<yours>`.
- **Remove game 1 leftovers you own.** When you finish there must be no
  slop/laptop/demos/project/agent-tier vocabulary left in your paths, apart from
  deliberate callbacks. Delete game-1-only tests you own and replace them with
  tests of the new behaviour.

## Ownership

| Owner | Paths (exclusive write access) |
|---|---|
| Integrator (lead) | `src/main.ts`, `index.html`, `package.json`, all configs, `src/sim/types.ts`, `src/sim/content.ts`, `src/testids.ts`, `README.md`, `DESIGN.md`, this file |
| **SIM** | `src/sim/*.ts` **except** `types.ts` and `content.ts`; `tests/unit/sim.*.test.ts` |
| **UI** | `src/ui/**`, `src/styles/**`, `tests/unit/ui.*.test.ts` (incl. `ui.fake-sim.ts`) |
| **STAGE** (render + art) | `src/render/**`, `tools/art/**`, `public/sprites/**`, `tests/unit/render.*.test.ts` |
| **AUDIO** | `src/audio/**`, `tests/unit/audio.*.test.ts` |
| **QA** | `tests/e2e/**`, `playwright.config.ts`, `scripts/**` |
| **BALANCE** | `tools/balance/**`; numeric literals in `content.ts` only, and only when the integrator asks |

## The sim's public API (the SIM agent must export exactly these)

UI, STAGE and the integrator import only from `src/sim/index.ts`,
`src/sim/types.ts` and `src/sim/content.ts`. `index.ts` must export at least
the following:

```ts
export * from './content.ts';
export { createSim, DEFAULT_SEED } from './sim.ts';
export type { Sim, SimOptions, SimDebug } from './sim.ts';
export { unlockedContent, metaLevel, metaRequirementsMet } from './effects.ts';
export type { UnlockedContent } from './effects.ts';
export {
  toolCostAt, bulkToolCost, cappedCount, MAX_BULK_BUY,
  visibleToolList, lockedToolList, unlockHint, availableUpgradeList,
} from './derive.ts';
export { makeActiveIncident } from './incidents.ts';
export {
  SAVE_KEY, loadMeta, saveMeta, clearMeta, defaultMeta, defaultSettings, metaNextCost,
} from './save.ts';
export type { StorageLike } from './save.ts';
export {
  formatTokens,   // 184.2K, 3.84T. Game 1's formatSlop, renamed
  formatContext,  // 184K, 1M, 10M
  formatRate, formatTime, formatInt, formatMult, formatPercent, formatEta,
} from './format.ts';
```

Signatures:

```ts
interface UnlockedContent {
  tools: ReadonlySet<ToolId>; upgrades: ReadonlySet<string>;
  cards: ReadonlySet<string>; features: ReadonlySet<MetaFeature>;
}
function toolCostAt(def: ToolDef, owned: number, toolCostMult: number): number;
function bulkToolCost(def: ToolDef, owned: number, count: number, toolCostMult: number): number;
function cappedCount(def: ToolDef, owned: number, want: number): number;
function visibleToolList(run: RunState, meta: MetaState): ToolDef[];
function lockedToolList(run: RunState, meta: MetaState, lookahead?: number): ToolDef[];
function unlockHint(run: RunState, meta: MetaState, def: ToolDef): string | null;
function availableUpgradeList(run: RunState, meta: MetaState): UpgradeDef[];

interface SimOptions {
  seed?: number; meta?: MetaState; storage?: StorageLike | null; persist?: boolean;
  autoStart?: boolean; onEvent?: EventSink;
  /** Skip the save-tamper check (test hooks are live). */
  trustSave?: boolean;
  /** Where to look for the Tokenmaxxing 1 save. Default: `storage`. */
  legacyStorage?: StorageLike | null;
}

interface Sim extends SimApi {
  readonly patienceMaxMs: number;
  /** 👍 cost of the next level; Infinity when maxed. */
  metaCost(id: MetaUpgradeId): number;
  setSettings(patch: Partial<Settings>): void;
  save(): boolean;
  /** Host reports a mutating test hook was used (the QA Engineer achievement). */
  noteDebugHookUsed(): void;
  unlocked(): UnlockedContent;
  lockedTools(): readonly ToolDef[];
  readonly debug: SimDebug;
}

interface SimDebug {
  grantTokens(n: number): void;
  grantThumbs(n: number): void;
  forceIncident(id: IncidentId): boolean;
  forcePickup(id: string, x?: number, y?: number): boolean;
  forceDraft(ids: readonly CardId[]): boolean;
  setContext(fill: number): void;
  setPatience(fill: number): void;
  forceVerify(outcome: 'pass' | 'catch' | null): void;
  importLegacy(raw: string): void;
}
```

## The render API (the STAGE agent must export exactly these)

```ts
// src/render/index.ts
export function createRenderer(canvas: HTMLCanvasElement, opts?: { atlasBase?: string }): SceneRenderer;
export interface SceneRenderer extends Renderer {
  renderStats(): { fps: number; particles: number; sprites: number; missingSprites: string[] };
}
// src/render/atlas-types.ts
export const AGENT_RECT: { x: number; y: number; w: number; h: number }; // scene-space hit box
```

The DOM overlay `data-testid="agent-hit"` is positioned over `AGENT_RECT`.

## Definition of done, for every agent

1. `tsc` is clean for every file you own. Filter as above, and nothing may
   remain once the modules you depend on exist.
2. Your unit tests pass.
3. No `console.log` left behind.
4. A **short** summary (at most 25 lines) that covers:
   - what you built;
   - the public API you exposed;
   - any contract additions you want the integrator to make;
   - anything the integrator must wire up;
   - **an honest list of what is still weak or untested.**
