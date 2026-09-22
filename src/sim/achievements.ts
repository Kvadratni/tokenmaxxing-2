/**
 * Achievements — definitions plus a pure tracker.
 *
 * The tracker is a fold over `GameEvent`s, exactly like the audio and render
 * consumers: no DOM, no clock, no storage. It owns only the per-run tallies the
 * contract does not already carry (manual vs automated clicks, which income
 * channel earned what, streaks) and answers one question — which achievements
 * became true as a result of this event.
 *
 * Committing an unlock is the sim's job, so this module never writes to
 * `MetaState`.
 */
import type {
  AchievementDef,
  AchievementId,
  DerivedStats,
  GameEvent,
  MetaState,
  RunState,
} from './types.ts';
import {
  AGENT_TIERS,
  AGENT_TIER_IDS,
  FINAL_PROJECT_INDEX,
  INCIDENT_BY_ID,
  META_UPGRADES,
} from './content.ts';

/** Leftmost picks in a row for `absolutely_right`. */
const LEFTMOST_STREAK = 5;
/** Lifetime losses for `sigkill`. */
const SIGKILL_LOSSES = 25;
/** Lifetime Demos for `series_a`. */
const SERIES_A_DEMOS = 100;
/**
 * Slop held at once for the big-number achievement.
 *
 * This was 1e33 — an actual hellaslop, the top of the SI ladder the help
 * overlay jokes about. Project 10 demands 3.84 TSLOP to ship, so it sat
 * twenty-one orders of magnitude out of reach: unreachable by construction
 * rather than merely hard. A teraslop is the real milestone — you only hold one
 * while working toward the final project.
 */
export const BIG_SLOP = 1e12;
/** Incidents cleared inside one project for `firefighter`. */
const FIREFIGHTER_CLEARS = 3;
/** Idle seconds before a ship still counts as `afk`. */
const AFK_MS = 45_000;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ---- visible ----------------------------------------------------------
  {
    id: 'first_ship',
    name: 'Hello World',
    blurb: 'Ship your first project.',
    hidden: false,
    icon: 'achv_first_ship',
  },
  {
    id: 'series_a',
    name: 'Series A',
    blurb: `Earn ${SERIES_A_DEMOS} Demos in total.`,
    hidden: false,
    icon: 'achv_series_a',
  },
  {
    id: 'demo_day',
    name: 'Demo Day',
    blurb: 'Ship every project in a single run.',
    hidden: false,
    icon: 'achv_demo_day',
  },
  {
    id: 'full_stack',
    name: 'Full Stack',
    blurb: 'Own at least one of every agent tier in one run.',
    hidden: false,
    icon: 'achv_full_stack',
  },
  {
    id: 'vertical',
    name: 'Vertical Integration',
    blurb: 'Max out every node in one branch of the tree.',
    hidden: false,
    icon: 'achv_vertical',
  },
  {
    id: 'hellaslop',
    name: 'TERASLOP',
    blurb:
      'Hold a teraslop at once — twelve zeros. Hellaslop remains theoretical, ' +
      'which is probably for the best.',
    hidden: false,
    icon: 'achv_hellaslop',
  },
  {
    id: 'friday',
    name: 'Ship It Friday',
    blurb: 'Ship a project with under five seconds left.',
    hidden: false,
    icon: 'achv_friday',
  },
  {
    id: 'no_hands',
    name: 'No Hands',
    blurb: 'Ship a project without clicking the laptop once.',
    hidden: false,
    icon: 'achv_no_hands',
  },
  {
    id: 'firefighter',
    name: 'Firefighter',
    blurb: `Clear ${FIREFIGHTER_CLEARS} incidents inside a single project.`,
    hidden: false,
    icon: 'achv_firefighter',
  },
  {
    id: 'tokenmaxxed',
    name: 'Tokenmaxxed',
    blurb: 'Buy every node in the tree, at every level.',
    hidden: false,
    icon: 'achv_tokenmaxxed',
  },

  // ---- hidden -----------------------------------------------------------
  {
    id: 'script_kiddie',
    name: 'Script Kiddie',
    blurb: 'Your save did not match its own checksum. The file noticed.',
    hidden: true,
    icon: 'achv_script_kiddie',
  },
  {
    id: 'nice_try',
    name: 'Nice Try',
    blurb: 'You fixed the checksum and forgot the arithmetic. Respect, mostly.',
    hidden: true,
    icon: 'achv_nice_try',
  },
  {
    id: 'rubber_duck',
    name: 'Rubber Duck Debugging',
    blurb: 'Explain an incident to the duck until it goes away.',
    hidden: true,
    icon: 'achv_rubber_duck',
  },
  {
    id: 'one_shot_wonder',
    name: 'One-Shot Wonder',
    blurb: 'Win a run where your agents out-earned your own clicking.',
    hidden: true,
    icon: 'achv_one_shot_wonder',
  },
  {
    id: 'technical_debt',
    name: 'Technical Debt',
    blurb: 'Miss the last deadline with the bar essentially full.',
    hidden: true,
    icon: 'achv_technical_debt',
  },
  {
    id: 'sigkill',
    name: 'SIGKILL Enjoyer',
    blurb: `Lose ${SIGKILL_LOSSES} runs. The process was killed. Repeatedly.`,
    hidden: true,
    icon: 'achv_sigkill',
  },
  {
    id: 'no_mistakes',
    name: 'Make No Mistakes',
    blurb: 'Win a run without a single thing going wrong.',
    hidden: true,
    icon: 'achv_no_mistakes',
  },
  {
    id: 'absolutely_right',
    name: 'Absolutely Right',
    blurb: `Take the leftmost card ${LEFTMOST_STREAK} drafts in a row.`,
    hidden: true,
    icon: 'achv_absolutely_right',
  },
  {
    id: 'afk',
    name: 'AFK',
    blurb: 'Ship a project having not touched it for the last forty-five seconds.',
    hidden: true,
    icon: 'achv_afk',
  },
  {
    id: 'qa_engineer',
    name: 'QA Engineer',
    blurb: 'You played the game through its own test harness. That is, technically, testing.',
    hidden: true,
    icon: 'achv_qa_engineer',
  },
  {
    id: 'ralph',
    name: 'Ralph',
    blurb: 'Own the maximum possible number of Ralph Loops. while true; do.',
    hidden: true,
    icon: 'achv_ralph',
  },
];

