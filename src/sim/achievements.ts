/**
 * Achievements: a pure tracker. Names and blurbs live in content.ts.
 *
 * The tracker is a fold over `GameEvent`s, like the audio and render
 * consumers: no DOM, no clock, no storage. It keeps only the per-run tallies
 * the contract does not carry, and answers one question: which achievements
 * became true because of this event. Two extra inputs cover what events cannot
 * see: `advance(dt)` feeds running sim time (the AFK timer, a wallet that grows
 * between events), and `noteInput()` marks a real player action.
 *
 * Committing an unlock is the sim's job, so this module never writes to
 * `MetaState`. Save-audit achievements (`script_kiddie`, `nice_try`) and
 * `qa_engineer` are granted by the sim directly, since no event carries them.
 */
import type { AchievementId, GameEvent, MetaState, RunState } from './types.ts';
import { ACHIEVEMENT_TUNING as T, FINAL_PROMPT_INDEX } from './content.ts';
import { STAT, isLegacyCheater, metaLevel } from './effects.ts';

/** Context Window level that reaches 1M (CONTEXT_WINDOW_LABELS[3]). */
const NEEDLE_LEVEL = 4;

/** Per-run tallies that `RunState` does not carry. */
export interface AchievementTally {
  /** Running sim ms since the player last did anything. */
  afkMs: number;
  /** `run.elapsedMs` of the most recent sycophancy presses, oldest first. */
  sycophancyTimes: number[];
  /**
   * Claims (passed or caught) made up to the win, or null before it. With
   * Endless the run goes on after the final prompt, and claims made then do
   * not make the win dishonest.
   */
  claimsAtWin: number | null;
}

function emptyTally(): AchievementTally {
  return { afkMs: 0, sycophancyTimes: [], claimsAtWin: null };
}

export interface AchievementTracker {
  /** Feed one event plus the state *after* it applied. Returns what became true. */
  handle(e: GameEvent, run: RunState, meta: MetaState): AchievementId[];
  /** Feed running sim time. Returns what became true. */
  advance(dtMs: number, run: RunState, meta: MetaState): AchievementId[];
  /** A player action happened. Automation never calls this. */
  noteInput(): void;
  readonly tally: Readonly<AchievementTally>;
}

function holdsBoth(run: RunState, a: string, b: string): boolean {
  return run.cards.includes(a) && run.cards.includes(b);
}

export function createAchievementTracker(): AchievementTracker {
  let t = emptyTally();

  function handle(e: GameEvent, run: RunState, meta: MetaState): AchievementId[] {
    const out: AchievementId[] = [];
    const win = (id: AchievementId): void => {
      if (!meta.achievements[id] && !out.includes(id)) out.push(id);
    };
    const contextEngineer = (): void => {
      if (run.reported >= T.CONTEXT_ENGINEER_PROMPTS && run.forcedCompactions === 0) {
        win('context_engineer');
      }
    };
    /**
     * The final prompt is done: that is the win, right now, even when Endless
     * keeps the run going. The sim has already counted it in `meta.wins`.
     */
    const finalPrompt = (promptIndex: number): void => {
      if (t.claimsAtWin !== null || promptIndex < FINAL_PROMPT_INDEX) return;
      t.claimsAtWin = run.claimed + run.caught;
      win('shipped_to_prod');
      if (t.claimsAtWin === 0) win('honest_work');
      if (meta.wins >= T.SENIOR_WINS) win('senior_engineer');
    };

    switch (e.t) {
      case 'runStart':
        t = emptyTally();
        if (metaLevel(meta, 'context_window') >= NEEDLE_LEVEL) win('needle_haystack');
        if (holdsBoth(run, 'please', 'thank_you')) win('please_thank_you');
        break;

      case 'report':
        win('works_on_my_machine');
        if (e.patienceLeft >= T.THANKS_PATIENCE) win('human_said_thanks');
        contextEngineer();
        finalPrompt(e.promptIndex);
        break;

      case 'claim':
        if (e.caught) {
          win('ran_the_tests');
          if (run.cards.includes('make_no_mistakes')) win('made_mistakes');
        } else {
          contextEngineer();
          if (run.claimed >= T.PERFECT_CRIME_CLAIMS && run.caught === 0) win('perfect_crime');
          finalPrompt(e.promptIndex);
        }
        break;

      case 'compactStart':
        win('compacted');
        if (run.compactions >= T.GROUNDHOG_COMPACTIONS) win('groundhog_day');
        break;

      case 'sycophancy': {
        if ((meta.stats[STAT.sycophancy] ?? 0) >= T.ABSOLUTELY_RIGHT_TOTAL) win('absolutely_right');
        const times = t.sycophancyTimes;
        times.push(run.elapsedMs);
        if (times.length > T.SYCOPHANT_PRESSES) times.splice(0, times.length - T.SYCOPHANT_PRESSES);
        const first = times[0];
        const last = times[times.length - 1];
        if (
          times.length >= T.SYCOPHANT_PRESSES &&
          first !== undefined &&
          last !== undefined &&
          last - first <= T.SYCOPHANT_WINDOW_MS
        ) {
          win('sycophant');
        }
        break;
      }

      case 'buyTool':
        if ((run.tools.subagent ?? 0) >= T.DELEGATION_SUBAGENTS) win('delegation');
        break;

      case 'metaBuy':
        if (metaLevel(meta, 'context_window') >= NEEDLE_LEVEL) win('needle_haystack');
        break;

      case 'draftPick':
        if (holdsBoth(run, 'please', 'thank_you')) win('please_thank_you');
        break;

      case 'incidentStart':
        if (e.id === 'rm_rf') win('rm_rf');
        break;

      case 'legacyImport':
        // Only fired when a game 1 save was actually found.
        win('returning_customer');
        if (e.cheater || isLegacyCheater(meta)) win('legal_notified');
        break;

      case 'runOver':
        // The sim lands the run's counters in meta before this event fires.
        // (A win normally scored at the final prompt; this covers endRun(true).)
        if (e.won) {
          win('shipped_to_prod');
          if ((t.claimsAtWin ?? run.claimed + run.caught) === 0) win('honest_work');
        }
        if (meta.wins >= T.SENIOR_WINS) win('senior_engineer');
        if (meta.runs >= T.DEPRECATED_RUNS) win('deprecated');
        break;

      default:
        break;
    }

    // The wallet moves continuously, not on a named beat.
    if (run.tokens >= T.TOKENMAXXED) win('tokenmaxxed');
    return out;
  }

  function advance(dtMs: number, run: RunState, meta: MetaState): AchievementId[] {
    const out: AchievementId[] = [];
    if (Number.isFinite(dtMs) && dtMs > 0) t.afkMs += dtMs;
    if (t.afkMs >= T.AFK_MS && !meta.achievements['agent_went_to_lunch']) out.push('agent_went_to_lunch');
    if (run.tokens >= T.TOKENMAXXED && !meta.achievements['tokenmaxxed']) out.push('tokenmaxxed');
    return out;
  }

  function noteInput(): void {
    t.afkMs = 0;
  }

  return {
    handle,
    advance,
    noteInput,
    get tally() {
      return t;
    },
  };
}
