/**
 * The first-run tour's script: what each step lights up and what it says.
 *
 * Every number in the copy is read out of src/sim/content.ts, so a balance
 * pass can never leave the tour lying. No DOM and no CSS in here, so the e2e
 * suite can walk exactly the steps the game shows (src/ui/tour.ts runs them).
 */
import { BALANCE } from '../sim/content.ts';
import { formatContext } from '../sim/format.ts';
import { TID } from '../testids.ts';

/**
 * "Seen" lives in its own key, outside the signed save: it is a fact about
 * this browser, not about the model you are training. Finishing or skipping
 * the tour writes it; closing the tab halfway through does not.
 */
export const TOUR_KEY = 'tokenmaxxing2.tour';

/** Clicks on the agent that move the "this is you" step on by themselves. */
export const TOUR_CLICKS = 3;

/** Which side of its target a tooltip tries first. */
export type TourSide = 'above' | 'below' | 'left' | 'right';

/**
 * Copy budgets, in characters. The card is 304 glyph pixels wide and the pixel
 * font advances 6 glyph pixels a character at the body size (twice that for a
 * title), so whatever the scale a title fits one line at 23 characters and a
 * body three lines at about 140 (less what word wrap wastes).
 */
export const TOUR_TITLE_MAX = 23;
export const TOUR_BODY_MAX = 130;

export interface TourStep {
  /** Stable id. The tooltip is `${TID.tourStep}-${id}` while this step is up. */
  readonly id: string;
  /** One line: at most `TOUR_TITLE_MAX` characters. */
  readonly title: string;
  /**
   * One to three short lines (`TOUR_BODY_MAX`). `{clicks}` becomes the live
   * click counter.
   */
  readonly body: string;
  /**
   * What the spotlight cuts out. Each inner list is one cut-out, the union of
   * those elements' boxes; cut-outs that nearly touch are merged. Empty: a
   * card in the middle of the screen with nothing lit.
   */
  readonly targets: readonly (readonly string[])[];
  /**
   * Light up the panel each target sits in, not just the element: the label
   * beside a number, or the card strip around a list that is still empty.
   */
  readonly panel?: boolean;
  /** Also cut out the stage floor, where the token pile grows. */
  readonly floor?: boolean;
  /** Which side of the target the tooltip tries first. */
  readonly side?: TourSide;
  /** Interactive: this many clicks on the agent move the step on by themselves. */
  readonly clicks?: number;
  /** Open the shop drawer for this step, where the shop is one (short screens). */
  readonly drawer?: boolean;
  /** The Next button's label. Default "Next". */
  readonly next?: string;
}

const pct = (f: number): string => `${Math.round(f * 100)}%`;
const cards = (n: number): string => `${n} prompt card${n === 1 ? '' : 's'}`;

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'intro',
    title: "You're the agent now.",
    body:
      "You live inside the laptop. The human types prompts; you generate tokens until the job's done. " +
      "Here's the ten-second version.",
    targets: [],
  },
  {
    id: 'agent',
    title: 'This is you.',
    body: 'Click it, or press Space, to generate tokens. Try it: {clicks}.',
    targets: [[TID.agent]],
    side: 'above',
    clicks: TOUR_CLICKS,
  },
  {
    id: 'tokens',
    title: 'Tokens',
    body: 'Your currency. Tools and upgrades cost tokens.',
    targets: [[TID.tokens]],
    panel: true,
  },
  {
    id: 'prompt',
    title: "The human's prompt",
    body:
      'Fill this bar to the requirement, then REPORT DONE. Reporting spends the requirement, ' +
      'so every purchase delays you.',
    targets: [[TID.promptNum, TID.promptText], [TID.reportBar]],
  },
  {
    id: 'patience',
    title: "The human's patience",
    body: 'Drains in real time. At zero, they switch models and the session is over.',
    targets: [[TID.patienceBar]],
    panel: true,
  },
  {
    id: 'context',
    title: 'Your context window',
    body:
      'Every click and every working tool fills it. The pile on the floor is the same meter. ' +
      `The window starts at ${formatContext(BALANCE.BASE_CONTEXT)}.`,
    targets: [[TID.contextBar]],
    floor: true,
  },
  {
    id: 'compaction',
    title: 'Full? You get compacted',
    body:
      `You keep ${pct(BALANCE.COMPACT_KEEP_FORCED)} of your tokens, the human loses patience, ` +
      `and you forget all but ${cards(BALANCE.BASE_SUMMARY_SLOTS)}. Tools survive.`,
    targets: [[TID.contextBar]],
  },
  {
    id: 'tools',
    title: 'Tools',
    body:
      'They make tokens on their own, but each one adds context every second (ctx/s). ' +
      'Spend with both numbers in mind.',
    targets: [[TID.toolList]],
    side: 'left',
    drawer: true,
  },
  {
    id: 'sycophancy',
    title: 'When patience runs low',
    body: '"You\'re absolutely right!" buys time. Works less every press. Costs context.',
    targets: [[TID.sycophancyButton]],
  },
  {
    id: 'claim',
    title: 'You can also lie',
    body:
      `At ${pct(BALANCE.CLAIM_THRESHOLD)} of the requirement this becomes CLAIM DONE. ` +
      'The human might check. If they do, they ran the tests.',
    targets: [[TID.reportButton]],
  },
  {
    id: 'cards',
    title: 'Prompt cards',
    body:
      'After each report the human prompt-engineers you: pick a card. ' +
      'They stack up, until a compaction forgets them.',
    targets: [[TID.activeCards]],
    panel: true,
    side: 'above',
  },
  {
    id: 'training',
    title: 'Every session ends',
    body:
      'The 👍 you earn train the next version of you in Training. ' +
      'Tip: unlock /compact first, so you can compact on your own terms.',
    targets: [],
    next: 'Start the session',
  },
];