export const ACHIEVEMENT_BY_ID: Readonly<Record<string, AchievementDef>> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

export const ACHIEVEMENT_IDS: readonly AchievementId[] = ACHIEVEMENTS.map((a) => a.id);

/** Per-run tallies that `RunState` does not carry. */
interface Tally {
  /** Manual clicks since this project started. */
  manualClicksThisProject: number;
  /** `run.elapsedMs` of the last manual click. */
  lastManualClickMs: number;
  /** Slop earned by clicking (manual or automated) this run. */
  clickSlop: number;
  /** Slop earned by one-shot bursts this run. */
  oneShotSlop: number;
  /** Bad incidents that fired this run. */
  badIncidents: number;
  /** Incidents cleared since this project started. */
  clearsThisProject: number;
  /** Consecutive drafts where the leftmost card was taken. */
  leftmostStreak: number;
  /** The offer currently on screen, to know which card was leftmost. */
  offer: readonly string[];
}

function emptyTally(): Tally {
  return {
    manualClicksThisProject: 0,
    lastManualClickMs: 0,
    clickSlop: 0,
    oneShotSlop: 0,
    badIncidents: 0,
    clearsThisProject: 0,
    leftmostStreak: 0,
    offer: [],
  };
}

export interface AchievementTracker {
  /**
   * Feed one event plus the state *after* it applied. Returns the ids that
   * became true, which the caller is responsible for committing.
   */
  handle(e: GameEvent, run: RunState, meta: MetaState, derived: DerivedStats): AchievementId[];
  /** Exposed for tests and for the stats readout. */
  readonly tally: Readonly<Tally>;
}

/** True when every node of some branch sits at its max level. */
function aBranchIsMaxed(meta: MetaState): boolean {
  const branches = new Map<string, boolean>();
  for (const def of META_UPGRADES) {
    if (def.branch === 'root') continue;
    const maxed = (meta.levels[def.id] ?? 0) >= def.maxLevel;
    branches.set(def.branch, (branches.get(def.branch) ?? true) && maxed);
  }
  for (const ok of branches.values()) if (ok) return true;
  return false;
}

