# Tokenmaxxing

[![Support on Ko-fi](https://img.shields.io/badge/Ko--fi-support-e8b34a?logo=kofi&logoColor=white)](https://ko-fi.com/maxnovich)

**[▶ Play it in your browser](https://kvadratni.github.io/tokenmaxxing/)**

A roguelike idle clicker about producing **Slop**.

You are a developer. You click a laptop. Slop comes out. You hire agents —
Tab Autocomplete, then a Copy-Paste Chatbot, then an Agentic IDE, and eventually
an AGI that asks for equity — and they produce Slop while you sleep.

The catch: **your wallet balance is the ship bar.** You ship a project when your
balance reaches its requirement. But every agent and every upgrade is paid for
out of that same balance. Buying drops the bar. Every purchase is the same
question — *invest now, or grind to the finish?* — and the deadline does not care
which you pick.

Every run is a startup. Every startup dies. You keep the Demos it earned, spend
them on a permanent upgrade tree, and the next venture starts further along than
the last one did.

![The run screen](docs/screenshots/02-run.png)

<table>
<tr>
<td width="50%"><img src="docs/screenshots/01-title.png" alt="Title screen"></td>
<td width="50%"><img src="docs/screenshots/04-tree.png" alt="The Demos tree"></td>
</tr>
<tr>
<td><img src="docs/screenshots/03-draft.png" alt="Drafting a card"></td>
<td><img src="docs/screenshots/06-achievements.png" alt="The achievements screen"></td>
</tr>
</table>

---

## Play

```bash
npm install
npm run dev
```

Then open http://localhost:5185.

```bash
npm run build && npm run preview   # production build on :4185
npm run build:single               # one portable .html, no server needed
```

The build is a static bundle — `dist/` can be dropped on any static host. There
is no server and no network call; progress lives in `localStorage`.

## Controls

| Input | Action |
|---|---|
| Click the laptop / `Space` / `Enter` | Produce slop |
| `1`–`9` | Buy the corresponding agent tier |
| `S` | Ship the current project |
| `←` `→` `↑` `↓` then `Enter` | Move the draft highlight, then take that card |
| `Esc` | Close a dismissable dialog, or leave the Demos shop |
| `?` button | How to play |

Buy quantity (×1 / ×10 / MAX) is a **button on the rail, deliberately not a
hotkey** — changing how much you are about to spend should never be one stray
keystroke away. Drafting is two-step for the same reason: arrows highlight, a
separate Confirm commits.

Every control is reachable by keyboard and every interactive element is a real
button. `prefers-reduced-motion` is respected, and screen shake, particles, and
audio each have their own toggle.

---

## The loop

**Click** the laptop for slop. **Buy agents** for idle slop. **Ship** when the bar
fills. Then **draft** one of three stack cards, and do it again against a shorter
deadline and a requirement 15× larger.

Two things stop it from being a timer:

- **Draft cards.** After each shipped project you pick 1 of 3. *Opus* triples
  agent output and triples agent cost; *Haiku* makes agents 60% cheaper. Take
  both and you have tripled your output for 1.2× the price. Builds emerge from
  those interactions, not from any single card.
- **Incidents.** Every 25–40s something happens. A hallucinated dependency halves
  idle until you click ten times to fix it. Rate limiting halts production for
  eight seconds. A launch tweet goes viral and doubles everything for fifteen.
  Risk upgrades like `--dangerously-skip-permissions` double your output and make
  incidents 75% more frequent — that trade is the difficulty slider, and you hold it.

**Incidents never pause the deadline.** Panic is the point. Five of them are
*outages* — while one is active you cannot ship at all, and the clock keeps
burning.

### Crits, both kinds

Clicks crit. So do agents: a **one-shot** is the idle-side crit, where an agent
nails the task first try and dumps a burst worth several seconds of output. Two
separate tracks, because clicking and idling are two separate income channels and
a crit stat that only touched one of them would be dead weight for the build the
game pushes you toward. Both stack additively from upgrades and cards, and both
are capped, so a maxed build still gambles.

## Meta

Shipping project N grants N Demos, plus one bonus Demo if at least 25% of the
deadline was still on the clock. **Demos are banked when the run ends**, not as
you earn them — a live tally shows what you stand to walk away with, which makes
pushing one project further a real gamble.

Demos buy nodes on a permanent tree with five branches — headcount, automation,
capital, process and risk — plus a lone capstone. **Unlock** nodes add content:
new agent tiers, new shop upgrades, new cards. **Upgrade** nodes raise numbers you
already have, on deliberately back-loaded curves so that finishing a branch is
worth what it costs.

Your first startup **cannot** reach the last project, by construction: with only
the four starting tiers the raw production ceiling is orders of magnitude under
project 10's demand, so no seed, draft or skill level closes the gap. You are
meant to fold, spend, and found a better-funded one. A run that dies on project 3
still funds a node or two, so run 2 is immediately different.

## Achievements

Twenty of them: ten visible, so you know what to chase, and ten hidden, which
render as `???` behind a blacked-out silhouette until you earn them.

![Achievement unlocked](docs/screenshots/07-achievement-popup.png)

Detection is a pure fold over `GameEvent`s in `src/sim/achievements.ts` — no DOM,
no clock, no storage, exactly like the audio and render consumers. Unlocks are
stamped with the *run number* rather than a timestamp, which is what lets the
simulation stay clock-free and deterministic.

What the hidden ten are, and what earns them, is left for you to find. A couple
of them are not reachable by playing well.

---

## Architecture

```
src/
  sim/        pure, deterministic, DOM-free game simulation
    types.ts    FROZEN CONTRACT — every module codes against this
    content.ts  all static game data (agents, upgrades, cards, incidents, meta)
  render/     Canvas2D pixel renderer, 320x180 integer-scaled
    atlas.ts    GENERATED by tools/art/build-art.mjs
  audio/      fully synthesized WebAudio chiptune — zero audio assets
  ui/         DOM chrome, vanilla TS, no framework
  main.ts     integration: game loop, event fan-out, persistence
tools/
  art/        procedural pixel-art generator (writes public/sprites/*.png)
  balance/    headless balance simulator
  gauntlet/   automated play-testing harness
tests/
  unit/       vitest
  e2e/        playwright
```

**The sim is the source of truth and knows nothing about the DOM.** It takes
`tick(dtMs)` and a seed; it emits `GameEvent`s. Render, audio, and UI are all
pure consumers — they subscribe to events and read `derived()`. That separation
is what makes the game deterministic, replayable from a seed, and testable
without a browser.

Every modifier in the game — upgrades, cards, incidents, meta levels — is
expressed in one `Effect` vocabulary and folded by a single pure function. There
is no special-case code path for "what Opus does"; Opus is two `Effect`s.

### Zero runtime dependencies

No framework, no game engine, no audio files, no image files in source control
that weren't generated by a committed script. The pixel art is produced
procedurally by `npm run art`, which writes both the PNGs and the atlas manifest
so frame rectangles can never drift out of sync with the pixels.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest unit suite
npm run test:e2e    # playwright
npm run test:all    # everything, in the order CI runs it
npm run art         # regenerate pixel art + src/render/atlas.ts
npm run balance     # headless balance report
```

### Test hooks

With `?testhooks=1` (or in dev), the game exposes `window.__TOKENMAXXING__` —
`advance(ms)`, `grant(n)`, `startRun(seed)`, `forceIncident(id)`, `clickLaptop(n)`,
`renderStats()`. The e2e suite drives the game through these rather than
pixel-hunting, so a UI tweak doesn't break a progression test.

A plain load exposes nothing, but the query param **works in production too** —
deliberately, because that is how `scripts/livecheck.mjs` verifies the deployed
build rather than a local approximation of it. Since progress is local and there
is no leaderboard, the only save anyone can affect with it is their own.

## Balance

```
requirement(N) = 100 × 15^(N-1)
deadline(N)    = 120s × 0.95^(N-1)
agent cost     = base × 1.15^owned   (capped at 60 per tier)
```

Each agent tier produces ~5.2× the previous one — deliberately *less* than the
requirement grows, so climbing the ladder alone can never outrun the curve. The
per-tier cap of 60 stops the game degenerating into buying tier 1 forever.

`tools/balance` plays thousands of headless runs through the real simulation
under four bot policies and five meta states:

```bash
npm run balance           # full sweep -> artifacts/balance/report.md
npm run balance:demoday   # is project 10 reachable, and does the build decide it?
```

Demo Day demands a ~308× multiplier over raw capped production; the content can
stack ~1900×, so it is reachable with room to spare.

The bot is also the tuning instrument, which means bugs in *it* are balance bugs.
It spent a long time unable to see automation, crit chance or one-shots in its
valuation, and separately able to buy content the save had never unlocked — so
every number it produced was measured through a blindfold. Both are fixed, and
`tools/balance/nodeweight.ts` now reports each tree node's real contribution to
the win rate, which is how the dead ones got found.

## Slop units

Quantities are **slop**; rates are **slops** — slop per second, the way FLOPS is
floating-point operations per second. The wallet reads `4.20 TSLOP` and the
production readout reads `17.3 GSLOPS`. Full SI to quetta, then `HELLASLOP`,
after a genuinely proposed prefix for 10²⁷ that never made it.

---

## Credits

Built with vanilla TypeScript, Canvas2D and WebAudio. No framework, no game
engine, and **no runtime dependencies**.

- **Pixel art** — generated by a committed script. `npm run art` redraws every
  sprite and regenerates the atlas manifest, so frame rectangles can never drift
  out of sync with the pixels.
- **Audio** — synthesised live. There are no sound files in this repository.
- **Balance** — tuned against `tools/balance`, which plays thousands of headless
  runs through the real simulation under several bot policies.

If it made you smile: [buy me a coffee](https://ko-fi.com/maxnovich).
