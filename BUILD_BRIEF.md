# Tokenmaxxing — build brief & file ownership map

A roguelike idle clicker. You are a dev producing **Slop** by clicking a laptop.
Your wallet balance **is** the ship bar. Ship when balance ≥ requirement — but
buying agents/upgrades spends slop and drops the bar. That's the whole tension.

## Non-negotiables

- **Every module codes against `src/sim/types.ts`.** It is a FROZEN CONTRACT.
  Additive changes only (new fields, new members). Never rename or delete.
  If you think you need a breaking change, STOP and report it in your summary.
- **Stay inside your owned paths.** Do not create, edit, or delete files owned
  by another agent. Do not touch `package.json`, `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`, or `src/main.ts` — the integrator owns
  those. If you need a dependency, report it instead of installing it.
- Strict TypeScript. `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`,
  `noUnusedLocals`, `verbatimModuleSyntax`. Use `import type` for types.
  Relative imports inside `src/` must carry the `.ts` extension
  (`./content.ts`), matching the existing files.
- No new runtime dependencies. Zero-dependency vanilla TS + Canvas2D + WebAudio.
- Determinism matters: the sim must be reproducible from a seed. No `Math.random()`
  and no `Date.now()` inside `src/sim/`.

## Ownership map

| Owner | Paths (exclusive write access) |
|---|---|
| Integrator (lead) | `src/main.ts`, `index.html`, `package.json`, all configs, `src/sim/types.ts`, `src/sim/content.ts` |
| **SIM** | `src/sim/*.ts` **except** `types.ts` and `content.ts`, `tests/unit/sim.*.test.ts` |
| **AUDIO** | `src/audio/**`, `tests/unit/audio.*.test.ts` |
| **ART** | `tools/art/**`, `public/sprites/**`, `src/render/atlas.ts` |
| **RENDER** | `src/render/**` **except** `atlas.ts`, `tests/unit/render.*.test.ts` |
| **UI** | `src/ui/**`, `src/styles/**`, `tests/unit/ui.*.test.ts` |
| **QA** | `tests/e2e/**`, `playwright.config.ts`, `tools/gauntlet/**` |
| **BALANCE** | `tools/balance/**`, `tests/unit/balance.*.test.ts` |

`src/sim/content.ts` is read-only for everyone except BALANCE, which may edit
**only** the numeric literals in the `BALANCE` object and the four
`TIER_RATE_*` / `TIER_PAYBACK_*` constants — never the structure.

## Design decisions already locked

- Incidents **do not** pause the deadline timer. Panic is the fun.
- Demos are **granted at run end**, with a live running tally shown during play.
- Shipping **deducts** the requirement from the wallet (`BALANCE.SHIP_DEDUCTS`).
- Scene canvas is exactly **320×180**, integer-scaled. UI chrome is DOM, themed
  to match, and scales in integer steps alongside the canvas.
- Palette: VS Code dark greys + one hot accent (terminal green `#4ec94e`) for
  slop, amber `#e8b34a` for warnings, red `#e5484d` for the deadline burndown.

## Projects

1. Todo App · 2. SaaS Landing Page · 3. Chrome Extension · 4. CRUD MVP ·
5. Crypto Dashboard · 6. AI Wrapper Startup · 7. Uber-for-X ·
8. Enterprise Migration · 9. Government Contract · 10. Rewrite Twitter in a Weekend

Scenes escalate: bedroom → coworking → open-plan → data center → orbital.

## Definition of done for every agent

1. `npx tsc --noEmit` passes for the files you own.
2. Your unit tests pass under `npx vitest run`.
3. No `console.log` left behind (a `debug()` helper gated on a flag is fine).
4. You wrote a short summary: what you built, the public API you exposed, any
   contract additions you made, and anything the integrator must wire up.