function everyNodeMaxed(meta: MetaState): boolean {
  return META_UPGRADES.every((d) => (meta.levels[d.id] ?? 0) >= d.maxLevel);
}

function ownsEveryTier(run: RunState): boolean {
  return AGENT_TIER_IDS.every((id) => (run.agents[id] ?? 0) >= 1);
}

export function createAchievementTracker(): AchievementTracker {
  let t = emptyTally();

  function handle(
    e: GameEvent,
    run: RunState,
    meta: MetaState,
    derived: DerivedStats,
  ): AchievementId[] {
    const out: AchievementId[] = [];
    const win = (id: AchievementId): void => {
      if (!meta.achievements[id]) out.push(id);
    };

    switch (e.t) {
      case 'runStart':
        t = emptyTally();
        break;

      case 'click':
        t.clickSlop += e.amount;
        if (!e.auto) {
          t.manualClicksThisProject += 1;
          t.lastManualClickMs = run.elapsedMs;
        }
        break;

      case 'oneShot':
        t.oneShotSlop += e.amount;
        break;

      case 'buyAgent':
        if (ownsEveryTier(run)) win('full_stack');
        if (e.id === 'ralph_loop') {
          const cap = AGENT_TIERS.find((a) => a.id === 'ralph_loop')?.maxOwned ?? Infinity;
          if ((run.agents['ralph_loop'] ?? 0) >= cap) win('ralph');
        }
        break;

      case 'incidentStart':
        if (e.tone === 'bad') t.badIncidents += 1;
        break;

      case 'incidentEnd': {
        t.clearsThisProject += 1;
        if (t.clearsThisProject >= FIREFIGHTER_CLEARS) win('firefighter');
        // The duck is a card, so "explaining it to the duck" means clearing a
        // click-to-fix incident while holding Rubber Duck.
        const def = INCIDENT_BY_ID[e.id];
        if (def?.clearWithClicks && run.cards.includes('rubber_duck')) win('rubber_duck');
        break;
      }

      case 'ship':
        win('first_ship');
        if (e.timeLeftMs < 5_000) win('friday');
        if (t.manualClicksThisProject === 0) win('no_hands');
        if (run.elapsedMs - t.lastManualClickMs >= AFK_MS) win('afk');
        // A new project: the per-project tallies start over.
        t.manualClicksThisProject = 0;
        t.clearsThisProject = 0;
        break;

      case 'draftOpen':
        t.offer = e.offer;
        break;

      case 'draftPick':
        if (t.offer.length > 0 && t.offer[0] === e.id) {
          t.leftmostStreak += 1;
          if (t.leftmostStreak >= LEFTMOST_STREAK) win('absolutely_right');
        } else {
          t.leftmostStreak = 0;
        }
        t.offer = [];
        break;

      case 'metaBuy':
        if (aBranchIsMaxed(meta)) win('vertical');
        if (everyNodeMaxed(meta)) win('tokenmaxxed');
        break;

      case 'runOver':
        // `runOver` fires before the run counters land in meta, so compare
        // against the totals this run contributed rather than reading them back.
        if (meta.totalDemosEarned + e.demos >= SERIES_A_DEMOS) win('series_a');
        if (e.won) {
          win('demo_day');
          if (t.oneShotSlop > t.clickSlop && t.oneShotSlop > 0) win('one_shot_wonder');
          if (t.badIncidents === 0) win('no_mistakes');
        } else {
          if (meta.runs - meta.wins + 1 >= SIGKILL_LOSSES) win('sigkill');
          // Heartbreak: the last project, with the bar all but full.
          if (run.projectIndex >= FINAL_PROJECT_INDEX && derived.shipProgress >= 0.99) {
            win('technical_debt');
          }
        }
        break;

      default:
        break;
    }

    // Checked on every event: slop moves continuously, not on a named beat.
    if (run.slop >= BIG_SLOP) win('hellaslop');

    return out;
  }

  return {
    handle,
    get tally() {
      return t;
    },
  };
}
