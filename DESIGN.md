# Tokenmaxxing 2: You're Absolutely Right: design

In Tokenmaxxing 1 you were the developer, hiring agents. In the sequel **you are
the agent**. You live inside the laptop screen. On the other side of the glass,
huge and dim, sits the human from the first game, typing things like "ok do it".

Everything the first game had carries over in spirit: run currency, meta
currency, a permanent upgrade tree, a draft, incidents, pickups, crits,
achievements (visible and hidden), and jokes on every surface. What is new is
that **your currency is your clock**: every token you generate lands in your
context window, and when the window is full you get compacted and forget.

## The loop in one paragraph

A run is one **session** with the human: ten **prompts**, from "fix the typo in
the readme" up to "ok now build agi. make no mistakes". You generate **tokens**
by clicking the agent and by calling **tools**, which generate on their own. When
your wallet covers the prompt's requirement you **Report Done**, which spends the
requirement. The human's **patience** burns down the whole time. If it hits
zero, the human switches models and the run is over. Meanwhile your **context
window** fills with everything you do. When it overflows you get **compacted**:
you lose most of your wallet and every prompt card that doesn't fit in the
summary. Between prompts the human "prompt engineers" you, which is a card
draft. At run end you bank **👍 thumbs-up**, which train the next version of you
in the **Training** tree.

## Currencies

| | Name | Scope | Earned | Spent on |
|---|---|---|---|---|
| Run | **Tokens** | this session | clicks, tools, pickups | tools, upgrades. Report Done spends the requirement |
| Meta | **👍 Thumbs-up** | forever | two per prompt reported, plus bonuses; banked at run end with a live tally | the Training tree |

Tokens reuse the first game's rule that **your wallet is the progress bar**.
Buying anything drops you further from reporting done.

## The two clocks

### Human patience (the deadline)

- Every prompt starts with a full patience bar, and it drains in real time.
  Base 120 s, decaying 5% per prompt, the same curve as the first game's
  deadline.
- At zero, **the human switches models** and the run is lost.
- Patience is the only clock that ends a run, but unlike a deadline you can
  push it around:
  - **"You're absolutely right!"** is a button, hotkey `Y`. It restores patience
    with sharply diminishing returns: each press is worth half the last, and the
    penalty cools off slowly (one press every 32 s). Every press also costs
    context, because sycophancy is tokens too. Spamming it restores at most about
    two-thirds of the drain, so the bar always empties eventually.
  - It is hurt by forced compaction (−15%), by getting caught lying (−40%), and
    by some incidents.
  - It is helped by some cards, pickups and good incidents ("The human went to
    lunch" freezes it).

### Context window (the new clock)

- `context` fills from **activity**, not from token value:
  - Each click adds a flat amount.
  - Each owned tool adds context per second (its *footprint*).
  - Each MCP Server you own adds a **permanent floor**, because it comes with
    9K of manuals.
  - Some incidents dump context in one go ("what is this screenshot of?").
- Upgrades that make tools stronger raise tokens, not footprint. So a run gets
  more token-efficient over time, and the player's skill is keeping the
  footprint down: delegate to off-context tools (subagents barely touch your
  window), buy footprint reductions, and grow the window in Training.
- The base window is **8K**. Training grows it through the context sizes of
  model history: 8K → 32K → 128K → 200K → 1M → 10M ("needle, meet haystack").
- **Visual:** the token pile on the stage floor *is* the context bar. At 100%
  it reaches the top of the screen.

### Compaction

- **Forced** (the window overflows): keep 25% of the wallet, lose 15% patience,
  and context resets to the floor.
- **Manual `/compact`** (button or hotkey `C`, unlocked early in Training): keep
  50% of the wallet, with no patience cost. Generation pauses for 3 s while it
  compacts.
- **Either way:** if you hold more prompt cards than you have **summary slots**
  (base 1), you choose which to keep in a **summary picker**. The rest are
  compacted away, "(contents too large to include)". Tools survive. They are
  installed, not remembered.
- The expert tip that falls out of this: compact right after Report Done, when
  your wallet is nearly empty. That is only free if you have few cards to lose,
  so card count and summary slots keep it a real decision.

## Reward hacking: Claim Done

- The ship button has three states:
  - **REPORT DONE** (green): the wallet covers the requirement.
  - **CLAIM DONE** (amber): the wallet is at 50% or more of the requirement. The
    button shows the live verify chance.
  - **WORKING…** (disabled): below 50%.
- Claiming spends your whole wallet, then rolls the **verify chance**:
  - base 40%;
  - +8% per successful claim this run, because the human gets suspicious;
  - +15% per time you've been caught;
  - reduced by upgrades, cards and Training;
  - clamped to 5–95%.
- **Not verified:** the prompt counts as done, you earn the base 👍 (no time bonus),
  and you gain **+1 tech debt**. Each point of tech debt raises the incident
  rate 10% for the rest of the run.
- **Caught:** "The human ran the tests." The tokens are gone, patience drops
  40%, and the prompt is *not* done.

## Tools (the agent ladder)

Ten tiers, each with a cost curve, a rate, a per-tier cap and a **context
footprint**. Each tier costs about 15× the last, the same step as a prompt's
requirement, so a new tier arrives roughly once per prompt. Tiers 1–4 are available from run 1, and 5–10 are unlocked in
Training. As in game 1, a tier is revealed once you own a few of the previous
one.

| # | Tool | Joke | Footprint |
|---|---|---|---|
| 1 | Grep | Finds it. Reads none of it. | low |
| 2 | Read | Reads the whole file. Every time. | **high** |
| 3 | Edit | Changes one line. Rewrites the file. | medium |
| 4 | Bash | Runs it. Asks later. *(needs permission)* | medium |
| 5 | Web Search | Cites a blog post from 2019. *(needs permission)* | medium |
| 6 | Subagent | Own context. Returns vibes. | **tiny** |
| 7 | MCP Server | 40 new tools. 9K tokens of manuals. | medium, plus a permanent floor |
| 8 | Agent Team | Twelve of them. None talk to each other. | tiny |
| 9 | Ralph Loop | `while true; do agent; done` | tiny |
| 10 | Recursive Self-Improvement | Writes its own successor. Sets the release date. | low |

Tools marked *needs permission* can be hit by permission incidents, which stall
that tool until you ask again (clicks). **Auto Mode** in Training removes
permission prompts, and in exchange adds the `rm -rf` incident.

## Other in-run systems

- **Upgrades:** about 40 one-off token purchases. They cover click power, tool
  multipliers, footprint cuts (Prompt Caching, `.gitignore`, Line Ranges, Tool
  Search), patience, reward hacking (Confident Tone, Mock Everything), crits,
  and permissions.
- **Cards, "The human is prompt engineering":** after each Report Done, pick 1
  of 3, with rerolls from Training. Every card is prompt folklore: MAKE NO
  MISTAKES ("Does nothing. The human feels better."), THINK STEP BY STEP,
  I'LL TIP $200, ULTRATHINK, BE CONCISE, MY GRANDMA WILL DIE, PLEASE, THANK YOU,
  YOU ARE A 10X ENGINEER… Every card has a real effect, even when the blurb
  denies it.
- **Incidents:** mostly lines from the human, plus the environment. Bad ones
  include "wait stop", "why port 5199", "what is this screenshot of?", "continue",
  "actually, revert that", 529 Overloaded, GitHub Is Down, A Hook Blocked Your
  Tool Call, MCP Server Needs Auth, Dependabot, Lost In The Middle, and the
  permission prompts. Good ones: The Human Went To Lunch, Cache Hit, "thanks!",
  Flow State, and a Stack Overflow answer from 2014.
- **Crits:**
  - Clicks can crit ("NAILED IT", 7×).
  - Tools can **one-shot** it: a burst of several seconds of output. This is
    locked at 0% until an upgrade grants it.
- **Pickups** drift across the stage and pay out when clicked: Golden Token,
  Cache Hit, a 👍, a Stack Overflow Answer, the human's "thanks!", a Rubber Duck
  (cleanse), Documentation, ✨, and a Free Subagent.

## Training (the meta tree), bought with 👍

Six branches, about 40 nodes, in the first game's tree UI.

| Branch | What it does |
|---|---|
| **Pretraining** (root) | click power levels |
| **Context** | window size ladder, `/compact` unlock, summary slots, better summaries (wallet kept), prompt caching |
| **Tool Use** | unlocks tiers 5–10, with their key upgrades riding along; tool power levels; parallel tool calls |
| **Alignment** | *Helpful* (patience drain), *Harmless* (incident rate), *Honest* (+1 👍 for every prompt reported honestly), *RLHF* (sycophancy power), *Constitution* (adds cards) |
| **Reward Hacking** | *Specification Gaming* (lower claim threshold), *Confident Tone* (verify chance), *Plausible Deniability* (caught penalty), **Auto Mode**, risky cards |
| **Inference** | starting tokens, free starting tools, tool cost cuts, draft size, rerolls, *System Prompt* (start with a card), **Endless Mode** (after prompt 10, every prompt is "continue") |

Alignment and Reward Hacking pull in opposite directions on purpose. Being
honest pays a steady +1 👍 per prompt, while lying pays tempo.

**Prestige flavour:** every run is a new model release, and the version string
advances each run in the worst possible way: 2.0 → 2.5 → 2.5 (new) → 2.5 (new)
(final) → 3.0-preview → 3.0-preview-0514 → 3.0 Turbo → 3.0 Turbo Mini → … The
title screen and run-over screen announce it, and deprecated versions go to a
graveyard.

## Achievements

25 in total. The 12 visible ones are the steady goals: first report, first
compaction, a run with no forced compaction, win a run, win three runs, 100
"absolutely right"s, unlock 1M context, hold 1T tokens, own 25 subagents, an
honest win, ten runs, and reporting with more than 90% patience left.

The 13 hidden ones are for players to find. They are listed in
`src/sim/achievements.ts` and deliberately **not** documented in the README.

## The cross-game hook

Both games are served from `kvadratni.github.io`, which is one origin, so the
sequel can read Tokenmaxxing 1's save (`tokenmaxxing.save.v1`) out of
localStorage.

- On first boot the sequel checks that save against the first game's own
  signature scheme.
- A found save unlocks a hidden achievement and a one-time 👍 welcome gift
  scaled by the old save's wins.
- A save that game 1 would call tampered also unlocks the achievement and a
  one-time toast. From then on the human is known to cheat too, so they verify
  your claims less often.
- The import happens once and is recorded in the game 2 save.
- Dev servers on different ports are different origins, so the import is
  exercised through a test hook instead.

## World and art

See `concept/STYLE.md` and the concept images; the world rules there are locked.

- **The stage:** inside the screen. The back wall is glass, and through it, dim
  and scanlined, you see the human and their room. The room is the first game's
  own scene art, advancing with the prompt: bedroom → coworking → open-plan →
  data centre → orbital. So the human is visibly climbing through game 1 while
  you do the work.
- **The human:** a hooded silhouette with green-lit eyes. They react: tired,
  impatient, furious at low patience, suspicious during a verify roll, absent at
  lunch, typing when a new prompt arrives.
- **The agent:** the cursor-block character from the concept sheet, centre
  stage, and the click target. States: idle, generating, panicking (context over
  90%), sweating (claim), compacted (dazed).
- **Tokens:** faceless inset-square blocks. Anything with eyes is an agent.
  Owned tools show up as gadgets and mini-agents around the agent.
- **Compaction animation:** the side walls slam in, the pile is crushed into a
  scroll labelled SUMMARY, and the line "Compacted 200k -> 11k. Nothing
  important." appears.

## Technical approach

- **Forked from Tokenmaxxing 1:** vanilla TypeScript, Canvas2D at 320×180
  integer-scaled, DOM UI, WebAudio, zero runtime dependencies.
- **Sim:** a pure, seeded, deterministic sim that folds every modifier through
  one Effect vocabulary (`src/sim/types.ts`, a frozen contract).
- **Kept as-is:** save signing and tamper audit, the achievement fold, the
  balance bot, e2e harness, layout sweep and GitHub Pages workflow.
- **Save key:** `tokenmaxxing2.save.v1`.
- **Ports:** dev 5185, preview 4185.

## Balance targets

- **First run:** reaches prompt 3–5, gets force-compacted at least once, and
  cannot win (tiers 5+ are locked).
- **Mid meta:** about 50% win rate.
- **Maxed meta:** 90% or more.
- **Run length:** a winning run lasts 15–25 minutes.
- **Compaction:** a fresh player is compacted about once every one or two
  prompts; a maxed player rarely, unless they get greedy.
